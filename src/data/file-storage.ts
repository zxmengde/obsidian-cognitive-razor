/** FileStorage - 提供原子化文件操作，确保数据完整性 */

import { 
  ok, 
  err,
  CR_TYPES,
} from "../types";
import type {
  Result, 
  ConceptVector,
  VectorIndexMeta,
  CRType,
  VectorFileRef,
} from "../types";
import { Vault } from "obsidian";

function getFsErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown } | null;
  return typeof candidate?.code === "string" ? candidate.code : "";
}

function mapFsErrorToErrorCode(error: unknown): "E301_FILE_NOT_FOUND" | "E302_PERMISSION_DENIED" | "E303_DISK_FULL" | "E500_INTERNAL_ERROR" {
  const code = getFsErrorCode(error);

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

function isMissingFsError(error: unknown): boolean {
  return getFsErrorCode(error) === "ENOENT";
}

/** 数据目录路径常量 */
const DATA_DIR = "data";
const VECTORS_DIR = `${DATA_DIR}/vectors`;
const CR_TYPE_SET: ReadonlySet<string> = new Set(CR_TYPES);

/** 数据文件路径常量 */
const VECTOR_INDEX_META_FILE = `${VECTORS_DIR}/index.json`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSafeConceptId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !value.includes("/") && !value.includes("\\") && !value.includes("\0") &&
    value !== "." && value !== ".." && value !== "__proto__" &&
    value !== "prototype" && value !== "constructor";
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isSafeCrType(value: unknown): value is CRType {
  return typeof value === "string" && CR_TYPE_SET.has(value);
}

function parseVectorIndexMeta(raw: unknown): VectorIndexMeta | null {
  if (!isRecord(raw) || raw.version !== "5.0" ||
    typeof raw.embeddingProfile !== "string" || !raw.embeddingProfile.trim() ||
    typeof raw.embeddingModel !== "string" || !raw.embeddingModel.trim() ||
    !Number.isInteger(raw.dimensions) || (raw.dimensions as number) < 0 ||
    !isRecord(raw.concepts)) {
    return null;
  }

  const concepts = Object.create(null) as VectorIndexMeta["concepts"];
  for (const [id, candidate] of Object.entries(raw.concepts)) {
    if (!isSafeConceptId(id) || !isRecord(candidate) || !CR_TYPE_SET.has(String(candidate.type))) {
      return null;
    }
    concepts[id] = { type: candidate.type as CRType };
  }
  if ((raw.dimensions as number) === 0 && Object.keys(concepts).length > 0) return null;
  return {
    version: "5.0",
    embeddingProfile: raw.embeddingProfile.trim(),
    embeddingModel: raw.embeddingModel.trim(),
    dimensions: raw.dimensions as number,
    concepts,
  };
}

function parseVectorMetadata(raw: unknown, embeddingLength: number): ConceptVector["metadata"] | null {
  if (!isRecord(raw) ||
    typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt) ||
    typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt) ||
    typeof raw.embeddingModel !== "string" || !raw.embeddingModel.trim() ||
    !Number.isInteger(raw.dimensions) || raw.dimensions !== embeddingLength) {
    return null;
  }
  return {
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    embeddingModel: raw.embeddingModel.trim(),
    dimensions: raw.dimensions as number,
  };
}

