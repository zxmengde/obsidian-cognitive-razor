/**
 * Logger 实现
 * 提供结构化日志记录功能，支持循环日志（1MB 上限）
 * 
 * 遵循设计文档 A-NF-03 可观察性要求：
 * - 结构化日志格式（JSON）
 * - 循环日志机制（1MB 上限）
 * - 日志级别控制
 * 
 * 遵循 Requirements 6.5：
 * - 所有错误使用 E001-E304 错误码
 * - 错误日志包含错误码信息
 */

import { ILogger } from "../types";
import { ErrorCode, isValidErrorCode, getErrorCodeInfo } from "./error-codes";

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志条目接口
 * 遵循设计文档 Requirements 1.2 定义的结构化日志格式
 * 遵循 Requirements 6.5：错误日志包含错误码
 */
export interface LogEntry {
  /** ISO 8601 格式时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: LogLevel;
  /** 模块名称 */
  module: string;
  /** 事件类型（如 TASK_STATE_CHANGE, LOCK_ACQUIRED 等） */
  event: string;
  /** 人类可读消息 */
  message: string;
  /** 上下文数据（可选） */
  context?: Record<string, unknown>;
  /** 错误信息（可选） */
  error?: {
    name: string;
    message: string;
    stack?: string;
    /** 错误码 (E001-E304)，遵循 Requirements 6.5 */
    code?: string;
    /** 错误码名称 */
    codeName?: string;
    /** 修复建议 */
    fixSuggestion?: string;
  };
}

/**
 * 日志级别优先级映射
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 默认事件类型映射
 */
const DEFAULT_EVENTS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

/**
 * Logger 实现类
 * 
 * 功能特性：
 * - 结构化 JSON 日志格式
 * - 循环日志机制（1MB 上限）
 * - 日志级别过滤
 * - 异步文件写入
 * - 跨会话日志追加（A-NF-03 可观察性）
 * - 耗时埋点支持
 */
export class Logger implements ILogger {
  private logBuffer: string[] = [];
  private readonly maxLogSize: number;
  private currentSize = 0;
  private logFilePath: string;
  private fileStorage: {
    write: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<string>;
    exists?: (path: string) => Promise<boolean>;
  };
  private minLevel: LogLevel;
  private initialized = false;

  /**
   * 构造函数
   * @param logFilePath 日志文件路径
   * @param fileStorage 文件存储实例
   * @param minLevel 最小日志级别
   * @param maxLogSize 最大日志文件大小（字节），默认 1MB
   */
  constructor(
    logFilePath: string,
    fileStorage: {
      write: (path: string, content: string) => Promise<void>;
      read: (path: string) => Promise<string>;
      exists?: (path: string) => Promise<boolean>;
    },
    minLevel: LogLevel = "info",
    maxLogSize: number = 1024 * 1024 // 1MB
  ) {
    this.logFilePath = logFilePath;
    this.fileStorage = fileStorage;
    this.minLevel = minLevel;
    this.maxLogSize = maxLogSize;
  }

