import { describe, expect, it } from "vitest";
import {
  mayHaveEmptyContent, validateChatFinishReason, parseOpenAIChatResponse,
  parseGeminiGenerateResponse, parseOpenAIResponsesResponse, parseOpenAIEmbedResponse,
} from "./provider-response-parsers";

const unsupported = { ok: false, error: { code: "E207_PROVIDER_RESPONSE_UNSUPPORTED" } };
const chat = (content: unknown = "answer", finish_reason: unknown = "stop") => ({
  choices: [{ message: { content }, finish_reason }],
});
const message = (text: unknown, extra = {}) => ({ type: "message", content: [{ type: "output_text", text }], ...extra });

describe("finish reason validation", () => {
  it.each(["length", "recitation", "content_filter", "refusal", "safety", "blocked"])("allows empty %s output but rejects it at validation", reason => {
    expect(mayHaveEmptyContent(reason)).toBe(true);
    expect(validateChatFinishReason(reason, { provider: "test", finishReason: "old" })).toMatchObject({
      ok: false, error: { code: reason === "length" ? "E214_MODEL_OUTPUT_TRUNCATED" : "E213_SAFETY_VIOLATION",
        details: { provider: "test", finishReason: reason } },
    });
  });
  it.each([undefined, "stop", "unknown"])("does not invent a failure for %s", reason => {
    expect(mayHaveEmptyContent(reason)).toBe(false);
    expect(validateChatFinishReason(reason)).toEqual({ ok: true, value: undefined });
  });
});

describe.each([
  ["Chat Completions", parseOpenAIChatResponse], ["Gemini", parseGeminiGenerateResponse],
  ["Responses", parseOpenAIResponsesResponse], ["Embeddings", parseOpenAIEmbedResponse],
] as const)("%s root validation", (_name, parse) => {
  it.each([undefined, null, false, 42, "answer", []])("rejects non-object response %j", raw => {
    expect(parse(raw)).toMatchObject(unsupported);
  });
});

describe("Chat Completions parsing", () => {
  it("takes only the first choice and maps usage", () => {
    expect(parseOpenAIChatResponse({ ...chat(), choices: [...chat().choices, ...chat("ignored").choices],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } })).toEqual({
      ok: true, value: { content: "answer", finishReason: "stop", inputTokens: 4, outputTokens: 2, tokensUsed: 6 },
    });
  });
  it.each([{}, { choices: [] }, { choices: {} }, { choices: [null] }, chat(null), chat(5), chat("ok", null), chat("ok", "tool_calls")])("rejects malformed choice %j", raw => {
    expect(parseOpenAIChatResponse(raw)).toMatchObject(unsupported);
  });
  it.each(["length", "content_filter", "refusal", "safety", "blocked"])("preserves %s for downstream validation", reason => {
    expect(parseOpenAIChatResponse(chat(null, reason))).toEqual({ ok: true, value: { content: "", finishReason: reason } });
  });
  it("accepts an explicitly empty string on stop", () => {
    expect(parseOpenAIChatResponse(chat(""))).toEqual({ ok: true, value: { content: "", finishReason: "stop" } });
  });
  it("copies only safe reported metadata", () => {
    const raw = { ...chat(), model: "gateway/model-1", prompt_cache_options: { mode: "explicit", ttl: "30m", private: "hidden" }, private: "hidden" };
    expect(parseOpenAIChatResponse(raw)).toEqual({ ok: true, value: {
      content: "answer", finishReason: "stop", reportedModel: "gateway/model-1", reportedCacheMode: "explicit", reportedCacheTtl: "30m",
    } });
    expect(parseOpenAIChatResponse({ ...chat(), model: "bad model", prompt_cache_options: { mode: "other", ttl: "1h" } })).toEqual({ ok: true, value: { content: "answer", finishReason: "stop" } });
  });
});

