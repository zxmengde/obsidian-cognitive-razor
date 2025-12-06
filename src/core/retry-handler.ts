/**
 * RetryHandler - 错误处理和重试逻辑
 * 
 * 负责：
 * - 结构化重试（针对解析和验证错误）
 * - 指数退避重试（针对 API 错误）
 * - 错误码映射和分类
 * - 重试策略决策
 * 
 * 验证需求：10.1, 10.2, 10.3, 10.4
 */

import { Result, Err, TaskError } from "../types";

// ============================================================================
// 错误分类
// ============================================================================

/**
 * 错误类别
 */
export type ErrorCategory =
  | "PARSE_ERROR"           // 解析错误 (E001-E010)
  | "API_ERROR"             // API 错误 (E100-E102)
  | "AUTH_ERROR"            // 认证错误 (E103)
  | "CAPABILITY_ERROR"      // 能力错误 (E200-E201)
  | "UNKNOWN";              // 未知错误

/**
 * 重试策略类型
 */
export type RetryStrategy =
  | "STRUCTURED"            // 结构化重试（附加错误历史）
  | "EXPONENTIAL_BACKOFF"   // 指数退避重试
  | "NO_RETRY";             // 不重试

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
  /** 建议的等待时间（毫秒） */
  waitTime?: number;
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
  /** 指数退避基础延迟（毫秒） */
  baseDelay: number;
  /** 指数退避最大延迟（毫秒） */
  maxDelay: number;
  /** 指数退避倍数 */
  backoffMultiplier: number;
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 2000,      // 2 秒
  maxDelay: 16000,      // 16 秒
  backoffMultiplier: 2,
};

// ============================================================================
// RetryHandler 类
// ============================================================================

/**
 * RetryHandler - 错误处理和重试逻辑
 */
