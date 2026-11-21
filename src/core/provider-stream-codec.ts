import { err, ok } from "../types";
import type { Result } from "../types";
import type { ProviderStreamProtocol, ProviderStreamResponse, ProviderStreamTransport } from "./provider-streaming";
import { readProviderTokenUsage, type ProviderTokenUsage } from "./provider-token-usage";

/** 协议编解码只处理已收到的文本，Node 与 renderer 传输共用同一套完成语义。 */
/** Whitelist-only completion event; never expose raw headers, URLs or body. */
export function safeStreamResponseEvidence(response: ProviderStreamResponse, transport: ProviderStreamTransport) {
  const rawType = (Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "").split(";", 1)[0].trim().toLowerCase();
  const responseContentType = ["text/event-stream", "application/json", "application/x-ndjson"].includes(rawType) ? rawType : "unknown";
  let framing: "SSE" | "JSON" | "unknown" = "unknown";
  if (/^(?:data|event|id|retry):/m.test(response.body)) framing = "SSE";
  else {
    const trimmed = response.body.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { JSON.parse(response.body); framing = "JSON"; } catch { /* Unknown framing stays unknown. */ }
    }
  }
  const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    event: "STREAM_RESPONSE_EVIDENCE", transport, responseContentType, framing,
    dispatchCount: 1,
    chunkCount: finite(response.diagnostics?.chunkCount), byteCount: finite(response.diagnostics?.byteCount),
    firstResponseMs: finite(response.diagnostics?.firstResponseMs), firstChunkMs: finite(response.diagnostics?.firstChunkMs),
    chunkSpanMs: finite(response.diagnostics?.chunkSpanMs), maxChunkGapMs: finite(response.diagnostics?.maxChunkGapMs),
  };
}

/** Reject a completed JSON body masquerading as a stream response. */
export function hasProviderStreamFraming(
  headers: Record<string, string>,
  body: string,
): boolean {
  // Some relays retain an SSE MIME type even when returning one complete
  // protocol envelope. Do not feed its message into the delta aggregator.
  if (body.trimStart().startsWith("{")) {
    try {
      const payload = asRecord(JSON.parse(body));
      if (payload && (
        (Array.isArray(payload.choices) && payload.choices.some((choice) => asRecord(choice)?.message !== undefined))
        || Array.isArray(payload.candidates)
        || Array.isArray(payload.output)
        || typeof payload.output_text === "string"
        || (payload.type === "message" && Array.isArray(payload.content))
      )) return false;
    } catch { /* Actual framed events continue through the stream parser. */ }
  }
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
    : providerCode === "authentication_error" || providerCode === "permission_error"
      ? "E203_INVALID_API_KEY"
      : providerCode === "rate_limit_error"
        ? "E202_RATE_LIMITED"
        : providerCode === "server_error" || providerCode === "service_unavailable" || providerCode === "internal_error" || providerCode === "overloaded_error" || providerCode === "api_error"
          ? "E204_PROVIDER_ERROR"
          : "E208_PROVIDER_STREAM_FAILED";
  // E202/E204 are retryable via RetryHandler; only non-retryable codes promise no auto-retry.
  const retryNote = errorCode === "E204_PROVIDER_ERROR" || errorCode === "E202_RATE_LIMITED" ? "" : "；未自动重试";
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

/** 逐行扫描原始文本，避免全量正则替换与 split 产生多份大字符串拷贝。 */
function forEachLine(body: string, visitor: (line: string) => Result<void>): Result<void> {
  const length = body.length;
  let start = 0;
  while (start <= length) {
    let end = start;
    while (end < length) {
      const code = body.charCodeAt(end);
      if (code === 10 || code === 13) break;
      end++;
    }
    const line = body.slice(start, end);
    const status = visitor(line);
    if (!status.ok) return status;
    if (end >= length) break;
    start = body.charCodeAt(end) === 13 && body.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
  }
  return ok(undefined);
}

function parseSseEvents(body: string, onEvent?: (event: StreamEvent) => void): Result<StreamEvent[]> {
  const hasSseFields = body.startsWith("data:") || body.startsWith("event:") || /^(?:data|event|id|retry):/m.test(body);
  if (!hasSseFields) {
    const events: StreamEvent[] = [];
    const scanned = forEachLine(body, (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) return ok(undefined);
      const parsed = parseJsonEvent(trimmed);
      if (!parsed.ok) return parsed;
      const event = { data: parsed.value };
      events.push(event);
      onEvent?.(event);
      return ok(undefined);
    });
    if (!scanned.ok) return scanned;
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
    const raw = dataLines.length === 1 ? dataLines[0] : dataLines.join("\n");
    const parsed = parseJsonEvent(raw);
    if (!parsed.ok) return parsed;
    const event = { name: eventName, data: parsed.value };
    events.push(event);
    onEvent?.(event);
    eventName = undefined;
    dataLines = [];
    return ok(undefined);
  };

  const scanned = forEachLine(body, (line) => {
    if (line === "") return flush();
    if (line.startsWith(":")) return ok(undefined);
    if (line.startsWith("event:")) {
      if (dataLines.length > 0) {
        const result = flush();
        if (!result.ok) return result;
      }
      eventName = line.slice("event:".length).trim() || undefined;
      return ok(undefined);
    }
    if (line.startsWith("data:")) {
      // Some relays omit the blank line between JSON events. Flush only when
      // the accumulated data is already a complete JSON value, preserving
      // legitimate multi-line SSE payloads.
      if (dataLines.length > 0) {
        const candidate = (dataLines.length === 1 ? dataLines[0] : dataLines.join("\n")).trim();
        if (candidate && parseJsonEvent(candidate).ok) {
          const result = flush();
          if (!result.ok) return result;
        }
      }
      dataLines.push(line.slice("data:".length).trimStart());
      return ok(undefined);
    }
    if (line.startsWith("id:") || line.startsWith("retry:")) return ok(undefined);
    return streamUnsupported("Provider 流式事件包含未知 SSE 字段");
  });
  if (!scanned.ok) return scanned;

  const result = flush();
  if (!result.ok) return result;
  return events.length > 0 ? ok(events) : streamUnsupported("Provider 没有返回流式事件");
}

