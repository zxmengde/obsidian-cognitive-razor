/**
 * DuplicateManager 组件
 * 实现重复对检测、记录和状态管理
 */

import {
  Result,
  ok,
  err,
  DuplicatePair,
  DuplicatePairStatus,
  CRType,
} from "../types";
import { FileStorage } from "../data/file-storage";

/**
 * 重复对存储数据结构
 */
interface DuplicatePairsData {
  /** 版本号 */
  version: string;
  /** 重复对列表 */
  pairs: DuplicatePair[];
  /** 最后更新时间 */
  lastUpdated: string;
}

/**
 * DuplicateManager 接口
 */
export interface IDuplicateManager {
  /** 添加重复对 */
  addPair(pair: Omit<DuplicatePair, "id" | "detectedAt">): Promise<Result<string>>;
  /** 获取重复对 */
  getPair(id: string): Promise<Result<DuplicatePair | null>>;
  /** 获取所有待处理的重复对 */
  getPendingPairs(): Promise<Result<DuplicatePair[]>>;
  /** 获取已忽略的重复对 */
  getDismissedPairs(): Promise<Result<DuplicatePair[]>>;
  /** 获取已合并的重复对 */
  getMergedPairs(): Promise<Result<DuplicatePair[]>>;
  /** 获取所有重复对 */
  getAllPairs(): Promise<Result<DuplicatePair[]>>;
  /** 获取指定类型的重复对 */
  getPairsByType(type: CRType): Promise<Result<DuplicatePair[]>>;
  /** 更新重复对状态 */
  updateStatus(id: string, status: DuplicatePairStatus): Promise<Result<void>>;
  /** 删除重复对 */
  removePair(id: string): Promise<Result<void>>;
  /** 检查是否存在重复对 */
  hasPair(nodeIdA: string, nodeIdB: string): Promise<Result<boolean>>;
  /** 加载重复对数据 */
  load(): Promise<Result<void>>;
  /** 保存重复对数据 */
  save(): Promise<Result<void>>;
}

/**
 * DuplicateManager 实现
 */
export class DuplicateManager implements IDuplicateManager {
  private static readonly PAIRS_FILE = "duplicate-pairs.json";
  private static readonly VERSION = "1.0.0";

  private storage: FileStorage;
  private data: DuplicatePairsData;

  constructor(storage: FileStorage) {
    this.storage = storage;
    this.data = this.createEmptyData();
  }

