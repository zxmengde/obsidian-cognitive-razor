/**
 * FileStorage 工具类
 * 提供原子写入、目录创建和文件读写功能
 * 确保所有数据存储在本地 .obsidian/plugins/obsidian-cognitive-razor/data/ 目录
 */

import { Result, ok, err } from "../types";
import * as fs from "fs";
import * as path from "path";

/**
 * FileStorage 配置
 */
export interface FileStorageConfig {
  /** 数据根目录 */
  dataDir: string;
}

/**
 * FileStorage 工具类
 */
export class FileStorage {
  private dataDir: string;

  constructor(config: FileStorageConfig) {
    this.dataDir = config.dataDir;
  }

  /**
   * 获取数据目录路径
   */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * 确保目录存在，如果不存在则创建
   */
  async ensureDir(dirPath: string): Promise<Result<void>> {
    try {
      const fullPath = path.join(this.dataDir, dirPath);
      
      // 检查目录是否存在
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (!stats.isDirectory()) {
          return err("NOT_DIRECTORY", `路径存在但不是目录: ${dirPath}`);
        }
        return ok(undefined);
      }

      // 递归创建目录
      fs.mkdirSync(fullPath, { recursive: true });
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
    try {
      const fullPath = path.join(this.dataDir, filePath);
      
      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        return err("FILE_NOT_FOUND", `文件不存在: ${filePath}`);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
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
   * 原子写入文件
   * 使用临时文件 + 重命名的方式确保原子性
   */
  async writeFile(filePath: string, content: string): Promise<Result<void>> {
    try {
      const fullPath = path.join(this.dataDir, filePath);
      const dir = path.dirname(fullPath);
      const tempPath = `${fullPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`;

      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入临时文件
      fs.writeFileSync(tempPath, content, "utf-8");

      // 原子重命名
      fs.renameSync(tempPath, fullPath);

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
   * 原子写入 JSON 文件
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
    try {
      const fullPath = path.join(this.dataDir, filePath);
      
      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        return err("FILE_NOT_FOUND", `文件不存在: ${filePath}`);
      }

      fs.unlinkSync(fullPath);
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
    try {
      const fullPath = path.join(this.dataDir, filePath);
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }

  /**
   * 列出目录中的文件
   */
  async listFiles(dirPath: string): Promise<Result<string[]>> {
    try {
      const fullPath = path.join(this.dataDir, dirPath);
      
      // 检查目录是否存在
      if (!fs.existsSync(fullPath)) {
        return err("DIR_NOT_FOUND", `目录不存在: ${dirPath}`);
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return err("NOT_DIRECTORY", `路径不是目录: ${dirPath}`);
      }

      const files = fs.readdirSync(fullPath);
      return ok(files);
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
    try {
      const fullPath = path.join(this.dataDir, filePath);
      
      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        return err("FILE_NOT_FOUND", `文件不存在: ${filePath}`);
      }

      const stats = fs.statSync(fullPath);
      return ok(stats.size);
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
    try {
      const fullSourcePath = path.join(this.dataDir, sourcePath);
      const fullDestPath = path.join(this.dataDir, destPath);
      
      // 检查源文件是否存在
      if (!fs.existsSync(fullSourcePath)) {
        return err("FILE_NOT_FOUND", `源文件不存在: ${sourcePath}`);
      }

      // 确保目标目录存在
      const destDir = path.dirname(fullDestPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // 复制文件
      fs.copyFileSync(fullSourcePath, fullDestPath);
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
    try {
      const fullSourcePath = path.join(this.dataDir, sourcePath);
      const fullDestPath = path.join(this.dataDir, destPath);
      
      // 检查源文件是否存在
      if (!fs.existsSync(fullSourcePath)) {
        return err("FILE_NOT_FOUND", `源文件不存在: ${sourcePath}`);
      }

      // 确保目标目录存在
      const destDir = path.dirname(fullDestPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // 移动文件
      fs.renameSync(fullSourcePath, fullDestPath);
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
