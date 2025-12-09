/**
 * ProviderManager 属性测试
 * 
 * 使用 fast-check 进行属性测试，验证 API 调用日志功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { ProviderManager } from "./provider-manager";
import { ISettingsStore, ILogger, PluginSettings, ProviderConfig, LogLevel } from "../types";

// 创建模拟的 SettingsStore
const createMockSettingsStore = (providers: Record<string, ProviderConfig> = {}): ISettingsStore => {
  const settings: PluginSettings = {
    version: "1.0.0",
    language: "zh",
    advancedMode: false,
    providers,
    defaultProviderId: Object.keys(providers)[0] || "",
    similarityThreshold: 0.9,
    topK: 10,
    concurrency: 1,
    autoRetry: true,
    maxRetryAttempts: 3,
    maxSnapshots: 100,
    maxSnapshotAgeDays: 30,
    enableGrounding: false,
    taskModels: {} as PluginSettings["taskModels"],
    logLevel: "debug" as LogLevel
  };

  return {
    getSettings: () => settings,
    updateSettings: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    loadSettings: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    saveSettings: vi.fn().mockResolvedValue({ ok: true, value: undefined })
  };
};

// 创建模拟的 Logger，记录所有日志调用
interface LogCall {
  level: string;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

const createMockLogger = (): ILogger & { calls: LogCall[] } => {
  const calls: LogCall[] = [];
  
  return {
    calls,
    debug: vi.fn((module: string, message: string, context?: Record<string, unknown>) => {
      calls.push({ level: "debug", module, message, context });
    }),
    info: vi.fn((module: string, message: string, context?: Record<string, unknown>) => {
      calls.push({ level: "info", module, message, context });
    }),
    warn: vi.fn((module: string, message: string, context?: Record<string, unknown>) => {
      calls.push({ level: "warn", module, message, context });
    }),
    error: vi.fn((module: string, message: string, error?: Error, context?: Record<string, unknown>) => {
      calls.push({ level: "error", module, message, context });
    }),
    errorWithCode: vi.fn(),
    withTiming: vi.fn(),
    timing: vi.fn(),
    setLogLevel: vi.fn(),
    getLogLevel: vi.fn(() => "debug" as LogLevel)
  };
};

// 生成有效的 Provider ID
const providerIdArb = fc.string({ minLength: 1, maxLength: 20 })
  .filter(s => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s));

// 生成有效的模型名称
const modelNameArb = fc.constantFrom("gpt-4o", "gpt-4o-mini", "text-embedding-3-small");

// 生成有效的消息内容
const messageContentArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

describe("ProviderManager API Call Logging", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * **Feature: bug-fixes-v1, Property 12: API Call Logging**
   * **Validates: Requirements 8.3**
   * 
   * *For any* API call made by ProviderManager, a corresponding log entry 
   * SHALL exist at debug level containing request details.
   */
  it("Property 12: API Call Logging - chat requests are logged with request details", async () => {
    await fc.assert(
      fc.asyncProperty(
        providerIdArb,
        modelNameArb,
        messageContentArb,
        async (providerId, model, content) => {
          // 模拟 fetch 返回成功响应
          global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              choices: [{ message: { content: "response" }, finish_reason: "stop" }],
              usage: { total_tokens: 100 }
            })
          });

          const mockLogger = createMockLogger();
          const mockSettingsStore = createMockSettingsStore({
            [providerId]: {
              type: "openai",
              apiKey: "test-key",
              enabled: true
            }
          });

          const providerManager = new ProviderManager(mockSettingsStore, mockLogger);

          // 执行 chat 请求
          await providerManager.chat({
            providerId,
            model,
            messages: [{ role: "user", content }]
          });

          // 验证存在 API_REQUEST 日志
          const requestLogs = mockLogger.calls.filter(
            call => call.level === "debug" && 
                    call.context?.event === "API_REQUEST"
          );
          
          expect(requestLogs.length).toBeGreaterThanOrEqual(1);
          
          // 验证请求日志包含必要的详情
          const requestLog = requestLogs[0];
          expect(requestLog.context).toHaveProperty("providerId", providerId);
          expect(requestLog.context).toHaveProperty("model", model);
          expect(requestLog.context).toHaveProperty("url");
          expect(requestLog.context).toHaveProperty("messageCount");
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * **Feature: bug-fixes-v1, Property 12: API Call Logging**
   * **Validates: Requirements 8.3**
   * 
   * 验证 embed 请求也会被记录日志
   */
  it("Property 12: API Call Logging - embed requests are logged with request details", async () => {
    await fc.assert(
      fc.asyncProperty(
        providerIdArb,
        messageContentArb,
        async (providerId, input) => {
          // 模拟 fetch 返回成功响应
          global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              data: [{ embedding: new Array(1536).fill(0.1) }],
              usage: { total_tokens: 50 }
            })
          });

          const mockLogger = createMockLogger();
          const mockSettingsStore = createMockSettingsStore({
            [providerId]: {
              type: "openai",
              apiKey: "test-key",
              enabled: true
            }
          });

          const providerManager = new ProviderManager(mockSettingsStore, mockLogger);

          // 执行 embed 请求
          await providerManager.embed({
            providerId,
            model: "text-embedding-3-small",
            input
          });

          // 验证存在 API_REQUEST 日志
          const requestLogs = mockLogger.calls.filter(
            call => call.level === "debug" && 
                    call.context?.event === "API_REQUEST"
          );
          
          expect(requestLogs.length).toBeGreaterThanOrEqual(1);
          
          // 验证请求日志包含必要的详情
          const requestLog = requestLogs[0];
          expect(requestLog.context).toHaveProperty("providerId", providerId);
          expect(requestLog.context).toHaveProperty("model", "text-embedding-3-small");
          expect(requestLog.context).toHaveProperty("url");
          expect(requestLog.context).toHaveProperty("inputLength");
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * 验证 API 响应也会被记录日志
   */
  it("Property 12 (corollary): API responses are logged", async () => {
    await fc.assert(
      fc.asyncProperty(
        providerIdArb,
        modelNameArb,
        async (providerId, model) => {
          // 模拟 fetch 返回成功响应
          global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              choices: [{ message: { content: "response" }, finish_reason: "stop" }],
              usage: { total_tokens: 100 }
            })
          });

          const mockLogger = createMockLogger();
          const mockSettingsStore = createMockSettingsStore({
            [providerId]: {
              type: "openai",
              apiKey: "test-key",
              enabled: true
            }
          });

          const providerManager = new ProviderManager(mockSettingsStore, mockLogger);

          // 执行 chat 请求
          await providerManager.chat({
            providerId,
            model,
            messages: [{ role: "user", content: "test" }]
          });

          // 验证存在 API_RESPONSE 日志
          const responseLogs = mockLogger.calls.filter(
            call => call.level === "info" && 
                    call.context?.event === "API_RESPONSE"
          );
          
          expect(responseLogs.length).toBeGreaterThanOrEqual(1);
          
          // 验证响应日志包含必要的详情
          const responseLog = responseLogs[0];
          expect(responseLog.context).toHaveProperty("providerId", providerId);
          expect(responseLog.context).toHaveProperty("model", model);
          expect(responseLog.context).toHaveProperty("tokensUsed");
          expect(responseLog.context).toHaveProperty("elapsedTime");
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * 验证 API 错误也会被记录日志
   */
  it("Property 12 (corollary): API errors are logged", async () => {
    await fc.assert(
      fc.asyncProperty(
        providerIdArb,
        modelNameArb,
        async (providerId, model) => {
          // 模拟 fetch 返回错误响应
          global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve('{"error":{"message":"Invalid API key"}}')
          });

          const mockLogger = createMockLogger();
          const mockSettingsStore = createMockSettingsStore({
            [providerId]: {
              type: "openai",
              apiKey: "invalid-key",
              enabled: true
            }
          });

          const providerManager = new ProviderManager(mockSettingsStore, mockLogger);

          // 执行 chat 请求（预期失败）
          await providerManager.chat({
            providerId,
            model,
            messages: [{ role: "user", content: "test" }]
          });

          // 验证存在 API_ERROR 日志
          const errorLogs = mockLogger.calls.filter(
            call => call.level === "error" && 
                    call.context?.event === "API_ERROR"
          );
          
          expect(errorLogs.length).toBeGreaterThanOrEqual(1);
          
          // 验证错误日志包含必要的详情
          const errorLog = errorLogs[0];
          expect(errorLog.context).toHaveProperty("providerId", providerId);
          expect(errorLog.context).toHaveProperty("model", model);
          expect(errorLog.context).toHaveProperty("errorCode");
          expect(errorLog.context).toHaveProperty("errorMessage");
        }
      ),
      { numRuns: 20 }
    );
  });
});
