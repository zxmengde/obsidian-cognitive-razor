/**
 * 撤销管理器
 * 负责快照的创建、恢复和管理
 */

import {
  IUndoManager,
  IFileStorage,
  ILogger,
  SnapshotRecord,
  SnapshotIndex,
  Snapshot,
  SnapshotMetadata,
  Result,
  ok,
  err
} from "../types";
import { createHash } from "crypto";

export class UndoManager implements IUndoManager {
  private fileStorage: IFileStorage;
  private logger: ILogger;
  private snapshotsDir: string;
  private indexPath: string;
  private maxSnapshots: number;
  private maxAgeDays: number;
  private index: SnapshotIndex | null;
  private readonly MAX_SNAPSHOT_SIZE = 10 * 1024 * 1024; // 10MB 防止 OOM

  constructor(
    fileStorage: IFileStorage,
    logger: ILogger,
    snapshotsDir: string = "data/snapshots",
    maxSnapshots: number = 100,
    maxAgeDays: number = 30
  ) {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.snapshotsDir = snapshotsDir;
    this.indexPath = `${snapshotsDir}/index.json`;
    this.maxSnapshots = maxSnapshots;
    this.maxAgeDays = maxAgeDays;
    this.index = null;

    this.logger.debug("UndoManager", "UndoManager 初始化完成", {
      snapshotsDir,
      maxSnapshots,
      maxAgeDays
    });
  }

  /**
   * 更新保留策略配置
   * 遵循 A-FUNC-02：快照保留策略配置化
   */
  updateRetentionPolicy(maxSnapshots?: number, maxAgeDays?: number): void {
    if (maxSnapshots !== undefined) {
      this.maxSnapshots = maxSnapshots;
    }
    if (maxAgeDays !== undefined) {
      this.maxAgeDays = maxAgeDays;
    }
    
    // 更新索引中的保留策略
    if (this.index) {
      this.index.retentionPolicy = {
        maxCount: this.maxSnapshots,
        maxAgeDays: this.maxAgeDays
      };
      // 异步保存索引
      this.saveIndex().catch(err => {
        this.logger.error("UndoManager", "保存保留策略失败", err as Error);
      });
    }
    
    this.logger.info("UndoManager", "保留策略已更新", {
      maxSnapshots: this.maxSnapshots,
      maxAgeDays: this.maxAgeDays
    });
  }

  /**
   * 初始化撤销管理器
   */
  async initialize(): Promise<Result<void>> {
    try {
      // 确保快照目录存在
      const dirResult = await this.fileStorage.ensureDir(this.snapshotsDir);
      if (!dirResult.ok) {
        return dirResult;
      }

      // 尝试加载索引文件
      const indexExists = await this.fileStorage.exists(this.indexPath);
      
      if (indexExists) {
        const readResult = await this.fileStorage.read(this.indexPath);
        if (!readResult.ok) {
          // 文件读取失败，创建新索引
          this.logger.warn("UndoManager", "读取快照索引失败，创建新索引", {
            error: readResult.error
          });
          this.index = this.createEmptyIndex();
          const writeResult = await this.saveIndex();
          if (!writeResult.ok) {
            return writeResult;
          }
          return ok(undefined);
        }

        try {
          this.index = JSON.parse(readResult.value);
          this.logger.info("UndoManager", "快照索引加载成功", {
            snapshotCount: this.index!.snapshots.length
          });
        } catch (parseError) {
          this.logger.warn("UndoManager", "解析快照索引失败，创建新索引", {
            error: parseError
          });
          // 创建新索引
          this.index = this.createEmptyIndex();
          const writeResult = await this.saveIndex();
          if (!writeResult.ok) {
            return writeResult;
          }
        }
      } else {
        // 创建新索引
        this.index = this.createEmptyIndex();
        const writeResult = await this.saveIndex();
        if (!writeResult.ok) {
          return writeResult;
        }
        this.logger.info("UndoManager", "创建新的快照索引");
      }

      return ok(undefined);
    } catch (error) {
      this.logger.error("UndoManager", "初始化失败", error as Error);
      return err("E303", "初始化撤销管理器失败", error);
    }
  }

