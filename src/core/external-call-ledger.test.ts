import { describe, expect, it } from "vitest";
import { InMemoryExternalCallLedger } from "./external-call-ledger";

describe("ExternalCallLedger", () => {
  it("records the dispatch boundary and freezes a safe snapshot", () => {
    let now = 100;
    const ledger = new InMemoryExternalCallLedger(() => now);
    const attempt = ledger.begin({
      kind: "model",
      providerId: "provider",
      model: "model",
      protocol: "openai-chat-completions",
      label: "tag",
    });

    expect(attempt.snapshot()).toMatchObject({
      dispatchState: "not-sent",
      responseReceived: false,
    });
    now = 101;
    attempt.markSent();
    now = 102;
    attempt.markResponseReceived();
    now = 103;
    const completed = attempt.finish("succeeded");

    expect(completed).toMatchObject({
      attemptId: attempt.attemptId,
      dispatchState: "response-received",
      responseReceived: true,
      outcome: "succeeded",
      startedAt: 100,
      finishedAt: 103,
    });
    expect(ledger.list()).toEqual([completed]);
  });

  it("marks a sent request as unknown when it ends uncertainly", () => {
    const ledger = new InMemoryExternalCallLedger(() => 1);
    const attempt = ledger.begin({ kind: "embedding", protocol: "openai-embeddings" });

    attempt.markSent();
    const result = attempt.finish("uncertain", "E206_PROVIDER_REQUEST_UNCERTAIN");

    expect(result).toMatchObject({
      dispatchState: "unknown",
      outcome: "uncertain",
      errorCode: "E206_PROVIDER_REQUEST_UNCERTAIN",
    });
  });

  it("does not allow late lifecycle events to rewrite a terminal attempt", () => {
    const ledger = new InMemoryExternalCallLedger(() => 1);
    const attempt = ledger.begin({ kind: "model", protocol: "openai-chat-completions" });
    const cancelled = attempt.finish("cancelled");

    attempt.markSent();
    attempt.markResponseReceived();
    expect(attempt.finish("succeeded")).toEqual(cancelled);
  });

  it("turns cancellation after dispatch into an uncertain outcome", () => {
    const ledger = new InMemoryExternalCallLedger(() => 1);
    const attempt = ledger.begin({ kind: "provider-probe", protocol: "probe" });

    attempt.markSent();
    const result = attempt.finish("cancelled", "E310_INVALID_STATE");

    expect(result).toMatchObject({
      dispatchState: "unknown",
      outcome: "uncertain",
      errorCode: "E206_PROVIDER_REQUEST_UNCERTAIN",
    });
  });
});

describe("bounded session accounting", () => {
  it("retains safe numeric accounting across answer failure without storing content", () => {
    const ledger = new InMemoryExternalCallLedger();
    const attempt = ledger.begin({ kind: "model", protocol: "openai-responses" });
    attempt.markSent();
    attempt.markResponseReceived();
    attempt.recordUsage({ status: "partial", inputTokens: 10, cacheReadTokens: 0, content: "private answer", prompt: "private prompt", issues: ["private issue"] } as never);
    attempt.finish("known-failure", "E207_PROVIDER_RESPONSE_UNSUPPORTED");
    expect(ledger.list()[0].usage).toEqual({ inputTokens: 10, cacheReadTokens: 0, status: "partial" });
    expect(JSON.stringify(ledger.list())).not.toContain("private");
    attempt.recordUsage({ status: "reported", inputTokens: 20 });
    expect(ledger.list()[0].usage?.inputTokens).toBe(10);
  });

  it("replaces cumulative usage and returns detached snapshots", () => {
    const ledger = new InMemoryExternalCallLedger();
    const attempt = ledger.begin({ kind: "model", protocol: "openai-chat-completions" });
    attempt.recordUsage({ status: "partial", inputTokens: 10 });
    attempt.recordUsage({ status: "partial", inputTokens: 10 });
    const snapshot = ledger.diagnostics();
    expect(snapshot.attempts[0].usage?.inputTokens).toBe(10);
    snapshot.attempts[0].usage!.inputTokens = 999;
    expect(ledger.diagnostics().attempts[0].usage?.inputTokens).toBe(10);
  });

  it("bounds retained attempts and exposes truncation without a lifetime total claim", () => {
    const ledger = new InMemoryExternalCallLedger(() => 1, 2);
    const oldest = ledger.begin({ kind: "model", protocol: "openai-responses" });
    oldest.finish("succeeded");
    ledger.begin({ kind: "model", protocol: "openai-responses" }).finish("succeeded");
    ledger.begin({ kind: "model", protocol: "openai-responses" });
    expect(ledger.diagnostics()).toMatchObject({ maxRetainedAttempts: 2, discardedAttempts: 1 });
    expect(ledger.list()).toHaveLength(2);
    expect(ledger.list().some((entry) => entry.attemptId === oldest.attemptId)).toBe(false);
  });
});
