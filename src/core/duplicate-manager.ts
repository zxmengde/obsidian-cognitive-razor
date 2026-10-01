/** 重复管理器：检测和管理重复概念 */

import {
  CR_TYPES,
  ok,
  err
} from "../types";
import type {
  ILogger,
  DuplicatePair,
  DuplicatePairsStore,
  CRType,
  Result,
} from "../types";
import type { VectorIndex } from "./vector-index";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import { normalizeVector, dotProduct } from "./vector-math";

const VALID_CR_TYPES: ReadonlySet<string> = new Set(CR_TYPES);
const REBUILD_YIELD_INTERVAL = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseDuplicatePair(value: unknown): DuplicatePair | null {
  if (!isRecord(value) ||
    typeof value.id !== "string" || !value.id ||
    typeof value.nodeIdA !== "string" || !value.nodeIdA ||
    typeof value.nodeIdB !== "string" || !value.nodeIdB ||
    !VALID_CR_TYPES.has(String(value.type)) ||
    typeof value.similarity !== "number" || !Number.isFinite(value.similarity) ||
    value.similarity < 0 || value.similarity > 1 + 1e-10 ||
    (value.status !== "pending" && value.status !== "dismissed")) {
    return null;
  }
  return {
    id: value.id,
    nodeIdA: value.nodeIdA,
    nodeIdB: value.nodeIdB,
    type: value.type as CRType,
    // Older versions persisted floating-point dot products slightly above one.
    similarity: Math.min(1, value.similarity),
    status: value.status,
  };
}

export class DuplicateManager {
  private vectorIndex: VectorIndex;
  private fileStorage: FileStorage;
  private logger: ILogger;
  private storePath: string;
  private store: DuplicatePairsStore | null;
  private listeners: Array<(pairs: DuplicatePair[]) => void>;
  private mutationChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private initialized = false;
  private initializePromise: Promise<Result<void>> | undefined;
  private disposePromise: Promise<void> | undefined;
  private similarityThreshold: number;
  private readonly unsubscribeSettings: () => void;

  constructor(
    vectorIndex: VectorIndex,
    fileStorage: FileStorage,
    logger: ILogger,
    settingsStore: SettingsStore,
    storePath: string = "data/duplicate-pairs.json"
  ) {
    this.vectorIndex = vectorIndex;
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.storePath = storePath;
    this.store = null;
    this.listeners = [];
    this.similarityThreshold = settingsStore.getSettings().similarityThreshold;
    this.unsubscribeSettings = settingsStore.subscribe((settings) => {
      if (settings.similarityThreshold === this.similarityThreshold) return;
      this.similarityThreshold = settings.similarityThreshold;
      if (!this.disposed && this.store) this.notifyListeners();
    });

    this.logger.debug("DuplicateManager", "DuplicateManager 初始化完成", {
      storePath
    });
  }

  /** 加载当前重复对存储；并发调用共享同一个加载过程。 */
  initialize(): Promise<Result<void>> {
    if (this.disposed) {
      return Promise.resolve(err("E310_INVALID_STATE", "重复管理器已停止"));
    }
    if (this.initialized) {
      return Promise.resolve(ok(undefined));
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }

    const promise = this.initializeInternal();
    this.initializePromise = promise;
    void promise.then((result) => {
      if (this.initializePromise === promise) {
        this.initializePromise = undefined;
      }
      if (result.ok && !this.disposed) {
        this.initialized = true;
      }
    });
    return promise;
  }