  /**
   * 创建快照
   * 遵循 Requirements 2.7：快照包含 id, nodeId, taskId, path, content, created, fileSize, checksum
   * 
   * @param filePath 文件路径
   * @param content 文件内容
   * @param taskId 关联的任务 ID
   * @param nodeId 可选的节点 ID，如果不提供则从文件路径提取
   * @returns 快照 ID
   */
  async createSnapshot(
    filePath: string,
    content: string,
    taskId: string,
    nodeId?: string
  ): Promise<Result<string>> {
    try {
      if (!this.index) {
        return err("E303", "撤销管理器未初始化");
      }

      // 验证必需参数
      if (!filePath || typeof filePath !== 'string') {
        return err("E303", "文件路径不能为空");
      }
      if (content === undefined || content === null) {
        return err("E303", "文件内容不能为空");
      }
      if (!taskId || typeof taskId !== 'string') {
        return err("E303", "任务 ID 不能为空");
      }

      // 路径合法性校验（防止路径遍历 / 绝对路径）
      const pathValidation = this.validateFilePath(filePath);
      if (!pathValidation.ok) {
        return pathValidation as Result<string>;
      }

      // 内容大小校验
      const fileSize = Buffer.byteLength(content, 'utf8');
      if (fileSize > this.MAX_SNAPSHOT_SIZE) {
        return err("E303", `快照内容过大: ${fileSize} bytes (最大 ${this.MAX_SNAPSHOT_SIZE} bytes)`);
      }

      // 生成快照 ID
      const snapshotId = this.generateSnapshotId();
      
      // 计算校验和
      const checksum = this.calculateChecksum(content);
      
      // 确定 nodeId：优先使用传入的值，否则从路径提取
      const resolvedNodeId = nodeId || this.extractNodeIdFromPath(filePath);
      
      // 创建快照记录 - 确保包含所有必需字段
      // Property 11: Snapshot Record Completeness
      // 快照记录必须包含: id, nodeId, taskId, path, content, created, fileSize, checksum
      const snapshot: SnapshotRecord = {
        id: snapshotId,
        nodeId: resolvedNodeId,
        taskId: taskId,
        path: filePath,
        content,
        created: new Date().toISOString(),
        fileSize,
        checksum
      };
      
      // 验证快照记录完整性
      const validationResult = this.validateSnapshotRecord(snapshot);
      if (!validationResult.ok) {
        return validationResult as Result<string>;
      }

      // 保存快照文件
      const snapshotPath = `${this.snapshotsDir}/${snapshotId}.json`;
      const writeResult = await this.fileStorage.write(
        snapshotPath,
        JSON.stringify(snapshot, null, 2)
      );
      
      if (!writeResult.ok) {
        this.logger.error("UndoManager", "保存快照文件失败", undefined, {
          snapshotId,
          error: writeResult.error
        });
        return writeResult as Result<string>;
      }

      // 更新索引
      this.index.snapshots.push(snapshot);

      // 清理过期快照（如果超过上限）
      if (this.index.snapshots.length > this.maxSnapshots) {
        await this.cleanupOldestSnapshots(this.index.snapshots.length - this.maxSnapshots);
      }

      // 保存索引
      const saveIndexResult = await this.saveIndex();
      if (!saveIndexResult.ok) {
        return saveIndexResult as Result<string>;
      }

      this.logger.info("UndoManager", `快照已创建: ${snapshotId}`, {
        snapshotId,
        filePath,
        fileSize: snapshot.fileSize,
        taskId
      });

      return ok(snapshotId);
    } catch (error) {
      this.logger.error("UndoManager", "创建快照失败", error as Error, {
        filePath,
        taskId
      });
      return err("E303", "创建快照失败", error);
    }
  }

