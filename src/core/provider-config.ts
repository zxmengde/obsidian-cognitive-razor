import { err, ok } from "../types";
import type {
  PluginSettings,
  ProviderApiFormat,
  ProviderConfig,
  Result,
} from "../types";

type ProviderSettings = Pick<PluginSettings, "providers">;
type ProviderEndpointFormat = Exclude<ProviderApiFormat, "disabled"> | "openai-embeddings";

const DEFAULT_VERSION_PATH: Record<ProviderEndpointFormat, string> = {
  "openai-chat-completions": "/v1",
  "openai-responses": "/v1",
  "gemini-generative-language": "/v1beta",
  "openai-embeddings": "/v1",
};

/**
 * Build a protocol endpoint from a user-facing base URL.
 *
 * A bare origin receives the protocol's standard version prefix so generic
 * gateways work without requiring users to know each upstream convention.
 * Any explicit path is authoritative and is only extended with the resource
 * path; this keeps custom reverse-proxy prefixes intact.
 */
export function buildProviderApiUrl(
  baseUrl: string,
  format: ProviderEndpointFormat,
  resourcePath: string,
): string {
  const url = new URL(baseUrl);
  const explicitBasePath = url.pathname.replace(/\/+$/, "");
  const basePath = explicitBasePath || DEFAULT_VERSION_PATH[format];
  url.pathname = `${basePath}/${resourcePath.replace(/^\/+/, "")}`;
  return url.toString();
}

/**
 * Resolve the single runtime availability rule shared by orchestrators and
 * transports. Official endpoints need an API key; an explicit custom endpoint
 * may intentionally be unauthenticated (for example, a local model server).
 */
export function resolveAvailableProvider(
  settings: ProviderSettings,
  providerId: string,
): Result<ProviderConfig> {
  if (!providerId.trim()) {
    return err("E401_PROVIDER_NOT_CONFIGURED", "请先配置 Provider");
  }

  const provider = settings.providers[providerId];
  if (!provider) {
    return err("E401_PROVIDER_NOT_CONFIGURED", `Provider 不存在: ${providerId}`);
  }
  if (!provider.enabled) {
    return err("E401_PROVIDER_NOT_CONFIGURED", `Provider 已禁用: ${providerId}`);
  }
  if (!provider.apiKey.trim() && !provider.baseUrl?.trim()) {
    return err("E401_PROVIDER_NOT_CONFIGURED", `Provider API Key 未配置: ${providerId}`);
  }

  return ok(provider);
}
