import type {
  ILogger,
  NewTaskRecord,
  PersistedTaskRecord,
  Result,
  QueueTaskPayload,
  ConfirmedConcept,
  ConversationContinuation,
  TaskRecord,
  TaskStageId,
  TaskExecutionContext,
  WorkflowArtifact,
} from "../types";
import { err, ok, toErr } from "../types";
import { isConfirmedConcept } from "../domain/concept";
import type { SettingsStore } from "../data/settings-store";
import type { WorkflowStore } from "../data/workflow-store";
import type { TaskPayloadResolver, TaskQueueHooks, TaskQueueWorkflowPort, TaskCompletionCommit } from "./task-queue";
import type { TaskQueue } from "./task-queue";
import type { NoteRepository } from "./note-repository";
import type { ContentRenderer } from "./content-renderer";
import { generateFrontmatter, generateMarkdownContent, extractFrontmatter } from "./frontmatter-utils";
import { formatStandardName, generateFilePath } from "./naming-utils";
import { generateUUID } from "../data/validator";
import { getWriteStageIds, isWriteStage } from "./stage-catalog";
import { PROMPT_VERSION, canReplayConversation, buildPromptCacheKey } from "./task-execution-support";
import { formatCRTimestamp } from "../utils/date-utils";
import { makeVerificationReportBlock } from "./verification-report";
import { readResponsesReplayOutput, readResponsesOutputHistory } from "../utils/responses-replay";
import { cloneJson } from "../utils/clone";
const clone = cloneJson;

export interface WorkflowCoordinatorDeps {
  workflowStore: WorkflowStore;
  taskQueue: TaskQueue;
  noteRepository: NoteRepository;
  contentRenderer: ContentRenderer;
  settingsStore: SettingsStore;
  logger: ILogger;
  indexNote?: (cruid: string) => Promise<Result<{ indexed: number; failed: number }>>;
  onIndexingFailed?: (noteTitle: string) => void | Promise<void>;
  failurePoint?: (point: WorkflowCommitFailurePoint, context: WorkflowCommitFailureContext) => void | Promise<void>;
}

export interface WorkflowCreateOptions {
  targetPathOverride?: string;
}

export type WorkflowCommitFailurePoint =
  | "pending-checkpoint"
  | "vault-commit-confirmed"
  | "applied-checkpoint"
  | "follow-up-intent";

export interface WorkflowCommitFailureContext {
  workflowId: string;
  stageId: TaskStageId;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function restoreConfirmedConcept(artifact: WorkflowArtifact): ConfirmedConcept | undefined {
  if (!artifact.concept) return undefined;
  return {
    type: artifact.type,
    name: clone(artifact.concept.name),
    coreDefinition: artifact.concept.coreDefinition,
    // Source is a confirmation-time concern. It does not affect queued model
    // work, so it is intentionally not duplicated in the durable snapshot.
    source: "define",
    parents: [...artifact.parents],
  };
}

/** Single source of truth for the continuation snapshot handed to queued stages. */
function buildConversationSnapshot(artifact: WorkflowArtifact): ConversationContinuation | undefined {
  const conversation = artifact.conversation;
  if (!conversation) return undefined;
  return {
    previousResponseId: conversation.responseId,
    providerId: conversation.providerId,
    model: conversation.model,
    apiFormat: conversation.apiFormat,
    endpoint: conversation.endpoint,
    promptVersion: conversation.promptVersion,
    promptCacheKey: conversation.promptCacheKey,
    promptCacheMode: conversation.promptCacheMode,
    responseContinuationEnabled: conversation.responseContinuationEnabled,
    promptCachingEnabled: conversation.promptCachingEnabled,
    systemPrompt: conversation.systemPrompt,
    sources: artifact.sources,
    history: conversation.history,
    responsesOutputHistory: conversation.responsesOutputHistory,
  };
}

/**
 * Durable workflow owner. Queue records contain only scheduling metadata;
 * this class owns the validated inputs/results and the vault commit order.
 */
export class WorkflowCoordinator {
  private disposed = false;
  private readonly startingPaths = new Set<string>();

  constructor(private readonly deps: WorkflowCoordinatorDeps) {}

  get payloadResolver(): TaskPayloadResolver {
    return { resolve: (task) => this.resolvePayload(task) };
  }

  get hooks(): TaskQueueHooks {
    return {
      canResumeWithoutRequest: (task) => {
        const artifact = task.workflowId ? this.deps.workflowStore.get(task.workflowId) : undefined;
        return artifact?.pendingStageResult?.stageId === task.stageId
          || artifact?.appliedStageIds.includes(task.stageId) === true;
      },
      afterComplete: (task) => this.cleanupCompletedWorkflow(task),
      resolveCachedResult: (task) => this.resolveCachedResult(task),
      resolveAppliedCompletion: (task) => this.resolveAppliedCompletion(task),
      beforeComplete: (task, result, context) => this.commitCompletedStage(task, result, context),
      beforeFail: (task, error) => this.markFailed(task, error),
      beforeCancel: (task) => this.markCancelled(task),
      beforeRetry: (task) => this.markRetry(task),
      afterRemove: (task) => this.removeAfterQueueDeletion(task),
    };
  }

