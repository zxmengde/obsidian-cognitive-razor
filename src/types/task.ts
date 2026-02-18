/**
 * 任务系统类型定义
 *
 * TaskType、TaskState、Payload/Result 映射、TaskRecord
 */

import type { CRType, StandardizedConcept } from "./domain";
import type { ImageGeneratePayload, ImageGenerateResult } from "./provider";

// Re-export 以便从 task.ts 直接访问
export type { ImageGeneratePayload, ImageGenerateResult } from "./provider";

// ============================================================================
// 任务基础类型
// ============================================================================

/** 任务类型 */
export type TaskType =
    | "define" | "tag" | "write" | "amend"
    | "merge" | "index" | "verify" | "image-generate";

/** 任务状态 */
export type TaskState =
    | "Pending" | "Running" | "Completed" | "Failed" | "Cancelled";

/** 任务错误记录 */
export interface TaskError {
    code: string;
    message: string;
    timestamp: string;
    attempt: number;
}

// ============================================================================
// Payload 定义
// ============================================================================

export interface DefinePayload {
    userInput: string;
    pipelineId?: string;
    [key: string]: unknown;
}

export interface TagPayload {
    pipelineId?: string;
    standardizedData?: StandardizedConcept;
    conceptType: CRType;
    userInput: string;
    [key: string]: unknown;
}

export interface WritePayload {
    pipelineId?: string;
    standardizedData?: StandardizedConcept;
    conceptType: CRType;
    coreDefinition?: string;
    enrichedData?: { aliases: string[]; tags: string[] };
    embedding?: number[];
    filePath?: string;
    skipSnapshot?: boolean;
    userInput?: string;
    sources?: string;
    originalContent?: string;
    [key: string]: unknown;
}

export interface AmendPayload {
    pipelineId?: string;
    currentContent: string;
    instruction: string;
    conceptType: CRType;
    [key: string]: unknown;
}

export interface MergePayload {
    pipelineId?: string;
    keepName: string;
    deleteName: string;
    keepContent: string;
    deleteContent: string;
    conceptType: CRType;
    finalFileName?: string;
    [key: string]: unknown;
}

export interface IndexPayload {
    text?: string;
    standardizedData?: StandardizedConcept;
    conceptType?: CRType;
    aliases?: string[];
    namingTemplate?: string;
    [key: string]: unknown;
}

export interface VerifyPayload {
    pipelineId?: string;
    filePath?: string;
    currentContent: string;
    conceptType?: CRType;
    noteType?: CRType;
    standardizedData?: StandardizedConcept;
    sources?: string;
    [key: string]: unknown;
}

// ============================================================================
// Result 定义
// ============================================================================

export interface DefineResult { [key: string]: unknown; }

export interface TagResult {
    aliases: string[];
    tags: string[];
    [key: string]: unknown;
}

export interface WriteResult {
    snapshotId?: string;
    [key: string]: unknown;
}

export interface AmendResult { [key: string]: unknown; }

export interface MergeResult {
    merged_name?: Record<string, unknown>;
    merge_rationale?: string;
    content?: Record<string, unknown>;
    preserved_from_a?: string[];
    preserved_from_b?: string[];
    [key: string]: unknown;
}

export interface IndexResult {
    embedding: number[];
    tokensUsed?: number;
    text?: string;
    [key: string]: unknown;
}

export interface VerifyResult {
    overall_assessment?: string;
    confidence_score?: number;
    issues?: unknown[];
    verified_claims?: unknown[];
    recommendations?: unknown[];
    requires_human_review?: boolean;
    [key: string]: unknown;
}

// ============================================================================
// 类型映射与 TaskRecord
// ============================================================================

/** Payload 类型映射 */
export type TaskPayloadMap = {
    "define": DefinePayload;
    "tag": TagPayload;
    "write": WritePayload;
    "amend": AmendPayload;
    "merge": MergePayload;
    "index": IndexPayload;
    "verify": VerifyPayload;
    "image-generate": ImageGeneratePayload;
};

/** Result 类型映射 */
export type TaskResultMap = {
    "define": DefineResult;
    "tag": TagResult;
    "write": WriteResult;
    "amend": AmendResult;
    "merge": MergeResult;
    "index": IndexResult;
    "verify": VerifyResult;
    "image-generate": ImageGenerateResult;
};

/** 所有 Payload 类型的联合 */
export type AnyTaskPayload = TaskPayloadMap[TaskType];

/** 所有 Result 类型的联合 */
export type AnyTaskResult = TaskResultMap[TaskType];

/** TypedTaskRecord 可辨识联合类型（以 taskType 为判别式） */
export type TypedTaskRecord =
    | (TaskRecordBase & { taskType: "define"; payload: DefinePayload; result?: DefineResult })
    | (TaskRecordBase & { taskType: "tag"; payload: TagPayload; result?: TagResult })
    | (TaskRecordBase & { taskType: "write"; payload: WritePayload; result?: WriteResult })
    | (TaskRecordBase & { taskType: "amend"; payload: AmendPayload; result?: AmendResult })
    | (TaskRecordBase & { taskType: "merge"; payload: MergePayload; result?: MergeResult })
    | (TaskRecordBase & { taskType: "index"; payload: IndexPayload; result?: IndexResult })
    | (TaskRecordBase & { taskType: "verify"; payload: VerifyPayload; result?: VerifyResult })
    | (TaskRecordBase & { taskType: "image-generate"; payload: ImageGeneratePayload; result?: ImageGenerateResult });

/** TaskRecord 基础字段 */
export interface TaskRecordBase {
    id: string;
    nodeId: string;
    state: TaskState;
    providerRef?: string;
    promptRef?: string;
    attempt: number;
    maxAttempts: number;
    undoPointer?: string;
    lockKey?: string;
    typeLockKey?: string;
    created: string;
    updated: string;
    startedAt?: string;
    completedAt?: string;
    errors?: TaskError[];
}

/** 任务记录（向后兼容接口） */
export interface TaskRecord extends TaskRecordBase {
    taskType: TaskType;
    payload: AnyTaskPayload;
    result?: AnyTaskResult;
}
