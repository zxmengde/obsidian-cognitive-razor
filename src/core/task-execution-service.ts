import type { ILogger, TaskRecord } from "../types";

export interface TaskAborter {
  abort(taskId: string): void;
}

const DISPOSE_GRACE_MS = 1000;

/** Owns execution tokens, active Promise tracking and timeout cleanup. */
export class TaskExecutionService {
  private readonly processingTasks = new Set<string>();
  private readonly activeExecutions = new Set<Promise<void>>();
  private readonly executionTokens = new Map<string, symbol>();
  private readonly dispatchedTokens = new Map<string, symbol>();
  private readonly cancellationRequests = new Set<string>();
  private readonly executionTimeouts = new Map<string, { token: symbol; handle: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly isDisposed: () => boolean,
    private readonly logger: ILogger,
  ) {}

  activeCount(): number {
    return this.processingTasks.size;
  }

  has(taskId: string): boolean {
    return this.executionTokens.has(taskId);
  }

  hasDispatched(taskId: string): boolean {
    return this.dispatchedTokens.has(taskId);
  }

  begin(task: TaskRecord): symbol {
    const token = Symbol(`${task.id}:${task.attempt}`);
    this.executionTokens.set(task.id, token);
    this.processingTasks.add(task.id);
    return token;
  }

  markDispatched(taskId: string, token: symbol): void {
    if (this.executionTokens.get(taskId) === token) this.dispatchedTokens.set(taskId, token);
  }

  requestCancellationBeforeDispatch(taskId: string): void {
    if (this.executionTokens.has(taskId) && !this.dispatchedTokens.has(taskId)) this.cancellationRequests.add(taskId);
  }

  isCancellationRequested(taskId: string): boolean {
    return this.cancellationRequests.has(taskId);
  }

  clearCancellationRequest(taskId: string): void {
    this.cancellationRequests.delete(taskId);
  }

  track(execution: Promise<void>): void {
    this.activeExecutions.add(execution);
    void execution.then(
      () => this.activeExecutions.delete(execution),
      () => this.activeExecutions.delete(execution),
    );
  }

  isCurrent(task: TaskRecord, token: symbol): boolean {
    return !this.isDisposed() && task.state === "running" && this.executionTokens.get(task.id) === token;
  }

  setTimeout(taskId: string, token: symbol, handle: ReturnType<typeof setTimeout>): void {
    this.executionTimeouts.set(taskId, { token, handle });
  }

  clearTimeout(taskId: string, token?: symbol): void {
    const entry = this.executionTimeouts.get(taskId);
    if (!entry || (token && entry.token !== token)) return;
    globalThis.clearTimeout(entry.handle);
    this.executionTimeouts.delete(taskId);
  }

  release(taskId: string, token?: symbol): void {
    if (token && this.executionTokens.get(taskId) !== token) return;
    this.executionTokens.delete(taskId);
    this.dispatchedTokens.delete(taskId);
    this.cancellationRequests.delete(taskId);
    this.clearTimeout(taskId, token);
    this.processingTasks.delete(taskId);
  }

  abortActive(aborter: TaskAborter | undefined): void {
    for (const taskId of this.processingTasks) {
      try {
        aborter?.abort(taskId);
      } catch (cause) {
        this.logger.warn("TaskExecutionService", "卸载时中断任务失败", { taskId, cause: String(cause) });
      }
    }
  }

  async waitForSettled(): Promise<void> {
    const active = [...this.activeExecutions];
    if (!active.length) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      Promise.allSettled(active).then(() => false),
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(true), DISPOSE_GRACE_MS); }),
    ]);
    if (timeout) globalThis.clearTimeout(timeout);
    if (timedOut) this.logger.warn("TaskExecutionService", "部分任务未在取消宽限期内结束", { activeCount: active.length });
  }

  clear(): void {
    for (const { handle } of this.executionTimeouts.values()) globalThis.clearTimeout(handle);
    this.executionTimeouts.clear();
    this.executionTokens.clear();
    this.dispatchedTokens.clear();
    this.cancellationRequests.clear();
    this.processingTasks.clear();
    this.activeExecutions.clear();
  }
}
