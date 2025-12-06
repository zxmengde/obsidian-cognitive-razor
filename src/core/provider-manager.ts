/**
 * ProviderManager - AI Provider 管理和 API 调用
 * 
 * 负责：
 * - 管理 AI Provider（OpenAI 标准格式，可通过自定义端点兼容其他服务）
 * - 统一的聊天和嵌入接口
 * - Provider 能力检测
 * - API 调用和错误处理
 * - 支持自定义 API 端点配置
 */

import {
  Result,
  ok,
  err,
  Err,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderInfo,
  ProviderCapabilities,
  ProviderConfig,
  ProviderType,
} from "../types";

/**
 * 获取错误消息
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// Provider 接口
// ============================================================================

/**
 * Provider 基础接口
 */
interface IProvider {
  /** Provider ID */
  readonly id: string;
  /** Provider 类型 */
  readonly type: ProviderType;
  /** Provider 名称 */
  readonly name: string;

  /**
   * 聊天接口
   */
  chat(request: ChatRequest): Promise<Result<ChatResponse>>;

  /**
   * 嵌入接口
   */
  embed(request: EmbedRequest): Promise<Result<EmbedResponse>>;

  /**
   * 检查可用性和能力
   */
  checkCapabilities(): Promise<Result<ProviderCapabilities>>;
}

// ============================================================================
// OpenAI Provider
// ============================================================================

/**
 * OpenAI Provider 实现
 */
class OpenAIProvider implements IProvider {
  readonly id: string;
  readonly type: ProviderType = "openai";
  readonly name = "OpenAI";

  private apiKey: string;
  private baseUrl: string;
  private defaultChatModel: string;

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
    // 2025年更新: 默认使用 gpt-4o，性价比最高的多模态模型
    this.defaultChatModel = config.defaultChatModel || "gpt-4o";
  }

  async chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.7,
          top_p: request.topP ?? 1.0,
          max_tokens: request.maxTokens ?? 2048,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      const finishReason = data.choices?.[0]?.finish_reason || "stop";
      const tokensUsed = data.usage?.total_tokens;

      return ok({
        content,
        finishReason,
        tokensUsed,
      });
    } catch (error) {
      return err("E100", `API 调用失败: ${getErrorMessage(error)}`, error);
    }
  }

  async embed(request: EmbedRequest): Promise<Result<EmbedResponse>> {
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          input: request.input,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();
      const embedding = data.data?.[0]?.embedding || [];
      const tokensUsed = data.usage?.total_tokens;

      return ok({
        embedding,
        tokensUsed,
      });
    } catch (error) {
      return err("E100", `嵌入生成失败: ${getErrorMessage(error)}`, error);
    }
  }

  async checkCapabilities(): Promise<Result<ProviderCapabilities>> {
    try {
      // 首先尝试列出可用模型（官方 API）
      const modelsResponse = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (modelsResponse.ok) {
        const data = await modelsResponse.json();
        const models = data.data?.map((m: { id: string }) => m.id) || [];

        return ok({
          chat: true,
          embedding: true,
          maxContextLength: 128000,
          models,
        });
      }

      // 如果 /models 端点不可用（第三方 API），尝试发送一个简单的测试请求
      console.log("OpenAI /models 端点不可用，尝试测试聊天请求...");
      
      const testResult = await this.chat({
        providerId: this.id,
        model: this.defaultChatModel,
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 10,
      });

      if (testResult.ok) {
        return ok({
          chat: true,
          embedding: true,
          maxContextLength: 128000,
          models: [], // 无法获取模型列表
        });
      }

      // 测试请求也失败了，保留原始错误码
      return err(
        testResult.error.code,
        `连接测试失败: ${testResult.error.message}`,
        testResult.error.details
      );
    } catch (error) {
      return err("E100", `能力检测失败: ${getErrorMessage(error)}`, error);
    }
  }

  /**
   * 处理 API 错误
   */
  private handleError(status: number, errorData: unknown): Err {
    if (status === 401) {
      return err("E103", "认证失败，请检查 API Key", { status, errorData });
    }
    if (status === 429) {
      return err("E102", "速率限制，请稍后重试", { status, errorData });
    }
    if (status >= 500) {
      return err("E100", `服务器错误 (${status})`, { status, errorData });
    }
    return err("E100", `API 错误 (${status})`, { status, errorData });
  }
}

// ============================================================================
// 默认端点配置
// ============================================================================

/**
 * 默认 API 端点配置
 */
export const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1",
};

// ============================================================================
// ProviderManager 主类
// ============================================================================

/**
 * ProviderManager 接口
 */
export interface IProviderManager {
  /**
   * 聊天接口
   */
  chat(request: ChatRequest): Promise<Result<ChatResponse>>;

  /**
   * 嵌入接口
   */
  embed(request: EmbedRequest): Promise<Result<EmbedResponse>>;

  /**
   * 检查 Provider 可用性
   */
  checkAvailability(providerId: string): Promise<Result<ProviderCapabilities>>;

  /**
   * 获取已配置的 Provider 列表
   */
  getConfiguredProviders(): ProviderInfo[];

  /**
   * 添加或更新 Provider
   */
  setProvider(id: string, config: ProviderConfig): void;

  /**
   * 移除 Provider
   */
  removeProvider(id: string): void;
}

/**
 * ProviderManager 实现
 */
export class ProviderManager implements IProviderManager {
  private providers: Map<string, IProvider> = new Map();

  constructor(configs: Record<string, ProviderConfig> = {}) {
    // 初始化所有配置的 Provider
    for (const [id, config] of Object.entries(configs)) {
      if (config.enabled) {
        this.setProvider(id, config);
      }
    }
  }

  async chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    const provider = this.providers.get(request.providerId);
    if (!provider) {
      return err(
        "E201",
        `Provider 未找到: ${request.providerId}`,
        { providerId: request.providerId }
      );
    }

    return provider.chat(request);
  }

  async embed(request: EmbedRequest): Promise<Result<EmbedResponse>> {
    const provider = this.providers.get(request.providerId);
    if (!provider) {
      return err(
        "E201",
        `Provider 未找到: ${request.providerId}`,
        { providerId: request.providerId }
      );
    }

    return provider.embed(request);
  }

  async checkAvailability(providerId: string): Promise<Result<ProviderCapabilities>> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return err(
        "E201",
        `Provider 未找到: ${providerId}`,
        { providerId }
      );
    }

    return provider.checkCapabilities();
  }

  getConfiguredProviders(): ProviderInfo[] {
    const providers: ProviderInfo[] = [];

    for (const [id, provider] of this.providers.entries()) {
      providers.push({
        id,
        type: provider.type,
        name: provider.name,
        configured: true,
        capabilities: undefined, // 需要异步调用 checkAvailability 获取
      });
    }

    return providers;
  }

  setProvider(id: string, config: ProviderConfig): void {
    if (config.type !== "openai") {
      throw new Error(`不支持的 Provider 类型: ${config.type}`);
    }

    const provider = new OpenAIProvider(id, config);
    this.providers.set(id, provider);
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
  }
}
