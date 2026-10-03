/** Explicit, model-name-independent capability declarations. */
export interface ModelCapabilities {
  temperature: boolean;
  topP: boolean;
  reasoning: boolean;
  nativeWebSearch: boolean;
  promptCaching: boolean;
  /** OpenAI Responses cache policy. Earlier providers/models should use implicit. */
  promptCacheMode?: "implicit" | "explicit";
  /** Minimum cache lifetime supported by GPT-5.6+ Responses models. */
  promptCacheTtl?: "30m";
  responseContinuation: boolean;
}

export interface ModelParameters {
  temperature?: number;
  topP?: number;
  reasoning_effort?: string;
  thinkingLevel?: string;
  thinkingBudget?: number;
  maxTokens?: number;
  embeddingDimension?: number;
}

/** Immutable provider/model/parameter snapshot captured for one attempt. */
export interface ResolvedTaskConfig {
  providerId: string;
  model: string;
  providerSnapshot?: import("./settings").ProviderConfig;
  capabilities: ModelCapabilities;
  temperature?: number;
  topP?: number;
  reasoningEffort?: string;
  thinkingLevel?: string;
  thinkingBudget?: number;
  maxTokens?: number;
  embeddingDimension?: number;
}

/** Missing inherits; null explicitly omits the parameter. */
export type ModelParameterOverrides = { [K in keyof ModelParameters]?: ModelParameters[K] | null };

export const DEFAULT_MODEL_CAPABILITIES: Readonly<ModelCapabilities> = Object.freeze({
  temperature: false, topP: false, reasoning: false,
  nativeWebSearch: false,
  promptCaching: false, responseContinuation: false,
  promptCacheMode: "implicit",
});
