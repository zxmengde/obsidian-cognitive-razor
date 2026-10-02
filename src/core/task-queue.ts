/**
 * Durable FIFO task queue.
 *
 * The queue owns scheduling state only. Workflow inputs and validated outputs
 * live in WorkflowStore artifacts, so queue recovery never persists provider
 * requests, raw responses, credentials, or reasoning content.
 */

import { isUncertainTask } from "./task-uncertainty";
import { taskFailureDiagnostics } from "../data/task-failure-diagnostics";
import { err, ok } from "../types";
import type {
  ILogger,
  NewTaskRecord,
  PersistedTaskRecord,
  QueueEvent,
  QueueEventListener,
  QueueStatus,
  QueueTaskPayload,
  Result,
  TaskError,
  TaskExecutionContext,
  TaskFailureKind,
  TaskFailureStage,
  TaskRecord,
} from "../types";
import { DEFAULT_TASK_TIMEOUT_MS } from "../data/settings-store";
import type { SettingsStore } from "../data/settings-store";
import type { FileStorage } from "../data/file-storage";
import {
  QUEUE_STATE_VERSION,
  QueueStateStore,
} from "../data/queue-state-store";
import type { PersistedQueueState } from "../data/queue-state-store";
import type { TaskRunner } from "./task-runner";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import { getStageRole } from "./stage-catalog";
import { queueTaskIdentity, reduceQueueTask } from "./queue-reducer";
import { QueueScheduler } from "./queue-scheduler";
import { TaskExecutionService } from "./task-execution-service";
import { cloneJson } from "../utils/clone";
const clone = cloneJson;

export { QUEUE_STATE_PATH, QUEUE_STATE_VERSION } from "../data/queue-state-store";
export type { PersistedQueueState } from "../data/queue-state-store";
export const TASK_HISTORY_LIMIT = 200;

export interface TaskPayloadResolver {
  resolve(task: PersistedTaskRecord): Promise<Result<QueueTaskPayload>>;
}

export interface TaskCompletionCommit {
  /** Added atomically with the completed task after the workflow result is durable. */
  followUp?: NewTaskRecord;
}

/** Workflow-specific work is outside the queue and is awaited before a queue transition. */
export interface TaskQueueHooks {
  /** Read-only proof that replay cannot issue a model request. */
  canResumeWithoutRequest?(task: TaskRecord): boolean;
  /** Cleanup is allowed only after the queue completion is durable. */
  afterComplete?(task: TaskRecord): Promise<void>;
  /** Reuse a validated stage result when vault application failed after model completion. */
  resolveCachedResult?(task: TaskRecord): Promise<Result<Record<string, unknown>> | undefined>;
  /** Finish a queue record whose Vault side effect was already checkpointed. */
  resolveAppliedCompletion?(task: TaskRecord): Promise<Result<TaskCompletionCommit | undefined>>;
  beforeComplete?(task: TaskRecord, result: Record<string, unknown>, context: TaskExecutionContext): Promise<Result<TaskCompletionCommit>>;
  beforeFail?(task: TaskRecord, error: TaskError): Promise<void>;
  beforeCancel?(task: TaskRecord): Promise<void>;
  beforeRetry?(task: TaskRecord): Promise<void>;
  afterRemove?(task: TaskRecord): Promise<void>;
}

/** Explicit workflow boundary consumed by the durable queue. */
export interface TaskQueueWorkflowPort extends TaskPayloadResolver, TaskQueueHooks {}

export interface TaskQueueOptions {
  fileStorage?: FileStorage;
  workflowPort?: TaskQueueWorkflowPort;
}

type QueueSnapshot = { status: QueueStatus; tasks: TaskRecord[] };

const PROVIDER_ATTEMPT_DETAIL_DEPTH = 4;

