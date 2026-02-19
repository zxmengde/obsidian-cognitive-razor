/** Provider 管理器：与 AI 服务提供商交互，支持 OpenAI 标准格式 */

import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  ok,
  err,
  DEFAULT_ENDPOINTS,
} from "../types";
import type {
  ILogger,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderCapabilities,
  ProviderInfo,
  ProviderConfig,
  Result,
  Err,
} from "../types";
import type { SettingsStore } from "../data/settings-store";
import { RetryHandler, PROVIDER_ERROR_CONFIG } from "./retry-handler";

/** API Key 脱敏（日志用） */
function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) return "***";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

/** URL 脱敏（移除敏感参数） */
function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.delete("api_key");
    url.searchParams.delete("token");
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/** OpenAI API 响应格式 */
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

/** HTTP 错误响应 */
interface HttpErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

/** Provider 可用性缓存条目 */
interface AvailabilityCacheEntry {
  capabilities: ProviderCapabilities;
  timestamp: number;
}

export class ProviderManager {
  private settingsStore: SettingsStore;
  private logger: ILogger;
  private retryHandler: RetryHandler;
  private networkListeners: Array<(online: boolean, error?: Err) => void>;
  private isOffline = false;
  
  // 可用性缓存（遵循 G-08 本地优先，A-NF-01 性能界限）
  private availabilityCache: Map<string, AvailabilityCacheEntry>;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存

  constructor(settingsStore: SettingsStore, logger: ILogger, retryHandler?: RetryHandler) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.retryHandler = retryHandler || new RetryHandler(logger);
    this.networkListeners = [];
    this.availabilityCache = new Map();

