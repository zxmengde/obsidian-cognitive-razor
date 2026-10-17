/**
 * 任务系统类型定义
 *
 * TaskType、TaskState、Payload 映射、TaskRecord
 */

import type { ConfirmedConcept, CRType } from "./domain";
import type { SourcePackage } from "./workflow";
import type { ResolvedTaskConfig } from "./model-config";
import type { DuplicateMergeInput } from "./duplicate-merge";

// ============================================================================
// 任务基础类型
// ============================================================================

/** 任务类型 */
export type TaskType =
    | "define" | "tag" | "write"
    | "index" | "verify" | "merge" | "cards";

/** 由运行时队列调度的后台任务。 */
export type QueueTaskType = Exclude<TaskType, "define" | "index">;

/** 可恢复工作流的类别。Define 与 Index 不进入后台队列。 */
export type WorkflowKind = "create" | "verify";

/**
 * 队列中实际执行的阶段。Write 的每个 phase 都是独立任务，因此必须有
 * 稳定阶段 ID，不能再从 UI 文案或任务类型猜测。
 */
export const TASK_STAGE_IDS = ["tag", "core", "narrative", "structure", "process", "synthesis", "verify", "cards", "merge"] as const;
export type TaskStageId = typeof TASK_STAGE_IDS[number];
export type WriteTaskStageId = Exclude<TaskStageId, "tag" | "verify" | "cards" | "merge">;

/** One execution-attempt model and parameter snapshot; never persisted. */
export type TaskModelSnapshot = ResolvedTaskConfig;

/** 任务状态 */
export type TaskState =
    | "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

/** Reason for starting a queue task attempt. */
export type TaskExecutionAttemptReason = "initial" | "manual-retry";

/** Explicit execution context passed from the durable queue to the runner. */
export interface TaskExecutionContext {
    attemptReason: TaskExecutionAttemptReason;
    /** Configuration captured when this attempt starts; never persisted. */
    modelSnapshot: TaskModelSnapshot;
}

/** 任务失败发生的阶段，用于工作台分组和诊断。 */
export type TaskFailureStage =
    | "queue" | "provider" | "model" | "storage" | "configuration" | "runtime" | "unknown";

/** Whether retrying could duplicate an external effect. */
export type TaskFailureKind = "known" | "uncertain";

/** 任务错误记录 */
export interface TaskError {
    /** Safe transport diagnostics; no raw response or request content. */
    upstreamStatus?: number;
    requestTimeoutMs?: number;
    code: string;
    message: string;
    kind: TaskFailureKind;
    stage?: TaskFailureStage;
    /** 产生该错误的 Provider 操作实际尝试次数，不代表整项多阶段任务的请求总数。 */
    providerAttempts?: number;
}

// ============================================================================
// Payload 定义
// ============================================================================

interface TagPayload {
    /** Omitted only for terminal history after its workflow is gone. */
    concept?: ConfirmedConcept;
}

interface WritePayload {
    /** Omitted only for terminal history after its workflow is gone. */
    concept?: ConfirmedConcept;
    /** 前序 phase 已验证字段，作为当前 phase 的上下文。 */
    accumulated?: Record<string, unknown>;
    conversation?: ConversationContinuation;
}

export interface CardPayload {
    filePath: string;
    targetPath: string;
    body: string;
    noteType: CRType;
    promptVersion: string;
}

interface VerifyPayload {
    filePath: string;
    currentContent: string;
    noteType: CRType;
    concept?: ConfirmedConcept;
    conversation?: ConversationContinuation;
}

export interface ConversationContinuation {
    previousResponseId?: string;
  providerId?: string;
  model?: string;
  apiFormat?: import("./settings").ProviderApiFormat;
  endpoint?: string;
  promptVersion?: string;
  promptCacheKey?: string;
  promptCacheMode?: "implicit" | "explicit";
  responseContinuationEnabled?: boolean;
  promptCachingEnabled?: boolean;
  systemPrompt?: string;
    sources?: SourcePackage;
    /** Prior Responses input turns, retained so each next request extends the
     * exact cached prefix without relying on previous_response_id. */
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    /** One native output list per verified U+A pair; bounded and disposable. */
    responsesOutputHistory?: import("./provider").ResponsesReplayItem[][];
}

