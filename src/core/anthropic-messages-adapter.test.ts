import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { DEFAULT_ENDPOINTS, type ChatRequest, type ProviderConfig } from "../types";
import { DEFAULT_SETTINGS, SettingsStore } from "../data/settings-store";
import { ANTHROPIC_API_VERSION, ANTHROPIC_MESSAGES_ADAPTER, DEFAULT_ANTHROPIC_MAX_TOKENS } from "./anthropic-messages-adapter";
import { buildProviderApiUrl } from "./provider-config";
import { mapHttpError } from "./provider-errors";
import { ProviderManager } from "./provider-manager";
import { buildJsonSchemaResponseFormat, suppressChatSampling, validateChatParameters } from "./provider-request-builders";
import { parseAnthropicMessagesResponse } from "./provider-response-parsers";
import {
  createResponsesStreamCompletionTracker,
  decodeProviderStream,
  hasProviderStreamFraming,
  readProviderStreamUsage,
} from "./provider-stream-codec";
import { deriveCacheUsage, readProviderTokenUsage } from "./provider-token-usage";
import { buildTaskChatRequest } from "./task-execution-support";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    providerId: "claude",
    model: "claude-sonnet-4-5",
    messages: [
      { role: "system", content: "System rules." },
      { role: "user", content: "Hello" },
    ],
    ...overrides,
  };
}

function makeAnthropicProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    apiKey: "test-anthropic-key",
    apiFormat: "anthropic-messages",
    embeddingApiFormat: "disabled",
    defaultChatModel: "claude-sonnet-4-5",
    defaultEmbedModel: "",
    enabled: true,
    ...overrides,
  };
}

