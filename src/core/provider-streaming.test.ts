import * as http from "http";
import { afterEach, describe, expect, it } from "vitest";
import type { Result } from "../types";
import {
  aggregateProviderStream,
  hasProviderStreamFraming,
  requestProviderStream,
  ProviderStreamAbortError,
  ProviderStreamTimeoutError,
} from "./provider-streaming";
import {
  parseGeminiGenerateResponse,
  parseOpenAIChatResponse,
  parseOpenAIResponsesResponse,
} from "./provider-response-parsers";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve());
  })));
});

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

async function withServer(
  handler: http.RequestListener,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  await run(`http://127.0.0.1:${address.port}/v1/chat/completions`);
}

function sse(data: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

describe("provider stream aggregation", () => {
  it.each([
    ["openai-responses", 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
    ["openai-chat-completions", 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'],
    ["gemini-generative-language", 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n'],
  ] as const)("keeps a cleanly closed but unfinished %s stream uncertain", (protocol, body) => {
    expect(aggregateProviderStream(protocol, body)).toMatchObject({ ok: false, error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN" } });
  });
  it("aggregates OpenAI Chat Completions deltas and usage", () => {
    const body = [
      sse({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] }),
      sse({ choices: [{ delta: { content: "hel" }, finish_reason: null }] }),
      sse({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], usage: {
        prompt_tokens: 4,
        completion_tokens: 2,
        total_tokens: 6,
      } }),
      sse("[DONE]"),
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-chat-completions", body));
    const parsed = unwrap(parseOpenAIChatResponse(aggregate));
    expect(parsed).toMatchObject({
      content: "hello",
      finishReason: "stop",
      tokensUsed: 6,
      inputTokens: 4,
      outputTokens: 2,
    });
  });

  it("aggregates Responses completion metadata, web search and citations", () => {
    const body = [
      sse({ type: "response.created", response: { id: "resp-1", status: "in_progress" } }),
      sse({ type: "response.output_text.delta", delta: "answer" }),
      sse({
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "web_search_call", id: "search-1" },
      }),
      sse({
        type: "response.completed",
        response: {
          status: "completed",
          output_text: "answer",
          output: [{
            type: "message",
            content: [{
              type: "output_text",
              text: "answer",
              annotations: [{ type: "url_citation", url: "https://example.test/source", title: "Source" }],
            }],
          }, { type: "web_search_call", id: "search-1" }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        },
      }, "response.completed"),
      sse("[DONE]"),
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-responses", body));
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed).toMatchObject({
      content: "answer",
      webSearchUsed: true,
      citations: [{ url: "https://example.test/source", title: "Source" }],
      tokensUsed: 5,
    });
  });

  it("keeps Responses text deltas when search output items are also present", () => {
    const body = [
      sse({ type: "response.created", response: { id: "resp-2", status: "in_progress" } }),
      sse({
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "web_search_call", id: "search-2" },
      }),
      sse({ type: "response.output_text.delta", delta: "answer" }),
      sse({
        type: "response.completed",
        response: {
          status: "completed",
          output: [{ type: "web_search_call", id: "search-2" }],
        },
      }),
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-responses", body));
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed).toMatchObject({ content: "answer", webSearchUsed: true });
  });

  it("accepts Responses output items when a relay omits the SDK-only output_text field", () => {
    const body = [
      sse({ type: "response.output_item.done", output_index: 0, item: {
        type: "message",
        content: [{ type: "text", text: "relay answer" }],
      } }),
      sse({ type: "response.completed", response: {
        status: "completed",
        output: [{ type: "message", content: [{ type: "text", text: "relay answer" }] }],
      } }),
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-responses", body));
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed.content).toBe("relay answer");
  });

  it("preserves Responses text carried directly on a message output item", () => {
    const aggregate = {
      status: "completed",
      output: [{ type: "message", text: "direct relay answer" }],
    };
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed.content).toBe("direct relay answer");
  });

  it("accepts streamed output items when response.created only provided an empty output array", () => {
    const body = [
      sse({ type: "response.created", response: { id: "r", status: "in_progress", output: [] } }),
      sse({
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "message", content: [{ type: "output_text", text: "answer" }] },
      }),
      sse({ type: "response.done", status: "completed" }),
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-responses", body));
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed.content).toBe("answer");
  });

  it("accepts a relay response.done envelope without reverting to in_progress", () => {
    const body = [
      sse({ type: "response.created", response: { status: "in_progress" } }),
      sse({ type: "response.output_text.delta", delta: "done answer" }),
      sse({ type: "response.done", status: "completed" }),
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-responses", body));
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed.content).toBe("done answer");
  });

  it("distinguishes a standard Responses failure event from unsupported framing", () => {
    const body = sse({
      type: "response.failed",
      response: {
        status: "failed",
        error: { code: "server_error", message: "secret-bearing upstream detail" },
      },
    }, "response.failed");

    const result = aggregateProviderStream("openai-responses", body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("E204_PROVIDER_ERROR");
      expect(result.error.message).toContain("response.failed");
      expect(result.error.message).toContain("server_error");
      expect(result.error.message).not.toContain("secret-bearing upstream detail");
    }
  });

  it("maps standard error events across relay protocols without exposing messages", () => {
    const fixtures = [
      {
        protocol: "openai-chat-completions" as const,
        body: sse({ error: { code: "rate_limit_exceeded", message: "chat secret" } }, "error"),
        providerCode: "rate_limit_exceeded",
        secret: "chat secret",
      },
      {
        protocol: "gemini-generative-language" as const,
        body: `${JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "gemini secret" } })}\n`,
        providerCode: "503",
        secret: "gemini secret",
      },
    ];

    for (const fixture of fixtures) {
      const result = aggregateProviderStream(fixture.protocol, fixture.body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("E208_PROVIDER_STREAM_FAILED");
        expect(result.error.message).toContain(fixture.providerCode);
        expect(result.error.message).not.toContain(fixture.secret);
      }
    }
  });

  it("keeps event names distinct when a relay omits blank lines", () => {
    const body = [
      "event: response.created\n",
      'data: {"response":{"status":"in_progress"}}\n',
      "event: response.output_text.delta\n",
      'data: {"delta":"answer"}\n',
      "event: response.completed\n",
      'data: {"response":{"status":"completed"}}\n',
    ].join("");

    const aggregate = unwrap(aggregateProviderStream("openai-responses", body));
    const parsed = unwrap(parseOpenAIResponsesResponse(aggregate));
    expect(parsed.content).toBe("answer");
  });

  it("aggregates Gemini NDJSON chunks and grounding metadata", () => {
    const body = [
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "答" }] } }] }),
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "案" }] }, finishReason: "STOP", groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.test/source", title: "Source" } }],
      } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 } }),
      "[DONE]",
    ].join("\n");

    const aggregate = unwrap(aggregateProviderStream("gemini-generative-language", body));
    const parsed = unwrap(parseGeminiGenerateResponse(aggregate));
    expect(parsed).toMatchObject({
      content: "答案",
      webSearchUsed: true,
      citations: [{ url: "https://example.test/source", title: "Source" }],
      tokensUsed: 6,
    });
  });

  it("merges grounding metadata spread across Gemini chunks", () => {
    const body = [
      JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "答" }] },
          groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.test/one", title: "One" } }] },
        }],
      }),
      JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "案" }] },
          finishReason: "STOP",
          groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.test/two", title: "Two" } }] },
        }],
      }),
    ].join("\n");

    const aggregate = unwrap(aggregateProviderStream("gemini-generative-language", body));
    const parsed = unwrap(parseGeminiGenerateResponse(aggregate));
    expect(parsed).toMatchObject({
      content: "答案",
      citations: [
        { url: "https://example.test/one", title: "One" },
        { url: "https://example.test/two", title: "Two" },
      ],
    });
  });

  it("does not treat a single completed JSON body as a stream", () => {
    expect(hasProviderStreamFraming({ "content-type": "application/json" }, JSON.stringify({
      choices: [{ message: { content: "complete" }, finish_reason: "stop" }],
    }))).toBe(false);
    expect(hasProviderStreamFraming({ "content-type": "text/event-stream" }, sse({ ok: true }))).toBe(true);
  });
});

