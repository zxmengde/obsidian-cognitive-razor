/** RetryHandler：错误处理和重试逻辑 */

import { Result, Err, TaskError, ILogger } from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import {
  getErrorCategory,
  isRetryableErrorCode,
  getFixSuggestion as getFixSuggestionForCode
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
  /** 错误类别 */
  category: ErrorCategory;
  /** 重试策略 */
  strategy: RetryStrategy;
  /** 是否可重试 */
  retryable: boolean;
  /** 最大重试次数 */
  maxAttempts: number;
}

/** 重试配置 */
interface RetryConfig {
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

/** 内容错误的默认配置 */
const MODEL_OUTPUT_ERROR_CONFIG: RetryConfig = {
  maxAttempts: 3,
  strategy: "immediate",
};

/** Provider 错误的默认配置（不引入显式 backoff） */
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
      return {
        category: "INPUT_ERROR",
        strategy: "no_retry",
        retryable: false,
        maxAttempts: 1,
      };
    }

    if (category === "PROVIDER_AI") {
      const isModelOutputError =
        errorCode.startsWith("E210_") ||
        errorCode.startsWith("E211_") ||
        errorCode.startsWith("E212_");

      return {
        category: "PROVIDER_ERROR",
        strategy: "immediate",
        retryable,
        maxAttempts: isModelOutputError ? 3 : 5,
      };
    }

    if (category === "SYSTEM_IO") {
      return {
        category: "SYSTEM_ERROR",
        strategy: "no_retry",
        retryable,
        maxAttempts: retryable ? 3 : 1,
      };
    }

    if (category === "CONFIG") {
      return {
        category: "CONFIG_ERROR",
        strategy: "no_retry",
        retryable: false,
        maxAttempts: 1,
      };
    }

    if (category === "INTERNAL") {
      return {
        category: "INTERNAL_ERROR",
        strategy: "no_retry",
        retryable: false,
        maxAttempts: 1,
      };
    }

    return {
      category: "UNKNOWN",
      strategy: "no_retry",
      retryable: false,
      maxAttempts: 1,
    };
  }

  /** 判断是否应该重试 */
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

  /** 计算重试等待时间 */
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

  /** 计算指数退避延迟 */
  private calculateExponentialBackoff(attempt: number, baseDelayMs: number): number {
    // attempt 从 1 开始，所以第 1 次重试的延迟是 baseDelay * 2^0 = baseDelay
    return baseDelayMs * Math.pow(2, attempt - 1);
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

  /** 创建任务错误记录 */
  createTaskError(error: Err, attempt: number): TaskError {
    return {
      code: error.error.code,
      message: error.error.message,
      timestamp: formatCRTimestamp(),
      attempt,
    };
  }

  /** 构建结构化重试的错误历史提示 */
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

  /** 获取错误的用户友好提示 */
  getUserFriendlyMessage(error: Err): string {
    const code = error.error.code;
    const classification = this.classifyError(code);

    switch (classification.category) {
      case "INPUT_ERROR":
      case "CONFIG_ERROR":
      case "SYSTEM_ERROR":
      case "INTERNAL_ERROR":
        return error.error.message;

      case "PROVIDER_ERROR":
        if (code === "E202_RATE_LIMITED") {
          return "触发速率限制，系统将自动重试。";
        }
        if (code === "E201_PROVIDER_TIMEOUT") {
          return "请求超时，系统将自动重试。";
        }
        if (code === "E203_INVALID_API_KEY") {
          return "认证失败，请检查 API Key 是否正确配置。";
        }
        if (code.startsWith("E210_") || code.startsWith("E211_") || code.startsWith("E212_")) {
          return "模型输出不符合要求，系统将自动重试。";
        }
        return "Provider 调用失败，系统将自动重试。";

      default:
        return error.error.message;
    }
  }

  /** 获取错误的修复建议 */
  getFixSuggestion(error: Err): string | undefined {
    return getFixSuggestionForCode(error.error.code);
  }

  /** 获取错误的重试配置 */
  getRetryConfigForError(error: Err): RetryConfig {
    const classification = this.classifyError(error.error.code);

    if (classification.category === "PROVIDER_ERROR") {
      const isModelOutputError =
        error.error.code.startsWith("E210_") ||
        error.error.code.startsWith("E211_") ||
        error.error.code.startsWith("E212_");

      return isModelOutputError ? { ...MODEL_OUTPUT_ERROR_CONFIG } : { ...PROVIDER_ERROR_CONFIG };
    }

    // 终止错误：不重试
    return {
      maxAttempts: 1,
      strategy: "no_retry",
    };
  }

  /** 判断是否为模型输出错误（E210_/E211_/E212_） */
  isModelOutputError(code: string): boolean {
    return code.startsWith("E210_") || code.startsWith("E211_") || code.startsWith("E212_");
  }

  /** 判断是否为终止错误（不可重试） */
  isTerminalError(code: string): boolean {
    return !isRetryableErrorCode(code);
  }

  /** 检查结果是否为重试耗尽 */
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

  /** 从失败结果中提取错误历史 */
  getErrorHistory<T>(result: Result<T>): TaskError[] {
    if (result.ok) {
      return [];
    }

    const details = result.error.details as {
      errorHistory?: TaskError[];
    } | undefined;

    return details?.errorHistory ?? [];
  }

  /** 从失败结果中获取最后一个错误 */
  getLastError<T>(result: Result<T>): TaskError | undefined {
    const errorHistory = this.getErrorHistory(result);
    return errorHistory.length > 0 ? errorHistory[errorHistory.length - 1] : undefined;
  }

  /** 创建任务失败结果 */
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

/** 延迟执行（内部使用） */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带重试的异步操作包装器（便捷函数） */
async function withRetry<T>(
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
