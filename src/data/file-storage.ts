/**
 * FileStorage 实现
 * 提供原子化文件操作，确保数据完整性
 * 
 * 遵循设计文档 A-FUNC-07 本地优先存储要求：
 * - 目录结构初始化
 * - 原子写入（临时文件 + 重命名）
 * - 数据完整性校验
 */

import { 
  IFileStorage, 
  Result, 
  ok, 
  err,
  QueueStateFile,
  VectorIndexFile,
  DuplicatePairsStore,
  SnapshotIndex
} from "../types";
import { Vault } from "obsidian";

/**
 * 数据目录路径常量
 */
export const DATA_DIR = "data";
export const SNAPSHOTS_DIR = `${DATA_DIR}/snapshots`;

/**
 * 数据文件路径常量
 */
export const QUEUE_STATE_FILE = `${DATA_DIR}/queue-state.json`;
export const VECTOR_INDEX_FILE = `${DATA_DIR}/vector-index.json`;
export const DUPLICATE_PAIRS_FILE = `${DATA_DIR}/duplicate-pairs.json`;
export const SNAPSHOTS_INDEX_FILE = `${SNAPSHOTS_DIR}/index.json`;
export const APP_LOG_FILE = `${DATA_DIR}/app.log`;

/**
 * 默认队列状态
 */
export const DEFAULT_QUEUE_STATE: QueueStateFile = {
  version: "1.0.0",
  tasks: [],
  concurrency: 1,
  paused: false,
  stats: {
    totalProcessed: 0,
    totalFailed: 0,
    totalCancelled: 0,
  },
  locks: [],
};

/**
 * 默认向量索引
 */
export const DEFAULT_VECTOR_INDEX: VectorIndexFile = {
  version: "1.0.0",
  model: "text-embedding-3-small",
  dimension: 1536,
  buckets: {
    Domain: [],
    Issue: [],
    Theory: [],
    Entity: [],
    Mechanism: [],
  },
  metadata: {
    totalCount: 0,
    lastUpdated: new Date().toISOString(),
  },
};

/**
 * 默认重复对存储
 */
export const DEFAULT_DUPLICATE_PAIRS: DuplicatePairsStore = {
  version: "1.0.0",
  pairs: [],
  dismissedPairs: [],
};

/**
 * 默认快照索引
 */
export const DEFAULT_SNAPSHOT_INDEX: SnapshotIndex = {
  version: "1.0.0",
  snapshots: [],
  retentionPolicy: {
    maxCount: 100,
    maxAgeDays: 30,
  },
};

/**
 * FileStorage 实现类
 * 
 * 功能特性：
 * - 目录结构初始化（Requirements 1.1）
 * - 原子写入（Requirements 2.8）
 * - 数据完整性校验
 * 
 * 遵循设计文档 A-FUNC-07：
 * - 所有路径相对于插件目录（通过 basePath 注入）
 * - 运行时数据存储在 data/ 子目录
 */
export class FileStorage implements IFileStorage {
  private vault: Vault;
  private basePath: string;
  private initialized = false;

  /**
   * 构造函数
   * @param vault Obsidian Vault 实例
   * @param basePath 插件根目录路径（如 .obsidian/plugins/obsidian-cognitive-razor）
   */
  constructor(vault: Vault, basePath?: string) {
    this.vault = vault;
    this.basePath = basePath || "";
  }

  /**
   * 解析完整路径
   * 将相对路径转换为相对于插件目录的完整路径
   */
  private resolvePath(relativePath: string): string {
    if (!this.basePath) {
      return relativePath;
    }
    return `${this.basePath}/${relativePath}`;
  }

