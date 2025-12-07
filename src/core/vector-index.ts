/**
 * VectorIndex 实现
 * 按类型分桶存储向量，支持同类型相似度检索
 */

import {
  IVectorIndex,
  VectorEntry,
  SearchResult,
  IndexStats,
  CRType,
  VectorIndexFile,
  Result,
  ok,
  err,
  IFileStorage,
} from "../types";

/**
 * VectorIndex 实现类
 */
export class VectorIndex implements IVectorIndex {
  private indexFilePath: string;
  private fileStorage: IFileStorage;
  private buckets: Record<CRType, VectorEntry[]>;
  private model: string;
  private dimension: number;

  /**
   * 构造函数
   * @param indexFilePath 索引文件路径
   * @param fileStorage 文件存储实例
   * @param model 嵌入模型标识
   * @param dimension 向量维度
   */
  constructor(
    indexFilePath: string,
    fileStorage: IFileStorage,
    model: string = "text-embedding-3-small",
    dimension: number = 1536
  ) {
    this.indexFilePath = indexFilePath;
    this.fileStorage = fileStorage;
    this.model = model;
    this.dimension = dimension;
    
    // 初始化空桶
    this.buckets = {
      Domain: [],
      Issue: [],
      Theory: [],
      Entity: [],
      Mechanism: [],
    };
  }

  /**
   * 加载索引
   */
  async load(): Promise<Result<void>> {
    try {
      const exists = await this.fileStorage.exists(this.indexFilePath);
      
      if (!exists) {
        // 索引文件不存在，创建新索引
        await this.save();
        return ok(undefined);
      }

      const readResult = await this.fileStorage.read(this.indexFilePath);
      if (!readResult.ok) {
        return readResult;
      }

      const indexFile: VectorIndexFile = JSON.parse(readResult.value);
      
      // 验证模型和维度
      if (indexFile.model !== this.model) {
        return err(
          "E302",
          `Index model mismatch: expected ${this.model}, got ${indexFile.model}`,
          { expected: this.model, actual: indexFile.model }
        );
      }

      if (indexFile.dimension !== this.dimension) {
        return err(
          "E302",
          `Index dimension mismatch: expected ${this.dimension}, got ${indexFile.dimension}`,
          { expected: this.dimension, actual: indexFile.dimension }
        );
      }

      // 加载桶数据
      this.buckets = indexFile.buckets;

      return ok(undefined);
    } catch (error) {
      return err(
        "E300",
        "Failed to load vector index",
        error
      );
    }
  }

  /**
   * 添加或更新向量条目
   */
  async upsert(entry: VectorEntry): Promise<Result<void>> {
    try {
      // 验证向量维度
      if (entry.embedding.length !== this.dimension) {
        return err(
          "E001",
          `Invalid embedding dimension: expected ${this.dimension}, got ${entry.embedding.length}`,
          { expected: this.dimension, actual: entry.embedding.length }
        );
      }

      const bucket = this.buckets[entry.type];
      
      // 查找是否已存在
      const existingIndex = bucket.findIndex((e) => e.uid === entry.uid);
      
      if (existingIndex >= 0) {
        // 更新现有条目
        bucket[existingIndex] = entry;
      } else {
        // 添加新条目
        bucket.push(entry);
      }

      // 保存索引
      await this.save();

      return ok(undefined);
    } catch (error) {
      return err(
        "E301",
        "Failed to upsert vector entry",
        error
      );
    }
  }

  /**
   * 删除向量条目
   */
  async delete(uid: string): Promise<Result<void>> {
    try {
      let found = false;

      // 在所有桶中查找并删除
      for (const type of Object.keys(this.buckets) as CRType[]) {
        const bucket = this.buckets[type];
        const index = bucket.findIndex((e) => e.uid === uid);
        
        if (index >= 0) {
          bucket.splice(index, 1);
          found = true;
          break;
        }
      }

      if (!found) {
        return err(
          "E004",
          `Vector entry not found: ${uid}`,
          { uid }
        );
      }

      // 保存索引
      await this.save();

      return ok(undefined);
    } catch (error) {
      return err(
        "E301",
        "Failed to delete vector entry",
        error
      );
    }
  }

  /**
   * 搜索相似概念（仅在同类型桶内检索）
   */
  async search(
    type: CRType,
    embedding: number[],
    topK: number
  ): Promise<Result<SearchResult[]>> {
    try {
      // 验证向量维度
      if (embedding.length !== this.dimension) {
        return err(
          "E001",
          `Invalid embedding dimension: expected ${this.dimension}, got ${embedding.length}`,
          { expected: this.dimension, actual: embedding.length }
        );
      }

      const bucket = this.buckets[type];
      
      // 计算所有条目的相似度
      const results: Array<{ entry: VectorEntry; similarity: number }> = [];
      
      for (const entry of bucket) {
        const similarity = this.cosineSimilarity(embedding, entry.embedding);
        results.push({ entry, similarity });
      }

      // 按相似度降序排序
      results.sort((a, b) => b.similarity - a.similarity);

      // 取前 topK 个结果
      const topResults = results.slice(0, topK);

      // 转换为 SearchResult 格式
      const searchResults: SearchResult[] = topResults.map((r) => ({
        uid: r.entry.uid,
        similarity: r.similarity,
        name: r.entry.name,
        path: r.entry.path,
      }));

      return ok(searchResults);
    } catch (error) {
      return err(
        "E302",
        "Failed to search vector index",
        error
      );
    }
  }

  /**
   * 获取索引统计信息
   */
  getStats(): IndexStats {
    const byType: Record<CRType, number> = {
      Domain: this.buckets.Domain.length,
      Issue: this.buckets.Issue.length,
      Theory: this.buckets.Theory.length,
      Entity: this.buckets.Entity.length,
      Mechanism: this.buckets.Mechanism.length,
    };

    const totalEntries = Object.values(byType).reduce((sum, count) => sum + count, 0);

    return {
      totalEntries,
      byType,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 根据 UID 获取条目
   */
  getEntry(uid: string): VectorEntry | undefined {
    for (const type of Object.keys(this.buckets) as CRType[]) {
      const bucket = this.buckets[type];
      const entry = bucket.find(e => e.uid === uid);
      if (entry) {
        return { ...entry };
      }
    }
    return undefined;
  }

  /**
   * 保存索引到文件
   */
  private async save(): Promise<void> {
    const stats = this.getStats();
    
    const indexFile: VectorIndexFile = {
      version: "1.0.0",
      model: this.model,
      dimension: this.dimension,
      buckets: this.buckets,
      metadata: {
        totalCount: stats.totalEntries,
        lastUpdated: stats.lastUpdated,
      },
    };

    const content = JSON.stringify(indexFile, null, 2);
    const writeResult = await this.fileStorage.write(this.indexFilePath, content);
    
    if (!writeResult.ok) {
      throw new Error(`Failed to save vector index: ${writeResult.error.message}`);
    }
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }
}