describe("Gemini parsing", () => {
  it.each([
    { groundingChunks: [null] },
    { groundingChunks: {} },
    { groundingChunks: "chunks" },
    { groundingChunks: null },
    { groundingSupports: [null] },
    { groundingSupports: {} },
    { groundingSupports: [{ segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: {} }] },
    { groundingSupports: [{ segment: { startIndex: -1, endIndex: 5 }, groundingChunkIndices: {} }] },
    { groundingSupports: [{ groundingChunkIndices: "indices" }] },
  ])("rejects malformed grounding metadata %j", groundingMetadata => {
    expect(parseGeminiGenerateResponse({ candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP", groundingMetadata }] })).toMatchObject(unsupported);
  });
  it.each([42, {}, false, []].map(finishReason => ({ finishReason })))("rejects non-string finish reason $finishReason", ({ finishReason }) => {
    expect(parseGeminiGenerateResponse({ candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason }] })).toMatchObject(unsupported);
  });
  it("treats a null finish reason as missing and keeps prompt block fallback", () => {
    expect(parseGeminiGenerateResponse({ candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: null }] })).toMatchObject({
      ok: true, value: { content: "hello", finishReason: undefined },
    });
    expect(parseGeminiGenerateResponse({ candidates: [{ finishReason: null }], promptFeedback: { blockReason: "SAFETY" } })).toMatchObject({
      ok: true, value: { content: "", finishReason: "safety" },
    });
  });
  it.each([{ parts: [null] }, { parts: {} }, { parts: null }, { parts: "text" }, { parts: [{ text: "valid" }, null] }])("rejects malformed nested parts %j", content => {
    expect(parseGeminiGenerateResponse({ candidates: [{ content }] })).toMatchObject(unsupported);
  });
  it("joins text parts, ignores non-text parts and uses only the first candidate", () => {
    expect(parseGeminiGenerateResponse({ candidates: [
      { content: { parts: [{ text: "one" }, { inlineData: {} }, { text: 4 }, { text: "two" }] }, finishReason: "STOP" },
      { content: { parts: [{ text: "ignored" }] } },
    ], modelVersion: "gemini-test", usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } })).toMatchObject({
      ok: true, value: { content: "onetwo", finishReason: "stop", reportedModel: "gemini-test", citations: [], webSearchUsed: false, inputTokens: 5, outputTokens: 2, tokensUsed: 7 },
    });
  });
  it.each([{}, { candidates: [] }, { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }, { candidates: [{ finishReason: "OTHER" }] }])("rejects missing text or unknown finish reason %j", raw => {
    expect(parseGeminiGenerateResponse(raw)).toMatchObject(unsupported);
  });
  it.each([
    ["MAX_TOKENS", "length"], ["SAFETY", "safety"], ["IMAGE_SAFETY", "safety"],
    ["RECITATION", "recitation"], ["BLOCKLIST", "blocked"], ["PROHIBITED_CONTENT", "blocked"], ["SPII", "blocked"],
  ])("normalizes %s even when prompt blocked before candidates exist", (rawReason, reason) => {
    expect(parseGeminiGenerateResponse({ promptFeedback: { blockReason: rawReason } })).toMatchObject({ ok: true, value: { content: "", finishReason: reason } });
  });
  it("deduplicates grounding URLs and attaches only valid support ranges", () => {
    expect(parseGeminiGenerateResponse({ candidates: [{ content: { parts: [{ text: "hello" }] }, groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com/a", title: " Source " } }, { web: { uri: "https://example.com/a" } }, { web: { uri: "javascript:bad" } }],
      groundingSupports: [
        { segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: [0, 99, 2] },
        { segment: { startIndex: -1, endIndex: 5 }, groundingChunkIndices: [0] },
        { segment: { startIndex: 0, endIndex: 6 }, groundingChunkIndices: [0] },
      ],
    } }] })).toMatchObject({ ok: true, value: { webSearchUsed: true, citations: [
      { url: "https://example.com/a", title: "Source" }, { url: "https://example.com/a", title: "Source", startIndex: 0, endIndex: 5 },
    ] } });
  });
});

