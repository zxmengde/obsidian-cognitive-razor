import * as http from "http";
import * as https from "https";
import type { ClientRequest, IncomingMessage } from "http";
import { err, ok } from "../types";
import type { Result } from "../types";
import { readProviderTokenUsage, type ProviderTokenUsage } from "./provider-token-usage";

export type ProviderStreamProtocol =
  | "openai-chat-completions"
  | "openai-responses"
  | "gemini-generative-language";

export type ProviderStreamTransport = "node-http" | "renderer-fetch";

export interface ProviderStreamRequest {
  /** Lets the transport honor authoritative Responses terminal events. */
  protocol?: ProviderStreamProtocol;
  transport?: ProviderStreamTransport;
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ProviderStreamDiagnostics {
  chunkCount: number;
  byteCount: number;
  firstResponseMs: number;
  firstChunkMs: number | null;
  chunkSpanMs: number;
  maxChunkGapMs: number;
}

export interface ProviderStreamResponse {
  diagnostics?: ProviderStreamDiagnostics;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Whitelist-only completion event; never expose raw headers, URLs or body. */
export function safeStreamResponseEvidence(response: ProviderStreamResponse, transport: ProviderStreamTransport) {
  const rawType = (Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "").split(";", 1)[0].trim().toLowerCase();
  const responseContentType = ["text/event-stream", "application/json", "application/x-ndjson"].includes(rawType) ? rawType : "unknown";
  let framing: "SSE" | "JSON" | "unknown" = "unknown";
  if (/^(?:data|event|id|retry):/m.test(response.body)) framing = "SSE";
  else { try { JSON.parse(response.body); framing = "JSON"; } catch { /* Unknown framing stays unknown. */ } }
  const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    event: "STREAM_RESPONSE_EVIDENCE", transport, responseContentType, framing,
    dispatchCount: 1,
    chunkCount: finite(response.diagnostics?.chunkCount), byteCount: finite(response.diagnostics?.byteCount),
    firstResponseMs: finite(response.diagnostics?.firstResponseMs), firstChunkMs: finite(response.diagnostics?.firstChunkMs),
    chunkSpanMs: finite(response.diagnostics?.chunkSpanMs), maxChunkGapMs: finite(response.diagnostics?.maxChunkGapMs),
  };
}

export type ProviderStreamRequester = (
  request: ProviderStreamRequest,
) => Promise<ProviderStreamResponse>;

export type ProviderStreamPhase = "before-response" | "after-response";

export class ProviderStreamTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly phase: ProviderStreamPhase) {
    super(`Provider stream was idle for ${timeoutMs}ms`);
    this.name = "ProviderStreamTimeoutError";
  }
}

export class ProviderStreamAbortError extends Error {
  constructor(readonly reason: unknown) {
    super("Provider stream aborted");
    this.name = "ProviderStreamAbortError";
  }
}

const SAFE_NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE",
  "ENETUNREACH", "EHOSTUNREACH", "EACCES", "EPERM", "EPROTO",
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Never infer a diagnostic from a URL, certificate text or raw error message. */
export function safeStreamNetworkCode(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "UNKNOWN";
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" && SAFE_NETWORK_CODES.has(code) ? code : "UNKNOWN";
}

export class ProviderStreamNetworkError extends Error {
  readonly networkCode: string;
  constructor(
    readonly phase: ProviderStreamPhase,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderStreamNetworkError";
    this.networkCode = safeStreamNetworkCode(cause);
  }
}