    this.logger.debug("ProviderManager", "ProviderManager 初始化完成");
  }

  /** 清除可用性缓存（用于设置页面"测试连接"时强制刷新） */
  clearAvailabilityCache(providerId?: string): void {
    if (providerId) {
      this.availabilityCache.delete(providerId);
      this.logger.debug("ProviderManager", `已清除 Provider ${providerId} 的可用性缓存`);
    } else {
      this.availabilityCache.clear();
      this.logger.debug("ProviderManager", "已清除所有 Provider 可用性缓存");
    }
  }

  /** 调用聊天 API */
  async chat(request: ChatRequest, signal?: AbortSignal): Promise<Result<ChatResponse>> {
    const startTime = Date.now();
    
    // 验证 Provider 配置
    const configResult = this.getProviderConfig(request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS["openai"];
    const url = `${baseUrl}/chat/completions`;
    const safeUrl = sanitizeUrl(url);

    // 构建请求体（OpenAI 标准格式）
    // 注意：不设置 max_tokens 时让模型自由输出，避免截断
    const requestBody: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 1.0
    };
    // 仅当明确指定 maxTokens 时才添加该字段
    if (request.maxTokens !== undefined) {
      requestBody.max_tokens = request.maxTokens;
    }
    // 如果指定了 reasoning_effort，添加到请求体（用于 o1/o3 等推理模型）
    if (request.reasoning_effort) {
      requestBody.reasoning_effort = request.reasoning_effort;
    }

    this.logger.debug("ProviderManager", "发送聊天请求", {
      event: "API_REQUEST",
      providerId: request.providerId,
      model: request.model,
      url: safeUrl,
      apiKeyMasked: maskApiKey(providerConfig.apiKey),
      messageCount: request.messages.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.retryHandler.executeWithRetry(
      async () => this.executeChatRequest(url, requestBody, providerConfig.apiKey, signal),
      {
        ...PROVIDER_ERROR_CONFIG,
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
      const offline = result.error.code === "E204_PROVIDER_ERROR" &&
        typeof result.error.details === "object" &&
        (result.error.details as { kind?: unknown } | null)?.kind === "network";
      this.notifyNetworkStatus(!offline, offline ? (result as Err) : undefined);
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

  /** 调用嵌入 API */
  async embed(request: EmbedRequest, signal?: AbortSignal): Promise<Result<EmbedResponse>> {
    const startTime = Date.now();
    
    // 验证 Provider 配置
    const configResult = this.getProviderConfig(request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS["openai"];
    const url = `${baseUrl}/embeddings`;
    const safeUrl = sanitizeUrl(url);

    // 构建请求体（OpenAI 标准格式）
    // 支持 dimensions 参数（用于 text-embedding-3-small 等可变维度模型）
    const requestBody: Record<string, unknown> = {
      model: request.model,
      input: request.input
    };
    
    // 如果指定了维度，添加到请求体
    if (request.dimensions && request.dimensions > 0) {
      requestBody.dimensions = request.dimensions;
    }

    this.logger.debug("ProviderManager", "发送嵌入请求", {
      event: "API_REQUEST",
      providerId: request.providerId,
      model: request.model,
      url: safeUrl,
      apiKeyMasked: maskApiKey(providerConfig.apiKey),
      inputLength: request.input.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.retryHandler.executeWithRetry(
      async () => this.executeEmbedRequest(url, requestBody, providerConfig.apiKey, signal),
      {
        ...PROVIDER_ERROR_CONFIG,
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
      const offline = result.error.code === "E204_PROVIDER_ERROR" &&
        typeof result.error.details === "object" &&
        (result.error.details as { kind?: unknown } | null)?.kind === "network";
      this.notifyNetworkStatus(!offline, offline ? (result as Err) : undefined);
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

  /** 检查 Provider 可用性 */
  async checkAvailability(providerId: string, forceRefresh = false, configOverride?: ProviderConfig): Promise<Result<ProviderCapabilities>> {
    // 检查缓存（除非强制刷新或使用临时配置）
    if (!forceRefresh && !configOverride) {
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

    // 验证 Provider 配置（支持临时配置覆盖，用于 Modal 连接测试）
    let providerConfig: ProviderConfig;
    if (configOverride) {
      providerConfig = configOverride;
    } else {
      const configResult = this.getProviderConfig(providerId);
      if (!configResult.ok) {
        return configResult;
      }
      providerConfig = configResult.value;
    }

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS["openai"];
    const url = `${baseUrl}/models`;

    this.logger.debug("ProviderManager", "检查 Provider 可用性", {
      event: "AVAILABILITY_CHECK",
      providerId,
      url,
      forceRefresh
    });

    try {
      // 需求 22.7：使用 requestUrl() 而非 fetch()，绕过 CORS 限制
      const response = await requestUrl({
        url,
        method: "GET",
        headers: {
          "Authorization": `Bearer ${providerConfig.apiKey}`
        },
        throw: false
      });

      if (response.status < 200 || response.status >= 300) {
        const errorResult = this.mapHttpError(response.status, typeof response.text === "string" ? response.text : "");
        
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

      const data = response.json as { data?: Array<{ id: string }> };

      // 构建能力信息
      const models = data.data?.map((m) => m.id) ?? [];
      const capabilities: ProviderCapabilities = {
        chat: true,
        embedding: true,
        maxContextLength: 128000, // 默认值
        models
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
        this.notifyNetworkStatus(false, err("E204_PROVIDER_ERROR", "网络请求失败", { kind: "network", error }));
        return ok(cached.capabilities);
      }

      this.notifyNetworkStatus(false, err("E204_PROVIDER_ERROR", "网络请求失败", { kind: "network", error }));
      return err("E204_PROVIDER_ERROR", "网络请求失败", { kind: "network", error });
    }
  }

  /** 获取已配置的 Provider 列表 */
  getConfiguredProviders(): ProviderInfo[] {
    const settings = this.settingsStore.getSettings();
    const providers: ProviderInfo[] = [];

    for (const [id, config] of Object.entries(settings.providers)) {
      providers.push({
        id,
        type: "openai",
        name: id,
        configured: !!config.apiKey
      });
    }

    return providers;
  }

  /** 订阅网络状态变化（用于离线/恢复提示） */
  subscribeNetworkStatus(listener: (online: boolean, error?: Err) => void): () => void {
    this.networkListeners.push(listener);
    return () => {
      this.networkListeners = this.networkListeners.filter((l) => l !== listener);
    };
  }

  /** 设置 Provider 配置 */
  setProvider(id: string, config: ProviderConfig): void {
    // 通过 updateSettings 正规路径更新，避免直接改写设置对象（DIP）
    this.settingsStore.updateSettings({ providers: { [id]: config } });

    this.logger.info("ProviderManager", `Provider 配置已更新: ${id}`, {
      event: "PROVIDER_UPDATED",
      type: "openai",
      enabled: config.enabled,
      hasCustomBaseUrl: !!config.baseUrl
    });
  }

  /** 移除 Provider */
  async removeProvider(id: string): Promise<Result<void>> {
    // 通过 SettingsStore 正规路径删除，避免直接改写设置对象
    const result = await this.settingsStore.removeProvider(id);
    if (!result.ok) {
      this.logger.error("ProviderManager", `Provider 移除失败: ${id}`, undefined, {
        event: "PROVIDER_REMOVE_FAILED",
        errorCode: result.error.code
      });
      return result;
    }

    this.logger.info("ProviderManager", `Provider 已移除: ${id}`, {
      event: "PROVIDER_REMOVED"
    });
    return result;
  }

  /** 通知网络状态（仅在状态变更时触发） */
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

  /** 获取并验证 Provider 配置 */
  private getProviderConfig(providerId: string): Result<ProviderConfig> {
    const settings = this.settingsStore.getSettings();
    const providerConfig = settings.providers[providerId];

    if (!providerConfig) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider 未配置: ${providerId}`);
    }

    if (!providerConfig.enabled) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider 已禁用: ${providerId}`);
    }

    if (!providerConfig.apiKey) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider API Key 未配置: ${providerId}`);
    }

    return ok(providerConfig);
  }

  // 需求 22.7：使用 requestUrl() 而非 fetch()，绕过 CORS 限制
    private async executeJsonRequest<T>(
      url: string,
      body: object,
      apiKey: string,
      signal: AbortSignal | undefined,
      parse: (data: unknown) => Result<T>
    ): Promise<Result<T>> {
      if (signal?.aborted) {
        return err("E310_INVALID_STATE", "请求已取消", signal.reason);
      }

      try {
        const params: RequestUrlParam = {
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(body),
          throw: false
        };

        const response = await requestUrl(params);

        if (response.status < 200 || response.status >= 300) {
          return this.mapHttpError(response.status, typeof response.text === "string" ? response.text : "");
        }

        const data = response.json as unknown;
        return parse(data);
      } catch (error) {
        // requestUrl 在网络错误时抛出异常
        if (signal?.aborted) {
          return err("E310_INVALID_STATE", "请求已取消", signal.reason);
        }
        // 需求 23.4：不暴露原始错误消息给用户，放入 details 供日志使用
        return err("E204_PROVIDER_ERROR", "网络请求失败，请检查网络连接", { kind: "network", rawError: (error as Error).message });
      }
    }


  /** 执行聊天请求（单次，不含重试逻辑） */
  private async executeChatRequest(
    url: string,
    body: object,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<Result<ChatResponse>> {
    return this.executeJsonRequest(url, body, apiKey, signal, (raw) => {
      const data = raw as OpenAIChatResponse;

      if (!data.choices || data.choices.length === 0) {
        return err("E204_PROVIDER_ERROR", "API 返回空响应");
      }

      const firstChoice = data.choices[0];
      const content = firstChoice?.message?.content;
      if (typeof content !== "string") {
        return err("E204_PROVIDER_ERROR", "API 返回格式异常：缺少 message.content");
      }

      return ok({
        content,
        tokensUsed: data.usage?.total_tokens,
        finishReason: firstChoice?.finish_reason
      });
    });
  }

  /** 执行嵌入请求（单次，不含重试逻辑） */
  private async executeEmbedRequest(
    url: string,
    body: object,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<Result<EmbedResponse>> {
    return this.executeJsonRequest(url, body, apiKey, signal, (raw) => {
      const data = raw as OpenAIEmbedResponse;

      if (!data.data || data.data.length === 0) {
        return err("E204_PROVIDER_ERROR", "API 返回空响应");
      }

      const first = data.data[0];
      if (!first || !Array.isArray(first.embedding)) {
        return err("E204_PROVIDER_ERROR", "API 返回格式异常：缺少 embedding");
      }

      return ok({
        embedding: first.embedding,
        tokensUsed: data.usage?.total_tokens
      });
    });
  }

  /**
   * 将 HTTP 状态码映射为错误结果
   * 需求 23.4：用户可见消息仅包含错误码 + 安全描述，原始 API 响应放入 details
   */
  private mapHttpError(status: number, responseText: string): Result<never> {
    // 解析原始响应用于日志/调试（放入 details，不暴露给用户）
    let rawDetail = responseText;
    try {
      const errorData: HttpErrorResponse = JSON.parse(responseText);
      if (errorData.error?.message) {
        rawDetail = errorData.error.message;
      }
    } catch {
      // 保持原始文本
    }

    // 认证错误 (401/403) → E203_INVALID_API_KEY
    if (status === 401 || status === 403) {
      return err("E203_INVALID_API_KEY", "认证失败，请检查 API Key 是否正确", { status, rawResponse: rawDetail });
    }

    // 速率限制 (429) → E202_RATE_LIMITED
    if (status === 429) {
      return err("E202_RATE_LIMITED", "请求频率超限，请稍后重试", { status, rawResponse: rawDetail });
    }

    // 服务器错误 (5xx) → E204_PROVIDER_ERROR
    if (status >= 500) {
      return err("E204_PROVIDER_ERROR", `服务器错误 (${status})，请稍后重试`, { status, rawResponse: rawDetail });
    }

    // 其他客户端错误 → E204_PROVIDER_ERROR
    return err("E204_PROVIDER_ERROR", `API 请求失败 (${status})`, { status, rawResponse: rawDetail });
  }

}
