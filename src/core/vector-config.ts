import { createHash } from "crypto";
import type { PluginSettings } from "../types";
import { buildProviderApiUrl } from "./provider-config";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

const DEFAULT_EMBEDDING_ENDPOINT = "https://api.openai.com/v1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export interface VectorIndexConfig {
  profile: string;
  model: string;
  dimension?: number;
}

// Credentials must not appear in vector metadata. Only well-known auth names
// are excluded: unknown query parameters may select a deployment or tenant and
// therefore conservatively participate in the route fingerprint.
const AUTH_QUERY_NAMES = new Set([
  "key", "api_key", "api-key", "apikey", "access_token", "access-token",
  "token", "authorization", "password", "client_secret", "client-secret",
]);

function publicEndpointIdentity(raw: string): { endpoint: string; routeQueryHash?: string } {
  try {
    const url = new URL(buildProviderApiUrl(raw, "openai-embeddings", "embeddings"));
    const routeQuery = new URLSearchParams(url.search);
    for (const name of [...routeQuery.keys()]) {
      if (AUTH_QUERY_NAMES.has(name.toLowerCase())) routeQuery.delete(name);
    }
    // Stable key sorting preserves the order of repeated values for a key.
    // Reordering those values may change a gateway's effective route.
    routeQuery.sort();
    const routeQueryHash = routeQuery.size > 0
      ? createHash("sha256").update(routeQuery.toString()).digest("hex")
      : undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    // Keep the historical /v1 profile representation for already-canonical
    // configurations, while normalizing a bare origin to that same identity.
    // Derive it from the actual request so custom prefixes stay authoritative.
    url.pathname = url.pathname.replace(/\/embeddings$/, "");
    return { endpoint: url.toString().replace(/\/+$/, ""), ...(routeQueryHash ? { routeQueryHash } : {}) };
  } catch {
    return { endpoint: "invalid-endpoint" };
  }
}

export function resolveVectorIndexConfig(settings: PluginSettings): VectorIndexConfig {
  const snapshot = resolveTaskModelSnapshot(settings, "index");
  const provider = settings.providers[snapshot.providerId];
  const model = snapshot.model || DEFAULT_EMBEDDING_MODEL;
  const dimension = snapshot.embeddingDimension;
  const { endpoint, routeQueryHash } = publicEndpointIdentity(provider?.baseUrl || DEFAULT_EMBEDDING_ENDPOINT);
  const profile = JSON.stringify({
    providerId: snapshot.providerId,
    endpoint,
    apiFormat: provider?.embeddingApiFormat ?? "disabled",
    model,
    ...(routeQueryHash ? { routeQueryHash } : {}),
  });
  return { profile, model, dimension };
}

export function vectorIndexConfigsEqual(
  first: VectorIndexConfig | undefined,
  second: VectorIndexConfig,
): boolean {
  return !!first && first.profile === second.profile &&
    first.model === second.model &&
    first.dimension === second.dimension;
}
