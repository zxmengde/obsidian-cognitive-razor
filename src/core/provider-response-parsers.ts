import { err, ok } from "../types";
import type { ChatResponse, EmbedResponse, Result, UrlCitation } from "../types";
import { readResponsesReplayOutput, replayVisibleText } from "../utils/responses-replay";
import { normalizeExternalHttpUrl } from "./url-utils";
import { readProviderTokenUsage, tokenUsageCounts, withProviderTokenUsage } from "./provider-token-usage";

interface OpenAIChatResponse {
  choices: Array<{
    message: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[] }>;
  usage?: { prompt_tokens: number; total_tokens: number };
}

interface OpenAIResponsesAnnotation {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface OpenAIResponsesContentPart {
  type?: string;
  text?: unknown;
  value?: unknown;
  annotations?: OpenAIResponsesAnnotation[];
}

interface OpenAIResponsesOutputItem {
  type?: string;
  phase?: string;
  content?: OpenAIResponsesContentPart[] | string;
  text?: unknown;
  output_text?: unknown;
}

interface OpenAIResponsesResponse {
  id?: string;
  status?: string;
  error?: { code?: string; message?: string } | null;
  output_text?: unknown;
  output?: OpenAIResponsesOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  incomplete_details?: { reason?: string } | null;
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    groundingSupports?: Array<{
      segment?: { startIndex?: number; endIndex?: number };
      groundingChunkIndices?: number[];
    }>;
  };
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

const EMPTY_CONTENT_FINISH_REASONS: ReadonlySet<string> = new Set([
  "length", "recitation", "content_filter", "refusal", "safety", "blocked",
]);
const OPENAI_CHAT_FINISH_REASONS: ReadonlySet<string> = new Set([
  "stop", "length", "content_filter", "refusal", "safety", "blocked",
]);
const GEMINI_FINISH_REASONS: ReadonlySet<string | undefined> = new Set([
  undefined, "stop", "length", "safety", "recitation", "blocked",
]);

/** Small non-sensitive whitelist; never copy arbitrary response metadata. */
function reportedMetadata(raw: unknown): Pick<ChatResponse, "reportedModel" | "reportedCacheMode" | "reportedCacheTtl"> {
  const root = asRecord(raw);
  const model = root?.model ?? root?.modelVersion;
  const options = asRecord(root?.prompt_cache_options);
  return {
    ...(typeof model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/.test(model) ? { reportedModel: model } : {}),
    ...(options?.mode === "implicit" || options?.mode === "explicit" ? { reportedCacheMode: options.mode } : {}),
    ...(options?.ttl === "30m" ? { reportedCacheTtl: options.ttl } : {}),
  };
}

export function mayHaveEmptyContent(reason: string | undefined): boolean {
  return reason !== undefined && EMPTY_CONTENT_FINISH_REASONS.has(reason);
}

export function validateChatFinishReason(
  finishReason: string | undefined,
  details?: Record<string, unknown>,
): Result<void> {
  if (finishReason === "length") {
    return err("E214_MODEL_OUTPUT_TRUNCATED", "模型输出因长度限制被截断", {
      ...details,
      finishReason,
    });
  }
  if (finishReason === "content_filter" || finishReason === "refusal" ||
    finishReason === "safety" || finishReason === "blocked" || finishReason === "recitation") {
    return err("E213_SAFETY_VIOLATION", "模型因安全策略拒绝或截断了输出", {
      ...details,
      finishReason,
    });
  }
  return ok(undefined);
}


export function parseOpenAIChatResponse(raw: unknown): Result<ChatResponse> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Chat Completions 返回非对象响应");
  }
  const data = raw as OpenAIChatResponse;
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "API 返回缺少 choices");
  }

  const firstChoice = data.choices[0];
  const content = firstChoice?.message?.content;
  const finishReason = firstChoice?.finish_reason ?? undefined;
  if (!OPENAI_CHAT_FINISH_REASONS.has(finishReason ?? "")) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", `Chat Completions 返回未支持的停止原因: ${finishReason ?? "missing"}`);
  }
  if (!mayHaveEmptyContent(finishReason) && typeof content !== "string") {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "API 返回格式异常：缺少 message.content");
  }

  return ok(withProviderTokenUsage({
    ...reportedMetadata(raw),
    content: typeof content === "string" ? content : "",
    finishReason,
  }, "openai-chat-completions", raw));
}

