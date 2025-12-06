/**
 * ProviderManager - AI Provider 管理和 API 调用
 * 
 * 负责：
 * - 管理多个 AI Provider（Google Gemini、OpenAI、OpenRouter）
 * - 统一的聊天和嵌入接口
 * - Provider 能力检测
 * - API 调用和错误处理
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
// Google Gemini Provider
// ============================================================================

/**
 * Google Gemini Provider 实现
 */
class GoogleGeminiProvider implements IProvider {
  readonly id: string;
  readonly type: ProviderType = "google";
  readonly name = "Google Gemini";

  private apiKey: string;
  private baseUrl: string;

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  }

  async chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    try {
      // 转换消息格式为 Gemini 格式
      const contents = this.convertMessages(request.messages);

      const response = await fetch(
        `${this.baseUrl}/models/${request.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: request.temperature ?? 0.7,
              topP: request.topP ?? 0.95,
              maxOutputTokens: request.maxTokens ?? 2048,
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();

      // 提取生成的内容
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const finishReason = data.candidates?.[0]?.finishReason || "STOP";
      const tokensUsed = data.usageMetadata?.totalTokenCount;

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
      const response = await fetch(
        `${this.baseUrl}/models/${request.model}:embedContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: {
              parts: [{ text: request.input }],
            },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();
      const embedding = data.embedding?.values || [];

      return ok({
        embedding,
        tokensUsed: undefined, // Gemini 不返回 token 使用量
      });
    } catch (error) {
      return err("E100", `嵌入生成失败: ${getErrorMessage(error)}`, error);
    }
  }

  async checkCapabilities(): Promise<Result<ProviderCapabilities>> {
    try {
      // 尝试列出可用模型
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();
      const models = data.models?.map((m: any) => m.name.replace("models/", "")) || [];

      return ok({
        chat: true,
        embedding: true,
        maxContextLength: 32768, // Gemini 1.5 默认上下文长度
        models,
      });
    } catch (error) {
      return err("E100", `能力检测失败: ${getErrorMessage(error)}`, error);
    }
  }

  /**
   * 转换消息格式为 Gemini 格式
   */
  private convertMessages(messages: ChatRequest["messages"]) {
    const contents: any[] = [];
    let systemInstruction = "";

    for (const msg of messages) {
      if (msg.role === "system") {
        // Gemini 使用 systemInstruction 字段
        systemInstruction += msg.content + "\n";
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    return contents;
  }

  /**
   * 处理 API 错误
   */
  private handleError(status: number, errorData: any): Err {
    if (status === 401 || status === 403) {
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

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1";
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
      // 尝试列出可用模型
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return ok({
        chat: true,
        embedding: true,
        maxContextLength: 128000, // GPT-4 Turbo 默认上下文长度
        models,
      });
    } catch (error) {
      return err("E100", `能力检测失败: ${getErrorMessage(error)}`, error);
    }
  }

  /**
   * 处理 API 错误
   */
  private handleError(status: number, errorData: any): Err {
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
// OpenRouter Provider
// ============================================================================

/**
 * OpenRouter Provider 实现
 */
class OpenRouterProvider implements IProvider {
  readonly id: string;
  readonly type: ProviderType = "openrouter";
  readonly name = "OpenRouter";

  private apiKey: string;
  private baseUrl: string;

  constructor(id: string, config: ProviderConfig) {
    this.id = id;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";
  }

  async chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://github.com/obsidian-cognitive-razor",
          "X-Title": "Cognitive Razor",
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
    // OpenRouter 不直接支持嵌入，但可以通过特定模型实现
    // 这里返回不支持的错误
    return err(
      "E201",
      "OpenRouter 不支持嵌入功能，请使用 Google 或 OpenAI Provider",
      { providerId: this.id }
    );
  }

  async checkCapabilities(): Promise<Result<ProviderCapabilities>> {
    try {
      // 尝试列出可用模型
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return this.handleError(response.status, errorData);
      }

      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return ok({
        chat: true,
        embedding: false, // OpenRouter 不支持嵌入
        maxContextLength: 200000, // 取决于具体模型
        models,
      });
    } catch (error) {
      return err("E100", `能力检测失败: ${getErrorMessage(error)}`, error);
    }
  }

  /**
   * 处理 API 错误
   */
  private handleError(status: number, errorData: any): Err {
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
    let provider: IProvider;

    switch (config.type) {
      case "google":
        provider = new GoogleGeminiProvider(id, config);
        break;
      case "openai":
        provider = new OpenAIProvider(id, config);
        break;
      case "openrouter":
        provider = new OpenRouterProvider(id, config);
        break;
      default:
        throw new Error(`不支持的 Provider 类型: ${config.type}`);
    }

    this.providers.set(id, provider);
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
  }
}
