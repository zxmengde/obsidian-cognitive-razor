import { describe, expect, it } from "vitest";
import { OPENAI_CHAT_COMPLETIONS_ADAPTER } from "./openai-chat-adapter";

describe("OpenAI Chat Completions adapter", () => {
  it("owns the protocol endpoint and request mapping", () => {
    const body = OPENAI_CHAT_COMPLETIONS_ADAPTER.buildRequestBody({
      providerId: "provider-1",
      model: "model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      topP: 0.8,
      maxTokens: 200,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });

    expect(OPENAI_CHAT_COMPLETIONS_ADAPTER).toMatchObject({
      apiFormat: "openai-chat-completions",
      requestPath: "chat/completions",
      streamProtocol: "openai-chat-completions",
      authScheme: "bearer",
    });
    expect(body).toEqual({
      model: "model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      top_p: 0.8,
      max_tokens: 200,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });
  });

  it("omits sampling parameters when reasoning is active", () => {
    const body = OPENAI_CHAT_COMPLETIONS_ADAPTER.buildRequestBody({
      providerId: "provider-1",
      model: "reasoning-model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      topP: 0.8,
      reasoning_effort: "high",
    });

    expect(body).toEqual({
      model: "reasoning-model",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });
  });

  it("delegates response shape validation to the protocol parser", () => {
    expect(OPENAI_CHAT_COMPLETIONS_ADAPTER.parseResponse({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    })).toEqual({ ok: true, value: { content: "ok", finishReason: "stop" } });
  });
});