export class RetryHandler {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * 分类错误并决定重试策略
   */
  classifyError(error: Err): ErrorClassification {
    const code = error.error.code;

    // 解析和验证错误 (E001-E010)
    if (this.isParseError(code)) {
      return {
        category: "PARSE_ERROR",
        strategy: "STRUCTURED",
        retryable: true,
      };
    }

    // 认证错误 (E103)
    if (code === "E103") {
      return {
        category: "AUTH_ERROR",
        strategy: "NO_RETRY",
        retryable: false,
      };
    }

    // API 错误 (E100-E102)
    if (this.isApiError(code)) {
      return {
        category: "API_ERROR",
        strategy: "EXPONENTIAL_BACKOFF",
        retryable: true,
      };
    }

    // 能力错误 (E200-E201)
    if (this.isCapabilityError(code)) {
      return {
        category: "CAPABILITY_ERROR",
        strategy: "NO_RETRY",
        retryable: false,
      };
    }

    // 未知错误
    return {
      category: "UNKNOWN",
      strategy: "NO_RETRY",
      retryable: false,
    };
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(
    error: Err,
    currentAttempt: number,
    maxAttempts: number
  ): boolean {
    // 检查是否达到最大重试次数
    if (currentAttempt >= maxAttempts) {
      return false;
    }

    // 分类错误
    const classification = this.classifyError(error);

    return classification.retryable;
  }

  /**
   * 计算重试等待时间
   */
  calculateWaitTime(
    error: Err,
    attempt: number
  ): number {
    const classification = this.classifyError(error);

    // 结构化重试：不需要等待
    if (classification.strategy === "STRUCTURED") {
      return 0;
    }

    // 指数退避重试
    if (classification.strategy === "EXPONENTIAL_BACKOFF") {
      return this.calculateExponentialBackoff(attempt);
    }

    // 不重试
    return 0;
  }

  /**
   * 计算指数退避延迟
   * 
   * 公式：min(baseDelay * (backoffMultiplier ^ (attempt - 1)), maxDelay)
   * 
   * 示例（baseDelay=2000, multiplier=2）：
   * - 第 1 次重试：2000ms (2 秒)
   * - 第 2 次重试：4000ms (4 秒)
   * - 第 3 次重试：8000ms (8 秒)
   */
  private calculateExponentialBackoff(attempt: number): number {
    const delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * 创建任务错误记录
   */
  createTaskError(
    error: Err,
    attempt: number
  ): TaskError {
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
    const classification = this.classifyError(error);

    switch (classification.category) {
      case "AUTH_ERROR":
        return "认证失败，请检查 API Key 是否正确配置。";

      case "API_ERROR":
        if (code === "E102") {
          return "API 速率限制，系统将自动重试。";
        }
        if (code === "E101") {
          return "请求超时，系统将自动重试。";
        }
        return "API 调用失败，系统将自动重试。";

      case "CAPABILITY_ERROR":
        return "Provider 不支持此功能，请更换 Provider 或检查配置。";

      case "PARSE_ERROR":
        return "AI 输出格式错误，系统将自动重试。";

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

      default:
        return undefined;
    }
  }

  /**
   * 判断是否为解析错误
   */
  private isParseError(code: string): boolean {
    const parseErrorCodes = [
      "E001", // PARSE_ERROR
      "E002", // SCHEMA_VIOLATION
      "E003", // MISSING_REQUIRED
      "E004", // CONSTRAINT_VIOLATION
      "E005", // SEMANTIC_DUPLICATE
      "E006", // INVALID_WIKILINK
      "E007", // TYPE_MISMATCH
      "E008", // CONTENT_TOO_SHORT
      "E009", // SUM_NOT_ONE
      "E010", // INVALID_PATTERN
    ];
    return parseErrorCodes.includes(code);
  }

  /**
   * 判断是否为 API 错误
   */
  private isApiError(code: string): boolean {
    const apiErrorCodes = [
      "E100", // API_ERROR
      "E101", // TIMEOUT
      "E102", // RATE_LIMIT
    ];
    return apiErrorCodes.includes(code);
  }

  /**
   * 判断是否为能力错误
   */
  private isCapabilityError(code: string): boolean {
    const capabilityErrorCodes = [
      "E200", // SAFETY_VIOLATION
      "E201", // CAPABILITY_MISMATCH
    ];
    return capabilityErrorCodes.includes(code);
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
 * 带重试的异步操作包装器
 * 
 * @param operation 要执行的操作
 * @param retryHandler 重试处理器
 * @param maxAttempts 最大尝试次数
 * @returns 操作结果
 */
export async function withRetry<T>(
  operation: (attempt: number, errorHistory: TaskError[]) => Promise<Result<T>>,
  retryHandler: RetryHandler,
  maxAttempts: number = 3
): Promise<Result<T>> {
  const errorHistory: TaskError[] = [];
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;

    // 执行操作
    const result = await operation(attempt, errorHistory);

    // 成功则返回
    if (result.ok) {
      return result;
    }

    // 记录错误
    const taskError = retryHandler.createTaskError(result, attempt);
    errorHistory.push(taskError);

    // 检查是否达到最大重试次数
    if (attempt >= maxAttempts) {
      // 达到最大重试次数，返回带有完整错误历史的错误
      return {
        ok: false,
        error: {
          code: taskError.code,
          message: `操作失败，已重试 ${maxAttempts} 次: ${taskError.message}`,
          details: { errorHistory },
        },
      };
    }

    // 判断是否应该重试
    if (!retryHandler.shouldRetry(result, attempt, maxAttempts)) {
      // 不可重试的错误，直接返回原始错误
      return result;
    }

    // 计算等待时间
    const waitTime = retryHandler.calculateWaitTime(result, attempt);

    // 等待后重试
    if (waitTime > 0) {
      await delay(waitTime);
    }
  }

  // 不应该到达这里，但为了类型安全
  const lastError = errorHistory[errorHistory.length - 1];
  return {
    ok: false,
    error: {
      code: lastError?.code || "UNKNOWN",
      message: `操作失败，已重试 ${maxAttempts} 次: ${lastError?.message || "未知错误"}`,
      details: { errorHistory },
    },
  };
}
