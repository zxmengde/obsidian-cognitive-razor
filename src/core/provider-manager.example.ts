/**
 * ProviderManager 使用示例
 * 
 * 这个文件展示了如何使用 ProviderManager 来管理和调用 AI Provider
 */

import { ProviderManager } from "./provider-manager";
import { ProviderConfig } from "../types";

// ============================================================================
// 示例 1: 初始化 ProviderManager
// ============================================================================

async function example1_initialization() {
  // 方式 1: 空初始化
  const manager1 = new ProviderManager();

  // 方式 2: 从配置初始化
  const configs: Record<string, ProviderConfig> = {
    google: {
      type: "google",
      apiKey: "your-google-api-key",
      defaultChatModel: "gemini-pro",
      defaultEmbedModel: "embedding-001",
      enabled: true,
    },
    openai: {
      type: "openai",
      apiKey: "your-openai-api-key",
      defaultChatModel: "gpt-4",
      defaultEmbedModel: "text-embedding-3-small",
      enabled: true,
    },
  };

  const manager2 = new ProviderManager(configs);

  console.log("已配置的 Provider:", manager2.getConfiguredProviders());
}

// ============================================================================
// 示例 2: 添加和管理 Provider
// ============================================================================

async function example2_manageProviders() {
  const manager = new ProviderManager();

  // 添加 Google Provider
  manager.setProvider("google", {
    type: "google",
    apiKey: "your-google-api-key",
    defaultChatModel: "gemini-pro",
    defaultEmbedModel: "embedding-001",
    enabled: true,
  });

  // 添加 OpenAI Provider
  manager.setProvider("openai", {
    type: "openai",
    apiKey: "your-openai-api-key",
    defaultChatModel: "gpt-4",
    defaultEmbedModel: "text-embedding-3-small",
    enabled: true,
  });

  // 查看所有 Provider
  const providers = manager.getConfiguredProviders();
  console.log("所有 Provider:", providers);

  // 移除 Provider（如果需要）
  // manager.removeProvider("google");
}

// ============================================================================
// 示例 3: 验证 Provider 可用性
// ============================================================================

async function example3_checkAvailability() {
  const manager = new ProviderManager();

  manager.setProvider("google", {
    type: "google",
    apiKey: "your-google-api-key",
    defaultChatModel: "gemini-pro",
    defaultEmbedModel: "embedding-001",
    enabled: true,
  });

  // 检查 Provider 可用性
  const result = await manager.checkAvailability("google");

  if (result.ok) {
    console.log("Provider 可用");
    console.log("支持聊天:", result.value.chat);
    console.log("支持嵌入:", result.value.embedding);
    console.log("最大上下文长度:", result.value.maxContextLength);
    console.log("可用模型:", result.value.models);
  } else {
    console.error("Provider 不可用:", result.error.message);
    
    // 根据错误码处理
    if (result.error.code === "E103") {
      console.error("请检查 API Key 是否正确");
    } else if (result.error.code === "E102") {
      console.error("速率限制，请稍后重试");
    }
  }
}

// ============================================================================
// 示例 4: 使用聊天功能
// ============================================================================

async function example4_chat() {
  const manager = new ProviderManager();

  manager.setProvider("google", {
    type: "google",
    apiKey: "your-google-api-key",
    defaultChatModel: "gemini-pro",
    defaultEmbedModel: "embedding-001",
    enabled: true,
  });

  // 发送聊天请求
  const result = await manager.chat({
    providerId: "google",
    model: "gemini-pro",
    messages: [
      {
        role: "system",
        content: "你是一个知识管理助手",
      },
      {
        role: "user",
        content: "什么是公理化设计？",
      },
    ],
    temperature: 0.7,
    maxTokens: 1000,
  });

  if (result.ok) {
    console.log("AI 回复:", result.value.content);
    console.log("使用 token:", result.value.tokensUsed);
  } else {
    console.error("聊天失败:", result.error.message);
  }
}

// ============================================================================
// 示例 5: 使用嵌入功能
// ============================================================================

async function example5_embed() {
  const manager = new ProviderManager();

  manager.setProvider("openai", {
    type: "openai",
    apiKey: "your-openai-api-key",
    defaultChatModel: "gpt-4",
    defaultEmbedModel: "text-embedding-3-small",
    enabled: true,
  });

  // 生成嵌入向量
  const result = await manager.embed({
    providerId: "openai",
    model: "text-embedding-3-small",
    input: "公理化设计是一种系统化的设计方法论",
  });

  if (result.ok) {
    console.log("嵌入向量维度:", result.value.embedding.length);
    console.log("前 5 个值:", result.value.embedding.slice(0, 5));
    console.log("使用 token:", result.value.tokensUsed);
  } else {
    console.error("嵌入生成失败:", result.error.message);
  }
}

// ============================================================================
// 示例 6: 错误处理
// ============================================================================

async function example6_errorHandling() {
  const manager = new ProviderManager();

  manager.setProvider("google", {
    type: "google",
    apiKey: "invalid-key",
    defaultChatModel: "gemini-pro",
    defaultEmbedModel: "embedding-001",
    enabled: true,
  });

  const result = await manager.chat({
    providerId: "google",
    model: "gemini-pro",
    messages: [{ role: "user", content: "Hello" }],
  });

  if (!result.ok) {
    // 根据错误码进行不同处理
    switch (result.error.code) {
      case "E103":
        console.error("认证失败，请检查 API Key");
        // 提示用户重新配置
        break;
      case "E102":
        console.error("速率限制，将在稍后重试");
        // 实现指数退避重试
        break;
      case "E100":
        console.error("API 调用失败:", result.error.message);
        // 记录错误日志
        break;
      case "E201":
        console.error("Provider 能力不足:", result.error.message);
        // 提示用户更换 Provider
        break;
      default:
        console.error("未知错误:", result.error);
    }
  }
}

// ============================================================================
// 示例 7: 在插件中集成
// ============================================================================

async function example7_pluginIntegration() {
  // 假设从插件设置中加载配置
  const settings = {
    providers: {
      google: {
        type: "google" as const,
        apiKey: "your-google-api-key",
        defaultChatModel: "gemini-pro",
        defaultEmbedModel: "embedding-001",
        enabled: true,
      },
      openai: {
        type: "openai" as const,
        apiKey: "your-openai-api-key",
        defaultChatModel: "gpt-4",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: false, // 未启用
      },
    },
    defaultProviderId: "google",
  };

  // 初始化 ProviderManager
  const manager = new ProviderManager(settings.providers);

  // 使用默认 Provider
  const defaultProvider = settings.providers[settings.defaultProviderId as keyof typeof settings.providers];
  const result = await manager.chat({
    providerId: settings.defaultProviderId,
    model: defaultProvider?.defaultChatModel || "gemini-1.5-flash",
    messages: [{ role: "user", content: "Hello" }],
  });

  if (result.ok) {
    console.log("回复:", result.value.content);
  }
}

// 导出示例函数
export {
  example1_initialization,
  example2_manageProviders,
  example3_checkAvailability,
  example4_chat,
  example5_embed,
  example6_errorHandling,
  example7_pluginIntegration,
};
