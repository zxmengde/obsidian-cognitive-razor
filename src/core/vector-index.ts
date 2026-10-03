import { err, ok } from "../types";
import type {
  ConceptVector,
  CRType,
  Err,
  ILogger,
  Result,
  SearchResult,
  VectorEntry,
  VectorIndexMeta,
  VectorFileRef,
} from "../types";
import type { FileStorage } from "../data/file-storage";
import type { CruidCache } from "./cruid-cache";
import { dotProduct, normalizeVector } from "./vector-math";

interface TypeBucket {
  vectors: ConceptVector[];
  lastAccessedAt: number;
}

interface LoadedBucket {
  vectors: ConceptVector[];
  invalidIds: string[];
}

const DEFAULT_MODEL = "text-embedding-3-small";
const BUCKET_TTL_MS = 5 * 60 * 1000;
const VECTOR_READ_BATCH_SIZE = 16;
const MAX_RECENT_VECTORS = 500;
const MISSING_FILE_CODES = new Set(["E301_FILE_NOT_FOUND", "E311_NOT_FOUND"]);
const DISCARDABLE_VECTOR_CODES = new Set([...MISSING_FILE_CODES, "E101_INVALID_INPUT"]);

type VectorReadOutcome =
  | { id: string; vector: ConceptVector }
  | { id: string; invalidReason: string }
  | { id: string; error: Err["error"] };

export interface VectorIndexIssue {
  uid: string;
  type: CRType;
  reason: "missing-file" | "invalid-file" | "incompatible-file" | "note-missing";
}

export interface VectorIndexMaintenanceReport {
  indexedEntries: number;
  physicalFiles: number;
  missingEntries: VectorIndexIssue[];
  staleEntries: VectorIndexIssue[];
  invalidEntries: VectorIndexIssue[];
  orphanFiles: VectorFileRef[];
}

export interface VectorCleanupSummary {
  removed: number;
  skipped: number;
  failed: number;
}

/**
 * Persistent vector index with immutable metadata commits and lazy type buckets.
 * Metadata is authoritative; vector files not referenced by it are ignored.
 */
export class VectorIndex {
  private readonly buckets = new Map<CRType, TypeBucket>();
  private readonly recentVectors = new Map<string, ConceptVector>();
  private readonly activeReads = new Set<Promise<unknown>>();

  private indexMeta: VectorIndexMeta | null = null;
  private mutationChain: Promise<void> = Promise.resolve();
  private disposePromise: Promise<void> | undefined;
  private contentVersion = 0;
  private mutationActivityVersion = 0;
  private disposed = false;
  private profile: string;
  private model: string;
  private dimension: number | undefined;
  private dimensionConfigured: boolean;

  constructor(
    private readonly fileStorage: FileStorage,
    model: string = DEFAULT_MODEL,
    dimension?: number,
    private readonly logger: ILogger | null = null,
    private readonly cruidCache: CruidCache | null = null,
    profile?: string,
  ) {
    this.model = model.trim() || DEFAULT_MODEL;
    this.profile = profile?.trim() || this.model;
    this.dimension = Number.isInteger(dimension) && (dimension ?? 0) > 0
      ? dimension
      : undefined;
    this.dimensionConfigured = this.dimension !== undefined;
  }

  /** Load only the current metadata. Vector files remain lazy. */
  async load(): Promise<Result<void>> {
    if (this.disposed) {
      return this.stopped();
    }
    if (this.indexMeta) {
      return ok(undefined);
    }

    const metaResult = await this.fileStorage.readVectorIndexMeta();
    if (this.disposed) {
      return this.stopped();
    }

    if (!metaResult.ok) {
      if (metaResult.error.code !== "E301_FILE_NOT_FOUND" &&
        metaResult.error.code !== "E101_INVALID_INPUT") {
        return metaResult as Result<void>;
      }
      if (metaResult.error.code === "E101_INVALID_INPUT") {
        this.logger?.warn("VectorIndex", "向量索引元数据格式无效，将创建空索引");
      }

      const emptyMeta = this.createEmptyMeta(this.profile, this.model, this.dimension);
      const writeResult = await this.fileStorage.writeVectorIndexMeta(emptyMeta);
      if (!writeResult.ok) {
        return writeResult;
      }
      if (this.disposed) {
        return this.stopped();
      }
      this.indexMeta = emptyMeta;
      this.contentVersion++;
    } else {
      this.indexMeta = metaResult.value;
      this.contentVersion++;
      if (this.indexMeta.embeddingProfile !== this.profile ||
        this.indexMeta.embeddingModel !== this.model ||
        (this.dimensionConfigured && this.indexMeta.dimensions !== this.dimension)) {
        const resetResult = await this.resetIndexNow(this.profile, this.model, this.dimension);
        if (!resetResult.ok) {
          return resetResult;
        }
      } else if (this.dimension === undefined && this.indexMeta.dimensions > 0) {
        this.dimension = this.indexMeta.dimensions;
      }
    }

    if (this.disposed) {
      return this.stopped();
    }
    return ok(undefined);
  }