  /**
   * 创建空数据
   */
  private createEmptyData(): DuplicatePairsData {
    return {
      version: DuplicateManager.VERSION,
      pairs: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `dup-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 加载重复对数据
   */
  async load(): Promise<Result<void>> {
    const exists = await this.storage.exists(DuplicateManager.PAIRS_FILE);
    if (!exists) {
      // 文件不存在，使用空数据
      this.data = this.createEmptyData();
      return ok(undefined);
    }

    const result = await this.storage.readJSON<DuplicatePairsData>(
      DuplicateManager.PAIRS_FILE
    );
    if (!result.ok) {
      return result;
    }

    // 验证数据结构
    const data = result.value;
    if (!data.pairs || !Array.isArray(data.pairs)) {
      return err(
        "INVALID_PAIRS_DATA",
        "重复对数据格式无效：缺少 pairs 字段"
      );
    }

    this.data = data;
    return ok(undefined);
  }

  /**
   * 保存重复对数据
   */
  async save(): Promise<Result<void>> {
    this.data.lastUpdated = new Date().toISOString();
    return await this.storage.writeJSON(DuplicateManager.PAIRS_FILE, this.data);
  }

  /**
   * 添加重复对
   */
  async addPair(
    pair: Omit<DuplicatePair, "id" | "detectedAt">
  ): Promise<Result<string>> {
    // 验证输入
    if (!pair.noteA || !pair.noteB || !pair.type) {
      return err(
        "INVALID_PAIR",
        "重复对无效：缺少必填字段 (noteA, noteB, type)"
      );
    }

    if (!pair.noteA.nodeId || !pair.noteB.nodeId) {
      return err("INVALID_NODE_ID", "节点 ID 不能为空");
    }

    if (pair.similarity < 0 || pair.similarity > 1) {
      return err("INVALID_SIMILARITY", "相似度必须在 [0, 1] 范围内");
    }

    // 检查是否已存在相同的重复对
    const existsResult = await this.hasPair(
      pair.noteA.nodeId,
      pair.noteB.nodeId
    );
    if (!existsResult.ok) {
      return existsResult;
    }
    if (existsResult.value) {
      return err("PAIR_ALREADY_EXISTS", "重复对已存在");
    }

    // 创建新的重复对
    const id = this.generateId();
    const newPair: DuplicatePair = {
      id,
      ...pair,
      detectedAt: new Date().toISOString(),
    };

    this.data.pairs.push(newPair);

    // 持久化
    const saveResult = await this.save();
    if (!saveResult.ok) {
      return saveResult;
    }

    return ok(id);
  }

  /**
   * 获取重复对
   */
  async getPair(id: string): Promise<Result<DuplicatePair | null>> {
    if (!id) {
      return err("INVALID_ID", "ID 不能为空");
    }

    const pair = this.data.pairs.find((p) => p.id === id);
    return ok(pair || null);
  }

  /**
   * 获取所有待处理的重复对
   */
  async getPendingPairs(): Promise<Result<DuplicatePair[]>> {
    const pendingPairs = this.data.pairs.filter((p) => p.status === "pending");
    return ok(pendingPairs);
  }

  /**
   * 获取已忽略的重复对
   */
  async getDismissedPairs(): Promise<Result<DuplicatePair[]>> {
    const dismissedPairs = this.data.pairs.filter((p) => p.status === "dismissed");
    return ok(dismissedPairs);
  }

  /**
   * 获取已合并的重复对
   */
  async getMergedPairs(): Promise<Result<DuplicatePair[]>> {
    const mergedPairs = this.data.pairs.filter((p) => p.status === "merged");
    return ok(mergedPairs);
  }

  /**
   * 获取所有重复对（包括所有状态）
   */
  async getAllPairs(): Promise<Result<DuplicatePair[]>> {
    return ok([...this.data.pairs]);
  }

  /**
   * 获取指定类型的重复对
   */
  async getPairsByType(type: CRType): Promise<Result<DuplicatePair[]>> {
    if (!type) {
      return err("INVALID_TYPE", "类型不能为空");
    }

    const pairs = this.data.pairs.filter((p) => p.type === type);
    return ok(pairs);
  }

  /**
   * 更新重复对状态
   */
  async updateStatus(
    id: string,
    status: DuplicatePairStatus
  ): Promise<Result<void>> {
    if (!id) {
      return err("INVALID_ID", "ID 不能为空");
    }

    if (!status) {
      return err("INVALID_STATUS", "状态不能为空");
    }

    const pair = this.data.pairs.find((p) => p.id === id);
    if (!pair) {
      return err("PAIR_NOT_FOUND", `未找到 ID 为 ${id} 的重复对`);
    }

    pair.status = status;

    // 持久化
    return await this.save();
  }

  /**
   * 删除重复对
   */
  async removePair(id: string): Promise<Result<void>> {
    if (!id) {
      return err("INVALID_ID", "ID 不能为空");
    }

    const index = this.data.pairs.findIndex((p) => p.id === id);
    if (index < 0) {
      return err("PAIR_NOT_FOUND", `未找到 ID 为 ${id} 的重复对`);
    }

    this.data.pairs.splice(index, 1);

    // 持久化
    return await this.save();
  }

  /**
   * 检查是否存在重复对
   * 检查两个节点 ID 的组合（不考虑顺序）
   */
  async hasPair(nodeIdA: string, nodeIdB: string): Promise<Result<boolean>> {
    if (!nodeIdA || !nodeIdB) {
      return err("INVALID_NODE_ID", "节点 ID 不能为空");
    }

    const exists = this.data.pairs.some(
      (p) =>
        (p.noteA.nodeId === nodeIdA && p.noteB.nodeId === nodeIdB) ||
        (p.noteA.nodeId === nodeIdB && p.noteB.nodeId === nodeIdA)
    );

    return ok(exists);
  }
}
