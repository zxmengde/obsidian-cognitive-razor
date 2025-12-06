/**
 * RetryHandler 使用示例
 * 
 * 展示如何在实际场景中使用 RetryHandler 和 withRetry
 */

import { RetryHandler, withRetry } from "./retry-handler";
import { Result, ok, err } from "../types";

// ============================================================================
// 示例 1: 基本使用 - 带重试的 API 调用
// ============================================================================

async function fetchDataWithRetry(url: string): Promise<Result<any>> {
  const handler = new RetryHandler();

  return withRetry(
    async (attempt, errorHistory) => {
      console.log(`尝试 ${attempt}...`);

      try {
        const response = await fetch(url);

        if (!response.ok) {
          // 根据 HTTP 状态码返回相应的错误
          if (response.status === 401) {
            return err("E103", "认证失败", { status: response.status });
          }
          if (response.status === 429) {
            return err("E102", "速率限制", { status: response.status });
          }
          if (response.status >= 500) {
            return err("E100", "服务器错误", { status: response.status });
          }
          return err("E100", `HTTP 错误 ${response.status}`, { status: response.status });
        }

        const data = await response.json();
        return ok(data);
      } catch (error) {
        return err("E101", "网络错误", { error });
      }
    },
    handler,
    3 // 最多重试 3 次
  );
}

// ============================================================================
// 示例 2: 结构化重试 - AI 输出解析
// ============================================================================

async function parseAIOutputWithRetry(
  rawOutput: string,
  schema: any
): Promise<Result<any>> {
  const handler = new RetryHandler();

  return withRetry(
    async (attempt, errorHistory) => {
      console.log(`解析尝试 ${attempt}...`);

      // 如果有错误历史，构建提示
      const errorPrompt = handler.buildErrorHistoryPrompt(errorHistory);

      try {
        // 尝试解析 JSON
        const parsed = JSON.parse(rawOutput);

        // 验证 Schema
        if (!validateSchema(parsed, schema)) {
          return err("E002", "Schema 验证失败", { parsed, schema });
        }

        return ok(parsed);
      } catch (error) {
        return err("E001", "JSON 解析失败", { error, rawOutput });
      }
    },
    handler,
    3
  );
}

function validateSchema(data: any, schema: any): boolean {
  // 简化的 Schema 验证
  return true;
}

// ============================================================================
// 示例 3: 自定义重试配置
// ============================================================================

async function customRetryExample(): Promise<Result<string>> {
  // 自定义重试配置
  const handler = new RetryHandler({
    maxAttempts: 5,           // 最多重试 5 次
    baseDelay: 1000,          // 基础延迟 1 秒
    maxDelay: 30000,          // 最大延迟 30 秒
    backoffMultiplier: 2,     // 指数倍数 2
  });

  return withRetry(
    async (attempt) => {
      console.log(`自定义重试尝试 ${attempt}...`);

      // 模拟可能失败的操作
      if (Math.random() < 0.7) {
        return err("E100", "随机失败");
      }

      return ok("成功！");
    },
    handler,
    5
  );
}

// ============================================================================
// 示例 4: 错误分类和处理
// ============================================================================

async function handleErrorExample() {
  const handler = new RetryHandler();

  const result = await withRetry(
    async () => {
      // 模拟 API 调用
      return err("E103", "认证失败", { status: 401 });
    },
    handler,
    3
  );

  if (!result.ok) {
    const error = result;

    // 分类错误
    const classification = handler.classifyError(error);
    console.log("错误类别:", classification.category);
    console.log("重试策略:", classification.strategy);
    console.log("是否可重试:", classification.retryable);

    // 获取用户友好消息
    const userMessage = handler.getUserFriendlyMessage(error);
    console.log("用户消息:", userMessage);

    // 获取修复建议
    const fixSuggestion = handler.getFixSuggestion(error);
    if (fixSuggestion) {
      console.log("修复建议:", fixSuggestion);
    }
  }
}

// ============================================================================
// 示例 5: 在 TaskRunner 中使用
// ============================================================================

interface Task {
  id: string;
  operation: () => Promise<Result<any>>;
}

async function executeTaskWithRetry(task: Task): Promise<Result<any>> {
  const handler = new RetryHandler();

  return withRetry(
    async (attempt, errorHistory) => {
      console.log(`执行任务 ${task.id}，尝试 ${attempt}...`);

      // 执行任务操作
      const result = await task.operation();

      // 如果失败，记录错误
      if (!result.ok) {
        console.log(`任务 ${task.id} 失败:`, result.error.message);

        // 如果有错误历史，可以用于调整策略
        if (errorHistory.length > 0) {
          console.log(`之前的错误:`, errorHistory);
        }
      }

      return result;
    },
    handler,
    3
  );
}

// ============================================================================
// 运行示例
// ============================================================================

async function runExamples() {
  console.log("=== 示例 1: 带重试的 API 调用 ===");
  // const result1 = await fetchDataWithRetry("https://api.example.com/data");
  // console.log("结果:", result1);

  console.log("\n=== 示例 2: 结构化重试 - AI 输出解析 ===");
  // const result2 = await parseAIOutputWithRetry('{"key": "value"}', {});
  // console.log("结果:", result2);

  console.log("\n=== 示例 3: 自定义重试配置 ===");
  // const result3 = await customRetryExample();
  // console.log("结果:", result3);

  console.log("\n=== 示例 4: 错误分类和处理 ===");
  await handleErrorExample();

  console.log("\n=== 示例 5: 在 TaskRunner 中使用 ===");
  const task: Task = {
    id: "task-123",
    operation: async () => ok("任务完成"),
  };
  const result5 = await executeTaskWithRetry(task);
  console.log("结果:", result5);
}

// 如果直接运行此文件
if (require.main === module) {
  runExamples().catch(console.error);
}
