import { describe, expect, it, vi } from "vitest";
import { err } from "../types";
import { RetryHandler } from "./retry-handler";

describe("RetryHandler", () => {
  it("stops an exponential backoff immediately when the caller aborts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn(async () => err("E202_RATE_LIMITED", "rate limited"));
    const retrying = new RetryHandler().executeWithRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10_000,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    controller.abort("plugin unloaded");
    const result = await retrying;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("E310_INVALID_STATE");
    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("reports the actual request count on a final failure without discarding safe details", async () => {
    vi.useFakeTimers();
    const operation = vi.fn(async () => err("E204_PROVIDER_ERROR", "upstream failed", {
      status: 503,
      providerAttempts: 99,
    }));
    const retrying = new RetryHandler().executeWithRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
    });

    await vi.runAllTimersAsync();
    const result = await retrying;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toEqual({ status: 503, providerAttempts: 3 });
    }
    expect(operation).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("reports one request for a non-retryable Provider failure", async () => {
    const operation = vi.fn(async () => err("E205_PROVIDER_REQUEST_INVALID", "invalid request"));

    const result = await new RetryHandler().executeWithRetry(operation, { maxAttempts: 3 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details).toEqual({ providerAttempts: 1 });
    }
    expect(operation).toHaveBeenCalledOnce();
  });
});
