/**
 * RetryHandler 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { RetryHandler, withRetry } from "./retry-handler";
import { err, ok, Err } from "../types";

describe("RetryHandler 属性测试", () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({ baseDelay: 1, maxDelay: 10 }); // 使用较短的延迟以加快测试
  });

  /**
   * **Feature: cognitive-razor, Property 21: 认证错误终止**
   * **验证需求：10.3**
   * 
   * 属性：对于任意返回 401 认证错误的 API 调用，系统必须立即终止任务（不重试）
   * 并提示用户检查 API Key。
   */
  test("属性 21: 认证错误终止", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成任意错误消息
        fc.string({ minLength: 1, maxLength: 100 }),
        // 生成任意错误详情
        fc.record({
          status: fc.constant(401),
          errorData: fc.anything(),
        }),
        async (errorMessage, errorDetails) => {
          // 创建认证错误
          const authError = err("E103", errorMessage, errorDetails);

          // 测试 1: 认证错误应该被分类为不可重试
          const classification = handler.classifyError(authError);
          expect(classification.category).toBe("AUTH_ERROR");
          expect(classification.strategy).toBe("NO_RETRY");
          expect(classification.retryable).toBe(false);

          // 测试 2: shouldRetry 应该返回 false
          expect(handler.shouldRetry(authError, 1, 3)).toBe(false);
          expect(handler.shouldRetry(authError, 2, 3)).toBe(false);

          // 测试 3: 使用 withRetry 时应该立即失败，不重试
          let callCount = 0;
          const operation = async () => {
            callCount++;
            return authError;
          };

          const result = await withRetry(operation, handler, 3);

          // 应该只调用一次，不重试
          expect(callCount).toBe(1);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("E103");
          }

          // 测试 4: 用户友好消息应该提示检查 API Key
          const userMessage = handler.getUserFriendlyMessage(authError);
          expect(userMessage).toContain("API Key");

          // 测试 5: 修复建议应该提示前往设置页面
          const fixSuggestion = handler.getFixSuggestion(authError);
          expect(fixSuggestion).toBeDefined();
          expect(fixSuggestion).toContain("设置");
          expect(fixSuggestion).toContain("API Key");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: cognitive-razor, Property 22: 速率限制退避**
   * **验证需求：10.2**
   * 
   * 属性：对于任意返回 429 速率限制错误的 API 调用，系统必须使用指数退避策略重试，
   * 每次重试的等待时间必须递增。
   */
  test("属性 22: 速率限制退避", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成任意错误消息
        fc.string({ minLength: 1, maxLength: 100 }),
        // 生成任意错误详情
        fc.record({
          status: fc.constant(429),
          errorData: fc.anything(),
        }),
        async (errorMessage, errorDetails) => {
          // 创建速率限制错误
          const rateLimitError = err("E102", errorMessage, errorDetails);

          // 测试 1: 速率限制错误应该被分类为可重试
          const classification = handler.classifyError(rateLimitError);
          expect(classification.category).toBe("API_ERROR");
          expect(classification.strategy).toBe("EXPONENTIAL_BACKOFF");
          expect(classification.retryable).toBe(true);

          // 测试 2: shouldRetry 应该返回 true（在未达到最大重试次数时）
          expect(handler.shouldRetry(rateLimitError, 1, 3)).toBe(true);
          expect(handler.shouldRetry(rateLimitError, 2, 3)).toBe(true);

          // 测试 3: 等待时间应该递增（指数退避）
          const waitTime1 = handler.calculateWaitTime(rateLimitError, 1);
          const waitTime2 = handler.calculateWaitTime(rateLimitError, 2);
          const waitTime3 = handler.calculateWaitTime(rateLimitError, 3);

          // 每次重试的等待时间应该递增
          expect(waitTime2).toBeGreaterThan(waitTime1);
          expect(waitTime3).toBeGreaterThan(waitTime2);

          // 等待时间应该符合指数退避公式
          // baseDelay * (multiplier ^ (attempt - 1))
          expect(waitTime1).toBe(1); // 1 * (2 ^ 0) = 1
          expect(waitTime2).toBe(2); // 1 * (2 ^ 1) = 2
          expect(waitTime3).toBe(4); // 1 * (2 ^ 2) = 4

          // 测试 4: 使用 withRetry 时应该重试
          let callCount = 0;
          const operation = async () => {
            callCount++;
            if (callCount < 3) {
              return rateLimitError;
            }
            return ok("success");
          };

          const result = await withRetry(operation, handler, 3);

          // 应该重试直到成功
          expect(callCount).toBe(3);
          expect(result.ok).toBe(true);

          // 测试 5: 用户友好消息应该提示速率限制
          const userMessage = handler.getUserFriendlyMessage(rateLimitError);
          expect(userMessage).toContain("速率限制");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: cognitive-razor, Property 20: 重试上限**
   * **验证需求：10.1, 10.4**
   * 
   * 属性：对于任意失败的任务，系统最多重试 3 次，第 3 次失败后必须将任务标记为 Failed 状态。
   */
  test("属性 20: 重试上限", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成任意可重试的错误码
        fc.constantFrom("E001", "E002", "E003", "E100", "E101", "E102"),
        // 生成任意错误消息
        fc.string({ minLength: 1, maxLength: 100 }),
        // 生成最大重试次数（1-5）
        fc.integer({ min: 1, max: 5 }),
        async (errorCode, errorMessage, maxAttempts) => {
          // 创建可重试的错误
          const retryableError = err(errorCode, errorMessage);

          // 测试 1: 错误应该被分类为可重试
          const classification = handler.classifyError(retryableError);
          expect(classification.retryable).toBe(true);

          // 测试 2: 使用 withRetry 时应该重试直到达到最大次数
          let callCount = 0;
          const operation = async () => {
            callCount++;
            return retryableError;
          };

          const result = await withRetry(operation, handler, maxAttempts);

          // 应该调用 maxAttempts 次
          expect(callCount).toBe(maxAttempts);

          // 最终应该失败
          expect(result.ok).toBe(false);

          // 错误消息应该包含重试次数
          if (!result.ok) {
            expect(result.error.message).toContain(`已重试 ${maxAttempts} 次`);
            
            // 错误详情应该包含完整的错误历史
            const errorHistory = (result.error.details as any)?.errorHistory;
            expect(errorHistory).toBeDefined();
            expect(errorHistory).toHaveLength(maxAttempts);

            // 每个错误记录应该有正确的尝试次数
            for (let i = 0; i < maxAttempts; i++) {
              expect(errorHistory[i].attempt).toBe(i + 1);
              expect(errorHistory[i].code).toBe(errorCode);
            }
          }

          // 测试 3: 达到最大重试次数后，shouldRetry 应该返回 false
          expect(handler.shouldRetry(retryableError, maxAttempts, maxAttempts)).toBe(false);
          expect(handler.shouldRetry(retryableError, maxAttempts + 1, maxAttempts)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 额外属性测试：解析错误应该使用结构化重试
   */
  test("解析错误应该使用结构化重试（不等待）", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成任意解析错误码
        fc.constantFrom("E001", "E002", "E003", "E004", "E005", "E006", "E007", "E008", "E009", "E010"),
        // 生成任意错误消息
        fc.string({ minLength: 1, maxLength: 100 }),
        async (errorCode, errorMessage) => {
          // 创建解析错误
          const parseError = err(errorCode, errorMessage);

          // 测试 1: 解析错误应该被分类为结构化重试
          const classification = handler.classifyError(parseError);
          expect(classification.category).toBe("PARSE_ERROR");
          expect(classification.strategy).toBe("STRUCTURED");
          expect(classification.retryable).toBe(true);

          // 测试 2: 等待时间应该为 0（不等待）
          expect(handler.calculateWaitTime(parseError, 1)).toBe(0);
          expect(handler.calculateWaitTime(parseError, 2)).toBe(0);
          expect(handler.calculateWaitTime(parseError, 3)).toBe(0);

          // 测试 3: 应该能够构建错误历史提示
          const taskError1 = handler.createTaskError(parseError, 1);
          const taskError2 = handler.createTaskError(parseError, 2);
          const errorHistory = [taskError1, taskError2];

          const historyPrompt = handler.buildErrorHistoryPrompt(errorHistory);
          expect(historyPrompt).toContain("错误历史");
          expect(historyPrompt).toContain(errorCode);
          expect(historyPrompt).toContain(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 额外属性测试：能力错误应该不重试
   */
  test("能力错误应该不重试", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成任意能力错误码
        fc.constantFrom("E200", "E201"),
        // 生成任意错误消息
        fc.string({ minLength: 1, maxLength: 100 }),
        async (errorCode, errorMessage) => {
          // 创建能力错误
          const capabilityError = err(errorCode, errorMessage);

          // 测试 1: 能力错误应该被分类为不可重试
          const classification = handler.classifyError(capabilityError);
          expect(classification.category).toBe("CAPABILITY_ERROR");
          expect(classification.strategy).toBe("NO_RETRY");
          expect(classification.retryable).toBe(false);

          // 测试 2: shouldRetry 应该返回 false
          expect(handler.shouldRetry(capabilityError, 1, 3)).toBe(false);

          // 测试 3: 使用 withRetry 时应该立即失败
          let callCount = 0;
          const operation = async () => {
            callCount++;
            return capabilityError;
          };

          const result = await withRetry(operation, handler, 3);

          // 应该只调用一次
          expect(callCount).toBe(1);
          expect(result.ok).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
