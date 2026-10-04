import { CR_TYPES, err, ok, toErr, type Result, type TaskRecord, type DuplicateMergeInput, type DuplicateMergePreview } from "../types";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import type { TaskQueue, TaskQueueWorkflowPort } from "./task-queue";
import type { DuplicateMergeService } from "./duplicate-merge-service";
import { generateUUID } from "../data/validator";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

interface MergeDraftArtifact {
  version: 1;
  id: string;
  createdAt: number;
  input: DuplicateMergeInput;
  /** A validated result receipt; generation never applies or deletes a note. */
  preview?: DuplicateMergePreview;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const pathIsSafe = (value: unknown): value is string => typeof value === "string" && value.endsWith(".md") && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(part => !part || part === "." || part === "..");
function validInput(value: unknown): value is DuplicateMergeInput {
  if (!record(value) || typeof value.pairId !== "string" || !value.pairId || !CR_TYPES.includes(value.type as typeof CR_TYPES[number]) || !Number.isFinite(value.similarity)) return false;
  for (const snapshot of [value.canonical, value.redundant]) {
    if (!record(snapshot) || typeof snapshot.nodeId !== "string" || !snapshot.nodeId || !pathIsSafe(snapshot.path) || typeof snapshot.content !== "string" || typeof snapshot.contentHash !== "string" || !snapshot.contentHash || !record(snapshot.frontmatter) || snapshot.frontmatter.cruid !== snapshot.nodeId || !strings(snapshot.frontmatter.parents)) return false;
  }
  const canonical = value.canonical as Record<string, unknown>, redundant = value.redundant as Record<string, unknown>;
  if (canonical.nodeId === redundant.nodeId || canonical.path === redundant.path || !record(value.linkRepairPlan)) return false;
  const plan = value.linkRepairPlan;
  return strings(plan.skipped) && Number.isSafeInteger(plan.replacementCount) && (plan.replacementCount as number) >= 0 && Array.isArray(plan.entries) && plan.entries.every(entry => record(entry) && pathIsSafe(entry.path) && typeof entry.expectedContent === "string" && typeof entry.replacementContent === "string" && Number.isSafeInteger(entry.replacements) && (entry.replacements as number) >= 0);
}
function validPreview(value: unknown, input: DuplicateMergeInput): value is DuplicateMergePreview {
  if (!record(value) || !record(value.draft)) return false;
  const draft = value.draft;
  return JSON.stringify({ pairId: value.pairId, type: value.type, similarity: value.similarity, canonical: value.canonical, redundant: value.redundant, linkRepairPlan: value.linkRepairPlan }) === JSON.stringify(input)
    && draft.pairId === input.pairId && draft.canonicalNodeId === input.canonical.nodeId && draft.redundantNodeId === input.redundant.nodeId
    && draft.canonicalContentHash === input.canonical.contentHash && draft.redundantContentHash === input.redundant.contentHash
    && typeof draft.name === "string" && typeof draft.body === "string" && !/^\s*---\s*(?:\r?\n|$)/.test(draft.body)
    && [draft.aliases, draft.tags, draft.parents, draft.sourceUids, draft.conflicts].every(strings);
}

/** Adds merge generation to the existing queue; only the editable draft is committed. */
export class MergeDraftGenerationService {
  private readonly starting = new Set<string>();
  private readonly submissions = new Set<Promise<Result<string>>>();
  private readonly completedReceipts = new Set<string>();
  private disposed = false;
  constructor(private readonly deps: { storage: FileStorage; settings: SettingsStore; queue: TaskQueue; merge: DuplicateMergeService }) {}