  get queuePort(): TaskQueueWorkflowPort {
    return { resolve: (task) => this.resolvePayload(task), ...this.hooks };
  }

  async startCreate(
    concept: ConfirmedConcept,
    options: WorkflowCreateOptions = {},
  ): Promise<Result<string>> {
    if (!isConfirmedConcept(concept)) return err("E101_INVALID_INPUT", "创建必须使用已确认概念");
    const target = this.resolveTarget(concept, options.targetPathOverride);
    if (!target.ok) return target as Result<string>;
    return this.withPathReservation(target.value.targetPath, () => this.startCreateReserved(concept, target.value));
  }

  private async startCreateReserved(
    concept: ConfirmedConcept,
    target: { targetPath: string; targetName: string },
  ): Promise<Result<string>> {
    if (this.disposed) return err("E310_INVALID_STATE", "工作流服务已停止");
    if (this.deps.taskQueue.isPathActive(target.targetPath) || this.hasActiveArtifact(target.targetPath)) {
      return err("E320_TASK_CONFLICT", "该笔记已在队列中，请先处理现有任务");
    }

    const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const nodeId = generateUUID();
    const settings = this.deps.settingsStore.getSettings();

    const artifact: WorkflowArtifact = {
      version: "7.0.0",
      workflowId,
      kind: "create",
      state: "active",
      nodeId,
      type: concept.type,
      filePath: target.targetPath,
      noteTitle: target.targetName,
      parents: [...concept.parents],
      directoryScheme: clone(settings.directoryScheme),
      concept: {
        name: clone(concept.name),
        coreDefinition: concept.coreDefinition,
      },
      autoVerify: settings.enableAutoVerify,
      accumulated: {},
      noteCreated: false,
      appliedStageIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const draft = this.buildDraft(artifact);
    artifact.contentSnapshot = draft;
    const created = await this.deps.workflowStore.create(artifact);
    if (!created.ok) return created as Result<string>;
    try {
      const draftStatus = await this.deps.noteRepository.ensureCreate(artifact.filePath, draft);
      // The path was checked before the artifact was created. If another
      // process/user created it in between, never attach our workflow to an
      // unowned note or overwrite it in a later Write phase.
      if (draftStatus === "existing") {
        await this.deps.workflowStore.remove(workflowId);
        return err("E320_TASK_CONFLICT", `已存在同路径笔记：${artifact.filePath}`);
      }
      const noted = await this.deps.workflowStore.update(workflowId, { noteCreated: true, contentSnapshot: draft });
      if (!noted.ok) return noted as Result<string>;
      const enqueued = await this.enqueueStage(noted.value, "tag");
      if (!enqueued.ok) {
        await this.deps.workflowStore.update(workflowId, { state: "failed", error: enqueued.error });
        return enqueued as Result<string>;
      }
      return ok(workflowId);
    } catch (cause) {
      const failure = toErr(cause, "E302_PERMISSION_DENIED", "创建 Draft 笔记失败");
      await this.deps.workflowStore.update(workflowId, { state: "failed", error: failure.error });
      return failure as Result<string>;
    }
  }

  async startVerify(filePath: string): Promise<Result<string>> {
    return this.withPathReservation(filePath, () => this.startVerifyReserved(filePath));
  }

  private async withPathReservation(filePath: string, start: () => Promise<Result<string>>): Promise<Result<string>> {
    const key = filePath.toLocaleLowerCase();
    if (this.startingPaths.has(key)) return err("E320_TASK_CONFLICT", "该笔记正在提交，请勿重复操作");
    this.startingPaths.add(key);
    try { return await start(); } finally { this.startingPaths.delete(key); }
  }

  private async startVerifyReserved(filePath: string): Promise<Result<string>> {
    if (this.disposed) return err("E310_INVALID_STATE", "工作流服务已停止");
    if (this.deps.taskQueue.isPathActive(filePath) || this.hasActiveArtifact(filePath)) {
      return err("E320_TASK_CONFLICT", "该笔记已在队列中，请先处理现有任务");
    }
    const file = this.deps.noteRepository.getFileByPath(filePath);
    if (!file) return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`);
    try {
      const content = await this.deps.noteRepository.readByPath(filePath);
      const extracted = extractFrontmatter(content);
      if (!extracted) return err("E101_INVALID_INPUT", "当前笔记不是有效的 Cognitive Razor 笔记");
      const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const artifact: WorkflowArtifact = {
        version: "7.0.0",
        workflowId,
        kind: "verify",
        state: "active",
        nodeId: extracted.frontmatter.cruid,
        type: extracted.frontmatter.type,
        filePath,
        noteTitle: extracted.frontmatter.name,
        parents: extracted.frontmatter.parents,
        autoVerify: false,
        accumulated: {},
        contentSnapshot: content,
        noteCreated: true,
        appliedStageIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const created = await this.deps.workflowStore.create(artifact);
      if (!created.ok) return created as Result<string>;
      const enqueued = await this.enqueueStage(artifact, "verify");
      if (!enqueued.ok) {
        await this.deps.workflowStore.update(workflowId, { state: "failed", error: enqueued.error });
        return enqueued as Result<string>;
      }
      return ok(workflowId);
    } catch (cause) {
      return toErr(cause, "E500_INTERNAL_ERROR", "启动 Verify 失败") as Result<string>;
    }
  }

  async initializeAndRecover(): Promise<Result<void>> {
    if (this.disposed) return err("E310_INVALID_STATE", "工作流服务已停止");
    for (const artifact of this.deps.workflowStore.list()) {
      if (this.deps.taskQueue.hasUnknownWorkflowTask(artifact.workflowId)) {
        this.deps.logger.warn("WorkflowCoordinator", "工作流包含未知阶段，已保留记录并停止自动恢复", { workflowId: artifact.workflowId });
        continue;
      }
      if (artifact.state === "completed") {
        // A queue write may have failed after the last Vault checkpoint.
        // Keep the completion receipt until its queue record is committed.
        if (this.deps.taskQueue.getSnapshot().tasks.some((task) => task.workflowId === artifact.workflowId
          && task.state !== "completed" && task.state !== "cancelled")) continue;
        const removed = await this.deps.workflowStore.remove(artifact.workflowId);
        if (!removed.ok) this.deps.logger.warn("WorkflowCoordinator", "清理已完成工作流 artifact 失败，将在下次重载继续尝试", {
          workflowId: artifact.workflowId,
          error: removed.error,
        });
        continue;
      }
      if (artifact.state !== "active") continue;
      if (artifact.kind === "create" && !artifact.noteCreated) {
        try {
          const draft = artifact.contentSnapshot ?? this.buildDraft(artifact);
          const draftStatus = await this.deps.noteRepository.ensureCreate(artifact.filePath, draft);
          if (draftStatus === "existing") {
            const current = await this.deps.noteRepository.readByPath(artifact.filePath);
            if (current !== draft) {
              await this.recordSnapshotConflict(artifact, "tag");
              await this.deps.workflowStore.update(artifact.workflowId, {
                state: "failed",
                error: { code: "E321_NOTE_SNAPSHOT_CHANGED", message: "Draft 笔记已被修改，未覆盖用户内容" },
              });
              continue;
            }
          }
          await this.deps.workflowStore.update(artifact.workflowId, { noteCreated: true, contentSnapshot: draft });
        } catch (cause) {
          await this.deps.workflowStore.update(artifact.workflowId, { state: "failed", error: toErr(cause, "E302_PERMISSION_DENIED", "恢复 Draft 失败").error });
          continue;
        }
      }
      const workflowTasks = this.deps.taskQueue.getSnapshot().tasks.filter((task) => task.workflowId === artifact.workflowId);
      // A failed/cancelled record is a deliberate user-visible stop. Do not
      // silently enqueue a second provider call during startup recovery.
      if (workflowTasks.some((task) => task.state === "pending" || task.state === "running" || task.state === "failed" || task.state === "cancelled" || task.state === "interrupted")) continue;
      const next = this.nextStage(artifact);
      if (next) {
        const result = await this.enqueueStage(artifact, next);
        if (!result.ok) await this.deps.workflowStore.update(artifact.workflowId, { state: "failed", error: result.error });
      } else await this.deps.workflowStore.update(artifact.workflowId, { state: "completed" });
    }
    return ok(undefined);
  }

  isPathActive(filePath: string): boolean {
    return this.deps.taskQueue.isPathActive(filePath) || this.hasActiveArtifact(filePath);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  private async resolvePayload(task: PersistedTaskRecord): Promise<Result<QueueTaskPayload>> {
    const artifact = this.deps.workflowStore.get(task.workflowId);
    if (!artifact) return err("E311_NOT_FOUND", "工作流恢复数据不存在");
    const concept = restoreConfirmedConcept(artifact);
    const stage = task.stageId;
    if (stage === "tag") {
      if (!concept) return err("E310_INVALID_STATE", "工作流缺少概念快照");
      return ok({ concept });
    }
    if (isWriteStage(stage)) {
      if (!concept) return err("E310_INVALID_STATE", "工作流缺少概念快照");
      return ok({
        concept,
        accumulated: clone(artifact.accumulated),
        conversation: buildConversationSnapshot(artifact),
      });
    }
    if (stage === "verify") {
      if (!artifact.contentSnapshot) return err("E310_INVALID_STATE", "Verify 工作流缺少内容快照");
      return ok({
        filePath: artifact.filePath,
        currentContent: artifact.contentSnapshot,
        noteType: artifact.type,
        conversation: buildConversationSnapshot(artifact),
      });
    }
    return err("E310_INVALID_STATE", `未知工作流阶段: ${stage}`);
  }

  private async resolveCachedResult(task: TaskRecord): Promise<Result<Record<string, unknown>> | undefined> {
    if (!task.workflowId) return undefined;
    const artifact = this.deps.workflowStore.get(task.workflowId);
    if (!artifact) return undefined;
    const stage = task.stageId;
    const cached = artifact.pendingStageResult?.stageId === stage
      ? artifact.pendingStageResult.result
      : undefined;
    // The queue can remain Running after the artifact commit and before its
    // own state file is flushed. Reusing the validated result here makes that
    // crash boundary idempotent and avoids charging the provider twice.
    return cached ? ok(clone(cached)) : undefined;
  }

  /**
   * The artifact checkpoint may complete before the queue state is flushed.
   * `appliedStageIds` is enough to finish that stale queue record without
   * retaining every historic model result in the artifact.
   */
  private async resolveAppliedCompletion(task: TaskRecord): Promise<Result<TaskCompletionCommit | undefined>> {
    if (!task.workflowId) return ok(undefined);
    const artifact = this.deps.workflowStore.get(task.workflowId);
    if (!artifact) return ok(undefined);
    const stage = task.stageId;
    if (artifact.pendingStageResult || !artifact.appliedStageIds.includes(stage)) return ok(undefined);
    return this.continueAfterAppliedStage(artifact, stage);
  }

  private async commitCompletedStage(task: TaskRecord, result: Record<string, unknown>, context: TaskExecutionContext): Promise<Result<TaskCompletionCommit>> {
    if (this.disposed) return err("E310_INVALID_STATE", "工作流服务已停止");
    const workflowId = task.workflowId;
    if (!workflowId) return ok({});
    const current = this.deps.workflowStore.get(workflowId);
    if (!current) return err("E311_NOT_FOUND", "工作流恢复数据不存在");
    const stage = task.stageId;
    const pending = current.pendingStageResult;
    if (pending && pending.stageId !== stage) {
      return err("E310_INVALID_STATE", `工作流已有待提交阶段: ${pending.stageId}`);
    }
    if (!pending && current.appliedStageIds.includes(stage)) {
      return ok({ followUp: this.nextTaskIntent(current, this.nextStage(current)) });
    }
    const staged = pending
      ? ok(current)
      : await this.persistPendingStageResult(current, stage, result, context);
    if (!staged.ok) return staged as Result<TaskCompletionCommit>;
    if (!pending) await this.injectFailurePoint("pending-checkpoint", current.workflowId, stage);
    return this.applyPendingStageResult(task, staged.value, stage);
  }

  /** Explicitly abandons workflow state; it never deletes or rewrites a Vault note. */
  async discardWorkflow(workflowId: string): Promise<Result<void>> {
    if (this.disposed) return err("E310_INVALID_STATE", "工作流服务已停止");
    const artifact = this.deps.workflowStore.get(workflowId);
    if (!artifact) return err("E311_NOT_FOUND", "工作流不存在");
    if (this.deps.taskQueue.getActiveWorkflowIds().has(workflowId)) {
      return err("E320_TASK_CONFLICT", "工作流仍有等待中或运行中的任务，请先取消任务");
    }
    return this.deps.workflowStore.remove(workflowId);
  }

  private async persistPendingStageResult(
    artifact: WorkflowArtifact,
    stage: TaskStageId,
    result: Record<string, unknown>,
    context: TaskExecutionContext,
  ): Promise<Result<WorkflowArtifact>> {
    const stageResult = clone(result);
    if (stage === "verify" && typeof stageResult.reportBlock !== "string") {
      stageResult.reportBlock = makeVerificationReportBlock(typeof stageResult.reportText === "string" ? stageResult.reportText : "", Date.now(), this.deps.settingsStore.getSettings().verifyReportPresentation);
    }
    const patch: Record<string, unknown> = {
      pendingStageResult: {
        stageId: stage,
        commitId: `${artifact.workflowId}:${stage}`,
        // Recorded once, before the Vault write: replay renders the same bytes.
        committedAt: Date.now(),
        result: isWriteStage(stage) && isRecord(stageResult.phaseResult)
          ? {
            phaseResult: clone(stageResult.phaseResult),
            ...(typeof stageResult.responseId === "string" ? { responseId: stageResult.responseId } : {}),
            ...(isRecord(stageResult.sourcePackage) ? { sourcePackage: clone(stageResult.sourcePackage) } : {}),
            ...(stageResult.conversationInvalidated === true ? { conversationInvalidated: true } : {}),
          }
          : stageResult,
      },
    };
    if ((isWriteStage(stage) || stage === "verify") && stageResult.conversationInvalidated !== true
      && (typeof stageResult.responseId === "string" || typeof stageResult.promptUser === "string")) {
      const modelSnapshot = context.modelSnapshot;
      const prior = canReplayConversation(buildConversationSnapshot(artifact), modelSnapshot) ? artifact.conversation : undefined;
      patch.conversation = {
        providerId: modelSnapshot.providerId,
        model: modelSnapshot.model,
        apiFormat: modelSnapshot.providerSnapshot?.apiFormat,
        endpoint: `${modelSnapshot.providerSnapshot?.apiFormat ?? ""}|${(modelSnapshot.providerSnapshot?.baseUrl ?? "").replace(/\/+$/, "")}`,
        promptVersion: PROMPT_VERSION,
        promptCacheKey: prior?.promptCacheKey || buildPromptCacheKey(
          modelSnapshot.providerId,
          modelSnapshot.model,
          modelSnapshot.providerSnapshot?.apiFormat,
          modelSnapshot.providerSnapshot?.baseUrl,
        ),
        promptCacheMode: modelSnapshot.capabilities?.promptCacheMode ?? "implicit",
        responseContinuationEnabled: modelSnapshot.capabilities?.responseContinuation === true,
        promptCachingEnabled: modelSnapshot.capabilities?.promptCaching === true,
        systemPrompt: typeof stageResult.systemPrompt === "string"
          ? stageResult.systemPrompt
          : prior?.systemPrompt,
        ...(typeof stageResult.responseId === "string" ? { responseId: stageResult.responseId } : {}),
        history: [
          ...(prior?.history ?? []),
          ...(typeof stageResult.promptUser === "string" ? [{ role: "user" as const, content: stageResult.promptUser }] : []),
          ...(typeof stageResult.responseContent === "string" ? [{ role: "assistant" as const, content: stageResult.responseContent }] : []),
        ],
      };
      // Native state is an optional successful-stage continuation. If any old
      // turn is text-only, incompatible, oversized or unrecognized, retain the
      // complete text history instead of inventing a partial native sequence.
      const conversation = patch.conversation as NonNullable<WorkflowArtifact["conversation"]>;
      const currentOutput = modelSnapshot.providerSnapshot?.apiFormat === "openai-responses"
        ? readResponsesReplayOutput(stageResult.responsesOutput) : undefined;
      const priorOutputs = prior?.history?.length ? readResponsesOutputHistory(prior.responsesOutputHistory, prior.history) : [];
      if (currentOutput && priorOutputs) {
        conversation.responsesOutputHistory = readResponsesOutputHistory([...priorOutputs, currentOutput], conversation.history);
      }
      if (isRecord(stageResult.sourcePackage)) patch.sources = stageResult.sourcePackage;
    } else if (stageResult.conversationInvalidated === true) {
      patch.conversation = undefined;
    }
    // Citations are useful even when the provider does not expose a response
    // id (for example, Chat Completions or a relay). Persist them independently
    // of continuation metadata so Verify/Write evidence is not discarded.
    if (isRecord(stageResult.sourcePackage)) patch.sources = stageResult.sourcePackage;
    if (stage === "tag") {
      patch.tagResult = {
        aliases: Array.isArray(result.aliases) ? result.aliases.map(String) : [],
        tags: Array.isArray(result.tags) ? result.tags.map(String) : [],
      };
    } else if (isWriteStage(stage)) {
      const phaseResult = isRecord(result.phaseResult) ? result.phaseResult : result;
      patch.accumulated = isRecord(result.accumulated)
        ? result.accumulated
        : { ...artifact.accumulated, ...phaseResult };
    }
    return this.deps.workflowStore.update(artifact.workflowId, patch);
  }

  private async applyPendingStageResult(
    task: TaskRecord,
    artifact: WorkflowArtifact,
    stage: TaskStageId,
  ): Promise<Result<TaskCompletionCommit>> {
    const pending = artifact.pendingStageResult;
    if (!pending || pending.stageId !== stage) {
      return err("E310_INVALID_STATE", `工作流缺少待提交阶段: ${stage}`);
    }
    const result = pending.result;
    const updatedAt = pending.committedAt !== undefined
      ? formatCRTimestamp(new Date(pending.committedAt))
      : undefined;
    if (stage === "tag") {
      const tagResult = artifact.tagResult ?? {
        aliases: Array.isArray(result.aliases) ? result.aliases.map(String) : [],
        tags: Array.isArray(result.tags) ? result.tags.map(String) : [],
      };
      const status = await this.deps.noteRepository.updateFrontmatterIfUnchanged(
        artifact.filePath,
        artifact.contentSnapshot ?? "",
        updatedAt ? { ...tagResult, updated: updatedAt } : tagResult,
      );
      if (status === "missing") return err("E301_FILE_NOT_FOUND", `文件不存在: ${artifact.filePath}`);
      if (status === "invalid") return err("E101_INVALID_INPUT", "Draft 笔记缺少有效 frontmatter");
      if (status === "changed") {
        await this.recordSnapshotConflict(artifact, stage, task);
        return err("E321_NOTE_SNAPSHOT_CHANGED", "Draft 笔记已被修改，未覆盖用户内容");
      }
      await this.injectFailurePoint("vault-commit-confirmed", artifact.workflowId, stage);
      return this.markAppliedAndFollowUp(artifact, stage, { contentSnapshot: status.content });
    }
    if (isWriteStage(stage)) {
      const content = this.renderCreateNote(artifact, updatedAt);
      const status = await this.deps.noteRepository.replaceIfUnchanged(
        artifact.filePath,
        artifact.contentSnapshot ?? "",
        content,
      );
      if (status === "missing") return err("E301_FILE_NOT_FOUND", `文件不存在: ${artifact.filePath}`);
      if (status === "changed") {
        await this.recordSnapshotConflict(artifact, stage, task);
        return err("E321_NOTE_SNAPSHOT_CHANGED", "Draft 笔记已被修改，未覆盖用户内容");
      }
      await this.injectFailurePoint("vault-commit-confirmed", artifact.workflowId, stage);
      return this.markAppliedAndFollowUp(artifact, stage, { noteCreated: true, contentSnapshot: content });
    }
    if (stage === "verify") {
      const report = typeof result.reportText === "string" ? result.reportText : "";
      const applied = await this.deps.noteRepository.replaceVerificationReport(
        artifact.filePath,
        artifact.contentSnapshot ?? "",
        typeof result.reportBlock === "string" ? result.reportBlock : makeVerificationReportBlock(report, artifact.createdAt),
        undefined,
        updatedAt,
      );
      if (applied === "missing") return err("E301_FILE_NOT_FOUND", `文件不存在: ${artifact.filePath}`);
      if (applied === "changed") {
        await this.recordSnapshotConflict(artifact, stage, task);
        return err("E321_NOTE_SNAPSHOT_CHANGED", "核查期间笔记已修改，未覆盖用户内容");
      }
      await this.injectFailurePoint("vault-commit-confirmed", artifact.workflowId, stage);
      return this.markAppliedAndFollowUp(artifact, stage);
    }
    return err("E310_INVALID_STATE", `未知工作流阶段: ${stage}`);
  }

  private async markAppliedAndFollowUp(
    artifact: WorkflowArtifact,
    stage: TaskStageId,
    patch: Record<string, unknown> = {},
  ): Promise<Result<TaskCompletionCommit>> {
    const applied = unique([...artifact.appliedStageIds, stage]);
    const nextArtifactResult = await this.deps.workflowStore.update(artifact.workflowId, {
      ...patch,
      appliedStageIds: applied,
      pendingStageResult: undefined,
    });
    if (!nextArtifactResult.ok) return nextArtifactResult as Result<TaskCompletionCommit>;
    await this.injectFailurePoint("applied-checkpoint", artifact.workflowId, stage);
    return this.continueAfterAppliedStage(nextArtifactResult.value, stage);
  }

  private async continueAfterAppliedStage(
    artifact: WorkflowArtifact,
    stage: TaskStageId,
  ): Promise<Result<TaskCompletionCommit>> {
    // A completed receipt may outlive the queue commit. Replaying it must not
    // resend an already attempted (possibly billable) indexing request.
    if (artifact.state === "completed") return ok({});
    // Retry admission is owned by the durable queue. Only an applied result
    // can reactivate this artifact, so a failed queue write cannot resurrect
    // a deleted failed task on startup.
    if (artifact.state !== "active") {
      const activated = await this.deps.workflowStore.update(artifact.workflowId, { state: "active", error: undefined });
      if (!activated.ok) return activated as Result<TaskCompletionCommit>;
      artifact = activated.value;
    }
    const next = this.nextStage(artifact, false);
    if (next) {
      await this.injectFailurePoint("follow-up-intent", artifact.workflowId, stage);
      return ok({ followUp: this.nextTaskIntent(artifact, next) });
    }
    if (artifact.kind === "create" && artifact.autoVerify && !artifact.appliedStageIds.includes("verify")) {
      await this.injectFailurePoint("follow-up-intent", artifact.workflowId, stage);
      return ok({ followUp: this.nextTaskIntent(artifact, "verify") });
    }
    const completed = await this.deps.workflowStore.update(artifact.workflowId, { state: "completed" });
    if (!completed.ok) return completed as Result<TaskCompletionCommit>;
    if (completed.value.kind === "create" && this.deps.settingsStore.getSettings().enableSemanticIndexing && this.deps.indexNote) {
      await this.indexCompletedNote(completed.value);
    }
    return ok({});
  }

  private async indexCompletedNote(artifact: WorkflowArtifact): Promise<void> {
    if (this.disposed || !this.deps.indexNote) return;
    let failure: unknown;
    try {
      const indexed = await this.deps.indexNote(artifact.nodeId);
      if (indexed.ok && indexed.value.failed === 0) return;
      failure = indexed.ok ? indexed.value : indexed.error;
    } catch (cause) {
      failure = cause;
    }
    if (this.disposed) return;
    this.deps.logger.warn("WorkflowCoordinator", "笔记已完成，但自动向量化未完成；可在设置页扫描缺失向量", {
      workflowId: artifact.workflowId,
      error: failure,
    });
    try {
      await this.deps.onIndexingFailed?.(artifact.noteTitle);
    } catch (cause) {
      // Feedback must never turn a successfully generated note into a failed
      // workflow, or cause a completed receipt to repeat an indexing charge.
      this.deps.logger.warn("WorkflowCoordinator", "自动向量化失败通知未能显示", {
        workflowId: artifact.workflowId,
        error: cause,
      });
    }
  }

  private async cleanupCompletedWorkflow(task: TaskRecord): Promise<void> {
    if (!task.workflowId) return;
    const artifact = this.deps.workflowStore.get(task.workflowId);
    if (!artifact || artifact.state !== "completed") return;
    const removed = await this.deps.workflowStore.remove(artifact.workflowId);
    if (!removed.ok) this.deps.logger.warn("WorkflowCoordinator", "工作流已完成，恢复记录将在下次重载清理", { workflowId: artifact.workflowId, error: removed.error });
  }

  private async injectFailurePoint(
    point: WorkflowCommitFailurePoint,
    workflowId: string,
    stageId: TaskStageId,
  ): Promise<void> {
    await this.deps.failurePoint?.(point, { workflowId, stageId });
  }

  private nextStage(artifact: WorkflowArtifact, includeVerify = true): TaskStageId | undefined {
    // A durable pending commit always wins over the current settings or
    // applied-stage projection. Dropping it on restart could lose a result
    // that was already validated without another model request.
    if (artifact.pendingStageResult) return artifact.pendingStageResult.stageId;
    const isApplied = (stage: TaskStageId): boolean => artifact.appliedStageIds.includes(stage);
    if (artifact.kind === "verify") return isApplied("verify") ? undefined : "verify";
    if (!isApplied("tag")) return "tag";
    for (const stage of getWriteStageIds(artifact.type)) {
      if (!isApplied(stage)) return stage;
    }
    if (includeVerify && artifact.autoVerify && !isApplied("verify")) return "verify";
    return undefined;
  }

  private nextTaskIntent(artifact: WorkflowArtifact, stage: TaskStageId | undefined): NewTaskRecord | undefined {
    if (!stage) return undefined;
    const concept = restoreConfirmedConcept(artifact);
    if (stage === "tag") return concept ? { nodeId: artifact.nodeId, workflowId: artifact.workflowId, stageId: stage, noteTitle: artifact.noteTitle, filePath: artifact.filePath, payload: { concept } } : undefined;
    const conversation = buildConversationSnapshot(artifact);
    if (isWriteStage(stage)) return concept ? { nodeId: artifact.nodeId, workflowId: artifact.workflowId, stageId: stage, noteTitle: artifact.noteTitle, filePath: artifact.filePath, payload: { concept, accumulated: clone(artifact.accumulated), conversation } } : undefined;
    return { nodeId: artifact.nodeId, workflowId: artifact.workflowId, stageId: "verify", noteTitle: artifact.noteTitle, filePath: artifact.filePath, payload: { filePath: artifact.filePath, currentContent: artifact.contentSnapshot ?? "", noteType: artifact.type, conversation } };
  }

  private async enqueueStage(artifact: WorkflowArtifact, stage: TaskStageId): Promise<Result<void>> {
    const intent = this.nextTaskIntent(artifact, stage);
    if (!intent) return err("E310_INVALID_STATE", "无法构造后续工作流阶段");
    const enqueued = await this.deps.taskQueue.enqueueDurably(intent);
    return enqueued.ok ? ok(undefined) : enqueued as Result<void>;
  }

  private async markFailed(task: TaskRecord, error: { code: string; message: string }): Promise<void> {
    if (this.disposed) return;
    if (task.workflowId) {
      const saved = await this.deps.workflowStore.update(task.workflowId, { state: "failed", error });
      if (!saved.ok) throw new Error(saved.error.message);
    }
  }

  private async markCancelled(task: TaskRecord): Promise<void> {
    if (this.disposed) return;
    if (task.workflowId) {
      const saved = await this.deps.workflowStore.update(task.workflowId, { state: "cancelled" });
      if (!saved.ok) throw new Error(saved.error.message);
    }
  }

  private async markRetry(task: TaskRecord): Promise<void> {
    if (this.disposed) return;
    if (task.workflowId && !this.deps.workflowStore.get(task.workflowId)) throw new Error("工作流重试快照不存在");
  }

  private async removeAfterQueueDeletion(task: TaskRecord): Promise<void> {
    if (!task.workflowId) return;
    const artifact = this.deps.workflowStore.get(task.workflowId);
    if (!artifact || artifact.state === "active") return;
    await this.deps.workflowStore.remove(task.workflowId);
  }

  private async recordSnapshotConflict(
    artifact: WorkflowArtifact,
    stage: TaskStageId,
    task?: Pick<TaskRecord, "id" | "attempt">,
  ): Promise<void> {
    this.deps.logger.warn("WorkflowCoordinator", "检测到 Vault 快照冲突，未覆盖用户内容", {
      workflowId: artifact.workflowId, stageId: stage, taskId: task?.id, attempt: task?.attempt,
    });
  }

  private buildDraft(artifact: WorkflowArtifact): string {
    const frontmatter = generateFrontmatter({ cruid: artifact.nodeId, type: artifact.type, name: artifact.noteTitle, parents: artifact.parents, status: "seed" });
    return generateMarkdownContent(frontmatter, "");
  }

  private renderCreateNote(artifact: WorkflowArtifact, updatedAt?: string): string {
    if (!artifact.concept) throw new Error("工作流缺少概念快照");
    // The current validated Write is still pending its atomic Vault commit.
    // Only that final commit may advance the note beyond seed.
    const pendingStage = artifact.pendingStageResult?.stageId;
    const status = getWriteStageIds(artifact.type).every(stage => artifact.appliedStageIds.includes(stage) || stage === pendingStage)
      ? "draft" as const : "seed" as const;
    const body = this.deps.contentRenderer.renderNoteMarkdown({ title: artifact.noteTitle, type: artifact.type, content: artifact.accumulated, language: "zh", directoryScheme: artifact.directoryScheme });
    const snapshotFrontmatter = artifact.contentSnapshot ? extractFrontmatter(artifact.contentSnapshot)?.frontmatter : undefined;
    const baseFrontmatter = snapshotFrontmatter
      ? {
        ...snapshotFrontmatter,
        status,
        aliases: artifact.tagResult?.aliases ?? snapshotFrontmatter.aliases,
        tags: artifact.tagResult?.tags ?? snapshotFrontmatter.tags,
      }
      : generateFrontmatter({ cruid: artifact.nodeId, type: artifact.type, name: artifact.noteTitle, parents: artifact.parents, status, aliases: artifact.tagResult?.aliases, tags: artifact.tagResult?.tags });
    const frontmatter = updatedAt ? { ...baseFrontmatter, updated: updatedAt } : baseFrontmatter;
    return generateMarkdownContent(frontmatter, body, artifact.contentSnapshot);
  }

  private resolveTarget(concept: ConfirmedConcept, override?: string): Result<{ targetPath: string; targetName: string }> {
    const settings = this.deps.settingsStore.getSettings();
    const standardName = formatStandardName(concept.name);
    if (!standardName.trim() && !override?.trim()) {
      return err("E101_INVALID_INPUT", "已确认概念缺少名称");
    }
    const targetPath = override?.trim() ? (override.endsWith(".md") ? override : `${override}.md`) : generateFilePath(standardName, settings.directoryScheme, concept.type);
    const targetName = (targetPath.split("/").pop() ?? standardName).replace(/\.md$/i, "") || standardName;
    if (this.deps.noteRepository.getFileByPath(targetPath) || this.hasActiveArtifact(targetPath)) return err("E320_TASK_CONFLICT", `已存在或正在创建同路径笔记：${targetPath}`);
    return ok({ targetPath, targetName });
  }

  private hasActiveArtifact(filePath: string): boolean {
    const normalized = filePath.toLocaleLowerCase();
    return this.deps.workflowStore.list().some((artifact) => artifact.filePath.toLocaleLowerCase() === normalized && artifact.state === "active");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
