/** 重复管理器：检测和管理重复概念 */

import {
  ok,
  err
} from "../types";
import type {
  ILogger,
  DuplicatePair,
  DuplicatePairStatus,
  DuplicatePairsStore,
  CRType,
  Result,
} from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import type { VectorIndex } from "./vector-index";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import type { SimpleLockManager } from "./lock-manager";
import { normalizeVector, dotProduct } from "./vector-math";

export class DuplicateManager {
  private vectorIndex: VectorIndex;
  private fileStorage: FileStorage;
  private logger: ILogger;
  private settingsStore: SettingsStore;
  private lockManager: SimpleLockManager;
  private storePath: string;
  private store: DuplicatePairsStore | null;
  private listeners: Array<(pairs: DuplicatePair[]) => void>;
  /** 分页检测每页比较的概念数量 */
  private readonly pageSize: number = 50;

  constructor(
    vectorIndex: VectorIndex,
    fileStorage: FileStorage,
    logger: ILogger,
    settingsStore: SettingsStore,
    lockManager: SimpleLockManager,
    storePath: string = "data/duplicate-pairs.json"
  ) {
    this.vectorIndex = vectorIndex;
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.lockManager = lockManager;
    this.storePath = storePath;
    this.store = null;
    this.listeners = [];

    this.logger.debug("DuplicateManager", "DuplicateManager 初始化完成", {
      storePath
    });
  }