describe("Anthropic Messages adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds official endpoint, version header, auth scheme, and merges consecutive turns", () => {
    expect(DEFAULT_ENDPOINTS["anthropic-messages"]).toBe("https://api.anthropic.com/v1");
    expect(buildProviderApiUrl("https://api.anthropic.com", "anthropic-messages", ANTHROPIC_MESSAGES_ADAPTER.requestPath))
      .toBe("https://api.anthropic.com/v1/messages");
    expect(buildProviderApiUrl("https://proxy.example/claude", "anthropic-messages", ANTHROPIC_MESSAGES_ADAPTER.requestPath))
      .toBe("https://proxy.example/claude/messages");
    expect(ANTHROPIC_MESSAGES_ADAPTER.authScheme).toBe("anthropic");
    expect(ANTHROPIC_MESSAGES_ADAPTER.extraHeaders).toEqual({ "anthropic-version": ANTHROPIC_API_VERSION });

    const plan = ANTHROPIC_MESSAGES_ADAPTER.buildRequestPlan(makeRequest({
      messages: [
        { role: "system", content: "Rule A" },
        { role: "system", content: "Rule B" },
        { role: "user", content: "Turn 1a" },
        { role: "user", content: "Turn 1b" },
        { role: "assistant", content: "Reply 1" },
        { role: "user", content: "Turn 2" },
      ],
    }));
    expect(plan.contentCount).toBe(3);
    expect(plan.body).toEqual({
      model: "claude-sonnet-4-5",
      max_tokens: DEFAULT_ANTHROPIC_MAX_TOKENS,
      system: "Rule A\n\nRule B",
      messages: [
        { role: "user", content: "Turn 1a\n\nTurn 1b" },
        { role: "assistant", content: "Reply 1" },
        { role: "user", content: "Turn 2" },
      ],
    });
  });

  it("emits output_config.format JSON Schema alongside native web_search and effort", () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    const plan = ANTHROPIC_MESSAGES_ADAPTER.buildRequestPlan(
      makeRequest({
        reasoning_effort: "medium",
        temperature: 0.7,
        topP: 0.9,
        response_format: buildJsonSchemaResponseFormat("test_schema", schema),
        capabilities: {
          temperature: true,
          topP: false,
          reasoning: true,
          nativeWebSearch: true,
          promptCaching: true,
          responseContinuation: false,
        },
      }),
      { purpose: "verify" },
    );

    expect(plan.body.thinking).toEqual({ type: "adaptive" });
    expect(plan.body.output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema },
    });
    expect(plan.body.temperature).toBeUndefined();
    expect(plan.body.top_p).toBeUndefined();
    expect(plan.body.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);
    expect(plan.body.system).toEqual([
      {
        type: "text",
        text: expect.stringContaining("<web_search_policy>"),
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(plan.body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
      },
    ]);
  });

  it("supports manual thinkingBudget and caps cache_control breakpoints at 4", () => {
    const plan = ANTHROPIC_MESSAGES_ADAPTER.buildRequestPlan(makeRequest({
      thinkingBudget: 12000,
      capabilities: {
        temperature: false,
        topP: false,
        reasoning: true,
        nativeWebSearch: false,
        promptCaching: true,
        responseContinuation: false,
      },
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "u2" },
        { role: "assistant", content: "a2" },
        { role: "user", content: "u3" },
        { role: "assistant", content: "a3" },
        { role: "user", content: "u4" },
      ],
    }));
    expect(plan.body.thinking).toEqual({ type: "enabled", budget_tokens: 12000 });
    expect(plan.body.max_tokens).toBe(16096);
    const messages = plan.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0].content).toBe("u1");
    expect(Array.isArray(messages[2].content)).toBe(true);
    expect(Array.isArray(messages[4].content)).toBe(true);
    expect(Array.isArray(messages[6].content)).toBe(true);
  });

  it("validates Anthropic parameter constraints without silent fallback", () => {
    expect(suppressChatSampling("anthropic-messages", "claude-sonnet-4-5", "high")).toBe(true);
    expect(suppressChatSampling("anthropic-messages", "claude-sonnet-4-5", "none")).toBe(false);
    expect(suppressChatSampling("anthropic-messages", "claude-sonnet-4-5", undefined, 2048)).toBe(true);

    expect(validateChatParameters(makeRequest({ temperature: 1.5 }), "anthropic-messages").ok).toBe(false);
    expect(validateChatParameters(makeRequest({ temperature: 0.5, topP: 0.9 }), "anthropic-messages").ok).toBe(false);
    expect(validateChatParameters(makeRequest({ temperature: 0.5, topP: 0.9, reasoning_effort: "low" }), "anthropic-messages").ok).toBe(true);
    expect(validateChatParameters(makeRequest({ thinkingBudget: 512 }), "anthropic-messages").ok).toBe(false);
    expect(validateChatParameters(makeRequest({ thinkingBudget: 4096, maxTokens: 4096 }), "anthropic-messages").ok).toBe(false);
    expect(validateChatParameters(makeRequest({ thinkingBudget: 4096, maxTokens: 8192 }), "anthropic-messages").ok).toBe(true);
    expect(validateChatParameters(makeRequest({ thinkingLevel: "HIGH" }), "anthropic-messages").ok).toBe(false);
    expect(validateChatParameters(makeRequest({ capabilities: { temperature: false, topP: false, reasoning: false, nativeWebSearch: true, promptCaching: true, responseContinuation: false } }), "anthropic-messages").ok).toBe(true);
  });

  it("parses visible text, excludes thinking blocks, extracts citations, and accounts cache tokens", () => {
    const raw = {
      id: "msg_01abc",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      content: [
        { type: "thinking", thinking: "Internal scratchpad" },
        { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "test" } },
        { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        {
          type: "text",
          text: "Verified claim.",
          citations: [
            { type: "web_search_result_location", url: "https://example.org/spec", title: "Official Spec" },
          ],
        },
        { type: "text", text: " Second part." },
      ],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 400,
        cache_creation_input_tokens: 500,
        output_tokens: 60,
        server_tool_use: { web_search_requests: 1 },
      },
    };

    const parsed = parseAnthropicMessagesResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.content).toBe("Verified claim. Second part.");
    expect(parsed.value.responseId).toBe("msg_01abc");
    expect(parsed.value.reportedModel).toBe("claude-sonnet-4-5-20250929");
    expect(parsed.value.webSearchUsed).toBe(true);
    expect(parsed.value.finishReason).toBe("stop");
    expect(parsed.value.citations).toEqual([
      { url: "https://example.org/spec", title: "Official Spec", startIndex: 0, endIndex: 15 },
    ]);
    expect(parsed.value.inputTokens).toBe(1000);
    expect(parsed.value.cacheReadTokens).toBe(400);
    expect(parsed.value.cacheWriteTokens).toBe(500);
    expect(parsed.value.outputTokens).toBe(60);
    expect(parsed.value.tokensUsed).toBe(1060);
    const usage = readProviderTokenUsage("anthropic-messages", raw);
    expect(usage.status).toBe("reported");
    expect(deriveCacheUsage(usage)).toEqual({
      cacheHitRate: 0.4,
      cacheWriteRate: 0.5,
      uncachedInputTokens: 100,
    });
  });

  it("maps Anthropic stop reasons, client tool_use, HTTP 529, and output_config schema errors", () => {
    expect(parseAnthropicMessagesResponse({ content: [{ type: "tool_use", id: "t1", name: "x" }], stop_reason: "tool_use" }))
      .toMatchObject({ ok: false, error: { code: "E207_PROVIDER_RESPONSE_UNSUPPORTED" } });
    expect(parseAnthropicMessagesResponse({ content: [{ type: "text", text: "cut" }], stop_reason: "max_tokens" }))
      .toMatchObject({ ok: false, error: { code: "E214_MODEL_OUTPUT_TRUNCATED" } });
    expect(parseAnthropicMessagesResponse({ content: [], stop_reason: "refusal" }))
      .toMatchObject({ ok: false, error: { code: "E213_SAFETY_VIOLATION" } });
    expect(mapHttpError(529, JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })))
      .toMatchObject({ ok: false, error: { code: "E204_PROVIDER_ERROR", details: { status: 529, providerType: "overloaded_error" } } });
    expect(mapHttpError(400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "output_config is not supported" } })))
      .toMatchObject({ ok: false, error: { code: "E205_PROVIDER_REQUEST_INVALID", message: expect.stringContaining("JSON Schema") } });
  });

  it("decodes Anthropic SSE streams in a single pass with early terminal detection and error mapping", () => {
    const sse = [
      "event: message_start",
      `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_s1", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [], stop_reason: null, usage: { input_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0, output_tokens: 1 } } })}`,
      "",
      "event: ping",
      `data: ${JSON.stringify({ type: "ping" })}`,
      "",
      "event: content_block_start",
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reasoning" } })}`,
      "",
      "event: content_block_stop",
      `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
      "",
      "event: content_block_start",
      `data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"ok":' } })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "true}" } })}`,
      "",
      "event: content_block_delta",
      `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://anthropic.com/docs", title: "Docs" } } })}`,
      "",
      "event: content_block_stop",
      `data: ${JSON.stringify({ type: "content_block_stop", index: 1 })}`,
      "",
      "event: message_delta",
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 15 } })}`,
      "",
      "event: message_stop",
      `data: ${JSON.stringify({ type: "message_stop" })}`,
      "",
      "",
    ].join("\n");

    const tracker = createResponsesStreamCompletionTracker("anthropic-messages");
    expect(tracker).toBeDefined();
    expect(tracker!(sse)).toBeGreaterThan(0);

    expect(hasProviderStreamFraming({ "content-type": "text/event-stream" }, JSON.stringify({ type: "message", content: [{ type: "text", text: "ok" }] }))).toBe(false);
    expect(hasProviderStreamFraming({ "content-type": "text/event-stream" }, sse)).toBe(true);

    const { aggregate, observedUsage } = decodeProviderStream("anthropic-messages", sse);
    expect(observedUsage).toMatchObject({ status: "reported", inputTokens: 100, cacheReadTokens: 80, outputTokens: 15, tokensUsed: 115 });
    expect(readProviderStreamUsage("anthropic-messages", sse)).toEqual(observedUsage);
    expect(aggregate.ok).toBe(true);
    if (!aggregate.ok) return;
    const parsed = parseAnthropicMessagesResponse(aggregate.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.content).toBe('{"ok":true}');
    expect(parsed.value.webSearchUsed).toBe(true);
    expect(parsed.value.citations).toEqual([{ url: "https://anthropic.com/docs", title: "Docs", startIndex: 0, endIndex: 11 }]);

    const overloadedSse = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"busy\"}}\n\n";
    expect(decodeProviderStream("anthropic-messages", overloadedSse).aggregate)
      .toMatchObject({ ok: false, error: { code: "E204_PROVIDER_ERROR" } });
    const incompleteSse = `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m1", usage: { input_tokens: 10 } } })}\n\n`;
    expect(decodeProviderStream("anthropic-messages", incompleteSse).aggregate)
      .toMatchObject({ ok: false, error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN" } });
  });

  it("forwards x-api-key and anthropic-version on both JSON and streaming requests via ProviderManager", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.claude = makeAnthropicProvider({
      baseUrl: "https://claude.local",
      capabilities: { promptCaching: true, nativeWebSearch: true, reasoning: true, temperature: true },
      parameters: { temperature: 0.4, reasoning_effort: "low" },
    });
    settings.defaultProviderId = "claude";
    settings.enableStreamingKeepalive = true;
    const store = new SettingsStore({ loadData: async () => settings, saveData: vi.fn() } as never);
    await store.loadSettings();

    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    const manager = new ProviderManager(store, noopLogger, undefined, async (req) => {
      capturedHeaders = req.headers;
      capturedBody = JSON.parse(req.body) as Record<string, unknown>;
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: [
          "event: message_start",
          `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 12, output_tokens: 1 } } })}`,
          "",
          "event: content_block_start",
          `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
          "",
          "event: content_block_delta",
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}`,
          "",
          "event: message_delta",
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } })}`,
          "",
          "event: message_stop",
          `data: ${JSON.stringify({ type: "message_stop" })}`,
          "",
          "",
        ].join("\n"),
      };
    });

    try {
      const snapshot = resolveTaskModelSnapshot(store.getSettings(), "write");
      expect(snapshot.capabilities.promptCaching).toBe(true);
      expect(snapshot.temperature).toBeUndefined();
      const request = buildTaskChatRequest("write", "<system_instructions>Rules</system_instructions>Body", snapshot);
      expect(request.promptCacheKey).toBeUndefined();
      const result = await manager.chat(request);
      expect(result.ok).toBe(true);
      expect(capturedHeaders?.["x-api-key"]).toBe("test-anthropic-key");
      expect(capturedHeaders?.["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
      expect(capturedHeaders?.Authorization).toBeUndefined();
      expect(capturedBody?.stream).toBe(true);
      expect(capturedBody?.thinking).toEqual({ type: "adaptive" });
      expect(capturedBody?.output_config).toEqual({ effort: "low" });
      expect(capturedBody?.tools).toEqual([{ type: "web_search_20250305", name: "web_search" }]);

      const requestUrlSpy = vi.spyOn(obsidian, "requestUrl").mockResolvedValue({
        status: 200,
        text: "",
        json: {
          id: "msg_probe",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: '{"ok":true}' }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      } as never);
      const probe = await manager.probe({ providerId: "claude" });
      expect(probe.ok).toBe(true);
      const probeCall = requestUrlSpy.mock.calls[0][0] as { url: string; headers: Record<string, string>; body: string };
      expect(probeCall.url).toBe("https://claude.local/v1/messages");
      expect(probeCall.headers["x-api-key"]).toBe("test-anthropic-key");
      expect(probeCall.headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
      expect(JSON.parse(probeCall.body)).toMatchObject({
        output_config: { format: { type: "json_schema" } },
      });
    } finally {
      manager.dispose();
    }
  });
});
