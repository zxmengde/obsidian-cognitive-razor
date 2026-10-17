import { ProviderRequestExecutor, type ProviderCallContext } from "./provider-request-executor";
import { sanitizeUrl, summarizeProviderErrorDetails } from "./provider-errors";
/** Provider 管理器：与 AI 服务提供商交互，支持 OpenAI 标准格式 */

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
  ProviderApiFormat,
  ProviderCapabilities,
  ProviderConfig,
  Result,
} from "../types";
import type { SettingsStore } from "../data/settings-store";
import { RetryHandler, PROVIDER_ERROR_CONFIG } from "./retry-handler";
import { buildProviderApiUrl, resolveAvailableProvider } from "./provider-config";
import {
  resolveWebSearchOptions,
  validateChatParameters,
} from "./provider-request-builders";
import type {
  ExternalCallKind,
  ExternalCallLedger,
  AttemptReason,
  ExternalCallDiagnostics,
} from "./external-call-ledger";
import { InMemoryExternalCallLedger } from "./external-call-ledger";
import { deriveResponseCacheUsage, responseUsageEvidence } from "./provider-token-usage";
import type { ModelGateway } from "./model-gateway";
import type { ProviderProbeRequest } from "./model-gateway";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import { buildTaskChatRequest } from "./task-execution-support";
import type {
  ProviderStreamTransport,
} from "./provider-streaming";
import {
  ObsidianProviderTransport,
  type ProviderTransport,
} from "./provider-transport";
import {
  OPENAI_CHAT_COMPLETIONS_ADAPTER,
} from "./openai-chat-adapter";
import { OPENAI_RESPONSES_ADAPTER } from "./openai-responses-adapter";
import { GEMINI_GENERATIVE_LANGUAGE_ADAPTER } from "./gemini-generative-language-adapter";
import type {
  ProtocolAdapterMetadata,
  ProtocolWebSearchOptions,
} from "./chat-protocol-adapter";

/** Fixed numeric whitelist, measured from the built body rather than config. */
function samplingEvidence(request: ChatRequest, body: Record<string, unknown>): Record<string, number | string> {
  const numberOrOmitted = (value: unknown): number | string => typeof value === "number" && Number.isFinite(value) ? value : "not-sent";
  const generation = body.generationConfig as Record<string, unknown> | undefined;
  return {
    configuredTemperature: numberOrOmitted(request.configuredSampling?.temperature ?? request.temperature),
    configuredTopP: numberOrOmitted(request.configuredSampling?.topP ?? request.topP),
    sentTemperature: numberOrOmitted(body.temperature ?? generation?.temperature),
    sentTopP: numberOrOmitted(body.top_p ?? generation?.topP),
  };
}

/** Uniform dispatch view over the chat protocol adapters. */
interface ChatProtocolDispatchEntry {
  readonly adapter: ProtocolAdapterMetadata;
  readonly requestLabel: string;
  readonly logMessage: string;
  readonly requiresNonEmptyContent?: boolean;
  buildUrl(baseUrl: string, model: string): string;
  buildBody(request: ChatRequest, webSearch?: ProtocolWebSearchOptions): { body: Record<string, unknown>; contentCount: number };
}