  /**
   * 恢复快照（仅读取快照内容，不写入文件）
   * @param snapshotId 快照 ID
   * @returns 快照内容
   */
  async restoreSnapshot(snapshotId: string): Promise<Result<Snapshot>> {
    try {
      if (!this.index) {
        return err("E303", "撤销管理器未初始化");
      }

      // 查找快照记录
      const snapshotRecord = this.index.snapshots.find(s => s.id === snapshotId);
      if (!snapshotRecord) {
        this.logger.warn("UndoManager", `快照不存在: ${snapshotId}`);
        return err("E303", `快照不存在: ${snapshotId}`);
      }

      // 读取快照文件
      const snapshotPath = `${this.snapshotsDir}/${snapshotId}.json`;
      const readResult = await this.fileStorage.read(snapshotPath);
      
      if (!readResult.ok) {
        this.logger.error("UndoManager", "读取快照文件失败", undefined, {
          snapshotId,
          error: readResult.error
        });
        return readResult as Result<Snapshot>;
      }

      try {
        const snapshot: Snapshot = JSON.parse(readResult.value);
        
        // 验证校验和
        const calculatedChecksum = this.calculateChecksum(snapshot.content);
        if (calculatedChecksum !== snapshot.checksum) {
          this.logger.error("UndoManager", "快照校验和不匹配", undefined, {
            snapshotId,
            expected: snapshot.checksum,
            actual: calculatedChecksum
          });
          return err("E303", "快照文件已损坏（校验和不匹配）");
        }

        this.logger.info("UndoManager", `快照已读取: ${snapshotId}`, {
          snapshotId,
          path: snapshot.path
        });

        return ok(snapshot);
      } catch (parseError) {
        this.logger.error("UndoManager", "解析快照文件失败", parseError as Error, {
          snapshotId
        });
        return err("E303", "解析快照文件失败", parseError);
      }
    } catch (error) {
      this.logger.error("UndoManager", "恢复快照失败", error as Error, {
        snapshotId
      });
      return err("E303", "恢复快照失败", error);
    }
  }

  /**
   * 恢复快照到文件
   * 遵循 Requirements 2.8：使用原子写入（temp file + rename）确保数据完整性
   * 
   * Property 12: Atomic Write for Restore
   * For any snapshot restore operation, the UndoManager SHALL use atomic write
   * (temp file + rename) to ensure data integrity.
   * 
   * @param snapshotId 快照 ID
   * @returns 恢复的快照内容
   */
  async restoreSnapshotToFile(snapshotId: string): Promise<Result<Snapshot>> {
    try {
      // 1. 读取快照内容
      const snapshotResult = await this.restoreSnapshot(snapshotId);
      if (!snapshotResult.ok) {
        return snapshotResult;
      }

      const snapshot = snapshotResult.value;

      // 2. 使用原子写入恢复文件
      // 遵循 A-NF-02：写入临时文件 .tmp → 校验完整性 → 重命名为目标文件
      const atomicWriteResult = await this.fileStorage.atomicWrite(
        snapshot.path,
        snapshot.content
      );

      if (!atomicWriteResult.ok) {
        this.logger.error("UndoManager", "原子写入恢复失败", undefined, {
          snapshotId,
          path: snapshot.path,
          error: atomicWriteResult.error
        });
        return err("E303", `快照恢复失败: ${atomicWriteResult.error.message}`, atomicWriteResult.error);
      }

      this.logger.info("UndoManager", `快照已恢复到文件: ${snapshotId}`, {
        snapshotId,
        path: snapshot.path,
        fileSize: snapshot.fileSize
      });

      return ok(snapshot);
    } catch (error) {
      this.logger.error("UndoManager", "恢复快照到文件失败", error as Error, {
        snapshotId
      });
      return err("E303", "恢复快照到文件失败", error);
    }
  }

