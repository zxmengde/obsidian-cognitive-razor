/**
 * ProviderManager 单元测试
 */

import { ProviderManager } from "./provider-manager";
import {
  ProviderConfig,
  ChatRequest,
  EmbedRequest,
} from "../types";

// Mock fetch
global.fetch = jest.fn();

describe("ProviderManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("构造函数", () => {
    it("应该初始化空的 Provider 列表", () => {
      const manager = new ProviderManager();
      expect(manager.getConfiguredProviders()).toEqual([]);
    });

    it("应该从配置初始化 Provider", () => {
      const configs: Record<string, ProviderConfig> = {
        google: {
          type: "google",
          apiKey: "test-key",
          defaultChatModel: "gemini-pro",
          defaultEmbedModel: "embedding-001",
          enabled: true,
        },
      };

      const manager = new ProviderManager(configs);
      const providers = manager.getConfiguredProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe("google");
      expect(providers[0].type).toBe("google");
      expect(providers[0].name).toBe("Google Gemini");
    });

    it("应该跳过未启用的 Provider", () => {
      const configs: Record<string, ProviderConfig> = {
        google: {
          type: "google",
          apiKey: "test-key",
          defaultChatModel: "gemini-pro",
          defaultEmbedModel: "embedding-001",
          enabled: false,
        },
      };

      const manager = new ProviderManager(configs);
      expect(manager.getConfiguredProviders()).toEqual([]);
    });
  });

  describe("setProvider", () => {
    it("应该添加 Google Provider", () => {
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "google",
        apiKey: "test-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config);
      const providers = manager.getConfiguredProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].type).toBe("google");
    });

    it("应该添加 OpenAI Provider", () => {
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "openai",
        apiKey: "test-key",
        defaultChatModel: "gpt-4",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: true,
      };

      manager.setProvider("openai", config);
      const providers = manager.getConfiguredProviders();

      expect(providers).toHaveLength(1);
      expect(providers[0].type).toBe("openai");
    });

    it("应该拒绝不支持的 Provider 类型", () => {
      const manager = new ProviderManager();
      const config: any = {
        type: "unsupported",
        apiKey: "test-key",
        defaultChatModel: "test-model",
        defaultEmbedModel: "test-embed",
        enabled: true,
      };

      expect(() => {
        manager.setProvider("unsupported", config);
      }).toThrow("不支持的 Provider 类型");
    });

    it("应该更新已存在的 Provider", () => {
      const manager = new ProviderManager();
      const config1: ProviderConfig = {
        type: "google",
        apiKey: "old-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config1);

      const config2: ProviderConfig = {
        type: "google",
        apiKey: "new-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config2);
      const providers = manager.getConfiguredProviders();

      expect(providers).toHaveLength(1);
    });
  });

  describe("removeProvider", () => {
    it("应该移除 Provider", () => {
      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "google",
        apiKey: "test-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config);
      expect(manager.getConfiguredProviders()).toHaveLength(1);

      manager.removeProvider("google");
      expect(manager.getConfiguredProviders()).toHaveLength(0);
    });
  });

  describe("chat", () => {
    it("应该返回错误当 Provider 不存在", async () => {
      const manager = new ProviderManager();
      const request: ChatRequest = {
        providerId: "nonexistent",
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await manager.chat(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E201");
      }
    });

    it("应该调用 Google Provider 的 chat 方法", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Hello, world!" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            totalTokenCount: 10,
          },
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "google",
        apiKey: "test-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config);

      const request: ChatRequest = {
        providerId: "google",
        model: "gemini-pro",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await manager.chat(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe("Hello, world!");
        expect(result.value.tokensUsed).toBe(10);
      }
    });

    it("应该调用 OpenAI Provider 的 chat 方法", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: "Hello from OpenAI!" },
              finish_reason: "stop",
            },
          ],
          usage: {
            total_tokens: 15,
          },
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "openai",
        apiKey: "test-key",
        defaultChatModel: "gpt-4",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: true,
      };

      manager.setProvider("openai", config);

      const request: ChatRequest = {
        providerId: "openai",
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      };

      const result = await manager.chat(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe("Hello from OpenAI!");
        expect(result.value.tokensUsed).toBe(15);
      }
    });
  });

  describe("embed", () => {
    it("应该返回错误当 Provider 不存在", async () => {
      const manager = new ProviderManager();
      const request: EmbedRequest = {
        providerId: "nonexistent",
        model: "test-model",
        input: "Hello",
      };

      const result = await manager.embed(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E201");
      }
    });

    it("应该调用 Google Provider 的 embed 方法", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          embedding: {
            values: [0.1, 0.2, 0.3],
          },
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "google",
        apiKey: "test-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config);

      const request: EmbedRequest = {
        providerId: "google",
        model: "embedding-001",
        input: "Hello",
      };

      const result = await manager.embed(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.embedding).toEqual([0.1, 0.2, 0.3]);
      }
    });

    it("应该调用 OpenAI Provider 的 embed 方法", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: [
            {
              embedding: [0.4, 0.5, 0.6],
            },
          ],
          usage: {
            total_tokens: 5,
          },
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "openai",
        apiKey: "test-key",
        defaultChatModel: "gpt-4",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: true,
      };

      manager.setProvider("openai", config);

      const request: EmbedRequest = {
        providerId: "openai",
        model: "text-embedding-3-small",
        input: "Hello",
      };

      const result = await manager.embed(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.embedding).toEqual([0.4, 0.5, 0.6]);
        expect(result.value.tokensUsed).toBe(5);
      }
    });


  });

  describe("checkAvailability", () => {
    it("应该返回错误当 Provider 不存在", async () => {
      const manager = new ProviderManager();
      const result = await manager.checkAvailability("nonexistent");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E201");
      }
    });

    it("应该检查 Google Provider 的能力", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          models: [
            { name: "models/gemini-pro" },
            { name: "models/gemini-pro-vision" },
          ],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "google",
        apiKey: "test-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config);

      const result = await manager.checkAvailability("google");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.chat).toBe(true);
        expect(result.value.embedding).toBe(true);
        expect(result.value.models).toContain("gemini-pro");
      }
    });

    it("应该处理认证错误", async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        json: async () => ({ error: "Invalid API key" }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "google",
        apiKey: "invalid-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      };

      manager.setProvider("google", config);

      const result = await manager.checkAvailability("google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E103");
      }
    });

    it("应该处理速率限制错误", async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        json: async () => ({ error: "Rate limit exceeded" }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const manager = new ProviderManager();
      const config: ProviderConfig = {
        type: "openai",
        apiKey: "test-key",
        defaultChatModel: "gpt-4",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: true,
      };

      manager.setProvider("openai", config);

      const result = await manager.checkAvailability("openai");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E102");
      }
    });
  });

  describe("getConfiguredProviders", () => {
    it("应该返回所有已配置的 Provider", () => {
      const manager = new ProviderManager();

      manager.setProvider("google", {
        type: "google",
        apiKey: "test-key-1",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      });

      manager.setProvider("openai", {
        type: "openai",
        apiKey: "test-key-2",
        defaultChatModel: "gpt-4",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: true,
      });

      const providers = manager.getConfiguredProviders();

      expect(providers).toHaveLength(2);
      expect(providers.map((p) => p.id)).toContain("google");
      expect(providers.map((p) => p.id)).toContain("openai");
    });
  });
});
