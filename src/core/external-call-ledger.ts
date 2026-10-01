/**
 * Shared lifecycle facts for every external request.
 *
 * This ledger intentionally stores only safe diagnostics. Raw responses,
 * credentials, prompts and reasoning remain owned by their callers.
 */

import type { ProviderAttemptReason } from "../types";
import { cloneJson } from "../utils/clone";

export type ExternalCallKind =
  | "model"
  | "embedding"
  | "provider-probe";

export type DispatchState = "not-sent" | "sent" | "response-received" | "unknown";
export type AttemptOutcome = "succeeded" | "known-failure" | "uncertain" | "cancelled";
export type BillingRisk = "low" | "unknown";
export type AttemptReason = ProviderAttemptReason;

export interface ExternalCallStart {
  kind: ExternalCallKind;
  providerId?: string;
  model?: string;
  protocol: string;
  label?: string;
  reason?: AttemptReason;
  parentAttemptId?: string;
  billingRisk?: BillingRisk;
}

export interface ExternalCallAttemptSummary {
  attemptId: string;
  kind: ExternalCallKind;
  providerId?: string;
  model?: string;
  protocol: string;
  label?: string;
  reason: AttemptReason;
  parentAttemptId?: string;
  dispatchState: DispatchState;
  outcome?: AttemptOutcome;
  responseReceived: boolean;
  billingRisk: BillingRisk;
  startedAt: number;
  finishedAt?: number;
  errorCode?: string;
}

export interface ExternalCallHandle {
  readonly attemptId: string;
  readonly dispatchState: DispatchState;
  readonly responseReceived: boolean;
  markSent(): void;
  markResponseReceived(): void;
  finish(outcome: AttemptOutcome, errorCode?: string): ExternalCallAttemptSummary;
  snapshot(): ExternalCallAttemptSummary;
}

export interface ExternalCallLedger {
  begin(input: ExternalCallStart): ExternalCallHandle;
  list(): ExternalCallAttemptSummary[];
}

class LedgerHandle implements ExternalCallHandle {
  private readonly record: ExternalCallAttemptSummary;

  constructor(
    input: ExternalCallStart,
    attemptId: string,
    private readonly now: () => number,
  ) {
    this.record = {
      attemptId,
      kind: input.kind,
      providerId: input.providerId,
      model: input.model,
      protocol: input.protocol,
      label: input.label,
      reason: input.reason ?? "initial",
      parentAttemptId: input.parentAttemptId,
      dispatchState: "not-sent",
      responseReceived: false,
      billingRisk: input.billingRisk ?? "unknown",
      startedAt: now(),
    };
  }

  get attemptId(): string {
    return this.record.attemptId;
  }

  get dispatchState(): DispatchState {
    return this.record.dispatchState;
  }

  get responseReceived(): boolean {
    return this.record.responseReceived;
  }

  markSent(): void {
    if (this.record.outcome || this.record.dispatchState !== "not-sent") return;
    this.record.dispatchState = "sent";
  }

  markResponseReceived(): void {
    if (this.record.outcome || this.record.dispatchState !== "sent") return;
    this.record.dispatchState = "response-received";
    this.record.responseReceived = true;
  }

  finish(outcome: AttemptOutcome, errorCode?: string): ExternalCallAttemptSummary {
    if (!this.record.outcome) {
      const wasSent = this.record.dispatchState === "sent";
      const effectiveOutcome = outcome === "cancelled" && wasSent ? "uncertain" : outcome;
      this.record.outcome = effectiveOutcome;
      this.record.errorCode = effectiveOutcome === "uncertain" && outcome === "cancelled" && wasSent
        ? "E206_PROVIDER_REQUEST_UNCERTAIN"
        : errorCode;
      this.record.finishedAt = this.now();
      if (effectiveOutcome === "uncertain" && this.record.dispatchState === "sent") {
        this.record.dispatchState = "unknown";
      }
    }
    return this.snapshot();
  }

  snapshot(): ExternalCallAttemptSummary {
    return cloneJson(this.record);
  }
}

/** In-memory ledger used by the runtime; persistence can be added behind this port. */
export class InMemoryExternalCallLedger implements ExternalCallLedger {
  private readonly attempts = new Map<string, LedgerHandle>();
  private sequence = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  begin(input: ExternalCallStart): ExternalCallHandle {
    this.sequence += 1;
    const attemptId = `attempt-${this.now()}-${this.sequence}`;
    const handle = new LedgerHandle(input, attemptId, this.now);
    this.attempts.set(attemptId, handle);
    return handle;
  }

  list(): ExternalCallAttemptSummary[] {
    return [...this.attempts.values()]
      .map((attempt) => attempt.snapshot())
      .sort((left, right) => left.startedAt - right.startedAt || left.attemptId.localeCompare(right.attemptId));
  }
}