  upsert(entry: VectorEntry): Promise<Result<void>> {
    const snapshot: VectorEntry = {
      ...entry,
      embedding: [...entry.embedding],
    };
    return this.enqueueMutation("写入向量", () => this.upsertNow(snapshot));
  }

  /** 用一组已生成的向量替换当前索引；读取会等待整个替换操作结束。 */
  replaceAll(entries: VectorEntry[]): Promise<Result<number>> {
    const snapshots = entries.map((entry) => ({
      ...entry,
      embedding: [...entry.embedding],
    }));
    return this.enqueueMutation("重建向量索引", async () => {
      const seenIds = new Set<string>();
      for (const entry of snapshots) {
        if (!entry.uid.trim() || seenIds.has(entry.uid)) {
          return err("E101_INVALID_INPUT", `重建索引包含空或重复 UID: ${entry.uid}`);
        }
        seenIds.add(entry.uid);
        if (!entry.embedding.every((value) => Number.isFinite(value)) || !entry.embedding.some((value) => value !== 0)) {
          return err("E101_INVALID_INPUT", "向量必须包含有限且非全零的数值") as Result<number>;
        }
      }
      return this.replaceAllNow(snapshots);
    });
  }

  delete(uid: string): Promise<Result<void>> {
    return this.enqueueMutation("删除向量", () => this.deleteNow(uid));
  }

  search(
    type: CRType,
    embedding: number[],
    topK: number,
  ): Promise<Result<SearchResult[]>> {
    if (!Number.isInteger(topK) || topK <= 0) {
      return Promise.resolve(err(
        "E101_INVALID_INPUT",
        `topK 必须是正整数: ${topK}`,
        { topK },
      ));
    }
    const query = [...embedding];
    return this.trackRead("搜索向量", () => this.searchNow(type, query, topK));
  }

  getVectorsByType(type: CRType): Promise<Result<ConceptVector[]>> {
    return this.trackRead("读取向量桶", async () => {
      const bucketResult = await this.ensureBucketLoaded(type);
      if (!bucketResult.ok) {
        return bucketResult as Result<ConceptVector[]>;
      }
      return ok(bucketResult.value.vectors.map((vector) => this.cloneVector(vector)));
    });
  }

  getEmbeddingModel(): string {
    return this.model;
  }

  getEmbeddingProfile(): string {
    return this.profile;
  }

  getEmbeddingDimension(): number | undefined {
    return this.dimension;
  }

  getEntryCount(): number {
    return Object.keys(this.indexMeta?.concepts ?? {}).length;
  }

  /**
   * 盘点索引登记与磁盘上的物理向量文件，不修改任何状态。
   * 元数据是所有权来源：未被当前 UID/type 登记引用的文件才是可清理候选。
   */
  inspectStorage(): Promise<Result<VectorIndexMaintenanceReport>> {
    return this.trackRead("盘点向量文件", async () => {
      await this.mutationChain;
      const meta = this.indexMeta;
      if (!meta) return err("E310_INVALID_STATE", "向量索引未加载");
      await this.cruidCache?.waitUntilReady();

      const listed = await this.fileStorage.listVectorFiles();
      if (!listed.ok) return listed as Result<VectorIndexMaintenanceReport>;
      const physicalByKey = new Map(
        listed.value.map((file) => [this.vectorKey(file.type, file.id), file]),
      );
      const missingEntries: VectorIndexIssue[] = [];
      const staleEntries: VectorIndexIssue[] = [];
      const invalidEntries: VectorIndexIssue[] = [];

      for (const [uid, concept] of Object.entries(meta.concepts)) {
        const noteMissing = !!this.cruidCache && !this.cruidCache.has(uid);
        if (noteMissing) {
          staleEntries.push({ uid, type: concept.type, reason: "note-missing" });
        }
        const key = this.vectorKey(concept.type, uid);
        const physical = physicalByKey.get(key);
        if (!physical) {
          missingEntries.push({ uid, type: concept.type, reason: "missing-file" });
          continue;
        }
        const vector = await this.fileStorage.readVectorFile(concept.type, uid);
        if (!vector.ok) {
          if (!DISCARDABLE_VECTOR_CODES.has(vector.error.code)) return vector as Result<VectorIndexMaintenanceReport>;
          invalidEntries.push({
            uid,
            type: concept.type,
            reason: "invalid-file",
          });
          continue;
        }
        if (!this.isVectorCompatible(vector.value) || concept.sourceHash !== vector.value.metadata.sourceHash) {
          invalidEntries.push({
            uid,
            type: concept.type,
            reason: "incompatible-file",
          });
        }
      }

      const orphanFiles = listed.value.filter((file) => {
        const registered = meta.concepts[file.id];
        return !registered || registered.type !== file.type ||
          (!!this.cruidCache && !this.cruidCache.has(file.id));
      });
      return ok({
        indexedEntries: Object.keys(meta.concepts).length,
        physicalFiles: listed.value.length,
        missingEntries,
        staleEntries,
        invalidEntries,
        orphanFiles,
      });
    });
  }

