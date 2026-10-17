import { describe, expect, it } from "vitest";
import { PROMPT_VERSION, canReplayConversation, buildPromptCacheKey, buildSourcePackage, formatSourcePackage, canUseContinuation, insertPositionedCitationLinks, buildTaskChatRequest, buildTaskMetaContext, isInvalidResponseContinuationError, modelEndpoint } from "./task-execution-support";
import { GEMINI_GENERATIVE_LANGUAGE_ADAPTER } from "./gemini-generative-language-adapter";
import { buildWebSearchPolicy } from "./provider-request-builders";
import type { TaskModelSnapshot, QueueTaskPayload } from "../types";
import { DEFAULT_MODEL_CAPABILITIES } from "../types";

describe("continuation support", () => {
  it.each(["define", "tag", "write"] as const)("always transmits a strict %s schema without a configurable output mode", taskType => {
    const request = buildTaskChatRequest(taskType, "<system_instructions>rules</system_instructions>input", { providerId: "p", model: "m", capabilities: DEFAULT_MODEL_CAPABILITIES }, {
      type: "object", properties: { marker: { type: "string", enum: ["SCHEMA_WINS"] } }, required: ["marker"],
    });
    expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema: { additionalProperties: false, required: ["marker"] } } });
    expect(request.messages.at(-1)?.content).toBe("input");
  });
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
    expect(responses).toContain(PROMPT_VERSION);
    expect(responses).not.toContain("v9");
  });

  it("does not reuse a continuation after the cache capability changes", () => {
    const snapshot: TaskModelSnapshot = {
      providerId: "openai",
      model: "custom-model",
      providerSnapshot: { apiKey: "", apiFormat: "openai-responses", baseUrl: "https://api.openai.com/v1/", embeddingApiFormat: "disabled", defaultChatModel: "custom-model", defaultEmbedModel: "", enabled: true },
      capabilities: { temperature: false, topP: false, reasoning: false, nativeWebSearch: false, promptCaching: true, responseContinuation: true },
    };
    const continuation = { previousResponseId: "resp_1", providerId: "openai", model: "custom-model", apiFormat: "openai-responses" as const, endpoint: "openai-responses|https://api.openai.com/v1", promptVersion: PROMPT_VERSION, responseContinuationEnabled: true, promptCachingEnabled: false };
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
      endpoint: "openai-responses|https://relay.test/v1", promptVersion: PROMPT_VERSION, responseContinuationEnabled: true,
      promptCachingEnabled: true, promptCacheMode: "explicit",
    });
    expect(request.previousResponseId).toBeUndefined();
    expect(request.promptCacheMode).toBe("explicit");
  });

  it("keeps the prior request as an exact prefix when phase history is present", () => {
    const snapshot: TaskModelSnapshot = {
      providerId: "provider", model: "model",
      providerSnapshot: { apiFormat: "openai-responses", baseUrl: "https://relay.test/v1" } as never,
      capabilities: { promptCaching: true, responseContinuation: true } as never,
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
      capabilities: { temperature: false, topP: false, reasoning: false, nativeWebSearch: true, promptCaching: false, responseContinuation: false },
    };
    expect(buildTaskChatRequest(taskType, "<system_instructions>rules</system_instructions>\ninput", snapshot).webSearch).toBeUndefined();
  });

  it.each([["write", "write"], ["verify", "verify"]] as const)("maps %s native search to its declared purpose", (taskType, purpose) => {
    const snapshot: TaskModelSnapshot = {
      providerId: "provider",
      model: "alias",
      capabilities: { temperature: false, topP: false, reasoning: false, nativeWebSearch: true, promptCaching: false, responseContinuation: false },
    };
    expect(buildTaskChatRequest(taskType, "<system_instructions>rules</system_instructions>\ninput", snapshot).webSearch).toEqual({ purpose });
  });

  it("preserves confirmed definitions and parents to disambiguate same-name concepts", () => {
    const payload = (coreDefinition: string, parents: string[]): QueueTaskPayload => ({ concept: {
      type: "theory", name: { chinese: "场", english: "Field" }, coreDefinition, parents, source: "hierarchical-expand",
    } });
    const physics = buildTaskMetaContext(payload("物理空间中的量分布", ["[[物理学]]"]));
    const social = buildTaskMetaContext(payload("社会关系与位置的结构", ["[[社会学]]"]));
    expect(physics).not.toBe(social);
    expect(JSON.parse(physics)).toMatchObject({ core_definition: "物理空间中的量分布", parents: ["[[物理学]]"] });
  });

  it("does not replay historical messages as new input when using a server response ID", () => {
    const snapshot = { providerId: "p", model: "m", providerSnapshot: { apiFormat: "openai-responses" }, capabilities: { responseContinuation: true, promptCaching: false } } as TaskModelSnapshot;
    const request = buildTaskChatRequest("write", "<system_instructions>current phase rules</system_instructions>new phase", snapshot, undefined, undefined, undefined, {
      previousResponseId: "resp_1", systemPrompt: "old phase rules", history: [{ role: "user", content: "old input" }, { role: "assistant", content: "old answer" }],
    });
    expect(request.previousResponseId).toBe("resp_1");
    expect(request.messages).toEqual([{ role: "system", content: "current phase rules" }, { role: "user", content: "new phase" }]);
  });

  it("grows Gemini write contents from one stable prefix and leaves verify independent", () => {
    const snapshot: TaskModelSnapshot = {
      providerId: "google", model: "gemini-4-argon",
      providerSnapshot: { apiFormat: "gemini-generative-language", baseUrl: "https://generativelanguage.googleapis.com/v1beta" } as never,
      capabilities: { nativeWebSearch: true, promptCaching: false, responseContinuation: false, reasoning: false } as never,
      thinkingLevel: "high",
    };
    const schema = { type: "object" };
    const core = buildTaskChatRequest("write", "<system_instructions>STABLE_RULES</system_instructions>\nCORE_TASK", snapshot, schema, "core");
    const prefix = ["STABLE_RULES", buildWebSearchPolicy("write", true), "CORE_TASK"].join("\n\n");
    expect(core.messages).toEqual([{ role: "user", content: prefix }]);
    expect(core.webSearch).toEqual({ purpose: "write" });
    expect(core.thinkingLevel).toBe("high");
    expect(core.promptCacheKey).toBeUndefined();
    const coreAnswer = "{\"definition\":\"CORE_ANSWER\"}";
    const narrative = buildTaskChatRequest("write", "<system_instructions>STABLE_RULES</system_instructions>\nNARRATIVE_TASK", snapshot, schema, "narrative", undefined, {
      providerId: "google", model: "gemini-4-argon", apiFormat: "gemini-generative-language", endpoint: modelEndpoint(snapshot),
      promptVersion: PROMPT_VERSION, responseContinuationEnabled: false, promptCachingEnabled: false,
      history: [{ role: "user", content: prefix }, { role: "assistant", content: coreAnswer }],
    });
    expect(narrative.messages).toEqual([
      { role: "user", content: prefix },
      { role: "assistant", content: coreAnswer },
      { role: "user", content: "NARRATIVE_TASK" },
    ]);
    const narrativeAnswer = "{\"historical_genesis\":\"NARRATIVE_ANSWER\"}";
    const structure = buildTaskChatRequest("write", "<system_instructions>STABLE_RULES</system_instructions>\nSTRUCTURE_TASK", snapshot, schema, "structure", undefined, {
      providerId: "google", model: "gemini-4-argon", apiFormat: "gemini-generative-language", endpoint: modelEndpoint(snapshot),
      promptVersion: PROMPT_VERSION, responseContinuationEnabled: false, promptCachingEnabled: false,
      history: [...narrative.messages.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })), { role: "assistant", content: narrativeAnswer }],
    });
    expect(structure.messages.slice(0, narrative.messages.length)).toEqual(narrative.messages);
    expect(structure.messages.at(-2)).toEqual({ role: "assistant", content: narrativeAnswer });
    expect(structure.messages.at(-1)).toEqual({ role: "user", content: "STRUCTURE_TASK" });
    const contentsOf = (plan: { body: Record<string, unknown> }) => plan.body.contents as unknown[];
    const corePlan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(core, core.webSearch);
    const narrativePlan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(narrative, narrative.webSearch);
    const structurePlan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(structure, structure.webSearch);
    expect(corePlan.body.systemInstruction).toBeUndefined();
    expect(corePlan.body.tools).toEqual([{ google_search: {} }]);
    expect(narrativePlan.body.systemInstruction).toBeUndefined();
    expect(contentsOf(narrativePlan)[0]).toEqual(contentsOf(corePlan)[0]);
    expect(contentsOf(structurePlan).slice(0, contentsOf(narrativePlan).length)).toEqual(contentsOf(narrativePlan));
    const verify = buildTaskChatRequest("verify", "<system_instructions>VERIFY_RULES</system_instructions>\nnote", snapshot, schema, "verify", undefined, {
      history: narrative.messages.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
    });
    expect(verify.messages).toEqual([{ role: "system", content: "VERIFY_RULES" }, { role: "user", content: "note" }]);
    expect(verify.webSearch).toEqual({ purpose: "verify" });
    const define = buildTaskChatRequest("define", "<system_instructions>DEFINE_RULES</system_instructions>\ninput", snapshot, schema, "define");
    expect(define.messages.map((message) => message.role)).toEqual(["system", "user"]);
    const noSearch = buildTaskChatRequest("write", "<system_instructions>STABLE_RULES</system_instructions>\nCORE_TASK", {
      ...snapshot, capabilities: { ...snapshot.capabilities!, nativeWebSearch: false },
    }, schema, "core");
    expect(noSearch.messages).toEqual([{ role: "user", content: "STABLE_RULES\n\nCORE_TASK" }]);
    expect(noSearch.webSearch).toBeUndefined();
    const custom = buildTaskChatRequest("write", "<system_instructions>STABLE_RULES</system_instructions>\nNARRATIVE_TASK", snapshot, schema, "narrative", undefined, {
      systemPrompt: "STABLE_RULES",
      history: [{ role: "user", content: "OLD_CORE_TASK" }, { role: "assistant", content: coreAnswer }],
    });
    expect(custom.messages[0]).toEqual({ role: "system", content: "STABLE_RULES" });
    expect(custom.messages[1]).toEqual({ role: "user", content: "OLD_CORE_TASK" });
    expect(custom.messages.at(-1)?.content).toBe("NARRATIVE_TASK");
  });

  it.each(["cards", "verify"] as const)("keeps %s Markdown output free of JSON constraints", taskType => {
    const request = buildTaskChatRequest(taskType, "<system_instructions>Markdown rules</system_instructions>input", { providerId: "p", model: "m", capabilities: DEFAULT_MODEL_CAPABILITIES }, { type: "object" });
    expect(request.response_format).toBeUndefined();
    expect(request.messages.at(-1)?.content).toBe("input");
  });

});


