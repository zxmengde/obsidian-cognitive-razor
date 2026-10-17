import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { ProviderStreamAbortError } from "./provider-streaming";
import {
  ObsidianProviderTransport,
  ProviderAbortError,
  ProviderTimeoutError,
} from "./provider-transport";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(requestUrl).mockReset();
});

describe("ObsidianProviderTransport", () => {
  it("honors 3600 seconds through the default renderer transport after 600 seconds", async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.spyOn(window, "fetch").mockImplementation(async () => ({
      status: 200,
      type: "cors",
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({ start(controller) { stream = controller; } }),
    } as Response));
    const transport = new ObsidianProviderTransport();
    try {
      let failure: unknown;
      const pending = transport.requestStream({
        transport: "renderer-fetch", url: "https://example.test", headers: {}, body: "{}", timeoutMs: 3_600_000,
      });
      void pending.catch(error => { failure = error; });
      await vi.advanceTimersByTimeAsync(600_001);
      expect(failure).toBeUndefined();
      stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      stream.close();
      await expect(pending).resolves.toMatchObject({ status: 200, body: "data: [DONE]\n\n" });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      transport.dispose();
      fetcher.mockRestore();
    }
  });

  it("turns dispose into an explicit abort for a pending JSON request", async () => {
    vi.mocked(requestUrl).mockReturnValue(new Promise(() => {}) as never);
    const transport = new ObsidianProviderTransport();
    const pending = transport.requestJson({ url: "https://example.test", method: "POST" }, 60_000);

    await Promise.resolve();
    transport.dispose();

    await expect(pending).rejects.toBeInstanceOf(ProviderAbortError);
  });

  it("keeps timeout classification inside the transport boundary", async () => {
    vi.useFakeTimers();
    vi.mocked(requestUrl).mockReturnValue(new Promise(() => {}) as never);
    const transport = new ObsidianProviderTransport();
    const pending = transport.requestJson({ url: "https://example.test", method: "POST" }, 25);
    const assertion = expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);

    await vi.runAllTimersAsync();

    await assertion;
  });

  it("links caller abort to a stream request and removes the listener", async () => {
    const streamRequester = vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new ProviderStreamAbortError(signal.reason)), { once: true });
    }));
    const transport = new ObsidianProviderTransport(streamRequester);
    const controller = new AbortController();
    const pending = transport.requestStream({
      url: "https://example.test",
      headers: {},
      body: "{}",
      timeoutMs: 100,
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort("closed");

    await expect(pending).rejects.toBeInstanceOf(ProviderStreamAbortError);
    expect(streamRequester).toHaveBeenCalledOnce();
  });
});