// ============================================================================
// 类型映射与 TaskRecord
// ============================================================================

/** Payload is determined by the durable stage identity, never by a second field. */
type QueueTaskPayloadMap = {
    tag: TagPayload;
    core: WritePayload;
    narrative: WritePayload;
    structure: WritePayload;
    process: WritePayload;
    synthesis: WritePayload;
    verify: VerifyPayload;
    cards: CardPayload;
    merge: DuplicateMergeInput;
};

/** 所有排队任务 Payload 的联合。 */
export type QueueTaskPayload = QueueTaskPayloadMap[TaskStageId];

/** TaskRecord 基础字段 */
interface TaskRecordBase {
    id: string;
    nodeId: string;
    /** 所属可恢复工作流。仅内部使用，不在工作台暴露。 */
    workflowId?: string;
    /** 阶段注册表的稳定标识。 */
    stageId: TaskStageId;
    /** 明确的 FIFO 序号；展示顺序与调度顺序共用它。 */
    queueOrder?: number;
    /** 工作台显示用的笔记名称与路径，不参与模型提示词。 */
    noteTitle?: string;
    filePath?: string;
    /** Retained for display-only terminal history after artifact cleanup. */
    conceptType?: CRType;
    state: TaskState;
    /** 首次进入队列的时间。 */
    createdAt: number;
    /** 最近一次状态变化的时间。 */
    updatedAt: number;
    /** 当前尝试开始时间。 */
    startedAt?: number;
    /** 当前尝试结束时间。 */
    finishedAt?: number;
    /** 从 1 开始，每次手动重试递增。 */
    attempt: number;
    error?: TaskError;
    /** 仅在当前进程内传递给完成事件；不会序列化到 queue-state.json。 */
    result?: Record<string, unknown>;
    /** Durable receipt only, never response text. A restarted task must prove
     * its result is recoverable locally before sending another request. */
    resultPendingCommit?: true;
    /** Display-only local commit failure; retries save the existing outcome without a model request. */
    localSavePending?: boolean;
}

type StageIdsFor<T extends TaskStageId | QueueTaskType> = T extends "write" ? WriteTaskStageId : T;

/**
 * A queue task is discriminated only by its durable stage identity. The
 * `"write"` generic shorthand exists for executor signatures only; it never
 * appears in a task record or persisted queue state.
 */
export type TaskRecord<T extends TaskStageId | QueueTaskType = TaskStageId> = {
    [K in StageIdsFor<T>]: TaskRecordBase & {
        stageId: K;
        payload: QueueTaskPayloadMap[K];
    };
}[StageIdsFor<T>];

/** 调用方提交的最小任务意图；运行状态和模型快照由 Queue 唯一拥有。 */
export type NewTaskRecord<T extends TaskStageId | QueueTaskType = TaskStageId> = {
    [K in StageIdsFor<T>]: {
        nodeId: string;
        stageId: K;
        payload: QueueTaskPayloadMap[K];
        workflowId: string;
        noteTitle?: string;
        filePath?: string;
    };
}[StageIdsFor<T>];

/** queue-state.json 中的最小调度记录。输入和输出由 WorkflowArtifact 单独保存。 */
export interface PersistedTaskRecord {
    id: string;
    workflowId: string;
    nodeId: string;
    stageId: TaskStageId;
    state: TaskState;
    queueOrder: number;
    noteTitle?: string;
    filePath?: string;
    conceptType?: CRType;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    finishedAt?: number;
    attempt: number;
    error?: TaskError;
    resultPendingCommit?: true;
}