/** One entry per chat-capable apiFormat; adding a protocol means adding an adapter and one map entry. */
const CHAT_PROTOCOL_DISPATCH: Record<Exclude<ProviderApiFormat, "disabled">, ChatProtocolDispatchEntry> = {
  "openai-chat-completions": {
    adapter: OPENAI_CHAT_COMPLETIONS_ADAPTER,
    requestLabel: "聊天请求",
    logMessage: "发送聊天请求",
    buildUrl: (baseUrl) => buildProviderApiUrl(baseUrl, OPENAI_CHAT_COMPLETIONS_ADAPTER.apiFormat, OPENAI_CHAT_COMPLETIONS_ADAPTER.requestPath),
    buildBody: (request) => ({ body: OPENAI_CHAT_COMPLETIONS_ADAPTER.buildRequestBody(request), contentCount: request.messages.length }),
  },
  "openai-responses": {
    adapter: OPENAI_RESPONSES_ADAPTER,
    requestLabel: "OpenAI Responses 请求",
    logMessage: "发送 OpenAI Responses 请求",
    buildUrl: (baseUrl) => buildProviderApiUrl(baseUrl, OPENAI_RESPONSES_ADAPTER.apiFormat, OPENAI_RESPONSES_ADAPTER.requestPath),
    buildBody: (request, webSearch) => ({ body: OPENAI_RESPONSES_ADAPTER.buildRequestBody(request, webSearch), contentCount: request.messages.length }),
  },
  "gemini-generative-language": {
    adapter: GEMINI_GENERATIVE_LANGUAGE_ADAPTER,
    requestLabel: "Gemini 请求",
    logMessage: "发送 Gemini generateContent 请求",
    requiresNonEmptyContent: true,
    buildUrl: (baseUrl, model) => buildProviderApiUrl(baseUrl, GEMINI_GENERATIVE_LANGUAGE_ADAPTER.apiFormat, GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPath(model)),
    buildBody: (request, webSearch) => {
      const plan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(request, webSearch);
      return { body: plan.body, contentCount: plan.contentCount };
    },
  },
};

export class ProviderManager implements ModelGateway {
  private settingsStore: SettingsStore;
  private logger: ILogger;
  private retryHandler: RetryHandler;
  private readonly ledger: ExternalCallLedger;
  private readonly transport: ProviderTransport;
  private readonly requestExecutor: ProviderRequestExecutor;
  private disposed = false;

  constructor(
    settingsStore: SettingsStore,
    logger: ILogger,
    retryHandler?: RetryHandler,
    streamRequester?: ConstructorParameters<typeof ObsidianProviderTransport>[0],
    ledger: ExternalCallLedger = new InMemoryExternalCallLedger(),
    transport?: ProviderTransport,
  ) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.retryHandler = retryHandler || new RetryHandler(logger);
    this.transport = transport ?? new ObsidianProviderTransport(streamRequester);
    this.ledger = ledger;
    this.requestExecutor = new ProviderRequestExecutor(settingsStore, logger, ledger, this.transport, () => this.disposed);