  /**
   * 初始化 Logger，读取既有日志文件
   * 遵循 A-NF-03：启动时读取既有 app.log 并以追加+1MB 轮转写入
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // 检查文件是否存在
      let fileExists = false;
      if (this.fileStorage.exists) {
        fileExists = await this.fileStorage.exists(this.logFilePath);
      } else {
        // 尝试读取来判断是否存在
        try {
          await this.fileStorage.read(this.logFilePath);
          fileExists = true;
        } catch {
          fileExists = false;
        }
      }

      if (fileExists) {
        // 读取既有日志
        const existingContent = await this.fileStorage.read(this.logFilePath);
        if (existingContent) {
          const lines = existingContent.split("\n").filter(line => line.trim());
          this.logBuffer = lines;
          this.currentSize = new TextEncoder().encode(existingContent).length;
          
          // 如果超过大小限制，进行轮转
          if (this.currentSize > this.maxLogSize) {
            this.rotateLog(0);
          }
        }
      }

      this.initialized = true;
    } catch (error) {
      // 初始化失败时继续使用空缓冲区
      console.error("Logger initialization failed:", error);
      this.initialized = true;
    }
  }

  /**
   * 记录带耗时的操作
   * 遵循 A-NF-03：为文件写入、队列调度、LLM/Embedding 调用增加耗时埋点
   * 
   * @param module 模块名称
   * @param operation 操作名称
   * @param fn 要执行的异步函数
   * @returns 函数执行结果
   */
  async withTiming<T>(
    module: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.info(module, `${operation} 完成`, {
        event: "TIMING",
        operation,
        durationMs: duration
      });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.error(module, `${operation} 失败`, error as Error, {
        event: "TIMING_ERROR",
        operation,
        durationMs: duration
      });
      throw error;
    }
  }

  /**
   * 记录耗时指标（不执行操作，仅记录）
   */
  timing(
    module: string,
    operation: string,
    durationMs: number,
    context?: Record<string, unknown>
  ): void {
    this.info(module, `${operation} 耗时: ${durationMs}ms`, {
      event: "TIMING",
      operation,
      durationMs,
      ...context
    });
  }

  /**
   * 调试日志
   */
  debug(module: string, message: string, context?: Record<string, unknown>): void {
    this.log("debug", module, message, undefined, context);
  }

  /**
   * 信息日志
   */
  info(module: string, message: string, context?: Record<string, unknown>): void {
    this.log("info", module, message, undefined, context);
  }

  /**
   * 警告日志
   */
  warn(module: string, message: string, context?: Record<string, unknown>): void {
    this.log("warn", module, message, undefined, context);
  }

  /**
   * 错误日志
   */
  error(module: string, message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log("error", module, message, error, context);
  }

  /**
   * 带错误码的错误日志
   * 遵循 Requirements 6.5：所有错误使用 E001-E304 错误码
   * 
   * @param module 模块名称
   * @param errorCode 错误码 (E001-E304)
   * @param message 错误消息
   * @param error 可选的 Error 对象
   * @param context 可选的上下文数据
   */
  errorWithCode(
    module: string,
    errorCode: string,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    // 获取错误码信息
    const codeInfo = isValidErrorCode(errorCode) ? getErrorCodeInfo(errorCode) : undefined;
    
    // 构建包含错误码的上下文
    const enrichedContext: Record<string, unknown> = {
      ...context,
      errorCode,
      event: context?.event || "ERROR",
    };

    // 如果有错误码信息，添加到上下文
    if (codeInfo) {
      enrichedContext.errorCodeName = codeInfo.name;
      enrichedContext.errorCategory = codeInfo.category;
      enrichedContext.retryable = codeInfo.retryable;
    }

    this.logWithErrorCode("error", module, message, errorCode, error, enrichedContext);
  }

  /**
   * 获取日志内容
   */
  getLogContent(): string {
    return this.logBuffer.join("\n");
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.logBuffer = [];
    this.currentSize = 0;
  }

  /**
   * 获取当前日志大小（字节）
   */
  getCurrentSize(): number {
    return this.currentSize;
  }

  /**
   * 获取最大日志大小（字节）
   */
  getMaxLogSize(): number {
    return this.maxLogSize;
  }

  /**
   * 获取日志条目数量
   */
  getEntryCount(): number {
    return this.logBuffer.length;
  }

  /**
   * 设置最小日志级别
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * 核心日志方法
   */
  private log(
    level: LogLevel,
    module: string,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    // 检查日志级别
    if (!this.shouldLog(level)) {
      return;
    }

    // 从 context 中提取 event，如果没有则使用默认值
    const event = (context?.event as string) || DEFAULT_EVENTS[level];
    
    // 创建不包含 event 的 context 副本
    let cleanContext: Record<string, unknown> | undefined;
    if (context) {
      const { event: _, ...rest } = context;
      cleanContext = Object.keys(rest).length > 0 ? rest : undefined;
    }

    // 构建日志条目
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      event,
      message,
    };

    // 添加可选字段
    if (cleanContext && Object.keys(cleanContext).length > 0) {
      entry.context = cleanContext;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // 格式化为 JSON 日志行
    const logLine = this.formatLogEntry(entry);
    const logLineSize = new TextEncoder().encode(logLine + "\n").length;

    // 检查是否需要循环覆盖
    if (this.currentSize + logLineSize > this.maxLogSize) {
      this.rotateLog(logLineSize);
    }

    // 添加到缓冲区
    this.logBuffer.push(logLine);
    this.currentSize += logLineSize;

    // 异步写入文件（不阻塞）
    this.writeToFile().catch((err) => {
      console.error("Failed to write log to file:", err);
    });
  }

  /**
   * 带错误码的核心日志方法
   * 遵循 Requirements 6.5：所有错误使用 E001-E304 错误码
   */
  private logWithErrorCode(
    level: LogLevel,
    module: string,
    message: string,
    errorCode: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    // 检查日志级别
    if (!this.shouldLog(level)) {
      return;
    }

    // 从 context 中提取 event，如果没有则使用默认值
    const event = (context?.event as string) || DEFAULT_EVENTS[level];
    
    // 创建不包含 event 和错误码相关字段的 context 副本
    let cleanContext: Record<string, unknown> | undefined;
    if (context) {
      const { 
        event: _, 
        errorCode: __, 
        errorCodeName: ___, 
        errorCategory: ____, 
        retryable: _____,
        ...rest 
      } = context;
      cleanContext = Object.keys(rest).length > 0 ? rest : undefined;
    }

    // 获取错误码信息
    const codeInfo = isValidErrorCode(errorCode) ? getErrorCodeInfo(errorCode) : undefined;

    // 构建日志条目
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      event,
      message,
    };

    // 添加可选字段
    if (cleanContext && Object.keys(cleanContext).length > 0) {
      entry.context = cleanContext;
    }

    // 构建错误信息，包含错误码
    entry.error = {
      name: error?.name || codeInfo?.name || "Error",
      message: error?.message || message,
      stack: error?.stack,
      code: errorCode,
      codeName: codeInfo?.name,
      fixSuggestion: codeInfo?.fixSuggestion,
    };

    // 格式化为 JSON 日志行
    const logLine = this.formatLogEntry(entry);
    const logLineSize = new TextEncoder().encode(logLine + "\n").length;

    // 检查是否需要循环覆盖
    if (this.currentSize + logLineSize > this.maxLogSize) {
      this.rotateLog(logLineSize);
    }

    // 添加到缓冲区
    this.logBuffer.push(logLine);
    this.currentSize += logLineSize;

    // 异步写入文件（不阻塞）
    this.writeToFile().catch((err) => {
      console.error("Failed to write log to file:", err);
    });
  }

  /**
   * 检查是否应该记录该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * 格式化日志条目为 JSON 字符串
   * 遵循 Requirements 1.2：实现 JSON 格式日志输出
   */
  private formatLogEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * 解析日志行为 LogEntry 对象
   * @param logLine JSON 格式的日志行
   * @returns 解析后的 LogEntry 或 null（解析失败时）
   */
  static parseLogEntry(logLine: string): LogEntry | null {
    try {
      const parsed = JSON.parse(logLine);
      // 验证必需字段
      if (
        typeof parsed.timestamp === "string" &&
        typeof parsed.level === "string" &&
        typeof parsed.module === "string" &&
        typeof parsed.event === "string" &&
        typeof parsed.message === "string"
      ) {
        return parsed as LogEntry;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 循环日志（删除旧日志以保持文件大小在限制内）
   * 遵循 Requirements 1.3：检测文件大小超过 1MB 时截断旧条目
   */
  private rotateLog(newEntrySize: number): void {
    // 计算需要释放的空间
    const targetSize = this.maxLogSize - newEntrySize;
    
    // 从头部开始删除日志条目，直到有足够空间
    while (this.logBuffer.length > 0 && this.currentSize > targetSize) {
      const removedLine = this.logBuffer.shift();
      if (removedLine) {
        const removedSize = new TextEncoder().encode(removedLine + "\n").length;
        this.currentSize -= removedSize;
      }
    }
  }

  /**
   * 写入日志到文件
   */
  private async writeToFile(): Promise<void> {
    try {
      const content = this.getLogContent();
      await this.fileStorage.write(this.logFilePath, content);
    } catch (error) {
      // 写入失败时只在控制台输出，避免递归
      console.error("Failed to write log file:", error);
    }
  }

  /**
   * 设置日志级别
   * @param level 新的日志级别
   */
  setLogLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * 获取当前日志级别
   * @returns 当前日志级别
   */
  getLogLevel(): LogLevel {
    return this.minLevel;
  }
}
