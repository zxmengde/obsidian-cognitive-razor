import { describe, expect, it } from "vitest";
import { OPENAI_RESPONSES_ADAPTER } from "./openai-responses-adapter";
import { validateChatFinishReason } from "./provider-response-parsers";

describe("OpenAI Responses adapter", () => {
  it("lets Write reuse evidence without a forced search and keeps Verify search mandatory", () => {
    const request = { providerId: "fixture", model: "gpt-6.1-sol", messages: [{ role: "user" as const, content: "已有可靠证据" }] };
    const write = OPENAI_RESPONSES_ADAPTER.buildRequestBody(request, { purpose: "write" });
    const verify = OPENAI_RESPONSES_ADAPTER.buildRequestBody(request, { purpose: "verify" });
    expect(write.tool_choice).toBe("auto");
    expect(verify.tool_choice).toBe("required");
    expect(write.tools).toEqual(verify.tools);
    expect(write.tools).toEqual([{ type: "web_search" }]);
    expect(write.instructions).toContain("已有证据不足时必须补充取证或明确保留不确定性");
    expect(verify.instructions).toContain("内联 Markdown 链接");
  });

  it.each([undefined, null, {}])("rejects an explicitly incomplete response without a reason (%j)", (incompleteDetails) => {
    expect(OPENAI_RESPONSES_ADAPTER.parseResponse({
      status: "incomplete",
      incomplete_details: incompleteDetails,
      output: [{ type: "message", content: [{ type: "output_text", text: "## 部分卡片\n未完成的答案" }] }],
    })).toMatchObject({ ok: false, error: { code: "E207_PROVIDER_RESPONSE_UNSUPPORTED" } });
  });

  it.each([
    ["max_output_tokens", "E214_MODEL_OUTPUT_TRUNCATED"],
    ["content_filter", "E213_SAFETY_VIOLATION"],
  ])("preserves the existing rejection for a recognized incomplete reason (%s)", (reason, code) => {
    const result = OPENAI_RESPONSES_ADAPTER.parseResponse({
      status: "incomplete", incomplete_details: { reason }, output_text: "部分结果",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateChatFinishReason(result.value.finishReason)).toMatchObject({ ok: false, error: { code } });
  });

  it("keeps complete relay text compatible when the status is omitted", () => {
    expect(OPENAI_RESPONSES_ADAPTER.parseResponse({ output_text: "完整结果" }))
      .toMatchObject({ ok: true, value: { content: "完整结果" } });
  });

  it.each(["length", "content_filter"])("does not accept a relay's interrupted Chat Completions fallback as finished (%s)", (reason) => {
    const result = OPENAI_RESPONSES_ADAPTER.parseResponse({
      choices: [{ message: { content: "## 部分卡片\n未完成的答案" }, finish_reason: reason }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateChatFinishReason(result.value.finishReason).ok).toBe(false);
  });

  it("does not attach part offsets to a different output_text", () => {
    const result = OPENAI_RESPONSES_ADAPTER.parseResponse({
      status: "completed",
      output_text: "另一段完全不同的核查结论。",
      output: [{ type: "message", content: [{ type: "output_text", text: "原始结论。",
        annotations: [{ type: "url_citation", url: "https://example.test/source", start_index: 0, end_index: 4 }],
      }] }],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.citations).toEqual([{ url: "https://example.test/source", title: undefined }]);
  });

  it("owns Responses input, instruction, text and native-search mapping", () => {
    const body = OPENAI_RESPONSES_ADAPTER.buildRequestBody(
      {
        providerId: "provider-1",
        model: "reasoning-model",
        messages: [
          { role: "system", content: "system rule" },
          { role: "user", content: "hello" },
        ],
        maxTokens: 200,
        previousResponseId: "resp_prev",
        promptCacheKey: "cr:test",
        reasoning_effort: "high",
        response_format: {
          type: "json_schema",
          json_schema: { name: "result", schema: { type: "object" }, strict: true },
        },
      },
      { purpose: "verify" },
    );

    expect(OPENAI_RESPONSES_ADAPTER).toMatchObject({
      apiFormat: "openai-responses",
      requestPath: "responses",
      streamProtocol: "openai-responses",
      authScheme: "bearer",
    });
    expect(body).toMatchObject({
      model: "reasoning-model",
      input: "hello",
      previous_response_id: "resp_prev",
      prompt_cache_key: "cr:test",
      instructions: expect.stringContaining("system rule"),
      reasoning: { effort: "high" },
      max_output_tokens: 200,
      text: { format: { type: "json_schema", name: "result" } },
      tools: [{ type: "web_search" }],
      tool_choice: "required",
    });
    expect(body.tools).not.toContainEqual(expect.objectContaining({ max_uses: expect.anything() }));
    expect(String(body.instructions)).toContain("内联 Markdown 链接");
    expect(String(body.instructions)).toContain("不要仅因进入新阶段而重复相同搜索");
    expect(String(body.instructions)).not.toContain("仅用于内部取证");
  });

  it("maps GPT-6 explicit cache mode to a developer breakpoint", () => {
    const body = OPENAI_RESPONSES_ADAPTER.buildRequestBody({
      providerId: "openai",
      model: "gpt-6-astra",
      messages: [
        { role: "system", content: "Stable policy" },
        { role: "user", content: "Dynamic note" },
      ],
      promptCacheKey: "cr:v3:openai:gpt-6-astra",
      promptCacheMode: "explicit",
      promptCacheTtl: "30m",
    });

    expect(body).not.toHaveProperty("instructions");
    expect(body.prompt_cache_options).toEqual({ mode: "explicit", ttl: "30m" });
    expect(body.input).toEqual([
      {
        role: "developer",
        content: [{ type: "input_text", text: "Stable policy", prompt_cache_breakpoint: { mode: "explicit" } }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: "Dynamic note",
          prompt_cache_breakpoint: { mode: "explicit" },
        }],
      },
    ]);
  });

  it("delegates response shape parsing and usage mapping", () => {
    expect(OPENAI_RESPONSES_ADAPTER.parseResponse({
      status: "completed",
      id: "resp_123",
      output_text: "ok",
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    })).toEqual({
      ok: true,
      value: {
        content: "ok",
        responseId: "resp_123",
        citations: [],
        webSearchUsed: false,
        finishReason: undefined,
        tokensUsed: 5,
        inputTokens: 2,
        outputTokens: 3,
      },
    });
  });

  it("preserves explicitly configured sampling controls for every model name", () => {
    const body = OPENAI_RESPONSES_ADAPTER.buildRequestBody({
      providerId: "provider-1", model: "gpt-6-astra", messages: [{ role: "user", content: "x" }],
      temperature: 0.2, topP: 0.9,
    });
    expect(body).toMatchObject({ temperature: 0.2, top_p: 0.9 });
  });

  it("omits sampling controls when reasoning is active", () => {
    const body = OPENAI_RESPONSES_ADAPTER.buildRequestBody({
      providerId: "provider-1", model: "reasoning-model", messages: [{ role: "user", content: "x" }],
      reasoning_effort: "high", temperature: 0.2, topP: 0.9,
    });
    expect(body).toMatchObject({ reasoning: { effort: "high" } });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
  });
});


describe("explicit cache history boundaries", () => {
  it("retains a previous user endpoint when adding the next phase, bounded to four writes", () => {
    const history = [{ role: "system" as const, content: "policy" }, { role: "user" as const, content: "first task" }];
    const first = OPENAI_RESPONSES_ADAPTER.buildRequestBody({ providerId: "p", model: "m", messages: history, promptCacheMode: "explicit" });
    const second = OPENAI_RESPONSES_ADAPTER.buildRequestBody({ providerId: "p", model: "m", messages: [...history, { role: "assistant", content: "first answer" }, { role: "user", content: "second task" }], promptCacheMode: "explicit" });
    const boundaryPrefixes = (body: Record<string, unknown>): string[] => {
      let prefix = ""; const result: string[] = [];
      for (const message of body.input as Array<{ role: string; content: string | Array<{ text: string; prompt_cache_breakpoint?: unknown }> }>) {
        prefix += `[${message.role}]`;
        if (typeof message.content === "string") prefix += message.content;
        else for (const part of message.content) { prefix += part.text; if (part.prompt_cache_breakpoint) result.push(prefix); }
      }
      return result;
    };
    expect(boundaryPrefixes(second)).toContain(boundaryPrefixes(first).at(-1));
    const many = OPENAI_RESPONSES_ADAPTER.buildRequestBody({ providerId: "p", model: "m", messages: [history[0], ...Array.from({ length: 12 }, (_, i) => ({ role: "user" as const, content: `turn ${i}` }))], promptCacheMode: "explicit" });
    expect(boundaryPrefixes(many)).toHaveLength(4);
  });
});
