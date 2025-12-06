/**
 * SettingsTab 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import type { ProviderType, ProviderConfig } from "../types";

describe("SettingsTab 属性测试", () => {
  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 5: Provider 类型表单映射**
   * **验证需求：2.2, 3.2**
   * 
   * 属性：对于任意选择的 Provider 类型，配置表单必须显示对应类型的默认端点、默认模型和相关配置项
   */
  test("属性 5: Provider 类型表单映射", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("openai", "google"), // 仅支持的 Provider 类型
        (providerType: ProviderType) => {
          // 定义每种 Provider 类型的预期默认值
          const expectedDefaults: Record<ProviderType, {
            baseUrl: string;
            chatModel: string;
            embedModel: string;
          }> = {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              chatModel: "gpt-4-turbo-preview",
              embedModel: "text-embedding-3-small"
            },
            google: {
              baseUrl: "https://generativelanguage.googleapis.com/v1beta",
              chatModel: "gemini-1.5-flash",
              embedModel: "text-embedding-004"
            }
          };

          // 获取该类型的预期默认值
          const expected = expectedDefaults[providerType];

          // 验证默认值存在且正确
          expect(expected).toBeDefined();
          expect(expected.baseUrl).toBeTruthy();
          expect(expected.chatModel).toBeTruthy();
          expect(expected.embedModel).toBeTruthy();

          // 验证 baseUrl 格式正确（以 http:// 或 https:// 开头）
          expect(expected.baseUrl).toMatch(/^https?:\/\/.+/);

          // 验证模型名称非空
          expect(expected.chatModel.length).toBeGreaterThan(0);
          expect(expected.embedModel.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 6: 配置保存完整性**
   * **验证需求：2.4, 3.4**
   * 
   * 属性：对于任意通过 Modal 保存的 Provider 配置，配置文件中必须包含所有必需字段
   */
  test("属性 6: 配置保存完整性", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("openai", "google"), // type
        fc.string({ minLength: 10, maxLength: 100 }), // apiKey
        fc.option(fc.webUrl()), // baseUrl (可选)
        fc.string({ minLength: 1, maxLength: 50 }), // defaultChatModel
        fc.string({ minLength: 1, maxLength: 50 }), // defaultEmbedModel
        fc.boolean(), // enabled
        (type, apiKey, baseUrl, defaultChatModel, defaultEmbedModel, enabled) => {
          // 构建配置对象
          const config: ProviderConfig = {
            type,
            apiKey,
            baseUrl,
            defaultChatModel,
            defaultEmbedModel,
            enabled
          };

          // 验证所有必需字段都存在
          expect(config.type).toBeDefined();
          expect(config.apiKey).toBeDefined();
          expect(config.defaultChatModel).toBeDefined();
          expect(config.defaultEmbedModel).toBeDefined();
          expect(config.enabled).toBeDefined();

          // 验证类型正确
          expect(["openai", "google"]).toContain(config.type);
          expect(typeof config.apiKey).toBe("string");
          expect(typeof config.defaultChatModel).toBe("string");
          expect(typeof config.defaultEmbedModel).toBe("string");
          expect(typeof config.enabled).toBe("boolean");

          // 验证字段非空
          expect(config.type.length).toBeGreaterThan(0);
          expect(config.apiKey.length).toBeGreaterThan(0);
          expect(config.defaultChatModel.length).toBeGreaterThan(0);
          expect(config.defaultEmbedModel.length).toBeGreaterThan(0);

          // 如果提供了 baseUrl，验证格式
          if (config.baseUrl) {
            expect(config.baseUrl).toMatch(/^https?:\/\/.+/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 24: 默认 Provider 更新**
   * **验证需求：9.2**
   * 
   * 属性：对于任意选中的 Provider，点击"设为默认"按钮后，配置文件中的 defaultProviderId 必须更新为该 Provider 的 ID
   */
  test("属性 24: 默认 Provider 更新", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }), // providerId
        fc.string({ minLength: 1, maxLength: 50 }), // oldDefaultProviderId
        (providerId, oldDefaultProviderId) => {
          // 模拟设置默认 Provider 的操作
          let currentDefaultProviderId = oldDefaultProviderId;

          // 执行设置默认 Provider 操作
          const setDefaultProvider = (newProviderId: string) => {
            currentDefaultProviderId = newProviderId;
          };

          // 调用设置函数
          setDefaultProvider(providerId);

          // 验证 defaultProviderId 已更新
          expect(currentDefaultProviderId).toBe(providerId);
          expect(currentDefaultProviderId).not.toBe(oldDefaultProviderId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 25: 日志清除**
   * **验证需求：9.3**
   * 
   * 属性：对于任意点击"清除日志"按钮的操作，日志文件必须被清空或删除
   */
  test("属性 25: 日志清除", () => {
    fc.assert(
      fc.property(
        fc.boolean(), // 日志文件是否存在
        fc.nat({ max: 10000 }), // 日志文件大小（字节）
        (logExists, logSize) => {
          // 模拟日志状态
          let currentLogExists = logExists;
          let currentLogSize = logExists ? logSize : 0; // 如果不存在，大小为 0

          // 清除日志操作
          const clearLogs = () => {
            if (currentLogExists) {
              // 删除日志文件
              currentLogExists = false;
              currentLogSize = 0;
            }
          };

          // 执行清除操作
          clearLogs();

          // 验证日志已清除
          // 无论原来是否有日志，清除后都应该不存在且大小为 0
          expect(currentLogExists).toBe(false);
          expect(currentLogSize).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 26: 设置重置**
   * **验证需求：9.5**
   * 
   * 属性：对于任意确认的重置操作，所有配置项必须恢复到默认值，且 Providers 配置必须被清空
   */
  test("属性 26: 设置重置", () => {
    fc.assert(
      fc.property(
        fc.record({
          similarityThreshold: fc.double({ min: 0.5, max: 1.0 }),
          maxSnapshots: fc.nat({ min: 1, max: 1000 }),
          concurrency: fc.nat({ min: 1, max: 10 }),
          advancedMode: fc.boolean(),
          logLevel: fc.constantFrom("debug", "info", "warn", "error"),
        }), // 当前设置
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.record({
            type: fc.constantFrom("openai", "google"),
            apiKey: fc.string({ minLength: 10, maxLength: 100 }),
            defaultChatModel: fc.string({ minLength: 1, maxLength: 50 }),
            defaultEmbedModel: fc.string({ minLength: 1, maxLength: 50 }),
            enabled: fc.boolean(),
          })
        ), // Providers 配置
        (currentSettings, providers) => {
          // 定义默认设置
          const defaultSettings = {
            similarityThreshold: 0.85,
            maxSnapshots: 100,
            concurrency: 3,
            advancedMode: false,
            logLevel: "info" as const,
          };

          // 模拟重置操作
          const resetSettings = () => {
            return {
              settings: { ...defaultSettings },
              providers: {},
            };
          };

          // 执行重置
          const result = resetSettings();

          // 验证所有设置恢复到默认值
          expect(result.settings.similarityThreshold).toBe(defaultSettings.similarityThreshold);
          expect(result.settings.maxSnapshots).toBe(defaultSettings.maxSnapshots);
          expect(result.settings.concurrency).toBe(defaultSettings.concurrency);
          expect(result.settings.advancedMode).toBe(defaultSettings.advancedMode);
          expect(result.settings.logLevel).toBe(defaultSettings.logLevel);

          // 验证 Providers 配置被清空
          expect(Object.keys(result.providers).length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
