/**
 * RetryHandler - 错误处理和重试逻辑
 * 
 * 遵循设计文档 A-PDD-08 重试策略：
 * - 内容错误 (E001-E010): 立即重试，最多 3 次
 * - 网络错误 (E100-E102): 指数退避 (1s, 2s, 4s, 8s, 16s)，最多 5 次
 * - 终止错误 (E103, E200-E201, E300-E304): 不重试
 * 
 * **Validates: Requirements 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 6.4**
 */

import { Result, Err, TaskError, ILogger } from "../types";

// ============================================================================
// 错误分类
// ============================================================================

/**
 * 错误类别
 */
export type ErrorCategory =
  | "CONTENT_ERROR"         // 内容错误 (E001-E010)
  | "NETWORK_ERROR"         // 网络错误 (E100-E102)
  | "AUTH_ERROR"            // 认证错误 (E103)
  | "CAPABILITY_ERROR"      // 能力错误 (E200-E201)
  | "FILE_SYSTEM_ERROR"     // 文件系统错误 (E300-E304)
  | "UNKNOWN";              // 未知错误

/**
 * 重试策略类型
 */
export type RetryStrategy =
  | "immediate"             // 立即重试（内容错误）
  | "exponential"           // 指数退避重试（网络错误）
  | "no_retry";             // 不重试（终止错误）

/**
 * 错误分类结果
 */
export interface ErrorClassification {
  /** 错误类别 */
  category: ErrorCategory;
  /** 重试策略 */
  strategy: RetryStrategy;
  /** 是否可重试 */
  retryable: boolean;
  /** 最大重试次数 */
  maxAttempts: number;
}

// ============================================================================
// 重试配置
// ============================================================================

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxAttempts: number;
  /** 重试策略 */
  strategy: RetryStrategy;
  /** 指数退避基础延迟（毫秒），默认 1000ms */
  baseDelayMs?: number;
  /** 错误历史（用于结构化重试） */
  errorHistory?: TaskError[];
  /** 重试回调 */
  onRetry?: (attempt: number, error: TaskError) => void;
}

/**
 * 内容错误的默认配置
 * Requirements 6.1: 内容错误 (E001-E010) 立即重试，最多 3 次
 */
export const CONTENT_ERROR_CONFIG: RetryConfig = {
  maxAttempts: 3,
  strategy: "immediate",
};

/**
 * 网络错误的默认配置
 * Requirements 6.2: 网络错误 (E100-E102) 指数退避，最多 5 次
 */
export const NETWORK_ERROR_CONFIG: RetryConfig = {
  maxAttempts: 5,
  strategy: "exponential",
  baseDelayMs: 1000, // 1s, 2s, 4s, 8s, 16s
};

// ============================================================================
// 错误码定义
// ============================================================================

/**
 * 内容错误码 (E001-E010)
 * 这些错误可以通过重试（附加错误历史）来修复
 */
export const CONTENT_ERROR_CODES = [
  "E001", // PARSE_ERROR - 输出非 JSON 或解析失败
  "E002", // SCHEMA_VIOLATION - 不符合输出 Schema
  "E003", // MISSING_REQUIRED - 必填字段缺失
  "E004", // CONSTRAINT_VIOLATION - 违反业务规则 C001-C016
  "E005", // SEMANTIC_DUPLICATE - 相似度超阈值
  "E006", // INVALID_WIKILINK - wikilink 格式错误
  "E007", // TYPE_MISMATCH - 输出类型与预期不符
  "E008", // CONTENT_TOO_SHORT - 内容长度不足
  "E009", // SUM_NOT_ONE - type_confidences 求和 ≠ 1
  "E010", // INVALID_PATTERN - 字段不匹配正则
] as const;

/**
 * 网络错误码 (E100-E102)
 * 这些错误可以通过指数退避重试来恢复
 */
export const NETWORK_ERROR_CODES = [
  "E100", // API_ERROR - Provider 返回 5xx/4xx
  "E101", // TIMEOUT - 请求超时
  "E102", // RATE_LIMIT - 触发速率限制 (429)
] as const;

/**
 * 认证错误码 (E103)
 * 终止错误，不重试
 */
export const AUTH_ERROR_CODES = [
  "E103", // AUTH_ERROR - 认证失败 (401/403)
] as const;

/**
 * 能力错误码 (E200-E201)
 * 终止错误，不重试
 */