  /**
   * 删除盘点结果中的物理孤儿文件。执行时再次列目录并核验索引所有权，
   * 因此扫描后新增的文件不会被误删，且已重新登记的文件会被跳过。
   */
  cleanupOrphanFiles(expected: VectorFileRef[]): Promise<Result<VectorCleanupSummary>> {
    const requested = new Set(expected.map((file) => this.vectorKey(file.type, file.id)));
    return this.enqueueMutation("清理多余向量文件", async () => {
      const meta = this.indexMeta;
      if (!meta) return err("E310_INVALID_STATE", "向量索引未加载");
      const listed = await this.fileStorage.listVectorFiles();
      if (!listed.ok) return listed as Result<VectorCleanupSummary>;

      let removed = 0;
      let skipped = 0;
      let failed = 0;
      for (const file of listed.value) {
        const key = this.vectorKey(file.type, file.id);
        if (!requested.has(key)) continue;
        const registered = meta.concepts[file.id];
        const noteMissing = !!this.cruidCache && !this.cruidCache.has(file.id);
        if (registered?.type === file.type && !noteMissing) {
          skipped++;
          continue;
        }
        if (registered?.type === file.type && noteMissing) {
          const removedEntry = await this.deleteNow(file.id);
          if (removedEntry.ok) {
            removed++;
          } else {
            failed++;
            this.logger?.warn("VectorIndex", "失联笔记向量登记清理失败", {
              type: file.type,
              id: file.id,
              error: removedEntry.error,
            });
          }
          continue;
        }
        const result = await this.fileStorage.deleteVectorFile(file.type, file.id);
        if (result.ok || MISSING_FILE_CODES.has(result.error.code)) {
          removed++;
        } else {
          failed++;
          this.logger?.warn("VectorIndex", "多余向量文件删除失败", {
            type: file.type,
            id: file.id,
            error: result.error,
          });
        }
      }
      return ok({ removed, skipped, failed });
    });
  }

  has(uid: string): boolean {
    return !!this.indexMeta?.concepts[uid];
  }

  reconfigure(model: string, dimension: number | undefined, profile = model): Promise<Result<void>> {
    const normalizedModel = model.trim();
    const normalizedProfile = profile.trim();
    if (!normalizedModel) {
      return Promise.resolve(err("E101_INVALID_INPUT", "Embedding 模型不能为空"));
    }
    if (!normalizedProfile) {
      return Promise.resolve(err("E101_INVALID_INPUT", "Embedding 配置身份不能为空"));
    }
    if (dimension !== undefined && (!Number.isInteger(dimension) || dimension <= 0)) {
      return Promise.resolve(err(
        "E101_INVALID_INPUT",
        `Embedding 维度必须是正整数: ${dimension}`,
        { dimension },
      ));
    }

    return this.enqueueMutation("更新向量配置", async () => {
      if (!this.indexMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }
      const dimensionMatches = dimension !== undefined
        ? this.dimension === dimension
        : !this.dimensionConfigured;
      if (this.profile === normalizedProfile && this.model === normalizedModel && dimensionMatches) {
        return ok(undefined);
      }
      return this.resetIndexNow(normalizedProfile, normalizedModel, dimension);
    });
  }

