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
  parseOpenAIEmbedResponse,
} from "./provider-response-parsers";
import {
  resolveWebSearchOptions,
  validateChatParameters,
  buildJsonSchemaResponseFormat,
} from "./provider-request-builders";
import {
  aggregateProviderStream,
  readProviderStreamUsage,
  hasProviderStreamFraming,
  safeStreamResponseEvidence,
  ProviderStreamAbortError,
  ProviderStreamNetworkError,
  ProviderStreamTimeoutError,
} from "./provider-streaming";
import type {
  ExternalCallKind,
  ExternalCallLedger,
  AttemptReason,
  ExternalCallDiagnostics,
} from "./external-call-ledger";
import { InMemoryExternalCallLedger } from "./external-call-ledger";
import { readProviderTokenUsage, deriveResponseCacheUsage, applyProviderTokenUsage } from "./provider-token-usage";
import type { ModelGateway } from "./model-gateway";
import type { ProviderProbeRequest } from "./model-gateway";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import type {
  ProviderStreamProtocol,
  ProviderStreamTransport,
} from "./provider-streaming";
import {
  ObsidianProviderTransport,
  ProviderAbortError,
  ProviderTimeoutError,
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
  ProviderAuthScheme,
} from "./chat-protocol-adapter";

/** URL 脱敏：日志只保留协议、主机和路径。 */
function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/** 文本脱敏（避免错误详情携带 API key 或 Authorization 头） */
function sanitizeSensitiveText(raw: string, apiKey?: string): string {
  let sanitized = raw;
  if (apiKey) {
    sanitized = sanitized.split(apiKey).join("[redacted-api-key]");
  }
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  sanitized = sanitized.replace(
    /\b(api[_-]?key|x[_-]?api[_-]?key|x[_-]?goog[_-]?api[_-]?key|access[_-]?token|api[_-]?token|authorization|password|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    "$1=[redacted]",
  );
  return sanitized.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url));
}

const MAX_PROVIDER_ERROR_DETAIL_LENGTH = 500;

function sanitizeProviderErrorDetail(raw: string, apiKey?: string): string {
  const sanitized = sanitizeSensitiveText(raw, apiKey).trim();
  if (sanitized.length <= MAX_PROVIDER_ERROR_DETAIL_LENGTH) {
    return sanitized;
  }
  return `${sanitized.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH - 3)}...`;
}

/** 只把有限的结构诊断写入日志，排除完整响应和请求正文。 */
function summarizeProviderErrorDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const source = details as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["status", "kind", "phase", "timeoutMs", "providerType", "providerCode", "providerParam", "providerMessage", "eventType", "incompleteReason"]) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") summary[key] = value;
  }
  const shape = source.responseShape;
  if (shape && typeof shape === "object" && !Array.isArray(shape)) {
    const safeShape = shape as Record<string, unknown>;
    summary.responseShape = {
      status: typeof safeShape.status === "string" ? safeShape.status : undefined,
      incompleteReason: typeof safeShape.incompleteReason === "string" ? safeShape.incompleteReason : undefined,
      hasOutputText: typeof safeShape.hasOutputText === "boolean" ? safeShape.hasOutputText : undefined,
      outputItemCount: typeof safeShape.outputItemCount === "number" ? safeShape.outputItemCount : undefined,
      outputTypes: Array.isArray(safeShape.outputTypes) ? safeShape.outputTypes.slice(0, 12) : undefined,
      contentTypes: Array.isArray(safeShape.contentTypes) ? safeShape.contentTypes.slice(0, 12) : undefined,
      hasChoicesFallback: typeof safeShape.hasChoicesFallback === "boolean" ? safeShape.hasChoicesFallback : undefined,
    };
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** HTTP 错误响应 */
interface HttpErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
}

interface ProviderCallContext {
  kind: ExternalCallKind;
  providerId: string;
  model: string;
  protocol: string;
  label?: string;
  reason?: AttemptReason;
  parentAttemptId?: string;
}

