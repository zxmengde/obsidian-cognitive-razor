/**
 * UndoManager 组件
 * 负责快照创建、恢复和清理策略
 * 验证需求：5.1, 5.3, 5.4
 */

import { Result, ok, err } from "../types";
import { FileStorage } from "../data/file-storage";

/**
 * 快照记录
 */
export interface Snapshot {
  /** 快照 ID */
  id: string;
  /** 原始文件路径（相对于 vault 根目录） */
  filePath: string;
  /** 快照内容 */
  content: string;
  /** 创建时间 */
  created: string;
  /** 操作描述 */
  operation: string;
}

/**
 * 快照元数据（用于索引）
 */
export interface SnapshotMetadata {
  /** 快照 ID */
  id: string;
  /** 原始文件路径 */
  filePath: string;
  /** 创建时间 */
  created: string;
  /** 操作描述 */
  operation: string;
}

/**
 * UndoManager 配置
 */
export interface UndoManagerConfig {
  /** FileStorage 实例 */
  storage: FileStorage;
  /** 最大快照数量 */
  maxSnapshots: number;
  /** 快照存储目录 */
  snapshotsDir?: string;
}

/**
 * UndoManager 组件
 */
export class UndoManager {
  private storage: FileStorage;
  private maxSnapshots: number;
  private snapshotsDir: string;
  private metadataFile: string;

  constructor(config: UndoManagerConfig) {
    this.storage = config.storage;
    this.maxSnapshots = config.maxSnapshots;
    this.snapshotsDir = config.snapshotsDir || "snapshots";
    this.metadataFile = `${this.snapshotsDir}/index.json`;
  }

  /**
   * 初始化快照目录
   */
  async initialize(): Promise<Result<void>> {
    // 确保快照目录存在
    const dirResult = await this.storage.ensureDir(this.snapshotsDir);
    if (!dirResult.ok) {
      return dirResult;
    }

    // 如果元数据文件不存在，创建空索引
    const exists = await this.storage.exists(this.metadataFile);
    if (!exists) {
      const initResult = await this.storage.writeJSON(this.metadataFile, []);
      if (!initResult.ok) {
        return initResult;
      }
    }

    return ok(undefined);
  }

  /**
   * 创建快照
   * 在写入操作前调用，保存文件当前状态
   */
  async createSnapshot(
    filePath: string,
    content: string,
    operation: string
  ): Promise<Result<string>> {
    // 生成快照 ID
    const snapshotId = this.generateSnapshotId();
    const timestamp = new Date().toISOString();

    // 创建快照对象
    const snapshot: Snapshot = {
      id: snapshotId,
      filePath,
      content,
      created: timestamp,
      operation,
    };

    // 保存快照内容
    const snapshotPath = `${this.snapshotsDir}/${snapshotId}.json`;
    const saveResult = await this.storage.writeJSON(snapshotPath, snapshot);
    if (!saveResult.ok) {
      return err(
        "SNAPSHOT_CREATE_ERROR",
        `创建快照失败: ${snapshotId}`,
        saveResult.error
      );
    }

    // 更新元数据索引
    const metadata: SnapshotMetadata = {
      id: snapshotId,
      filePath,
      created: timestamp,
      operation,
    };

    const updateResult = await this.addToIndex(metadata);
    if (!updateResult.ok) {
      // 如果索引更新失败，尝试删除快照文件
      await this.storage.deleteFile(snapshotPath);
      return err(
        "SNAPSHOT_INDEX_ERROR",
        `更新快照索引失败: ${snapshotId}`,
        updateResult.error
      );
    }

    // 检查并清理旧快照
    await this.cleanupOldSnapshots();

    return ok(snapshotId);
  }

  /**
   * 恢复快照
   * 返回快照内容，由调用者负责写入文件
   */
  async restoreSnapshot(snapshotId: string): Promise<Result<Snapshot>> {
    // 读取快照
    const snapshotPath = `${this.snapshotsDir}/${snapshotId}.json`;
    const readResult = await this.storage.readJSON<Snapshot>(snapshotPath);
    if (!readResult.ok) {
      return err(
        "SNAPSHOT_NOT_FOUND",
        `快照不存在: ${snapshotId}`,
        readResult.error
      );
    }

    return ok(readResult.value);
  }

