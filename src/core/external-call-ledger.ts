/**
 * Shared lifecycle facts for every external request.
 *
 * This ledger intentionally stores only safe diagnostics. Raw responses,
 * credentials, prompts and reasoning remain owned by their callers.
 */

import type { ProviderAttemptReason } from "../types";
import { cloneJson } from "../utils/clone";
import { normalizeTokenUsage, TOKEN_USAGE_FIELDS, type ProviderTokenUsage, type TokenUsageIssue } from "./provider-token-usage";

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
  /** Provider-reported counts only; session-local and independent of answer validation. */
  usage?: ProviderTokenUsage;
}

export interface ExternalCallHandle {
  readonly attemptId: string;
  readonly dispatchState: DispatchState;
  readonly responseReceived: boolean;
  markSent(): void;
  markResponseReceived(): void;
  recordUsage(usage: ProviderTokenUsage): void;
  finish(outcome: AttemptOutcome, errorCode?: string): ExternalCallAttemptSummary;
  snapshot(): ExternalCallAttemptSummary;
}

export interface ExternalCallDiagnostics {
  attempts: ExternalCallAttemptSummary[];
  maxRetainedAttempts: number;
  discardedAttempts: number;
}

export interface ExternalCallLedger {
  begin(input: ExternalCallStart): ExternalCallHandle;
  list(): ExternalCallAttemptSummary[];
  diagnostics(): ExternalCallDiagnostics;
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

  recordUsage(usage: ProviderTokenUsage): void {
    if (this.record.outcome) return;
    const allowedIssues: readonly TokenUsageIssue[] = ["invalid-usage", "invalid-cache-details", "cache-exceeds-input", "counts-exceed-total"];
    const required = this.record.protocol === "gemini-generative-language"
      ? TOKEN_USAGE_FIELDS.filter((field) => field !== "cacheWriteTokens")
      : this.record.protocol === "openai-embeddings" ? ["tokensUsed", "inputTokens"] as const : TOKEN_USAGE_FIELDS;
    // Replace cumulative usage; never add SSE snapshots together. Whitelisting
    // prevents arbitrary response content from entering the session ledger.
    this.record.usage = normalizeTokenUsage(usage, required,
      Array.isArray(usage.issues) ? usage.issues.filter((issue) => allowedIssues.includes(issue)) : [],
      Array.isArray(usage.invalidFields) ? usage.invalidFields.filter((field) => TOKEN_USAGE_FIELDS.includes(field)) : []);
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
  private discardedAttempts = 0;
  private readonly maxRetainedAttempts: number;

  constructor(private readonly now: () => number = () => Date.now(), maxRetainedAttempts = 200) {
    this.maxRetainedAttempts = Number.isSafeInteger(maxRetainedAttempts) && maxRetainedAttempts > 0
      ? Math.min(maxRetainedAttempts, 1000) : 200;
  }

  begin(input: ExternalCallStart): ExternalCallHandle {
    this.sequence += 1;
    const attemptId = `attempt-${this.now()}-${this.sequence}`;
    const handle = new LedgerHandle(input, attemptId, this.now);
    // Bound all retained diagnostics, including a pathological burst of active
    // calls. Evicted handles remain valid for their existing caller.
    if (this.attempts.size >= this.maxRetainedAttempts) {
      const oldest = this.attempts.keys().next().value;
      if (oldest !== undefined) { this.attempts.delete(oldest); this.discardedAttempts += 1; }
    }
    this.attempts.set(attemptId, handle);
    return handle;
  }

  diagnostics(): ExternalCallDiagnostics {
    return { attempts: this.list(), maxRetainedAttempts: this.maxRetainedAttempts, discardedAttempts: this.discardedAttempts };
  }

  list(): ExternalCallAttemptSummary[] {
    return [...this.attempts.values()]
      .map((attempt) => attempt.snapshot())
      .sort((left, right) => left.startedAt - right.startedAt || left.attemptId.localeCompare(right.attemptId));
  }
}