function buildAuthHeaders(apiKey: string, authScheme: ProviderAuthScheme): Record<string, string> {
  if (!apiKey) return {};
  switch (authScheme) {
    case "gemini":
      return { "x-goog-api-key": apiKey };
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}

/** Declarative chat capability gates: the first violated rule produces the error. */
const CHAT_CAPABILITY_RULES: ReadonlyArray<{
  violated: (request: ChatRequest, apiFormat: ProviderApiFormat) => boolean;
  message: string;
}> = [
  { violated: (request, apiFormat) => !!request.webSearch && apiFormat === "openai-chat-completions", message: "当前聊天协议不支持原生搜索，请选择 Responses 或 Gemini" },
  { violated: (request, apiFormat) => !!request.promptCacheKey && apiFormat !== "openai-responses", message: "提示词缓存仅支持 OpenAI Responses 协议" },
  { violated: (request, apiFormat) => !!request.previousResponseId && apiFormat !== "openai-responses", message: "Responses 续传仅支持 OpenAI Responses 协议" },
  { violated: (request, apiFormat) => request.capabilities?.promptCaching === true && apiFormat !== "openai-responses", message: "已启用提示词缓存，但所选协议不支持该能力" },
  { violated: (request, apiFormat) => request.capabilities?.responseContinuation === true && apiFormat !== "openai-responses", message: "已启用 Responses 续传，但所选协议不支持该能力" },
  { violated: (request, apiFormat) => request.capabilities?.nativeWebSearch === true && apiFormat === "openai-chat-completions", message: "已启用原生搜索，但所选协议不支持该能力" },
];

function validateChatCapabilities(request: ChatRequest, apiFormat: ProviderApiFormat): Result<void> {
  for (const rule of CHAT_CAPABILITY_RULES) {
    if (rule.violated(request, apiFormat)) return err("E101_INVALID_INPUT", rule.message);
  }
  return ok(undefined);
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
  private disposed = false;

  constructor(
    settingsStore: SettingsStore,
    logger: ILogger,
    retryHandler?: RetryHandler,
    streamRequester?: ConstructorParameters<typeof ObsidianProviderTransport>[0],
    ledger: ExternalCallLedger = new InMemoryExternalCallLedger(),
  ) {
    this.settingsStore = settingsStore;
    this.logger = logger;
    this.retryHandler = retryHandler || new RetryHandler(logger);
    this.transport = new ObsidianProviderTransport(streamRequester);
    this.ledger = ledger;

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
    const capabilityCheck = validateChatCapabilities(request, apiFormat);
    if (!capabilityCheck.ok) {
      return capabilityCheck;
    }
    const parameterResult = validateChatParameters(request, apiFormat);
    if (!parameterResult.ok) {
      return parameterResult;
    }
    return this.dispatchChat(request, providerConfig, {
      signal,
      startTime,
      streaming: this.isStreamingEnabled(),
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
      (reason) => this.executeEmbedRequest(
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
    const messages = [{ role: "user" as const, content: "Reply with OK." }];
    const probeRequest: ChatRequest = {
      providerId,
      providerSnapshot: config,
      model,
      messages,
      capabilities: taskConfig?.capabilities,
      temperature: taskConfig?.temperature,
      topP: taskConfig?.topP,
      maxTokens: taskConfig?.maxTokens,
      reasoning_effort: taskConfig?.reasoningEffort,
      thinkingLevel: taskConfig?.thinkingLevel,
      thinkingBudget: taskConfig?.thinkingBudget,
      response_format: taskConfig?.capabilities.structuredOutput === "json_schema"
        ? buildJsonSchemaResponseFormat("probe_output", { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false })
        : taskConfig?.capabilities.structuredOutput === "json_object" ? { type: "json_object" } : undefined,
      webSearch: taskConfig?.capabilities.nativeWebSearch ? { purpose: "write" } : undefined,
    };
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
    const result = await this.executeEmbedRequest(
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
    protocolLabel: string
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

  /** 使用 Obsidian requestUrl 绕过桌面端 CORS 限制。 */
  private async executeJsonRequest<T>(
    url: string,
    body: object,
    apiKey: string,
    signal: AbortSignal | undefined,
    parse: (data: unknown) => Result<T>,
    extraHeaders: Record<string, string> = {},
    authScheme: ProviderAuthScheme = "bearer",
    callContext?: ProviderCallContext,
  ): Promise<Result<T>> {
    const attempt = this.ledger.begin(callContext ?? {
      kind: "model",
      protocol: authScheme,
      providerId: "unknown",
      model: "unknown",
    });
    if (signal?.aborted) {
      attempt.finish("cancelled", "E310_INVALID_STATE");
      return err("E310_INVALID_STATE", "请求已取消", signal.reason);
    }

    try {
      const params = {
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(apiKey, authScheme),
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        throw: false,
      };

      const timeoutMs = this.settingsStore.getSettings().providerTimeoutMs;
      attempt.markSent();
      const response = await this.transport.requestJson(params, timeoutMs, signal);
      attempt.markResponseReceived();

      if (response.status < 200 || response.status >= 300) {
        const mapped = this.mapHttpError(response.status, typeof response.text === "string" ? response.text : "", apiKey);
        attempt.finish(mapped.ok ? "succeeded" : mapped.error.code === "E206_PROVIDER_REQUEST_UNCERTAIN" ? "uncertain" : "known-failure", mapped.ok ? undefined : mapped.error.code);
        return mapped;
      }

      let payload: unknown;
      try {
        payload = response.json as unknown;
      } catch (parseError) {
        // Obsidian's requestUrl json getter throws on non-JSON 2xx bodies
        // (HTML error pages, etc.). That is a known unsupported response.
        attempt.finish("known-failure", "E207_PROVIDER_RESPONSE_UNSUPPORTED");
        return err(
          "E207_PROVIDER_RESPONSE_UNSUPPORTED",
          "API 返回了非 JSON 响应",
          {
            kind: "non-json",
            rawError: sanitizeProviderErrorDetail(
              parseError instanceof Error ? parseError.message : String(parseError),
              apiKey,
            ),
          },
        );
      }
      attempt.recordUsage(readProviderTokenUsage(callContext?.protocol ?? "unknown", payload));
      const parsed = parse(payload);
      attempt.finish(parsed.ok ? "succeeded" : "known-failure", parsed.ok ? undefined : parsed.error.code);
      return parsed;
    } catch (error) {
      const dispatched = attempt.dispatchState !== "not-sent";
      const cancellationCode = dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E310_INVALID_STATE";
      if (signal?.aborted || error instanceof ProviderAbortError) {
        attempt.finish(dispatched ? "uncertain" : "cancelled", cancellationCode);
        return err(cancellationCode, dispatched ? "请求已发出但结果未知；不会自动重试" : "请求已取消", signal?.reason ?? (error instanceof ProviderAbortError ? error.reason : undefined));
      }
      if (error instanceof ProviderTimeoutError) {
        attempt.finish("uncertain", "E206_PROVIDER_REQUEST_UNCERTAIN");
        return err("E206_PROVIDER_REQUEST_UNCERTAIN", "Provider 请求超时，结果未知；为避免重复计费未自动重试", {
          timeoutMs: error.timeoutMs,
        });
      }
      const rawError = error instanceof Error ? error.message : String(error);
      attempt.finish(dispatched ? "uncertain" : "known-failure", dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E204_PROVIDER_ERROR");
      return err(dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E204_PROVIDER_ERROR", dispatched ? "网络连接中断，结果未知；为避免重复计费未自动重试" : "网络请求失败，请检查网络连接", {
        kind: "network",
        rawError: sanitizeProviderErrorDetail(rawError, apiKey),
      });
    }
  }

  private isStreamingEnabled(): boolean {
    return this.settingsStore.getSettings().enableStreamingKeepalive === true;
  }

  private async executeStreamRequest<T>(
    url: string,
    body: object,
    apiKey: string,
    signal: AbortSignal | undefined,
    protocol: ProviderStreamProtocol,
    parse: (data: unknown) => Result<T>,
    extraHeaders: Record<string, string> = {},
    authScheme: ProviderAuthScheme = "bearer",
    requestLabel?: string,
    callContext?: ProviderCallContext,
    streamTransport: ProviderStreamTransport = "node-http",
  ): Promise<Result<T>> {
    const attempt = this.ledger.begin(callContext ?? {
      kind: "model",
      protocol,
      providerId: "unknown",
      model: "unknown",
      label: requestLabel,
    });

    if (signal?.aborted) {
      attempt.finish("cancelled", "E310_INVALID_STATE");
      return err("E310_INVALID_STATE", "请求已取消", signal.reason);
    }
    if (this.disposed) {
      attempt.finish("cancelled", "E310_INVALID_STATE");
      return err("E310_INVALID_STATE", "Provider 服务已停止");
    }

    try {
      const streamUrl = protocol === "gemini-generative-language"
        ? this.buildGeminiStreamUrl(url)
        : url;
      const streamBody = protocol === "gemini-generative-language"
        ? body
        : { ...body, stream: true };
      const timeoutMs = this.settingsStore.getSettings().providerTimeoutMs;

      this.logger.debug("ProviderManager", "发送流式聊天请求", {
        event: "API_STREAM_REQUEST",
        protocol,
        requestLabel,
        url: sanitizeUrl(streamUrl),
        apiKeyConfigured: apiKey.length > 0,
      });

      attempt.markSent();
      const response = await this.transport.requestStream({
        transport: streamTransport,
        url: streamUrl,
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(apiKey, authScheme),
          ...extraHeaders,
        },
        body: JSON.stringify(streamBody),
        timeoutMs,
        signal,
      });
      attempt.markResponseReceived();
      this.logger.debug("ProviderManager", "流式响应证据（不含正文）", safeStreamResponseEvidence(response, streamTransport));

      if (response.status < 200 || response.status >= 300) {
        const mapped = this.mapHttpError(response.status, streamTransport === "renderer-fetch" ? "" : response.body, apiKey);
        attempt.finish(mapped.ok ? "succeeded" : mapped.error.code === "E206_PROVIDER_REQUEST_UNCERTAIN" ? "uncertain" : "known-failure", mapped.ok ? undefined : mapped.error.code);
        return mapped;
      }

      if (!hasProviderStreamFraming(response.headers, response.body)) {
        // Some compatible relays ignore `stream: true` and return the final
        // protocol response as JSON. It has already completed on this one
        // request, so parse it directly rather than rejecting it or issuing a
        // second request that could duplicate work.
        try {
          const payload: unknown = JSON.parse(response.body);
          attempt.recordUsage(readProviderTokenUsage(protocol, payload));
          const parsed = parse(payload);
          attempt.finish(parsed.ok ? "succeeded" : "known-failure", parsed.ok ? undefined : parsed.error.code);
          return parsed;
        } catch {
          attempt.finish("known-failure", "E207_PROVIDER_RESPONSE_UNSUPPORTED");
          return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Provider 未返回可解析的流式事件或完整响应");
        }
      }
      const observedUsage = readProviderStreamUsage(protocol, response.body);
      attempt.recordUsage(observedUsage);
      const aggregate = aggregateProviderStream(protocol, response.body);
      if (!aggregate.ok) {
        attempt.finish(aggregate.error.code === "E206_PROVIDER_REQUEST_UNCERTAIN" ? "uncertain" : "known-failure", aggregate.error.code);
        return aggregate;
      }
      const parsed = parse(aggregate.value);
      if (parsed.ok && parsed.value !== null && typeof parsed.value === "object") {
        parsed.value = applyProviderTokenUsage(parsed.value, observedUsage);
      }
      attempt.finish(parsed.ok ? "succeeded" : "known-failure", parsed.ok ? undefined : parsed.error.code);
      return parsed;
    } catch (error) {
      const dispatched = attempt.dispatchState !== "not-sent";
      if (signal?.aborted) {
        attempt.finish(dispatched ? "uncertain" : "cancelled", dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E310_INVALID_STATE");
        return err(dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E310_INVALID_STATE", dispatched ? "请求已发出但结果未知；不会自动重试" : "请求已取消", signal.reason);
      }
      if (error instanceof ProviderStreamAbortError) {
        attempt.finish(dispatched ? "uncertain" : "cancelled", dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E310_INVALID_STATE");
        return err(this.disposed ? "E310_INVALID_STATE" : "E206_PROVIDER_REQUEST_UNCERTAIN", this.disposed ? "Provider 服务已停止" : "请求已发出但结果未知；不会自动重试", error.reason);
      }
      if (error instanceof ProviderStreamTimeoutError) {
        attempt.finish("uncertain", "E206_PROVIDER_REQUEST_UNCERTAIN");
        return err("E206_PROVIDER_REQUEST_UNCERTAIN", "Provider 流式请求超时，结果未知；为避免重复计费未自动重试", {
          transport: streamTransport,
          timeoutKind: "timeoutKind" in error ? error.timeoutKind : "idle",
          timeoutMs: error.timeoutMs,
          phase: error.phase,
        });
      }
      if (error instanceof ProviderStreamNetworkError) {
        // Fixed diagnostic fields only: no endpoint, headers, certificate body,
        // request payload or original error message goes into this log event.
        this.logger.warn("ProviderManager", "流式传输失败（安全诊断）", {
          event: "STREAM_TRANSPORT_FAILURE",
          transport: streamTransport,
          phase: error.phase,
          networkCode: error.networkCode,
        });
        attempt.finish("uncertain", "E206_PROVIDER_REQUEST_UNCERTAIN");
        return err("E206_PROVIDER_REQUEST_UNCERTAIN", "Provider 流式连接中断，结果未知；为避免重复计费未自动重试", {
          kind: "network",
          phase: error.phase,
          transport: streamTransport,
          networkCode: error.networkCode,
        });
      }
      const rawError = error instanceof Error ? error.message : String(error);
      attempt.finish(dispatched ? "uncertain" : "known-failure", dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E204_PROVIDER_ERROR");
      return err(dispatched ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E204_PROVIDER_ERROR", dispatched ? "网络连接中断，结果未知；为避免重复计费未自动重试" : "网络请求失败，请检查网络连接", {
        kind: "network",
        rawError: sanitizeProviderErrorDetail(rawError, apiKey),
      });
    }
  }

  private buildGeminiStreamUrl(url: string): string {
    const streamUrl = new URL(url);
    if (streamUrl.pathname.endsWith(":generateContent")) {
      streamUrl.pathname = `${streamUrl.pathname.slice(0, -":generateContent".length)}:streamGenerateContent`;
    }
    streamUrl.searchParams.set("alt", "sse");
    return streamUrl.toString();
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
        webSearchEnabled: !!webSearch,
        promptCacheMode: request.promptCacheMode,
        promptCacheKeyConfigured: !!request.promptCacheKey,
      });
    }

    const execute = (reason: AttemptReason) => this.executeProtocolRequest(
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
      ? this.finalizeChatResult(request, result, options.startTime, entry.adapter.displayName)
      : result;
  }

  /** Shared transport dispatch for all chat protocols. */
  private executeProtocolRequest(
    url: string,
    body: object,
    apiKey: string,
    signal: AbortSignal | undefined,
    useStreaming: boolean,
    requestLabel: string | undefined,
    callContext: ProviderCallContext | undefined,
    adapter: ProtocolAdapterMetadata,
    streamTransport: ProviderStreamTransport = "node-http",
  ): Promise<Result<ChatResponse>> {
    return useStreaming
      ? this.executeStreamRequest(url, body, apiKey, signal, adapter.streamProtocol, adapter.parseResponse, {}, adapter.authScheme, requestLabel, callContext, streamTransport)
      : this.executeJsonRequest(url, body, apiKey, signal, adapter.parseResponse, adapter.extraHeaders ?? {}, adapter.authScheme, callContext);
  }

  /** 执行嵌入请求（单次，不含重试逻辑） */
  private async executeEmbedRequest(
    url: string,
    body: object,
    apiKey: string,
    signal?: AbortSignal,
    callContext?: ProviderCallContext,
  ): Promise<Result<EmbedResponse>> {
    return this.executeJsonRequest(url, body, apiKey, signal, parseOpenAIEmbedResponse, {}, "bearer", callContext);
  }

  /**
   * 将 HTTP 状态码映射为错误结果
   * 用户可见消息仅包含错误码和安全描述，原始 API 响应放入 details。
   */
  private mapHttpError(status: number, responseText: string, apiKey?: string): Result<never> {
    // 解析原始响应用于日志/调试（放入 details，不暴露给用户）
    let rawDetail = responseText;
    let providerType: string | undefined;
    let providerCode: string | undefined;
    let providerParam: string | undefined;
    try {
      const errorData: HttpErrorResponse = JSON.parse(responseText);
      if (errorData.error?.message) {
        rawDetail = errorData.error.message;
      }
      providerType = errorData.error?.type;
      providerCode = errorData.error?.code;
      providerParam = errorData.error?.param;
    } catch {
      // 保持原始文本
    }
    rawDetail = sanitizeProviderErrorDetail(rawDetail, apiKey);

    // 认证错误 (401/403) → E203_INVALID_API_KEY
    if (status === 401 || status === 403) {
      return err("E203_INVALID_API_KEY", "认证失败，请检查 API Key 是否正确", { status, rawResponse: rawDetail });
    }

    // 速率限制 (429) → E202_RATE_LIMITED
    if (status === 429) {
      return err("E202_RATE_LIMITED", "请求频率超限，请稍后重试", { status, rawResponse: rawDetail });
    }

    // A 408 does not prove that a generation was never accepted upstream.
    // Keep the request in the same explicit-confirmation bucket as network
    // timeouts so an automatic retry cannot duplicate a billable operation.
    if (status === 408) {
      return err(
        "E206_PROVIDER_REQUEST_UNCERTAIN",
        "Provider 请求超时，结果未知；为避免重复计费未自动重试",
        { status, kind: "upstream-http", rawResponse: rawDetail },
      );
    }

    // 网关/代理在长请求中可能已经把请求转发给模型，再返回 502/503/504。
    // Cloudflare 524 表示上游已接收请求但响应超时，同样不能证明模型未执行。
    // 这类响应无法证明模型未执行，禁止自动重试以避免重复计费。
    if (status === 502 || status === 503 || status === 504 || status === 524) {
      return err(
        "E206_PROVIDER_REQUEST_UNCERTAIN",
        `Provider/中转上游连接中断 (${status})，结果未知；为避免重复计费未自动重试`,
        { status, kind: "upstream-http", rawResponse: rawDetail },
      );
    }

    if (status >= 500) {
      return err("E204_PROVIDER_ERROR", `Provider/中转上游错误 (${status})，请稍后重试`, { status, rawResponse: rawDetail });
    }

    // 服务端已经明确拒绝的请求不会因原样重发而恢复。
    if (status >= 400 && status < 500) {
      return err("E205_PROVIDER_REQUEST_INVALID", `API 请求无效 (${status})，请检查协议、模型和参数`, {
        status,
        rawResponse: rawDetail,
        providerMessage: rawDetail,
        ...(providerType ? { providerType } : {}),
        ...(providerCode ? { providerCode } : {}),
        ...(providerParam ? { providerParam } : {}),
      });
    }

    return err("E204_PROVIDER_ERROR", `API 返回异常状态 (${status})`, { status, rawResponse: rawDetail });
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
