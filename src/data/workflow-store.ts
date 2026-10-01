import type { ILogger, Result, WorkflowArtifact, WorkflowPatch } from "../types";
import { CR_TYPES, err, ok, TASK_STAGE_IDS } from "../types";
import type { FileStorage } from "./file-storage";
import { cloneJson } from "../utils/clone";
const clone = cloneJson;

const WORKFLOW_DIR = "data/workflows";
const WORKFLOW_VERSION = "7.0.0" as const;
const WORKFLOW_ARTIFACT_KEYS = new Set([
  "version", "workflowId", "kind", "state", "nodeId", "type", "filePath", "noteTitle", "parents",
  "concept", "autoVerify", "tagResult", "accumulated", "conversation", "sources", "pendingStageResult", "contentSnapshot",
  "noteCreated", "appliedStageIds", "error", "createdAt", "updatedAt", "directoryScheme",
]);
const CR_TYPE_SET = new Set<string>(CR_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isSafeWorkflowId(value: string): boolean { return /^[A-Za-z0-9_-]{1,160}$/.test(value); }
function isStageId(value: unknown): boolean {
  return typeof value === "string" && TASK_STAGE_IDS.includes(value as typeof TASK_STAGE_IDS[number]);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isConceptSnapshot(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "name" && key !== "coreDefinition")) return false;
  if (!isRecord(value.name) || Object.keys(value.name).some((key) => key !== "chinese" && key !== "english")) return false;
  return typeof value.name.chinese === "string" && typeof value.name.english === "string"
    && (value.name.chinese.trim().length > 0 || value.name.english.trim().length > 0)
    && typeof value.coreDefinition === "string";
}
function isPendingStageResult(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => !["stageId", "commitId", "committedAt", "result"].includes(key))) return false;
  if (value.committedAt !== undefined && (typeof value.committedAt !== "number" || !Number.isFinite(value.committedAt) || value.committedAt <= 0)) return false;
  return isStageId(value.stageId) && typeof value.commitId === "string" && value.commitId.trim().length > 0 && isRecord(value.result);
}
function isWorkflowConversation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.providerId === "string" && typeof value.model === "string"
    && typeof value.promptVersion === "string" && typeof value.promptCacheKey === "string"
    && (value.apiFormat === undefined || typeof value.apiFormat === "string")
    && (value.endpoint === undefined || typeof value.endpoint === "string")
    && (value.responseContinuationEnabled === undefined || typeof value.responseContinuationEnabled === "boolean")
    && (value.promptCachingEnabled === undefined || typeof value.promptCachingEnabled === "boolean")
    && (value.systemPrompt === undefined || typeof value.systemPrompt === "string")
    && (value.promptCacheMode === undefined || value.promptCacheMode === "implicit" || value.promptCacheMode === "explicit")
    && (value.responseId === undefined || typeof value.responseId === "string")
    && (value.invalidReason === undefined || typeof value.invalidReason === "string")
    && (value.history === undefined || (Array.isArray(value.history) && value.history.length <= 32
      && value.history.every((item) => isRecord(item) && (item.role === "user" || item.role === "assistant")
        && typeof item.content === "string" && item.content.length <= 500000)));
}
function isSourcePackage(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "items") || !Array.isArray(value.items) || value.items.length > 12) return false;
  return value.items.every((item) => isRecord(item) && typeof item.url === "string" && item.url.length > 0
    && (item.title === undefined || typeof item.title === "string"));
}
function isDirectoryScheme(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === CR_TYPES.length
    && CR_TYPES.every((type) => typeof value[type] === "string");
}
function isValidArtifact(value: unknown): value is WorkflowArtifact {
  if (!isRecord(value) || Object.keys(value).some((key) => !WORKFLOW_ARTIFACT_KEYS.has(key)) || value.version !== WORKFLOW_VERSION
    || typeof value.workflowId !== "string" || !isSafeWorkflowId(value.workflowId)
    || (value.kind !== "create" && value.kind !== "verify")
    || !["active", "failed", "completed", "cancelled"].includes(String(value.state))
    || typeof value.nodeId !== "string" || typeof value.type !== "string" || !CR_TYPE_SET.has(value.type)
    || typeof value.filePath !== "string" || typeof value.noteTitle !== "string" || !isStringArray(value.parents)
    || typeof value.autoVerify !== "boolean" || !isRecord(value.accumulated)
    || (value.directoryScheme !== undefined && !isDirectoryScheme(value.directoryScheme))
    || (value.conversation !== undefined && !isWorkflowConversation(value.conversation))
    || (value.sources !== undefined && !isSourcePackage(value.sources))
    || (value.pendingStageResult !== undefined && !isPendingStageResult(value.pendingStageResult))
    || typeof value.noteCreated !== "boolean" || !Array.isArray(value.appliedStageIds) || !value.appliedStageIds.every(isStageId)
    || typeof value.createdAt !== "number" || typeof value.updatedAt !== "number") return false;
  if (value.contentSnapshot !== undefined && typeof value.contentSnapshot !== "string") return false;
  if (value.kind === "create" && !isConceptSnapshot(value.concept)) return false;
  if (value.kind === "verify" && value.concept !== undefined) return false;
  if (value.tagResult !== undefined && (!isRecord(value.tagResult) || !isStringArray(value.tagResult.aliases) || !isStringArray(value.tagResult.tags))) return false;
  if (value.error !== undefined && (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string")) return false;
  const pending = value.pendingStageResult;
  if (pending !== undefined && isRecord(pending) && pending.commitId !== `${value.workflowId}:${String(pending.stageId)}`) return false;
  return true;
}

/** Durable workflow artifacts. Invalid/legacy records are warned about and skipped. */
export class WorkflowStore {
  private readonly artifacts = new Map<string, WorkflowArtifact>();
  private writeChain: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly fileStorage: FileStorage, private readonly logger: ILogger) {}

  async initialize(): Promise<Result<void>> {
    if (this.initialized) return ok(undefined);
    const files = await this.fileStorage.listFiles(WORKFLOW_DIR);
    if (!files.ok) {
      this.logger.warn("WorkflowStore", "无法列出工作流目录，已跳过工作流恢复", { error: files.error });
      this.initialized = true;
      return ok(undefined);
    }
    for (const relativePath of files.value) {
      if (!relativePath.startsWith(`${WORKFLOW_DIR}/`) || !relativePath.endsWith(".json")) continue;
      const read = await this.fileStorage.read(relativePath);
      if (!read.ok) {
        this.logger.warn("WorkflowStore", "读取工作流 artifact 失败，已跳过", { path: relativePath, error: read.error });
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(read.value);
        const fileName = relativePath.slice(`${WORKFLOW_DIR}/`.length, -5);
        if (!isValidArtifact(parsed) || parsed.workflowId !== fileName) {
          this.logger.warn("WorkflowStore", "工作流 artifact 无效或为旧版本，已跳过", { path: relativePath });
          continue;
        }
        this.artifacts.set(parsed.workflowId, clone(parsed));
      } catch (error) {
        this.logger.warn("WorkflowStore", "工作流 artifact 不是有效 JSON，已跳过", { path: relativePath, error });
      }
    }
    this.initialized = true;
    return ok(undefined);
  }

  get(workflowId: string): WorkflowArtifact | undefined { const artifact = this.artifacts.get(workflowId); return artifact ? clone(artifact) : undefined; }
  list(): WorkflowArtifact[] { return [...this.artifacts.values()].map(clone).sort((a, b) => a.createdAt - b.createdAt); }
  findByPath(filePath: string): WorkflowArtifact | undefined { return this.list().find((artifact) => artifact.filePath.toLowerCase() === filePath.toLowerCase()); }

  async create(artifact: WorkflowArtifact): Promise<Result<void>> {
    if (!isValidArtifact(artifact)) return err("E101_INVALID_INPUT", "工作流 artifact 格式无效");
    const snapshot = clone(artifact);
    return this.serialize(async () => {
      if (this.artifacts.has(snapshot.workflowId) || await this.fileStorage.exists(this.pathFor(snapshot.workflowId))) {
        return err("E310_INVALID_STATE", `工作流已存在: ${snapshot.workflowId}`);
      }
      const saved = await this.persist(snapshot);
      if (saved.ok) this.artifacts.set(snapshot.workflowId, snapshot);
      return saved;
    });
  }

  async update(workflowId: string, patch: WorkflowPatch): Promise<Result<WorkflowArtifact>> {
    // Preserve explicit undefined deletions while isolating caller mutations.
    const patchSnapshot = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? undefined : clone(value)]));
    return this.serialize(async () => {
      const current = this.artifacts.get(workflowId);
      if (!current) return err("E311_NOT_FOUND", `工作流不存在: ${workflowId}`);
      const next = { ...current, ...patchSnapshot, workflowId, version: WORKFLOW_VERSION, createdAt: current.createdAt, updatedAt: Date.now() };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete (next as Record<string, unknown>)[key];
      }
      if (!isValidArtifact(next)) return err("E101_INVALID_INPUT", "工作流更新后的 artifact 无效");
      const saved = await this.persist(next);
      if (!saved.ok) return saved;
      this.artifacts.set(workflowId, next);
      return ok(clone(next));
    });
  }

  async remove(workflowId: string): Promise<Result<void>> {
    return this.serialize(async () => {
      const removed = await this.fileStorage.delete(this.pathFor(workflowId));
      if (removed.ok) this.artifacts.delete(workflowId);
      return removed;
    });
  }

  private serialize<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    const pending = this.writeChain.then(operation).catch((cause: unknown) => {
      this.logger.error("WorkflowStore", "工作流存储操作异常", cause instanceof Error ? cause : new Error(String(cause)));
      return err("E500_INTERNAL_ERROR", "工作流存储操作失败", cause);
    });
    this.writeChain = pending.then(() => undefined);
    return pending;
  }

  private pathFor(workflowId: string): string { if (!isSafeWorkflowId(workflowId)) throw new Error("Invalid workflow ID"); return `${WORKFLOW_DIR}/${workflowId}.json`; }

  private persist(snapshot: WorkflowArtifact): Promise<Result<void>> {
    return this.fileStorage.atomicWrite(this.pathFor(snapshot.workflowId), JSON.stringify(snapshot, null, 2));
  }
}

export const WORKFLOW_ARTIFACT_VERSION = WORKFLOW_VERSION;