describe("Responses parsing", () => {
  it.each([
    { annotations: [null] },
    { annotations: [null, { type: "url_citation", url: "https://example.com/a" }] },
  ])("rejects malformed annotations $annotations even with convenience text", ({ annotations }) => {
    const output = [{ type: "message", content: [{ type: "output_text", text: "hello", annotations }] }];
    expect(parseOpenAIResponsesResponse({ output })).toMatchObject(unsupported);
    expect(parseOpenAIResponsesResponse({ output, output_text: "hello" })).toMatchObject(unsupported);
  });
  it.each([{}, null, 42, false])("rejects malformed message content %j even with convenience text", content => {
    expect(parseOpenAIResponsesResponse({ output_text: "answer", output: [{ type: "message", content }] })).toMatchObject(unsupported);
    expect(parseOpenAIResponsesResponse({ output: [{ content }] })).toMatchObject(unsupported);
  });
  it.each([{}, { output: {} }, { output: [null] }, { output: [[]] }, { output: ["text"] }, { output: [{ type: "reasoning", content: [{ text: "secret" }] }] }])("rejects empty or malformed output %j", raw => {
    expect(parseOpenAIResponsesResponse(raw)).toMatchObject(unsupported);
  });
  it("uses final answer phases instead of commentary, reasoning or SDK convenience text", () => {
    expect(parseOpenAIResponsesResponse({ status: "completed", id: "response-test", output_text: "commentary + final", output: [
      message("commentary", { phase: "commentary" }), { type: "reasoning", text: "secret" },
      message("final", { phase: "final_answer" }), message("unphased"), { type: "web_search_call" },
    ] })).toMatchObject({ ok: true, value: { content: "final", responseId: "response-test", webSearchUsed: true } });
  });
  it("accepts relay text wrappers and raw text parts while ignoring hidden content", () => {
    expect(parseOpenAIResponsesResponse({ output: [{ type: "message", text: { value: "a" }, content: [
      { type: "text", value: [{ text: "b" }, { value: "c" }] }, { text: "d" }, { type: "reasoning_text", text: "secret" }, null,
    ] }, { content: "e" }] })).toMatchObject({ ok: true, value: { content: "abcde" } });
    expect(parseOpenAIResponsesResponse({ output: [{ type: "message", content: "relay text" }] })).toMatchObject({ ok: true, value: { content: "relay text" } });
  });
  it("prefers SDK text for an unphased relay and falls back to Chat choices only without native text", () => {
    expect(parseOpenAIResponsesResponse({ ...chat("fallback"), output_text: { value: "native" }, output: [message("rebuilt")] })).toMatchObject({ ok: true, value: { content: "native" } });
    expect(parseOpenAIResponsesResponse(chat("fallback"))).toMatchObject({ ok: true, value: { content: "fallback", finishReason: "stop" } });
    expect(parseOpenAIResponsesResponse(chat(null))).toMatchObject(unsupported);
  });
  it.each(["queued", "in_progress", "failed", "cancelled"])("rejects status %s even with visible text", status => {
    expect(parseOpenAIResponsesResponse({ status, output_text: "partial" })).toMatchObject(unsupported);
  });
  it.each([undefined, "unknown"])("rejects incomplete output without a recognized reason %s", reason => {
    expect(parseOpenAIResponsesResponse({ status: "incomplete", output_text: "partial", incomplete_details: { reason } })).toMatchObject(unsupported);
  });
  it.each([["max_output_tokens", "length"], ["content_filter", "content_filter"]])("preserves recognized incomplete reason %s", (reason, finishReason) => {
    expect(parseOpenAIResponsesResponse({ status: "incomplete", incomplete_details: { reason } })).toMatchObject({ ok: true, value: { content: "", finishReason } });
  });
  it("reports error codes without copying the provider's arbitrary message", () => {
    const result = parseOpenAIResponsesResponse({ output_text: "text", error: { code: "overloaded", message: "private payload" } });
    expect(result).toMatchObject({ ok: false, error: { details: { providerCode: "overloaded" } } });
    expect(JSON.stringify(result)).not.toContain("private payload");
  });
  it.each(["function_call", "computer_call"])("rejects unsupported client tool %s", type => {
    expect(parseOpenAIResponsesResponse({ output_text: "text", output: [{ type }] })).toMatchObject(unsupported);
  });
  it("offsets citations across text parts and omits unsafe URLs and invalid ranges", () => {
    const output = [{ type: "message", content: [{ type: "output_text", text: "abc" }, {
      type: "output_text", text: "def", annotations: [
        { type: "url_citation", url: "https://example.com/a", start_index: 0, end_index: 3 },
        { type: "url_citation", url: "https://example.com/b", start_index: -4, end_index: 9 },
        { type: "url_citation", url: "javascript:bad" }, { type: "other", url: "https://example.com/c" },
      ],
    }] }];
    expect(parseOpenAIResponsesResponse({ output })).toMatchObject({ ok: true, value: { content: "abcdef", citations: [
      { url: "https://example.com/a", startIndex: 3, endIndex: 6 }, { url: "https://example.com/b" },
    ] } });
    const direct = parseOpenAIResponsesResponse({ output, output_text: "different" });
    expect(direct).toMatchObject({ ok: true, value: { citations: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }] } });
    if (direct.ok) expect(direct.value.citations?.[0]).not.toHaveProperty("startIndex");
  });
  it("retains validated completed replay only when its visible text matches", () => {
    const output = [{ type: "message", id: "msg-test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "answer", annotations: [] }] }];
    expect(parseOpenAIResponsesResponse({ status: "completed", output })).toMatchObject({ ok: true, value: { responsesOutput: output } });
    const mismatch = parseOpenAIResponsesResponse({ status: "completed", output, output_text: "different" });
    if (!mismatch.ok) throw new Error("Expected usable convenience text");
    expect(mismatch.value).not.toHaveProperty("responsesOutput");
  });
});

describe("Embedding parsing", () => {
  it.each([{ embedding: [] }, { embedding: ["bad"] }, { embedding: [NaN] }, { embedding: [Infinity] },
    { embedding: [-Infinity] }, { embedding: [0, null] }, { embedding: [false] }, { embedding: [undefined] },
    { embedding: new Array(1) }])("rejects an empty or invalid embedding vector %j", ({ embedding }) => {
    expect(parseOpenAIEmbedResponse({ data: [{ embedding }] })).toMatchObject(unsupported);
  });
  it("takes the first embedding and keeps reported zero usage", () => {
    expect(parseOpenAIEmbedResponse({ data: [{ embedding: [0.1, -0.2] }, { embedding: [99] }], usage: { total_tokens: 0 } })).toEqual({ ok: true, value: { embedding: [0.1, -0.2], tokensUsed: 0 } });
  });
  it.each([{}, { data: [] }, { data: {} }, { data: [null] }, { data: [{}] }, { data: [{ embedding: "bad" }] }])("rejects missing embedding %j", raw => {
    expect(parseOpenAIEmbedResponse(raw)).toMatchObject(unsupported);
  });
  it("omits unreported or invalid usage", () => {
    expect(parseOpenAIEmbedResponse({ data: [{ embedding: [1] }], usage: { total_tokens: -1 } })).toEqual({ ok: true, value: { embedding: [1] } });
  });
});
