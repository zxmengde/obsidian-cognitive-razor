import { CR_TYPES, err, ok, toErr, type Result, type TaskRecord, type PersistedTaskRecord } from "../types";
import type { CardPayload } from "../types/task";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import type { NoteRepository } from "./note-repository";
import type { TaskQueue, TaskQueueWorkflowPort } from "./task-queue";
import { captureCardInput, isSafeCardPath } from "./card-generation";
import { generateUUID } from "../data/validator";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

interface CardGenerationArtifact {
  version: 1;
  id: string;
  nodeId: string;
  noteTitle: string;
  createdAt: number;
  state: "active" | "committing" | "completed" | "failed" | "cancelled" | "interrupted";
  input: CardPayload;
  markdown?: string;
}

/** Cards own their artifact and append effect; they never enter Create's stage chain. */
export class CardGenerationService {
  private readonly starting = new Set<string>();
  private readonly submissions = new Set<Promise<Result<string>>>();
  private disposed = false;
  constructor(private readonly deps: {
    storage: FileStorage; settings: SettingsStore; notes: NoteRepository; queue: TaskQueue;
  }) {}

  start(filePath: string): Promise<Result<string>> {
    const submission = this.startInternal(filePath);
    this.submissions.add(submission);
    void submission.then(() => this.submissions.delete(submission), () => this.submissions.delete(submission));
    return submission;
  }

  private async startInternal(filePath: string): Promise<Result<string>> {
    if (this.disposed) return err("E310_INVALID_STATE", "卡片服务已停止");
    const key = filePath.toLocaleLowerCase();
    if (this.starting.has(key) || this.deps.queue.getSnapshot().tasks.some((task) => task.stageId === "cards" && task.filePath?.toLocaleLowerCase() === key && (task.state === "pending" || task.state === "running"))) return err("E320_TASK_CONFLICT", "当前笔记已有卡片任务");
    this.starting.add(key);
    try {
      const settings = this.deps.settings.getSettings();
      const model = resolveTaskModelSnapshot(settings, "cards");
      if (!model.providerId || !model.model || !model.providerSnapshot || model.providerSnapshot.enabled === false) return err("E401_PROVIDER_NOT_CONFIGURED", "请先在设置中配置记忆卡片的独立 Provider 和模型");
      const captured = captureCardInput(filePath, await this.deps.notes.readByPath(filePath), settings.cardsSourceRoot, settings.cardsTargetRoot);
      if (!captured.ok) return captured;
      const { nodeId, noteTitle, ...input } = captured.value;
      const id = `cards-${generateUUID()}`;
      const saved = await this.write({ version: 1, id, nodeId, noteTitle, input, createdAt: Date.now(), state: "active" });
      if (!saved.ok) return saved;
      if (this.disposed) return err("E310_INVALID_STATE", "卡片服务已停止");
      const queued = await this.deps.queue.enqueueDurably({ workflowId: id, nodeId, stageId: "cards", payload: input, filePath, noteTitle });
      return queued.ok ? ok(input.targetPath) : queued;
    } catch (cause) {
      return toErr(cause, "E302_PERMISSION_DENIED", "创建卡片任务失败");
    } finally { this.starting.delete(key); }
  }

