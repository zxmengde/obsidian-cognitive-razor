import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { aggregateProviderStream, createResponsesStreamCompletionTracker, requestProviderStream, readProviderStreamUsage } from "./provider-streaming";
import { createRendererStreamRequester } from "./renderer-fetch-stream";
import { parseOpenAIResponsesResponse, validateChatFinishReason } from "./provider-response-parsers";
import type { ProviderStreamResponse } from "./provider-streaming";

const usage = { input_tokens: 4, output_tokens: 2, total_tokens: 6, input_tokens_details: { cached_tokens: 1 } };
const frame = (type: string, data: object = {}) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...data })}\r\n\r\n`;
const cases = [
  ["response.completed", { response: { status: "completed", output_text: "完整中文", usage } }],
  ["response.failed", { response: { status: "failed", error: { code: "invalid_request" }, usage } }],
  ["response.incomplete", { response: { status: "incomplete", output_text: "partial", usage } }],
  ["response.incomplete", { response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "partial", usage } }],
] as const;

async function heldStream(transport: "node" | "renderer", body: string, check: (value: ProviderStreamResponse) => void) {
  const controller = new AbortController();
  const input = { protocol: "openai-responses" as const, url: "https://example.test/responses", body: "{}", headers: {}, timeoutMs: 1000, signal: controller.signal };
  if (transport === "renderer") {
    const cancel = vi.fn();
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { for (const byte of new TextEncoder().encode(body)) stream.enqueue(new Uint8Array([byte])); }, cancel,
    }), { headers: { "content-type": "text/event-stream" } }));
    try {
      check(await createRendererStreamRequester(fetcher as typeof fetch)(input));
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
      const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(options[1].signal?.aborted).toBe(true);
    } finally { controller.abort(); }
  } else {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++; response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(body);
      // Deliberately no response.end(): a gateway can leave the SSE connection open.
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture bind failed");
    try { check(await requestProviderStream({ ...input, url: `http://127.0.0.1:${address.port}/responses` })); expect(requests).toBe(1); }
    finally { controller.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
}

for (const transport of ["node", "renderer"] as const) {
  it.each(cases)(`${transport} ends held SSE at %s while preserving success, failure, incomplete and usage semantics`, async (type, data) => {
    const terminal = frame(type, data);
    const body = "\uFEFF: heartbeat\r\n\r\n" + frame("response.output_text.delta", { delta: "完整中文" }) + terminal;
    await heldStream(transport, body + 'data: {"unfinished trailer":', value => {
      expect(value.body.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")).toBe(body.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
      const parsed = aggregateProviderStream("openai-responses", value.body);
      if (type === "response.failed") expect(parsed).toMatchObject({ ok: false, error: { code: "E205_PROVIDER_REQUEST_INVALID" } });
      else {
        expect(parsed).toMatchObject({ ok: true, value: { status: type === "response.completed" ? "completed" : "incomplete" } });
        if (parsed.ok) {
          const response = parseOpenAIResponsesResponse(parsed.value);
          if (type === "response.completed") expect(response.ok).toBe(true);
          else if (response.ok) expect(validateChatFinishReason(response.value.finishReason).ok).toBe(false);
          else expect(response.ok).toBe(false);
        }
      }
      expect(readProviderStreamUsage("openai-responses", value.body)).toMatchObject({ tokensUsed: 6, inputTokens: 4, outputTokens: 2, cacheReadTokens: 1 });
    });
  });
}

it("recognizes only a complete terminal frame at every possible chunk boundary", () => {
  const body = frame("response.completed", { response: { output_text: "中文🙂", status: "completed" } });
  for (let index = 0; index < body.length; index++) {
    const read = createResponsesStreamCompletionTracker("openai-responses")!;
    const first = read(body.slice(0, index));
    const second = read(body.slice(index));
    expect(first ?? second).toBeGreaterThanOrEqual(body.length - 1);
  }
  const read = createResponsesStreamCompletionTracker("openai-responses")!;
  expect(read('event: response.completed\ndata: {"type":"response.completed"')).toBeUndefined();
  expect(read('}\n')).toBeUndefined();
  expect(read('\n')).toBeDefined();
  expect(createResponsesStreamCompletionTracker("openai-chat-completions")).toBeUndefined();
});