  /** Stop new work and wait for all already-started reads and mutations. */
  dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }

    this.disposed = true;
    this.disposePromise = (async () => {
      await Promise.allSettled([...this.activeReads]);
      await this.mutationChain;
      this.buckets.clear();
      this.recentVectors.clear();
      this.indexMeta = null;
    })();
    return this.disposePromise;
  }

  private async upsertNow(entry: VectorEntry): Promise<Result<void>> {
    const currentMeta = this.indexMeta;
    if (!currentMeta) {
      return err("E310_INVALID_STATE", "向量索引未加载");
    }

    const validation = await this.ensureEmbeddingDimension(entry.embedding);
    if (!validation.ok) {
      return validation;
    }

    const previous = await this.readPreviousVector(currentMeta, entry.uid);
    if (!previous.ok) return previous;
    const { previousType, previousVector } = previous.value;
    const now = Date.now();
    const vector: ConceptVector = {
      id: entry.uid,
      type: entry.type,
      embedding: normalizeVector(entry.embedding),
      metadata: {
        createdAt: previousVector?.metadata.createdAt ?? now,
        updatedAt: now,
        embeddingModel: this.model,
        dimensions: this.dimension!,
        ...(entry.sourceHash ? { sourceHash: entry.sourceHash } : {}),
      },
    };

    const vectorWrite = await this.fileStorage.writeVectorFile(entry.type, entry.uid, vector);
    if (!vectorWrite.ok) {
      return vectorWrite;
    }

    const nextMeta: VectorIndexMeta = {
      ...currentMeta,
      dimensions: this.dimension!,
      concepts: {
        ...currentMeta.concepts,
        [entry.uid]: { type: entry.type, ...(entry.sourceHash ? { sourceHash: entry.sourceHash } : {}) },
      },
    };
    const metaWrite = await this.fileStorage.writeVectorIndexMeta(nextMeta);
    if (!metaWrite.ok) {
      await this.rollbackVectorWrite(entry.type, entry.uid, previousType, previousVector);
      this.invalidateEntryCaches(entry.uid, entry.type, previousType);
      return metaWrite;
    }

    this.indexMeta = nextMeta;
    this.contentVersion++;
    this.commitVectorToCaches(vector, previousType);

    if (previousType && previousType !== entry.type) {
      await this.cleanupVectorFiles(
        [{ type: previousType, id: entry.uid }],
        "清理类型变更前的旧向量",
      );
    }
    return ok(undefined);
  }

  private async replaceAllNow(entries: VectorEntry[]): Promise<Result<number>> {
    const currentMeta = this.indexMeta;
    if (!currentMeta) {
      return err("E310_INVALID_STATE", "向量索引未加载");
    }
    if (entries.length > 0) {
      const dimension = await this.ensureEmbeddingDimension(entries[0].embedding);
      if (!dimension.ok) return dimension as Result<number>;
      for (const entry of entries.slice(1)) {
        const validation = this.validateEmbedding(entry.embedding);
        if (!validation.ok) return validation as Result<number>;
      }
    }

    const previousByTarget = new Map<string, ConceptVector>();
    for (const entry of entries) {
      const previousType = currentMeta.concepts[entry.uid]?.type;
      if (previousType !== entry.type) continue;
      const previousResult = await this.fileStorage.readVectorFile(entry.type, entry.uid);
      if (previousResult.ok) {
        previousByTarget.set(this.vectorKey(entry.type, entry.uid), previousResult.value);
      } else if (!DISCARDABLE_VECTOR_CODES.has(previousResult.error.code)) {
        return previousResult as Result<number>;
      }
    }

    const now = Date.now();
    const vectors = entries.map((entry): ConceptVector => {
      const previous = previousByTarget.get(this.vectorKey(entry.type, entry.uid));
      return {
        id: entry.uid,
        type: entry.type,
        embedding: normalizeVector(entry.embedding),
        metadata: {
          createdAt: previous?.metadata.createdAt ?? now,
          updatedAt: now,
          embeddingModel: this.model,
          dimensions: this.dimension!,
        ...(entry.sourceHash ? { sourceHash: entry.sourceHash } : {}),
        },
      };
    });
    const written: ConceptVector[] = [];
    for (const vector of vectors) {
      written.push(vector);
      const writeResult = await this.fileStorage.writeVectorFile(vector.type, vector.id, vector);
      if (!writeResult.ok) {
        await this.rollbackBulkWrites(written, previousByTarget);
        return writeResult as Result<number>;
      }
    }

    const concepts = Object.fromEntries(
      vectors.map((vector) => [vector.id, { type: vector.type, ...(vector.metadata.sourceHash ? { sourceHash: vector.metadata.sourceHash } : {}) }]),
    ) as VectorIndexMeta["concepts"];
    const nextMeta: VectorIndexMeta = { ...currentMeta, dimensions: this.dimension ?? 0, concepts };
    const metaWrite = await this.fileStorage.writeVectorIndexMeta(nextMeta);
    if (!metaWrite.ok) {
      await this.rollbackBulkWrites(written, previousByTarget);
      return metaWrite as Result<number>;
    }

    this.indexMeta = nextMeta;
    this.contentVersion++;
    this.buckets.clear();
    this.recentVectors.clear();
    for (const vector of vectors) this.setRecentVector(vector.id, vector);

    const retainedTargets = new Set(vectors.map((vector) => this.vectorKey(vector.type, vector.id)));
    const obsolete = Object.entries(currentMeta.concepts)
      .filter(([id, concept]) => !retainedTargets.has(this.vectorKey(concept.type, id)))
      .map(([id, concept]) => ({ id, type: concept.type }));
    await this.cleanupVectorFiles(obsolete, "清理重建前的旧向量");
    return ok(vectors.length);
  }

  private async readPreviousVector(
    meta: VectorIndexMeta,
    uid: string,
  ): Promise<Result<{ previousType?: CRType; previousVector?: ConceptVector }>> {
    const previousType = meta.concepts[uid]?.type;
    if (!previousType) return ok({});

    const result = await this.fileStorage.readVectorFile(previousType, uid);
    if (!result.ok && !DISCARDABLE_VECTOR_CODES.has(result.error.code)) return result;
    return ok({
      previousType,
      previousVector: result.ok ? result.value : undefined,
    });
  }

  private async deleteNow(uid: string): Promise<Result<void>> {
    const currentMeta = this.indexMeta;
    if (!currentMeta) {
      return err("E310_INVALID_STATE", "向量索引未加载");
    }
    const concept = currentMeta.concepts[uid];
    if (!concept) {
      return err("E311_NOT_FOUND", `Vector entry not found: ${uid}`, { uid });
    }

    const nextConcepts = { ...currentMeta.concepts };
    delete nextConcepts[uid];
    const nextMeta: VectorIndexMeta = {
      ...currentMeta,
      concepts: nextConcepts,
    };
    const metaWrite = await this.fileStorage.writeVectorIndexMeta(nextMeta);
    if (!metaWrite.ok) {
      return metaWrite;
    }

    this.indexMeta = nextMeta;
    this.contentVersion++;
    this.recentVectors.delete(uid);
    this.buckets.delete(concept.type);
    await this.cleanupVectorFiles([{ type: concept.type, id: uid }], "清理已删除向量");
    return ok(undefined);
  }

  private async searchNow(
    type: CRType,
    embedding: number[],
    topK: number,
  ): Promise<Result<SearchResult[]>> {
    await this.cruidCache?.waitUntilReady();
    if (this.disposed) {
      return this.stopped();
    }
    if (!this.indexMeta) {
      return err("E310_INVALID_STATE", "向量索引未加载");
    }
    const validation = await this.ensureEmbeddingDimension(embedding);
    if (!validation.ok) {
      return validation as Result<SearchResult[]>;
    }

    const bucketResult = await this.ensureBucketLoaded(type);
    if (!bucketResult.ok) {
      return bucketResult as Result<SearchResult[]>;
    }

    const query = normalizeVector(embedding);
    const matches: Array<{ vector: ConceptVector; similarity: number }> = [];
    for (const vector of bucketResult.value.vectors) {
      if (this.cruidCache && !this.cruidCache.has(vector.id)) continue;
      const similarity = dotProduct(query, vector.embedding);
      let low = 0;
      let high = matches.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (matches[middle].similarity > similarity) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      if (low < topK) {
        matches.splice(low, 0, { vector, similarity });
        if (matches.length > topK) {
          matches.pop();
        }
      }
    }

    return ok(matches.map(({ vector, similarity }) => ({
      uid: vector.id,
      similarity,
      name: this.cruidCache?.getName(vector.id) || vector.id,
      path: this.cruidCache?.getPath(vector.id) || "",
    })));
  }

  private async ensureBucketLoaded(type: CRType): Promise<Result<TypeBucket>> {
    while (!this.disposed) {
      await this.mutationChain;
      if (this.disposed) {
        return this.stopped();
      }

      this.evictStaleBuckets();
      const cached = this.buckets.get(type);
      if (cached) {
        cached.lastAccessedAt = Date.now();
        return ok(cached);
      }

      const loadVersion = this.contentVersion;
      const activityVersion = this.mutationActivityVersion;
      const loaded = await this.loadVectorsByType(type);
      if (!loaded.ok) {
        return loaded as Result<TypeBucket>;
      }
      if (this.disposed) {
        return this.stopped();
      }
      if (loadVersion !== this.contentVersion ||
        activityVersion !== this.mutationActivityVersion) {
        continue;
      }

      if (loaded.value.invalidIds.length > 0) {
        const pruneResult = await this.pruneInvalidVectors(
          type,
          loaded.value.invalidIds,
          loadVersion,
        );
        if (!pruneResult.ok) {
          return pruneResult as Result<TypeBucket>;
        }
        if (!pruneResult.value) {
          continue;
        }
      }

      if (this.disposed) {
        return this.stopped();
      }
      for (const vector of loaded.value.vectors) {
        this.setRecentVector(vector.id, vector);
      }
      const bucket: TypeBucket = {
        vectors: loaded.value.vectors,
        lastAccessedAt: Date.now(),
      };
      this.buckets.set(type, bucket);
      return ok(bucket);
    }
    return this.stopped();
  }

  private async loadVectorsByType(type: CRType): Promise<Result<LoadedBucket>> {
    const meta = this.indexMeta;
    if (!meta) {
      return err("E310_INVALID_STATE", "向量索引未加载");
    }

    const entries = Object.entries(meta.concepts)
      .filter(([uid, concept]) => concept.type === type && (!this.cruidCache || this.cruidCache.has(uid)));
    const vectors: ConceptVector[] = [];
    const invalidIds: string[] = [];
    const failures: Array<{ id: string; reason: string }> = [];

    for (let offset = 0; offset < entries.length; offset += VECTOR_READ_BATCH_SIZE) {
      if (this.disposed) {
        return this.stopped();
      }
      const batch = entries.slice(offset, offset + VECTOR_READ_BATCH_SIZE);
      const results = await Promise.all(batch.map(async ([id]): Promise<VectorReadOutcome> => {
        const cached = this.recentVectors.get(id);
        if (cached && this.isVectorCompatible(cached)) {
          return { id, vector: cached };
        }
        const readResult = await this.fileStorage.readVectorFile(type, id);
        if (!readResult.ok) {
          return DISCARDABLE_VECTOR_CODES.has(readResult.error.code)
            ? { id, invalidReason: readResult.error.message }
            : { id, error: readResult.error };
        }
        if (!this.isVectorCompatible(readResult.value)) {
          return { id, invalidReason: "向量模型或维度与当前索引不一致" };
        }
        return { id, vector: readResult.value };
      }));

      for (const result of results) {
        if ("error" in result) {
          return err(result.error.code, `读取向量失败: ${type}/${result.id}`, {
            cause: result.error,
          });
        }
        if ("vector" in result) {
          vectors.push(result.vector);
        } else {
          invalidIds.push(result.id);
          failures.push({ id: result.id, reason: result.invalidReason });
        }
      }
    }

    if (failures.length > 0) {
      this.logger?.warn("VectorIndex", `类型 ${type} 有 ${failures.length} 个无效向量，将从索引移除`, {
        type,
        failures: failures.slice(0, 10),
      });
    }
    return ok({ vectors, invalidIds });
  }

  private pruneInvalidVectors(
    type: CRType,
    ids: string[],
    expectedVersion: number,
  ): Promise<Result<boolean>> {
    return this.enqueueMutation("修复损坏向量", async () => {
      if (expectedVersion !== this.contentVersion) {
        return ok(false);
      }
      const currentMeta = this.indexMeta;
      if (!currentMeta) {
        return err("E310_INVALID_STATE", "向量索引未加载");
      }

      const nextConcepts = { ...currentMeta.concepts };
      const removed: string[] = [];
      for (const id of ids) {
        if (nextConcepts[id]?.type === type) {
          delete nextConcepts[id];
          removed.push(id);
        }
      }
      if (removed.length === 0) {
        return ok(true);
      }

      const nextMeta: VectorIndexMeta = {
        ...currentMeta,
        concepts: nextConcepts,
      };
      const metaWrite = await this.fileStorage.writeVectorIndexMeta(nextMeta);
      if (!metaWrite.ok) {
        return metaWrite as Result<boolean>;
      }

      this.indexMeta = nextMeta;
      this.contentVersion++;
      this.buckets.delete(type);
      for (const id of removed) {
        this.recentVectors.delete(id);
      }
      await this.cleanupVectorFiles(
        removed.map((id) => ({ type, id })),
        "清理损坏向量文件",
      );
      return ok(true);
    });
  }

  private async resetIndexNow(
    profile: string,
    model: string,
    dimension: number | undefined,
  ): Promise<Result<void>> {
    const previousEntries = this.indexMeta
      ? Object.entries(this.indexMeta.concepts).map(([id, concept]) => ({
          id,
          type: concept.type,
        }))
      : [];
    const emptyMeta = this.createEmptyMeta(profile, model, dimension);
    const metaWrite = await this.fileStorage.writeVectorIndexMeta(emptyMeta);
    if (!metaWrite.ok) {
      return metaWrite;
    }

    this.profile = profile;
    this.model = model;
    this.dimension = dimension;
    this.dimensionConfigured = dimension !== undefined;
    this.indexMeta = emptyMeta;
    this.contentVersion++;
    this.buckets.clear();
    this.recentVectors.clear();
    await this.cleanupVectorFiles(previousEntries, "清理不兼容的旧索引");
    this.logger?.info("VectorIndex", "向量索引已重置", {
      profile,
      model,
      dimension,
      removedEntries: previousEntries.length,
    });
    return ok(undefined);
  }

  private createEmptyMeta(profile: string, model: string, dimension: number | undefined): VectorIndexMeta {
    return {
      version: "5.0",
      embeddingProfile: profile,
      embeddingModel: model,
      dimensions: dimension ?? 0,
      concepts: {},
    };
  }

  private enqueueMutation<T>(
    operationName: string,
    operation: () => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (this.disposed) {
      return Promise.resolve(this.stopped());
    }

    const run = async (): Promise<Result<T>> => {
      if (this.disposed) {
        return this.stopped();
      }
      this.mutationActivityVersion++;
      try {
        return await operation();
      } catch (error) {
        return err("E500_INTERNAL_ERROR", `${operationName}失败`, error);
      } finally {
        this.mutationActivityVersion++;
      }
    };
    const resultPromise = this.mutationChain.then(run, run);
    this.mutationChain = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }

  private trackRead<T>(
    operationName: string,
    operation: () => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (this.disposed) {
      return Promise.resolve(this.stopped());
    }
    const promise = (async (): Promise<Result<T>> => {
      try {
        return await operation();
      } catch (error) {
        return err("E500_INTERNAL_ERROR", `${operationName}失败`, error);
      }
    })();
    this.activeReads.add(promise);
    void promise.then(
      () => this.activeReads.delete(promise),
      () => this.activeReads.delete(promise),
    );
    return promise;
  }

  private validateEmbedding(embedding: number[]): Result<void> {
    if (this.dimension !== undefined && embedding.length !== this.dimension) {
      return err(
        "E305_VECTOR_MISMATCH",
        `Invalid embedding dimension: expected ${this.dimension}, got ${embedding.length}`,
        { expected: this.dimension, actual: embedding.length },
      );
    }
    if (!embedding.every((value) => Number.isFinite(value)) ||
      !embedding.some((value) => value !== 0)) {
      return err("E101_INVALID_INPUT", "向量必须包含有限且非全零的数值");
    }
    return ok(undefined);
  }

  private async ensureEmbeddingDimension(embedding: number[]): Promise<Result<void>> {
    const basic = this.validateEmbedding(embedding);
    if (!basic.ok) return basic;
    if (this.dimension !== undefined) return ok(undefined);
    if (!Number.isInteger(embedding.length) || embedding.length <= 0) {
      return err("E101_INVALID_INPUT", "向量维度必须是正整数");
    }
    this.dimension = embedding.length;
    if (this.indexMeta && this.indexMeta.dimensions !== this.dimension) {
      const nextMeta: VectorIndexMeta = { ...this.indexMeta, dimensions: this.dimension };
      const written = await this.fileStorage.writeVectorIndexMeta(nextMeta);
      if (!written.ok) {
        this.dimension = undefined;
        this.dimensionConfigured = false;
        return written;
      }
      this.indexMeta = nextMeta;
    }
    return ok(undefined);
  }

  private isVectorCompatible(vector: ConceptVector): boolean {
    return this.dimension !== undefined && vector.embedding.length === this.dimension &&
      vector.metadata.dimensions === this.dimension &&
      vector.metadata.embeddingModel === this.model &&
      vector.embedding.every((value) => Number.isFinite(value));
  }

  private commitVectorToCaches(vector: ConceptVector, previousType?: CRType): void {
    this.setRecentVector(vector.id, vector);
    if (previousType && previousType !== vector.type) {
      this.buckets.delete(previousType);
    }
    const bucket = this.buckets.get(vector.type);
    if (!bucket) {
      return;
    }
    const existingIndex = bucket.vectors.findIndex((candidate) => candidate.id === vector.id);
    if (existingIndex >= 0) {
      bucket.vectors[existingIndex] = vector;
    } else {
      bucket.vectors.push(vector);
    }
    bucket.lastAccessedAt = Date.now();
  }

  private invalidateEntryCaches(uid: string, type: CRType, previousType?: CRType): void {
    this.recentVectors.delete(uid);
    this.buckets.delete(type);
    if (previousType) {
      this.buckets.delete(previousType);
    }
  }

  private async rollbackVectorWrite(
    type: CRType,
    uid: string,
    previousType: CRType | undefined,
    previousVector: ConceptVector | undefined,
  ): Promise<void> {
    const rollbackResult = previousType === type && previousVector
      ? await this.fileStorage.writeVectorFile(type, uid, previousVector)
      : await this.fileStorage.deleteVectorFile(type, uid);
    if (!rollbackResult.ok && !MISSING_FILE_CODES.has(rollbackResult.error.code)) {
      this.logger?.error("VectorIndex", "向量索引提交失败后无法回滚向量文件", undefined, {
        uid,
        type,
        error: rollbackResult.error,
      });
    }
  }

  private async rollbackBulkWrites(
    written: ConceptVector[],
    previousByTarget: Map<string, ConceptVector>,
  ): Promise<void> {
    const failures: Array<{ id: string; type: CRType; error: unknown }> = [];
    for (const vector of [...written].reverse()) {
      const previous = previousByTarget.get(this.vectorKey(vector.type, vector.id));
      const result = previous
        ? await this.fileStorage.writeVectorFile(vector.type, vector.id, previous)
        : await this.fileStorage.deleteVectorFile(vector.type, vector.id);
      if (!result.ok && !MISSING_FILE_CODES.has(result.error.code)) {
        failures.push({ id: vector.id, type: vector.type, error: result.error });
      }
    }
    if (failures.length > 0) {
      this.logger?.error("VectorIndex", "重建索引提交失败后无法完整回滚向量文件", undefined, {
        failures: failures.slice(0, 10),
      });
    }
  }

  private async cleanupVectorFiles(
    entries: Array<{ type: CRType; id: string }>,
    operation: string,
  ): Promise<void> {
    const failures: Array<{ id: string; type: CRType; error: unknown }> = [];
    for (let offset = 0; offset < entries.length; offset += VECTOR_READ_BATCH_SIZE) {
      const batch = entries.slice(offset, offset + VECTOR_READ_BATCH_SIZE);
      const results = await Promise.all(batch.map(async (entry) => ({
        entry,
        result: await this.fileStorage.deleteVectorFile(entry.type, entry.id),
      })));
      for (const { entry, result } of results) {
        if (!result.ok && !MISSING_FILE_CODES.has(result.error.code)) {
          failures.push({ ...entry, error: result.error });
        }
      }
    }
    if (failures.length > 0) {
      this.logger?.warn("VectorIndex", `${operation}时有 ${failures.length} 个文件未能删除`, {
        failures: failures.slice(0, 10),
      });
    }
  }

  private evictStaleBuckets(): void {
    const cutoff = Date.now() - BUCKET_TTL_MS;
    for (const [type, bucket] of this.buckets) {
      if (bucket.lastAccessedAt < cutoff) {
        this.buckets.delete(type);
      }
    }
  }

  private setRecentVector(uid: string, vector: ConceptVector): void {
    if (this.recentVectors.has(uid)) {
      this.recentVectors.delete(uid);
    } else if (this.recentVectors.size >= MAX_RECENT_VECTORS) {
      const oldest = this.recentVectors.keys().next().value as string | undefined;
      if (oldest) {
        this.recentVectors.delete(oldest);
      }
    }
    this.recentVectors.set(uid, vector);
  }

  private cloneVector(vector: ConceptVector): ConceptVector {
    return {
      ...vector,
      embedding: [...vector.embedding],
      metadata: { ...vector.metadata },
    };
  }

  private vectorKey(type: CRType, uid: string): string {
    return `${type}/${uid}`;
  }

  private stopped<T>(): Result<T> {
    return err("E310_INVALID_STATE", "向量索引已停止");
  }
}