export function parseGeminiGenerateResponse(raw: unknown): Result<ChatResponse> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Gemini generateContent 返回非对象响应");
  }
  const data = raw as GeminiGenerateResponse;
  const firstCandidate = data.candidates?.[0];
  const finishReason = normalizeGeminiFinishReason(
    firstCandidate?.finishReason ?? data.promptFeedback?.blockReason,
  );
  const content = firstCandidate?.content?.parts
    ?.filter((part) => typeof part.text === "string")
    .map((part) => part.text as string)
    .join("") ?? "";
  if (!GEMINI_FINISH_REASONS.has(finishReason)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", `Gemini 返回未支持的停止原因: ${finishReason}`);
  }
  if (!content && !mayHaveEmptyContent(finishReason)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Gemini API 返回格式异常：缺少 candidates 内容");
  }

  return ok(withProviderTokenUsage({
    ...reportedMetadata(raw),
    content,
    citations: extractGeminiCitations(firstCandidate, content),
    webSearchUsed: firstCandidate?.groundingMetadata !== undefined,
    finishReason,
  }, "gemini-generative-language", raw));
}

export function parseOpenAIResponsesResponse(raw: unknown): Result<ChatResponse> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Responses 返回非对象响应");
  }
  const data = raw as OpenAIResponsesResponse;
  if (data.output !== undefined && !Array.isArray(data.output)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Responses output 结构不受支持");
  }
  if (Array.isArray(data.output) && data.output.some((item) =>
    !item || typeof item !== "object" || Array.isArray(item))) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Responses output 包含无法识别的项目");
  }
  const nativeContent = extractResponsesText(data);
  const fallback = !nativeContent && Array.isArray((raw as Record<string, unknown>).choices)
    ? parseOpenAIChatResponse(raw)
    : undefined;
  if (fallback && !fallback.ok) return fallback;
  const content = nativeContent || fallback?.value.content || "";
  const incompleteReason = data.incomplete_details?.reason;
  const finishReason = incompleteReason === "max_output_tokens" ? "length" : incompleteReason ?? fallback?.value.finishReason;
  const responseShape = describeResponsesShape(data);

  if (data.status && data.status !== "completed" && data.status !== "incomplete") {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", `Responses 返回未完成状态: ${data.status}`, { responseShape });
  }
  // The explicit incomplete state is authoritative even when its optional
  // details are absent. Only recognized failure reasons can pass to the
  // executor's existing length/safety checks; visible text is not completion.
  if (data.status === "incomplete" && !incompleteReason && !mayHaveEmptyContent(finishReason)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Responses 返回未完成结果且缺少中断原因，未接受部分输出", { responseShape });
  }
  if (incompleteReason && !mayHaveEmptyContent(finishReason)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", `Responses 返回未支持的中断原因: ${incompleteReason}`, {
      responseShape,
      incompleteReason,
    });
  }
  const responseError = asRecord(data.error);
  if (responseError) {
    const providerCode = typeof responseError.code === "string" ? responseError.code : "unknown";
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", `Responses 返回错误: ${providerCode}`, {
      responseShape,
      providerCode,
    });
  }
  if (data.output?.some((item) => item.type === "function_call" || item.type === "computer_call")) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Responses 返回了插件未处理的客户端工具调用", { responseShape });
  }
  if (!content && !mayHaveEmptyContent(finishReason)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "API 返回格式异常：Responses 没有可见文本", { responseShape });
  }

  const replayOutput = data.status === "completed" ? readResponsesReplayOutput(data.output) : undefined;
  return ok(withProviderTokenUsage({
    ...reportedMetadata(raw),
    content,
    ...(replayOutput && replayVisibleText(replayOutput) === content ? { responsesOutput: replayOutput } : {}),
    ...(typeof data.id === "string" ? { responseId: data.id } : {}),
    citations: extractResponsesCitations(data, content),
    webSearchUsed: data.output?.some((item) => item.type === "web_search_call") ?? false,
    finishReason,
  }, "openai-responses", raw));
}

