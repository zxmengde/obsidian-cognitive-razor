/** Logger - 结构化日志记录，支持循环日志、追踪 ID、分组和过滤 */

import type { ILogger } from "../types";


/** 日志级别 */
export type LogLevel = "debug" | "info" | "warn" | "error";


/** 日志条目接口 */
interface LogEntry {
  /** ISO 8601 格式时间戳 */
  timestamp: string;
  /** 日志级别 */
  level: LogLevel;
  /** 模块名称 */
  module: string;
  /** 事件类型 */
  event: string;
  /** 人类可读消息 */
  message: string;
  /** 追踪 ID（用于关联同一操作的多条日志） */
  traceId?: string;
  /** 上下文数据 */
  context?: Record<string, unknown>;
  /** 错误信息 */
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    codeName?: string;
    fixSuggestion?: string;
  };
}

/** 日志级别优先级 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 默认事件类型映射 */
const DEFAULT_EVENTS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
};

/** 格式化时间戳为简短格式 HH:mm:ss.SSS */
function formatShortTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}



/** 敏感字段键名列表（小写匹配） */
const SENSITIVE_KEYS = ['apikey', 'token', 'secret', 'authorization', 'password', 'api_key'];

/**
 * 对上下文对象进行递归脱敏，将敏感字段值替换为 [REDACTED]
 * @param context 待脱敏的上下文对象
 * @returns 脱敏后的新对象（不修改原对象）
 */