/** Detect a fully framed terminal event without waiting for proxy EOF.
 * Only transport completion changes; aggregation still decides success/error.
 * Return the decoded-text boundary so a partial trailer cannot corrupt it. */
export function createResponsesStreamCompletionTracker(protocol?: ProviderStreamProtocol): ((chunk: string) => number | undefined) | undefined {
  if (protocol !== "openai-responses" && protocol !== "anthropic-messages") return undefined;
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
        if (protocol === "anthropic-messages") {
          return type === "message_stop" || type === "error";
        }
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
  const contentParts: string[] = [];
  let model: unknown;
  let cacheOptions: unknown;
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
    if (data.model !== undefined) model = data.model;
    if (data.prompt_cache_options !== undefined) cacheOptions = data.prompt_cache_options;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const choice = asRecord(choices[0]);
    const delta = asRecord(choice?.delta);
    const deltaText = textFromDelta(delta?.content);
    if (deltaText) {
      contentParts.push(deltaText);
    }
    if (typeof choice?.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
  }

  if (!sawDone && !finishReason) {
    return streamUncertain("Chat Completions 流式响应缺少结束事件");
  }
  const response: Record<string, unknown> = {
    choices: [{ message: { content: contentParts.join("") }, finish_reason: finishReason }],
  };
  if (usage) response.usage = usage;
  if (model !== undefined) response.model = model;
  if (cacheOptions !== undefined) response.prompt_cache_options = cacheOptions;
  return ok(response);
}