export function parseOpenAIEmbedResponse(raw: unknown): Result<EmbedResponse> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Embeddings 返回非对象响应");
  }
  const data = raw as OpenAIEmbedResponse;
  if (!Array.isArray(data.data) || data.data.length === 0) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Embeddings 返回缺少 data");
  }
  const first = data.data[0];
  if (!first || !Array.isArray(first.embedding)) {
    return err("E207_PROVIDER_RESPONSE_UNSUPPORTED", "Embeddings 返回格式异常：缺少 embedding");
  }
  const { tokensUsed } = tokenUsageCounts(readProviderTokenUsage("openai-embeddings", raw));
  return ok({ embedding: first.embedding, ...(tokensUsed !== undefined ? { tokensUsed } : {}) });
}

function normalizeGeminiFinishReason(reason?: string): string | undefined {
  switch (reason) {
    case undefined: return undefined;
    case "STOP": return "stop";
    case "MAX_TOKENS": return "length";
    case "SAFETY":
    case "IMAGE_SAFETY": return "safety";
    case "RECITATION": return "recitation";
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII": return "blocked";
    default: return reason.toLowerCase();
  }
}

function extractGeminiCitations(candidate: GeminiCandidate | undefined, content: string): UrlCitation[] {
  const citations: UrlCitation[] = [];
  const seenUrls = new Set<string>();
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const url = normalizeExternalHttpUrl(chunk.web?.uri);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    citations.push({ url, title: chunk.web?.title?.trim() || undefined });
  }
  for (const support of candidate?.groundingMetadata?.groundingSupports ?? []) {
    const startIndex = support.segment?.startIndex;
    const endIndex = support.segment?.endIndex;
    if (!isValidCitationRange(startIndex, endIndex, content)) continue;
    for (const chunkIndex of support.groundingChunkIndices ?? []) {
      const chunk = chunks[chunkIndex];
      const url = normalizeExternalHttpUrl(chunk?.web?.uri);
      if (!url) continue;
      citations.push({ url, title: chunk.web?.title?.trim() || undefined, startIndex, endIndex });
    }
  }
  return citations;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Relay implementations sometimes wrap output text in `{value}` or use the
 * raw Responses `type: "text"` part instead of the SDK convenience field.
 * Only visible text-bearing fields are accepted; reasoning summaries are not
 * promoted to task output.
 */
function textValue(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => textValue(item, depth + 1)).join("");
  const record = asRecord(value);
  if (!record) return "";
  if (record.value !== undefined) return textValue(record.value, depth + 1);
  if (record.text !== undefined) return textValue(record.text, depth + 1);
  return "";
}

function isVisibleResponsesPart(type: unknown): boolean {
  return type === "output_text" || type === "text" || type === undefined;
}

/** Explicit final phases are authoritative; old relays without phase metadata
 * retain their SDK-text fallback. Commentary is never task output when the
 * response distinguishes it from a final answer. */
function selectedResponsesMessages(data: OpenAIResponsesResponse): OpenAIResponsesOutputItem[] {
  const messages = (data.output ?? []).filter(item => item.type === "message" || item.type === undefined);
  const finals = messages.filter(item => item.phase === "final_answer");
  return finals.length > 0 ? finals : messages.filter(item => item.phase !== "commentary");
}

