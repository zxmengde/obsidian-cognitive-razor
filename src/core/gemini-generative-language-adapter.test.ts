import { describe, expect, it } from "vitest";
import { GEMINI_GENERATIVE_LANGUAGE_ADAPTER } from "./gemini-generative-language-adapter";

describe("Gemini Generative Language adapter", () => {
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
      response_format: { type: "json_object" as const },
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
        thinkingConfig: { thinkingLevel: "HIGH" },
      },
      tools: [{ google_search: {} }],
    });
    expect((plan.body.systemInstruction as { parts: Array<{ text: string }> }).parts[0].text)
      .toContain("不要仅因进入新阶段而重复相同搜索");
    expect(JSON.stringify(plan.body)).not.toContain("max_uses");
  });

  it("delegates Gemini response parsing", () => {
    expect(GEMINI_GENERATIVE_LANGUAGE_ADAPTER.parseResponse({
      candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
    })).toMatchObject({ ok: true, value: { content: "ok", finishReason: "stop", tokensUsed: 5 } });
  });
});
