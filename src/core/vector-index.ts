/**
 * VectorIndex 组件
 * 实现向量存储、检索和相似度计算
 * 按类型分桶存储，支持本地持久化
 */

import {
  Result,
  ok,
  err,
  VectorEntry,
  SearchResult,
  IndexStats,
  CRType,
} from "../types";
import { FileStorage } from "../data/file-storage";

/**
 * 向量索引数据结构
 */
interface VectorIndexData {
  /** 版本号 */
  version: string;
  /** 按类型分桶的向量条目 */
  entries: Record<CRType, VectorEntry[]>;
  /** 最后更新时间 */
  lastUpdated: string;
}

/**
 * VectorIndex 接口
 */
export interface IVectorIndex {
  /** 插入或更新向量条目 */
  upsert(entry: VectorEntry): Promise<Result<void>>;
  /** 删除向量条目 */
  delete(uid: string): Promise<Result<void>>;
  /** 搜索相似向量 */
  search(
    type: CRType,
    embedding: number[],
    topK: number
  ): Promise<Result<SearchResult[]>>;
  /** 获取索引统计信息 */
  getStats(): IndexStats;
  /** 加载索引 */
  load(): Promise<Result<void>>;
  /** 保存索引 */
  save(): Promise<Result<void>>;
}

/**
 * VectorIndex 实现
 */
export class VectorIndex implements IVectorIndex {
  private static readonly INDEX_FILE = "vector-index.json";
  private static readonly VERSION = "1.0.0";

  private storage: FileStorage;
  private data: VectorIndexData;

  constructor(storage: FileStorage) {
    this.storage = storage;
    this.data = this.createEmptyIndex();
  }

  /**
   * 创建空索引
   */
  private createEmptyIndex(): VectorIndexData {
    return {
      version: VectorIndex.VERSION,
      entries: {
        Domain: [],
        Issue: [],
        Theory: [],
        Entity: [],
        Mechanism: [],
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 加载索引
   */
  async load(): Promise<Result<void>> {
    const exists = await this.storage.exists(VectorIndex.INDEX_FILE);
    if (!exists) {
      // 文件不存在，使用空索引
      this.data = this.createEmptyIndex();
      return ok(undefined);
    }

    const result = await this.storage.readJSON<VectorIndexData>(
      VectorIndex.INDEX_FILE
    );
    if (!result.ok) {
      return result;
    }

    // 验证数据结构
    const data = result.value;
    if (!data.entries || typeof data.entries !== "object") {
      return err(
        "INVALID_INDEX_DATA",
        "索引数据格式无效：缺少 entries 字段"
      );
    }

    this.data = data;
    return ok(undefined);
  }

  /**
   * 保存索引
   */
  async save(): Promise<Result<void>> {
    this.data.lastUpdated = new Date().toISOString();
    return await this.storage.writeJSON(VectorIndex.INDEX_FILE, this.data);
  }

  /**
   * 插入或更新向量条目
   */
  async upsert(entry: VectorEntry): Promise<Result<void>> {
    // 验证输入
    if (!entry.uid || !entry.type || !entry.embedding) {
      return err(
        "INVALID_ENTRY",
        "向量条目无效：缺少必填字段 (uid, type, embedding)"
      );
    }

    if (!Array.isArray(entry.embedding) || entry.embedding.length === 0) {
      return err("INVALID_EMBEDDING", "向量嵌入无效：必须是非空数组");
    }

    // 获取对应类型的桶
    const bucket = this.data.entries[entry.type];
    if (!bucket) {
      return err("INVALID_TYPE", `无效的知识类型: ${entry.type}`);
    }

    // 查找是否已存在
    const existingIndex = bucket.findIndex((e) => e.uid === entry.uid);
    if (existingIndex >= 0) {
      // 更新现有条目
      bucket[existingIndex] = entry;
    } else {
      // 添加新条目
      bucket.push(entry);
    }

    // 持久化
    return await this.save();
  }

  /**
   * 删除向量条目
   */
  async delete(uid: string): Promise<Result<void>> {
    if (!uid) {
      return err("INVALID_UID", "UID 不能为空");
    }

    let found = false;

    // 在所有类型的桶中查找并删除
    for (const type of Object.keys(this.data.entries) as CRType[]) {
      const bucket = this.data.entries[type];
      const index = bucket.findIndex((e) => e.uid === uid);
      if (index >= 0) {
        bucket.splice(index, 1);
        found = true;
        break;
      }
    }

    if (!found) {
      return err("ENTRY_NOT_FOUND", `未找到 UID 为 ${uid} 的向量条目`);
    }

    // 持久化
    return await this.save();
  }

  /**
   * 计算余弦相似度
   * 公式: cos(θ) = (A · B) / (||A|| * ||B||)
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("向量维度不匹配");
    }

    if (a.length === 0) {
      return 0;
    }

    // 计算点积
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }

    // 计算模长
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    // 避免除以零
    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 搜索相似向量（TopK）
   */
  async search(
    type: CRType,
    embedding: number[],
    topK: number
  ): Promise<Result<SearchResult[]>> {
    // 验证输入
    if (!type) {
      return err("INVALID_TYPE", "知识类型不能为空");
    }

    if (!Array.isArray(embedding) || embedding.length === 0) {
      return err("INVALID_EMBEDDING", "向量嵌入无效：必须是非空数组");
    }

    if (topK <= 0) {
      return err("INVALID_TOP_K", "TopK 必须大于 0");
    }

    // 获取对应类型的桶
    const bucket = this.data.entries[type];
    if (!bucket) {
      return err("INVALID_TYPE", `无效的知识类型: ${type}`);
    }

    // 如果桶为空，返回空结果
    if (bucket.length === 0) {
      return ok([]);
    }

    // 计算所有条目的相似度
    const results: Array<SearchResult & { similarity: number }> = [];
    for (const entry of bucket) {
      try {
        const similarity = this.cosineSimilarity(embedding, entry.embedding);
        results.push({
          uid: entry.uid,
          similarity,
          name: entry.name,
          path: entry.path,
        });
      } catch (error) {
        // 跳过维度不匹配的条目
        continue;
      }
    }

    // 按相似度降序排序
    results.sort((a, b) => b.similarity - a.similarity);

    // 取 TopK
    const topResults = results.slice(0, Math.min(topK, results.length));

    return ok(topResults);
  }

  /**
   * 获取索引统计信息
   */
  getStats(): IndexStats {
    const byType: Record<CRType, number> = {
      Domain: this.data.entries.Domain.length,
      Issue: this.data.entries.Issue.length,
      Theory: this.data.entries.Theory.length,
      Entity: this.data.entries.Entity.length,
      Mechanism: this.data.entries.Mechanism.length,
    };

    const totalEntries = Object.values(byType).reduce(
      (sum, count) => sum + count,
      0
    );

    return {
      totalEntries,
      byType,
      lastUpdated: this.data.lastUpdated,
    };
  }
}
