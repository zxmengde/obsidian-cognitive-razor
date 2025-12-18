/** VectorIndex - 按类型分桶存储向量，支持延迟加载和增量更新 */

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
  ConceptMeta,
} from "../types";
import { VECTORS_DIR, DEFAULT_VECTOR_INDEX_META } from "../data/file-storage";
import type { FileStorage } from "../data/file-storage";
import { formatCRTimestamp } from "../utils/date-utils";
import type { CruidCache } from "./cruid-cache";

/** VectorIndex 实现类 - 分桶存储、延迟加载、增量更新 */
export class VectorIndex {
  private fileStorage: FileStorage;
  private logger: ILogger | null;
  private model: string;
  private dimension: number;
  private cruidCache: CruidCache | null;
  
  // 元数据索引（轻量级，始终在内存中）
  private indexMeta: VectorIndexMeta | null = null;
  
  // 向量缓存（按需加载）
  private loadedVectors: Map<string, ConceptVector> = new Map();

  /** 构造函数 */
  constructor(
    fileStorage: FileStorage,
    model: string = "text-embedding-3-small",
    dimension: number = 1536,
    logger: ILogger | null = null,
    cruidCache: CruidCache | null = null
  ) {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.model = model;
    this.dimension = dimension;
    this.cruidCache = cruidCache;
  }

  /** 加载索引元数据 */
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

        // 记录当前嵌入配置到元数据（避免模型/维度漂移）
        this.indexMeta.embeddingModel = this.model;
        this.indexMeta.dimensions = this.dimension;

        const saveResult = await this.saveIndexMeta();
        if (!saveResult.ok) {
          return saveResult;
        }
        return ok(undefined);
      }

      this.indexMeta = metaResult.value;

      // 校验并对齐嵌入配置（索引元数据是 Runtime SSOT）
      const configResult = await this.ensureEmbeddingConfigConsistency();
      if (!configResult.ok) {
        return configResult;
      }
      
      // 迁移旧格式数据：移除冗余字段（name/notePath 等）
      const migrationResult = await this.migrateMetaSchema();
      if (!migrationResult.ok) {
        // 迁移失败不阻断加载，仅记录警告
        this.logger?.warn("VectorIndex", "迁移旧格式数据时出现警告", {
          error: migrationResult.error
        });
      }
      
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
   * 索引元数据中记录的嵌入配置是 Runtime SSOT：
   * - 维度必须全量一致（否则相似度计算无意义）
   * - 模型必须一致（不同模型的向量空间不可比较）
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

    if (metaDimensions !== undefined) {
      if (metaDimensions !== this.dimension) {
        this.logger?.warn("VectorIndex", "检测到 embedding 维度配置不一致，已使用索引元数据中的维度", {
          configured: this.dimension,
          meta: metaDimensions,
        });
        this.dimension = metaDimensions;
      }
    } else {
      this.indexMeta.dimensions = this.dimension;
      needsSave = true;
    }

    if (metaModel) {
      if (metaModel !== this.model) {
        this.logger?.warn("VectorIndex", "检测到 embedding 模型配置不一致，已使用索引元数据中的模型", {
          configured: this.model,
          meta: metaModel,
        });
        this.model = metaModel;
      }
    } else {
      this.indexMeta.embeddingModel = this.model;
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
      // 更新版本号（仅用于诊断，不影响功能）
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

      // 归一化向量（性能优化：预先归一化，计算相似度时只需点积）
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
      } else if (!isUpdate) {
        // 新增概念
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

      // 更新缓存
      this.loadedVectors.set(entry.uid, conceptVector);

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
      delete this.indexMeta.concepts[uid];
      this.indexMeta.stats.totalConcepts--;
      this.indexMeta.stats.byType[meta.type]--;
      this.indexMeta.lastUpdated = Date.now();

      // 从缓存中移除
      this.loadedVectors.delete(uid);

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

  /** 搜索相似概念（同类型桶内检索） */
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

      // 加载该类型的所有向量
      const vectorsResult = await this.loadVectorsByType(type);
      if (!vectorsResult.ok) {
        return vectorsResult as Result<SearchResult[]>;
      }

      const vectors = vectorsResult.value;

      // 使用局部排序，仅维护 topK
      const topResults: Array<{ vector: ConceptVector; similarity: number }> = [];
      
      for (const vector of vectors) {
        // 使用点积计算相似度（向量已归一化）
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

  /** 搜索相似概念（同类型桶内检索，按阈值全量过滤） */
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

      // 加载该类型的所有向量
      const vectorsResult = await this.loadVectorsByType(type);
      if (!vectorsResult.ok) {
        return vectorsResult as Result<SearchResult[]>;
      }

      const vectors = vectorsResult.value;

      const matched: Array<{ vector: ConceptVector; similarity: number }> = [];
      for (const vector of vectors) {
        const similarity = this.dotProduct(normalizedQuery, vector.embedding);
        if (similarity > threshold) {
          matched.push({ vector, similarity });
        }
      }

      matched.sort((a, b) => b.similarity - a.similarity);

      // 转换为 SearchResult 格式（name/path 运行时通过 CruidCache 解析）
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
    const cached = this.loadedVectors.get(uid);
    if (cached) {
      return {
        uid: cached.id,
        type: cached.type,
        embedding: cached.embedding,
        updated: formatCRTimestamp(new Date(cached.metadata.updatedAt)),
      };
    }

    // 否则返回元数据（不包含向量）
    return undefined;
  }

  /** 延迟加载：按类型加载向量 */
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
        // 检查缓存
        let vector = this.loadedVectors.get(meta.id);
        
        if (!vector) {
          // 从文件加载
          const readResult = await this.fileStorage.readVectorFile(type, meta.id);
          if (readResult.ok) {
            vector = readResult.value;
            this.loadedVectors.set(meta.id, vector);
          } else {
            // 文件读取失败，跳过该向量
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

  /**
   * 保存元数据索引
   */
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
   * @param a 归一化向量 A
   * @param b 归一化向量 B
   * @returns 相似度 (0-1)
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
}
