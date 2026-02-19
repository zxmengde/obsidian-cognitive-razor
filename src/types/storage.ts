/**
 * 存储相关类型定义
 *
 * 向量索引、重复检测、快照、队列状态文件
 */

import type { CRType } from "./domain";
import type { TaskType, TaskState, TaskError, AnyTaskPayload } from "./task";

// ============================================================================
// 重复检测
// ============================================================================

/** 重复对状态 */
export type DuplicatePairStatus =
    | "pending" | "merging" | "merged" | "dismissed";

/** 重复对记录 */
export interface DuplicatePair {
    id: string;
    nodeIdA: string;
    nodeIdB: string;
    type: CRType;
    similarity: number;
    detectedAt: string;
    status: DuplicatePairStatus;
}

// ============================================================================
// 向量索引
// ============================================================================

/** 向量索引条目 */
export interface VectorEntry {
    uid: string;
    type: CRType;
    embedding: number[];
    updated: string;
}

/** 相似度搜索结果 */
export interface SearchResult {
    uid: string;
    similarity: number;
    name: string;
    path: string;
}

/** 索引统计信息 */
export interface IndexStats {
    totalEntries: number;
    byType: Record<CRType, number>;
    lastUpdated: string;
}

/** 概念元数据 */
interface ConceptMeta {
    id: string;
    type: CRType;
    vectorFilePath: string;
    lastModified: number;
    hasEmbedding: boolean;
}

/** 向量索引元数据 */
export interface VectorIndexMeta {
    version: string;
    lastUpdated: number;
    embeddingModel?: string;
    dimensions?: number;
    needsRebuild?: boolean;
    stats: {
        totalConcepts: number;
        byType: Record<CRType, number>;
    };
    concepts: Record<string, ConceptMeta>;
}

/** 单个概念向量文件 */
export interface ConceptVector {
    id: string;
    type: CRType;
    embedding: number[];
    metadata: {
        createdAt: number;
        updatedAt: number;
        embeddingModel: string;
        dimensions: number;
    };
}

// ============================================================================
// 持久化存储
// ============================================================================

/** 重复对存储 */
export interface DuplicatePairsStore {
    version: string;
    pairs: DuplicatePair[];
    dismissedPairs: string[];
}

/** 队列状态文件 */
export interface QueueStateFile {
    version: "1.0.0" | "2.0.0";
    pendingTasks: Array<{
        id: string;
        nodeId: string;
        taskType: TaskType;
        attempt: number;
        maxAttempts: number;
        providerRef?: string;
        promptRef?: string;
        payload?: AnyTaskPayload | Record<string, unknown>;
        created?: string;
        updated?: string;
        errors?: TaskError[];
    }>;
    paused: boolean;
}