describe("compatible local history without server IDs", () => {
  it.each(["implicit", "explicit"] as const)("keeps %s cache history without an ID and refuses incompatible replay", mode => {
    const snapshot = { providerId: "p", model: "m", providerSnapshot: { apiFormat: "openai-responses", baseUrl: "https://relay.test/v1" }, capabilities: { responseContinuation: true, promptCaching: true, promptCacheMode: mode } } as TaskModelSnapshot;
    const conversation = { providerId: "p", model: "m", apiFormat: "openai-responses" as const, endpoint: "openai-responses|https://relay.test/v1", promptVersion: PROMPT_VERSION, responseContinuationEnabled: true, promptCachingEnabled: true, promptCacheMode: mode, history: [{ role: "user" as const, content: "previous" }, { role: "assistant" as const, content: "answer" }] };
    expect(canReplayConversation(conversation, snapshot)).toBe(true);
    expect(canUseContinuation(conversation, snapshot)).toBe(false);
    const request = buildTaskChatRequest("write", "<system_instructions>rules</system_instructions>next", snapshot, undefined, undefined, undefined, canReplayConversation(conversation, snapshot) ? conversation : undefined);
    expect(request.messages.slice(1, 3)).toEqual(conversation.history);
    for (const incompatible of [{ ...snapshot, model: "changed" }, { ...snapshot, providerId: "other" }, { ...snapshot, providerSnapshot: { ...snapshot.providerSnapshot!, baseUrl: "https://different.test/v1" } }]) expect(canReplayConversation(conversation, incompatible)).toBe(false);
    expect(canReplayConversation({ ...conversation, promptVersion: "unmatched-prompt" }, snapshot)).toBe(false);
    expect(canReplayConversation({ ...conversation, promptVersion: "v9" }, snapshot)).toBe(false);
  });
});
