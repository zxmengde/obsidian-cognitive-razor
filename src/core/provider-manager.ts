/**
 * Provider 管理器
 * 负责与 AI 服务提供商交互，支持 OpenAI 标准格式
 * 
 * 遵循设计文档 Requirements 3.1：
 * - 使用 OpenAI 标准格式
 * - 支持自定义 baseUrl（兼容 OpenRouter、Azure 等）
 * - 错误处理委托给 RetryHandler
 */

import {
  IProviderManager,
  ILogger,
  ISettingsStore,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderCapabilities,
  ProviderInfo,
  ProviderConfig,
  Result,
  ok,
  err,
  DEFAULT_ENDPOINTS,
  Err
} from "../types";
import { RetryHandler, NETWORK_ERROR_CONFIG } from "./retry-handler";

/**
 * OpenAI API 响应格式
 */
interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIEmbedResponse {
  data: Array<{
    embedding: number[];
  }>;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * HTTP 错误响应
 */
interface HttpErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/**
 * Provider 可用性缓存条目
 */
interface AvailabilityCacheEntry {
  capabilities: ProviderCapabilities;
  timestamp: number;
}

/**
 * ProviderManager - AI 服务提供商管理器
 * 
 * 实现设计文档 section 7.4 定义的 IProviderManager 接口
 * 
 * 特性：
 * - 使用 OpenAI 标准格式调用 API
 * - 支持自定义 baseUrl（兼容 OpenRouter、Azure、本地模型等）
 * - 错误处理委托给 RetryHandler
 * - 支持聊天和嵌入两种 API
 * - 可用性检查缓存（避免频繁网络请求，遵循 G-08 本地优先）
 */
export class ProviderManager implements IProviderManager {
  private settingsStore: ISettingsStore;
  private logger: ILogger;
  private retryHandler: RetryHandler;
  private networkListeners: Array<(online: boolean, error?: Err) => void>;
  private isOffline = false;
  
  // 可用性缓存（遵循 G-08 本地优先，A-NF-01 性能界限）
  private availabilityCache: Map<string, AvailabilityCacheEntry>;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存

  constructor(settingsStore: ISettingsStore, logger: ILogger, retryHandler?: RetryHandler) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.retryHandler = retryHandler || new RetryHandler(logger);
    this.networkListeners = [];
    this.availabilityCache = new Map();

    this.logger.debug("ProviderManager", "ProviderManager 初始化完成");
  }

  /**
   * 清除可用性缓存
   * 用于设置页面"测试连接"时强制刷新
   */
  clearAvailabilityCache(providerId?: string): void {
    if (providerId) {
      this.availabilityCache.delete(providerId);
      this.logger.debug("ProviderManager", `已清除 Provider ${providerId} 的可用性缓存`);
    } else {
      this.availabilityCache.clear();
      this.logger.debug("ProviderManager", "已清除所有 Provider 可用性缓存");
    }
  }

  /**
   * 调用聊天 API
   * 
   * 使用 OpenAI 标准格式：POST /chat/completions
   * 支持自定义 baseUrl
   * 错误处理委托给 RetryHandler
   * 
   * @param request 聊天请求
   * @returns 聊天响应
   */
  async chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    const startTime = Date.now();
    
    // 验证 Provider 配置
    const configResult = this.getProviderConfig(request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS[providerConfig.type];
    const url = `${baseUrl}/chat/completions`;

    // 构建请求体（OpenAI 标准格式）
    const requestBody = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 1.0,
      max_tokens: request.maxTokens
    };

    this.logger.debug("ProviderManager", "发送聊天请求", {
      event: "API_REQUEST",
      providerId: request.providerId,
      model: request.model,
      url,
      messageCount: request.messages.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.retryHandler.executeWithRetry(
      async () => this.executeChatRequest(url, requestBody, providerConfig.apiKey),
      {
        ...NETWORK_ERROR_CONFIG,
        onRetry: (attempt, error) => {
          this.logger.warn("ProviderManager", `聊天请求重试 ${attempt}`, {
            event: "API_RETRY",
            providerId: request.providerId,
            errorCode: error.code,
            errorMessage: error.message
          });
        }
      }
    );

    const elapsedTime = Date.now() - startTime;

    if (result.ok) {
      this.notifyNetworkStatus(true);
      this.logger.info("ProviderManager", "聊天请求成功", {
        event: "API_RESPONSE",
        providerId: request.providerId,
        model: request.model,
        tokensUsed: result.value.tokensUsed,
        elapsedTime
      });
    } else {
      if (result.error.code === "E102") {
        this.notifyNetworkStatus(false, result as Err);
      } else {
        this.notifyNetworkStatus(true);
      }
      this.logger.error("ProviderManager", "聊天请求失败", undefined, {
        event: "API_ERROR",
        providerId: request.providerId,
        model: request.model,
        errorCode: result.error.code,
        errorMessage: result.error.message,
        elapsedTime
      });
    }

    return result;
  }

  /**
   * 调用嵌入 API
   * 
   * 使用 OpenAI 标准格式：POST /embeddings
   * 支持自定义 baseUrl
   * 错误处理委托给 RetryHandler
   * 
   * @param request 嵌入请求
   * @returns 嵌入响应
   */
  async embed(request: EmbedRequest): Promise<Result<EmbedResponse>> {
    const startTime = Date.now();
    
    // 验证 Provider 配置
    const configResult = this.getProviderConfig(request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS[providerConfig.type];
    const url = `${baseUrl}/embeddings`;

    // 构建请求体（OpenAI 标准格式）
    const requestBody = {
      model: request.model,
      input: request.input
    };

    this.logger.debug("ProviderManager", "发送嵌入请求", {
      event: "API_REQUEST",
      providerId: request.providerId,
      model: request.model,
      url,
      inputLength: request.input.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.retryHandler.executeWithRetry(
      async () => this.executeEmbedRequest(url, requestBody, providerConfig.apiKey),
      {
        ...NETWORK_ERROR_CONFIG,
        onRetry: (attempt, error) => {
          this.logger.warn("ProviderManager", `嵌入请求重试 ${attempt}`, {
            event: "API_RETRY",
            providerId: request.providerId,
            errorCode: error.code,
            errorMessage: error.message
          });
        }
      }
    );

    const elapsedTime = Date.now() - startTime;

    if (result.ok) {
      this.notifyNetworkStatus(true);
      this.logger.info("ProviderManager", "嵌入请求成功", {
        event: "API_RESPONSE",
        providerId: request.providerId,
        model: request.model,
        tokensUsed: result.value.tokensUsed,
        dimension: result.value.embedding.length,
        elapsedTime
      });
    } else {
      if (result.error.code === "E102") {
        this.notifyNetworkStatus(false, result as Err);
      } else {
        this.notifyNetworkStatus(true);
      }
      this.logger.error("ProviderManager", "嵌入请求失败", undefined, {
        event: "API_ERROR",
        providerId: request.providerId,
        model: request.model,
        errorCode: result.error.code,
        errorMessage: result.error.message,
        elapsedTime
      });
    }

    return result;
  }

  /**
   * 检查 Provider 可用性
   * 
   * 通过调用 /models 端点验证 API Key 和连接
   * 使用缓存避免频繁网络请求（遵循 G-08 本地优先，A-NF-01 性能界限）
   * 
   * @param providerId Provider ID
   * @param forceRefresh 是否强制刷新（用于设置页面"测试连接"）
   * @returns Provider 能力信息
   */
  async checkAvailability(providerId: string, forceRefresh = false): Promise<Result<ProviderCapabilities>> {
    // 检查缓存（除非强制刷新）
    if (!forceRefresh) {
      const cached = this.availabilityCache.get(providerId);
      if (cached && Date.now() - cached.timestamp < ProviderManager.CACHE_TTL_MS) {
        this.logger.debug("ProviderManager", "使用缓存的可用性信息", {
          event: "AVAILABILITY_CACHE_HIT",
          providerId,
          cacheAge: Date.now() - cached.timestamp
        });
        return ok(cached.capabilities);
      }
    }

    // 验证 Provider 配置
    const configResult = this.getProviderConfig(providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS[providerConfig.type];
    const url = `${baseUrl}/models`;

    this.logger.debug("ProviderManager", "检查 Provider 可用性", {
      event: "AVAILABILITY_CHECK",
      providerId,
      url,
      forceRefresh
    });

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${providerConfig.apiKey}`
        }
      });

      if (!response.ok) {
        const errorResult = this.mapHttpError(response.status, await this.safeReadText(response));
        
        // errorResult 是 Err 类型，安全访问 error 属性
        const errorCode = !errorResult.ok ? errorResult.error.code : 'UNKNOWN';
        
        this.logger.error("ProviderManager", "Provider 不可用", undefined, {
          event: "AVAILABILITY_ERROR",
          providerId,
          status: response.status,
          errorCode
        });

        // 清除缓存
        this.availabilityCache.delete(providerId);

        return errorResult;
      }

      const data = await response.json();

      // 构建能力信息
      const capabilities: ProviderCapabilities = {
        chat: true,
        embedding: true,
        maxContextLength: 128000, // 默认值
        models: data.data?.map((m: { id: string }) => m.id) || []
      };

      // 更新缓存
      this.availabilityCache.set(providerId, {
        capabilities,
        timestamp: Date.now()
      });

      this.notifyNetworkStatus(true);
      this.logger.info("ProviderManager", "Provider 可用", {
        event: "AVAILABILITY_SUCCESS",
        providerId,
        modelCount: capabilities.models.length
      });

      return ok(capabilities);
    } catch (error) {
      this.logger.error("ProviderManager", "检查 Provider 可用性失败", error as Error, {
        event: "AVAILABILITY_ERROR",
        providerId
      });

      // 离线容错：如果有缓存（即使过期），在网络错误时返回缓存
      const cached = this.availabilityCache.get(providerId);
      if (cached) {
        this.logger.warn("ProviderManager", "网络错误，使用过期缓存", {
          event: "AVAILABILITY_CACHE_FALLBACK",
          providerId,
          cacheAge: Date.now() - cached.timestamp
        });
        this.notifyNetworkStatus(false, err("E102", "网络请求失败", error));
        return ok(cached.capabilities);
      }

      this.notifyNetworkStatus(false, err("E102", "网络请求失败", error));
      return err("E102", "网络请求失败", error);
    }
  }

  /**
   * 获取已配置的 Provider 列表
   */
  getConfiguredProviders(): ProviderInfo[] {
    const settings = this.settingsStore.getSettings();
    const providers: ProviderInfo[] = [];

    for (const [id, config] of Object.entries(settings.providers)) {
      providers.push({
        id,
        type: config.type,
        name: id,
        configured: !!config.apiKey
      });
    }

    return providers;
  }

  /**
   * 订阅网络状态变化（用于离线/恢复提示）
   */
  subscribeNetworkStatus(listener: (online: boolean, error?: Err) => void): () => void {
    this.networkListeners.push(listener);
    return () => {
      this.networkListeners = this.networkListeners.filter((l) => l !== listener);
    };
  }

  /**
   * 设置 Provider 配置
   * 
   * @param id Provider ID
   * @param config Provider 配置
   */
  setProvider(id: string, config: ProviderConfig): void {
    const settings = this.settingsStore.getSettings();
    settings.providers[id] = config;
    
    this.settingsStore.updateSettings({ providers: settings.providers });

    this.logger.info("ProviderManager", `Provider 配置已更新: ${id}`, {
      event: "PROVIDER_UPDATED",
      type: config.type,
      enabled: config.enabled,
      hasCustomBaseUrl: !!config.baseUrl
    });
  }

  /**
   * 移除 Provider
   * 
   * @param id Provider ID
   */
  removeProvider(id: string): void {
    const settings = this.settingsStore.getSettings();
    delete settings.providers[id];
    
    this.settingsStore.updateSettings({ providers: settings.providers });

    this.logger.info("ProviderManager", `Provider 已移除: ${id}`, {
      event: "PROVIDER_REMOVED"
    });
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 通知网络状态（仅在状态变更时触发）
   */
  private notifyNetworkStatus(online: boolean, error?: Err): void {
    const nextOffline = !online;
    if (this.isOffline === nextOffline) {
      return;
    }
    this.isOffline = nextOffline;
    for (const listener of this.networkListeners) {
      try {
        listener(online, error);
      } catch (e) {
        this.logger.error("ProviderManager", "网络状态监听器执行失败", e as Error);
      }
    }
  }

  /**
   * 获取并验证 Provider 配置
   * 
   * @param providerId Provider ID
   * @returns Provider 配置或错误
   */
  private getProviderConfig(providerId: string): Result<ProviderConfig> {
    const settings = this.settingsStore.getSettings();
    const providerConfig = settings.providers[providerId];

    if (!providerConfig) {
      return err("E304", `Provider 未配置: ${providerId}`);
    }

    if (!providerConfig.enabled) {
      return err("E304", `Provider 已禁用: ${providerId}`);
    }

    if (!providerConfig.apiKey) {
      return err("E103", `Provider API Key 未配置: ${providerId}`);
    }

    return ok(providerConfig);
  }

  /**
   * 执行聊天请求（单次，不含重试逻辑）
   * 
   * @param url 请求 URL
   * @param body 请求体
   * @param apiKey API Key
   * @returns 聊天响应
   */
  private async executeChatRequest(
    url: string,
    body: object,
    apiKey: string
  ): Promise<Result<ChatResponse>> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        return this.mapHttpError(response.status, await this.safeReadText(response));
      }

      const data: OpenAIChatResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return err("E100", "API 返回空响应");
      }

      return ok({
        content: data.choices[0].message.content,
        tokensUsed: data.usage?.total_tokens,
        finishReason: data.choices[0].finish_reason
      });
    } catch (error) {
      // 网络错误
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return err("E102", "网络连接失败", error);
      }
      return err("E100", `请求失败: ${(error as Error).message}`, error);
    }
  }

  /**
   * 执行嵌入请求（单次，不含重试逻辑）
   * 
   * @param url 请求 URL
   * @param body 请求体
   * @param apiKey API Key
   * @returns 嵌入响应
   */
  private async executeEmbedRequest(
    url: string,
    body: object,
    apiKey: string
  ): Promise<Result<EmbedResponse>> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        return this.mapHttpError(response.status, await this.safeReadText(response));
      }

      const data: OpenAIEmbedResponse = await response.json();

      if (!data.data || data.data.length === 0) {
        return err("E100", "API 返回空响应");
      }

      return ok({
        embedding: data.data[0].embedding,
        tokensUsed: data.usage?.total_tokens
      });
    } catch (error) {
      // 网络错误
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return err("E102", "网络连接失败", error);
      }
      return err("E100", `请求失败: ${(error as Error).message}`, error);
    }
  }

  /**
   * 将 HTTP 状态码映射为错误结果
   * 
   * 遵循设计文档错误码定义：
   * - 401/403 → E103 (AUTH_ERROR)
   * - 429 → E102 (RATE_LIMIT)
   * - 5xx → E100 (API_ERROR)
   * - 其他 → E100 (API_ERROR)
   * 
   * @param status HTTP 状态码
   * @param responseText 响应文本
   * @returns 错误结果
   */
  private mapHttpError(status: number, responseText: string): Result<never> {
    // 尝试解析错误响应
    let errorMessage = responseText;
    try {
      const errorData: HttpErrorResponse = JSON.parse(responseText);
      if (errorData.error?.message) {
        errorMessage = errorData.error.message;
      }
    } catch {
      // 保持原始文本
    }

    // 认证错误 (401/403) → E103
    if (status === 401 || status === 403) {
      return err("E103", `认证失败: ${errorMessage}`);
    }

    // 速率限制 (429) → E102
    if (status === 429) {
      return err("E102", `速率限制: ${errorMessage}`);
    }

    // 服务器错误 (5xx) → E100
    if (status >= 500) {
      return err("E100", `服务器错误 (${status}): ${errorMessage}`);
    }

    // 其他客户端错误 → E100
    return err("E100", `API 错误 (${status}): ${errorMessage}`);
  }

  /**
   * 安全读取响应文本
   * 
   * @param response HTTP 响应
   * @returns 响应文本或空字符串
   */
  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}
