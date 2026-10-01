import type { ProviderCapabilities, ProviderConfig, Result } from "../types";

export type ProviderProbeOutcome = "success" | "partial" | "failed" | "uncertain";
export type ProviderCapabilityStatus = "available" | "unavailable" | "disabled";

export interface ProviderProbeReadModel {
  outcome: ProviderProbeOutcome;
  chat: ProviderCapabilityStatus;
  embedding: ProviderCapabilityStatus;
}

/** Convert the gateway result into the only status shape rendered by settings UI. */
export function toProviderProbeReadModel(
  result: Result<ProviderCapabilities>,
  config: ProviderConfig,
): ProviderProbeReadModel {
  const chatEnabled = config.apiFormat !== "disabled";
  const embeddingEnabled = config.embeddingApiFormat !== "disabled";
  const disabledStatus = (enabled: boolean): ProviderCapabilityStatus => enabled ? "unavailable" : "disabled";

  if (!result.ok) {
    return {
      outcome: result.error.code === "E206_PROVIDER_REQUEST_UNCERTAIN" ? "uncertain" : "failed",
      chat: disabledStatus(chatEnabled),
      embedding: disabledStatus(embeddingEnabled),
    };
  }

  const chat = chatEnabled ? (result.value.chat ? "available" : "unavailable") : "disabled";
  const embedding = embeddingEnabled ? (result.value.embedding ? "available" : "unavailable") : "disabled";
  const enabledStatuses = [
    chatEnabled ? result.value.chat : undefined,
    embeddingEnabled ? result.value.embedding : undefined,
  ].filter((value): value is boolean => value !== undefined);
  const availableCount = enabledStatuses.filter(Boolean).length;
  const outcome: ProviderProbeOutcome = availableCount === enabledStatuses.length
    ? "success"
    : availableCount > 0
      ? "partial"
      : "failed";

  return { outcome, chat, embedding };
}

export function failedProviderProbe(config: ProviderConfig): ProviderProbeReadModel {
  return toProviderProbeReadModel(
    { ok: false, error: { code: "E500_INTERNAL_ERROR", message: "Provider 测试失败" } },
    config,
  );
}