export const CAPABILITY_ERROR_CODES = [
  "E200", // SAFETY_VIOLATION - 触发安全边界
  "E201", // CAPABILITY_MISMATCH - Provider 能力不足
] as const;

/**
 * 文件系统错误码 (E300-E304)
 * 终止错误，不重试
 */
export const FILE_SYSTEM_ERROR_CODES = [
  "E300", // FILE_WRITE_ERROR - 文件写入失败
  "E301", // FILE_READ_ERROR - 文件读取失败
  "E302", // INDEX_CORRUPTED - 向量索引损坏
  "E303", // SNAPSHOT_RESTORE_FAILED - 快照恢复失败
  "E304", // PROVIDER_NOT_FOUND - Provider 不存在
] as const;

/**
 * 所有终止错误码（不重试）
 */
export const TERMINAL_ERROR_CODES = [
  ...AUTH_ERROR_CODES,
  ...CAPABILITY_ERROR_CODES,
  ...FILE_SYSTEM_ERROR_CODES,
] as const;

// ============================================================================
// RetryHandler 接口
// ============================================================================

/**
 * RetryHandler 接口
 * 遵循设计文档 section 7.4 定义
 */
export interface IRetryHandler {
  /**
   * 带重试的异步操作执行
   * @param operation 要执行的操作
   * @param config 重试配置
   * @returns 操作结果
   */
  executeWithRetry<T>(
    operation: () => Promise<Result<T>>,
    config: RetryConfig
  ): Promise<Result<T>>;
}

// ============================================================================
// RetryHandler 类
// ============================================================================

/**
 * RetryHandler - 错误处理和重试逻辑
 * 
 * 实现设计文档 A-PDD-08 定义的重试策略：
 * - 内容错误 (E001-E010): 立即重试，最多 3 次
 * - 网络错误 (E100-E102): 指数退避 (1s, 2s, 4s, 8s, 16s)，最多 5 次
 * - 终止错误 (E103, E200-E201, E300-E304): 不重试
 */
export class RetryHandler implements IRetryHandler {
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  /**
   * 分类错误并决定重试策略
   * 
   * @param errorCode 错误码
   * @returns 错误分类结果
   */
  classifyError(errorCode: string): ErrorClassification {
    // 内容错误 (E001-E010): 立即重试，最多 3 次
    if (this.isContentError(errorCode)) {
      return {
        category: "CONTENT_ERROR",
        strategy: "immediate",
        retryable: true,
        maxAttempts: 3,
      };
    }

    // 网络错误 (E100-E102): 指数退避，最多 5 次
    if (this.isNetworkError(errorCode)) {
      return {
        category: "NETWORK_ERROR",
        strategy: "exponential",
        retryable: true,
        maxAttempts: 5,
      };
    }

    // 认证错误 (E103): 不重试
    if (this.isAuthError(errorCode)) {
      return {
        category: "AUTH_ERROR",
        strategy: "no_retry",
        retryable: false,
        maxAttempts: 1,
      };
    }

    // 能力错误 (E200-E201): 不重试
    if (this.isCapabilityError(errorCode)) {
      return {
        category: "CAPABILITY_ERROR",
        strategy: "no_retry",
        retryable: false,
        maxAttempts: 1,
      };
    }

    // 文件系统错误 (E300-E304): 不重试
    if (this.isFileSystemError(errorCode)) {
      return {
        category: "FILE_SYSTEM_ERROR",
        strategy: "no_retry",
        retryable: false,
        maxAttempts: 1,
      };
    }

    // 未知错误: 不重试
    return {
      category: "UNKNOWN",
      strategy: "no_retry",
      retryable: false,
      maxAttempts: 1,
    };
  }

  /**
   * 判断是否应该重试
   * 
   * @param error 错误结果
   * @param currentAttempt 当前尝试次数
   * @returns 是否应该重试
   */
  shouldRetry(error: Err, currentAttempt: number): boolean {
    const classification = this.classifyError(error.error.code);
    
    // 不可重试的错误
    if (!classification.retryable) {
      return false;
    }

    // 检查是否达到最大重试次数
    if (currentAttempt >= classification.maxAttempts) {
      return false;
    }

    return true;
  }

