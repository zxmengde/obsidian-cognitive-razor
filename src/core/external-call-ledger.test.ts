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