function aggregateOpenAIResponses(events: StreamEvent[]): Result<unknown> {
  let response: Record<string, unknown> | undefined;
  let outputText = "";
  let outputTextDone: string | undefined;
  let terminalStatus: "completed" | "incomplete" | undefined;
  const outputItems = new Map<number, Record<string, unknown>>();
  const originalOutputIndices = new WeakMap<object, number>();
  const annotations: unknown[] = [];
  interface StreamedPart { text: string; done?: string; annotations: unknown[] }
  const streamedParts = new Map<string, Map<number, StreamedPart>>();
  const eventPart = (data: Record<string, unknown>): StreamedPart | undefined => {
    const key = Number.isSafeInteger(data.output_index) && (data.output_index as number) >= 0
      ? `index:${data.output_index}`
      : typeof data.item_id === "string" ? `id:${data.item_id}` : undefined;
    if (!key) return undefined;
    const index = Number.isSafeInteger(data.content_index) && (data.content_index as number) >= 0
      ? data.content_index as number : 0;
    let parts = streamedParts.get(key);
    if (!parts) { parts = new Map(); streamedParts.set(key, parts); }
    let part = parts.get(index);
    if (!part) { part = { text: "", annotations: [] }; parts.set(index, part); }
    return part;
  };

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
      case "response.output_text.delta": {
        const part = eventPart(data);
        if (part) part.text += textFromDelta(data.delta);
        else outputText += textFromDelta(data.delta);
        break;
      }
      case "response.output_text.done": {
        const part = eventPart(data);
        if (part) part.done = textFromDelta(data.text ?? data.value);
        else outputTextDone = textFromDelta(data.text ?? data.value);
        break;
      }
      case "response.output_text.annotation.added": {
        const part = eventPart(data);
        if (data.annotation !== undefined) (part?.annotations ?? annotations).push(data.annotation);
        break;
      }
      case "response.output_item.added":
      case "response.output_item.done": {
        const item = asRecord(data.item);
        const index = typeof data.output_index === "number" ? data.output_index : outputItems.size;
        if (item) {
          const merged = { ...(outputItems.get(index) ?? {}), ...item };
          outputItems.set(index, merged);
          originalOutputIndices.set(merged, index);
        }
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
  // `response.created` often includes `output: []`. An empty array must not
  // block streamed output_item events from becoming the final output.
  const envelopeOutput = Array.isArray(result.output) ? result.output : undefined;
  if (outputItems.size > 0 && (!envelopeOutput || envelopeOutput.length === 0)) {
    result.output = [...outputItems.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item);
  }
  // Standard events name their output item and content part. Hydrate those
  // parts independently so commentary text/citations can never enter the final.
  if (!Array.isArray(result.output) && streamedParts.size > 0) result.output = [];
  if (Array.isArray(result.output)) {
    const items = result.output;
    const hasKnownPhase = items.some(item => {
      const phase = asRecord(item)?.phase;
      return phase === "commentary" || phase === "final_answer";
    });
    if (!hasKnownPhase) {
      for (const key of streamedParts.keys()) {
        if (!key.startsWith("index:")) continue;
        const index = Number(key.slice(6));
        if (!items.some((item, position) => (originalOutputIndices.get(item) ?? position) === index)) {
          const message = { type: "message", content: [] };
          originalOutputIndices.set(message, index);
          items.push(message);
        }
      }
    }
    for (let index = 0; index < items.length; index++) {
      const item = asRecord(items[index]);
      if (!item || item.type !== "message") continue;
      const outputIndex = originalOutputIndices.get(item) ?? index;
      const parts = streamedParts.get(`index:${outputIndex}`)
        ?? (typeof item.id === "string" ? streamedParts.get(`id:${item.id}`) : undefined);
      if (!parts) continue;
      const content = new Map<number, unknown>((Array.isArray(item.content) ? item.content : [])
        .map((part, partIndex) => [partIndex, part]));
      for (const [contentIndex, streamed] of parts) {
        let part = asRecord(content.get(contentIndex));
        if (!part) { part = { type: "output_text" }; content.set(contentIndex, part); }
        if (typeof part.text !== "string" || !part.text) part.text = streamed.done ?? streamed.text;
        if (streamed.annotations.length && (!Array.isArray(part.annotations)
          || ((!envelopeOutput || !envelopeOutput.length) && !part.annotations.length))) {
          part.annotations = streamed.annotations;
        }
      }
      item.content = [...content.entries()].sort(([left], [right]) => left - right).map(([, part]) => part);
    }
    result.output = items.filter(item => item !== undefined);
    // 未提供索引的流缓冲无法确定所属消息，有显式阶段时不用于构造最终回答。
    if (hasKnownPhase) return ok(result);
  }
  const completedText = textFromDelta(response?.output_text);
  if (!completedText && (outputText || outputTextDone !== undefined)) {
    result.output_text = outputTextDone ?? outputText;
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
    const message = result.output.find((item) => asRecord(item)?.type === "message" && asRecord(item)?.phase === "final_answer")
      ?? result.output.find((item) => asRecord(item)?.type === "message" && asRecord(item)?.phase !== "commentary");
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
    const message = result.output.find((item) => asRecord(item)?.type === "message" && asRecord(item)?.phase === "final_answer")
      ?? result.output.find((item) => asRecord(item)?.type === "message" && asRecord(item)?.phase !== "commentary");
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
  let modelVersion: unknown;
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
    if (data.modelVersion !== undefined) modelVersion = data.modelVersion;
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
  if (modelVersion !== undefined) response.modelVersion = modelVersion;
  if (usageMetadata) response.usageMetadata = usageMetadata;
  if (promptFeedback) response.promptFeedback = promptFeedback;
  return ok(response);
}

function aggregateAnthropicMessages(events: StreamEvent[]): Result<unknown> {
  let id: string | undefined;
  let model: unknown;
  let stopReason: string | null | undefined;
  let usage: Record<string, unknown> | undefined;
  let sawStop = false;
  interface BlockState {
    base: Record<string, unknown>;
    textParts: string[];
    thinkingParts: string[];
    signatureParts: string[];
    inputJsonParts: string[];
    citations: unknown[];
  }
  const blocks = new Map<number, BlockState>();
  const getOrCreateBlock = (index: number, initial?: Record<string, unknown>): BlockState => {
    let state = blocks.get(index);
    if (!state) {
      const base: Record<string, unknown> = initial ? { ...initial } : { type: "text" };
      const initialText = typeof base.text === "string" && base.text ? [base.text] : [];
      const initialThinking = typeof base.thinking === "string" && base.thinking ? [base.thinking] : [];
      const initialCitations = Array.isArray(base.citations) ? [...base.citations] : [];
      state = {
        base,
        textParts: initialText,
        thinkingParts: initialThinking,
        signatureParts: [],
        inputJsonParts: [],
        citations: initialCitations,
      };
      blocks.set(index, state);
    }
    return state;
  };

  for (const event of events) {
    if (event.data === "[DONE]") continue;
    const data = asRecord(event.data);
    if (!data) return streamUnsupported("Anthropic Messages 流式事件不是对象");
    const type = typeof data.type === "string" ? data.type : event.name;
    switch (type) {
      case "error":
        return streamFailed("Anthropic Messages", "error", data);
      case "ping":
      case "content_block_stop":
        break;
      case "message_start": {
        const message = asRecord(data.message);
        if (message) {
          if (typeof message.id === "string") id = message.id;
          if (message.model !== undefined) model = message.model;
          if (typeof message.stop_reason === "string" || message.stop_reason === null) stopReason = message.stop_reason;
          const startUsage = asRecord(message.usage);
          if (startUsage) usage = { ...(usage ?? {}), ...startUsage };
        }
        break;
      }
      case "content_block_start": {
        const index = typeof data.index === "number" && Number.isSafeInteger(data.index) ? data.index : blocks.size;
        const block = asRecord(data.content_block);
        if (block) getOrCreateBlock(index, block);
        break;
      }
      case "content_block_delta": {
        const index = typeof data.index === "number" && Number.isSafeInteger(data.index) ? data.index : 0;
        const delta = asRecord(data.delta);
        if (!delta) break;
        const state = getOrCreateBlock(index);
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          state.textParts.push(delta.text);
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          state.thinkingParts.push(delta.thinking);
        } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
          state.signatureParts.push(delta.signature);
        } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          state.inputJsonParts.push(delta.partial_json);
        } else if (delta.type === "citations_delta" && delta.citation !== undefined) {
          state.citations.push(delta.citation);
        }
        break;
      }
      case "message_delta": {
        const delta = asRecord(data.delta);
        if (delta && (typeof delta.stop_reason === "string" || delta.stop_reason === null)) {
          stopReason = delta.stop_reason;
        }
        const deltaUsage = asRecord(data.usage);
        if (deltaUsage) usage = { ...(usage ?? {}), ...deltaUsage };
        break;
      }
      case "message_stop":
        sawStop = true;
        break;
      default:
        break;
    }
  }

  if (!sawStop && !stopReason) {
    return streamUncertain("Anthropic Messages 流式响应缺少结束事件");
  }

  const content = [...blocks.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, state]) => {
      const block: Record<string, unknown> = { ...state.base };
      if (block.type === "text") {
        block.text = state.textParts.join("");
        if (state.citations.length > 0) block.citations = state.citations;
      } else if (block.type === "thinking") {
        if (state.thinkingParts.length > 0) block.thinking = state.thinkingParts.join("");
        if (state.signatureParts.length > 0) block.signature = state.signatureParts.join("");
      } else if (state.inputJsonParts.length > 0) {
        const rawJson = state.inputJsonParts.join("");
        try { block.input = JSON.parse(rawJson); } catch { /* Keep base input if partial JSON is incomplete. */ }
      }
      return block;
    });

  const response: Record<string, unknown> = {
    type: "message",
    role: "assistant",
    content,
    ...(id ? { id } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
    ...(usage ? { usage } : {}),
  };
  return ok(response);
}

