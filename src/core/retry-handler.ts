/** RetryHandler：错误分类与带重试的异步操作执行 */

import { err } from "../types";
import type { Result, Err, ILogger } from "../types";
import {
  getErrorCategory,
  isRetryableErrorCode,
} from "../data/error-codes";

/** 重试策略类型 */
type RetryStrategy =
  | "immediate"             // 立即重试（内容错误）
  | "exponential"           // 指数退避重试（网络错误）
  | "no_retry";             // 不重试（终止错误）

/** 错误分类结果 */
interface ErrorClassification {
  strategy: RetryStrategy;
  retryable: boolean;
  maxAttempts: number;
}

/** 重试配置 */
interface RetryConfig {
  maxAttempts: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (nextAttempt: number, error: Err["error"]) => void;
}

/** Provider 错误的默认配置 */
export const PROVIDER_ERROR_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 250,
};

function withProviderAttempts(error: Err["error"], providerAttempts: number): Err {
  const existingDetails = error.details;
  const details = existingDetails !== null
    && typeof existingDetails === "object"
    && !Array.isArray(existingDetails)
    ? { ...(existingDetails as Record<string, unknown>), providerAttempts }
    : {
        ...(existingDetails === undefined ? {} : { providerErrorDetails: existingDetails }),
        providerAttempts,
      };
  return err(error.code, error.message, details);
}

export class RetryHandler {
  private logger?: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  /** 分类错误并决定重试策略 */
  private classifyError(errorCode: string): ErrorClassification {
    const category = getErrorCategory(errorCode);
    const retryable = isRetryableErrorCode(errorCode);

    if (category === "INPUT_VALIDATION") {
      return { strategy: "no_retry", retryable: false, maxAttempts: 1 };
    }

    if (category === "PROVIDER_AI") {
      const needsBackoff =
        errorCode === "E201_PROVIDER_TIMEOUT" ||
        errorCode === "E202_RATE_LIMITED" ||
        errorCode === "E204_PROVIDER_ERROR";
      return {
        strategy: needsBackoff ? "exponential" : "immediate",
        retryable,
        maxAttempts: 3
      };
    }

    if (category === "SYSTEM_IO") {
      return { strategy: "no_retry", retryable, maxAttempts: retryable ? 3 : 1 };
    }

    if (category === "CONFIG") {
      return { strategy: "no_retry", retryable: false, maxAttempts: 1 };
    }

    if (category === "INTERNAL") {
      return { strategy: "no_retry", retryable: false, maxAttempts: 1 };
    }

    return { strategy: "no_retry", retryable: false, maxAttempts: 1 };
  }

  /** 判断是否应该重试 */
  private shouldRetry(error: Err, currentAttempt: number, configuredMaxAttempts: number): boolean {
    const classification = this.classifyError(error.error.code);
    if (!classification.retryable) return false;
    return currentAttempt < Math.min(configuredMaxAttempts, classification.maxAttempts);
  }

  /** 计算重试等待时间 */
  private calculateWaitTime(error: Err, attempt: number, baseDelayMs: number = 1000): number {
    const classification = this.classifyError(error.error.code);
    if (classification.strategy === "exponential") {
      return baseDelayMs * Math.pow(2, attempt - 1);
    }
    return 0;
  }

  /** 带重试的异步操作执行 */
  async executeWithRetry<T>(
    operation: () => Promise<Result<T>>,
    config: RetryConfig
  ): Promise<Result<T>> {
    const maxAttempts = Math.max(1, config.maxAttempts);
    const baseDelayMs = config.baseDelayMs ?? 1000;
    let attempt = 1;

    while (true) {
      if (config.signal?.aborted) {
        return err("E310_INVALID_STATE", "操作已取消", config.signal.reason);
      }

      this.logger?.debug("RetryHandler", `执行操作，尝试 ${attempt}/${maxAttempts}`, {
        event: "RETRY_ATTEMPT", attempt, maxAttempts,
      });

      const result = await operation();

      if (result.ok) {
        this.logger?.debug("RetryHandler", `操作成功，尝试 ${attempt}`, { event: "RETRY_SUCCESS", attempt });
        return result;
      }

      this.logger?.warn("RetryHandler", `操作失败，尝试 ${attempt}/${maxAttempts}`, {
        event: "RETRY_FAILURE", attempt, maxAttempts,
        errorCode: result.error.code, errorMessage: result.error.message,
      });

      if (!this.shouldRetry(result, attempt, maxAttempts)) {
        const classification = this.classifyError(result.error.code);
        this.logger?.info("RetryHandler", `错误不可重试或已达最大次数`, {
          event: "RETRY_TERMINATED", attempt, errorCode: result.error.code,
          retryable: classification.retryable,
        });
        return withProviderAttempts(result.error, attempt);
      }

      if (config.signal?.aborted) {
        return err("E310_INVALID_STATE", "操作已取消", config.signal.reason);
      }
      config.onRetry?.(attempt + 1, result.error);

      const waitTime = this.calculateWaitTime(result, attempt, baseDelayMs);
      if (waitTime > 0) {
        this.logger?.debug("RetryHandler", `等待 ${waitTime}ms 后重试`, { event: "RETRY_WAIT", waitTime, attempt });
        const completed = await delay(waitTime, config.signal);
        if (!completed) {
          return err("E310_INVALID_STATE", "操作已取消", config.signal?.reason);
        }
      }
      attempt += 1;
    }
  }
}

/** 延迟执行 */
function delay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (!signal) {
    return new Promise((resolve) => setTimeout(() => resolve(true), ms));
  }

  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve(true);
    }, ms);
    const handleAbort = (): void => {
      clearTimeout(timeoutHandle);
      signal.removeEventListener("abort", handleAbort);
      resolve(false);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}
