/** RetryHandler：错误分类与带重试的异步操作执行 */

import type { Result, Err, TaskError, ILogger } from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import {
  getErrorCategory,
  isRetryableErrorCode,
} from "../data/error-codes";

/** 错误类别 */
type ErrorCategory =
  | "INPUT_ERROR"           // 输入/校验错误 (E1xx)
  | "PROVIDER_ERROR"        // Provider/AI 错误 (E2xx)
  | "SYSTEM_ERROR"          // 系统/IO/状态错误 (E3xx)
  | "CONFIG_ERROR"          // 配置错误 (E4xx)
  | "INTERNAL_ERROR"        // 内部错误 (E5xx)
  | "UNKNOWN";              // 未知错误

/** 重试策略类型 */
type RetryStrategy =
  | "immediate"             // 立即重试（内容错误）
  | "exponential"           // 指数退避重试（网络错误）
  | "no_retry";             // 不重试（终止错误）

/** 错误分类结果 */
interface ErrorClassification {
  category: ErrorCategory;
  strategy: RetryStrategy;
  retryable: boolean;
  maxAttempts: number;
}

/** 重试配置 */
interface RetryConfig {
  maxAttempts: number;
  strategy: RetryStrategy;
  baseDelayMs?: number;
  errorHistory?: TaskError[];
  onRetry?: (attempt: number, error: TaskError) => void;
}

/** Provider 错误的默认配置 */
export const PROVIDER_ERROR_CONFIG: RetryConfig = {
  maxAttempts: 5,
  strategy: "immediate",
};

export class RetryHandler {
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  /** 分类错误并决定重试策略 */
  classifyError(errorCode: string): ErrorClassification {
    const category = getErrorCategory(errorCode);
    const retryable = isRetryableErrorCode(errorCode);

    if (category === "INPUT_VALIDATION") {
      return { category: "INPUT_ERROR", strategy: "no_retry", retryable: false, maxAttempts: 1 };
    }

    if (category === "PROVIDER_AI") {
      const isModelOutput =
        errorCode.startsWith("E210_") ||
        errorCode.startsWith("E211_") ||
        errorCode.startsWith("E212_");
      return { category: "PROVIDER_ERROR", strategy: "immediate", retryable, maxAttempts: isModelOutput ? 3 : 5 };
    }

    if (category === "SYSTEM_IO") {
      return { category: "SYSTEM_ERROR", strategy: "no_retry", retryable, maxAttempts: retryable ? 3 : 1 };
    }

    if (category === "CONFIG") {
      return { category: "CONFIG_ERROR", strategy: "no_retry", retryable: false, maxAttempts: 1 };
    }

    if (category === "INTERNAL") {
      return { category: "INTERNAL_ERROR", strategy: "no_retry", retryable: false, maxAttempts: 1 };
    }

    return { category: "UNKNOWN", strategy: "no_retry", retryable: false, maxAttempts: 1 };
  }

  /** 判断是否应该重试 */
  private shouldRetry(error: Err, currentAttempt: number): boolean {
    const classification = this.classifyError(error.error.code);
    if (!classification.retryable) return false;
    if (currentAttempt >= classification.maxAttempts) return false;
    return true;
  }

  /** 计算重试等待时间 */
  private calculateWaitTime(error: Err, attempt: number, baseDelayMs: number = 1000): number {
    const classification = this.classifyError(error.error.code);
    if (classification.strategy === "exponential") {
      return baseDelayMs * Math.pow(2, attempt - 1);
    }
    return 0;
  }

  /** 创建任务错误记录 */
  private createTaskError(error: Err, attempt: number): TaskError {
    return {
      code: error.error.code,
      message: error.error.message,
      timestamp: formatCRTimestamp(),
      attempt,
    };
  }

  /** 带重试的异步操作执行 */
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
        event: "RETRY_ATTEMPT", attempt, maxAttempts, strategy: config.strategy,
      });

      const result = await operation();

      if (result.ok) {
        this.logger?.debug("RetryHandler", `操作成功，尝试 ${attempt}`, { event: "RETRY_SUCCESS", attempt });
        return result;
      }

      const taskError = this.createTaskError(result, attempt);
      errorHistory.push(taskError);

      this.logger?.warn("RetryHandler", `操作失败，尝试 ${attempt}/${maxAttempts}`, {
        event: "RETRY_FAILURE", attempt, maxAttempts,
        errorCode: result.error.code, errorMessage: result.error.message,
      });

      if (config.onRetry) {
        config.onRetry(attempt, taskError);
      }

      if (!this.shouldRetry(result, attempt)) {
        this.logger?.info("RetryHandler", `错误不可重试或已达最大次数`, {
          event: "RETRY_TERMINATED", attempt, errorCode: result.error.code,
          retryable: this.classifyError(result.error.code).retryable,
        });
        return {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
            details: { ...((result.error.details as object) || {}), errorHistory, finalAttempt: attempt },
          },
        };
      }

      const waitTime = this.calculateWaitTime(result, attempt, baseDelayMs);
      if (waitTime > 0) {
        this.logger?.debug("RetryHandler", `等待 ${waitTime}ms 后重试`, { event: "RETRY_WAIT", waitTime, attempt });
        await delay(waitTime);
      }
    }

    // 达到最大重试次数
    const lastError = errorHistory[errorHistory.length - 1];
    this.logger?.error("RetryHandler", `重试耗尽，操作失败`, undefined, {
      event: "RETRY_EXHAUSTED", maxAttempts, lastErrorCode: lastError?.code, lastErrorMessage: lastError?.message,
    });

    return {
      ok: false,
      error: {
        code: lastError?.code || "UNKNOWN",
        message: `操作失败，已重试 ${maxAttempts} 次: ${lastError?.message || "未知错误"}`,
        details: { errorHistory, finalAttempt: maxAttempts, exhausted: true },
      },
    };
  }
}

/** 延迟执行 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