  /**
   * 计算重试等待时间
   * 
   * 根据设计文档 A-PDD-08：
   * - 内容错误: 立即重试（0ms）
   * - 网络错误: 指数退避 (1s, 2s, 4s, 8s, 16s)
   * 
   * @param error 错误结果
   * @param attempt 当前尝试次数（从 1 开始）
   * @param baseDelayMs 基础延迟（毫秒），默认 1000ms
   * @returns 等待时间（毫秒）
   */
  calculateWaitTime(error: Err, attempt: number, baseDelayMs: number = 1000): number {
    const classification = this.classifyError(error.error.code);

    // 立即重试策略：不需要等待
    if (classification.strategy === "immediate") {
      return 0;
    }

    // 指数退避策略：1s, 2s, 4s, 8s, 16s
    if (classification.strategy === "exponential") {
      return this.calculateExponentialBackoff(attempt, baseDelayMs);
    }

    // 不重试策略
    return 0;
  }

  /**
   * 计算指数退避延迟
   * 
   * 公式：baseDelay * 2^(attempt - 1)
   * 
   * 示例（baseDelay=1000ms）：
   * - 第 1 次重试：1000ms (1 秒)
   * - 第 2 次重试：2000ms (2 秒)
   * - 第 3 次重试：4000ms (4 秒)
   * - 第 4 次重试：8000ms (8 秒)
   * - 第 5 次重试：16000ms (16 秒)
   * 
   * @param attempt 当前尝试次数（从 1 开始）
   * @param baseDelayMs 基础延迟（毫秒）
   * @returns 延迟时间（毫秒）
   */
  private calculateExponentialBackoff(attempt: number, baseDelayMs: number): number {
    // attempt 从 1 开始，所以第 1 次重试的延迟是 baseDelay * 2^0 = baseDelay
    return baseDelayMs * Math.pow(2, attempt - 1);
  }

  /**
   * 带重试的异步操作执行
   * 
   * @param operation 要执行的操作
   * @param config 重试配置
   * @returns 操作结果
   */
  async executeWithRetry<T>(
    operation: () => Promise<Result<T>>,
    config: RetryConfig
  ): Promise<Result<T>> {
    const errorHistory: TaskError[] = config.errorHistory ? [...config.errorHistory] : [];
    let attempt = 0;
    const maxAttempts = config.maxAttempts;
    const baseDelayMs = config.baseDelayMs ?? 1000;

    while (attempt < maxAttempts) {
      attempt++;

      this.logger?.debug("RetryHandler", `执行操作，尝试 ${attempt}/${maxAttempts}`, {
        event: "RETRY_ATTEMPT",
        attempt,
        maxAttempts,
        strategy: config.strategy,
      });

      // 执行操作
      const result = await operation();

      // 成功则返回
      if (result.ok) {
        this.logger?.debug("RetryHandler", `操作成功，尝试 ${attempt}`, {
          event: "RETRY_SUCCESS",
          attempt,
        });
        return result;
      }

      // 创建任务错误记录
      const taskError = this.createTaskError(result, attempt);
      errorHistory.push(taskError);

      this.logger?.warn("RetryHandler", `操作失败，尝试 ${attempt}/${maxAttempts}`, {
        event: "RETRY_FAILURE",
        attempt,
        maxAttempts,
        errorCode: result.error.code,
        errorMessage: result.error.message,
      });

      // 调用重试回调
      if (config.onRetry) {
        config.onRetry(attempt, taskError);
      }

      // 检查是否应该重试
      if (!this.shouldRetry(result, attempt)) {
        this.logger?.info("RetryHandler", `错误不可重试或已达最大次数`, {
          event: "RETRY_TERMINATED",
          attempt,
          errorCode: result.error.code,
          retryable: this.classifyError(result.error.code).retryable,
        });
        
        // 返回带有错误历史的错误
        return {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            details: { 
              ...((result.error.details as object) || {}),
              errorHistory,
              finalAttempt: attempt,
            },
          },
        };
      }

      // 计算等待时间
      const waitTime = this.calculateWaitTime(result, attempt, baseDelayMs);

      if (waitTime > 0) {
        this.logger?.debug("RetryHandler", `等待 ${waitTime}ms 后重试`, {
          event: "RETRY_WAIT",
          waitTime,
          attempt,
        });
        await delay(waitTime);
      }
    }

    // 达到最大重试次数
    const lastError = errorHistory[errorHistory.length - 1];
    