  start(pairId: string, canonicalNodeId: string): Promise<Result<string>> {
    const submission = this.startInternal(pairId, canonicalNodeId);
    this.submissions.add(submission);
    void submission.then(() => this.submissions.delete(submission), () => this.submissions.delete(submission));
    return submission;
  }
  private async startInternal(pairId: string, canonicalNodeId: string): Promise<Result<string>> {
    if (this.disposed) return err("E310_INVALID_STATE", "合并稿服务已停止");
    const existing = this.deps.queue.getSnapshot().tasks.find(task => task.stageId === "merge" && task.payload.pairId === pairId && (task.state !== "completed" && task.state !== "cancelled" || task.localSavePending));
    if (this.starting.has(pairId) || existing) return err("E320_TASK_CONFLICT", "该重复对已有生成任务，请在任务队列中处理");
    this.starting.add(pairId);
    try {
      const model = resolveTaskModelSnapshot(this.deps.settings.getSettings(), "merge");
      if (!model.providerId || !model.model || !model.providerSnapshot || model.providerSnapshot.enabled === false) return err("E401_PROVIDER_NOT_CONFIGURED", "请先配置合并任务模型");
      const captured = await this.deps.merge.captureMergeInput(pairId, canonicalNodeId);
      if (!captured.ok) return captured;
      if (!validInput(captured.value)) return err("E101_INVALID_INPUT", "重复笔记快照无效");
      const id = `merge-${generateUUID()}`;
      const artifact: MergeDraftArtifact = { version: 1, id, input: captured.value, createdAt: Date.now() };
      const saved = await this.write(artifact);
      if (!saved.ok) return saved;
      if (this.disposed) return err("E310_INVALID_STATE", "合并稿服务已停止");
      const queued = await this.deps.queue.enqueueDurably({ workflowId: id, nodeId: captured.value.canonical.nodeId, stageId: "merge", payload: captured.value, filePath: captured.value.canonical.path, noteTitle: captured.value.canonical.frontmatter.name });
      if (!queued.ok) await this.deps.storage.delete(this.path(id));
      return queued.ok ? ok(id) : queued;
    } catch (cause) { return toErr(cause, "E302_PERMISSION_DENIED", "创建合并稿任务失败"); }
    finally { this.starting.delete(pairId); }
  }

  async getDraft(id: string): Promise<Result<DuplicateMergePreview>> {
    const artifact = await this.read(id);
    if (!artifact.ok) return artifact;
    return artifact.value.preview ? ok(artifact.value.preview) : err("E310_INVALID_STATE", "合并稿尚未生成，请查看任务队列");
  }
  /** Ready results survive history cleanup and can be reopened for human review. */
  async findReadyDraft(pairId: string): Promise<Result<DuplicateMergePreview | undefined>> {
    const listed = await this.deps.storage.listFiles("data/merge-drafts");
    if (!listed.ok) return listed;
    let latest: MergeDraftArtifact | undefined;
    for (const path of listed.value.filter(path => /^data\/merge-drafts\/merge-[a-zA-Z0-9-]+\.json$/.test(path))) {
      const id = path.slice("data/merge-drafts/".length, -".json".length);
      const artifact = await this.read(id);
      if (!artifact.ok) return artifact;
      if (artifact.value.input.pairId === pairId && artifact.value.preview && (!latest || artifact.value.createdAt > latest.createdAt)) latest = artifact.value;
    }
    return ok(latest?.preview);
  }