  /**
   * 初始化目录结构
   * 遵循 Requirements 1.1：创建 data/, data/snapshots/ 目录
   * 并初始化 queue-state.json, vector-index.json, duplicate-pairs.json, snapshots/index.json
   * 
   * @returns 初始化结果
   */
  async initialize(): Promise<Result<void>> {
    try {
      // 1. 创建目录结构（使用 resolvePath 解析完整路径）
      const dataDirResult = await this.ensureDir(DATA_DIR);
      if (!dataDirResult.ok) {
        return dataDirResult;
      }

      const snapshotsDirResult = await this.ensureDir(SNAPSHOTS_DIR);
      if (!snapshotsDirResult.ok) {
        return snapshotsDirResult;
      }

      // 2. 初始化数据文件（如果不存在）
      // 注意：queue-state.json 总是重新创建，以确保文件存在且格式正确
      const queueStateContent = JSON.stringify(DEFAULT_QUEUE_STATE, null, 2);
      const queueStateResult = await this.write(QUEUE_STATE_FILE, queueStateContent);
      if (!queueStateResult.ok) {
        console.error(`[FileStorage] Failed to initialize queue-state.json`, queueStateResult.error);
        return queueStateResult;
      }
      
      const initResults = await Promise.all([
        this.initializeFileIfNotExists(VECTOR_INDEX_FILE, DEFAULT_VECTOR_INDEX),
        this.initializeFileIfNotExists(DUPLICATE_PAIRS_FILE, DEFAULT_DUPLICATE_PAIRS),
        this.initializeFileIfNotExists(SNAPSHOTS_INDEX_FILE, DEFAULT_SNAPSHOT_INDEX),
      ]);

      // 检查是否有初始化失败
      for (const result of initResults) {
        if (!result.ok) {
          return result;
        }
      }

      this.initialized = true;
      return ok(undefined);
    } catch (error) {
      return err(
        "E301",
        "Failed to initialize directory structure",
        error
      );
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 如果文件不存在则初始化
   */
  private async initializeFileIfNotExists<T>(
    path: string,
    defaultContent: T
  ): Promise<Result<void>> {
    const fileExists = await this.exists(path);
    if (!fileExists) {
      const content = JSON.stringify(defaultContent, null, 2);
      const writeResult = await this.write(path, content);
      if (!writeResult.ok) {
        // 记录写入失败的详细信息
        console.error(`[FileStorage] Failed to initialize file: ${path}`, writeResult.error);
      }
      return writeResult;
    }
    return ok(undefined);
  }

  /**
   * 读取文件
   */
  async read(path: string): Promise<Result<string>> {
    try {
      const fullPath = this.resolvePath(path);
      const content = await this.vault.adapter.read(fullPath);
      return ok(content);
    } catch (error) {
      return err(
        "E300",
        `Failed to read file: ${path}`,
        error
      );
    }
  }

  /**
   * 写入文件（普通写入，不使用原子操作）
   * 对于非关键数据使用此方法
   */
  async write(path: string, content: string): Promise<Result<void>> {
    try {
      const fullPath = this.resolvePath(path);
      
      // 确保父目录存在
      const dirPath = path.substring(0, path.lastIndexOf("/"));
      if (dirPath) {
        const dirResult = await this.ensureDir(dirPath);
        if (!dirResult.ok) {
          return dirResult;
        }
      }

      await this.vault.adapter.write(fullPath, content);
      return ok(undefined);
    } catch (error) {
      return err(
        "E301",
        `Failed to write file: ${path}`,
        error
      );
    }
  }

  /**
   * 原子写入文件
   * 遵循 Requirements 2.8：写入临时文件 .tmp → 校验完整性 → 重命名为目标文件
   * 
   * 用于关键数据写入（如快照恢复），确保数据完整性
   * 
   * 原子性保证：
   * - 如果操作成功，目标文件包含新内容
   * - 如果操作失败，目标文件保持原状（如果存在）
   * 
   * @param path 目标文件路径
   * @param content 文件内容
   * @returns 写入结果
   */
  async atomicWrite(path: string, content: string): Promise<Result<void>> {
    const fullPath = this.resolvePath(path);
    const tempPath = `${fullPath}.tmp`;
    const backupPath = `${fullPath}.bak`;
    
    try {
      // 确保父目录存在（使用原始 path 而非 fullPath，因为 ensureDir 内部会调用 resolvePath）
      const dirPath = path.substring(0, path.lastIndexOf("/"));
      if (dirPath) {
        const dirResult = await this.ensureDir(dirPath);
        if (!dirResult.ok) {
          return dirResult;
        }
      }

      // 步骤 1: 写入临时文件
      await this.vault.adapter.write(tempPath, content);

      // 步骤 2: 校验写入完整性
      const verifyResult = await this.verifyWriteIntegrity(tempPath, content);
      if (!verifyResult.ok) {
        // 清理临时文件
        await this.cleanupTempFile(tempPath);
        return verifyResult;
      }

      // 步骤 3: 如果目标文件存在，先备份并删除
      // 注意：使用 try-catch 处理竞态条件（文件可能在检查后被删除）
      let targetExists = false;
      try {
        const originalContent = await this.vault.adapter.read(fullPath);
        targetExists = true;
        // 创建备份
        await this.vault.adapter.write(backupPath, originalContent);
        // 删除原文件（忽略 ENOENT 错误）
        try {
          await this.vault.adapter.remove(fullPath);
        } catch (removeError: unknown) {
          // 忽略文件不存在的错误（可能已被其他进程删除）
          const e = removeError as { code?: string };
          if (e.code !== "ENOENT") {
            throw removeError;
          }
        }
      } catch (backupError: unknown) {
        // 读取失败说明文件不存在，这是正常情况
        const e = backupError as { code?: string };
        if (e.code !== "ENOENT") {
          // 其他错误，清理临时文件并返回错误
          await this.cleanupTempFile(tempPath);
          return err(
            "E300",
            `Failed to backup/remove original file: ${path}`,
            backupError
          );
        }
        // 文件不存在，继续执行
      }

      // 步骤 4: 重命名临时文件为目标文件
      // 注意：Obsidian 的 rename 在某些情况下可能会失败，使用 copy + delete 作为备选方案
      try {
        await this.vault.adapter.rename(tempPath, fullPath);
        // 成功后清理备份
        await this.cleanupTempFile(backupPath);
      } catch (renameError) {
        // rename 失败，尝试使用 copy + delete 方案
        try {
          const tempContent = await this.vault.adapter.read(tempPath);
          await this.vault.adapter.write(fullPath, tempContent);
          await this.cleanupTempFile(tempPath);
          await this.cleanupTempFile(backupPath);
        } catch (copyError) {
          // copy 也失败，尝试恢复备份
          if (targetExists) {
            try {
              const backupContent = await this.vault.adapter.read(backupPath);
              await this.vault.adapter.write(fullPath, backupContent);
            } catch {
              // 恢复失败，记录但不掩盖原始错误
            }
          }
          // 清理临时文件和备份
          await this.cleanupTempFile(tempPath);
          await this.cleanupTempFile(backupPath);
          throw copyError;
        }
      }

      return ok(undefined);
    } catch (error) {
      // 清理临时文件
      await this.cleanupTempFile(tempPath);
      
      return err(
        "E300",
        `Atomic write failed for file: ${path}`,
        error
      );
    }
  }

  /**
   * 校验写入完整性
   * 读取临时文件并与原始内容比较
   */
  private async verifyWriteIntegrity(
    tempPath: string,
    expectedContent: string
  ): Promise<Result<void>> {
    try {
      const actualContent = await this.vault.adapter.read(tempPath);
      
      if (actualContent !== expectedContent) {
        return err(
          "E300",
          "Write integrity check failed: content mismatch",
          { expected: expectedContent.length, actual: actualContent.length }
        );
      }
      
      return ok(undefined);
    } catch (error) {
      return err(
        "E301",
        "Failed to verify write integrity",
        error
      );
    }
  }

  /**
   * 清理临时文件
   * 注意：tempPath 应该是完整路径（已经通过 resolvePath 处理）
   */
  private async cleanupTempFile(tempPath: string): Promise<void> {
    try {
      // 直接使用 vault.adapter，因为 tempPath 已经是完整路径
      await this.vault.adapter.stat(tempPath);
      await this.vault.adapter.remove(tempPath);
    } catch {
      // 忽略清理错误（文件可能不存在），避免掩盖原始错误
    }
  }

  /**
   * 删除文件
   */
  async delete(path: string): Promise<Result<void>> {
    try {
      const exists = await this.exists(path);
      if (!exists) {
        return ok(undefined);
      }
      
      const fullPath = this.resolvePath(path);
      await this.vault.adapter.remove(fullPath);
      return ok(undefined);
    } catch (error) {
      return err(
        "E300",
        `Failed to delete file: ${path}`,
        error
      );
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(path: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(path);
      await this.vault.adapter.stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 确保目录存在
   */
  async ensureDir(path: string): Promise<Result<void>> {
    try {
      const fullPath = this.resolvePath(path);
      const exists = await this.exists(path);
      if (exists) {
        return ok(undefined);
      }
      
      // 递归创建父目录
      const parts = fullPath.split("/");
      let currentPath = "";
      
      for (const part of parts) {
        if (!part) continue;
        
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        try {
          await this.vault.adapter.stat(currentPath);
        } catch {
          await this.vault.adapter.mkdir(currentPath);
        }
      }
      
      return ok(undefined);
    } catch (error) {
      return err(
        "E301",
        `Failed to create directory: ${path}`,
        error
      );
    }
  }
}