  /** 初始化（加载存储） */
  async initialize(): Promise<Result<void>> {
    try {
      const exists = await this.fileStorage.exists(this.storePath);

      if (exists) {
        const readResult = await this.fileStorage.read(this.storePath);
        if (!readResult.ok) {
          // 文件读取失败，创建新存储
          this.logger.warn("DuplicateManager", "读取重复对存储失败，创建新存储", {
            error: readResult.error
          });
          this.store = this.createEmptyStore();
          const writeResult = await this.saveStore();
          if (!writeResult.ok) {
            return writeResult;
          }
          return ok(undefined);
        }

        try {
          this.store = JSON.parse(readResult.value);
          const migrated = this.migrateStoreSchema();
          if (migrated) {
            const saveResult = await this.saveStore();
            if (!saveResult.ok) {
              return saveResult;
            }
          }
          this.logger.info("DuplicateManager", "重复对存储加载成功", {
            pairCount: this.store!.pairs.length,
            dismissedCount: this.store!.dismissedPairs.length
          });
        } catch (parseError) {
          this.logger.warn("DuplicateManager", "解析重复对存储失败，创建新存储", {
            error: parseError
          });
          this.store = this.createEmptyStore();
          const writeResult = await this.saveStore();
          if (!writeResult.ok) {
            return writeResult;
          }
        }
      } else {
        this.store = this.createEmptyStore();
        const writeResult = await this.saveStore();
        if (!writeResult.ok) {
          return writeResult;
        }
        this.logger.info("DuplicateManager", "创建新的重复对存储");
      }

      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "初始化失败", error as Error);
      return err("E500_INTERNAL_ERROR", "初始化重复管理器失败", error);
    }
  }

  /** 检测重复概念（分页计算 + 让出事件循环） */
  async detect(
    nodeId: string,
    type: CRType,
    embedding: number[]
  ): Promise<Result<DuplicatePair[]>> {
    // 获取类型锁，防止同类型的并发去重检测
    const typeLockKey = `type:${type}`;
    const acquired = this.lockManager.tryAcquire(typeLockKey);
    if (!acquired) {
      this.logger.warn("DuplicateManager", "类型锁冲突，跳过去重检测", {
        nodeId,
        type,
        lockKey: typeLockKey
      });
      // 类型锁冲突时返回空数组，不阻塞流程
      return ok([]);
    }

    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const settings = this.settingsStore.getSettings();
      const threshold = settings.similarityThreshold;
      const dismissedSet = new Set(this.store.dismissedPairs);
      const existingPairIds = new Set(this.store.pairs.map((p) => p.id));

      this.logger.debug("DuplicateManager", "开始检测重复", {
        nodeId,
        type,
        threshold
      });

      // 获取同类型所有向量（增量检测：仅新概念 vs 已有概念）
      const vectorsResult = await this.vectorIndex.getVectorsByType(type);
      if (!vectorsResult.ok) {
        this.logger.error("DuplicateManager", "获取同类型向量失败", undefined, {
          error: vectorsResult.error
        });
        return vectorsResult as Result<DuplicatePair[]>;
      }

      // 排除自身，仅保留候选概念
      const candidates = vectorsResult.value.filter(v => v.id !== nodeId);

      if (candidates.length === 0) {
        this.logger.debug("DuplicateManager", "无同类型候选概念", {
          nodeId,
          type
        });
        return ok([]);
      }

      // 归一化新概念的向量
      const normalizedNew = normalizeVector(embedding);

      // 分页计算相似度，每页 pageSize 个概念
      const newPairs: DuplicatePair[] = [];

      for (let i = 0; i < candidates.length; i += this.pageSize) {
        const page = candidates.slice(i, i + this.pageSize);

        for (const candidate of page) {
          const normalizedCandidate = normalizeVector(candidate.embedding);
          const similarity = dotProduct(normalizedNew, normalizedCandidate);

          if (similarity >= threshold) {
            const pairId = this.generatePairId(nodeId, candidate.id);

            // 跳过已标记为非重复或已存在的对
            if (dismissedSet.has(pairId) || existingPairIds.has(pairId)) {
              continue;
            }

            const pair: DuplicatePair = {
              id: pairId,
              nodeIdA: nodeId,
              nodeIdB: candidate.id,
              type,
              similarity,
              detectedAt: formatCRTimestamp(),
              status: "pending"
            };

            newPairs.push(pair);
            this.store.pairs.push(pair);
            existingPairIds.add(pairId);
          }
        }

        // 分页之间让出事件循环，避免阻塞 UI 线程
        if (i + this.pageSize < candidates.length) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }

      if (newPairs.length > 0) {
        // 保存存储，失败时记录警告但不阻断流程
        const saveResult = await this.saveStore();
        if (!saveResult.ok) {
          this.logger.warn("DuplicateManager", "保存重复对失败，新检测结果仅存在内存中", {
            error: saveResult.error
          });
        }

        // 通知监听器
        this.notifyListeners();

        this.logger.info("DuplicateManager", `检测到 ${newPairs.length} 个重复对`, {
          nodeId,
          type,
          newPairs: newPairs.map(p => p.id)
        });
      }

      return ok(newPairs);
    } catch (error) {
      this.logger.error("DuplicateManager", "检测重复失败", error as Error, {
        nodeId,
        type
      });
      return err("E500_INTERNAL_ERROR", "检测重复失败", error);
    } finally {
      // 释放类型锁
      this.lockManager.release(typeLockKey);
    }
  }

  /** 获取待处理的重复对 */
  getPendingPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs.filter(p => p.status === "pending");
  }

  /** 标记为非重复 */
  async markAsNonDuplicate(pairId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E311_NOT_FOUND", `重复对不存在: ${pairId}`);
      }

      // 更新状态
      this.store.pairs[pairIndex].status = "dismissed";

      // 添加到已标记列表
      if (!this.store.dismissedPairs.includes(pairId)) {
        this.store.dismissedPairs.push(pairId);
      }

      // 保存存储
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
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


  /** 完成合并 */
  async completeMerge(pairId: string, keepNodeId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E311_NOT_FOUND", `重复对不存在: ${pairId}`);
      }

      const pair = this.store.pairs[pairIndex];

      // 确定被删除的节点
      const deleteNodeId = keepNodeId === pair.nodeIdA 
        ? pair.nodeIdB 
        : pair.nodeIdA;

      // 更新状态
      this.store.pairs[pairIndex].status = "merged";

      // 保存存储
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        return saveResult;
      }

      // 通知监听器
      this.notifyListeners();

      this.logger.info("DuplicateManager", `合并完成: ${pairId}`, {
        keepNodeId,
        deleteNodeId
      });

      // 注意：实际删除被合并笔记的操作应该由 TaskRunner 执行
      // 这里只是更新状态

      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "完成合并失败", error as Error, {
        pairId,
        keepNodeId
      });
      return err("E500_INTERNAL_ERROR", "完成合并失败", error);
    }
  }

  /**
   * 中止合并（将 merging 状态回退为 pending）
   *
   * 用于 Merge 管线在确认写入阶段失败时的恢复，避免重复对长期卡在 merging。
   */
  async abortMerge(pairId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E311_NOT_FOUND", `重复对不存在: ${pairId}`);
      }

      const current = this.store.pairs[pairIndex];
      if (current.status !== "merging") {
        return ok(undefined);
      }

      this.store.pairs[pairIndex].status = "pending";

      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        return saveResult;
      }

      this.notifyListeners();

      this.logger.info("DuplicateManager", `合并已中止并回退为 pending: ${pairId}`);
      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "中止合并失败", error as Error, {
        pairId
      });
      return err("E500_INTERNAL_ERROR", "中止合并失败", error);
    }
  }

  /** 订阅重复对变更 */
  subscribe(listener: (pairs: DuplicatePair[]) => void): () => void {
    this.listeners.push(listener);

    // 立即调用一次
    if (this.store) {
      listener(this.store.pairs);
    }

    // 返回取消订阅函数
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /** 更新重复对状态 */
  async updateStatus(pairId: string, status: DuplicatePairStatus): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E311_NOT_FOUND", `重复对不存在: ${pairId}`);
      }

      // 更新状态
      this.store.pairs[pairIndex].status = status;

      // 保存存储
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        return saveResult;
      }

      // 通知监听器
      this.notifyListeners();

      this.logger.info("DuplicateManager", `重复对状态已更新: ${pairId} -> ${status}`);

      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "更新状态失败", error as Error, {
        pairId,
        status
      });
      return err("E500_INTERNAL_ERROR", "更新状态失败", error);
    }
  }

  /** 移除重复对 */
  async removePair(pairId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E311_NOT_FOUND", `重复对不存在: ${pairId}`);
      }

      // 移除重复对
      this.store.pairs.splice(pairIndex, 1);

      // 保存存储
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        return saveResult;
      }

      // 通知监听器
      this.notifyListeners();

      this.logger.info("DuplicateManager", `重复对已移除: ${pairId}`);

      return ok(undefined);
    } catch (error) {
      this.logger.error("DuplicateManager", "移除重复对失败", error as Error, {
        pairId
      });
      return err("E500_INTERNAL_ERROR", "移除重复对失败", error);
    }
  }

  /** 获取已合并的重复对 */
  getMergedPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs.filter(p => p.status === "merged");
  }

  /** 获取已忽略的重复对 */
  getDismissedPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs.filter(p => p.status === "dismissed");
  }

  /**
   * 清理包含指定 nodeId 的重复对（用于笔记删除后的关联数据清理）
   * 仅保留 merging 状态，避免与合并管线产生竞态
   */
  async removePairsByNodeId(nodeId: string): Promise<Result<number>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const before = this.store.pairs.length;
      this.store.pairs = this.store.pairs.filter((p) => {
        if (p.status === "merging") {
          return true;
        }
        return p.nodeIdA !== nodeId && p.nodeIdB !== nodeId;
      });
      const removed = before - this.store.pairs.length;

      if (removed === 0) {
        return ok(0);
      }

      // 清理 dismissedPairs 中不存在的记录，避免历史列表膨胀
      const existingIds = new Set(this.store.pairs.map((p) => p.id));
      this.store.dismissedPairs = this.store.dismissedPairs.filter((id) => existingIds.has(id));

      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
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

  /**
   * 清理包含指定 nodeId 的 Pending 重复对（用于内容发生语义变更后的重检）
   *
   * 约束：
   * - 仅清理 pending，保留 dismissed/merged/merging 的历史与状态
   * - 不触碰 dismissedPairs 历史列表，避免 UX 反复弹出
   */
  async clearPendingPairsByNodeId(nodeId: string): Promise<Result<number>> {
    try {
      if (!this.store) {
        return err("E310_INVALID_STATE", "重复管理器未初始化");
      }

      const before = this.store.pairs.length;
      this.store.pairs = this.store.pairs.filter((p) => {
        if (p.status !== "pending") {
          return true;
        }
        return p.nodeIdA !== nodeId && p.nodeIdB !== nodeId;
      });
      const removed = before - this.store.pairs.length;

      if (removed === 0) {
        return ok(0);
      }

      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        return saveResult as Result<number>;
      }

      this.notifyListeners();

      this.logger.info("DuplicateManager", "已清理语义变更后的 Pending 重复对", {
        nodeId,
        removed
      });

      return ok(removed);
    } catch (error) {
      this.logger.error("DuplicateManager", "清理 Pending 重复对失败", error as Error, {
        nodeId
      });
      return err("E500_INTERNAL_ERROR", "清理 Pending 重复对失败", error);
    }
  }

  /** 创建空存储 */
  private createEmptyStore(): DuplicatePairsStore {
    return {
      version: "1.0.0",
      pairs: [],
      dismissedPairs: []
    };
  }

  /**
   * 迁移存储结构：
   * - 旧格式：pairs[].noteA/noteB（包含 name/path）
   * - 新格式：pairs[].nodeIdA/nodeIdB（仅保存 cruid）
   */
  private migrateStoreSchema(): boolean {
    if (!this.store) {
      return false;
    }

    let changed = false;
    const migratedPairs: DuplicatePair[] = [];

    for (const raw of this.store.pairs as unknown as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== "object") {
        changed = true;
        continue;
      }

      if (typeof raw.nodeIdA === "string" && typeof raw.nodeIdB === "string") {
        migratedPairs.push(raw as unknown as DuplicatePair);
        continue;
      }

      const noteA = raw.noteA as { nodeId?: unknown } | undefined;
      const noteB = raw.noteB as { nodeId?: unknown } | undefined;
      const nodeIdA = typeof noteA?.nodeId === "string" ? noteA.nodeId : null;
      const nodeIdB = typeof noteB?.nodeId === "string" ? noteB.nodeId : null;

      if (!nodeIdA || !nodeIdB) {
        changed = true;
        continue;
      }

      migratedPairs.push({
        id: String(raw.id || `${nodeIdA}--${nodeIdB}`),
        nodeIdA,
        nodeIdB,
        type: raw.type as CRType,
        similarity: typeof raw.similarity === "number" ? raw.similarity : 0,
        detectedAt: typeof raw.detectedAt === "string" ? raw.detectedAt : formatCRTimestamp(),
        status: raw.status === "pending" || raw.status === "merging" || raw.status === "merged" || raw.status === "dismissed"
          ? (raw.status as DuplicatePairStatus)
          : "pending"
      });
      changed = true;
    }

    if (changed) {
      this.store.pairs = migratedPairs;
    }

    return changed;
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
        listener(this.store.pairs);
      } catch (error) {
        this.logger.error("DuplicateManager", "监听器执行失败", error as Error);
      }
    }
  }
}