    this.logger?.error("RetryHandler", `重试耗尽，操作失败`, undefined, {
      event: "RETRY_EXHAUSTED",
      maxAttempts,
      lastErrorCode: lastError?.code,
      lastErrorMessage: lastError?.message,
    });

    return {
      ok: false,
      error: {
        code: lastError?.code || "UNKNOWN",
        message: `操作失败，已重试 ${maxAttempts} 次: ${lastError?.message || "未知错误"}`,
        details: { 
          errorHistory,
          finalAttempt: maxAttempts,
          exhausted: true,
        },
      },
    };
  }

  /**
   * 创建任务错误记录
   */
  createTaskError(error: Err, attempt: number): TaskError {
    return {
      code: error.error.code,
      message: error.error.message,
      timestamp: new Date().toISOString(),
      attempt,
    };
  }

  /**
   * 构建结构化重试的错误历史提示
   * 
   * 将错误历史附加到 prompt 中，帮助 AI 避免重复错误
   */
  buildErrorHistoryPrompt(errors: TaskError[]): string {
    if (errors.length === 0) {
      return "";
    }

    const lines = [
      "\n\n## 错误历史",
      "以下是之前尝试中遇到的错误，请避免重复这些错误：\n",
    ];

    for (const error of errors) {
      lines.push(`### 尝试 ${error.attempt}`);
      lines.push(`- 错误码：${error.code}`);
      lines.push(`- 错误信息：${error.message}`);
      lines.push(`- 时间：${error.timestamp}\n`);
    }

    return lines.join("\n");
  }

  /**
   * 获取错误的用户友好提示
   */
  getUserFriendlyMessage(error: Err): string {
    const code = error.error.code;
    const classification = this.classifyError(code);

    switch (classification.category) {
      case "AUTH_ERROR":
        return "认证失败，请检查 API Key 是否正确配置。";

      case "NETWORK_ERROR":
        if (code === "E102") {
          return "API 速率限制，系统将自动重试。";
        }
        if (code === "E101") {
          return "请求超时，系统将自动重试。";
        }
        return "API 调用失败，系统将自动重试。";

      case "CAPABILITY_ERROR":
        return "Provider 不支持此功能，请更换 Provider 或检查配置。";

      case "CONTENT_ERROR":
        return "AI 输出格式错误，系统将自动重试。";

      case "FILE_SYSTEM_ERROR":
        return "文件系统操作失败，请检查权限和磁盘空间。";

      default:
        return error.error.message;
    }
  }

  /**
   * 获取错误的修复建议
   */
  getFixSuggestion(error: Err): string | undefined {
    const code = error.error.code;

    switch (code) {
      case "E103":
        return "请前往设置页面检查并更新 API Key。";

      case "E201":
        return "请选择支持此功能的 Provider 或检查配置。";

      case "E102":
        return "请稍后再试，或考虑升级 API 套餐以获得更高的速率限制。";

      case "E001":
      case "E002":
        return "AI 输出格式不正确，系统将自动重试并提供更明确的指示。";

      case "E300":
        return "请检查文件写入权限和磁盘空间。";

      case "E301":
        return "请检查文件是否存在和读取权限。";

      case "E302":
        return "向量索引可能已损坏，请尝试重建索引。";

      case "E303":
        return "快照恢复失败，请检查快照文件是否完整。";

      case "E304":
        return "请检查 Provider 配置是否正确。";

      default:
        return undefined;
    }
  }

  /**
   * 获取错误的重试配置
   * 根据错误类型返回适当的重试配置
   */
  getRetryConfigForError(error: Err): RetryConfig {
    const classification = this.classifyError(error.error.code);

    if (classification.category === "CONTENT_ERROR") {
      return { ...CONTENT_ERROR_CONFIG };
    }

    if (classification.category === "NETWORK_ERROR") {
      return { ...NETWORK_ERROR_CONFIG };
    }

    // 终止错误：不重试
    return {
      maxAttempts: 1,
      strategy: "no_retry",
    };
  }

  // ============================================================================
  // 错误类型判断方法
  // ============================================================================

  /**
   * 判断是否为内容错误 (E001-E010)
   */
  isContentError(code: string): boolean {
    return (CONTENT_ERROR_CODES as readonly string[]).includes(code);
  }

  /**
   * 判断是否为网络错误 (E100-E102)
   */
  isNetworkError(code: string): boolean {
    return (NETWORK_ERROR_CODES as readonly string[]).includes(code);
  }

  /**
   * 判断是否为认证错误 (E103)
   */
  isAuthError(code: string): boolean {
    return (AUTH_ERROR_CODES as readonly string[]).includes(code);
  }

  /**
   * 判断是否为能力错误 (E200-E201)
   */
  isCapabilityError(code: string): boolean {
    return (CAPABILITY_ERROR_CODES as readonly string[]).includes(code);
  }

  /**
   * 判断是否为文件系统错误 (E300-E304)
   */
  isFileSystemError(code: string): boolean {
    return (FILE_SYSTEM_ERROR_CODES as readonly string[]).includes(code);
  }

  /**
   * 判断是否为终止错误（不可重试）
   */
  isTerminalError(code: string): boolean {
    return (TERMINAL_ERROR_CODES as readonly string[]).includes(code);
  }

  /**
   * 检查结果是否为重试耗尽
   * 
   * 用于判断操作是否因为重试次数耗尽而失败
   * 
   * @param result 操作结果
   * @returns 是否为重试耗尽
   */
  isRetryExhausted<T>(result: Result<T>): boolean {
    if (result.ok) {
      return false;
    }

    const details = result.error.details as {
      exhausted?: boolean;
      finalAttempt?: number;
    } | undefined;

    return details?.exhausted === true;
  }

  /**
   * 从失败结果中提取错误历史
   * 
   * @param result 失败的操作结果
   * @returns 错误历史数组
   */
  getErrorHistory<T>(result: Result<T>): TaskError[] {
    if (result.ok) {
      return [];
    }

    const details = result.error.details as {
      errorHistory?: TaskError[];
    } | undefined;

    return details?.errorHistory ?? [];
  }

  /**
   * 从失败结果中获取最后一个错误
   * 
   * 用于设置任务状态为 Failed 时记录最后错误
   * 遵循 Requirements 6.4：重试耗尽后设置任务状态为 Failed，记录最后错误
   * 
   * @param result 失败的操作结果
   * @returns 最后一个错误，如果没有则返回 undefined
   */
  getLastError<T>(result: Result<T>): TaskError | undefined {
    const errorHistory = this.getErrorHistory(result);
    return errorHistory.length > 0 ? errorHistory[errorHistory.length - 1] : undefined;
  }

  /**
   * 创建任务失败结果
   * 
   * 用于将重试耗尽的结果转换为任务失败状态
   * 遵循 Requirements 6.4：重试耗尽后设置任务状态为 Failed，记录最后错误
   * 
   * @param taskId 任务 ID
   * @param result 失败的操作结果
   * @returns 任务失败信息
   */
  createTaskFailureInfo<T>(taskId: string, result: Result<T>): {
    taskId: string;
    state: "Failed";
    lastError: TaskError | undefined;
    errorHistory: TaskError[];
    finalAttempt: number;
  } {
    const errorHistory = this.getErrorHistory(result);
    const lastError = this.getLastError(result);
    
    const details = !result.ok ? (result.error.details as {
      finalAttempt?: number;
    } | undefined) : undefined;

    return {
      taskId,
      state: "Failed",
      lastError,
      errorHistory,
      finalAttempt: details?.finalAttempt ?? errorHistory.length,
    };
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的异步操作包装器（便捷函数）
 * 
 * @param operation 要执行的操作
 * @param retryHandler 重试处理器
 * @param config 重试配置
 * @returns 操作结果
 */
export async function withRetry<T>(
  operation: (attempt: number, errorHistory: TaskError[]) => Promise<Result<T>>,
  retryHandler: RetryHandler,
  config?: Partial<RetryConfig>
): Promise<Result<T>> {
  const errorHistory: TaskError[] = [];
  
  const wrappedOperation = async (): Promise<Result<T>> => {
    const attempt = errorHistory.length + 1;
    return operation(attempt, errorHistory);
  };

  const fullConfig: RetryConfig = {
    maxAttempts: config?.maxAttempts ?? 3,
    strategy: config?.strategy ?? "immediate",
    baseDelayMs: config?.baseDelayMs ?? 1000,
    errorHistory,
    onRetry: (attempt, error) => {
      errorHistory.push(error);
      config?.onRetry?.(attempt, error);
    },
  };

  return retryHandler.executeWithRetry(wrappedOperation, fullConfig);
}