function aggregateEvents(protocol: ProviderStreamProtocol, events: StreamEvent[]): Result<unknown> {
  switch (protocol) {
    case "openai-chat-completions":
      return aggregateOpenAIChat(events);
    case "openai-responses":
      return aggregateOpenAIResponses(events);
    case "gemini-generative-language":
      return aggregateGemini(events);
    case "anthropic-messages":
      return aggregateAnthropicMessages(events);
  }
}

function createUsageObserver(protocol: ProviderStreamProtocol): {
  observe: (event: StreamEvent) => void;
  result: () => ProviderTokenUsage;
} {
  let reported: Record<string, unknown> | undefined;
  const observe = (event: StreamEvent): void => {
    const data = asRecord(event.data);
    if (!data) return;
    const envelope = protocol === "openai-responses"
      ? asRecord(data.response) ?? data
      : protocol === "anthropic-messages"
        ? asRecord(data.message) ?? data
        : data;
    const key = protocol === "gemini-generative-language" ? "usageMetadata" : "usage";
    const value = envelope[key];
    if (value === null || value === undefined) return;
    const previous = asRecord(reported?.[key]);
    const next = asRecord(value);
    // Gemini 与 Anthropic 在多帧中分别报告输入/输出或累计字段，浅合并以保留完整统计。
    const mergeShallow = (protocol === "gemini-generative-language" || protocol === "anthropic-messages") && previous && next;
    reported = { [key]: mergeShallow ? { ...previous, ...next } : value };
  };
  return { observe, result: () => readProviderTokenUsage(protocol, reported) };
}

