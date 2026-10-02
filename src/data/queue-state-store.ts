import { err, ok } from "../types/result";
import type { Result } from "../types/result";
import { TASK_STAGE_IDS } from "../types/task";
import type { PersistedTaskRecord, TaskError, TaskStageId } from "../types/task";
import type { FileStorage } from "./file-storage";

export const QUEUE_STATE_PATH = "data/queue-state-v5.json";
// Keep the existing path for compatibility, but reject prior schemas without
// migration or creation of a second recovery file.
export const QUEUE_STATE_VERSION = "8.0.0" as const;

/** Queue state intentionally contains only scheduler metadata. */
export interface PersistedQueueState {
  version: typeof QUEUE_STATE_VERSION;
  paused: boolean;
  nextQueueOrder: number;
  tasks: PersistedTaskRecord[];
}

export type QueueStateReason =
  | "invalid-json"
  | "unsupported-schema"
  | "invalid-schema"
  | "unreadable"
  | "duplicate-active-stage";

export type QueueStateLoad =
  | { kind: "empty" }
  | { kind: "ready"; state: PersistedQueueState }
  | { kind: "quarantined"; reason: QueueStateReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isTaskState(value: unknown): value is PersistedTaskRecord["state"] {
  return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "cancelled" || value === "interrupted";
}

function isStageId(value: unknown): value is TaskStageId {
  return typeof value === "string" && TASK_STAGE_IDS.includes(value as TaskStageId);
}

function isSafeTaskError(value: unknown): value is TaskError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = value as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string" &&
    (error.kind === "known" || error.kind === "uncertain") &&
    (error.stage === undefined || typeof error.stage === "string") &&
    (error.upstreamStatus === undefined || [408, 502, 503, 504, 524].includes(error.upstreamStatus as number)) &&
    (error.requestTimeoutMs === undefined || (Number.isSafeInteger(error.requestTimeoutMs) && (error.requestTimeoutMs as number) > 0)) &&
    (error.providerAttempts === undefined ||
      (Number.isSafeInteger(error.providerAttempts) && (error.providerAttempts as number) > 0));
}

function isValidPersistedTask(value: unknown): value is PersistedTaskRecord {
  if (!isRecord(value)) return false;
  const task = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "id", "workflowId", "nodeId", "stageId", "state", "queueOrder",
    "noteTitle", "filePath", "conceptType", "createdAt", "updatedAt", "startedAt", "finishedAt", "attempt", "error",
  ]);
  if (Object.keys(task).some((key) => !allowedKeys.has(key))) return false;
  if (typeof task.id !== "string" || !task.id || typeof task.workflowId !== "string" || !task.workflowId ||
    typeof task.nodeId !== "string" || !task.nodeId || !isStageId(task.stageId) ||
    !isTaskState(task.state) ||
    !Number.isSafeInteger(task.queueOrder) || (task.queueOrder as number) < 1 ||
    !Number.isFinite(task.createdAt) || !Number.isFinite(task.updatedAt) ||
    !Number.isSafeInteger(task.attempt) || (task.attempt as number) < 1) return false;
  if (task.noteTitle !== undefined && typeof task.noteTitle !== "string") return false;
  if (task.filePath !== undefined && typeof task.filePath !== "string") return false;
  if (task.conceptType !== undefined && typeof task.conceptType !== "string") return false;
  if (task.startedAt !== undefined && !Number.isFinite(task.startedAt)) return false;
  if (task.finishedAt !== undefined && !Number.isFinite(task.finishedAt)) return false;
  if (task.error !== undefined && !isSafeTaskError(task.error)) return false;
  return true;
}

function isPersistedState(value: unknown): value is PersistedQueueState {
  if (!isRecord(value)) return false;
  const state = value as Record<string, unknown>;
  const allowedKeys = new Set(["version", "paused", "nextQueueOrder", "tasks"]);
  return Object.keys(state).every((key) => allowedKeys.has(key))
    && state.version === QUEUE_STATE_VERSION
    && typeof state.paused === "boolean"
    && Number.isSafeInteger(state.nextQueueOrder)
    && (state.nextQueueOrder as number) >= 1
    && Array.isArray(state.tasks)
    && state.tasks.every(isValidPersistedTask);
}

function findQueueAmbiguity(tasks: PersistedTaskRecord[]): QueueStateReason | undefined {
  const taskIds = new Set<string>();
  const activeStages = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.id)) return "invalid-schema";
    taskIds.add(task.id);
    if (task.state !== "pending" && task.state !== "running") continue;
    const stageKey = `${task.workflowId}\u0000${task.stageId}`;
    if (activeStages.has(stageKey)) return "duplicate-active-stage";
    activeStages.add(stageKey);
  }
  return undefined;
}

/** Owns queue-state I/O and validation; it never decides whether work may run. */
export class QueueStateStore {
  private quarantineReason?: QueueStateReason;
  private unknownTasks: Record<string, unknown>[] = [];
  constructor(private readonly storage: FileStorage) {}

  hasUnknownTask(workflowId: string): boolean {
    return this.unknownTasks.some((task) => task.workflowId === workflowId);
  }

  private quarantine(reason: QueueStateReason): Result<QueueStateLoad> {
    this.quarantineReason = reason;
    return ok({ kind: "quarantined", reason });
  }

  async load(): Promise<Result<QueueStateLoad>> {
    const current = await this.storage.read(QUEUE_STATE_PATH);
    if (!current.ok) {
      if (current.error.code !== "E301_FILE_NOT_FOUND") {
        return this.quarantine("unreadable");
      }
      return ok({ kind: "empty" });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(current.value);
    } catch {
      return this.quarantine("invalid-json");
    }
    // Unknown retired stages are opaque history: retain their fields as data,
    // but never dispatch them. Invalid known records still quarantine the file.
    if (isRecord(parsed) && parsed.version === QUEUE_STATE_VERSION && Array.isArray(parsed.tasks)) {
      const unknown = parsed.tasks.filter((task): task is Record<string, unknown> =>
        isRecord(task) && typeof task.stageId === "string" && !isStageId(task.stageId));
      if (unknown.every((task) => isValidPersistedTask({ ...task, stageId: "tag" }))) {
        this.unknownTasks = unknown;
        parsed = { ...parsed, tasks: parsed.tasks.filter((task) => !unknown.includes(task)) };
      }
    }
    if (!isPersistedState(parsed)) {
      const reason = isRecord(parsed) && typeof parsed.version === "string" && parsed.version !== QUEUE_STATE_VERSION
        ? "unsupported-schema"
        : "invalid-schema";
      return this.quarantine(reason);
    }
    const ambiguity = findQueueAmbiguity(parsed.tasks);
    if (ambiguity) return this.quarantine(ambiguity);
    return ok({ kind: "ready", state: parsed });
  }

  async save(state: PersistedQueueState): Promise<Result<void>> {
    if (this.quarantineReason) {
      return err("E310_INVALID_STATE", "队列文件损坏、不可读或版本不兼容，已保留原文件并停止写入。请先备份并检查 data/queue-state-v5.json；修复后重载插件。", { reason: this.quarantineReason });
    }
    return this.storage.atomicWrite(QUEUE_STATE_PATH, JSON.stringify({ ...state, tasks: [...state.tasks, ...this.unknownTasks] }, null, 2));
  }

}
