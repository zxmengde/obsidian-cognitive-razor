/**
 * 重复管理器
 * 负责检测和管理重复概念
 */

import {
  IDuplicateManager,
  IVectorIndex,
  IFileStorage,
  ILogger,
  ISettingsStore,
  DuplicatePair,
  DuplicatePairStatus,
  DuplicatePairsStore,
  CRType,
  Result,
  ok,
  err
} from "../types";

export class DuplicateManager implements IDuplicateManager {
  private vectorIndex: IVectorIndex;
  private fileStorage: IFileStorage;
  private logger: ILogger;
  private settingsStore: ISettingsStore;
  private storePath: string;
  private store: DuplicatePairsStore | null;
  private listeners: Array<(pairs: DuplicatePair[]) => void>;

  constructor(
    vectorIndex: IVectorIndex,
    fileStorage: IFileStorage,
    logger: ILogger,
    settingsStore: ISettingsStore,
    storePath: string = "data/duplicate-pairs.json"
  ) {
    this.vectorIndex = vectorIndex;
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.storePath = storePath;
    this.store = null;
    this.listeners = [];

    this.logger.debug("DuplicateManager", "DuplicateManager 初始化完成", {
      storePath
    });
  }

  /**
   * 初始化（加载存储）
   */
  async initialize(): Promise<Result<void>> {
    try {
      const exists = await this.fileStorage.exists(this.storePath);

      if (exists) {
        const readResult = await this.fileStorage.read(this.storePath);
        if (!readResult.ok) {
          this.logger.error("DuplicateManager", "读取重复对存储失败", undefined, {
            error: readResult.error
          });
          return readResult;
        }

        try {
          this.store = JSON.parse(readResult.value);
          this.logger.info("DuplicateManager", "重复对存储加载成功", {
            pairCount: this.store!.pairs.length,
            dismissedCount: this.store!.dismissedPairs.length
          });
        } catch (parseError) {
          this.logger.error("DuplicateManager", "解析重复对存储失败", parseError as Error);
          this.store = this.createEmptyStore();
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
      return err("E304", "初始化重复管理器失败", error);
    }
  }

  /**
   * 检测重复概念
   * @param nodeId 概念 UID
   * @param type 知识类型
   * @param embedding 向量嵌入
   * @returns 重复对列表
   */
  async detect(
    nodeId: string,
    type: CRType,
    embedding: number[]
  ): Promise<Result<DuplicatePair[]>> {
    try {
      if (!this.store) {
        return err("E304", "重复管理器未初始化");
      }

      const settings = this.settingsStore.getSettings();
      const threshold = settings.similarityThreshold;
      const topK = settings.topK;

      this.logger.debug("DuplicateManager", "开始检测重复", {
        nodeId,
        type,
        threshold,
        topK
      });

      // 在同类型桶内检索相似概念
      const searchResult = await this.vectorIndex.search(type, embedding, topK);

      if (!searchResult.ok) {
        this.logger.error("DuplicateManager", "向量检索失败", undefined, {
          error: searchResult.error
        });
        return searchResult as Result<DuplicatePair[]>;
      }

      const similarConcepts = searchResult.value;

      // 过滤出相似度 >= 阈值的概念
      const duplicates = similarConcepts.filter(
        result => result.similarity >= threshold && result.uid !== nodeId
      );

      if (duplicates.length === 0) {
        this.logger.debug("DuplicateManager", "未检测到重复", {
          nodeId,
          type
        });
        return ok([]);
      }

      // 创建重复对
      const newPairs: DuplicatePair[] = [];

      for (const duplicate of duplicates) {
        // 检查是否已存在或已被标记为非重复
        const pairId = this.generatePairId(nodeId, duplicate.uid);
        
        if (this.store.dismissedPairs.includes(pairId)) {
          this.logger.debug("DuplicateManager", "跳过已标记为非重复的对", {
            pairId
          });
          continue;
        }

        const existingPair = this.store.pairs.find(p => p.id === pairId);
        if (existingPair) {
          this.logger.debug("DuplicateManager", "重复对已存在", {
            pairId
          });
          continue;
        }

        // 获取 noteA 的信息（从向量索引中查找）
        // 由于在去重检测前已经更新了向量索引，可以直接查找
        let noteAName = "";
        let noteAPath = "";
        
        // 从向量索引中查找 noteA 的信息
        // 使用一个小的相似度搜索来找到自己
        const selfSearchResult = await this.vectorIndex.search(type, embedding, 1);
        if (selfSearchResult.ok && selfSearchResult.value.length > 0) {
          const self = selfSearchResult.value[0];
          if (self.uid === nodeId) {
            noteAName = self.name;
            noteAPath = self.path;
          }
        }
        
        // 如果找不到，使用 nodeId 作为名称（不应该发生）
        if (!noteAName) {
          this.logger.warn("DuplicateManager", "无法从向量索引获取 noteA 信息，使用 nodeId", {
            nodeId
          });
          noteAName = nodeId;
        }
        
        this.logger.debug("DuplicateManager", "创建重复对", {
          pairId,
          noteA: { nodeId, name: noteAName, path: noteAPath },
          noteB: { nodeId: duplicate.uid, name: duplicate.name, path: duplicate.path }
        });

        // 创建新的重复对
        const pair: DuplicatePair = {
          id: pairId,
          noteA: {
            nodeId,
            name: noteAName,
            path: noteAPath
          },
          noteB: {
            nodeId: duplicate.uid,
            name: duplicate.name,
            path: duplicate.path
          },
          type,
          similarity: duplicate.similarity,
          detectedAt: new Date().toISOString(),
          status: "pending"
        };

        newPairs.push(pair);
        this.store.pairs.push(pair);
      }

      if (newPairs.length > 0) {
        // 保存存储
        await this.saveStore();

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
      return err("E304", "检测重复失败", error);
    }
  }

  /**
   * 获取待处理的重复对
   */
  getPendingPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs.filter(p => p.status === "pending");
  }

  /**
   * 标记为非重复
   * @param pairId 重复对 ID
   */
  async markAsNonDuplicate(pairId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E304", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E304", `重复对不存在: ${pairId}`);
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
      return err("E304", "标记为非重复失败", error);
    }
  }