function extractResponsesText(data: OpenAIResponsesResponse): string {
  return extractResponsesTextWithPartOffsets(data).content;
}

function extractResponsesTextWithPartOffsets(data: OpenAIResponsesResponse): {
  content: string;
  offsets: WeakMap<object, number>;
} {
  const candidateOffsets = new WeakMap<object, number>();
  const direct = textValue(data.output_text);
  const chunks: string[] = [];
  let offset = 0;
  for (const item of selectedResponsesMessages(data)) {
    if (item.type === "message") {
      const itemText = textValue(item.text ?? item.output_text);
      if (itemText) { chunks.push(itemText); offset += itemText.length; }
    }
    if (typeof item.content === "string") {
      chunks.push(item.content);
      offset += item.content.length;
      continue;
    }
    for (const part of item.content ?? []) {
      if (!part || typeof part !== "object" || Array.isArray(part) || !isVisibleResponsesPart(part.type)) continue;
      const partText = textValue(part.text ?? part.value);
      if (!partText) continue;
      candidateOffsets.set(part, offset);
      chunks.push(partText);
      offset += partText.length;
    }
  }
  const rebuilt = chunks.join("");
  const phased = data.output?.some(item => item.phase === "final_answer" || item.phase === "commentary");
  if (direct.length > 0 && !phased) {
    // Attach offsets only when the convenience field is the same selected text.
    return rebuilt === direct
      ? { content: direct, offsets: candidateOffsets }
      : { content: direct, offsets: new WeakMap<object, number>() };
  }
  return { content: rebuilt, offsets: candidateOffsets };
}

function describeResponsesShape(data: OpenAIResponsesResponse): Record<string, unknown> {
  const outputItems = data.output ?? [];
  const outputTypes = [...new Set(outputItems.map((item) =>
    typeof item.type === "string" ? item.type : "unknown",
  ))].slice(0, 12);
  const contentTypes = [...new Set(outputItems.flatMap((item) => {
    if (!Array.isArray(item.content)) return [];
    return item.content
      .filter((part) => part && typeof part === "object" && !Array.isArray(part))
      .map((part) => typeof part.type === "string" ? part.type : "unknown");
  }))].slice(0, 12);
  return {
    status: data.status,
    incompleteReason: data.incomplete_details?.reason,
    hasOutputText: textValue(data.output_text).length > 0,
    outputItemCount: outputItems.length,
    outputTypes,
    contentTypes,
    hasChoicesFallback: Array.isArray((data as unknown as Record<string, unknown>).choices),
  };
}

function extractResponsesCitations(data: OpenAIResponsesResponse, content: string): UrlCitation[] {
  const extracted = extractResponsesTextWithPartOffsets(data);
  const citations: UrlCitation[] = [];
  for (const item of selectedResponsesMessages(data)) {
    if (!Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      if (!Array.isArray(part.annotations)) continue;
      for (const annotation of part.annotations) {
        if (annotation.type !== "url_citation") continue;
        const url = normalizeExternalHttpUrl(annotation.url);
        if (!url) continue;
        const offset = extracted.content === content ? extracted.offsets.get(part) : undefined;
        const startIndex = offset !== undefined && typeof annotation.start_index === "number" ? annotation.start_index + offset : undefined;
        const endIndex = offset !== undefined && typeof annotation.end_index === "number" ? annotation.end_index + offset : undefined;
        citations.push({
          url,
          title: annotation.title,
          ...(isValidCitationRange(startIndex, endIndex, content)
            ? { startIndex, endIndex }
            : {}),
        });
      }
    }
  }
  return citations;
}

function isValidCitationRange(
  startIndex: unknown,
  endIndex: unknown,
  content: string,
): boolean {
  return Number.isSafeInteger(startIndex) && Number.isSafeInteger(endIndex)
    && (startIndex as number) >= 0
    && (endIndex as number) > (startIndex as number)
    && (endIndex as number) <= content.length;
}
