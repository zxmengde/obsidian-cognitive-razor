/**
 * RetryHandler 单元测试
 */

import { RetryHandler, DEFAULT_RETRY_CONFIG, withRetry, delay } from "./retry-handler";
import { err, ok } from "../types";

describe("RetryHandler", () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler();
  });

  describe("错误分类", () => {
    test("应正确分类解析错误 (E001-E010)", () => {
      const parseErrors = ["E001", "E002", "E003", "E004", "E005", "E006", "E007", "E008", "E009", "E010"];

      for (const code of parseErrors) {
        const error = err(code, "测试错误");
        const classification = handler.classifyError(error);

        expect(classification.category).toBe("PARSE_ERROR");
        expect(classification.strategy).toBe("STRUCTURED");
        expect(classification.retryable).toBe(true);
      }
    });

    test("应正确分类 API 错误 (E100-E102)", () => {
      const apiErrors = ["E100", "E101", "E102"];

      for (const code of apiErrors) {
        const error = err(code, "测试错误");
        const classification = handler.classifyError(error);

        expect(classification.category).toBe("API_ERROR");
        expect(classification.strategy).toBe("EXPONENTIAL_BACKOFF");
        expect(classification.retryable).toBe(true);
      }
    });

    test("应正确分类认证错误 (E103)", () => {
      const error = err("E103", "认证失败");
      const classification = handler.classifyError(error);

      expect(classification.category).toBe("AUTH_ERROR");
      expect(classification.strategy).toBe("NO_RETRY");
      expect(classification.retryable).toBe(false);
    });

    test("应正确分类能力错误 (E200-E201)", () => {
      const capabilityErrors = ["E200", "E201"];

      for (const code of capabilityErrors) {
        const error = err(code, "测试错误");
        const classification = handler.classifyError(error);

        expect(classification.category).toBe("CAPABILITY_ERROR");
        expect(classification.strategy).toBe("NO_RETRY");
        expect(classification.retryable).toBe(false);
      }
    });

    test("应正确分类未知错误", () => {
      const error = err("UNKNOWN_CODE", "未知错误");
      const classification = handler.classifyError(error);

      expect(classification.category).toBe("UNKNOWN");
      expect(classification.strategy).toBe("NO_RETRY");
      expect(classification.retryable).toBe(false);
    });
  });

  describe("重试决策", () => {
    test("解析错误应该重试", () => {
      const error = err("E001", "解析错误");
      expect(handler.shouldRetry(error, 1, 3)).toBe(true);
      expect(handler.shouldRetry(error, 2, 3)).toBe(true);
    });

    test("API 错误应该重试", () => {
      const error = err("E100", "API 错误");
      expect(handler.shouldRetry(error, 1, 3)).toBe(true);
      expect(handler.shouldRetry(error, 2, 3)).toBe(true);
    });

    test("认证错误不应该重试", () => {
      const error = err("E103", "认证失败");
      expect(handler.shouldRetry(error, 1, 3)).toBe(false);
    });

    test("能力错误不应该重试", () => {
      const error = err("E201", "能力不匹配");
      expect(handler.shouldRetry(error, 1, 3)).toBe(false);
    });

    test("达到最大重试次数后不应该重试", () => {
      const error = err("E001", "解析错误");
      expect(handler.shouldRetry(error, 3, 3)).toBe(false);
      expect(handler.shouldRetry(error, 4, 3)).toBe(false);
    });
  });

  describe("等待时间计算", () => {
    test("解析错误不需要等待", () => {
      const error = err("E001", "解析错误");
      expect(handler.calculateWaitTime(error, 1)).toBe(0);
      expect(handler.calculateWaitTime(error, 2)).toBe(0);
    });

    test("API 错误应使用指数退避", () => {
      const error = err("E100", "API 错误");

      // 第 1 次重试：2000ms
      expect(handler.calculateWaitTime(error, 1)).toBe(2000);

      // 第 2 次重试：4000ms
      expect(handler.calculateWaitTime(error, 2)).toBe(4000);

      // 第 3 次重试：8000ms
      expect(handler.calculateWaitTime(error, 3)).toBe(8000);
    });

    test("指数退避应有最大延迟限制", () => {
      const error = err("E100", "API 错误");

      // 第 10 次重试应该被限制在 maxDelay
      const waitTime = handler.calculateWaitTime(error, 10);
      expect(waitTime).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelay);
    });

    test("认证错误不需要等待", () => {
      const error = err("E103", "认证失败");
      expect(handler.calculateWaitTime(error, 1)).toBe(0);
    });
  });

  describe("任务错误记录", () => {
    test("应创建正确的任务错误记录", () => {
      const error = err("E001", "解析错误", { detail: "test" });
      const taskError = handler.createTaskError(error, 2);

      expect(taskError.code).toBe("E001");
      expect(taskError.message).toBe("解析错误");
      expect(taskError.attempt).toBe(2);
      expect(taskError.timestamp).toBeDefined();
      expect(new Date(taskError.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe("错误历史提示", () => {
    test("空错误历史应返回空字符串", () => {
      const prompt = handler.buildErrorHistoryPrompt([]);
      expect(prompt).toBe("");
    });

    test("应构建正确的错误历史提示", () => {
      const errors = [
        {
          code: "E001",
          message: "解析错误",
          timestamp: "2024-01-01T00:00:00Z",
          attempt: 1,
        },
        {
          code: "E002",
          message: "Schema 违规",
          timestamp: "2024-01-01T00:00:05Z",
          attempt: 2,
        },
      ];

      const prompt = handler.buildErrorHistoryPrompt(errors);

      expect(prompt).toContain("错误历史");
      expect(prompt).toContain("尝试 1");
      expect(prompt).toContain("E001");
      expect(prompt).toContain("解析错误");
      expect(prompt).toContain("尝试 2");
      expect(prompt).toContain("E002");
      expect(prompt).toContain("Schema 违规");
    });
  });

  describe("用户友好消息", () => {
    test("应为认证错误提供友好消息", () => {
      const error = err("E103", "认证失败");
      const message = handler.getUserFriendlyMessage(error);
      expect(message).toContain("API Key");
    });

    test("应为速率限制提供友好消息", () => {
      const error = err("E102", "速率限制");
      const message = handler.getUserFriendlyMessage(error);
      expect(message).toContain("速率限制");
      expect(message).toContain("重试");
    });

    test("应为能力错误提供友好消息", () => {
      const error = err("E201", "能力不匹配");
      const message = handler.getUserFriendlyMessage(error);
      expect(message).toContain("Provider");
    });
  });

  describe("修复建议", () => {
    test("应为认证错误提供修复建议", () => {
      const error = err("E103", "认证失败");
      const suggestion = handler.getFixSuggestion(error);
      expect(suggestion).toContain("设置");
      expect(suggestion).toContain("API Key");
    });

    test("应为能力错误提供修复建议", () => {
      const error = err("E201", "能力不匹配");
      const suggestion = handler.getFixSuggestion(error);
      expect(suggestion).toContain("Provider");
    });

    test("未知错误应返回 undefined", () => {
      const error = err("UNKNOWN", "未知错误");
      const suggestion = handler.getFixSuggestion(error);
      expect(suggestion).toBeUndefined();
    });
  });
});

describe("withRetry", () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({ baseDelay: 10, maxDelay: 100 }); // 使用较短的延迟以加快测试
  });

  test("成功操作应立即返回", async () => {
    let callCount = 0;

    const operation = async () => {
      callCount++;
      return ok("success");
    };

    const result = await withRetry(operation, handler, 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("success");
    }
    expect(callCount).toBe(1);
  });

  test("可重试错误应重试直到成功", async () => {
    let callCount = 0;

    const operation = async () => {
      callCount++;
      if (callCount < 3) {
        return err("E001", "解析错误");
      }
      return ok("success");
    };

    const result = await withRetry(operation, handler, 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("success");
    }
    expect(callCount).toBe(3);
  });

  test("不可重试错误应立即失败", async () => {
    let callCount = 0;

    const operation = async () => {
      callCount++;
      return err("E103", "认证失败");
    };

    const result = await withRetry(operation, handler, 3);

    expect(result.ok).toBe(false);
    expect(callCount).toBe(1);
  });

  test("达到最大重试次数应失败", async () => {
    let callCount = 0;

    const operation = async () => {
      callCount++;
      return err("E001", "解析错误");
    };

    const result = await withRetry(operation, handler, 3);

    expect(result.ok).toBe(false);
    expect(callCount).toBe(3);
    if (!result.ok) {
      expect(result.error.message).toContain("已重试 3 次");
    }
  });

  test("应传递错误历史给操作", async () => {
    const errorHistories: any[] = [];

    const operation = async (attempt: number, errorHistory: any[]) => {
      errorHistories.push([...errorHistory]);
      if (attempt < 3) {
        return err("E001", `错误 ${attempt}`);
      }
      return ok("success");
    };

    await withRetry(operation, handler, 3);

    // 第 1 次调用：空历史
    expect(errorHistories[0]).toHaveLength(0);

    // 第 2 次调用：1 个错误
    expect(errorHistories[1]).toHaveLength(1);
    expect(errorHistories[1][0].code).toBe("E001");

    // 第 3 次调用：2 个错误
    expect(errorHistories[2]).toHaveLength(2);
  });
});

describe("delay", () => {
  test("应延迟指定的时间", async () => {
    const start = Date.now();
    await delay(50);
    const elapsed = Date.now() - start;

    // 允许一些误差
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(100);
  });
});