  /**
   * 删除快照
   * @param snapshotId 快照 ID
   */
  async deleteSnapshot(snapshotId: string): Promise<Result<void>> {
    try {
      if (!this.index) {
        return err("E303", "撤销管理器未初始化");
      }

      // 查找快照索引
      const snapshotIndex = this.index.snapshots.findIndex(s => s.id === snapshotId);
      if (snapshotIndex === -1) {
        this.logger.warn("UndoManager", `快照不存在: ${snapshotId}`);
        return err("E303", `快照不存在: ${snapshotId}`);
      }

      // 删除快照文件
      const snapshotPath = `${this.snapshotsDir}/${snapshotId}.json`;
      const deleteResult = await this.fileStorage.delete(snapshotPath);
      
      if (!deleteResult.ok) {
        this.logger.error("UndoManager", "删除快照文件失败", undefined, {
          snapshotId,
          error: deleteResult.error
        });
        return deleteResult;
      }

      // 从索引中移除
      this.index.snapshots.splice(snapshotIndex, 1);

      // 保存索引
      const saveIndexResult = await this.saveIndex();
      if (!saveIndexResult.ok) {
        return saveIndexResult;
      }

      this.logger.info("UndoManager", `快照已删除: ${snapshotId}`);

      return ok(undefined);
    } catch (error) {
      this.logger.error("UndoManager", "删除快照失败", error as Error, {
        snapshotId
      });
      return err("E303", "删除快照失败", error);
    }
  }

  /**
   * 列出所有快照
   * @returns 快照元数据列表
   */
  async listSnapshots(): Promise<Result<SnapshotMetadata[]>> {
    try {
      if (!this.index) {
        return err("E303", "撤销管理器未初始化");
      }

      const metadata: SnapshotMetadata[] = this.index.snapshots.map(s => ({
        id: s.id,
        nodeId: s.nodeId,
        taskId: s.taskId,
        path: s.path,
        created: s.created,
        fileSize: s.fileSize
      }));

      return ok(metadata);
    } catch (error) {
      this.logger.error("UndoManager", "列出快照失败", error as Error);
      return err("E303", "列出快照失败", error);
    }
  }