function parseConceptVector(raw: unknown, expectedType: CRType, expectedId: string): ConceptVector | null {
  if (!isRecord(raw) || raw.id !== expectedId || raw.type !== expectedType ||
    !Array.isArray(raw.embedding) || raw.embedding.length === 0 ||
    !raw.embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  const metadata = parseVectorMetadata(raw.metadata, raw.embedding.length);
  if (!metadata) return null;
  return {
    id: expectedId,
    type: expectedType,
    embedding: [...raw.embedding] as number[],
    metadata,
  };
}

/** FileStorage 实现类 - 目录初始化、原子写入、数据完整性校验 */
export class FileStorage {
  private vault: Vault;
  private basePath: string;

  /** 构造函数 */
  constructor(vault: Vault, basePath?: string) {
    this.vault = vault;
    this.basePath = (basePath || "").replace(/^\/+|\/+$/g, "");
  }

  /** 解析完整路径；所有公开相对路径都必须留在插件数据目录内。 */
  private resolvePath(relativePath: string): string {
    if (!isSafeRelativePath(relativePath)) {
      throw new Error(`Invalid relative path: ${relativePath}`);
    }
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

      return ok(undefined);
    } catch (error) {
      return err(
        mapFsErrorToErrorCode(error),
        "初始化目录结构失败",
        error
      );
    }
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
    const recoveryFailures: Array<{ path: string; error: unknown }> = [];
    try {
      const residuals = await this.scanResidualFiles(this.resolvePath(DATA_DIR));
      for (const file of residuals) {
        try {
          if (await this.recoverResidualFile(file)) recovered++;
        } catch (error) {
          // 保留未清理的残留文件，交给下一次启动或人工处理。
          recoveryFailures.push({ path: file, error });
        }
      }
      if (recoveryFailures.length > 0) {
        return err(mapFsErrorToErrorCode(recoveryFailures[0].error), "部分原子写入残留处理失败，残留文件已保留", {
          failures: recoveryFailures,
        });
      }
      return ok(recovered);
    } catch (error) {
      return err(mapFsErrorToErrorCode(error), "恢复未完成写入失败", error);
    }
  }

  /** 处理单个残留文件；返回是否从备份恢复了目标。 */
  private async recoverResidualFile(file: string): Promise<boolean> {
    if (file.endsWith(".tmp")) {
      await this.removeFullPath(file);
      return false;
    }

    const targetPath = file.slice(0, -4);
    if (await this.fullPathExists(targetPath)) {
      await this.removeFullPath(file);
      return false;
    }

    const backupContent = await this.vault.adapter.read(file);
    await this.vault.adapter.write(targetPath, backupContent);
    await this.removeFullPath(file);
    return true;
  }

  /** 扫描完整目录路径下的 .bak/.tmp 残留文件（递归） */
  private async scanResidualFiles(fullDir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const listing = await this.vault.adapter.list(fullDir);
      for (const filePath of listing.files) {
        if (filePath.endsWith(".tmp") || filePath.endsWith(".bak")) {
          results.push(filePath);
        }
      }
      for (const subDir of listing.folders) {
        // Reset backups are immutable snapshots, not interrupted live writes.
        if (subDir === this.resolvePath(`${DATA_DIR}/backups`)) continue;
        const subResults = await this.scanResidualFiles(subDir);
        results.push(...subResults);
      }
    } catch (error) {
      if (!isMissingFsError(error)) throw error;
    }
    return results;
  }

  /** 检查完整路径文件是否存在 */
  private async fullPathExists(fullPath: string): Promise<boolean> {
    try {
      const stat = await this.vault.adapter.stat(fullPath);
      return stat !== null && stat !== undefined;
    } catch (error) {
      if (isMissingFsError(error)) return false;
      throw error;
    }
  }

  /** 删除完整路径；不存在视为已清理，其他错误交给调用方处理。 */
  private async removeFullPath(fullPath: string): Promise<void> {
    try {
      await this.vault.adapter.remove(fullPath);
    } catch (error) {
      if (!isMissingFsError(error)) throw error;
    }
  }

  /** 读取文件 */
  async read(path: string): Promise<Result<string>> {
    if (!isSafeRelativePath(path)) {
      return err("E101_INVALID_INPUT", `Invalid relative path: ${path}`);
    }
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
    if (!isSafeRelativePath(path)) {
      return err("E101_INVALID_INPUT", `Invalid relative path: ${path}`);
    }
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
    if (!isSafeRelativePath(path)) {
      return err("E101_INVALID_INPUT", `Invalid relative path: ${path}`);
    }
    const fullPath = this.resolvePath(path);
    const tempPath = `${fullPath}.tmp`;
    const backupPath = `${fullPath}.bak`;
    let backupCreated = false;
    
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

      // 如果目标文件存在，先保留一份可恢复备份，再移除旧目标。
      try {
        const originalContent = await this.vault.adapter.read(fullPath);
        await this.vault.adapter.write(backupPath, originalContent);
        backupCreated = true;
        try {
          await this.vault.adapter.remove(fullPath);
        } catch (removeError: unknown) {
          const e = removeError as { code?: string };
          if (e.code !== "ENOENT") {
            throw removeError;
          }
        }
      } catch (backupError: unknown) {
        const e = backupError as { code?: string };
        if (e.code !== "ENOENT") {
          throw backupError;
        }
      }

      // DataAdapter.rename 是 Obsidian 的标准提交能力；失败时进入备份回滚。
      await this.vault.adapter.rename(tempPath, fullPath);

      if (backupCreated) {
        await this.cleanupTempFile(backupPath);
      }
      return ok(undefined);
    } catch (error) {
      await this.cleanupTempFile(tempPath);
      let restoreError: unknown;
      if (backupCreated) {
        try {
          const backupContent = await this.vault.adapter.read(backupPath);
          await this.vault.adapter.write(fullPath, backupContent);
          await this.cleanupTempFile(backupPath);
        } catch (candidate) {
          // 恢复失败时绝不删除 .bak；它仍是最后一份可恢复数据。
          restoreError = candidate;
        }
      }
      
      return err(
        mapFsErrorToErrorCode(error),
        `Atomic write failed for file: ${path}`,
        restoreError === undefined
          ? error
          : { error, restoreError, backupPath }
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
      await this.vault.adapter.remove(tempPath);
    } catch {
      // 忽略清理错误（文件可能不存在），避免掩盖原始错误
    }
  }

  /** 删除文件 */
  async delete(path: string): Promise<Result<void>> {
    if (!isSafeRelativePath(path)) {
      return err("E101_INVALID_INPUT", `Invalid relative path: ${path}`);
    }
    try {
      const fullPath = this.resolvePath(path);
      await this.vault.adapter.remove(fullPath);
      return ok(undefined);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === "ENOENT") {
        return ok(undefined);
      }
      return err(
        mapFsErrorToErrorCode(error),
        `Failed to delete file: ${path}`,
        error
      );
    }
  }

  /** 检查文件是否存在 */
  async exists(path: string): Promise<boolean> {
    if (!isSafeRelativePath(path)) {
      return false;
    }
    try {
      const fullPath = this.resolvePath(path);
      const stat = await this.vault.adapter.stat(fullPath);
      return stat !== null && stat !== undefined;
    } catch {
      return false;
    }
  }

  /** 确保目录存在 */
  private async ensureDir(path: string): Promise<Result<void>> {
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
    if (!isSafeCrType(type) || !isSafeConceptId(conceptId)) {
      return err("E101_INVALID_INPUT", `Invalid vector concept ID: ${conceptId}`);
    }
    const parsed = parseConceptVector(data, type, conceptId);
    if (!parsed) {
      return err("E101_INVALID_INPUT", `Invalid vector data: ${type}/${conceptId}`);
    }
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    const content = JSON.stringify(parsed, null, 2);
    return this.atomicWrite(path, content);
  }

  /**
   * 列出数据目录内的直接文件，返回仍以 FileStorage 相对路径表示的结果。
   * 工作流恢复只能读取插件自己的 data 目录，不能通过 adapter 暴露任意路径。
   */
  async listFiles(path: string): Promise<Result<string[]>> {
    if (!isSafeRelativePath(path)) {
      return err("E101_INVALID_INPUT", `Invalid relative path: ${path}`);
    }
    try {
      const fullPath = this.resolvePath(path);
      const listing = await this.vault.adapter.list(fullPath);
      const prefix = this.basePath ? `${this.basePath}/` : "";
      const files = listing.files
        .filter((file) => !prefix || file.startsWith(prefix))
        .map((file) => prefix ? file.slice(prefix.length) : file)
        .filter((file) => isSafeRelativePath(file));
      return ok(files);
    } catch (error) {
      if (isMissingFsError(error)) return ok([]);
      return err(mapFsErrorToErrorCode(error), `Failed to list files: ${path}`, error);
    }
  }

  /**
   * Recursively list files under a plugin-relative directory.
   * Used by backup/reset so nested workflows and vectors are not left behind.
   */
  async listFilesRecursive(path: string): Promise<Result<string[]>> {
    if (!isSafeRelativePath(path)) {
      return err("E101_INVALID_INPUT", `Invalid relative path: ${path}`);
    }
    try {
      const fullPath = this.resolvePath(path);
      const prefix = this.basePath ? `${this.basePath}/` : "";
      const collected: string[] = [];

      const walk = async (dirFullPath: string): Promise<void> => {
        const listing = await this.vault.adapter.list(dirFullPath);
        for (const filePath of listing.files) {
          if (prefix && !filePath.startsWith(prefix)) continue;
          const relative = prefix ? filePath.slice(prefix.length) : filePath;
          if (isSafeRelativePath(relative)) collected.push(relative);
        }
        for (const subDir of listing.folders) {
          await walk(subDir);
        }
      };

      await walk(fullPath);
      return ok(collected);
    } catch (error) {
      if (isMissingFsError(error)) return ok([]);
      return err(mapFsErrorToErrorCode(error), `Failed to list files recursively: ${path}`, error);
    }
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
    if (!isSafeCrType(type) || !isSafeConceptId(conceptId)) {
      return err("E101_INVALID_INPUT", `Invalid vector concept ID: ${conceptId}`);
    }
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    const readResult = await this.read(path);
    
    if (!readResult.ok) {
      return readResult as Result<ConceptVector>;
    }

    try {
      const data = parseConceptVector(JSON.parse(readResult.value) as unknown, type, conceptId);
      return data
        ? ok(data)
        : err("E101_INVALID_INPUT", `Invalid vector file format: ${path}`);
    } catch (error) {
      return err(
        "E101_INVALID_INPUT",
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
    if (!isSafeCrType(type) || !isSafeConceptId(conceptId)) {
      return err("E101_INVALID_INPUT", `Invalid vector concept ID: ${conceptId}`);
    }
    const path = `${VECTORS_DIR}/${type}/${conceptId}.json`;
    return this.delete(path);
  }

  /**
   * 列出向量目录下的物理 JSON 文件。
   * 这里只返回合法类型和安全文件名；索引是否引用这些文件由 VectorIndex 决定。
   */
  async listVectorFiles(): Promise<Result<VectorFileRef[]>> {
    const files: VectorFileRef[] = [];
    try {
      for (const type of CR_TYPES) {
        const result = await this.listFiles(`${VECTORS_DIR}/${type}`);
        if (!result.ok) return result as Result<VectorFileRef[]>;
        for (const path of result.value) {
          const prefix = `${VECTORS_DIR}/${type}/`;
          if (!path.startsWith(prefix) || !path.endsWith(".json")) continue;
          const id = path.slice(prefix.length, -".json".length);
          if (!isSafeConceptId(id)) continue;
          files.push({ type, id, path });
        }
      }
      return ok(files.sort((first, second) => first.path.localeCompare(second.path)));
    } catch (error) {
      return err(mapFsErrorToErrorCode(error), "列出向量文件失败", error);
    }
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
      const meta = parseVectorIndexMeta(JSON.parse(readResult.value) as unknown);
      return meta
        ? ok(meta)
        : err("E101_INVALID_INPUT", "Invalid vector index metadata format");
    } catch (error) {
      return err(
        "E101_INVALID_INPUT",
        `Failed to parse vector index meta`,
        error
      );
    }
  }

  /**
   * 写入向量索引元数据（原子写入，防止崩溃时损坏）
   */
  async writeVectorIndexMeta(meta: VectorIndexMeta): Promise<Result<void>> {
    const parsed = parseVectorIndexMeta(meta);
    if (!parsed) {
      return err("E101_INVALID_INPUT", "Invalid vector index metadata format");
    }
    const content = JSON.stringify(parsed, null, 2);
    return this.atomicWrite(VECTOR_INDEX_META_FILE, content);
  }

}