export function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      // 递归处理数组中的对象元素
      sanitized[key] = value.map(item =>
        typeof item === 'object' && item !== null
          ? sanitizeContext(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeContext(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * 对错误堆栈中可能包含的敏感信息进行脱敏
 * @param stack 错误堆栈字符串
 * @returns 脱敏后的堆栈字符串
 */
function sanitizeStack(stack: string): string {
  // 匹配常见的敏感值模式：key=value、key: value、key="value"
  let result = stack;
  for (const sk of SENSITIVE_KEYS) {
    // 匹配 key=value 或 key: value 模式（不区分大小写）
    const patterns = [
      new RegExp(`(${sk})\\s*[=:]\\s*["']?[^\\s"',}\\]]+["']?`, 'gi'),
      new RegExp(`(${sk})\\s*[=:]\\s*"[^"]*"`, 'gi'),
    ];
    for (const pattern of patterns) {
      result = result.replace(pattern, `$1=[REDACTED]`);
    }
  }
  return result;
}


/** Logger 实现类 */
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
  private sessionId: string;


  constructor(
    logFilePath: string,
    fileStorage: {
      write: (path: string, content: string) => Promise<void>;
      read: (path: string) => Promise<string>;
      exists?: (path: string) => Promise<boolean>;
    },
    minLevel: LogLevel = "info",
    maxLogSize: number = 1024 * 1024
  ) {
    this.logFilePath = logFilePath;
    this.fileStorage = fileStorage;
    this.minLevel = minLevel;
    this.maxLogSize = maxLogSize;
    this.sessionId = this.generateSessionId();
  }

  /** 生成会话 ID */
  private generateSessionId(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");
    const random = Math.random().toString(36).slice(2, 6);
    return `${dateStr}-${timeStr}-${random}`;
  }


  /** 初始化 Logger */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      let fileExists = false;
      if (this.fileStorage.exists) {
        fileExists = await this.fileStorage.exists(this.logFilePath);
      } else {
        try {
          await this.fileStorage.read(this.logFilePath);
          fileExists = true;
        } catch {
          fileExists = false;
        }
      }

      if (fileExists) {
        const existingContent = await this.fileStorage.read(this.logFilePath);
        if (existingContent) {
          const lines = existingContent.split("\n").filter(line => line.trim());
          this.logBuffer = lines;
          this.currentSize = new TextEncoder().encode(existingContent).length;
          
          if (this.currentSize > this.maxLogSize) {
            this.rotateLog(0);
          }
        }
      }

      this.initialized = true;
      this.logSessionStart();
    } catch (error) {
      console.error("Logger initialization failed:", error);
      this.initialized = true;
    }
  }

  /** 记录会话开始 */
  private logSessionStart(): void {
    const timestamp = new Date().toISOString();
    const startEntry: LogEntry = {
      timestamp,
      level: "info",
      module: "Session",
      event: "SESSION_START",
      message: `新会话开始 [${this.sessionId}]`,
      context: {
        sessionId: this.sessionId,
        separator: true
      }
    };

    const logLine = this.formatLogEntry(startEntry);
    this.logBuffer.push(logLine);
    this.currentSize += new TextEncoder().encode(logLine + "\n").length;
    
    this.writeToFile().catch(err => {
      console.error("Failed to write session start:", err);
    });
  }

  /** 调试日志 */
  debug(module: string, message: string, context?: Record<string, unknown>): void {
    this.log("debug", module, message, undefined, context);
  }

  /** 信息日志 */
  info(module: string, message: string, context?: Record<string, unknown>): void {
    this.log("info", module, message, undefined, context);
  }

  /** 警告日志 */
  warn(module: string, message: string, context?: Record<string, unknown>): void {
    this.log("warn", module, message, undefined, context);
  }

  /** 错误日志 */
  error(module: string, message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log("error", module, message, error, context);
  }


  /** 获取日志内容 */
  getLogContent(): string {
    return this.logBuffer.join("\n");
  }

  /** 清空日志 */
  clear(): void {
    this.logBuffer = [];
    this.currentSize = 0;
  }


  /** 设置日志级别 */
  setLogLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** 获取当前日志级别 */
  getLogLevel(): LogLevel {
    return this.minLevel;
  }

  /** 核心日志方法 */
  private log(
    level: LogLevel,
    module: string,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const event = (context?.event as string) || DEFAULT_EVENTS[level];
    
    let cleanContext: Record<string, unknown> | undefined;
    if (context) {
      const { event: _, ...rest } = context;
      cleanContext = Object.keys(rest).length > 0 ? rest : undefined;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      event,
      message,
    };

    // 脱敏上下文中的敏感字段
    if (cleanContext && Object.keys(cleanContext).length > 0) {
      entry.context = sanitizeContext(cleanContext);
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack ? sanitizeStack(error.stack) : undefined,
      };
    }

    const logLine = this.formatLogEntry(entry);
    const logLineSize = new TextEncoder().encode(logLine + "\n").length;

    if (this.currentSize + logLineSize > this.maxLogSize) {
      this.rotateLog(logLineSize);
    }

    this.logBuffer.push(logLine);
    this.currentSize += logLineSize;

    this.outputToConsole(entry);

    this.writeToFile().catch((err) => {
      console.error("Failed to write log to file:", err);
    });
  }


  /** 检查日志级别 */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  /** 格式化日志（统一为 JSON Lines） */
  private formatLogEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  /** 格式化上下文 */
  private formatContext(context: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || value === null) continue;
      if (key === "separator") continue; // 跳过内部标记
      
      let valueStr: string;
      if (typeof value === "string") {
        valueStr = value.length > 30 ? value.slice(0, 30) + "..." : value;
      } else if (typeof value === "number") {
        valueStr = String(value);
      } else if (typeof value === "boolean") {
        valueStr = String(value);
      } else {
        valueStr = JSON.stringify(value);
        if (valueStr.length > 50) {
          valueStr = valueStr.slice(0, 50) + "...";
        }
      }
      parts.push(`${key}=${valueStr}`);
    }
    return parts.length > 0 ? `{${parts.join(", ")}}` : "";
  }



  /** 循环日志 */
  private rotateLog(newEntrySize: number): void {
    const targetSize = this.maxLogSize - newEntrySize;
    
    while (this.logBuffer.length > 0 && this.currentSize > targetSize) {
      const removedLine = this.logBuffer.shift();
      if (removedLine) {
        const removedSize = new TextEncoder().encode(removedLine + "\n").length;
        this.currentSize -= removedSize;
      }
    }
  }

  /** 写入文件 */
  private async writeToFile(): Promise<void> {
    try {
      const content = this.getLogContent();
      await this.fileStorage.write(this.logFilePath, content);
    } catch (error) {
      console.error("Failed to write log file:", error);
    }
  }

  /** 输出到控制台 */
  private outputToConsole(entry: LogEntry): void {
    // 使用 pretty 格式输出到控制台
    const formattedMsg = this.formatConsoleOutput(entry);

    switch (entry.level) {
      case "debug":
        console.debug(formattedMsg);
        break;
      case "info":
        console.info(formattedMsg);
        break;
      case "warn":
        console.warn(formattedMsg);
        break;
      case "error":
        if (entry.error?.stack) {
          console.error(formattedMsg, "\n", entry.error.stack);
        } else {
          console.error(formattedMsg);
        }
        break;
    }
  }

  /** 格式化控制台 */
  private formatConsoleOutput(entry: LogEntry): string {
    const time = formatShortTime(entry.timestamp);
    const prefix = `[CR][${entry.level.toUpperCase()}]`;
    const traceStr = entry.traceId ? ` [${entry.traceId.slice(-6)}]` : "";
    
    let msg = `${time} ${prefix}[${entry.module}]${traceStr} ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = this.formatContext(entry.context);
      if (contextStr) {
        msg += ` ${contextStr}`;
      }
    }
    
    if (entry.error && entry.level === "error") {
      msg += `\n  └─ ${entry.error.code || ""} ${entry.error.message}`;
      if (entry.error.fixSuggestion) {
        msg += `\n     💡 ${entry.error.fixSuggestion}`;
      }
    }
    
    return msg;
  }

}
