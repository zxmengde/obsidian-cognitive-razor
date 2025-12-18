/** FileStorage - 提供原子化文件操作，确保数据完整性 */

import { 
  Result, 
  ok, 
  err,
  Err,
  QueueStateFile,
  DuplicatePairsStore,
  SnapshotIndex,
  ConceptVector,
  VectorIndexMeta,
  CRType
} from "../types";
import { Vault } from "obsidian";

function mapFsErrorToErrorCode(error: unknown): "E301_FILE_NOT_FOUND" | "E302_PERMISSION_DENIED" | "E303_DISK_FULL" | "E500_INTERNAL_ERROR" {
  const candidate = error as { code?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";

  if (code === "ENOENT") {
    return "E301_FILE_NOT_FOUND";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "E302_PERMISSION_DENIED";
  }
  if (code === "ENOSPC") {
    return "E303_DISK_FULL";
  }

  return "E500_INTERNAL_ERROR";
}

/** 数据目录路径常量 */
export const DATA_DIR = "data";
export const SNAPSHOTS_DIR = `${DATA_DIR}/snapshots`;
export const VECTORS_DIR = `${DATA_DIR}/vectors`;

/** 数据文件路径常量 */
export const QUEUE_STATE_FILE = `${DATA_DIR}/queue-state.json`;
export const VECTOR_INDEX_META_FILE = `${VECTORS_DIR}/index.json`;
export const DUPLICATE_PAIRS_FILE = `${DATA_DIR}/duplicate-pairs.json`;
export const SNAPSHOTS_INDEX_FILE = `${SNAPSHOTS_DIR}/index.json`;
export const APP_LOG_FILE = `${DATA_DIR}/app.log`;

/** 默认队列状态 */
export const DEFAULT_QUEUE_STATE: QueueStateFile = {
  version: "2.0.0",
  pendingTasks: [],
  paused: false,
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
 * 默认向量索引元数据
 */
export const DEFAULT_VECTOR_INDEX_META: VectorIndexMeta = {
  version: "3.0",
  lastUpdated: Date.now(),
  stats: {
    totalConcepts: 0,
    byType: {
      Domain: 0,
      Issue: 0,
      Theory: 0,
      Entity: 0,
      Mechanism: 0,
    },
  },
  concepts: {},
};

/** FileStorage 实现类 - 目录初始化、原子写入、数据完整性校验 */
export class FileStorage {
  private vault: Vault;
  private basePath: string;
  private initialized = false;

  /** 构造函数 */
  constructor(vault: Vault, basePath?: string) {
    this.vault = vault;
    this.basePath = basePath || "";
  }

  /** 解析完整路径 */
  private resolvePath(relativePath: string): string {
    if (!this.basePath) {
      return relativePath;
    }
    return `${this.basePath}/${relativePath}`;
  }

  /** 初始化目录结构 */
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

      const vectorsDirResult = await this.ensureDir(VECTORS_DIR);
      if (!vectorsDirResult.ok) {
        return vectorsDirResult;
      }

      // 为每个类型创建子目录
      const types: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
      for (const type of types) {
        const typeDirResult = await this.ensureDir(`${VECTORS_DIR}/${type}`);
        if (!typeDirResult.ok) {
          return typeDirResult;
        }
      }

      // 2. 初始化数据文件（如果不存在）
      const initResults = await Promise.all([
        this.initializeFileIfNotExists(QUEUE_STATE_FILE, DEFAULT_QUEUE_STATE),
        this.initializeFileIfNotExists(DUPLICATE_PAIRS_FILE, DEFAULT_DUPLICATE_PAIRS),
        this.initializeFileIfNotExists(SNAPSHOTS_INDEX_FILE, DEFAULT_SNAPSHOT_INDEX),
        this.initializeFileIfNotExists(VECTOR_INDEX_META_FILE, DEFAULT_VECTOR_INDEX_META),
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
        mapFsErrorToErrorCode(error),
        "初始化目录结构失败",
        error
      );
    }
  }

  /** 检查是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** 如果文件不存在则初始化 */
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
        const error = writeResult as Err;
        console.error(`[FileStorage] Failed to initialize file: ${path}`, error.error.message);
      }
      return writeResult;
    }
    return ok(undefined);
  }

  /** 读取文件 */
  async read(path: string): Promise<Result<string>> {
    try {
      const fullPath = this.resolvePath(path);
      const content = await this.vault.adapter.read(fullPath);
      return ok(content);
    } catch (error) {
      return err(
        mapFsErrorToErrorCode(error),
        `Failed to read file: ${path}`,
        error
      );
    }
  }

  /** 写入文件（普通写入） */
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
        // ensureDir 已经确保目录存在，无需再次验证
        // 移除多余的 stat 检查，避免文件系统同步延迟导致的误报
      }

      await this.vault.adapter.write(fullPath, content);
      return ok(undefined);
    } catch (error) {
      return err(
        mapFsErrorToErrorCode(error),
        `Failed to write file: ${path}`,
        error
      );
    }
  }

  /** 原子写入文件（临时文件 + 校验 + 重命名） */
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
            mapFsErrorToErrorCode(backupError),
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
        mapFsErrorToErrorCode(error),
        `Atomic write failed for file: ${path}`,
        error
      );
    }
  }

  /** 校验写入完整性 */
  private async verifyWriteIntegrity(
    tempPath: string,
    expectedContent: string
  ): Promise<Result<void>> {
    try {
      const actualContent = await this.vault.adapter.read(tempPath);
      
      if (actualContent !== expectedContent) {
        return err(
          "E500_INTERNAL_ERROR",
          "Write integrity check failed: content mismatch",
          { expected: expectedContent.length, actual: actualContent.length }
        );
      }
      
      return ok(undefined);
    } catch (error) {
      return err(
        mapFsErrorToErrorCode(error),
        "Failed to verify write integrity",
        error
      );
    }
  }

  /** 清理临时文件 */
  private async cleanupTempFile(tempPath: string): Promise<void> {
    try {
      // 直接使用 vault.adapter，因为 tempPath 已经是完整路径
      await this.vault.adapter.stat(tempPath);
      await this.vault.adapter.remove(tempPath);
    } catch {
      // 忽略清理错误（文件可能不存在），避免掩盖原始错误
    }
  }

  /** 删除文件 */
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
        mapFsErrorToErrorCode(error),
        `Failed to delete file: ${path}`,
        error
      );
    }
  }

  /** 检查文件是否存在 */
  async exists(path: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(path);
      await this.vault.adapter.stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /** 确保目录存在 */
  async ensureDir(path: string): Promise<Result<void>> {
    try {
      const fullPath = this.resolvePath(path);
      
      // 检查目录是否已存在
      try {
        const stat = await this.vault.adapter.stat(fullPath);
        if (stat && stat.type === "folder") {
          return ok(undefined);
        }
      } catch {
        // 目录不存在，继续创建
      }
      
      // 递归创建父目录
      const parts = fullPath.split("/");
      let currentPath = "";
      
      for (const part of parts) {
        if (!part) continue;
        
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        try {
          const stat = await this.vault.adapter.stat(currentPath);
          // 如果路径存在但不是目录，报错
          if (stat && stat.type !== "folder") {
            return err(
              "E500_INTERNAL_ERROR",
              `Path exists but is not a directory: ${currentPath}`
            );
          }
          // 路径存在且是目录，继续下一级
        } catch {
          // 路径不存在，创建目录
          try {
            await this.vault.adapter.mkdir(currentPath);
          } catch (mkdirError: unknown) {
            // 如果创建失败，检查是否是因为目录已存在（并发创建）
            try {
              const stat = await this.vault.adapter.stat(currentPath);
              if (stat && stat.type === "folder") {
                // 目录已存在，继续
                continue;
              }
            } catch {
              // 确实创建失败
              return err(
                mapFsErrorToErrorCode(mkdirError),
                `Failed to create directory: ${currentPath}`,
                mkdirError
              );
            }
          }
        }
      }
      
      // 最终验证目录确实存在
      try {
        const finalStat = await this.vault.adapter.stat(fullPath);
        if (!finalStat || finalStat.type !== "folder") {
          return err(
            "E500_INTERNAL_ERROR",
            `Directory was not created successfully: ${path}`
          );
        }
      } catch (verifyError) {
        return err(
          mapFsErrorToErrorCode(verifyError),
          `Failed to verify directory creation: ${path}`,
          verifyError
        );
      }
      
      return ok(undefined);
    } catch (error) {
      return err(
        mapFsErrorToErrorCode(error),
        `Failed to create directory: ${path}`,
        error
      );
    }
  }

  /** 写入向量文件 */
  async writeVectorFile(
    type: CRType,
    conceptId: string,
    data: ConceptVector
  ): Promise<Result<void>> {
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    const content = JSON.stringify(data, null, 2);
    return this.write(path, content);
  }

  /**
   * 读取向量文件
   * @param type 知识类型
   * @param conceptId 概念 UID
   */
  async readVectorFile(
    type: CRType,
    conceptId: string
  ): Promise<Result<ConceptVector>> {
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    const readResult = await this.read(path);
    
    if (!readResult.ok) {
      return readResult as Result<ConceptVector>;
    }

    try {
      const data: ConceptVector = JSON.parse(readResult.value);
      return ok(data);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        `Failed to parse vector file: ${path}`,
        error
      );
    }
  }

  /**
   * 删除向量文件
   * @param type 知识类型
   * @param conceptId 概念 UID
   */
  async deleteVectorFile(
    type: CRType,
    conceptId: string
  ): Promise<Result<void>> {
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    return this.delete(path);
  }

  /**
   * 读取向量索引元数据
   */
  async readVectorIndexMeta(): Promise<Result<VectorIndexMeta>> {
    const readResult = await this.read(VECTOR_INDEX_META_FILE);
    
    if (!readResult.ok) {
      return readResult as Result<VectorIndexMeta>;
    }

    try {
      const meta: VectorIndexMeta = JSON.parse(readResult.value);
      return ok(meta);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        `Failed to parse vector index meta`,
        error
      );
    }
  }

  /**
   * 写入向量索引元数据
   */
  async writeVectorIndexMeta(meta: VectorIndexMeta): Promise<Result<void>> {
    const content = JSON.stringify(meta, null, 2);
    return this.write(VECTOR_INDEX_META_FILE, content);
  }

  /**
   * 重命名文件
   * @param oldPath 原路径
   * @param newPath 新路径
   */
  async rename(oldPath: string, newPath: string): Promise<Result<void>> {
    try {
      const fullOldPath = this.resolvePath(oldPath);
      const fullNewPath = this.resolvePath(newPath);
      await this.vault.adapter.rename(fullOldPath, fullNewPath);
      return ok(undefined);
    } catch (error) {
      return err(
        mapFsErrorToErrorCode(error),
        `Failed to rename file: ${oldPath} -> ${newPath}`,
        error
      );
    }
  }
}
