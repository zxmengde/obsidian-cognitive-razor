/** FileStorage - 提供原子化文件操作，确保数据完整性 */

import { 
  ok, 
  err,
} from "../types";
import type {
  Result, 
  QueueStateFile,
  DuplicatePairsStore,
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
const DATA_DIR = "data";
export const VECTORS_DIR = `${DATA_DIR}/vectors`;

/** 数据文件路径常量 */
const QUEUE_STATE_FILE = `${DATA_DIR}/queue-state.json`;
const VECTOR_INDEX_META_FILE = `${VECTORS_DIR}/index.json`;
const DUPLICATE_PAIRS_FILE = `${DATA_DIR}/duplicate-pairs.json`;
const APP_LOG_FILE = `${DATA_DIR}/app.log`;

/** 默认队列状态 */
const DEFAULT_QUEUE_STATE: QueueStateFile = {
  version: "2.0.0",
  pendingTasks: [],
  paused: false,
};



/**
 * 默认重复对存储
 */
const DEFAULT_DUPLICATE_PAIRS: DuplicatePairsStore = {
  version: "1.0.0",
  pairs: [],
  dismissedPairs: [],
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

  /**
   * 恢复未完成的原子写入残留文件（.bak / .tmp）
   *
   * 启动时调用，扫描 data 目录下的残留文件：
   * - .tmp 文件：直接删除（写入未完成）
   * - .bak 文件：如果对应的目标文件不存在，则恢复备份；否则删除备份
   *
   * @returns 恢复的文件数量
   */
  async recoverIncompleteWrites(): Promise<Result<number>> {
    let recovered = 0;
    try {
      const residuals = await this.scanResidualFiles(DATA_DIR);
      for (const file of residuals) {
        if (file.endsWith(".tmp")) {
          // 临时文件：写入未完成，直接删除
          await this.cleanupResidual(file);
        } else if (file.endsWith(".bak")) {
          // 备份文件：检查目标文件是否存在
          const targetPath = file.slice(0, -4); // 去掉 .bak
          const targetExists = await this.existsByFullPath(targetPath);
          if (!targetExists) {
            // 目标文件丢失，从备份恢复
            try {
              const backupContent = await this.vault.adapter.read(file);
              await this.vault.adapter.write(targetPath, backupContent);
              recovered++;
            } catch {
              // 恢复失败，忽略
            }
          }
          await this.cleanupResidual(file);
        }
      }
      return ok(recovered);
    } catch (error) {
      return err("E500_INTERNAL_ERROR", "恢复未完成写入失败", error);
    }
  }

  /** 扫描目录下的 .bak/.tmp 残留文件（递归） */
  private async scanResidualFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const fullDir = this.resolvePath(dir);
    try {
      const listing = await this.vault.adapter.list(fullDir);
      for (const filePath of listing.files) {
        if (filePath.endsWith(".tmp") || filePath.endsWith(".bak")) {
          results.push(filePath);
        }
      }
      for (const subDir of listing.folders) {
        const subResults = await this.scanResidualFilesFullPath(subDir);
        results.push(...subResults);
      }
    } catch {
      // 目录不存在或无法读取，忽略
    }
    return results;
  }

  /** 递归扫描（使用完整路径） */
  private async scanResidualFilesFullPath(fullDir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const listing = await this.vault.adapter.list(fullDir);
      for (const filePath of listing.files) {
        if (filePath.endsWith(".tmp") || filePath.endsWith(".bak")) {
          results.push(filePath);
        }
      }
      for (const subDir of listing.folders) {
        const subResults = await this.scanResidualFilesFullPath(subDir);
        results.push(...subResults);
      }
    } catch {
      // 忽略
    }
    return results;
  }

  /** 检查完整路径文件是否存在 */
  private async existsByFullPath(fullPath: string): Promise<boolean> {
    try {
      const stat = await this.vault.adapter.stat(fullPath);
      return stat !== null && stat !== undefined;
    } catch {
      return false;
    }
  }

  /** 安全清理残留文件 */
  private async cleanupResidual(fullPath: string): Promise<void> {
    try {
      await this.vault.adapter.remove(fullPath);
    } catch {
      // 忽略清理错误
    }
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
      // 清理临时文件和备份文件
      await this.cleanupTempFile(tempPath);
      await this.cleanupTempFile(backupPath);
      
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

      // 递归创建父目录
      // 注意：Obsidian vault adapter 对 .obsidian/plugins/ 下的路径 stat 可能返回 null，
      // 必须将 null 视为"不存在"，触发 mkdir
      const parts = fullPath.split("/");
      let currentPath = "";

      for (const part of parts) {
        if (!part) continue;

        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let stat = null;
        try {
          stat = await this.vault.adapter.stat(currentPath);
        } catch {
          // stat 抛异常视为不存在
        }

        if (stat !== null && stat !== undefined) {
          // 路径存在：如果不是目录则报错，否则继续
          if (stat.type !== "folder") {
            return err(
              "E500_INTERNAL_ERROR",
              `Path exists but is not a directory: ${currentPath}`
            );
          }
          // 是目录，继续下一级
          continue;
        }

        // stat 返回 null 或抛异常：尝试创建目录
        try {
          await this.vault.adapter.mkdir(currentPath);
        } catch (mkdirError: unknown) {
          // mkdir 失败时，再次 stat 确认是否已存在（并发创建场景）
          let verifyStat = null;
          try {
            verifyStat = await this.vault.adapter.stat(currentPath);
          } catch {
            // ignore
          }
          if (!verifyStat || verifyStat.type !== "folder") {
            return err(
              mapFsErrorToErrorCode(mkdirError),
              `Failed to create directory: ${currentPath}`,
              mkdirError
            );
          }
          // 目录已存在（并发创建），继续
        }
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

  /** 写入向量文件（原子写入，防止崩溃时损坏） */
  async writeVectorFile(
    type: CRType,
    conceptId: string,
    data: ConceptVector
  ): Promise<Result<void>> {
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    const content = JSON.stringify(data, null, 2);
    return this.atomicWrite(path, content);
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
   * 写入向量索引元数据（原子写入，防止崩溃时损坏）
   */
  async writeVectorIndexMeta(meta: VectorIndexMeta): Promise<Result<void>> {
    const content = JSON.stringify(meta, null, 2);
    return this.atomicWrite(VECTOR_INDEX_META_FILE, content);
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
