/** Provider 管理器：与 AI 服务提供商交互，支持 OpenAI 标准格式 */

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

class SecurityUtils {
  static maskApiKey(apiKey: string): string {
    if (!apiKey) return "***";
    if (apiKey.length <= 8) return "***";
    return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
  }

  static sanitizeUrl(raw: string): string {
    try {
      const url = new URL(raw);
      url.searchParams.delete("api_key");
      url.searchParams.delete("token");
      return url.toString();
    } catch {
      return "[invalid-url]";
    }
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
    const safeUrl = SecurityUtils.sanitizeUrl(url);

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
      apiKeyMasked: SecurityUtils.maskApiKey(providerConfig.apiKey),
      messageCount: request.messages.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.retryHandler.executeWithRetry(
      async () => this.executeChatRequest(url, requestBody, providerConfig.apiKey, signal),
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
    const safeUrl = SecurityUtils.sanitizeUrl(url);

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
      apiKeyMasked: SecurityUtils.maskApiKey(providerConfig.apiKey),
      inputLength: request.input.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.retryHandler.executeWithRetry(
      async () => this.executeEmbedRequest(url, requestBody, providerConfig.apiKey, signal),
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

  /** 检查 Provider 可用性 */
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
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS["openai"];
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
    const settings = this.settingsStore.getSettings();
    settings.providers[id] = config;
    
    this.settingsStore.updateSettings({ providers: settings.providers });

    this.logger.info("ProviderManager", `Provider 配置已更新: ${id}`, {
      event: "PROVIDER_UPDATED",
      type: "openai",
      enabled: config.enabled,
      hasCustomBaseUrl: !!config.baseUrl
    });
  }

  /** 移除 Provider */
  removeProvider(id: string): void {
    const settings = this.settingsStore.getSettings();
    delete settings.providers[id];
    
    this.settingsStore.updateSettings({ providers: settings.providers });

    this.logger.info("ProviderManager", `Provider 已移除: ${id}`, {
      event: "PROVIDER_REMOVED"
    });
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

  /** 执行聊天请求（单次，不含重试逻辑） */
  private async executeChatRequest(
    url: string,
    body: object,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<Result<ChatResponse>> {
    const settings = this.settingsStore.getSettings();
    const timeoutMs = settings.providerTimeoutMs || 60000;
    
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason as any);
    const timeoutId = setTimeout(() => controller.abort(new Error("请求超时")), timeoutMs);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        return err("E102", "请求已取消", signal.reason);
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        return this.mapHttpError(response.status, await this.safeReadText(response));
      }

      const data: OpenAIChatResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return err("E100", "API 返回空响应");
      }

      const firstChoice = data.choices[0];
      const content = firstChoice?.message?.content;
      if (typeof content !== "string") {
        return err("E100", "API 返回格式异常：缺少 message.content");
      }

      return ok({
        content,
        tokensUsed: data.usage?.total_tokens,
        finishReason: firstChoice?.finish_reason
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return err("E102", "请求已取消或超时", error);
      }
      // 网络错误
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return err("E102", "网络连接失败", error);
      }
      return err("E100", `请求失败: ${(error as Error).message}`, error);
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /** 执行嵌入请求（单次，不含重试逻辑） */
  private async executeEmbedRequest(
    url: string,
    body: object,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<Result<EmbedResponse>> {
    const settings = this.settingsStore.getSettings();
    const timeoutMs = settings.providerTimeoutMs || 60000;
    
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason as any);
    const timeoutId = setTimeout(() => controller.abort(new Error("请求超时")), timeoutMs);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        return err("E102", "请求已取消", signal.reason);
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        return this.mapHttpError(response.status, await this.safeReadText(response));
      }

      const data: OpenAIEmbedResponse = await response.json();

      if (!data.data || data.data.length === 0) {
        return err("E100", "API 返回空响应");
      }

      const first = data.data[0];
      if (!first || !Array.isArray(first.embedding)) {
        return err("E100", "API 返回格式异常：缺少 embedding");
      }

      return ok({
        embedding: first.embedding,
        tokensUsed: data.usage?.total_tokens
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return err("E102", "请求已取消或超时", error);
      }
      // 网络错误
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return err("E102", "网络连接失败", error);
      }
      return err("E100", `请求失败: ${(error as Error).message}`, error);
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  /** 将 HTTP 状态码映射为错误结果 */
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

  /** 安全读取响应文本 */
  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
}
