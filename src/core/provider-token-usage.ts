/** Numeric provider accounting only. Never retain response text or raw metadata. */
export interface TokenUsageCounts {
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
export type TokenUsageField = keyof TokenUsageCounts;
export type TokenUsageStatus = "unreported" | "partial" | "reported" | "invalid" | "inconsistent";
export type TokenUsageIssue = "invalid-usage" | "invalid-cache-details" | "cache-exceeds-input" | "counts-exceed-total";
export interface ProviderTokenUsage extends TokenUsageCounts {
  /** reported means all accounting fields expected by this protocol were supplied, not a verified bill. */
  status: TokenUsageStatus;
  invalidFields?: TokenUsageField[];
  issues?: TokenUsageIssue[];
}

export const TOKEN_USAGE_FIELDS: readonly TokenUsageField[] = [
  "tokensUsed", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens",
];
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const supplied = (value: unknown): boolean => value !== undefined && value !== null;
export function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Whitelist and validate counts. Unknown is deliberately not converted to zero. */
export function normalizeTokenUsage(
  raw: Partial<Record<TokenUsageField, unknown>>,
  required: readonly TokenUsageField[] = TOKEN_USAGE_FIELDS,
  priorIssues: readonly TokenUsageIssue[] = [],
  priorInvalid: readonly TokenUsageField[] = [],
): ProviderTokenUsage {
  const counts: TokenUsageCounts = {};
  const invalidFields = new Set(priorInvalid);
  const issues = new Set(priorIssues);
  for (const field of TOKEN_USAGE_FIELDS) {
    if (isTokenCount(raw[field])) counts[field] = raw[field];
    else if (supplied(raw[field])) invalidFields.add(field);
  }
  const { inputTokens: input, outputTokens: output, tokensUsed: total, cacheReadTokens: read, cacheWriteTokens: write } = counts;
  if (input !== undefined && ((read !== undefined && read > input) || (write !== undefined && write > input)
    || (read !== undefined && write !== undefined && read > input - write))) issues.add("cache-exceeds-input");
  if (total !== undefined && ((input !== undefined && input > total) || (output !== undefined && output > total)
    || (input !== undefined && output !== undefined && input > total - output))) issues.add("counts-exceed-total");
  const invalid = invalidFields.size > 0 || issues.has("invalid-usage") || issues.has("invalid-cache-details");
  const inconsistent = issues.has("cache-exceeds-input") || issues.has("counts-exceed-total");
  const status: TokenUsageStatus = invalid ? "invalid" : inconsistent ? "inconsistent"
    : Object.keys(counts).length === 0 ? "unreported"
      : required.every((field) => counts[field] !== undefined) ? "reported" : "partial";
  return { ...counts, status, ...(invalidFields.size ? { invalidFields: [...invalidFields] } : {}), ...(issues.size ? { issues: [...issues] } : {}) };
}

export function readProviderTokenUsage(protocol: string, raw: unknown): ProviderTokenUsage {
  const root = asRecord(raw);
  const rawUsage = protocol === "gemini-generative-language" ? root?.usageMetadata : root?.usage;
  const usage = asRecord(rawUsage);
  const issues: TokenUsageIssue[] = supplied(rawUsage) && !usage ? ["invalid-usage"] : [];
  if (protocol === "gemini-generative-language") return normalizeTokenUsage({
    tokensUsed: usage?.totalTokenCount, inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount, cacheReadTokens: usage?.cachedContentTokenCount,
  }, ["tokensUsed", "inputTokens", "outputTokens", "cacheReadTokens"], issues);
  if (protocol === "openai-embeddings") return normalizeTokenUsage({
    tokensUsed: usage?.total_tokens, inputTokens: usage?.prompt_tokens,
  }, ["tokensUsed", "inputTokens"], issues);
  if (protocol !== "openai-responses" && protocol !== "openai-chat-completions") return { status: "unreported" };
  const chatDetails = asRecord(usage?.prompt_tokens_details);
  const nativeDetails = asRecord(usage?.input_tokens_details);
  if ((supplied(usage?.prompt_tokens_details) && !chatDetails)
    || (protocol === "openai-responses" && supplied(usage?.input_tokens_details) && !nativeDetails)) issues.push("invalid-cache-details");
  const chat = {
    tokensUsed: usage?.total_tokens, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens,
    cacheReadTokens: chatDetails?.cached_tokens, cacheWriteTokens: chatDetails?.cache_write_tokens,
  };
  if (protocol === "openai-chat-completions") return normalizeTokenUsage(chat, TOKEN_USAGE_FIELDS, issues);
  const native = {
    tokensUsed: usage?.total_tokens, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens,
    cacheReadTokens: nativeDetails?.cached_tokens, cacheWriteTokens: nativeDetails?.cache_write_tokens,
  };
  const invalid: TokenUsageField[] = [];
  const selected: Partial<Record<TokenUsageField, unknown>> = {};
  for (const field of TOKEN_USAGE_FIELDS) {
    if (supplied(native[field]) && !isTokenCount(native[field])) invalid.push(field);
    // Native zero wins. Only a missing/invalid native value can use a Chat alias.
    selected[field] = isTokenCount(native[field]) ? native[field] : chat[field];
  }
  return normalizeTokenUsage(selected, TOKEN_USAGE_FIELDS, issues, invalid);
}

export function tokenUsageCounts(usage: ProviderTokenUsage): TokenUsageCounts {
  return Object.fromEntries(TOKEN_USAGE_FIELDS.filter((field) => isTokenCount(usage[field])).map((field) => [field, usage[field]]));
}

/** Never derive a precise split or ratio from invalid/inconsistent accounting. */
export function deriveCacheUsage(usage: ProviderTokenUsage): { cacheHitRate?: number; cacheWriteRate?: number; uncachedInputTokens?: number } {
  if (usage.status === "invalid" || usage.status === "inconsistent") return {};
  const { inputTokens: input, cacheReadTokens: read, cacheWriteTokens: write } = usage;
  return {
    ...(input !== undefined && input > 0 && read !== undefined ? { cacheHitRate: Math.round(read / input * 10000) / 10000 } : {}),
    ...(input !== undefined && input > 0 && write !== undefined ? { cacheWriteRate: Math.round(write / input * 10000) / 10000 } : {}),
    ...(input !== undefined && read !== undefined && write !== undefined ? { uncachedInputTokens: input - read - write } : {}),
  };
}

// Validation facts accompany the immediate parsed response without becoming
// answer fields or extending its lifetime. Nothing is serialized/persisted.
const responseAccounting = new WeakMap<object, ProviderTokenUsage>();
export function withProviderTokenUsage<T extends object>(response: T, protocol: string, raw: unknown): T & TokenUsageCounts {
  const usage = readProviderTokenUsage(protocol, raw);
  return applyProviderTokenUsage(response, usage);
}
export function deriveResponseCacheUsage(response: TokenUsageCounts): ReturnType<typeof deriveCacheUsage> {
  return deriveCacheUsage(responseAccounting.get(response) ?? normalizeTokenUsage(response));
}

/** Use the observed stream accounting even when text aggregation ignored an
 * invalid usage envelope. Content/finish/error behavior is unchanged.
 */
export function applyProviderTokenUsage<T extends object>(response: T, usage: ProviderTokenUsage): T & TokenUsageCounts {
  const result = { ...response } as T & TokenUsageCounts;
  for (const field of TOKEN_USAGE_FIELDS) delete result[field];
  Object.assign(result, tokenUsageCounts(usage));
  responseAccounting.set(result, usage);
  return result;
}