  /**
   * 清理过期快照
   * @param maxAgeMs 最大保留时间（毫秒）
   * @returns 清理的快照数量
   */
  async cleanupExpiredSnapshots(maxAgeMs: number): Promise<Result<number>> {
    try {
      if (!this.index) {
        return err("E303", "撤销管理器未初始化");
      }

      const now = Date.now();
      const expiredSnapshots: string[] = [];

      for (const snapshot of this.index.snapshots) {
        const createdTime = new Date(snapshot.created).getTime();
        if (now - createdTime > maxAgeMs) {
          expiredSnapshots.push(snapshot.id);
        }
      }

      // 删除过期快照
      for (const snapshotId of expiredSnapshots) {
        await this.deleteSnapshot(snapshotId);
      }

      this.logger.info("UndoManager", `清理过期快照完成，共 ${expiredSnapshots.length} 个`, {
        count: expiredSnapshots.length,
        maxAgeMs
      });

      return ok(expiredSnapshots.length);
    } catch (error) {
      this.logger.error("UndoManager", "清理过期快照失败", error as Error);
      return err("E303", "清理过期快照失败", error);
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 创建空索引
   * 遵循 A-FUNC-02：将保留策略写入索引
   */
  private createEmptyIndex(): SnapshotIndex {
    return {
      version: "1.0.0",
      snapshots: [],
      retentionPolicy: {
        maxCount: this.maxSnapshots,
        maxAgeDays: this.maxAgeDays
      }
    };
  }

  /**
   * 保存索引
   */
  private async saveIndex(): Promise<Result<void>> {
    if (!this.index) {
      return err("E303", "索引未初始化");
    }

    const writeResult = await this.fileStorage.write(
      this.indexPath,
      JSON.stringify(this.index, null, 2)
    );

    if (!writeResult.ok) {
      this.logger.error("UndoManager", "保存快照索引失败", undefined, {
        error: writeResult.error
      });
    }

    return writeResult;
  }

  /**
   * 生成快照 ID
   */
  private generateSnapshotId(): string {
    return `snapshot-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 计算内容校验和
   */
  private calculateChecksum(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * 验证文件路径，防止路径遍历 / 绝对路径 / 非 md 文件
   */
  private validateFilePath(filePath: string): Result<void> {
    if (filePath.includes("..")) {
      return err("E303", "文件路径不能包含 '..'");
    }
    if (/^([A-Za-z]:|\\\\|\/)/.test(filePath)) {
      return err("E303", "文件路径必须是相对路径");
    }
    if (!filePath.endsWith(".md")) {
      return err("E303", "仅支持 Markdown 文件快照 (.md)");
    }
    return ok(undefined);
  }

  /**
   * 从文件路径提取节点 ID
   * 这是一个简化实现，实际应该从文件的 frontmatter 中读取
   */
  private extractNodeIdFromPath(filePath: string): string {
    // 从路径中提取文件名（不含扩展名）作为临时 nodeId
    const fileName = filePath.split('/').pop() || '';
    return fileName.replace(/\.md$/, '');
  }

  /**
   * 验证快照记录完整性
   * Property 11: Snapshot Record Completeness
   * 快照记录必须包含所有必需字段: id, nodeId, taskId, path, content, created, fileSize, checksum
   */
  private validateSnapshotRecord(snapshot: SnapshotRecord): Result<void> {
    const requiredFields: (keyof SnapshotRecord)[] = [
      'id', 'nodeId', 'taskId', 'path', 'content', 'created', 'fileSize', 'checksum'
    ];
    
    for (const field of requiredFields) {
      if (snapshot[field] === undefined || snapshot[field] === null) {
        return err("E303", `快照记录缺少必需字段: ${field}`);
      }
    }
    
    // 验证字段类型
    if (typeof snapshot.id !== 'string' || snapshot.id.length === 0) {
      return err("E303", "快照 ID 必须是非空字符串");
    }
    if (typeof snapshot.nodeId !== 'string' || snapshot.nodeId.length === 0) {
      return err("E303", "节点 ID 必须是非空字符串");
    }
    if (typeof snapshot.taskId !== 'string' || snapshot.taskId.length === 0) {
      return err("E303", "任务 ID 必须是非空字符串");
    }
    if (typeof snapshot.path !== 'string' || snapshot.path.length === 0) {
      return err("E303", "文件路径必须是非空字符串");
    }
    if (typeof snapshot.content !== 'string') {
      return err("E303", "文件内容必须是字符串");
    }
    if (typeof snapshot.created !== 'string' || snapshot.created.length === 0) {
      return err("E303", "创建时间必须是非空字符串");
    }
    if (typeof snapshot.fileSize !== 'number' || snapshot.fileSize < 0) {
      return err("E303", "文件大小必须是非负数");
    }
    if (typeof snapshot.checksum !== 'string' || snapshot.checksum.length === 0) {
      return err("E303", "校验和必须是非空字符串");
    }
    
    // 验证 ISO 8601 时间格式
    const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    if (!dateRegex.test(snapshot.created)) {
      return err("E303", "创建时间必须是 ISO 8601 格式");
    }
    
    return ok(undefined);
  }

  /**
   * 清理最旧的快照
   */
  private async cleanupOldestSnapshots(count: number): Promise<void> {
    if (!this.index || count <= 0) {
      return;
    }

    // 按创建时间排序，最旧的在前
    const sortedSnapshots = [...this.index.snapshots].sort((a, b) => {
      return new Date(a.created).getTime() - new Date(b.created).getTime();
    });

    // 删除最旧的 count 个快照
    const toDelete = sortedSnapshots.slice(0, count);
    
    for (const snapshot of toDelete) {
      await this.deleteSnapshot(snapshot.id);
    }

    this.logger.info("UndoManager", `清理最旧的 ${count} 个快照`);
  }

  /**
   * 清理所有快照
   * @returns 清理的快照数量
   */
  async clearAllSnapshots(): Promise<Result<number>> {
    try {
      if (!this.index) {
        return err("E303", "撤销管理器未初始化");
      }

      const count = this.index.snapshots.length;
      const snapshotIds = this.index.snapshots.map(s => s.id);

      // 删除所有快照
      for (const snapshotId of snapshotIds) {
        await this.deleteSnapshot(snapshotId);
      }

      this.logger.info("UndoManager", `清理了所有 ${count} 个快照`);

      return ok(count);
    } catch (error) {
      this.logger.error("UndoManager", "清理所有快照失败", error as Error);
      return err("E303", "清理所有快照失败", error);
    }
  }
}
