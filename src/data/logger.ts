/** 结构化循环日志：脱敏、控制台输出与防抖持久化。 */

import type { ILogger, LogLevel } from "../types";


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
  /** 上下文数据 */
  context?: Record<string, unknown>;
  /** 错误信息 */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/** 日志级别优先级 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: Number.POSITIVE_INFINITY,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 默认事件类型映射 */
const DEFAULT_EVENTS: Record<LogLevel, string> = {
  silent: "SILENT",
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



const STACK_SENSITIVE_KEYS = ["apikey", "token", "secret", "authorization", "password", "api_key"];
const MAX_CONTEXT_DEPTH = 8;

function sanitizeLoggedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

/** Defense in depth for secrets embedded in otherwise non-sensitive strings. */
function sanitizeText(raw: string): string {
  let result = raw.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  for (const key of STACK_SENSITIVE_KEYS) {
    result = result.replace(
      new RegExp(`(${key})\\s*[=:]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;}\\]]+)`, "gi"),
      "$1=[REDACTED]",
    );
  }
  result = result
    .replace(/\b(?:sk|tvly(?:-[a-z]+)?)-[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_TOKEN]");
  return result.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeLoggedUrl(url));
}

/**
 * Last-resort diagnostic when structured logging is not available yet or is
 * the resource currently being torn down. Keep this fallback in the logger
 * module so host/UI layers cannot leak raw errors through console calls.
 */
export function reportHostDiagnostic(module: string, message: string, error?: unknown, enabled = true): void {
  if (!enabled) return;
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}`
    : typeof error === "string"
      ? error
      : error === undefined
        ? ""
        : "Unknown error";
  const suffix = detail ? ` ${sanitizeText(detail)}` : "";
  console.error(`[CR][HOST][${sanitizeText(module)}] ${sanitizeText(message)}${suffix}`);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return normalized.includes("apikey") ||
    normalized.includes("authorization") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized === "token" ||
    normalized.endsWith("token");
}

function sanitizeObjectValue(value: object, seen: Set<object>, depth: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: sanitizeText(value.message) };

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key)
      ? "[REDACTED]"
      : sanitizeValue(nested, seen, depth + 1);
  }
  return sanitized;
}

function sanitizeValue(value: unknown, seen: Set<object>, depth: number): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (depth >= MAX_CONTEXT_DEPTH) {
    return "[MAX_DEPTH]";
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }

  seen.add(value);
  try {
    return sanitizeObjectValue(value, seen, depth);
  } finally {
    seen.delete(value);
  }
}

/**
 * 对上下文对象进行递归脱敏，将敏感字段值替换为 [REDACTED]
 * @param context 待脱敏的上下文对象
 * @returns 脱敏后的新对象（不修改原对象）
 */
export function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(context, new Set(), 0) as Record<string, unknown>;
}

/**
 * 对错误堆栈中可能包含的敏感信息进行脱敏
 * @param stack 错误堆栈字符串
 * @returns 脱敏后的堆栈字符串
 */
function sanitizeStack(stack: string): string {
  return sanitizeText(stack);
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
  private persistenceEnabled = true;
  private persistedLogLoaded = false;
  private silentGeneration = 0;
  private sessionId: string;

  /** 防抖写入定时器 */
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 防抖写入间隔（毫秒） */
  private readonly writeDebounceMs = 2000;
  /** 是否有待写入的数据 */
  private dirty = false;
  /** 所有文件写入共享同一条链，避免慢写入覆盖较新的日志快照。 */
  private writeChain: Promise<void> = Promise.resolve();


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

  get isSilent(): boolean {
    return this.minLevel === "silent";
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
    if (this.isSilent) {
      this.initialized = true;
      return;
    }

    try {
      await this.loadPersistedLog();
      this.initialized = true;
      this.logSessionStart();
    } catch (error) {
      reportHostDiagnostic("Logger", "日志初始化失败", error, !this.isSilent);
      this.initialized = true;
      this.persistenceEnabled = false;
    }
  }

  /** 记录会话开始 */
  private logSessionStart(): void {
    if (!this.shouldLog("info")) return;

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
    
    this.scheduleWrite();
  }

  /** 后续日志立即使用新的最小级别。 */
  setLevel(level: LogLevel): void {
    if (level === this.minLevel) return;
    this.minLevel = level;
    if (level === "silent") {
      this.silentGeneration++;
      if (this.writeTimer !== null) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      this.logBuffer = [];
      this.currentSize = 0;
      this.dirty = false;
      this.persistedLogLoaded = false;
    }
  }

  /**
   * Loads the existing log only while persistence is active. A logger that
   * starts silent must defer this work until its first later write so it never
   * overwrites a pre-existing file with just the newly enabled entries.
   */
  private async loadPersistedLog(): Promise<void> {
    if (this.persistedLogLoaded || this.isSilent || !this.persistenceEnabled) {
      return;
    }

    const silentGeneration = this.silentGeneration;
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

    if (this.isSilent || silentGeneration !== this.silentGeneration) {
      return;
    }

    if (fileExists) {
      const existingContent = await this.fileStorage.read(this.logFilePath);
      if (this.isSilent || silentGeneration !== this.silentGeneration) {
        return;
      }
      if (existingContent) {
        const lines = existingContent.split("\n").filter(line => line.trim());
        this.logBuffer = [...lines, ...this.logBuffer];
        this.currentSize = new TextEncoder().encode(this.logBuffer.join("\n")).length;

        if (this.currentSize > this.maxLogSize) {
          this.rotateLog(0);
        }
      }
    }

    this.persistedLogLoaded = true;
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
      const { event: _event, ...rest } = context;
      cleanContext = Object.keys(rest).length > 0 ? rest : undefined;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      event,
      message: sanitizeText(message),
    };

    // 脱敏上下文中的敏感字段
    if (cleanContext && Object.keys(cleanContext).length > 0) {
      entry.context = sanitizeContext(cleanContext);
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: sanitizeText(error.message),
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

    this.scheduleWrite();
  }


  /** 检查日志级别 */
  private shouldLog(level: LogLevel): boolean {
    if (this.isSilent) return false;
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
        try {
          valueStr = JSON.stringify(value) ?? String(value);
        } catch {
          valueStr = "[UNSERIALIZABLE]";
        }
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

  /** 防抖调度写入：合并高频日志的 I/O 操作 */
  private scheduleWrite(): void {
    if (this.isSilent || !this.persistenceEnabled) return;
    this.dirty = true;
    if (this.writeTimer !== null) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      void this.writeToFile().catch(() => {
        // Keep the dirty bit so a later flush or log event can retry the write.
        this.dirty = true;
      });
    }, this.writeDebounceMs);
  }

  /** 强制刷新：立即写入所有缓冲日志（插件卸载时调用） */
  async flush(): Promise<void> {
    if (this.isSilent) {
      if (this.writeTimer !== null) {
        clearTimeout(this.writeTimer);
        this.writeTimer = null;
      }
      this.dirty = false;
      return;
    }
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      try {
        await this.writeToFile();
      } catch {
        this.dirty = true;
      }
    }
    // A timer may have started a write just before it was cancelled above.
    // Waiting for the chain makes unload deterministic without exposing I/O
    // failures to the plugin lifecycle.
    await this.writeChain;
  }

  /** 将当前快照排入串行写入链。 */
  private async writeToFile(): Promise<void> {
    if (this.isSilent || !this.persistenceEnabled) return;
    const operation = this.writeChain.then(async () => {
      if (this.isSilent || !this.persistenceEnabled) return;
      try {
        await this.loadPersistedLog();
      } catch (error) {
        this.persistenceEnabled = false;
        reportHostDiagnostic("Logger", "日志初始化失败", error, !this.isSilent);
        return;
      }
      if (this.isSilent || !this.persistenceEnabled) return;
      await this.fileStorage.write(this.logFilePath, this.logBuffer.join("\n"));
    });
    this.writeChain = operation.catch((error) => {
      reportHostDiagnostic("Logger", "日志文件写入失败", error, !this.isSilent);
    });
    return operation;
  }

  /** 输出到控制台 */
  private outputToConsole(entry: LogEntry): void {
    if (this.isSilent) return;
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
    let msg = `${time} ${prefix}[${entry.module}] ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = this.formatContext(entry.context);
      if (contextStr) {
        msg += ` ${contextStr}`;
      }
    }
    
    if (entry.error && entry.level === "error") {
      msg += `\n  └─ ${entry.error.message}`;
    }
    
    return msg;
  }

}
