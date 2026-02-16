/**
 * VectorIndex — 按类型分桶存储向量，支持按需加载与 TTL 驱逐
 *
 * 重构要点：
 * - load() 仅加载 index.json 元数据，不加载向量文件
 * - ensureBucketLoaded() 按需加载指定类型的向量桶
 * - TTL 驱逐机制（默认 5 分钟），通过 registerInterval 注册定时器
 * - embedding 模型/维度一致性检查（不匹配时标记 needsRebuild）
 *
 * @see 需求 16.1, 16.2, 16.3, 16.4, 16.5
 */

import {
  ILogger,
  VectorEntry,
  SearchResult,
  IndexStats,
  CRType,
  Result,
  ok,
  err,
  Err,
  ConceptVector,
  VectorIndexMeta,
} from "../types";
import { VECTORS_DIR, DEFAULT_VECTOR_INDEX_META } from "../data/file-storage";
import type { FileStorage } from "../data/file-storage";
import { formatCRTimestamp } from "../utils/date-utils";
import type { CruidCache } from "./cruid-cache";

// ============================================================================
// 类型定义
// ============================================================================

/** 按类型分桶的向量缓存 */
interface TypeBucket {
  /** 知识类型 */
  type: CRType;
  /** 该类型下所有向量 */
  vectors: ConceptVector[];
  /** 桶加载时间戳 */
  loadedAt: number;
  /** 最后访问时间戳（用于 TTL 驱逐） */
  lastAccessedAt: number;
}

/**
 * registerInterval 回调类型
 * 由 Plugin 层注入，确保定时器随插件卸载自动清理
 */
export type RegisterIntervalFn = (callback: () => void, intervalMs: number) => number;

// ============================================================================
// VectorIndex 实现
// ============================================================================

/** VectorIndex 实现类 — 分桶存储、按需加载、TTL 驱逐 */
export class VectorIndex {
  private fileStorage: FileStorage;
  private logger: ILogger | null;
  private model: string;
  private dimension: number;
  private cruidCache: CruidCache | null;
  private registerIntervalFn: RegisterIntervalFn | null;

  // 元数据索引（轻量级，始终在内存中）
  private indexMeta: VectorIndexMeta | null = null;

  // 按类型分桶的向量缓存（按需加载）
  private buckets: Map<CRType, TypeBucket> = new Map();

  // 单条向量缓存（upsert 后立即可用，不依赖桶加载）
  private recentVectors: Map<string, ConceptVector> = new Map();

  /** recentVectors 最大容量（防止内存无限增长，需求 24.3） */
  private readonly maxRecentVectors: number = 500;

  // TTL 配置（默认 5 分钟）
  private readonly ttlMs: number = 5 * 60 * 1000;

  // 驱逐定时器 ID
  private evictionTimer: number | null = null;

  /** 构造函数 */
  constructor(
    fileStorage: FileStorage,
    model: string = "text-embedding-3-small",
    dimension: number = 1536,
    logger: ILogger | null = null,
    cruidCache: CruidCache | null = null,
    registerIntervalFn: RegisterIntervalFn | null = null
  ) {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.model = model;
    this.dimension = dimension;
    this.cruidCache = cruidCache;
    this.registerIntervalFn = registerIntervalFn;
  }

