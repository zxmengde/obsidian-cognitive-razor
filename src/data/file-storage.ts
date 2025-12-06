/**
 * FileStorage 工具类
 * 提供原子写入、目录创建和文件读写功能
 * 使用 Obsidian Vault Adapter API，确保跨平台兼容（包括移动端）
 * 数据存储在 .obsidian/plugins/obsidian-cognitive-razor/data/ 目录
 */

import { Result, ok, err } from "../types";
import type { DataAdapter } from "obsidian";

/**
 * FileStorage 配置
 */
export interface FileStorageConfig {
  /** 数据根目录（相对于 Vault 根目录） */
  dataDir: string;
  /** Obsidian DataAdapter 实例 */
  adapter?: DataAdapter;
}

/**
 * FileStorage 工具类
 */
export class FileStorage {
  private dataDir: string;
  private adapter: DataAdapter | null;

  constructor(config: FileStorageConfig) {
    this.dataDir = config.dataDir;
    this.adapter = config.adapter || null;
  }

  /**
   * 设置 Adapter（用于延迟初始化）
   */
  setAdapter(adapter: DataAdapter): void {
    this.adapter = adapter;
  }

  /**
   * 获取数据目录路径
   */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * 规范化路径（使用正斜杠）
   */
  private normalizePath(filePath: string): string {
    return `${this.dataDir}/${filePath}`.replace(/\\/g, "/").replace(/\/+/g, "/");
  }

  /**
   * 确保目录存在，如果不存在则创建
   */
  async ensureDir(dirPath: string): Promise<Result<void>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullPath = this.normalizePath(dirPath);
      
