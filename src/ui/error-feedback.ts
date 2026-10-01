import { getErrorCodeInfo } from "../data/error-codes";

export type UiFeedbackLevel = "success" | "warning" | "error" | "info";

export interface UiFeedback {
  level: UiFeedbackLevel;
  message: string;
  details?: string;
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code === "string") return candidate.code;
  if (candidate.error && typeof candidate.error === "object") {
    const nested = candidate.error as Record<string, unknown>;
    if (typeof nested.code === "string") return nested.code;
  }
  return undefined;
}

/** Project an application error into safe UI language without exposing raw details. */
export function toSafeErrorFeedback(error: unknown, fallback: string): UiFeedback {
  const code = readErrorCode(error);
  const info = code ? getErrorCodeInfo(code) : undefined;
  return {
    level: "error",
    message: info?.description ?? fallback,
    details: info?.fixSuggestion,
  };
}

/**
 * Project a thrown host/runtime failure. These errors are authored locally
 * (which file failed, what to do next) and never carry a provider payload, so
 * their own message is the only actionable diagnostic. Coded application
 * errors keep the safe projection above.
 */
export function toHostErrorFeedback(error: unknown, fallback: string): UiFeedback {
  const projection = toSafeErrorFeedback(error, fallback);
  if (readErrorCode(error) !== undefined) return projection;
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? { level: "error", message } : projection;
}
