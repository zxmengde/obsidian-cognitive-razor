/**
 * Logger 组件
 * 实现循环日志（1MB 上限）和日志级别过滤
 */

import { FileStorage } from "./file-storage";
import { Result, ok, err } from "../types";

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志级别优先级
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 日志条目
 */
export interface LogEntry {
  /** 时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: LogLevel;
  /** 日志消息 */
  message: string;
  /** 上下文数据 */
  context?: Record<string, unknown>;
}

/**
 * Logger 配置
 */
export interface LoggerConfig {
  /** 文件存储 */
  storage: FileStorage;
  /** 日志文件路径 */
  logFilePath: string;
  /** 最小日志级别 */
  minLevel: LogLevel;
  /** 最大日志文件大小（字节），默认 1MB */
  maxSize?: number;
}

/**
 * Logger 组件
 */
export class Logger {
  private storage: FileStorage;
  private logFilePath: string;
  private minLevel: LogLevel;
  private maxSize: number;
  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config: LoggerConfig) {
    this.storage = config.storage;
    this.logFilePath = config.logFilePath;
    this.minLevel = config.minLevel;
    this.maxSize = config.maxSize || 1024 * 1024; // 默认 1MB
  }

  /**
   * 记录 debug 级别日志
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  /**
   * 记录 info 级别日志
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  /**
   * 记录 warn 级别日志
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  /**
   * 记录 error 级别日志
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    // 检查日志级别
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    // 创建日志条目
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    // 添加到缓冲区
    this.buffer.push(entry);

    // 如果是 error 级别，立即刷新
    if (level === "error") {
      this.flush();
    } else {
      // 否则延迟刷新
      this.scheduleFlush();
    }
  }

  /**
   * 安排延迟刷新
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, 1000); // 1 秒后刷新
  }

  /**
   * 刷新日志到文件
   */
  private async flush(): Promise<void> {
    // 清除定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 如果缓冲区为空，直接返回
    if (this.buffer.length === 0) {
      return;
    }

    // 获取当前缓冲区内容
    const entries = [...this.buffer];
    this.buffer = [];

    // 格式化日志条目
    const lines = entries.map(entry => this.formatEntry(entry));
    const newContent = lines.join("\n") + "\n";

    // 读取现有日志
    const readResult = await this.storage.readFile(this.logFilePath);
    let existingContent = "";
    if (readResult.ok) {
      existingContent = readResult.value;
    }

    // 合并内容
    let fullContent = existingContent + newContent;

    // 检查文件大小
    const contentSize = Buffer.byteLength(fullContent, "utf-8");
    if (contentSize > this.maxSize) {
      // 循环日志：保留最新的内容
      fullContent = this.truncateLog(fullContent);
    }

    // 写入文件
    await this.storage.writeFile(this.logFilePath, fullContent);
  }

  /**
   * 格式化日志条目
   */
  private formatEntry(entry: LogEntry): string {
    const parts = [
      entry.timestamp,
      `[${entry.level.toUpperCase()}]`,
      entry.message,
    ];

    if (entry.context) {
      try {
        parts.push(JSON.stringify(entry.context));
      } catch {
        parts.push("[无法序列化上下文]");
      }
    }

    return parts.join(" ");
  }

  /**
   * 截断日志以保持在大小限制内
   */
  private truncateLog(content: string): string {
    const lines = content.split("\n");
    let totalSize = 0;
    const keptLines: string[] = [];

    // 从最新的日志开始保留
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const lineSize = Buffer.byteLength(line + "\n", "utf-8");

      if (totalSize + lineSize > this.maxSize) {
        break;
      }

      keptLines.unshift(line);
      totalSize += lineSize;
    }

    return keptLines.join("\n") + "\n";
  }

  /**
   * 设置最小日志级别
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * 获取当前最小日志级别
   */
  getMinLevel(): LogLevel {
    return this.minLevel;
  }

  /**
   * 清空日志文件
   */
  async clear(): Promise<Result<void>> {
    this.buffer = [];
    return await this.storage.writeFile(this.logFilePath, "");
  }

  /**
   * 读取日志内容
   */
  async read(): Promise<Result<string>> {
    return await this.storage.readFile(this.logFilePath);
  }

  /**
   * 读取最近的 N 行日志
   */
  async readLastLines(n: number): Promise<Result<string[]>> {
    const readResult = await this.storage.readFile(this.logFilePath);
    if (!readResult.ok) {
      return readResult;
    }

    const lines = readResult.value.split("\n").filter(line => line.trim() !== "");
    const lastLines = lines.slice(-n);
    return ok(lastLines);
  }

  /**
   * 获取日志文件大小
   */
  async getSize(): Promise<Result<number>> {
    return await this.storage.getFileSize(this.logFilePath);
  }

  /**
   * 销毁 Logger（清理资源）
   */
  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // 同步刷新剩余日志
    if (this.buffer.length > 0) {
      this.flush();
    }
  }
}
