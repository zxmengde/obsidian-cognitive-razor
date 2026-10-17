import { err } from "../types";
import type { ChatResponse, EmbedResponse, ILogger, Result } from "../types";
import type { SettingsStore } from "../data/settings-store";
import type { ExternalCallKind, ExternalCallLedger, AttemptReason } from "./external-call-ledger";
import type { ProtocolAdapterMetadata, ProviderAuthScheme } from "./chat-protocol-adapter";
import { ProviderAbortError, ProviderTimeoutError, type ProviderTransport } from "./provider-transport";
import { ProviderStreamAbortError, ProviderStreamNetworkError, ProviderStreamTimeoutError } from "./provider-streaming";
import type { ProviderStreamProtocol, ProviderStreamTransport } from "./provider-streaming";
import { aggregateProviderStream, hasProviderStreamFraming, readProviderStreamUsage, safeStreamResponseEvidence } from "./provider-stream-codec";
import { applyProviderTokenUsage, readProviderTokenUsage } from "./provider-token-usage";
import { parseOpenAIEmbedResponse } from "./provider-response-parsers";
import { mapHttpError, sanitizeProviderErrorDetail, sanitizeUrl } from "./provider-errors";

export interface ProviderCallContext {
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

/** 单次请求在这里完成传输、用量记录和错误映射；重试仍由调用方决定。 */
export class ProviderRequestExecutor {
  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly logger: ILogger,
    private readonly ledger: ExternalCallLedger,
    private readonly transport: ProviderTransport,
    private readonly isDisposed: () => boolean,
  ) {}

  /** Shared transport dispatch for all chat protocols. */
  executeProtocolRequest(
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
  async executeEmbedRequest(
    url: string,
    body: object,
    apiKey: string,
    signal?: AbortSignal,
    callContext?: ProviderCallContext,
  ): Promise<Result<EmbedResponse>> {
    return this.executeJsonRequest(url, body, apiKey, signal, parseOpenAIEmbedResponse, {}, "bearer", callContext);
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
        const mapped = mapHttpError(response.status, typeof response.text === "string" ? response.text : "", apiKey);
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
    if (this.isDisposed()) {
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
        protocol,
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
        const mapped = mapHttpError(response.status, streamTransport === "renderer-fetch" ? "" : response.body, apiKey);
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
        return err(this.isDisposed() ? "E310_INVALID_STATE" : "E206_PROVIDER_REQUEST_UNCERTAIN", this.isDisposed() ? "Provider 服务已停止" : "请求已发出但结果未知；不会自动重试", error.reason);
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

}