  wrapPort(workflow: TaskQueueWorkflowPort): TaskQueueWorkflowPort {
    return {
      resolve: async task => {
        if (task.stageId !== "merge") return workflow.resolve(task);
        const artifact = await this.readTask(task);
        return artifact.ok ? ok(artifact.value.input) : artifact;
      },
      canResumeWithoutRequest: task => task.stageId === "merge" ? !!task.workflowId && this.completedReceipts.has(task.workflowId) : workflow.canResumeWithoutRequest?.(task) === true,
      resolveCachedResult: task => task.stageId === "merge" ? Promise.resolve(undefined) : workflow.resolveCachedResult?.(task) ?? Promise.resolve(undefined),
      resolveAppliedCompletion: async task => {
        if (task.stageId !== "merge") return workflow.resolveAppliedCompletion?.(task) ?? ok(undefined);
        const artifact = await this.readTask(task);
        return artifact.ok ? ok(artifact.value.preview ? {} : undefined) : artifact;
      },
      beforeComplete: async (task, result, context) => {
        if (task.stageId !== "merge") return workflow.beforeComplete?.(task, result, context) ?? ok({});
        const artifact = await this.readTask(task);
        if (!artifact.ok) return artifact;
        if (this.disposed) return err("E310_INVALID_STATE", "合并稿服务已停止");
        if (artifact.value.preview) return ok({});
        if (!validPreview(result.preview, artifact.value.input)) return err("E101_INVALID_INPUT", "合并稿与已确认的笔记快照不匹配");
        const saved = await this.write({ ...artifact.value, preview: result.preview });
        return saved.ok ? ok({}) : saved;
      },
      beforeFail: (task, error) => task.stageId === "merge" ? Promise.resolve() : workflow.beforeFail?.(task, error) ?? Promise.resolve(),
      beforeCancel: task => task.stageId === "merge" ? Promise.resolve() : workflow.beforeCancel?.(task) ?? Promise.resolve(),
      beforeRetry: async task => {
        if (task.stageId !== "merge") { await workflow.beforeRetry?.(task); return; }
        const artifact = await this.readTask(task);
        if (!artifact.ok || this.disposed) throw new Error("合并稿任务快照不可用");
        if (this.deps.queue.getSnapshot().tasks.some(other => other.id !== task.id && other.stageId === "merge" && other.payload.pairId === artifact.value.input.pairId && (other.state === "pending" || other.state === "running" || other.localSavePending))) throw new Error("该重复对已有生成任务");
      },
      afterComplete: task => task.stageId === "merge" ? Promise.resolve() : workflow.afterComplete?.(task) ?? Promise.resolve(),
      afterRemove: async task => {
        if (task.stageId !== "merge") { await workflow.afterRemove?.(task); return; }
        const artifact = await this.readTask(task);
        if (artifact.ok && !artifact.value.preview) {
          const removed = await this.deps.storage.delete(this.path(artifact.value.id));
          if (!removed.ok) throw new Error(removed.error.message);
        }
      },
    };
  }
  async dispose(): Promise<void> { this.disposed = true; await Promise.allSettled([...this.submissions]); }
  private path(id: string): string {
    if (!/^merge-[a-zA-Z0-9-]+$/.test(id)) throw new Error("无效合并稿任务标识");
    return `data/merge-drafts/${id}.json`;
  }
  private write(artifact: MergeDraftArtifact): Promise<Result<void>> { return this.deps.storage.atomicWrite(this.path(artifact.id), JSON.stringify(artifact)); }
  private async readTask(task: Pick<TaskRecord, "workflowId" | "nodeId" | "filePath">): Promise<Result<MergeDraftArtifact>> {
    if (!task.workflowId) return err("E310_INVALID_STATE", "缺少合并稿任务标识");
    const read = await this.read(task.workflowId);
    if (!read.ok) return read;
    if (read.value.input.canonical.nodeId !== task.nodeId || read.value.input.canonical.path !== task.filePath) return err("E310_INVALID_STATE", "合并稿任务来源不匹配");
    return read;
  }
  private async read(id: string): Promise<Result<MergeDraftArtifact>> {
    this.completedReceipts.delete(id);
    try {
      const raw = await this.deps.storage.read(this.path(id));
      if (!raw.ok) return raw;
      const value = JSON.parse(raw.value) as MergeDraftArtifact;
      if (value.version !== 1 || value.id !== id || !Number.isFinite(value.createdAt) || !validInput(value.input) || (value.preview !== undefined && !validPreview(value.preview, value.input))) return err("E310_INVALID_STATE", "合并稿任务记录损坏");
      if (value.preview) this.completedReceipts.add(id);
      return ok(value);
    } catch (cause) { return toErr(cause, "E310_INVALID_STATE", "无法读取合并稿任务记录"); }
  }
}
