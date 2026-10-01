/**
 * 存储相关类型定义
 *
 * 向量索引、重复检测、快照、队列状态文件
 */

import type { CRType } from "./domain";

// ============================================================================
// 重复检测
// ============================================================================

/** 重复对状态 */
type DuplicatePairStatus =
    | "pending" | "dismissed";

/** 重复对记录 */
export interface DuplicatePair {
    id: string;
    nodeIdA: string;
    nodeIdB: string;
    type: CRType;
    similarity: number;
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
}

/** 相似度搜索结果 */
export interface SearchResult {
    uid: string;
    similarity: number;
    name: string;
    path: string;
}

/** 概念元数据 */
interface ConceptMeta {
    type: CRType;
}

/** 向量索引元数据 */
export interface VectorIndexMeta {
    version: "5.0";
    /** Provider、端点、协议和模型共同形成的非密钥配置身份。 */
    embeddingProfile: string;
    embeddingModel: string;
    /** Zero is allowed only while an empty index awaits its first embedding. */
    dimensions: number;
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
    version: "2.0.0";
    pairs: DuplicatePair[];
}

/** Physical vector file discovered under the current vector store. */
export interface VectorFileRef {
    type: CRType;
    id: string;
    path: string;
}
