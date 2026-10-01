import type {
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ProviderAttemptReason,
  ProviderCapabilities,
  ProviderConfig,
  Result,
  ResolvedTaskConfig,
} from "../types";

export type ProviderProbeAttemptReason = Extract<ProviderAttemptReason, "initial" | "manual-retry">;

export interface ProviderProbeRequest {
  providerId: string;
  configOverride?: ProviderConfig;
  attemptReason?: ProviderProbeAttemptReason;
  /** Optional task snapshot for a capability-aware probe. */
  taskConfig?: ResolvedTaskConfig;
}

export interface ProviderProbeGateway {
  probe(request: ProviderProbeRequest, signal?: AbortSignal): Promise<Result<ProviderCapabilities>>;
}

/**
 * Application-facing model capability. Protocol selection, transport,
 * retries and attempt accounting stay behind this port.
 */
export interface ModelGateway extends ProviderProbeGateway {
  chat(request: ChatRequest, signal?: AbortSignal): Promise<Result<ChatResponse>>;
  embed(request: EmbedRequest, signal?: AbortSignal): Promise<Result<EmbedResponse>>;
}
