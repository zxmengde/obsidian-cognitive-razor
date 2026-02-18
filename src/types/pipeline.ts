/**
 * 管线系统类型定义
 */

import type { CRType, StandardizedConcept } from "./domain";

/** 管线阶段 */
export type PipelineStage =
    | "idle" | "defining" | "tagging" | "indexing"
    | "review_draft" | "writing" | "verifying"
    | "review_changes" | "saving" | "checking_duplicates"
    | "completed" | "failed";

/** 管线上下文 */
export interface PipelineContext {
    kind: "create" | "amend" | "merge" | "verify";
    pipelineId: string;
    nodeId: string;
    type: CRType;
    stage: PipelineStage;
    userInput: string;
    standardizedData?: StandardizedConcept;
    enrichedData?: { aliases: string[]; tags: string[] };
    embedding?: number[];
    generatedContent?: unknown;
    parents?: string[];
    sources?: string;
    targetPathOverride?: string;
    previousContent?: string;
    newContent?: string;
    filePath?: string;
    verificationResult?: Record<string, unknown>;
    mergePairId?: string;
    deleteFilePath?: string;
    deleteNoteName?: string;
    deleteNodeId?: string;
    deleteContent?: string;
    currentStatus?: string;
    snapshotId?: string;
    error?: { code: string; message: string };
    createdAt: string;
    updatedAt: string;
}