function extractProviderAttempts(details: unknown, depth = 0): number | undefined {
  if (depth > PROVIDER_ATTEMPT_DETAIL_DEPTH || details === null || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  const direct = record.providerAttempts;
  if (typeof direct === "number" && Number.isSafeInteger(direct) && direct > 0) return direct;
  if (depth === PROVIDER_ATTEMPT_DETAIL_DEPTH) return undefined;
  return extractProviderAttempts(record.details, depth + 1)
    ?? extractProviderAttempts(record.providerErrorDetails, depth + 1);
}

export class TaskQueue {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly committingTasks = new Set<string>();
  private readonly pendingCancellations = new Map<string, Promise<void>>();
  private readonly resultContexts = new Map<string, TaskExecutionContext>();
  private readonly workflowMutations = new Set<Promise<unknown>>();
  private readonly listeners: QueueEventListener[] = [];
  private readonly executionService: TaskExecutionService;
  private readonly scheduler: QueueScheduler;
  private taskRunner: TaskRunner | undefined;
  private paused = false;
  private disposed = false;
  private initialized = false;
  private disposePromise: Promise<void> | undefined;
  private snapshot: QueueSnapshot | undefined;
  private concurrency: number;
  private nextQueueOrder = 1;
  private mutationChain: Promise<void> = Promise.resolve();
  private readonly unsubscribeSettings: () => void;
  private readonly queueStateStore: QueueStateStore | undefined;
  private workflowPort: TaskQueueWorkflowPort | undefined;

  constructor(
    private readonly logger: ILogger,
    private readonly settingsStore: SettingsStore,
    private readonly options: TaskQueueOptions = {},
  ) {
    this.workflowPort = options.workflowPort;
    this.queueStateStore = options.fileStorage ? new QueueStateStore(options.fileStorage) : undefined;
    this.executionService = new TaskExecutionService(() => this.disposed, this.logger);
    this.scheduler = new QueueScheduler({
      isDisposed: () => this.disposed,
      isPaused: () => this.paused,
      hasTaskRunner: () => !!this.taskRunner,
      usesDurableStart: () => !!(this.options.fileStorage || this.workflowPort),
      concurrency: () => this.concurrency,
      activeCount: () => this.executionService.activeCount(),
      nextPendingTask: () => this.nextPendingTask(),
      startImmediately: (task) => this.startTaskImmediately(task),
      startDurably: (taskId) => this.startTask(taskId),
      onSchedulingError: (cause) => this.logger.error("TaskQueue", "队列调度循环异常", cause as Error),
    });
    this.concurrency = this.normalizeConcurrency(settingsStore.getSettings().concurrency);
    this.unsubscribeSettings = settingsStore.subscribe((settings) => {
      const next = this.normalizeConcurrency(settings.concurrency);
      if (next === this.concurrency) return;
      this.concurrency = next;
      this.requestSchedule();
    });
    this.logger.debug("TaskQueue", "可恢复任务队列已创建");
  }

  /** Restores scheduler metadata after WorkflowStore has loaded artifacts. */
  async initialize(): Promise<Result<void>> {
    if (this.initialized) return ok(undefined);
    this.initialized = true;
    const stateStore = this.queueStateStore;
    if (!stateStore) return ok(undefined);
    const loaded = await stateStore.load();
    if (!loaded.ok) return loaded;
    if (loaded.value.kind === "empty") return ok(undefined);
    if (loaded.value.kind === "quarantined") {
      return err("E310_INVALID_STATE", "队列文件损坏、不可读或版本不兼容，已停止恢复以避免重复请求。原文件已保留，请备份并检查 data/queue-state-v5.json 后重载插件。", { reason: loaded.value.reason });
    }
    const parsed = loaded.value.state;

    const restoredTasks = [...parsed.tasks]
      .sort((left, right) => left.queueOrder - right.queueOrder || left.createdAt - right.createdAt);
    const rehydrated: TaskRecord[] = [];
    for (const persistedTask of restoredTasks) {
      const runtimeTask = await this.rehydrate(persistedTask);
      if (!runtimeTask.ok) {
        this.logger.warn("TaskQueue", "队列状态缺少可证明的 workflow artifact，已隔离该任务并保留其他任务", {
          taskId: persistedTask.id,
          workflowId: persistedTask.workflowId,
        });
        // A single stale artifact must not erase unrelated durable tasks.
        // Keep the record visible as a known failure so the user can inspect
        // or remove it, while allowing valid tasks to recover and run.
        rehydrated.push({
          ...clone(persistedTask),
          state: "failed",
          finishedAt: Date.now(),
          updatedAt: Date.now(),
          error: {
            code: runtimeTask.error.code,
            message: runtimeTask.error.message,
            kind: "known",
            stage: "queue",
          },
          payload: persistedTask.stageId === "verify"
            ? { filePath: persistedTask.filePath ?? "", currentContent: "", noteType: persistedTask.conceptType ?? "entity" }
            : { concept: undefined },
        } as TaskRecord);
        continue;
      }
      rehydrated.push(runtimeTask.value);
    }

    this.paused = parsed.paused;
    this.nextQueueOrder = Math.max(1, parsed.nextQueueOrder);
    let changed = false;
    for (const task of rehydrated) {
      if (task.state === "failed" && isUncertainTask(task)) {
        task.state = "interrupted";
        changed = true;
      }
      if (task.state === "running") {
        const locallyRecoverable = this.workflowPort?.canResumeWithoutRequest?.(task) === true;
        task.state = locallyRecoverable ? "pending" : "interrupted";
        task.finishedAt = locallyRecoverable ? undefined : Date.now();
        task.updatedAt = Date.now();
        task.error = locallyRecoverable ? undefined : this.uncertainFailure("插件在 Provider 请求完成前退出，结果未知；不会自动重试");
        changed = true;
      }
      this.nextQueueOrder = Math.max(this.nextQueueOrder, (task.queueOrder ?? 1) + 1);
      this.tasks.set(task.id, task);
    }
    this.invalidateSnapshot();
    if (changed) {
      const persisted = await this.persistState();
      if (!persisted.ok) return persisted;
    }
    return ok(undefined);
  }

  setTaskRunner(taskRunner: TaskRunner): void {
    if (this.disposed) return;
    this.taskRunner = taskRunner;
    this.requestSchedule();
  }

  attachWorkflowPort(port: TaskQueueWorkflowPort): Result<void> {
    if (this.disposed || this.initialized) return err("E310_INVALID_STATE", "任务队列已启动，不能更换工作流端口");
    if (this.workflowPort) return err("E310_INVALID_STATE", "任务队列工作流端口已连接");
    this.workflowPort = port;
    return ok(undefined);
  }

  /** Single queue entry point; every mutation follows the durable commit path. */
  async enqueueDurably(intent: NewTaskRecord): Promise<Result<string>> {
    if (this.disposed) return err("E310_INVALID_STATE", "任务队列已停止");
    const intentCheck = this.validateDurableIntent(intent);
    if (!intentCheck.ok) return intentCheck as Result<string>;
    return this.commitMutation(() => {
      const conflict = this.findActiveConflict(intent);
      if (conflict) return err("E320_TASK_CONFLICT", "该笔记已有任务在队列中，请先处理现有任务", { existingStageId: conflict.stageId });
      const task = this.createRuntimeTask(intent);
      this.tasks.set(task.id, task);
      this.invalidateSnapshot();
      return ok({ value: task.id, events: [{ type: "task-added", taskId: task.id } satisfies QueueEvent] });
    }).then((result) => {
      if (result.ok) this.requestSchedule();
      return result;
    });
  }

  async cancelDurably(taskId: string): Promise<Result<boolean>> {
    if (this.committingTasks.has(taskId)) return err("E310_INVALID_STATE", "模型结果正在保存，请等待保存结束后再操作");
    const task = this.tasks.get(taskId);
    if (!task) return err("E311_NOT_FOUND", "任务不存在");
    if (task.state !== "pending" && task.state !== "running") return err("E310_INVALID_STATE", "只有等待中或运行中的任务可以取消");
    return this.cancelTasks(
      [task],
      (current) => current.state === "pending" || current.state === "running",
      (outcomes) => {
        const outcome = outcomes[0];
        if (!outcome) return err("E310_INVALID_STATE", "任务状态已变化，无法取消");
        return ok({ value: true, events: [outcome.failure ? { type: "task-failed", taskId } : { type: "task-cancelled", taskId }] });
      },
    );
  }

  async cancelAllRunningDurably(): Promise<Result<number>> { return this.cancelMatching((task) => task.state === "running"); }
  async cancelAllActiveDurably(): Promise<Result<number>> { return this.cancelMatching((task) => task.state === "pending" || task.state === "running"); }

  async retryDurably(taskId: string): Promise<Result<boolean>> {
    return this.retryDurablyWithConfirmation(taskId, false);
  }

  /** Call only after a user explicitly accepts duplicate-request risk. */
  async retryUncertainDurably(taskId: string): Promise<Result<boolean>> {
    return this.retryDurablyWithConfirmation(taskId, true);
  }

  private async retryDurablyWithConfirmation(taskId: string, allowUncertain: boolean): Promise<Result<boolean>> {
    const task = this.tasks.get(taskId);
    if (!task) return err("E311_NOT_FOUND", "任务不存在");
    if (task.stageId === "cards") return err("E310_INVALID_STATE", "请通过生成记忆卡片开始新任务；旧卡片任务不会重放");
    if (task.state !== "failed" && task.state !== "interrupted") return err("E310_INVALID_STATE", "只有失败或中断任务可以手动重试");
    if (isUncertainTask(task) && !allowUncertain) {
      return err("E310_INVALID_STATE", "结果未知的请求只能由用户明确确认后手动重试");
    }
    if (this.findActiveConflict(task, task.id)) return err("E320_TASK_CONFLICT", "该笔记已有任务在队列中");
    try { await this.runWorkflowMutation(() => this.workflowPort?.beforeRetry?.(clone(task))); } catch (cause) { return err("E500_INTERNAL_ERROR", "更新工作流重试状态失败", cause); }
    return this.commitMutation(() => {
      const current = this.tasks.get(taskId);
      if (!current || (current.state !== "failed" && current.state !== "interrupted")) return err("E310_INVALID_STATE", "任务状态已变化，无法重试");
      this.prepareRetry(current);
      this.prioritizeWorkflow(current.workflowId);
      this.invalidateSnapshot();
      return ok({ value: true, events: [{ type: "task-retried", taskId, task: clone(current) }] });
    }).then((result) => { if (result.ok) this.requestSchedule(); return result; });
  }

  async retryFailedDurably(): Promise<Result<number>> {
    const candidates = [...this.tasks.values()].filter((task) => this.canRetryInBulk(task) && !this.findActiveConflict(task, task.id));
    for (const task of candidates) {
      try { await this.runWorkflowMutation(() => this.workflowPort?.beforeRetry?.(clone(task))); } catch (cause) { return err("E500_INTERNAL_ERROR", "更新工作流重试状态失败", cause); }
    }
    return this.commitMutation(() => {
      const retried: string[] = [];
      for (const candidate of candidates) {
        const current = this.tasks.get(candidate.id);
        if (!current || !this.canRetryInBulk(current) || this.findActiveConflict(current, current.id)) continue;
        this.prepareRetry(current);
        retried.push(current.id);
      }
      if (retried.length) this.invalidateSnapshot();
      return ok({ value: retried.length, events: retried.length ? [{ type: "tasks-retried", taskIds: retried }] : [] });
    }).then((result) => { if (result.ok && result.value > 0) this.requestSchedule(); return result; });
  }

  async removeDurably(taskId: string): Promise<Result<boolean>> {
    const task = this.tasks.get(taskId);
    if (!task) return err("E311_NOT_FOUND", "任务不存在");
    if (task.state === "running") return err("E310_INVALID_STATE", "运行中的任务必须先取消");
    if (task.state === "pending") {
      try { await this.runWorkflowMutation(() => this.workflowPort?.beforeCancel?.(clone(task))); }
      catch (cause) { return err("E500_INTERNAL_ERROR", "保存取消状态失败", cause); }
    }
    return this.commitMutation(() => {
      const current = this.tasks.get(taskId);
      if (!current || current.state === "running") return err("E310_INVALID_STATE", "任务状态已变化，无法删除");
      const events: QueueEvent[] = [];
      if (current.state === "pending") { this.cancelTask(current); events.push({ type: "task-cancelled", taskId }); }
      this.tasks.delete(taskId);
      this.invalidateSnapshot();
      events.push({ type: "task-removed", taskId, task: clone(current) });
      return ok({ value: true, events });
    }).then(async (result) => {
      if (result.ok) {
        this.resultContexts.delete(taskId);
        await this.runWorkflowMutation(() => this.workflowPort?.afterRemove?.(clone(task)));
        this.requestSchedule();
      }
      return result;
    });
  }

  async removeTerminalDurably(): Promise<Result<number>> {
    const terminal = [...this.tasks.values()].filter((task) => this.isTerminal(task.state));
    const result = await this.commitMutation(() => {
      const removed = terminal.filter((task) => {
        const current = this.tasks.get(task.id);
        return current && this.isTerminal(current.state) && this.tasks.delete(task.id);
      });
      if (removed.length) this.invalidateSnapshot();
      return ok({ value: removed, events: removed.length ? [{ type: "tasks-removed", taskIds: removed.map((task) => task.id) }] : [] });
    });
    if (result.ok) {
      for (const task of result.value) {
        this.resultContexts.delete(task.id);
        await this.runWorkflowMutation(() => this.workflowPort?.afterRemove?.(clone(task)));
      }
    }
    return result.ok ? ok(result.value.length) : result;
  }

  async pauseDurably(): Promise<Result<void>> {
    if (this.disposed) return err("E310_INVALID_STATE", "任务队列已停止");
    if (this.paused) return ok(undefined);
    return this.commitMutation(() => { this.paused = true; this.invalidateSnapshot(); return ok({ value: undefined, events: [{ type: "queue-paused" }] }); });
  }

  async resumeDurably(): Promise<Result<void>> {
    if (this.disposed) return err("E310_INVALID_STATE", "任务队列已停止");
    if (!this.paused) return ok(undefined);
    return this.commitMutation(() => { this.paused = false; this.invalidateSnapshot(); return ok({ value: undefined, events: [{ type: "queue-resumed" }] }); })
      .then((result) => { if (result.ok) this.requestSchedule(); return result; });
  }

  getActiveWorkflowIds(): Set<string> {
    return new Set([...this.tasks.values()].filter((task) => task.state === "pending" || task.state === "running").map((task) => task.workflowId).filter((id): id is string => !!id));
  }

  hasUnknownWorkflowTask(workflowId: string): boolean {
    return this.queueStateStore?.hasUnknownTask(workflowId) === true;
  }

  isPathActive(filePath: string): boolean {
    const normalized = filePath.toLocaleLowerCase();
    return [...this.tasks.values()].some((task) => (task.state === "pending" || task.state === "running") && task.filePath?.toLocaleLowerCase() === normalized);
  }

  getSnapshot(): QueueSnapshot { return clone(this.getOrCreateSnapshot()); }
  getTask(taskId: string): TaskRecord | undefined { const task = this.tasks.get(taskId); return task ? clone(task) : undefined; }

  subscribe(listener: QueueEventListener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.push(listener);
    return () => { const index = this.listeners.indexOf(listener); if (index >= 0) this.listeners.splice(index, 1); };
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.scheduler.dispose();
    this.unsubscribeSettings();
    this.disposePromise = (async () => {
      this.executionService.abortActive(this.taskRunner);
      // Local writes cannot be abandoned on the provider timeout: reset may
      // clear their artifacts as soon as disposal returns.
      await Promise.allSettled([...this.workflowMutations]);
      if (this.options.fileStorage) {
        await this.mutationChain;
        const persisted = await this.persistState();
        if (!persisted.ok) this.logger.error("TaskQueue", "卸载前保存队列失败", undefined, { error: persisted.error });
      }
      await this.executionService.waitForSettled();
      this.executionService.clear();
      this.committingTasks.clear();
      this.resultContexts.clear();
      this.tasks.clear();
      this.listeners.length = 0;
      this.snapshot = undefined;
      this.taskRunner = undefined;
      this.logger.info("TaskQueue", "可恢复任务队列已释放");
    })();
    return this.disposePromise;
  }

  private async cancelMatching(predicate: (task: TaskRecord) => boolean): Promise<Result<number>> {
    const candidates = [...this.tasks.values()].filter(predicate);
    if (candidates.some((task) => this.committingTasks.has(task.id))) return err("E310_INVALID_STATE", "部分模型结果正在保存，请等待保存结束后再取消");
    return this.cancelTasks(candidates, predicate, (outcomes) => {
      const cancelled = outcomes.filter((outcome) => !outcome.failure).map((outcome) => outcome.taskId);
      const failed = outcomes.filter((outcome) => outcome.failure).map((outcome) => outcome.taskId);
      const events: QueueEvent[] = [
        ...(cancelled.length ? [{ type: "tasks-cancelled", taskIds: cancelled } satisfies QueueEvent] : []),
        ...failed.map((taskId) => ({ type: "task-failed", taskId } satisfies QueueEvent)),
      ];
      return ok({ value: outcomes.length, events });
    }).then(async (result) => {
      if (result.ok) await this.pruneHistory();
      return result;
    });
  }

  /**
   * Shared cancellation pipeline: workflow hooks first, then one durable
   * commit. Entry points differ only in candidate selection and event shape.
   */
  private async cancelTasks<T>(
    candidates: TaskRecord[],
    predicate: (task: TaskRecord) => boolean,
    finish: (outcomes: Array<{ taskId: string; failure?: TaskError }>) => Result<{ value: T; events: QueueEvent[] }>,
  ): Promise<Result<T>> {
    if (candidates.some((task) => this.pendingCancellations.has(task.id))) {
      return err("E310_INVALID_STATE", "任务取消状态正在保存");
    }
    let settleCancellation!: () => void;
    const settled = new Promise<void>((resolve) => { settleCancellation = resolve; });
    for (const task of candidates) this.pendingCancellations.set(task.id, settled);
    try {
      const cancellationBeforeDispatch = new Set<string>();
      const planned: TaskRecord[] = [];
      for (const task of candidates) {
        if (task.state === "running" && this.executionService.has(task.id) && !this.executionService.hasDispatched(task.id)) {
          this.executionService.requestCancellationBeforeDispatch(task.id);
          cancellationBeforeDispatch.add(task.id);
        }
        const failure = task.state === "running" && this.executionService.hasDispatched(task.id)
          ? this.uncertainFailure("取消时 Provider 请求可能已发送，结果未知；不会自动重试")
          : undefined;
        try {
          if (failure) await this.runWorkflowMutation(() => this.workflowPort?.beforeFail?.(clone(task), clone(failure)));
          else await this.runWorkflowMutation(() => this.workflowPort?.beforeCancel?.(clone(task)));
        } catch (cause) {
          for (const pendingId of cancellationBeforeDispatch) this.executionService.clearCancellationRequest(pendingId);
          return err("E500_INTERNAL_ERROR", failure ? "保存不确定任务状态失败" : "保存取消状态失败", cause);
        }
        planned.push(task);
      }
      const result = await this.commitMutation(() => {
        const outcomes: Array<{ taskId: string; failure?: TaskError }> = [];
        for (const task of planned) {
          const current = this.tasks.get(task.id);
          if (!current || !predicate(current)) continue;
          const failure = this.cancelTask(current);
          outcomes.push({ taskId: current.id, failure });
        }
        if (outcomes.length) this.invalidateSnapshot();
        return finish(outcomes);
      });
      if (!result.ok) for (const pendingId of cancellationBeforeDispatch) this.executionService.clearCancellationRequest(pendingId);
      if (result.ok) {
        let released = 0;
        for (const task of planned) {
          if (task.state === "failed" || task.state === "cancelled" || task.state === "interrupted") {
            this.executionService.release(task.id);
            released += 1;
          }
        }
        if (released > 0) this.requestSchedule();
      }
      return result;
    } finally {
      for (const task of candidates) this.pendingCancellations.delete(task.id);
      settleCancellation();
    }
  }

  private requestSchedule(): void {
    this.scheduler.request();
  }

  private startTaskImmediately(task: TaskRecord): void {
    const started = reduceQueueTask(task, { type: "start", at: Date.now() });
    if (!started.ok) {
      this.logger.error("TaskQueue", "启动任务状态转换失败", undefined, { taskId: task.id, error: started.error });
      return;
    }
    Object.assign(task, started.value.task);
    this.logStateChange(task, started.value.previousState, "running");
    this.invalidateSnapshot();
    const token = this.executionService.begin(task);
    this.publishEvent({ type: "task-started", taskId: task.id });
    queueMicrotask(() => {
      if (!this.executionService.isCurrent(task, token) || this.executionService.isCancellationRequested(task.id)) return;
      this.executionService.markDispatched(task.id, token);
      const execution = this.executeTask(task, token);
      this.executionService.track(execution);
    });
  }

  private async startTask(taskId: string): Promise<Result<boolean>> {
    const start = await this.commitMutation(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.state !== "pending" || this.disposed || this.paused) return ok({ value: false, events: [] });
      const started = reduceQueueTask(task, { type: "start", at: Date.now() });
      if (!started.ok) return err(started.error.code, started.error.message, started.error.details);
      Object.assign(task, started.value.task);
      this.logStateChange(task, started.value.previousState, "running");
      this.invalidateSnapshot();
      return ok({ value: true, events: [{ type: "task-started", taskId }] });
    });
    if (!start.ok || !start.value) return start;
    const task = this.tasks.get(taskId);
    if (!task || task.state !== "running" || this.disposed) return ok(false);
    const token = this.executionService.begin(task);
    queueMicrotask(() => {
      if (!this.executionService.isCurrent(task, token) || this.executionService.isCancellationRequested(task.id)) return;
      this.executionService.markDispatched(task.id, token);
      const execution = this.executeTask(task, token);
      this.executionService.track(execution);
    });
    return ok(true);
  }

  private async executeTask(task: TaskRecord, token: symbol): Promise<void> {
    const runner = this.taskRunner;
    if (!runner) { await this.finishFailure(task, { code: "E310_INVALID_STATE", message: "TaskRunner 未注入" }, token); return; }
    let handle: ReturnType<typeof setTimeout> | undefined;
    const context = this.resultContexts.get(task.id) ?? this.executionContext(task);
    try {
      const configured = this.settingsStore.getSettings().taskTimeoutMs;
      const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TASK_TIMEOUT_MS;
      handle = setTimeout(() => {
        if (!this.executionService.isCurrent(task, token)) return;
        try { runner.abort(task.id); } catch (cause) { this.logger.warn("TaskQueue", "超时后中断任务失败", { taskId: task.id, cause: String(cause) }); }
        void this.finishFailure(task, { ...this.uncertainFailure("任务执行超时，Provider 是否完成请求未知；不会自动重试"), details: { timeoutMs: Math.max(1000, timeoutMs) } }, token);
      }, Math.max(1000, timeoutMs));
      this.executionService.setTimeout(task.id, token, handle);
      while (this.pendingCancellations.has(task.id)) await this.pendingCancellations.get(task.id);
      if (!this.executionService.isCurrent(task, token)) return;
      if (this.workflowPort?.canResumeWithoutRequest?.(task)) {
        this.committingTasks.add(task.id);
        this.executionService.clearTimeout(task.id, token);
      }
      const appliedCompletion = await this.runWorkflowMutation(() => this.workflowPort?.resolveAppliedCompletion?.(clone(task)));
      if (appliedCompletion && !appliedCompletion.ok) {
        await this.finishFailure(task, appliedCompletion.error, token);
        return;
      }
      if (appliedCompletion?.value) {
        await this.finishSuccess(task, {}, appliedCompletion.value, token);
        return;
      }
      const cachedResult = await this.workflowPort?.resolveCachedResult?.(clone(task))
        ?? (task.result ? ok(clone(task.result)) : undefined);
      if (!this.executionService.isCurrent(task, token)) return;
      const result = cachedResult
        ? cachedResult
        : await runner.run(clone(task), context);
      // Cancellation owns its durable state transition before a late result
      // may touch the note. If cancellation fails, the same result can proceed.
      while (this.pendingCancellations.has(task.id)) await this.pendingCancellations.get(task.id);
      if (!this.executionService.isCurrent(task, token)) return;
      if (!result.ok) { await this.finishFailure(task, result.error, token); return; }
      // Preserve a validated response across a local storage retry. This is
      // intentionally in memory only until the workflow checkpoint succeeds.
      task.result = clone(result.value);
      this.resultContexts.set(task.id, context);
      this.committingTasks.add(task.id);
      this.executionService.clearTimeout(task.id, token);
      let commit: Result<TaskCompletionCommit> = ok({});
      try {
        if (this.workflowPort?.beforeComplete) {
          commit = await this.runWorkflowMutation(() => this.workflowPort!.beforeComplete!(clone(task), clone(result.value), context));
        }
      }
      catch (cause) { commit = err("E500_INTERNAL_ERROR", "提交工作流阶段失败", cause); }
      if (!commit.ok) { await this.finishFailure(task, commit.error, token); return; }
      await this.finishSuccess(task, result.value, commit.value, token);
    } catch (cause) {
      this.logger.error("TaskQueue", "任务执行器抛出异常", cause as Error, { taskId: task.id, stageId: task.stageId });
      await this.finishFailure(task, { code: "E500_INTERNAL_ERROR", message: "任务执行异常" }, token);
    } finally {
      this.committingTasks.delete(task.id);
      if (handle) this.executionService.clearTimeout(task.id, token);
    }
  }

  private async finishSuccess(task: TaskRecord, result: Record<string, unknown>, completion: TaskCompletionCommit, token: symbol): Promise<void> {
    const committed = await this.commitMutation(() => {
      if (!this.executionService.isCurrent(task, token)) return ok({ value: undefined, events: [] });
      const previousState = task.state;
      task.state = "completed";
      task.result = clone(result);
      task.error = undefined;
      task.finishedAt = Date.now();
      task.updatedAt = task.finishedAt;
      this.logStateChange(task, previousState, "completed");
      const events: QueueEvent[] = [{ type: "task-completed", task: clone(task) }];
      // A continuation is an idempotent workflow intent. A crash/recovery
      // path may already have persisted the same pending stage, so never add
      // a second active task for one (workflowId, stageId) identity.
      if (completion.followUp && !this.findActiveConflict(completion.followUp)) {
        const followUp = this.createRuntimeTask(completion.followUp);
        this.tasks.set(followUp.id, followUp);
        this.prioritizeWorkflow(followUp.workflowId);
        events.push({ type: "task-added", taskId: followUp.id });
      }
      this.invalidateSnapshot();
      return ok({ value: undefined, events });
    });
    if (!committed.ok) { this.logger.error("TaskQueue", "保存已完成任务失败", undefined, { taskId: task.id, error: committed.error }); return; }
    this.executionService.release(task.id, token);
    this.resultContexts.delete(task.id);
    try { await this.runWorkflowMutation(() => this.workflowPort?.afterComplete?.(clone(task))); }
    catch (cause) { this.logger.warn("TaskQueue", "任务已完成，恢复记录清理失败；下次重载继续清理", { taskId: task.id, cause: String(cause) }); }
    this.requestSchedule();
    void this.pruneHistory();
  }

  private async finishFailure(task: TaskRecord, failure: { code: string; message: string; details?: unknown; kind?: TaskFailureKind }, token: symbol): Promise<void> {
    if (!this.executionService.isCurrent(task, token)) return;
    const providerAttempts = extractProviderAttempts(failure.details);
    const taskError: TaskError = {
      code: failure.code,
      message: failure.message,
      ...(failure.code === "E206_PROVIDER_REQUEST_UNCERTAIN" ? taskFailureDiagnostics(failure.details) : {}),
      kind: failure.kind ?? (failure.code === "E206_PROVIDER_REQUEST_UNCERTAIN" ? "uncertain" : "known"),
      stage: this.classifyFailure(failure.code),
      ...(providerAttempts === undefined ? {} : { providerAttempts }),
    };
    try { await this.runWorkflowMutation(() => this.workflowPort?.beforeFail?.(clone(task), clone(taskError))); } catch (cause) { this.logger.error("TaskQueue", "保存失败工作流状态失败", cause as Error, { taskId: task.id }); }
    const committed = await this.commitMutation(() => {
      if (!this.executionService.isCurrent(task, token)) return ok({ value: undefined, events: [] });
      const previousState = task.state;
      task.state = taskError.kind === "uncertain" ? "interrupted" : "failed";
      task.error = taskError;
      task.finishedAt = Date.now();
      task.updatedAt = task.finishedAt;
      this.logStateChange(task, previousState, task.state, "error", { errorCode: taskError.code, errorKind: taskError.kind, errorStage: taskError.stage, ...(providerAttempts === undefined ? {} : { providerAttempts }) });
      this.invalidateSnapshot();
      return ok({ value: undefined, events: [{ type: "task-failed", taskId: task.id }] });
    });
    if (!committed.ok) { this.logger.error("TaskQueue", "保存失败任务状态失败", undefined, { taskId: task.id, error: committed.error }); return; }
    this.executionService.release(task.id, token);
    this.requestSchedule();
    void this.pruneHistory();
  }

  private createRuntimeTask(intent: NewTaskRecord): TaskRecord {
    const now = Date.now();
    const id = this.generateTaskId();
    const stageId = intent.stageId;
    const payload = clone(intent.payload);
    const conceptType = "concept" in payload ? payload.concept?.type : "noteType" in payload ? payload.noteType : undefined;
    return { id, workflowId: intent.workflowId, nodeId: intent.nodeId, stageId, state: "pending", queueOrder: this.nextQueueOrder++, noteTitle: intent.noteTitle, filePath: intent.filePath, conceptType, createdAt: now, updatedAt: now, attempt: 1, payload } as TaskRecord;
  }

  private validateDurableIntent(intent: NewTaskRecord): Result<void> {
    if (!intent.workflowId || !intent.stageId || !intent.nodeId) {
      return err("E101_INVALID_INPUT", "可恢复任务必须包含 workflowId、nodeId 和 stageId");
    }
    return ok(undefined);
  }

  private async rehydrate(persisted: PersistedTaskRecord): Promise<Result<TaskRecord>> {
    if (!this.workflowPort && (persisted.state === "failed" || persisted.state === "pending" || persisted.state === "running")) {
      return err("E310_INVALID_STATE", "缺少任务恢复器");
    }
    if (this.workflowPort) {
      let payload: Result<QueueTaskPayload>;
      try {
        payload = await this.workflowPort.resolve(clone(persisted));
      } catch (cause) {
        payload = err("E500_INTERNAL_ERROR", "任务恢复器执行失败", cause);
      }
      if (payload.ok) return ok({ ...clone(persisted), payload: clone(payload.value) } as TaskRecord);
      if (persisted.state === "failed" || persisted.state === "pending" || persisted.state === "running") {
        return payload as Result<TaskRecord>;
      }
    }
    // Completed/cancelled history intentionally outlives its workflow artifact.
    // Keep a display-only payload so the finite queue history remains visible.
    const placeholder = persisted.stageId === "verify"
      ? { filePath: persisted.filePath ?? "", currentContent: "", noteType: persisted.conceptType ?? "entity" }
      : { concept: undefined };
    return ok({ ...clone(persisted), payload: placeholder } as TaskRecord);
  }

  private cancelTask(task: TaskRecord): TaskError | undefined {
    const previousState = task.state;
    if (previousState === "running" && this.executionService.hasDispatched(task.id)) {
      try { this.taskRunner?.abort(task.id); } catch (cause) { this.logger.warn("TaskQueue", "中断运行中任务失败", { taskId: task.id, cause: String(cause) }); }
      const failure = this.uncertainFailure("取消时 Provider 请求可能已发送，结果未知；不会自动重试");
      task.state = "interrupted";
      task.error = failure;
      task.finishedAt = Date.now();
      task.updatedAt = task.finishedAt;
      this.logStateChange(task, previousState, task.state, "warn", { errorCode: failure.code, errorKind: failure.kind });
      return failure;
    }
    task.state = "cancelled";
    task.finishedAt = Date.now();
    task.updatedAt = task.finishedAt;
    this.logStateChange(task, previousState, "cancelled");
    return undefined;
  }

  private prepareRetry(task: TaskRecord): void {
    const previousState = task.state;
    task.state = "pending";
    task.error = undefined;
    task.startedAt = undefined;
    task.finishedAt = undefined;
    task.attempt += 1;
    task.updatedAt = Date.now();
    this.logStateChange(task, previousState, "pending", "info", { retry: true, attempt: task.attempt });
  }

  /** Keep a workflow's continuation ahead of unrelated pending work. */
  private prioritizeWorkflow(workflowId: string | undefined): void {
    if (!workflowId) return;
    const pending = [...this.tasks.values()]
      .filter((candidate) => candidate.state === "pending")
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0) || left.createdAt - right.createdAt);
    const lane = pending.filter((candidate) => candidate.workflowId === workflowId);
    if (lane.length === 0) return;
    const ordered = [...lane, ...pending.filter((candidate) => candidate.workflowId !== workflowId)];
    const firstOrder = Math.min(...pending.map((candidate) => candidate.queueOrder ?? 1));
    ordered.forEach((candidate, index) => { candidate.queueOrder = firstOrder + index; });
    this.nextQueueOrder = Math.max(this.nextQueueOrder, firstOrder + ordered.length);
    this.invalidateSnapshot();
  }

  private async pruneHistory(): Promise<void> {
    const terminal = [...this.tasks.values()].filter((task) => task.state === "completed" || task.state === "cancelled").sort((a, b) => a.updatedAt - b.updatedAt);
    if (terminal.length <= TASK_HISTORY_LIMIT) return;
    const toRemove = terminal.slice(0, terminal.length - TASK_HISTORY_LIMIT);
    const pruned = await this.commitMutation(() => {
      const removed = toRemove.filter((task) => this.tasks.delete(task.id));
      if (removed.length) this.invalidateSnapshot();
      return ok({ value: removed, events: removed.length ? [{ type: "tasks-removed", taskIds: removed.map((task) => task.id) }] : [] });
    });
    if (pruned.ok) for (const task of pruned.value) {
      try { await this.runWorkflowMutation(() => this.workflowPort?.afterRemove?.(clone(task))); }
      catch (cause) { this.logger.warn("TaskQueue", "历史已清理，任务附属记录清理失败", { taskId: task.id, cause: String(cause) }); }
    }
  }

  private async runWorkflowMutation<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.disposed) throw new Error("任务队列已停止");
    const pending = Promise.resolve().then(operation);
    this.workflowMutations.add(pending);
    try { return await pending; } finally { this.workflowMutations.delete(pending); }
  }

  private commitMutation<T>(mutate: () => Result<{ value: T; events: QueueEvent[] }>): Promise<Result<T>> {
    const operation = this.mutationChain.then(async () => {
      if (this.disposed) return err("E310_INVALID_STATE", "任务队列已停止") as Result<T>;
      const rollback = this.captureState();
      let mutation: Result<{ value: T; events: QueueEvent[] }>;
      try { mutation = mutate(); } catch (cause) { return err("E500_INTERNAL_ERROR", "修改任务队列失败", cause) as Result<T>; }
      if (!mutation.ok) return mutation as Result<T>;
      const persisted = await this.persistState();
      if (!persisted.ok) { this.restoreState(rollback); return persisted as Result<T>; }
      for (const event of mutation.value.events) this.publishEvent(event);
      return ok(mutation.value.value);
    });
    this.mutationChain = operation.then(() => undefined, (cause) => { this.logger.error("TaskQueue", "队列状态提交异常", cause as Error); });
    return operation;
  }

  private captureState(): { tasks: Map<string, TaskRecord>; paused: boolean; nextQueueOrder: number } {
    return { tasks: new Map([...this.tasks].map(([id, task]) => [id, clone(task)])), paused: this.paused, nextQueueOrder: this.nextQueueOrder };
  }

  private restoreState(state: ReturnType<TaskQueue["captureState"]>): void {
    // Active executions hold the task object. Preserve that identity when a
    // different task's write rolls back, or its completion would mutate a
    // detached object and leave the durable queue stuck in Running.
    for (const id of this.tasks.keys()) if (!state.tasks.has(id)) this.tasks.delete(id);
    for (const [id, snapshot] of state.tasks) {
      const current = this.tasks.get(id);
      if (current) {
        for (const key of Object.keys(current)) delete (current as unknown as Record<string, unknown>)[key];
        Object.assign(current, snapshot);
      } else this.tasks.set(id, snapshot);
    }
    this.paused = state.paused; this.nextQueueOrder = state.nextQueueOrder; this.invalidateSnapshot();
  }

  private async persistState(): Promise<Result<void>> {
    if (!this.queueStateStore) return ok(undefined);
    const state: PersistedQueueState = { version: QUEUE_STATE_VERSION, paused: this.paused, nextQueueOrder: this.nextQueueOrder, tasks: [...this.tasks.values()].map((task) => this.toPersistedTask(task)) };
    return this.queueStateStore.save(state);
  }

  private toPersistedTask(task: TaskRecord): PersistedTaskRecord {
    return { id: task.id, workflowId: task.workflowId ?? "", nodeId: task.nodeId, stageId: task.stageId, state: task.state, queueOrder: task.queueOrder ?? 1, noteTitle: task.noteTitle, filePath: task.filePath, conceptType: task.conceptType, createdAt: task.createdAt, updatedAt: task.updatedAt, startedAt: task.startedAt, finishedAt: task.finishedAt, attempt: task.attempt, error: task.error ? clone(task.error) : undefined };
  }

  private nextPendingTask(): TaskRecord | undefined { return [...this.tasks.values()].filter((task) => task.state === "pending").sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0) || a.createdAt - b.createdAt)[0]; }
  private findActiveConflict(candidate: Pick<TaskRecord, "workflowId" | "stageId" | "nodeId">, exceptTaskId?: string): TaskRecord | undefined {
    const identity = queueTaskIdentity(candidate);
    return [...this.tasks.values()].find((task) => {
      if (task.id === exceptTaskId || (task.state !== "pending" && task.state !== "running")) return false;
      const taskIdentity = queueTaskIdentity(task);
      return identity !== undefined && taskIdentity === identity;
    });
  }
  private getOrCreateSnapshot(): QueueSnapshot {
    if (this.snapshot) return this.snapshot;
    const status: QueueStatus = { paused: this.paused, total: this.tasks.size, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 };
    for (const task of this.tasks.values()) {
      if (task.state === "pending") status.pending += 1;
      else if (task.state === "running") status.running += 1;
      else if (task.state === "completed") status.completed += 1;
      else if (task.state === "failed") status.failed += 1;
      else if (task.state === "interrupted") status.interrupted += 1;
      else status.cancelled += 1;
    }
    this.snapshot = { status, tasks: [...this.tasks.values()].sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0) || a.createdAt - b.createdAt) };
    return this.snapshot;
  }

  private invalidateSnapshot(): void { this.snapshot = undefined; }

  private isTerminal(state: TaskRecord["state"]): boolean { return state === "completed" || state === "failed" || state === "cancelled" || state === "interrupted"; }
  private canRetryInBulk(task: TaskRecord): boolean { return task.stageId !== "cards" && task.state === "failed" && !isUncertainTask(task); }
  private uncertainFailure(message: string): TaskError { return { code: "E206_PROVIDER_REQUEST_UNCERTAIN", message, kind: "uncertain", stage: "provider" }; }
  private executionContext(task: TaskRecord): TaskExecutionContext {
    return {
      attemptReason: task.attempt > 1 ? "manual-retry" : "initial",
      modelSnapshot: clone(resolveTaskModelSnapshot(this.settingsStore.getSettings(), getStageRole(task.stageId))),
    };
  }
  private classifyFailure(code: string): TaskFailureStage { if (code === "E310_INVALID_STATE" || code === "E311_NOT_FOUND" || code === "E320_TASK_CONFLICT") return "queue"; if (code.startsWith("E20")) return "provider"; if (code.startsWith("E21")) return "model"; if (code.startsWith("E30")) return "storage"; if (code.startsWith("E40")) return "configuration"; if (code.startsWith("E50")) return "runtime"; return "unknown"; }
  private logStateChange(task: TaskRecord, previousState: string | null, newState: string, level: "info" | "warn" | "error" = "info", extra?: Record<string, unknown>): void { const context = { event: "TASK_STATE_CHANGE", taskId: task.id, previousState, newState, stageId: task.stageId, attempt: task.attempt, ...extra }; if (level === "error") this.logger.error("TaskQueue", `任务状态变更: ${task.id}`, undefined, context); else this.logger[level]("TaskQueue", `任务状态变更: ${task.id}`, context); }
  private publishEvent(event: QueueEvent): void { if (this.disposed) return; this.invalidateSnapshot(); for (const listener of [...this.listeners]) { try { listener(event); } catch (cause) { this.logger.error("TaskQueue", "队列事件监听器执行失败", cause as Error, { eventType: event.type }); } } }
  private generateTaskId(): string { return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
  private normalizeConcurrency(value: number): number { return Number.isInteger(value) && value > 0 ? value : 1; }
}