    this.logger.debug("ProviderManager", "ProviderManager 初始化完成");
  }

  /** Bounded session-only diagnostics. No prompts, answers, credentials or prices. */
  getExternalCallDiagnostics(): ExternalCallDiagnostics {
    return this.ledger.diagnostics();
  }

  /** 调用聊天 API */
  async chat(request: ChatRequest, signal?: AbortSignal): Promise<Result<ChatResponse>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "Provider 服务已停止");
    }
    const startTime = Date.now();
    
    // 验证 Provider 配置
    const configResult = request.providerSnapshot ? ok(request.providerSnapshot) : resolveAvailableProvider(this.settingsStore.getSettings(), request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;
    const apiFormat = providerConfig.apiFormat;
    if (apiFormat === "disabled") {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider ${request.providerId} 未启用聊天 API`);
    }
    const parameterResult = validateChatParameters(request, apiFormat);
    if (!parameterResult.ok) {
      return parameterResult;
    }
    return this.dispatchChat(request, providerConfig, {
      signal,
      startTime,
      streaming: this.settingsStore.getSettings().enableStreamingKeepalive === true,
      withRetry: true,
      logRequest: true,
      finalize: true,
      callKind: "model",
      attemptReason: request.attemptReason,
    });
  }

  /** 调用嵌入 API */
  async embed(request: EmbedRequest, signal?: AbortSignal): Promise<Result<EmbedResponse>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "Provider 服务已停止");
    }
    const startTime = Date.now();
    
    // 验证 Provider 配置
    const configResult = request.providerSnapshot ? ok(request.providerSnapshot) : resolveAvailableProvider(this.settingsStore.getSettings(), request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    if (providerConfig.embeddingApiFormat !== "openai-embeddings") {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider ${request.providerId} 未启用 Embeddings API`, {
        providerId: request.providerId,
        embeddingApiFormat: providerConfig.embeddingApiFormat,
      });
    }

    // 构建请求 URL
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS["openai-chat-completions"];
    const url = buildProviderApiUrl(baseUrl, "openai-embeddings", "embeddings");
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
      apiKeyConfigured: providerConfig.apiKey.length > 0,
      inputLength: request.input.length
    });

    // 使用 RetryHandler 执行带重试的请求
    const result = await this.executeWithProviderRetry(
      (reason) => this.requestExecutor.executeEmbedRequest(
        url,
        requestBody,
        providerConfig.apiKey,
        signal,
        this.callContext("embedding", request.providerId, request.model, "openai-embeddings", "embedding", reason),
      ),
      request.providerId,
      "嵌入请求",
      signal,
      request.attemptReason,
    );

    if (this.disposed) {
      return err("E310_INVALID_STATE", "Provider 服务已停止");
    }

    const elapsedTime = Date.now() - startTime;

    if (result.ok) {
      this.logger.info("ProviderManager", "嵌入请求成功", {
        event: "API_RESPONSE",
        providerId: request.providerId,
        model: request.model,
        tokensUsed: result.value.tokensUsed,
        dimension: result.value.embedding.length,
        elapsedTime
      });
    } else {
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

  /** Probe configured capabilities through the same gateway used by tasks. */
  async probe(
    request: ProviderProbeRequest,
    signal?: AbortSignal,
  ): Promise<Result<ProviderCapabilities>> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "Provider 服务已停止");
    }
    if (signal?.aborted) {
      return err("E310_INVALID_STATE", "连接测试已取消", signal.reason);
    }

    const indexSnapshot = request.taskType === "index"
      ? request.taskConfig ?? resolveTaskModelSnapshot(this.settingsStore.getSettings(), "index")
      : undefined;
    if (indexSnapshot && indexSnapshot.providerId !== request.providerId) {
      return err("E101_INVALID_INPUT", "Index 测试服务与实际任务配置不一致，请重新读取配置后测试");
    }
    const configResult = indexSnapshot
      ? resolveAvailableProvider({ providers: indexSnapshot.providerSnapshot
        ? { [request.providerId]: indexSnapshot.providerSnapshot } : {} }, request.providerId)
      : request.configOverride
      ? ok(request.configOverride)
      : resolveAvailableProvider(this.settingsStore.getSettings(), request.providerId);
    if (!configResult.ok) {
      return configResult;
    }
    const providerConfig = configResult.value;

    this.logger.debug("ProviderManager", "测试 Provider 连接", {
      event: "CONNECTION_TEST",
      providerId: request.providerId,
    });

    const chatEnabled = !indexSnapshot && providerConfig.apiFormat !== "disabled";
    const embeddingEnabled = (request.taskType === undefined || request.taskType === "index")
      && providerConfig.embeddingApiFormat === "openai-embeddings";
    if (!chatEnabled && !embeddingEnabled) {
      return err("E401_PROVIDER_NOT_CONFIGURED", "Provider 未启用聊天或嵌入能力");
    }

    let chat = false;
    let chatError: ProviderCapabilities["chatError"];
    let embedding = false;
    let embeddingError: ProviderCapabilities["embeddingError"];
    let embeddingProbe: ProviderCapabilities["embeddingProbe"];
    let firstFailure: { code: string; message: string; details?: unknown } | undefined;

    if (chatEnabled) {
      const chatResult = await this.probeChat(providerConfig, signal, request.providerId, request.attemptReason, request.taskConfig);
      if (this.disposed) {
        return err("E310_INVALID_STATE", "Provider 服务已停止");
      }
      if (signal?.aborted) {
        return err("E310_INVALID_STATE", "连接测试已取消", signal.reason);
      }
      chat = chatResult.ok;
      if (chatResult.ok && request.taskConfig?.capabilities.nativeWebSearch && chatResult.value.webSearchUsed !== true) {
        chat = false;
        chatError = { code: "E101_INVALID_INPUT", message: "任务配置要求原生搜索，但 Provider 未返回实际搜索证据" };
        firstFailure = { code: chatError.code, message: chatError.message };
      }
      if (!chatResult.ok) {
        chatError = { code: chatResult.error.code, message: chatResult.error.message };
        firstFailure = chatResult.error;
      }
    }

    if (embeddingEnabled) {
      embeddingProbe = {
        model: indexSnapshot?.model ?? providerConfig.defaultEmbedModel.trim(),
        requestedDimensions: indexSnapshot
          ? indexSnapshot.embeddingDimension : providerConfig.parameters?.embeddingDimension,
      };
      const embedResult = await this.probeEmbedding(providerConfig, signal, request.providerId, request.attemptReason, indexSnapshot);
      if (this.disposed) {
        return err("E310_INVALID_STATE", "Provider 服务已停止");
      }
      if (signal?.aborted) {
        return err("E310_INVALID_STATE", "连接测试已取消", signal.reason);
      }
      embedding = embedResult.ok;
      if (embedResult.ok) embeddingProbe.actualDimensions = embedResult.value.embedding.length;
      if (!embedResult.ok) {
        embeddingError = { code: embedResult.error.code, message: embedResult.error.message };
        firstFailure ??= embedResult.error;
      }
    }

    if (!chat && !embedding && firstFailure) {
      return err(firstFailure.code, firstFailure.message, firstFailure.details);
    }

    const capabilities: ProviderCapabilities = {
      chat,
      chatError,
      embedding,
      embeddingError,
      ...(embeddingProbe ? { embeddingProbe } : {}),
    };
    this.logger.info("ProviderManager", "Provider 连接测试成功", {
      event: "CONNECTION_TEST_SUCCESS",
      providerId: request.providerId,
      chat: capabilities.chat,
      embedding: capabilities.embedding,
    });
    return ok(capabilities);
  }

  private async probeChat(
    config: ProviderConfig,
    signal?: AbortSignal,
    providerId = "unknown",
    attemptReason: ProviderProbeRequest["attemptReason"] = "initial",
    taskConfig?: import("../types").ResolvedTaskConfig,
  ): Promise<Result<ChatResponse>> {
    const model = taskConfig?.model.trim() || config.defaultChatModel.trim();
    if (!model) {
      return err("E101_INVALID_INPUT", "Provider 未设置默认聊天模型");
    }
    const format = config.apiFormat;
    if (format === "disabled") {
      return err("E401_PROVIDER_NOT_CONFIGURED", "Provider 未启用聊天 API");
    }
    // Service-only probes must use the edited Provider defaults, not unrelated
    // persisted task overrides or a hard-coded parameter-free request.
    const settings = this.settingsStore.getSettings();
    const effective = taskConfig ?? resolveTaskModelSnapshot({
      ...settings,
      providers: { [providerId]: config },
      taskModels: { ...settings.taskModels, define: { providerId, model: "" } },
    }, "define");
    const probeRequest = buildTaskChatRequest("define",
      "<system_instructions>Return only the requested short JSON object.</system_instructions>\nReturn {\"ok\":true}.",
      effective, { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      "provider-probe", attemptReason);
    probeRequest.model = model;
    // A configured native-search task tests that declared capability as before.
    if (effective.capabilities.nativeWebSearch) probeRequest.webSearch = { purpose: "write" };
    const parameterResult = validateChatParameters(probeRequest, format);
    if (!parameterResult.ok) return parameterResult as Result<ChatResponse>;
    return this.dispatchChat(probeRequest, config, {
      signal,
      startTime: Date.now(),
      streaming: false,
      withRetry: false,
      logRequest: false,
      finalize: false,
      callKind: "provider-probe",
      callLabel: "provider-probe:chat",
      requestLabel: "provider-probe",
      attemptReason,
    });
  }

  private async probeEmbedding(
    config: ProviderConfig,
    signal?: AbortSignal,
    providerId = "unknown",
    attemptReason: ProviderProbeRequest["attemptReason"] = "initial",
    taskConfig?: import("../types").ResolvedTaskConfig,
  ): Promise<Result<EmbedResponse>> {
    const model = (taskConfig?.model ?? config.defaultEmbedModel).trim();
    const dimensions = taskConfig ? taskConfig.embeddingDimension : config.parameters?.embeddingDimension;
    if (!model) {
      return err("E101_INVALID_INPUT", taskConfig ? "Index 任务没有配置嵌入模型" : "Provider 未设置默认嵌入模型");
    }
    if (dimensions !== undefined && (!Number.isSafeInteger(dimensions) || dimensions <= 0)) {
      return err("E101_INVALID_INPUT", "嵌入测试维度必须是正整数");
    }
    const result = await this.requestExecutor.executeEmbedRequest(
      buildProviderApiUrl(
        config.baseUrl || DEFAULT_ENDPOINTS["openai-chat-completions"],
        "openai-embeddings",
        "embeddings",
      ),
      { model, input: "connection test", ...(dimensions !== undefined ? { dimensions } : {}) },
      config.apiKey,
      signal,
      this.callContext("provider-probe", providerId, model, "openai-embeddings", "provider-probe:embedding", attemptReason),
    );
    if (result.ok && dimensions !== undefined && result.value.embedding.length !== dimensions) {
      return err("E211_MODEL_SCHEMA_VIOLATION", `嵌入测试返回维度 ${result.value.embedding.length}，与请求维度 ${dimensions} 不一致`);
    }
    return result;
  }

  private executeWithProviderRetry<T>(
    operation: (reason: AttemptReason) => Promise<Result<T>>,
    providerId: string,
    label: string,
    signal?: AbortSignal,
    initialReason: AttemptReason = "initial",
  ): Promise<Result<T>> {
    const configuredMaxAttempts = this.settingsStore.getSettings().providerMaxAttempts;
    let nextReason = initialReason;
    return this.retryHandler.executeWithRetry(() => operation(nextReason), {
      ...PROVIDER_ERROR_CONFIG,
      maxAttempts: configuredMaxAttempts ?? PROVIDER_ERROR_CONFIG.maxAttempts,
      signal,
      onRetry: (nextAttempt, error) => {
        nextReason = "automatic-retry";
        this.logger.warn("ProviderManager", `${label}将进行第 ${nextAttempt} 次请求`, {
          event: "API_RETRY",
          providerId,
          errorCode: error.code,
          errorMessage: error.message,
        });
      },
    });
  }

  private callContext(
    kind: ExternalCallKind,
    providerId: string,
    model: string,
    protocol: string,
    label?: string,
    reason: AttemptReason = "initial",
    parentAttemptId?: string,
  ): ProviderCallContext {
    return { kind, providerId, model, protocol, label, reason, parentAttemptId };
  }

  /** 记录聊天结果并保留协议错误语义。 */
  private finalizeChatResult(
    request: ChatRequest,
    result: Result<ChatResponse>,
    startTime: number,
    protocolLabel: string,
    body: Record<string, unknown>,
  ): Result<ChatResponse> {
    if (this.disposed) {
      return err("E310_INVALID_STATE", "Provider 服务已停止");
    }
    const elapsedTime = Date.now() - startTime;
    if (result.ok) {
      if (request.webSearch && result.value.webSearchUsed !== true) {
        // Gate tool capability and tool transport errors separately from the
        // model result. Some gateways omit web_search_call events even when
        // they return a usable response; discarding that response causes an
        // unnecessary full-task replay.
        this.logger.warn("ProviderManager", "Provider 未返回可解析的原生搜索证据，保留模型结果", {
          event: "WEB_SEARCH_EVIDENCE_MISSING",
          providerId: request.providerId,
          model: request.model,
          requestLabel: request.requestLabel,
        });
      }
      if (request.maxTokens !== undefined &&
        result.value.outputTokens !== undefined &&
        result.value.outputTokens > request.maxTokens) {
        this.logger.warn("ProviderManager", `${protocolLabel} 未遵守请求的输出 token 上限`, {
          event: "OUTPUT_LIMIT_EXCEEDED",
          providerId: request.providerId,
          model: request.model,
          requestLabel: request.requestLabel,
          requestedMaxTokens: request.maxTokens,
          reportedOutputTokens: result.value.outputTokens,
        });
      }
      this.logger.info("ProviderManager", `${protocolLabel} 请求成功`, {
        event: "API_RESPONSE",
        providerId: request.providerId,
        model: request.model,
        requestedModel: request.model,
        ...samplingEvidence(request, body),
        reportedModel: result.value.reportedModel ?? "unknown",
        requestedCacheMode: request.promptCacheMode ?? "not-specified",
        requestedCacheTtl: request.promptCacheTtl ?? "not-specified",
        reportedCacheMode: result.value.reportedCacheMode ?? "unknown",
        reportedCacheTtl: result.value.reportedCacheTtl ?? "unknown",
        ...responseUsageEvidence(result.value),
        requestLabel: request.requestLabel,
        tokensUsed: result.value.tokensUsed,
        inputTokens: result.value.inputTokens,
        outputTokens: result.value.outputTokens,
        cacheReadTokens: result.value.cacheReadTokens,
        cacheWriteTokens: result.value.cacheWriteTokens,
        promptCacheMode: request.promptCacheMode,
        promptCacheKeyConfigured: !!request.promptCacheKey,
        ...deriveResponseCacheUsage(result.value),
        webSearchUsed: result.value.webSearchUsed,
        citationCount: result.value.citations?.length ?? 0,
        elapsedTime,
      });
      return result;
    }

    this.logger.error("ProviderManager", `${protocolLabel} 请求失败`, undefined, {
      event: "API_ERROR",
      providerId: request.providerId,
      model: request.model,
      requestLabel: request.requestLabel,
      errorCode: result.error.code,
      errorMessage: result.error.message,
      errorDetails: summarizeProviderErrorDetails(result.error.details),
      elapsedTime,
    });
    return result;
  }

  /** Single chat dispatch shared by chat() and probeChat(): the adapter map resolves the protocol. */
  private async dispatchChat(
    request: ChatRequest,
    providerConfig: ProviderConfig,
    options: {
      signal?: AbortSignal;
      startTime: number;
      streaming: boolean;
      withRetry: boolean;
      logRequest: boolean;
      finalize: boolean;
      callKind: ExternalCallKind;
      callLabel?: string;
      requestLabel?: string;
      attemptReason?: AttemptReason;
    },
  ): Promise<Result<ChatResponse>> {
    // Capture once before dispatch; settings changes cannot switch a running request or retry.
    const streamTransport: ProviderStreamTransport = this.settingsStore.getSettings().streamingTransport === "renderer-fetch" ? "renderer-fetch" : "node-http";
    const apiFormat = providerConfig.apiFormat as Exclude<ProviderApiFormat, "disabled">;
    const entry = CHAT_PROTOCOL_DISPATCH[apiFormat];
    const baseUrl = providerConfig.baseUrl || DEFAULT_ENDPOINTS[apiFormat];
    const url = entry.buildUrl(baseUrl, request.model);
    const webSearch = resolveWebSearchOptions(request, providerConfig, apiFormat);
    const built = entry.buildBody(request, webSearch);
    if (entry.requiresNonEmptyContent && built.contentCount === 0) {
      return err("E101_INVALID_INPUT", `${entry.requestLabel}至少需要一条非 system 消息`);
    }

    if (options.logRequest) {
      this.logger.debug("ProviderManager", entry.logMessage, {
        event: "API_REQUEST",
        providerId: request.providerId,
        model: request.model,
        requestLabel: request.requestLabel,
        url: sanitizeUrl(url),
        apiKeyConfigured: providerConfig.apiKey.length > 0,
        messageCount: built.contentCount,
        ...samplingEvidence(request, built.body),
        webSearchEnabled: !!webSearch,
        promptCacheMode: request.promptCacheMode,
        promptCacheKeyConfigured: !!request.promptCacheKey,
      });
    }

    const execute = (reason: AttemptReason) => this.requestExecutor.executeProtocolRequest(
      url,
      built.body,
      providerConfig.apiKey,
      options.signal,
      options.streaming,
      options.requestLabel ?? request.requestLabel,
      this.callContext(options.callKind, request.providerId, request.model, apiFormat, options.callLabel ?? request.requestLabel, reason),
      entry.adapter,
      streamTransport,
    );

    const result = options.withRetry && !(options.streaming && streamTransport === "renderer-fetch")
      ? await this.executeWithProviderRetry(
        execute,
        request.providerId,
        request.requestLabel ? `${entry.requestLabel} (${request.requestLabel})` : entry.requestLabel,
        options.signal,
        request.attemptReason,
      )
      : await execute(options.attemptReason ?? "initial");

    return options.finalize
      ? this.finalizeChatResult(request, result, options.startTime, entry.adapter.displayName, built.body)
      : result;
  }

  /** 释放资源：清除缓存和监听器 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.transport.dispose();
  }

}