      const exists = await this.adapter.exists(fullPath);
      if (!exists) {
        await this.adapter.mkdir(fullPath);
      }
      return ok(undefined);
    } catch (error) {
      return err(
        "DIR_CREATE_ERROR",
        `创建目录失败: ${dirPath}`,
        error
      );
    }
  }

  /**
   * 读取文件内容
   */
  async readFile(filePath: string): Promise<Result<string>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullPath = this.normalizePath(filePath);
      
      const exists = await this.adapter.exists(fullPath);
      if (!exists) {
        return err("FILE_NOT_FOUND", `文件不存在: ${filePath}`);
      }

      const content = await this.adapter.read(fullPath);
      return ok(content);
    } catch (error) {
      return err(
        "FILE_READ_ERROR",
        `读取文件失败: ${filePath}`,
        error
      );
    }
  }

  /**
   * 读取 JSON 文件
   */
  async readJSON<T>(filePath: string): Promise<Result<T>> {
    const contentResult = await this.readFile(filePath);
    if (!contentResult.ok) {
      return contentResult;
    }

    try {
      const data = JSON.parse(contentResult.value);
      return ok(data as T);
    } catch (error) {
      return err(
        "JSON_PARSE_ERROR",
        `解析 JSON 失败: ${filePath}`,
        error
      );
    }
  }

  /**
   * 写入文件
   */
  async writeFile(filePath: string, content: string): Promise<Result<void>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullPath = this.normalizePath(filePath);
      
      // 确保父目录存在
      const lastSlash = fullPath.lastIndexOf("/");
      if (lastSlash > 0) {
        const dir = fullPath.substring(0, lastSlash);
        const dirExists = await this.adapter.exists(dir);
        if (!dirExists) {
          await this.adapter.mkdir(dir);
        }
      }

      await this.adapter.write(fullPath, content);
      return ok(undefined);
    } catch (error) {
      return err(
        "FILE_WRITE_ERROR",
        `写入文件失败: ${filePath}`,
        error
      );
    }
  }

  /**
   * 写入 JSON 文件
   */
  async writeJSON(filePath: string, data: unknown): Promise<Result<void>> {
    try {
      const content = JSON.stringify(data, null, 2);
      return await this.writeFile(filePath, content);
    } catch (error) {
      return err(
        "JSON_STRINGIFY_ERROR",
        `序列化 JSON 失败: ${filePath}`,
        error
      );
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(filePath: string): Promise<Result<void>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullPath = this.normalizePath(filePath);
      
      const exists = await this.adapter.exists(fullPath);
      if (!exists) {
        return err("FILE_NOT_FOUND", `文件不存在: ${filePath}`);
      }

      await this.adapter.remove(fullPath);
      return ok(undefined);
    } catch (error) {
      return err(
        "FILE_DELETE_ERROR",
        `删除文件失败: ${filePath}`,
        error
      );
    }
  }

  /**
   * 检查文件是否存在
   */
  async exists(filePath: string): Promise<boolean> {
    if (!this.adapter) {
      return false;
    }

    try {
      const fullPath = this.normalizePath(filePath);
      return await this.adapter.exists(fullPath);
    } catch {
      return false;
    }
  }

  /**
   * 列出目录中的文件
   */
  async listFiles(dirPath: string): Promise<Result<string[]>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullPath = this.normalizePath(dirPath);
      
      const exists = await this.adapter.exists(fullPath);
      if (!exists) {
        return err("DIR_NOT_FOUND", `目录不存在: ${dirPath}`);
      }

      const listed = await this.adapter.list(fullPath);
      // adapter.list 返回 { files: string[], folders: string[] }
      return ok(listed.files.map(f => f.substring(fullPath.length + 1)));
    } catch (error) {
      return err(
        "DIR_READ_ERROR",
        `读取目录失败: ${dirPath}`,
        error
      );
    }
  }

  /**
   * 获取文件大小（字节）
   */
  async getFileSize(filePath: string): Promise<Result<number>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullPath = this.normalizePath(filePath);
      
      const exists = await this.adapter.exists(fullPath);
      if (!exists) {
        return err("FILE_NOT_FOUND", `文件不存在: ${filePath}`);
      }

      const stat = await this.adapter.stat(fullPath);
      if (!stat) {
        return err("FILE_STAT_ERROR", `获取文件信息失败: ${filePath}`);
      }
      return ok(stat.size);
    } catch (error) {
      return err(
        "FILE_STAT_ERROR",
        `获取文件信息失败: ${filePath}`,
        error
      );
    }
  }

  /**
   * 复制文件
   */
  async copyFile(sourcePath: string, destPath: string): Promise<Result<void>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullSourcePath = this.normalizePath(sourcePath);
      const fullDestPath = this.normalizePath(destPath);
      
      const exists = await this.adapter.exists(fullSourcePath);
      if (!exists) {
        return err("FILE_NOT_FOUND", `源文件不存在: ${sourcePath}`);
      }

      // 确保目标目录存在
      const lastSlash = fullDestPath.lastIndexOf("/");
      if (lastSlash > 0) {
        const destDir = fullDestPath.substring(0, lastSlash);
        const dirExists = await this.adapter.exists(destDir);
        if (!dirExists) {
          await this.adapter.mkdir(destDir);
        }
      }

      await this.adapter.copy(fullSourcePath, fullDestPath);
      return ok(undefined);
    } catch (error) {
      return err(
        "FILE_COPY_ERROR",
        `复制文件失败: ${sourcePath} -> ${destPath}`,
        error
      );
    }
  }

  /**
   * 移动/重命名文件
   */
  async moveFile(sourcePath: string, destPath: string): Promise<Result<void>> {
    if (!this.adapter) {
      return err("NO_ADAPTER", "FileStorage 未初始化 adapter");
    }

    try {
      const fullSourcePath = this.normalizePath(sourcePath);
      const fullDestPath = this.normalizePath(destPath);
      
      const exists = await this.adapter.exists(fullSourcePath);
      if (!exists) {
        return err("FILE_NOT_FOUND", `源文件不存在: ${sourcePath}`);
      }

      // 确保目标目录存在
      const lastSlash = fullDestPath.lastIndexOf("/");
      if (lastSlash > 0) {
        const destDir = fullDestPath.substring(0, lastSlash);
        const dirExists = await this.adapter.exists(destDir);
        if (!dirExists) {
          await this.adapter.mkdir(destDir);
        }
      }

      await this.adapter.rename(fullSourcePath, fullDestPath);
      return ok(undefined);
    } catch (error) {
      return err(
        "FILE_MOVE_ERROR",
        `移动文件失败: ${sourcePath} -> ${destPath}`,
        error
      );
    }
  }
}