  /**
   * 开始合并
   * @param pairId 重复对 ID
   * @returns 合并任务 ID
   */
  async startMerge(pairId: string): Promise<Result<string>> {
    try {
      if (!this.store) {
        return err("E304", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E304", `重复对不存在: ${pairId}`);
      }

      // 更新状态
      this.store.pairs[pairIndex].status = "merging";

      // 保存存储
      const saveResult = await this.saveStore();
      if (!saveResult.ok) {
        return saveResult as Result<string>;
      }

      // 通知监听器
      this.notifyListeners();

      // 生成合并任务 ID（实际应该由 TaskQueue 生成）
      const mergeTaskId = `merge-${pairId}-${Date.now()}`;

      this.logger.info("DuplicateManager", `开始合并重复对: ${pairId}`, {
        mergeTaskId
      });

      return ok(mergeTaskId);
    } catch (error) {
      this.logger.error("DuplicateManager", "开始合并失败", error as Error, {
        pairId
      });
      return err("E304", "开始合并失败", error);
    }
  }

  /**
   * 完成合并
   * @param pairId 重复对 ID
   * @param keepNodeId 保留的概念 UID
   */
  async completeMerge(pairId: string, keepNodeId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E304", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E304", `重复对不存在: ${pairId}`);
      }

      const pair = this.store.pairs[pairIndex];

      // 确定被删除的节点
      const deleteNodeId = keepNodeId === pair.noteA.nodeId 
        ? pair.noteB.nodeId 
        : pair.noteA.nodeId;

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
      return err("E304", "完成合并失败", error);
    }
  }

  /**
   * 订阅重复对变更
   * @param listener 监听器
   * @returns 取消订阅函数
   */
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

  /**
   * 更新重复对状态
   * @param pairId 重复对 ID
   * @param status 新状态
   */
  async updateStatus(pairId: string, status: DuplicatePairStatus): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E304", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E304", `重复对不存在: ${pairId}`);
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
      return err("E304", "更新状态失败", error);
    }
  }

  /**
   * 移除重复对
   * @param pairId 重复对 ID
   */
  async removePair(pairId: string): Promise<Result<void>> {
    try {
      if (!this.store) {
        return err("E304", "重复管理器未初始化");
      }

      const pairIndex = this.store.pairs.findIndex(p => p.id === pairId);
      if (pairIndex === -1) {
        this.logger.warn("DuplicateManager", "重复对不存在", { pairId });
        return err("E304", `重复对不存在: ${pairId}`);
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
      return err("E304", "移除重复对失败", error);
    }
  }

  /**
   * 获取已合并的重复对
   */
  getMergedPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs.filter(p => p.status === "merged");
  }

  /**
   * 获取已忽略的重复对
   */
  getDismissedPairs(): DuplicatePair[] {
    if (!this.store) {
      this.logger.warn("DuplicateManager", "重复管理器未初始化");
      return [];
    }

    return this.store.pairs.filter(p => p.status === "dismissed");
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 创建空存储
   */
  private createEmptyStore(): DuplicatePairsStore {
    return {
      version: "1.0.0",
      pairs: [],
      dismissedPairs: []
    };
  }

  /**
   * 保存存储
   */
  private async saveStore(): Promise<Result<void>> {
    if (!this.store) {
      return err("E304", "存储未初始化");
    }

    const writeResult = await this.fileStorage.write(
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

  /**
   * 生成重复对 ID
   * 确保 ID 的唯一性和一致性（无论 A、B 顺序如何）
   */
  private generatePairId(nodeIdA: string, nodeIdB: string): string {
    // 按字典序排序，确保 ID 一致
    const [first, second] = [nodeIdA, nodeIdB].sort();
    return `${first}--${second}`;
  }

  /**
   * 通知所有监听器
   */
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