  /**
   * 加载索引元数据（不加载向量文件）
   *
   * @see 需求 16.1 — 启动时仅加载元数据
   */
  async load(): Promise<Result<void>> {
    try {
      // 确保向量目录存在
      const ensureDirResult = await this.fileStorage.ensureDir(VECTORS_DIR);
      if (!ensureDirResult.ok) {
        return ensureDirResult;
      }

      // 为每个类型创建子目录
      const types: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
      for (const type of types) {
        const typeDirResult = await this.fileStorage.ensureDir(`${VECTORS_DIR}/${type}`);
        if (!typeDirResult.ok) {
          return typeDirResult;
        }
      }

      // 读取元数据索引
      const metaResult = await this.fileStorage.readVectorIndexMeta();

      if (!metaResult.ok) {
        // 索引不存在，创建新索引
        this.indexMeta = { ...DEFAULT_VECTOR_INDEX_META };
        this.indexMeta.embeddingModel = this.model;
        this.indexMeta.dimensions = this.dimension;

        const saveResult = await this.saveIndexMeta();
        if (!saveResult.ok) {
          return saveResult;
        }
        this.startEvictionTimer();
        return ok(undefined);
      }

      this.indexMeta = metaResult.value;

      // 校验 embedding 模型/维度一致性（需求 16.5）
      const configResult = await this.ensureEmbeddingConfigConsistency();
      if (!configResult.ok) {
        return configResult;
      }

      // 迁移旧格式数据
      const migrationResult = await this.migrateMetaSchema();
      if (!migrationResult.ok) {
        this.logger?.warn("VectorIndex", "迁移旧格式数据时出现警告", {
          error: migrationResult.error
        });
      }

      // 启动 TTL 驱逐定时器
      this.startEvictionTimer();

      return ok(undefined);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to load vector index",
        error
      );
    }
  }

  /**
   * 按需加载指定类型的向量桶
   *
   * 如果桶已在内存中，更新 lastAccessedAt 并直接返回。
   * 否则从文件系统加载该类型的所有向量文件。
   *
   * @see 需求 16.2 — 按需加载
   * @see 需求 16.4 — 加载失败返回错误并记录日志
   */
  private async ensureBucketLoaded(type: CRType): Promise<Result<TypeBucket>> {
    // 检查桶是否已加载
    const existing = this.buckets.get(type);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return ok(existing);
    }

    // 按需加载该类型的向量
    const vectorsResult = await this.loadVectorsByType(type);
    if (!vectorsResult.ok) {
      this.logger?.warn("VectorIndex", `按需加载类型 ${type} 的向量桶失败`, {
        type,
        error: (vectorsResult as Err).error.message
      });
      return vectorsResult as Result<TypeBucket>;
    }

    const now = Date.now();
    const bucket: TypeBucket = {
      type,
      vectors: vectorsResult.value,
      loadedAt: now,
      lastAccessedAt: now,
    };
    this.buckets.set(type, bucket);

    this.logger?.debug("VectorIndex", `类型 ${type} 的向量桶已按需加载`, {
      type,
      vectorCount: bucket.vectors.length,
    });

    return ok(bucket);
  }

  /**
   * TTL 驱逐：清除超时未访问的向量桶
   *
   * @see 需求 16.3 — 一定时间内未访问时释放内存
   */
  private evictStale(): void {
    const now = Date.now();
    for (const [type, bucket] of this.buckets) {
      if (now - bucket.lastAccessedAt > this.ttlMs) {
        this.buckets.delete(type);
        this.logger?.debug("VectorIndex", `类型 ${type} 的向量桶已驱逐（TTL 过期）`, {
          type,
          lastAccessedAt: bucket.lastAccessedAt,
          ttlMs: this.ttlMs,
        });
      }
    }
  }

  /**
   * 启动 TTL 驱逐定时器
   * 优先使用 registerInterval（Obsidian 自动清理），否则回退到 window.setInterval
   */
  private startEvictionTimer(): void {
    if (this.evictionTimer !== null) return;

    const callback = () => this.evictStale();
    // 每分钟检查一次
    const intervalMs = 60 * 1000;

    if (this.registerIntervalFn) {
      this.evictionTimer = this.registerIntervalFn(callback, intervalMs);
    } else {
      this.evictionTimer = window.setInterval(callback, intervalMs);
    }
  }

  /**
   * embedding 模型/维度一致性检查
   *
   * 重构后行为（需求 16.5）：
   * - 模型或维度不匹配时标记 needsRebuild = true，记录警告
   * - 不再静默覆盖当前配置，而是保留当前配置并提示用户重建
   * - 元数据中缺少模型/维度信息时，写入当前配置（首次初始化场景）
   */
  private async ensureEmbeddingConfigConsistency(): Promise<Result<void>> {
    if (!this.indexMeta) {
      return ok(undefined);
    }

    let needsSave = false;

    const metaDimensions =
      typeof this.indexMeta.dimensions === "number" && Number.isFinite(this.indexMeta.dimensions) && this.indexMeta.dimensions > 0
        ? Math.floor(this.indexMeta.dimensions)
        : undefined;

    const metaModel =
      typeof this.indexMeta.embeddingModel === "string" && this.indexMeta.embeddingModel.trim().length > 0
        ? this.indexMeta.embeddingModel.trim()
        : undefined;

    // 检测模型不匹配
    if (metaModel && metaModel !== this.model) {
      this.logger?.warn("VectorIndex", "检测到 embedding 模型不一致，索引需要重建", {
        configured: this.model,
        indexed: metaModel,
      });
      this.indexMeta.needsRebuild = true;
      needsSave = true;
    }

    // 检测维度不匹配
    if (metaDimensions !== undefined && metaDimensions !== this.dimension) {
      this.logger?.warn("VectorIndex", "检测到 embedding 维度不一致，索引需要重建", {
        configured: this.dimension,
        indexed: metaDimensions,
      });
      this.indexMeta.needsRebuild = true;
      needsSave = true;
    }

    // 元数据中缺少模型/维度信息时写入当前配置
    if (!metaModel) {
      this.indexMeta.embeddingModel = this.model;
      needsSave = true;
    }
    if (metaDimensions === undefined) {
      this.indexMeta.dimensions = this.dimension;
      needsSave = true;
    }

    if (needsSave) {
      return this.saveIndexMeta();
    }

    return ok(undefined);
  }

  /**
   * 迁移索引元数据结构（删除冗余字段，修复旧字段命名）
   *
   * 目标：ConceptMeta 中不再保存 name/notePath；向量文件不再保存 name。
   */
  private async migrateMetaSchema(): Promise<Result<void>> {
    if (!this.indexMeta) {
      return ok(undefined);
    }

    let needsSave = false;
    const migratedConceptIds: string[] = [];

    for (const [uid, meta] of Object.entries(this.indexMeta.concepts)) {
      const legacyMeta = meta as unknown as Record<string, unknown>;
      let migrated = false;

      // 兼容：旧字段 filePath → vectorFilePath
      if (typeof legacyMeta.filePath === "string" && typeof legacyMeta.vectorFilePath !== "string") {
        (legacyMeta as Record<string, unknown>).vectorFilePath = legacyMeta.filePath;
        delete legacyMeta.filePath;
        migrated = true;
      }

      // 移除冗余字段
      if ("name" in legacyMeta) {
        delete legacyMeta.name;
        migrated = true;
      }
      if ("notePath" in legacyMeta) {
        delete legacyMeta.notePath;
        migrated = true;
      }

      // 修复缺失的 id / vectorFilePath
      if (typeof legacyMeta.id !== "string") {
        (legacyMeta as Record<string, unknown>).id = uid;
        migrated = true;
      }
      if (typeof legacyMeta.vectorFilePath !== "string") {
        const type = typeof legacyMeta.type === "string" ? legacyMeta.type : "Entity";
        (legacyMeta as Record<string, unknown>).vectorFilePath = `${type}/${uid}.json`;
        migrated = true;
      }

      if (migrated) {
        needsSave = true;
        migratedConceptIds.push(uid);
      }
    }

    if (needsSave) {
      this.indexMeta.version = "3.0";

      this.logger?.info("VectorIndex", `向量索引元数据已迁移，共 ${migratedConceptIds.length} 个条目`, {
        migratedCount: migratedConceptIds.length
      });
      const saveResult = await this.saveIndexMeta();
      if (!saveResult.ok) {
        return saveResult;
      }
    }

    return ok(undefined);
  }

  /** 添加或更新向量条目 */
  async upsert(entry: VectorEntry): Promise<Result<void>> {
    try {
      if (!this.indexMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }

      // 验证向量维度
      if (entry.embedding.length !== this.dimension) {
        return err(
          "E305_VECTOR_MISMATCH",
          `Invalid embedding dimension: expected ${this.dimension}, got ${entry.embedding.length}`,
          { expected: this.dimension, actual: entry.embedding.length }
        );
      }

      const now = Date.now();
      const isUpdate = entry.uid in this.indexMeta.concepts;

      // 归一化向量（预先归一化，计算相似度时只需点积）
      const normalizedEmbedding = this.normalize(entry.embedding);

      // 构建概念向量数据
      const conceptVector: ConceptVector = {
        id: entry.uid,
        type: entry.type,
        embedding: normalizedEmbedding,
        metadata: {
          createdAt: isUpdate
            ? this.indexMeta.concepts[entry.uid]?.lastModified || now
            : now,
          updatedAt: now,
          embeddingModel: this.model,
          dimensions: this.dimension,
        },
      };

      // 写入向量文件
      const writeResult = await this.fileStorage.writeVectorFile(
        entry.type,
        entry.uid,
        conceptVector
      );

      if (!writeResult.ok) {
        return writeResult;
      }

      // 更新元数据索引
      const oldType = this.indexMeta.concepts[entry.uid]?.type;

      // 如果类型变更，需要删除旧文件并更新统计
      if (isUpdate && oldType && oldType !== entry.type) {
        await this.fileStorage.deleteVectorFile(oldType, entry.uid);
        this.indexMeta.stats.byType[oldType]--;
        this.indexMeta.stats.byType[entry.type]++;

        // 使旧类型桶缓存失效（类型变更后桶数据已过时）
        this.buckets.delete(oldType);
      } else if (!isUpdate) {
        this.indexMeta.stats.totalConcepts++;
        this.indexMeta.stats.byType[entry.type]++;
      }

      this.indexMeta.concepts[entry.uid] = {
        id: entry.uid,
        type: entry.type,
        vectorFilePath: `${entry.type}/${entry.uid}.json`,
        lastModified: now,
        hasEmbedding: true,
      };

      this.indexMeta.lastUpdated = now;

      // 更新单条缓存（upsert 后立即可用于 getEntry）
      this.setRecentVector(entry.uid, conceptVector);

      // 使该类型桶缓存失效（下次访问时重新加载，确保数据一致性）
      this.buckets.delete(entry.type);

      // 保存元数据索引
      const saveResult = await this.saveIndexMeta();
      if (!saveResult.ok) {
        return saveResult;
      }

      return ok(undefined);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to upsert vector entry",
        error
      );
    }
  }

  /** 删除向量条目 */
  async delete(uid: string): Promise<Result<void>> {
    try {
      if (!this.indexMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }

      const meta = this.indexMeta.concepts[uid];
      if (!meta) {
        return err(
          "E311_NOT_FOUND",
          `Vector entry not found: ${uid}`,
          { uid }
        );
      }

      // 删除向量文件
      const deleteResult = await this.fileStorage.deleteVectorFile(meta.type, uid);
      if (!deleteResult.ok) {
        return deleteResult;
      }

      // 更新元数据索引
      const deletedType = meta.type;
      delete this.indexMeta.concepts[uid];
      this.indexMeta.stats.totalConcepts--;
      this.indexMeta.stats.byType[deletedType]--;
      this.indexMeta.lastUpdated = Date.now();

      // 从缓存中移除
      this.recentVectors.delete(uid);
      // 使该类型桶缓存失效
      this.buckets.delete(deletedType);

      // 保存元数据索引
      const saveResult = await this.saveIndexMeta();
      if (!saveResult.ok) {
        return saveResult;
      }

      return ok(undefined);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to delete vector entry",
        error
      );
    }
  }

  /**
   * 搜索相似概念（同类型桶内检索）
   * 内部通过 ensureBucketLoaded 按需加载向量
   */
  async search(
    type: CRType,
    embedding: number[],
    topK: number
  ): Promise<Result<SearchResult[]>> {
    try {
      if (!this.indexMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }

      // 验证向量维度
      if (embedding.length !== this.dimension) {
        return err(
          "E305_VECTOR_MISMATCH",
          `Invalid embedding dimension: expected ${this.dimension}, got ${embedding.length}`,
          { expected: this.dimension, actual: embedding.length }
        );
      }

      // 归一化查询向量
      const normalizedQuery = this.normalize(embedding);

      // 按需加载该类型的向量桶
      const bucketResult = await this.ensureBucketLoaded(type);
      if (!bucketResult.ok) {
        return bucketResult as Result<SearchResult[]>;
      }

      const vectors = bucketResult.value.vectors;

      // 使用局部排序，仅维护 topK
      const topResults: Array<{ vector: ConceptVector; similarity: number }> = [];

      for (const vector of vectors) {
        const similarity = this.dotProduct(normalizedQuery, vector.embedding);

        if (topResults.length < topK) {
          topResults.push({ vector, similarity });
          topResults.sort((a, b) => b.similarity - a.similarity);
        } else if (similarity > topResults[topResults.length - 1].similarity) {
          topResults[topResults.length - 1] = { vector, similarity };
          topResults.sort((a, b) => b.similarity - a.similarity);
        }
      }

      // 转换为 SearchResult 格式（name/path 运行时通过 CruidCache 解析）
      const searchResults: SearchResult[] = topResults.map((r) => ({
        uid: r.vector.id,
        similarity: r.similarity,
        name: this.cruidCache?.getName(r.vector.id) || r.vector.id,
        path: this.cruidCache?.getPath(r.vector.id) || "",
      }));

      return ok(searchResults);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to search vector index",
        error
      );
    }
  }

  /**
   * 搜索相似概念（同类型桶内检索，按阈值全量过滤）
   * 内部通过 ensureBucketLoaded 按需加载向量
   */
  async searchAboveThreshold(
    type: CRType,
    embedding: number[],
    threshold: number
  ): Promise<Result<SearchResult[]>> {
    try {
      if (!this.indexMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }

      if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
        return err("E101_INVALID_INPUT", `无效的相似度阈值: ${threshold}`, { threshold });
      }

      // 验证向量维度
      if (embedding.length !== this.dimension) {
        return err(
          "E305_VECTOR_MISMATCH",
          `Invalid embedding dimension: expected ${this.dimension}, got ${embedding.length}`,
          { expected: this.dimension, actual: embedding.length }
        );
      }

      // 归一化查询向量
      const normalizedQuery = this.normalize(embedding);

      // 按需加载该类型的向量桶
      const bucketResult = await this.ensureBucketLoaded(type);
      if (!bucketResult.ok) {
        return bucketResult as Result<SearchResult[]>;
      }

      const vectors = bucketResult.value.vectors;

      const matched: Array<{ vector: ConceptVector; similarity: number }> = [];
      for (const vector of vectors) {
        const similarity = this.dotProduct(normalizedQuery, vector.embedding);
        if (similarity > threshold) {
          matched.push({ vector, similarity });
        }
      }

      matched.sort((a, b) => b.similarity - a.similarity);

      // 转换为 SearchResult 格式
      const searchResults: SearchResult[] = matched.map((r) => ({
        uid: r.vector.id,
        similarity: r.similarity,
        name: this.cruidCache?.getName(r.vector.id) || r.vector.id,
        path: this.cruidCache?.getPath(r.vector.id) || "",
      }));

      return ok(searchResults);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to search vector index",
        error
      );
    }
  }

  /** 获取索引统计信息 */
  getStats(): IndexStats {
    if (!this.indexMeta) {
      return {
        totalEntries: 0,
        byType: {
          Domain: 0,
          Issue: 0,
          Theory: 0,
          Entity: 0,
          Mechanism: 0,
        },
        lastUpdated: formatCRTimestamp(),
      };
    }

    return {
      totalEntries: this.indexMeta.stats.totalConcepts,
      byType: { ...this.indexMeta.stats.byType },
      lastUpdated: formatCRTimestamp(new Date(this.indexMeta.lastUpdated)),
    };
  }

  /** 当前索引使用的 embedding 模型（Runtime SSOT） */
  getEmbeddingModel(): string {
    return this.model;
  }

  /** 当前索引使用的 embedding 维度（Runtime SSOT） */
  getEmbeddingDimension(): number {
    return this.dimension;
  }

  /** 索引是否需要重建（模型/维度不匹配时为 true） */
  getNeedsRebuild(): boolean {
    return this.indexMeta?.needsRebuild === true;
  }

  /** 根据 UID 获取条目（用于复用已有向量） */
  getEntry(uid: string): VectorEntry | undefined {
    if (!this.indexMeta) {
      return undefined;
    }

    const meta = this.indexMeta.concepts[uid];
    if (!meta) {
      return undefined;
    }

    // 如果已缓存，从缓存返回
    const cached = this.recentVectors.get(uid);
    if (cached) {
      return {
        uid: cached.id,
        type: cached.type,
        embedding: cached.embedding,
        updated: formatCRTimestamp(new Date(cached.metadata.updatedAt)),
      };
    }

    // 否则返回 undefined（向量未加载到内存）
    return undefined;
  }

  /**
   * 获取指定类型的所有向量（按需加载桶）
   * 用于 DuplicateManager 分页检测
   */
  async getVectorsByType(type: CRType): Promise<Result<ConceptVector[]>> {
    try {
      const bucketResult = await this.ensureBucketLoaded(type);
      if (!bucketResult.ok) {
        return bucketResult as Result<ConceptVector[]>;
      }
      return ok([...bucketResult.value.vectors]);
    } catch (error) {
      return err("E500_INTERNAL_ERROR", `获取类型 ${type} 的向量失败`, error);
    }
  }


  /** 延迟加载：按类型加载向量（内部方法，被 ensureBucketLoaded 调用） */
  private async loadVectorsByType(type: CRType): Promise<Result<ConceptVector[]>> {
    try {
      if (!this.indexMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }

      const vectors: ConceptVector[] = [];

      // 获取该类型的所有概念
      const conceptMetas = Object.values(this.indexMeta.concepts).filter(
        (meta) => meta.type === type
      );

      // 加载向量文件
      for (const meta of conceptMetas) {
        // 检查单条缓存
        let vector = this.recentVectors.get(meta.id);

        if (!vector) {
          // 从文件加载
          const readResult = await this.fileStorage.readVectorFile(type, meta.id);
          if (readResult.ok) {
            vector = readResult.value;
            this.setRecentVector(meta.id, vector);
          } else {
            // 文件读取失败，跳过该向量（需求 16.4）
            const error = readResult as Err;
            this.logger?.warn("VectorIndex", `加载向量文件失败: ${meta.id}`, {
              conceptId: meta.id,
              error: error.error.message
            });
            continue;
          }
        }

        vectors.push(vector);
      }

      return ok(vectors);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        `Failed to load vectors for type: ${type}`,
        error
      );
    }
  }

  /** 保存元数据索引 */
  private async saveIndexMeta(): Promise<Result<void>> {
    if (!this.indexMeta) {
      return err("E310_INVALID_STATE", "Index meta not initialized");
    }

    const writeResult = await this.fileStorage.writeVectorIndexMeta(this.indexMeta);
    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(undefined);
  }

  /**
   * 归一化向量
   * @param vector 原始向量
   * @returns 归一化后的向量（模长为 1）
   */
  private normalize(vector: number[]): number[] {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    // 零向量直接返回
    if (norm === 0) {
      return vector;
    }

    // 归一化
    const normalized = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / norm;
    }

    return normalized;
  }

  /**
   * 计算点积（用于归一化向量的相似度计算）
   * 对于归一化向量，点积等于余弦相似度
   */
  private dotProduct(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }

    let product = 0;
    for (let i = 0; i < a.length; i++) {
      product += a[i] * b[i];
    }

    return product;
  }

  /** 释放资源：清除定时器和缓存 */
  dispose(): void {
    if (this.evictionTimer !== null) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    this.buckets.clear();
    this.recentVectors.clear();
  }

  /**
   * 向 recentVectors 缓存写入条目，超出容量时驱逐最早插入的条目
   * Map 迭代顺序 = 插入顺序（需求 24.3）
   */
  private setRecentVector(uid: string, vector: ConceptVector): void {
    // 已存在则先删除再重新插入（刷新到末尾，模拟 LRU）
    if (this.recentVectors.has(uid)) {
      this.recentVectors.delete(uid);
    } else if (this.recentVectors.size >= this.maxRecentVectors) {
      // 驱逐最早插入的条目
      const firstKey = this.recentVectors.keys().next().value;
      if (firstKey !== undefined) {
        this.recentVectors.delete(firstKey);
      }
    }
    this.recentVectors.set(uid, vector);
  }
}
