import type { PluginSettings } from "../types";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

const DEFAULT_EMBEDDING_ENDPOINT = "https://api.openai.com/v1";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export interface VectorIndexConfig {
  profile: string;
  model: string;
  dimension?: number;
}

function publicEndpointIdentity(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "invalid-endpoint";
  }
}

export function resolveVectorIndexConfig(settings: PluginSettings): VectorIndexConfig {
  const snapshot = resolveTaskModelSnapshot(settings, "index");
  const provider = settings.providers[snapshot.providerId];
  const model = snapshot.model || DEFAULT_EMBEDDING_MODEL;
  const dimension = snapshot.embeddingDimension;
  const endpoint = publicEndpointIdentity(provider?.baseUrl || DEFAULT_EMBEDDING_ENDPOINT);
  const profile = JSON.stringify({
    providerId: snapshot.providerId,
    endpoint,
    apiFormat: provider?.embeddingApiFormat ?? "disabled",
    model,
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