/** Single-pass SSE decode returning both observed usage and aggregated envelope. */
export function decodeProviderStream(
  protocol: ProviderStreamProtocol,
  body: string,
): { aggregate: Result<unknown>; observedUsage: ProviderTokenUsage } {
  const usageObserver = createUsageObserver(protocol);
  const events = parseSseEvents(body, usageObserver.observe);
  const observedUsage = usageObserver.result();
  if (!events.ok) return { aggregate: events, observedUsage };
  return { aggregate: aggregateEvents(protocol, events.value), observedUsage };
}

/** Aggregate one complete stream while preserving each protocol's response shape. */
export function aggregateProviderStream(
  protocol: ProviderStreamProtocol,
  body: string,
): Result<unknown> {
  const events = parseSseEvents(body);
  if (!events.ok) return events;
  return aggregateEvents(protocol, events.value);
}

/** Read accounting even when a later stream terminal/answer validation fails.
 * Usage chunks are cumulative snapshots, never additive. Parsing this metadata
 * does not affect the stream's existing success, error, or retry classification.
 */
export function readProviderStreamUsage(protocol: ProviderStreamProtocol, body: string): ProviderTokenUsage {
  const usageObserver = createUsageObserver(protocol);
  // Observe successfully decoded events even if a later frame is malformed.
  // The authoritative aggregation still returns its original error unchanged.
  parseSseEvents(body, usageObserver.observe);
  return usageObserver.result();
}
