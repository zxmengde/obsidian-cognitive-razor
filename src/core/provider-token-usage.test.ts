import { describe, expect, it } from "vitest";
import { deriveCacheUsage, deriveResponseCacheUsage, normalizeTokenUsage, readProviderTokenUsage } from "./provider-token-usage";
import { parseGeminiGenerateResponse, parseOpenAIChatResponse, parseOpenAIResponsesResponse } from "./provider-response-parsers";
import { aggregateProviderStream, readProviderStreamUsage } from "./provider-streaming";

const chat = (usage?: unknown) => ({ choices: [{ message: { content: "usable answer" }, finish_reason: "stop" }], ...(usage !== undefined ? { usage } : {}) });
const fullUsage = { prompt_tokens: 1200, completion_tokens: 100, total_tokens: 1300, prompt_tokens_details: { cached_tokens: 1024, cache_write_tokens: 0 } };
const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

describe("provider token accounting", () => {
  it("preserves complete Chat fallback accounting through Responses", () => {
    const parsed = parseOpenAIResponsesResponse(chat(fullUsage));
    expect(parsed).toMatchObject({ ok: true, value: { content: "usable answer", tokensUsed: 1300, inputTokens: 1200, outputTokens: 100, cacheReadTokens: 1024, cacheWriteTokens: 0 } });
    expect(readProviderTokenUsage("openai-responses", chat(fullUsage)).status).toBe("reported");
  });

  it("prefers each native field including zero, without adding fallback counts", () => {
    const raw = chat({ ...fullUsage, input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
    expect(readProviderTokenUsage("openai-responses", raw)).toEqual({ tokensUsed: 110, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, status: "reported" });
  });

  it("does not log precise ratios after invalid native fields are repaired", () => {
    const parsed = parseOpenAIResponsesResponse(chat({ ...fullUsage, input_tokens: -1 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(deriveResponseCacheUsage(parsed.value)).toEqual({});
  });

  it("fills only missing native fields from compatible Chat aliases", () => {
    const raw = { ...chat({ ...fullUsage, input_tokens: 1200, input_tokens_details: { cached_tokens: 0 } }), output_text: "native answer" };
    expect(parseOpenAIResponsesResponse(raw)).toMatchObject({ ok: true, value: { content: "native answer", inputTokens: 1200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  });

  it("uses a valid fallback for invalid native data but flags the invalid native field", () => {
    const usage = readProviderTokenUsage("openai-responses", chat({ ...fullUsage, input_tokens: "1200" }));
    expect(usage).toMatchObject({ inputTokens: 1200, status: "invalid", invalidFields: ["inputTokens"] });
    expect(deriveCacheUsage(usage)).toEqual({});
  });

  it.each([undefined, null, {}])("preserves unreported usage (%j)", (usage) => {
    expect(readProviderTokenUsage("openai-chat-completions", chat(usage))).toEqual({ status: "unreported" });
    const parsed = parseOpenAIChatResponse(chat(usage));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).not.toHaveProperty("cacheReadTokens");
  });

  it("keeps explicitly reported zero distinct from missing", () => {
    const usage = readProviderTokenUsage("openai-responses", { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
    expect(usage).toEqual({ tokensUsed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, status: "reported" });
    expect(deriveCacheUsage(usage)).toEqual({ uncachedInputTokens: 0 });
  });

  it.each([-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "100", true, {}, []])("drops invalid counts without rejecting the answer (%j)", (value) => {
    const raw = chat({ ...fullUsage, prompt_tokens: value });
    const usage = readProviderTokenUsage("openai-chat-completions", raw);
    expect(usage).toMatchObject({ status: "invalid", invalidFields: ["inputTokens"] });
    expect(usage).not.toHaveProperty("inputTokens");
    const parsed = parseOpenAIChatResponse(raw);
    expect(parsed).toMatchObject({ ok: true, value: { content: "usable answer", outputTokens: 100 } });
    if (parsed.ok) expect(parsed.value).not.toHaveProperty("inputTokens");
  });

  it("validates total and cache fields too", () => {
    const usage = readProviderTokenUsage("openai-chat-completions", chat({ total_tokens: "1300", prompt_tokens: 1200, completion_tokens: null, prompt_tokens_details: { cached_tokens: -1, cache_write_tokens: Infinity } }));
    expect(usage).toEqual({ inputTokens: 1200, status: "invalid", invalidFields: ["tokensUsed", "cacheReadTokens", "cacheWriteTokens"] });
  });

  it.each([[], "bad", 4])("flags malformed usage containers while keeping usable text (%j)", (usage) => {
    expect(readProviderTokenUsage("openai-responses", chat(usage))).toEqual({ status: "invalid", issues: ["invalid-usage"] });
    expect(parseOpenAIResponsesResponse(chat(usage))).toMatchObject({ ok: true, value: { content: "usable answer" } });
  });

  it("does not manufacture an ordinary-input split from partial reporting", () => {
    const usage = normalizeTokenUsage({ inputTokens: 1200, cacheReadTokens: 1024 });
    expect(usage.status).toBe("partial");
    expect(deriveCacheUsage(usage)).toEqual({ cacheHitRate: 0.8533 });
    expect(deriveCacheUsage(normalizeTokenUsage({ inputTokens: 1200 }))).toEqual({});
  });

  it.each([
    { inputTokens: 10, cacheReadTokens: 11 },
    { inputTokens: 10, cacheWriteTokens: 11 },
    { inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 5 },
    { inputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: Number.MAX_SAFE_INTEGER, cacheWriteTokens: 1 },
  ])("flags inconsistent cache totals without clamping away evidence (%j)", (counts) => {
    const usage = normalizeTokenUsage(counts);
    expect(usage).toMatchObject({ ...counts, status: "inconsistent", issues: ["cache-exceeds-input"] });
    expect(deriveCacheUsage(usage)).toEqual({});
  });

  it("flags totals that cannot contain the reported input/output but allows unreported thinking", () => {
    expect(normalizeTokenUsage({ inputTokens: 8, outputTokens: 3, tokensUsed: 10 })).toMatchObject({ status: "inconsistent", issues: ["counts-exceed-total"] });
    expect(readProviderTokenUsage("gemini-generative-language", { usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, cachedContentTokenCount: 0, totalTokenCount: 50 } }).status).toBe("reported");
  });

  it("validates Gemini cached counts without changing the answer", () => {
    const raw = { candidates: [{ content: { parts: [{ text: "usable answer" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12, cachedContentTokenCount: -4 } };
    expect(readProviderTokenUsage("gemini-generative-language", raw)).toMatchObject({ status: "invalid", invalidFields: ["cacheReadTokens"] });
    const parsed = parseGeminiGenerateResponse(raw);
    expect(parsed).toMatchObject({ ok: true, value: { content: "usable answer", inputTokens: 10 } });
    if (parsed.ok) expect(parsed.value).not.toHaveProperty("cacheReadTokens");
  });

  it("replaces repeated cumulative Chat SSE usage rather than double counting", () => {
    const body = sse({ choices: [{ delta: { content: "usable answer" }, finish_reason: "stop" }], usage: fullUsage })
      + sse({ choices: [], usage: fullUsage }) + "data: [DONE]\n\n";
    expect(readProviderStreamUsage("openai-chat-completions", body)).toMatchObject({ tokensUsed: 1300, cacheReadTokens: 1024 });
    expect(aggregateProviderStream("openai-chat-completions", body).ok).toBe(true);
  });

  it("retains Responses usage when the terminal event fails", () => {
    const body = sse({ type: "response.failed", response: { error: { code: "server_error" }, usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 10 } } } });
    expect(aggregateProviderStream("openai-responses", body).ok).toBe(false);
    expect(readProviderStreamUsage("openai-responses", body)).toMatchObject({ status: "reported", tokensUsed: 12, cacheWriteTokens: 10 });
  });

  it("retains decoded usage before malformed SSE tails without accepting the stream", () => {
    const body = sse({ choices: [], usage: fullUsage }) + "data: {broken\n\n";
    expect(readProviderStreamUsage("openai-chat-completions", body)).toMatchObject({ tokensUsed: 1300, cacheReadTokens: 1024 });
    expect(aggregateProviderStream("openai-chat-completions", body).ok).toBe(false);
  });

  it("does not invent usage after a malformed stream or null usage chunk", () => {
    expect(readProviderStreamUsage("openai-responses", "data: {broken\n\n")).toEqual({ status: "unreported" });
    expect(readProviderStreamUsage("openai-chat-completions", sse({ usage: null }))).toEqual({ status: "unreported" });
  });
});