  private async initializeInternal(): Promise<Result<void>> {
    try {
      let loadedStore: DuplicatePairsStore | null = null;
      if (await this.fileStorage.exists(this.storePath)) {
        const readResult = await this.fileStorage.read(this.storePath);
        if (readResult.ok) {
          try {
            loadedStore = this.parseStore(JSON.parse(readResult.value) as unknown);
          } catch (error) {
            this.logger.warn("DuplicateManager", "重复对存储不是有效 JSON，将重建空存储", { error });
          }
          if (!loadedStore) {
            this.logger.warn("DuplicateManager", "重复对存储格式无效，将重建空存储");
          }
        } else {
          this.logger.error("DuplicateManager", "读取重复对存储失败，保留现有文件", undefined, {
            error: readResult.error,
          });
          return readResult as Result<void>;
        }
      }

      if (this.disposed) {
        return err("E310_INVALID_STATE", "重复管理器已停止");
      }

      const nextStore = loadedStore ?? this.createEmptyStore();
      this.store = nextStore;
      if (!loadedStore) {
        const saveResult = await this.saveStore();
        if (!saveResult.ok) {
          this.store = null;
          return saveResult;
        }
      }

      if (this.disposed) {
        return err("E310_INVALID_STATE", "重复管理器已停止");
      }

      this.logger.info("DuplicateManager", "重复对存储已就绪", {
        pairCount: nextStore.pairs.length,
        pendingCount: this.getPendingPairs().length,
      });
      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "初始化失败", error as Error);
      return err("E500_INTERNAL_ERROR", "初始化重复管理器失败", error);
    }
  }

  /**
   * 更新单个节点向量后的局部重复关系。
   * 只比较该节点与同类型候选，不重新生成向量，也不做全库两两比较。
   */
  refreshNode(
    nodeId: string,
    type: CRType,
    embedding: number[],
  ): Promise<Result<number>> {
    return this.enqueueMutation(() => this.refreshNodeInternal(nodeId, type, embedding));
  }

  private async refreshNodeInternal(
    nodeId: string,
    type: CRType,
    embedding: number[],
  ): Promise<Result<number>> {
    if (this.disposed || !this.store) {
      return err("E310_INVALID_STATE", "重复管理器未初始化");
    }

    const threshold = this.similarityThreshold;
    const previousPairs = this.store.pairs;
    const dismissedIds = new Set(
      previousPairs
        .filter((pair) => pair.nodeIdA === nodeId || pair.nodeIdB === nodeId)
        .filter((pair) => pair.status === "dismissed")
        .map((pair) => pair.id),
    );
    const vectorsResult = await this.vectorIndex.getVectorsByType(type);
    if (!vectorsResult.ok) return vectorsResult as Result<number>;
    if (this.disposed) return err("E310_INVALID_STATE", "重复管理器已停止");

    const normalized = normalizeVector(embedding);
    const refreshed: DuplicatePair[] = [];
    for (const candidate of vectorsResult.value) {
      if (candidate.id === nodeId) continue;
      const similarity = Math.min(1, Math.max(-1, dotProduct(normalized, candidate.embedding)));
      if (similarity < threshold) continue;
      const id = this.generatePairId(nodeId, candidate.id);
      refreshed.push({
        id,
        nodeIdA: nodeId < candidate.id ? nodeId : candidate.id,
        nodeIdB: nodeId < candidate.id ? candidate.id : nodeId,
        type,
        similarity,
        status: dismissedIds.has(id) ? "dismissed" : "pending",
      });
    }
    if (threshold !== this.similarityThreshold) {
      return err("E320_TASK_CONFLICT", "相似度阈值在重复项刷新期间发生变化");
    }

    const nextPairs = [
      ...previousPairs.filter((pair) => pair.nodeIdA !== nodeId && pair.nodeIdB !== nodeId),
      ...refreshed,
    ];
    this.store.pairs = nextPairs;
    const saveResult = await this.saveStore();
    if (!saveResult.ok) {
      this.store.pairs = previousPairs;
      return saveResult as Result<number>;
    }
    this.notifyListeners();
    this.logger.info("DuplicateManager", "已刷新单个节点的重复关系", {
      nodeId,
      type,
      pairCount: refreshed.length,
    });
    return ok(refreshed.length);
  }

  /** 获取待处理的重复对 */
  getPendingPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs
      .filter((pair) => pair.status === "pending" && pair.similarity >= this.similarityThreshold)
      .map((pair) => ({ ...pair }));
  }

  /** 标记为非重复 */
  async markAsNonDuplicate(pairId: string): Promise<Result<void>> {
    return this.enqueueMutation(() => this.markAsNonDuplicateInternal(pairId));
  }

  getPair(pairId: string): DuplicatePair | null {
    const pair = this.store?.pairs.find((candidate) => candidate.id === pairId);
    return pair ? { ...pair } : null;
  }

  private async markAsNonDuplicateInternal(pairId: string): Promise<Result<void>> {
    try {
      if (this.disposed || !this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E311_NOT_FOUND", `重复对不存在: ${pairId}`);
      }

      const pair = this.store.pairs[pairIndex];
      const previousStatus = pair.status;
      pair.status = "dismissed";

      // 保存存储
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        pair.status = previousStatus;
        return saveResult;
      }

      // 通知监听器
      this.notifyListeners();

      this.logger.info("DuplicateManager", `重复对已标记为非重复: ${pairId}`);

      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "标记为非重复失败", error as Error, {
        pairId
      });
      return err("E500_INTERNAL_ERROR", "标记为非重复失败", error);
    }
  }


  /** 订阅重复对变更 */
  subscribe(listener: (pairs: DuplicatePair[]) => void): () => void {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.push(listener);

    // 立即调用一次
    if (this.store) {
      try {
        listener(this.getPendingPairs());
      } catch (error) {
        this.logger.error("DuplicateManager", "监听器初始化回调失败", error as Error);
      }
    }

    // 返回取消订阅函数
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /** 释放监听器和内存状态，避免工作台卸载后保留回调引用。 */
  async dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.disposed = true;
    this.unsubscribeSettings();
    const initialization = this.initializePromise;
    this.disposePromise = (async () => {
      this.listeners.length = 0;
      if (initialization) {
        await initialization;
      }
      await this.mutationChain;
      this.store = null;
      this.initialized = false;
    })();
    return this.disposePromise;
  }

  /**
   * 清理包含指定 nodeId 的重复对（用于笔记删除后的关联数据清理）
   */
  async removePairsByNodeId(nodeId: string): Promise<Result<number>> {
    return this.enqueueMutation(() => this.removePairsByNodeIdInternal(nodeId));
  }

  clearAll(): Promise<Result<number>> {
    return this.enqueueMutation(async () => {
      if (this.disposed || !this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }
      if (this.store.pairs.length === 0) return ok(0);
      const previousPairs = this.store.pairs;
      this.store.pairs = [];
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        this.store.pairs = previousPairs;
        return saveResult as Result<number>;
      }
      this.notifyListeners();
      this.logger.info("DuplicateManager", "已清空失效的重复项状态", {
        removed: previousPairs.length,
      });
      return ok(previousPairs.length);
    });
  }

  /** 从完整向量索引重算重复对，并保留仍达到阈值的 dismissed 判定。 */
  rebuildFromIndex(): Promise<Result<number>> {
    return this.enqueueMutation(() => this.rebuildFromIndexInternal());
  }

  private async rebuildFromIndexInternal(): Promise<Result<number>> {
    if (this.disposed || !this.store) {
      return err("E310_INVALID_STATE", "重复管理器未初始化");
    }

    const previousPairs = this.store.pairs;
    const dismissedIds = new Set(
      previousPairs
        .filter((pair) => pair.status === "dismissed")
        .map((pair) => pair.id),
    );
    const nextPairs: DuplicatePair[] = [];
    const threshold = this.similarityThreshold;
    let comparisons = 0;

    for (const type of CR_TYPES) {
      if (this.disposed) {
        return err("E310_INVALID_STATE", "重复管理器已停止");
      }
      const vectorsResult = await this.vectorIndex.getVectorsByType(type);
      if (!vectorsResult.ok) return vectorsResult as Result<number>;
      const vectors = vectorsResult.value;
      for (let first = 0; first < vectors.length; first += 1) {
        for (let second = first + 1; second < vectors.length; second += 1) {
          if (this.disposed) {
            return err("E310_INVALID_STATE", "重复管理器已停止");
          }
          const left = vectors[first];
          const right = vectors[second];
          const similarity = Math.min(1, Math.max(-1, dotProduct(left.embedding, right.embedding)));
          if (similarity >= threshold) {
            const id = this.generatePairId(left.id, right.id);
            nextPairs.push({
              id,
              nodeIdA: left.id < right.id ? left.id : right.id,
              nodeIdB: left.id < right.id ? right.id : left.id,
              type,
              similarity,
              status: dismissedIds.has(id) ? "dismissed" : "pending",
            });
          }
          comparisons += 1;
          if (comparisons % REBUILD_YIELD_INTERVAL === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      }
    }

    if (this.disposed) {
      return err("E310_INVALID_STATE", "重复管理器已停止");
    }
    if (threshold !== this.similarityThreshold) {
      return err("E320_TASK_CONFLICT", "相似度阈值在重复项重算期间发生变化");
    }

    this.store.pairs = nextPairs;
    const saveResult = await this.saveStore();
    if (!saveResult.ok) {
      this.store.pairs = previousPairs;
      return saveResult as Result<number>;
    }
    this.notifyListeners();
    this.logger.info("DuplicateManager", "重复对已从语义索引重建", {
      pairCount: nextPairs.length,
      comparisons,
    });
    return ok(nextPairs.length);
  }

  private async removePairsByNodeIdInternal(nodeId: string): Promise<Result<number>> {
    try {
      if (this.disposed || !this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const previousPairs = this.store.pairs;
      const before = previousPairs.length;
      this.store.pairs = this.store.pairs.filter(
        (pair) => pair.nodeIdA !== nodeId && pair.nodeIdB !== nodeId,
      );
      const removed = before - this.store.pairs.length;

      if (removed === 0) {
        return ok(0);
      }

      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        this.store.pairs = previousPairs;
        return saveResult as Result<number>;
      }

      this.notifyListeners();

      this.logger.info("DuplicateManager", "已清理删除笔记关联的重复对", {
        nodeId,
        removed
      });

      return ok(removed);
    } catch (error) {
      this.logger.error("DuplicateManager", "清理重复对失败", error as Error, {
        nodeId
      });
      return err("E500_INTERNAL_ERROR", "清理重复对失败", error);
    }
  }

  private enqueueMutation<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.disposed) {
      return Promise.resolve(err("E310_INVALID_STATE", "重复管理器已停止"));
    }
    const result = this.mutationChain.then(operation);
    this.mutationChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 创建空存储 */
  private createEmptyStore(): DuplicatePairsStore {
    return {
      version: "2.0.0",
      pairs: [],
    };
  }

  private parseStore(raw: unknown): DuplicatePairsStore | null {
    if (!isRecord(raw)) return null;
    const value = raw;
    if (value.version !== "2.0.0" || !Array.isArray(value.pairs)) {
      return null;
    }

    const pairs: DuplicatePair[] = [];
    const seenIds = new Set<string>();
    for (const candidate of value.pairs) {
      const pair = parseDuplicatePair(candidate);
      if (!pair || seenIds.has(pair.id)) return null;
      seenIds.add(pair.id);
      pairs.push(pair);
    }

    return { version: "2.0.0", pairs };
  }

  /** 保存存储（原子写入，防止崩溃时损坏文件） */
  private async saveStore(): Promise<Result<void>> {
    if (!this.store) {
      return err("E310_INVALID_STATE", "存储未初始化");
    }

    const writeResult = await this.fileStorage.atomicWrite(
      this.storePath,
      JSON.stringify(this.store, null, 2)
    );

    if (!writeResult.ok) {
      this.logger.error("DuplicateManager", "保存重复对存储失败", undefined, {
        error: writeResult.error
      });
    }

    return writeResult;
  }

  /** 生成重复对 ID（确保唯一性和一致性） */
  private generatePairId(nodeIdA: string, nodeIdB: string): string {
    // 按字典序排序，确保 ID 一致
    const [first, second] = [nodeIdA, nodeIdB].sort();
    return `${first}--${second}`;
  }

  /** 通知所有监听器 */
  private notifyListeners(): void {
    if (!this.store) {
      return;
    }

    for (const listener of this.listeners) {
      try {
        listener(this.getPendingPairs());
      } catch (error) {
        this.logger.error("DuplicateManager", "监听器执行失败", error as Error);
      }
    }
  }
}
