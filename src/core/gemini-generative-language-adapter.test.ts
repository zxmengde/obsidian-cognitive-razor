import { describe, expect, it } from "vitest";
import { GEMINI_GENERATIVE_LANGUAGE_ADAPTER } from "./gemini-generative-language-adapter";
import { buildWebSearchPolicy } from "./provider-request-builders";

describe("Gemini Generative Language adapter", () => {
  it("omits ignored Gemini 4 sampling parameters while preserving thinking and output settings", () => {
    const plan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan({
      providerId: "google", model: "gemini-4-argon", messages: [{ role: "user", content: "任务" }],
      temperature: 0.2, topP: 0.8, thinkingLevel: "high", maxTokens: 32768,
    });
    expect(plan.body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "high" }, maxOutputTokens: 32768 });
  });

  it("owns the model endpoint and generation request plan", () => {
    const request = {
      providerId: "provider-1",
      model: "gemini model/1",
      messages: [
        { role: "system" as const, content: "system rule" },
        { role: "user" as const, content: "hello" },
      ],
      temperature: 0.2,
      topP: 0.8,
      maxTokens: 200,
      thinkingLevel: "HIGH",
      response_format: { type: "json_schema" as const, json_schema: { name: "test", schema: { type: "object" }, strict: true } },
    };
    const plan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(request, { purpose: "verify" });

    expect(GEMINI_GENERATIVE_LANGUAGE_ADAPTER).toMatchObject({
      apiFormat: "gemini-generative-language",
      requestPath: "models/{model}:generateContent",
      streamProtocol: "gemini-generative-language",
      authScheme: "gemini",
    });
    expect(GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPath(request.model))
      .toBe("models/gemini%20model%2F1:generateContent");
    expect(plan.contentCount).toBe(1);
    expect(plan.body).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      systemInstruction: { parts: [{ text: expect.stringContaining("system rule") }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object" },
        thinkingConfig: { thinkingLevel: "HIGH" },
      },
      tools: [{ google_search: {} }],
    });
    expect((plan.body.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text)
      .toContain("避免仅因进入新阶段而重复搜索");
    expect(JSON.stringify(plan.body)).not.toContain("max_uses");
  });

  it("keeps a write search policy in contents and does not copy it into systemInstruction", () => {
    const policy = buildWebSearchPolicy("write", true);
    const text = `稳定规则\n\n${policy}\n\n阶段任务`;
    const plan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan({
      providerId: "provider-1",
      model: "gemini-4-argon",
      messages: [{ role: "user", content: text }],
      response_format: { type: "json_schema", json_schema: { name: "write_output", schema: { type: "object" }, strict: true } },
      webSearch: { purpose: "write" },
    }, { purpose: "write" });
    expect(plan.body.systemInstruction).toBeUndefined();
    expect(plan.body.tools).toEqual([{ google_search: {} }]);
    expect(plan.body.contents).toEqual([{ role: "user", parts: [{ text }] }]);
    expect(JSON.stringify(plan.body).match(/<web_search_policy>/g)).toHaveLength(1);
  });

  it("sends thinkingLevel and leaves a thinking budget off the request", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const both = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan({
      providerId: "provider-1", model: "gemini-4-argon", messages, thinkingLevel: "high", thinkingBudget: 1024,
    });
    expect(both.body.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "high" } });
    const budgetOnly = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan({
      providerId: "provider-1", model: "gemini-4-argon", messages, thinkingBudget: 1024,
    });
    expect(budgetOnly.body.generationConfig).toBeUndefined();
  });

  it("delegates Gemini response parsing", () => {
    expect(GEMINI_GENERATIVE_LANGUAGE_ADAPTER.parseResponse({
      candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
    })).toMatchObject({ ok: true, value: { content: "ok", finishReason: "stop", tokensUsed: 5 } });
  });
});
