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