describe("provider stream transport", () => {
  it("collects a chunked response without exposing partial output", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\n");
      setTimeout(() => response.end("data: [DONE]\n\n"), 5);
    }, async (url) => {
      const result = await requestProviderStream({
        url,
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeoutMs: 1000,
      });
      expect(result.status).toBe(200);
      expect(result.headers["content-type"]).toContain("text/event-stream");
      expect(result.body).toContain("hel");
      expect(result.body).toContain("[DONE]");
    });
  });

  it("uses an idle timeout after the response starts", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: {\"choices\":[]}\n\n");
      setTimeout(() => response.end("data: [DONE]\n\n"), 100);
    }, async (url) => {
      await expect(requestProviderStream({
        url,
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeoutMs: 20,
      })).rejects.toBeInstanceOf(ProviderStreamTimeoutError);
    });
  });

  it("destroys an in-flight request when cancelled", async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: {\"choices\":[]}\n\n");
    }, async (url) => {
      const controller = new AbortController();
      const pending = requestProviderStream({
        url,
        headers: { "Content-Type": "application/json" },
        body: "{}",
        timeoutMs: 1000,
        signal: controller.signal,
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      controller.abort("test cancelled");
      await expect(pending).rejects.toBeInstanceOf(ProviderStreamAbortError);
    });
  });
});