  wrapPort(workflow: TaskQueueWorkflowPort): TaskQueueWorkflowPort {
    const cards = (task: Pick<TaskRecord, "stageId">) => task.stageId === "cards";
    return {
      resolve: async (task) => {
        if (!cards(task)) return workflow.resolve(task);
        const artifact = await this.read(task);
        return artifact.ok ? ok(artifact.value.input) : artifact;
      },
      canResumeWithoutRequest: (task) => !cards(task) && workflow.canResumeWithoutRequest?.(task) === true,
      resolveCachedResult: (task) => cards(task) ? Promise.resolve(undefined) : workflow.resolveCachedResult?.(task) ?? Promise.resolve(undefined),
      resolveAppliedCompletion: async (task) => {
        if (!cards(task)) return workflow.resolveAppliedCompletion?.(task) ?? ok(undefined);
        const artifact = await this.read(task);
        if (!artifact.ok) return artifact;
        if (artifact.value.state === "completed") return ok({});
        return artifact.value.state === "active"
          ? ok(undefined)
          : err("E310_INVALID_STATE", "卡片任务已停止，请从源笔记重新生成");
      },
      beforeComplete: async (task, result, context) => {
        if (!cards(task)) return workflow.beforeComplete?.(task, result, context) ?? ok({});
        const loaded = await this.read(task);
        if (!loaded.ok) return loaded;
        const artifact = loaded.value;
        if (artifact.state !== "active" || this.disposed) return err("E310_INVALID_STATE", "卡片任务不能再次提交，请重新生成");
        if (typeof result.markdown !== "string" || !result.markdown.trim()) return err("E101_INVALID_INPUT", "卡片结果为空");
        // Persist intent before append. A crash here is interrupted, never replayed.
        const saved = await this.write({ ...artifact, state: "committing", markdown: result.markdown });
        if (!saved.ok) return saved;
        if (this.disposed) return err("E310_INVALID_STATE", "卡片服务已停止，未追加");
        try {
          await this.deps.notes.appendCards(artifact.input.targetPath, result.markdown);
          const completed = await this.write({ ...artifact, state: "completed", markdown: result.markdown });
          return completed.ok ? ok({}) : completed;
        } catch (cause) { return toErr(cause, "E302_PERMISSION_DENIED", "卡片追加失败，请检查目标文件后重新生成"); }
      },
      beforeFail: (task, error) => cards(task) ? this.mark(task, error.kind === "uncertain" ? "interrupted" : "failed") : workflow.beforeFail?.(task, error) ?? Promise.resolve(),
      beforeCancel: (task) => cards(task) ? this.mark(task, "cancelled") : workflow.beforeCancel?.(task) ?? Promise.resolve(),
      beforeRetry: async (task) => {
        if (cards(task)) throw new Error("卡片任务不重放，请通过生成记忆卡片开始新任务");
        await workflow.beforeRetry?.(task);
      },
      afterComplete: (task) => cards(task) ? Promise.resolve() : workflow.afterComplete?.(task) ?? Promise.resolve(),
      afterRemove: async (task) => {
        if (!cards(task)) { await workflow.afterRemove?.(task); return; }
        if (task.workflowId) {
          const removed = await this.deps.storage.delete(this.path(task.workflowId));
          if (!removed.ok) throw new Error(removed.error.message);
        }
      },
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.submissions]);
  }

  private path(id: string): string {
    if (!/^cards-[a-zA-Z0-9-]+$/.test(id)) throw new Error("无效卡片任务标识");
    return `data/cards/${id}.json`;
  }
  private write(artifact: CardGenerationArtifact): Promise<Result<void>> {
    return this.deps.storage.atomicWrite(this.path(artifact.id), JSON.stringify(artifact));
  }
  private async read(task: Pick<PersistedTaskRecord, "workflowId" | "nodeId"> | TaskRecord): Promise<Result<CardGenerationArtifact>> {
    try {
      if (!task.workflowId) return err("E310_INVALID_STATE", "缺少卡片任务标识");
      const raw = await this.deps.storage.read(this.path(task.workflowId));
      if (!raw.ok) return raw;
      const value = JSON.parse(raw.value) as CardGenerationArtifact;
      if (value.version !== 1 || value.id !== task.workflowId || value.nodeId !== task.nodeId || !value.input || typeof value.input.body !== "string" || !value.input.body.trim() || !isSafeCardPath(value.input.targetPath) || !value.input.targetPath.endsWith("-decks.md") || !isSafeCardPath(value.input.filePath) || value.input.filePath.toLocaleLowerCase() === value.input.targetPath.toLocaleLowerCase() || !CR_TYPES.includes(value.input.noteType) || typeof value.input.promptVersion !== "string" || !["active", "committing", "completed", "failed", "cancelled", "interrupted"].includes(value.state)) return err("E310_INVALID_STATE", "卡片任务记录损坏");
      return ok(value);
    } catch (cause) { return toErr(cause, "E310_INVALID_STATE", "无法读取卡片任务记录"); }
  }
  private async mark(task: TaskRecord, state: CardGenerationArtifact["state"]): Promise<void> {
    const artifact = await this.read(task);
    if (!artifact.ok) throw new Error(artifact.error.message);
    if (artifact.value.state === "completed") return;
    const saved = await this.write({ ...artifact.value, state });
    if (!saved.ok) throw new Error(saved.error.message);
  }
}
