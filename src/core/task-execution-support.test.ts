import { describe, expect, it } from "vitest";
import { buildPromptCacheKey, buildSourcePackage, formatSourcePackage, canUseContinuation, insertPositionedCitationLinks, buildTaskChatRequest, isInvalidResponseContinuationError } from "./task-execution-support";
import type { TaskModelSnapshot } from "../types";

describe("continuation support", () => {
  it("deduplicates and bounds citation fallback data", () => {
    const sources = buildSourcePackage([
      { url: "https://example.test/a", title: "A" },
      { url: "https://example.test/a", title: "duplicate" },
      { url: "javascript:alert(1)", title: "bad" },
    ]);
    expect(sources).toEqual({ items: [{ url: "https://example.test/a", title: "A" }] });
    expect(formatSourcePackage(sources)).toContain("https://example.test/a");
    expect(formatSourcePackage(sources)).not.toContain("duplicate");
  });

  it("separates cache routing by protocol and normalized endpoint", () => {
    const responses = buildPromptCacheKey("openai", "gpt-6-astra", "openai-responses", "HTTPS://API.OPENAI.COM/v1///");
    const chat = buildPromptCacheKey("openai", "gpt-6-astra", "openai-chat-completions", "https://api.openai.com/v1");
    const relay = buildPromptCacheKey("openai", "gpt-6-astra", "openai-responses", "https://relay.example/v1");
    expect(responses).toBe(buildPromptCacheKey("openai", "gpt-6-astra", "openai-responses", "https://api.openai.com/v1"));
    expect(chat).not.toBe(responses);
    expect(relay).not.toBe(responses);
    expect(responses.length).toBeLessThanOrEqual(64);
  });

  it("does not reuse a continuation after the cache capability changes", () => {
    const snapshot: TaskModelSnapshot = {
      providerId: "openai",
      model: "custom-model",
      providerSnapshot: { apiKey: "", apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1/", embeddingApiFormat: "disabled", defaultChatModel: "custom-model", defaultEmbedModel: "", enabled: true },
      capabilities: { temperature: false, topP: false, reasoning: false, structuredOutput: "prompt", nativeWebSearch: false, promptCaching: true, responseContinuation: true },
    };
    const continuation = { previousResponseId: "resp_1", providerId: "openai", model: "custom-model", apiFormat: "openai-responses" as const, endpoint: "openai-responses|https://api.openai.com/v1", promptVersion: "v3", responseContinuationEnabled: true, promptCachingEnabled: false };
    expect(canUseContinuation(continuation, snapshot)).toBe(false);
  });

  it("only retries explicit continuation rejection, not generic 400 or uncertain failures", () => {
    expect(isInvalidResponseContinuationError({
      code: "E205_PROVIDER_REQUEST_INVALID",
      message: "API 请求无效 (400)，请检查协议、模型和参数",
      details: { status: 400, rawResponse: "generic invalid request" },
    })).toBe(false);
    expect(isInvalidResponseContinuationError({
      code: "E205_PROVIDER_REQUEST_INVALID",
      details: { status: 400, rawResponse: "previous_response_id not found" },
    })).toBe(true);
    expect(isInvalidResponseContinuationError({
      code: "E206_PROVIDER_REQUEST_UNCERTAIN",
      message: "结果未知",
      details: { status: 503 },
    })).toBe(false);
  });

  it("uses accumulated prompt caching instead of Responses continuation in explicit mode", () => {
    const request = buildTaskChatRequest("write", "<system_instructions>rules</system_instructions>\nprevious", {
      providerId: "provider", model: "model",
      providerSnapshot: { apiFormat: "openai-responses", baseUrl: "https://relay.test/v1" } as never,
      capabilities: { responseContinuation: true, promptCaching: true, promptCacheMode: "explicit" } as never,
    }, undefined, undefined, undefined, {
      previousResponseId: "resp_previous", providerId: "provider", model: "model", apiFormat: "openai-responses",
      endpoint: "openai-responses|https://relay.test/v1", promptVersion: "v3", responseContinuationEnabled: true,
      promptCachingEnabled: true, promptCacheMode: "explicit",
    });
    expect(request.previousResponseId).toBeUndefined();
    expect(request.promptCacheMode).toBe("explicit");
  });

  it("keeps the prior request as an exact prefix when phase history is present", () => {
    const snapshot: TaskModelSnapshot = {
      providerId: "provider", model: "model",
      providerSnapshot: { apiFormat: "openai-responses", baseUrl: "https://relay.test/v1" } as never,
      capabilities: { structuredOutput: "prompt", promptCaching: true, responseContinuation: true } as never,
    };
    const first = buildTaskChatRequest(
      "write", "<system_instructions>stable rules</system_instructions>\nfirst task", snapshot,
      { type: "object" }, "core",
    );
    const second = buildTaskChatRequest(
      "write", "<system_instructions>different phase rules</system_instructions>\nsecond task", snapshot,
      { type: "object" }, "narrative", undefined,
      {
        systemPrompt: first.messages[0].content,
        history: [
          { role: "user", content: first.messages.at(-1)?.content ?? "" },
          { role: "assistant", content: "first response" },
        ],
      },
    );
    expect(second.messages.slice(0, 3)).toEqual([
      first.messages[0],
      { role: "user", content: first.messages.at(-1)?.content ?? "" },
      { role: "assistant", content: "first response" },
    ]);
    expect(second.messages.at(-1)?.content).toContain("second task");
    expect(second.messages.at(-1)?.content).toContain("different phase rules");
    expect(second.previousResponseId).toBeUndefined();
  });

  it("recognizes gateway continuation errors in providerMessage", () => {
    expect(isInvalidResponseContinuationError({
      code: "E205_PROVIDER_REQUEST_INVALID",
      details: { status: 400, providerMessage: "Invalid `previous_response_id`." },
    })).toBe(true);
  });

  it("only inserts citations with valid Provider positions", () => {
    const report = "结论成立。";
    expect(insertPositionedCitationLinks(report, [
      { url: "https://example.test/source", title: "来源", startIndex: 0, endIndex: 4 },
      { url: "https://example.test/guess", startIndex: 0, endIndex: 99 },
    ])).toBe("结论成立 [来源](https://example.test/source)。");
  });

  it.each(["define", "tag"] as const)("does not map %s native search capability to Write search", (taskType) => {
    const snapshot: TaskModelSnapshot = {
      providerId: "provider",
      model: "alias",
      capabilities: { temperature: false, topP: false, reasoning: false, structuredOutput: "prompt", nativeWebSearch: true, promptCaching: false, responseContinuation: false },
    };
    expect(buildTaskChatRequest(taskType, "<system_instructions>rules</system_instructions>\ninput", snapshot).webSearch).toBeUndefined();
  });

  it.each([["write", "write"], ["verify", "verify"]] as const)("maps %s native search to its declared purpose", (taskType, purpose) => {
    const snapshot: TaskModelSnapshot = {
      providerId: "provider",
      model: "alias",
      capabilities: { temperature: false, topP: false, reasoning: false, structuredOutput: "prompt", nativeWebSearch: true, promptCaching: false, responseContinuation: false },
    };
    expect(buildTaskChatRequest(taskType, "<system_instructions>rules</system_instructions>\ninput", snapshot).webSearch).toEqual({ purpose });
  });

  it("keeps the local schema contract when API structured output is disabled", () => {
    const snapshot: TaskModelSnapshot = {
      providerId: "provider",
      model: "alias",
      capabilities: { temperature: false, topP: false, reasoning: false, structuredOutput: "prompt", nativeWebSearch: false, promptCaching: false, responseContinuation: false },
    };
    const request = buildTaskChatRequest("define", "<system_instructions>rules</system_instructions>\ninput", snapshot, { type: "object" });
    expect(request.response_format).toBeUndefined();
    expect(request.messages.at(-1)?.content).toContain("JSON Schema");
  });
});