/** Reject a completed JSON body masquerading as a stream response. */
export function hasProviderStreamFraming(
  headers: Record<string, string>,
  body: string,
): boolean {
  // Some relays retain an SSE MIME type even when returning one complete
  // protocol envelope. Do not feed its message into the delta aggregator.
  try {
    const payload = asRecord(JSON.parse(body));
    if (payload && (
      (Array.isArray(payload.choices) && payload.choices.some((choice) => asRecord(choice)?.message !== undefined))
      || Array.isArray(payload.candidates)
      || Array.isArray(payload.output)
      || typeof payload.output_text === "string"
    )) return false;
  } catch { /* Actual framed events continue through the stream parser. */ }
  const contentType = (Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "").toLowerCase();
  if (contentType.includes("text/event-stream") || contentType.includes("ndjson")) {
    return true;
  }
  if (/^\s*(?:data|event|id|retry):|^\s*:/m.test(body)) return true;

  const lines = body.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.every((line) => {
    try {
      JSON.parse(line);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Stream requests deliberately use Node's HTTP client. Obsidian's requestUrl
 * bypasses CORS but exposes only a completed response, while renderer fetch is
 * subject to the app:// origin and proxy CORS policy.
 */
export const requestProviderStream: ProviderStreamRequester = (input) =>
  new Promise<ProviderStreamResponse>((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new ProviderStreamAbortError(input.signal.reason));
      return;
    }

    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let responseStarted = false;
    let responseEnded = false;
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const terminal = createResponsesStreamCompletionTracker(input.protocol);
    const streamDecoder = new TextDecoder();

    const cleanup = (): void => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler);
        abortHandler = undefined;
      }
    };

    const settleResolve = (value: ProviderStreamResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      request?.destroy();
      response?.destroy();
      reject(error);
    };

    const armTimeout = (): void => {
      if (settled) return;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        settleReject(new ProviderStreamTimeoutError(
          input.timeoutMs,
          responseStarted ? "after-response" : "before-response",
        ));
      }, input.timeoutMs);
    };

    const failNetwork = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      settleReject(new ProviderStreamNetworkError(
        responseStarted ? "after-response" : "before-response",
        message,
        error,
      ));
    };

    const toHeaders = (incoming: IncomingMessage): Record<string, string> => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {
          headers[key] = value.join(", ");
        } else if (value !== undefined) {
          headers[key] = value;
        }
      }
      return headers;
    };

    const decodeBody = (): string => {
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    };

    const handleResponse = (incoming: IncomingMessage): void => {
      responseStarted = true;
      response = incoming;
      armTimeout();

      incoming.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        armTimeout();
        const bytes = typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : Uint8Array.from(chunk);
        chunks.push(bytes);
        totalBytes += bytes.byteLength;
        const end = terminal?.(streamDecoder.decode(bytes, { stream: true }));
        if (end !== undefined && (incoming.statusCode ?? 0) >= 200 && (incoming.statusCode ?? 0) < 300) {
          responseEnded = true;
          settleResolve({ status: incoming.statusCode ?? 0, headers: toHeaders(incoming), body: decodeBody().slice(0, end) });
          incoming.destroy();
          request?.destroy();
        }
      });
      incoming.once("end", () => {
        responseEnded = true;
        settleResolve({
          status: incoming.statusCode ?? 0,
          headers: toHeaders(incoming),
          body: decodeBody(),
        });
      });
      incoming.once("aborted", () => failNetwork(new Error("Provider response was aborted")));
      incoming.once("error", failNetwork);
      incoming.once("close", () => {
        if (!responseEnded) {
          failNetwork(new Error("Provider response closed before completion"));
        }
      });
    };

    try {
      const url = new URL(input.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Unsupported provider URL protocol: ${url.protocol}`);
      }

      const requestOptions: http.RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...input.headers,
          Accept: input.headers.Accept ?? "text/event-stream",
          "Accept-Encoding": input.headers["Accept-Encoding"] ?? "identity",
          Connection: input.headers.Connection ?? "keep-alive",
        },
      };

      const transport = url.protocol === "https:" ? https : http;
      request = transport.request(requestOptions, handleResponse);
      request.once("error", failNetwork);
      request.once("close", () => {
        if (!responseStarted && !settled) {
          failNetwork(new Error("Provider request closed before response"));
        }
      });

      abortHandler = () => {
        settleReject(new ProviderStreamAbortError(input.signal?.reason));
      };
      input.signal?.addEventListener("abort", abortHandler, { once: true });
      if (input.signal?.aborted) {
        settleReject(new ProviderStreamAbortError(input.signal.reason));
        return;
      }

      armTimeout();
      request.write(input.body);
      request.end();
    } catch (error) {
      failNetwork(error);
    }
  });

interface StreamEvent {
  name?: string;
  data: unknown;
}

function streamUnsupported(message: string): Result<never> {
  return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", message);
}

function streamUncertain(message: string): Result<never> {
  return err("E206_PROVIDER_REQUEST_UNCERTAIN", `${message}，结果未知；不会自动重试`);
}

function streamFailed(protocol: string, eventType: string, data: Record<string, unknown>): Result<never> {
  const response = asRecord(data.response);
  const error = asRecord(data.error) ?? asRecord(response?.error);
  const rawCode = error?.code ?? error?.type ?? error?.status ?? data.code;
  const normalizedCode = typeof rawCode === "string" || typeof rawCode === "number"
    ? String(rawCode).trim()
    : "";
  const providerCode = /^[A-Za-z0-9_.:-]{1,80}$/.test(normalizedCode)
    ? normalizedCode
    : undefined;
  const suffix = providerCode ? `，上游代码 ${providerCode}` : "";
  const errorCode = providerCode === "invalid_request" || providerCode === "invalid_request_error"
    ? "E205_PROVIDER_REQUEST_INVALID"
    : providerCode === "server_error" || providerCode === "service_unavailable" || providerCode === "internal_error"
      ? "E204_PROVIDER_ERROR"
      : "E208_PROVIDER_STREAM_FAILED";
  // E204 is retryable via RetryHandler; only non-retryable codes promise no auto-retry.
  const retryNote = errorCode === "E204_PROVIDER_ERROR" ? "" : "；未自动重试";
  return err(
    errorCode,
    `${protocol} 流式请求明确失败（事件 ${eventType}${suffix}）${retryNote}`,
    { eventType, providerCode },
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJsonEvent(raw: string): Result<unknown> {
  if (raw.trim() === "[DONE]") return ok("[DONE]");
  try {
    return ok(JSON.parse(raw));
  } catch {
    return streamUnsupported("Provider 流式事件不是有效 JSON");
  }
}

function parseSseEvents(body: string, onEvent?: (event: StreamEvent) => void): Result<StreamEvent[]> {
  const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const hasSseFields = lines.some((line) => /^(?:data|event|id|retry):/.test(line));
  if (!hasSseFields) {
    const events: StreamEvent[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      const parsed = parseJsonEvent(trimmed);
      if (!parsed.ok) return parsed;
      const event = { data: parsed.value };
      events.push(event);
      onEvent?.(event);
    }
    return events.length > 0 ? ok(events) : streamUnsupported("Provider 没有返回流式事件");
  }

  const events: StreamEvent[] = [];
  let eventName: string | undefined;
  let dataLines: string[] = [];
  const flush = (): Result<void> => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return ok(undefined);
    }
    const parsed = parseJsonEvent(dataLines.join("\n"));
    if (!parsed.ok) return parsed;
    const event = { name: eventName, data: parsed.value };
    events.push(event);
    onEvent?.(event);
    eventName = undefined;
    dataLines = [];
    return ok(undefined);
  };

  for (const line of lines) {
    if (line === "") {
      const result = flush();
      if (!result.ok) return result;
      continue;
    }
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      if (dataLines.length > 0) {
        const result = flush();
        if (!result.ok) return result;
      }
      eventName = line.slice("event:".length).trim() || undefined;
      continue;
    }
    if (line.startsWith("data:")) {
      // Some relays omit the blank line between JSON events. Flush only when
      // the accumulated data is already a complete JSON value, preserving
      // legitimate multi-line SSE payloads.
      if (dataLines.length > 0) {
        const candidate = dataLines.join("\n").trim();
        if (candidate && parseJsonEvent(candidate).ok) {
          const result = flush();
          if (!result.ok) return result;
        }
      }
      dataLines.push(line.slice("data:".length).trimStart());
      continue;
    }
    if (line.startsWith("id:") || line.startsWith("retry:")) continue;
    return streamUnsupported("Provider 流式事件包含未知 SSE 字段");
  }

  const result = flush();
  if (!result.ok) return result;
  return events.length > 0 ? ok(events) : streamUnsupported("Provider 没有返回流式事件");
}

/** Detect a fully framed terminal event without waiting for proxy EOF.
 * Only transport completion changes; aggregation still decides success/error.
 * Return the decoded-text boundary so a partial trailer cannot corrupt it. */
export function createResponsesStreamCompletionTracker(protocol?: ProviderStreamProtocol): ((chunk: string) => number | undefined) | undefined {
  if (protocol !== "openai-responses") return undefined;
  let line = "", lines: string[] = [], offset = 0, skipLf = false;
  return (chunk) => {
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index];
      offset++;
      if (skipLf && char === "\n") { skipLf = false; continue; }
      skipLf = false;
      if (char !== "\r" && char !== "\n") { line += char; continue; }
      skipLf = char === "\r";
      if (line) { lines.push(line); line = ""; continue; }
      const parsed = parseSseEvents(`${lines.join("\n")}\n\n`.replace(/^\uFEFF/, ""));
      lines = [];
      if (parsed.ok && parsed.value.some(event => {
        const data = asRecord(event.data);
        const type = typeof data?.type === "string" ? data.type : event.name;
        return type === "response.completed" || type === "response.done" || type === "response.incomplete" || type === "response.failed" || type === "error";
      })) return offset;
    }
    return undefined;
  };
}

function textFromDelta(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (record) {
    if (record.text !== undefined) return textFromDelta(record.text, depth + 1);
    if (record.value !== undefined) return textFromDelta(record.value, depth + 1);
  }
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    return textFromDelta(part, depth + 1);
  }).join("");
}

function aggregateOpenAIChat(events: StreamEvent[]): Result<unknown> {
  let content = "";
  let finishReason: string | undefined;
  let usage: Record<string, unknown> | undefined;
  let sawDone = false;

  for (const event of events) {
    if (event.data === "[DONE]") {
      sawDone = true;
      continue;
    }
    const data = asRecord(event.data);
    if (!data) return streamUnsupported("Chat Completions 流式事件不是对象");
    if (data.error !== undefined || data.type === "error" || event.name === "error") {
      return streamFailed("Chat Completions", "error", data);
    }
    const eventUsage = asRecord(data.usage);
    if (eventUsage) usage = eventUsage;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = asRecord(choices[0]);
    const delta = asRecord(choice?.delta);
    const deltaText = textFromDelta(delta?.content);
    if (deltaText) {
      content += deltaText;
    }
    if (typeof choice?.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
  }

  if (!sawDone && !finishReason) {
    return streamUncertain("Chat Completions 流式响应缺少结束事件");
  }
  const response: Record<string, unknown> = {
    choices: [{ message: { content }, finish_reason: finishReason }],
  };
  if (usage) response.usage = usage;
  return ok(response);
}

function aggregateOpenAIResponses(events: StreamEvent[]): Result<unknown> {
  let response: Record<string, unknown> | undefined;
  let outputText = "";
  let outputTextDone: string | undefined;
  let terminalStatus: "completed" | "incomplete" | undefined;
  const outputItems = new Map<number, Record<string, unknown>>();
  const annotations: unknown[] = [];

  const mergeResponseEnvelope = (data: Record<string, unknown>): void => {
    const eventResponse = asRecord(data.response) ?? (
      typeof data.status === "string" || Array.isArray(data.output) ? data : undefined
    );
    if (eventResponse) response = { ...(response ?? {}), ...eventResponse };
  };

  for (const event of events) {
    if (event.data === "[DONE]") continue;
    const data = asRecord(event.data);
    if (!data) return streamUnsupported("Responses 流式事件不是对象");
    const type = typeof data.type === "string" ? data.type : event.name;
    switch (type) {
      case "response.created":
      case "response.in_progress":
        mergeResponseEnvelope(data);
        break;
      case "response.output_text.delta":
        outputText += textFromDelta(data.delta);
        break;
      case "response.output_text.done":
        outputTextDone = textFromDelta(data.text ?? data.value);
        break;
      case "response.output_text.annotation.added":
        if (data.annotation !== undefined) annotations.push(data.annotation);
        break;
      case "response.output_item.added":
      case "response.output_item.done": {
        const item = asRecord(data.item);
        const index = typeof data.output_index === "number" ? data.output_index : outputItems.size;
        if (item) outputItems.set(index, { ...(outputItems.get(index) ?? {}), ...item });
        break;
      }
      case "response.completed":
        terminalStatus = "completed";
        mergeResponseEnvelope(data);
        break;
      case "response.done":
        terminalStatus = "completed";
        mergeResponseEnvelope(data);
        break;
      case "response.incomplete":
        terminalStatus = "incomplete";
        mergeResponseEnvelope(data);
        break;
      case "response.failed":
      case "error":
        return streamFailed("Responses", type, data);
      default:
        // Future metadata events are harmless; the terminal event and the
        // existing full-response parser remain the source of truth.
        break;
    }
  }

  if (!terminalStatus) return streamUncertain("Responses 流式响应缺少完成事件");
  const result: Record<string, unknown> = {
    ...(response ?? {}),
    // The terminal event is authoritative; relays sometimes leave the
    // earlier `in_progress` status on the final envelope.
    status: terminalStatus,
  };
  const completedText = textFromDelta(response?.output_text);
  if (!completedText && (outputText || outputTextDone !== undefined)) {
    result.output_text = outputTextDone ?? outputText;
  }
  // `response.created` often includes `output: []`. An empty array must not
  // block streamed output_item events from becoming the final output.
  const envelopeOutput = Array.isArray(result.output) ? result.output : undefined;
  if (outputItems.size > 0 && (!envelopeOutput || envelopeOutput.length === 0)) {
    result.output = [...outputItems.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item);
  }
  if (!Array.isArray(result.output) && (outputText || outputTextDone !== undefined)) {
    result.output = [{
      type: "message",
      content: [{
        type: "output_text",
        text: outputTextDone ?? outputText,
        annotations,
      }],
    }];
  } else if (Array.isArray(result.output) && (outputText || outputTextDone !== undefined)) {
    const finalText = outputTextDone ?? outputText;
    const message = result.output.find((item) => asRecord(item)?.type === "message");
    const messageRecord = asRecord(message);
    if (!messageRecord) {
      result.output.push({
        type: "message",
        content: [{
          type: "output_text",
          text: finalText,
          annotations,
        }],
      });
    } else {
      const content = Array.isArray(messageRecord.content) ? messageRecord.content : [];
      const outputPart = content.find((item) => asRecord(item)?.type === "output_text");
      const outputPartRecord = asRecord(outputPart);
      if (outputPartRecord) {
        if (typeof outputPartRecord.text !== "string" || outputPartRecord.text.length === 0) {
          outputPartRecord.text = finalText;
        }
        if (annotations.length > 0 && !Array.isArray(outputPartRecord.annotations)) {
          outputPartRecord.annotations = annotations;
        }
      } else {
        content.push({
          type: "output_text",
          text: finalText,
          annotations,
        });
        messageRecord.content = content;
      }
    }
  } else if (annotations.length > 0 && Array.isArray(result.output)) {
    const message = result.output.find((item) => asRecord(item)?.type === "message");
    const messageRecord = asRecord(message);
    const content = Array.isArray(messageRecord?.content) ? messageRecord.content : [];
    const outputPart = content.find((item) => asRecord(item)?.type === "output_text");
    const outputPartRecord = asRecord(outputPart);
    if (outputPartRecord && !Array.isArray(outputPartRecord.annotations)) {
      outputPartRecord.annotations = annotations;
    }
  }
  return ok(result);
}

function mergeGeminiMetadata(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    const existing = merged[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      const seen = new Set(existing.map((item) => JSON.stringify(item)));
      merged[key] = [...existing, ...value.filter((item) => {
        const fingerprint = JSON.stringify(item);
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      })];
    } else if (asRecord(existing) && asRecord(value)) {
      merged[key] = mergeGeminiMetadata(asRecord(existing), asRecord(value) as Record<string, unknown>);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function aggregateGemini(events: StreamEvent[]): Result<unknown> {
  let text = "";
  let finishReason: string | undefined;
  let groundingMetadata: Record<string, unknown> | undefined;
  let usageMetadata: Record<string, unknown> | undefined;
  let promptFeedback: Record<string, unknown> | undefined;
  let sawCandidate = false;

  for (const event of events) {
    if (event.data === "[DONE]") continue;
    const data = asRecord(event.data);
    if (!data) return streamUnsupported("Gemini 流式事件不是对象");
    if (data.error !== undefined) return streamFailed("Gemini", "error", data);
    const candidate = asRecord(Array.isArray(data.candidates) ? data.candidates[0] : undefined);
    if (candidate) {
      sawCandidate = true;
      const content = asRecord(candidate.content);
      const parts = Array.isArray(content?.parts) ? content.parts : [];
      for (const part of parts) {
        const record = asRecord(part);
        if (typeof record?.text === "string") text += record.text;
      }
      if (typeof candidate.finishReason === "string") finishReason = candidate.finishReason;
      const candidateGrounding = asRecord(candidate.groundingMetadata);
      if (candidateGrounding) {
        groundingMetadata = mergeGeminiMetadata(groundingMetadata, candidateGrounding);
      }
    }
    const eventUsage = asRecord(data.usageMetadata);
    if (eventUsage) usageMetadata = { ...usageMetadata, ...eventUsage };
    const eventFeedback = asRecord(data.promptFeedback);
    if (eventFeedback) promptFeedback = { ...promptFeedback, ...eventFeedback };
  }

  if (!finishReason && !promptFeedback?.blockReason) {
    return streamUncertain("Gemini 流式响应缺少结束原因");
  }
  const candidate: Record<string, unknown> = {
    content: { parts: [{ text }] },
    finishReason,
  };
  if (groundingMetadata) candidate.groundingMetadata = groundingMetadata;
  const response: Record<string, unknown> = {
    candidates: sawCandidate || finishReason ? [candidate] : [],
  };
  if (usageMetadata) response.usageMetadata = usageMetadata;
  if (promptFeedback) response.promptFeedback = promptFeedback;
  return ok(response);
}

/** Aggregate one complete stream while preserving each protocol's response shape. */
export function aggregateProviderStream(
  protocol: ProviderStreamProtocol,
  body: string,
): Result<unknown> {
  const events = parseSseEvents(body);
  if (!events.ok) return events;
  switch (protocol) {
    case "openai-chat-completions":
      return aggregateOpenAIChat(events.value);
    case "openai-responses":
      return aggregateOpenAIResponses(events.value);
    case "gemini-generative-language":
      return aggregateGemini(events.value);
  }
}

/** Read accounting even when a later stream terminal/answer validation fails.
 * Usage chunks are cumulative snapshots, never additive. Parsing this metadata
 * does not affect the stream's existing success, error, or retry classification.
 */
export function readProviderStreamUsage(protocol: ProviderStreamProtocol, body: string): ProviderTokenUsage {
  let reported: Record<string, unknown> | undefined;
  // Observe successfully decoded events even if a later frame is malformed.
  // The authoritative aggregation still returns its original error unchanged.
  parseSseEvents(body, (event) => {
    const data = asRecord(event.data);
    if (!data) return;
    const envelope = protocol === "openai-responses" ? asRecord(data.response) ?? data : data;
    const key = protocol === "gemini-generative-language" ? "usageMetadata" : "usage";
    const value = envelope[key];
    if (value === null || value === undefined) return;
    // Gemini reports metadata in multiple chunks; match its existing shallow
    // aggregation while replacing individual cumulative numeric counts.
    const previous = asRecord(reported?.[key]);
    const next = asRecord(value);
    reported = { [key]: protocol === "gemini-generative-language" && previous && next ? { ...previous, ...next } : value };
  });
  return readProviderTokenUsage(protocol, reported);
}