  /**
   * 删除快照
   * 在成功恢复后调用
   */
  async deleteSnapshot(snapshotId: string): Promise<Result<void>> {
    // 删除快照文件
    const snapshotPath = `${this.snapshotsDir}/${snapshotId}.json`;
    const deleteResult = await this.storage.deleteFile(snapshotPath);
    if (!deleteResult.ok) {
      return err(
        "SNAPSHOT_DELETE_ERROR",
        `删除快照失败: ${snapshotId}`,
        deleteResult.error
      );
    }

    // 从索引中移除
    const removeResult = await this.removeFromIndex(snapshotId);
    if (!removeResult.ok) {
      return err(
        "SNAPSHOT_INDEX_ERROR",
        `从索引移除快照失败: ${snapshotId}`,
        removeResult.error
      );
    }

    return ok(undefined);
  }

  /**
   * 获取所有快照元数据
   */
  async listSnapshots(): Promise<Result<SnapshotMetadata[]>> {
    const readResult = await this.storage.readJSON<SnapshotMetadata[]>(
      this.metadataFile
    );
    if (!readResult.ok) {
      return err(
        "SNAPSHOT_LIST_ERROR",
        "读取快照索引失败",
        readResult.error
      );
    }

    return ok(readResult.value);
  }

  /**
   * 获取快照数量
   */
  async getSnapshotCount(): Promise<Result<number>> {
    const listResult = await this.listSnapshots();
    if (!listResult.ok) {
      return listResult;
    }

    return ok(listResult.value.length);
  }

  /**
   * 清理旧快照
   * 当快照数量超过上限时，删除最旧的快照
   */
  private async cleanupOldSnapshots(): Promise<Result<void>> {
    const listResult = await this.listSnapshots();
    if (!listResult.ok) {
      return listResult;
    }

    const snapshots = listResult.value;

    // 如果快照数量未超过上限，无需清理
    if (snapshots.length <= this.maxSnapshots) {
      return ok(undefined);
    }

    // 按创建时间排序（最旧的在前）
    const sortedSnapshots = [...snapshots].sort(
      (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );

    // 计算需要删除的快照数量
    const toDelete = snapshots.length - this.maxSnapshots;

    // 删除最旧的快照
    for (let i = 0; i < toDelete; i++) {
      const snapshot = sortedSnapshots[i];
      const deleteResult = await this.deleteSnapshot(snapshot.id);
      if (!deleteResult.ok) {
        // 记录错误但继续清理其他快照
        console.error(`清理快照失败: ${snapshot.id}`, deleteResult.error);
      }
    }

    return ok(undefined);
  }

  /**
   * 添加快照到索引
   */
  private async addToIndex(
    metadata: SnapshotMetadata
  ): Promise<Result<void>> {
    const listResult = await this.listSnapshots();
    if (!listResult.ok) {
      return listResult;
    }

    const snapshots = listResult.value;
    snapshots.push(metadata);

    const saveResult = await this.storage.writeJSON(
      this.metadataFile,
      snapshots
    );
    if (!saveResult.ok) {
      return err(
        "SNAPSHOT_INDEX_ERROR",
        "保存快照索引失败",
        saveResult.error
      );
    }

    return ok(undefined);
  }

  /**
   * 从索引中移除快照
   */
  private async removeFromIndex(snapshotId: string): Promise<Result<void>> {
    const listResult = await this.listSnapshots();
    if (!listResult.ok) {
      return listResult;
    }

    const snapshots = listResult.value;
    const filtered = snapshots.filter((s) => s.id !== snapshotId);

    const saveResult = await this.storage.writeJSON(
      this.metadataFile,
      filtered
    );
    if (!saveResult.ok) {
      return err(
        "SNAPSHOT_INDEX_ERROR",
        "保存快照索引失败",
        saveResult.error
      );
    }

    return ok(undefined);
  }

  /**
   * 生成快照 ID
   * 格式: snapshot-{timestamp}-{random}
   */
  private generateSnapshotId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `snapshot-${timestamp}-${random}`;
  }
}
