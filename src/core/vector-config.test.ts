import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import type { PluginSettings, ProviderConfig } from "../types";
import {
  resolveVectorIndexConfig,
  vectorIndexConfigsEqual,
} from "./vector-config";

function provider(apiKey: string, baseUrl: string): ProviderConfig {
  return {
    apiKey,
    baseUrl,
    apiFormat: "disabled",
    enableWebSearch: false,
    embeddingApiFormat: "openai-embeddings",
    defaultChatModel: "",
    defaultEmbedModel: "embed-model",
    enabled: true,
  };
}

function settingsWithProvider(
  providerId: string,
  config: ProviderConfig,
): PluginSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers = { [providerId]: config };
  settings.defaultProviderId = providerId;
  settings.taskModels.index = {
    providerId,
    model: "embed-model",
    embeddingDimension: 1536,
  };
  return settings;
}

describe("vector index configuration identity", () => {
  it("does not invalidate vectors when only the API key rotates", () => {
    const before = resolveVectorIndexConfig(settingsWithProvider(
      "embedding",
      provider("first-secret", "https://relay.example/v1"),
    ));
    const after = resolveVectorIndexConfig(settingsWithProvider(
      "embedding",
      provider("second-secret", "https://relay.example/v1"),
    ));

    expect(vectorIndexConfigsEqual(before, after)).toBe(true);
    expect(before.profile).not.toContain("first-secret");
    expect(after.profile).not.toContain("second-secret");
  });

  it("invalidates vectors when the Provider or endpoint changes", () => {
    const baseline = resolveVectorIndexConfig(settingsWithProvider(
      "embedding-a",
      provider("secret", "https://relay.example/v1"),
    ));
    const providerChanged = resolveVectorIndexConfig(settingsWithProvider(
      "embedding-b",
      provider("secret", "https://relay.example/v1"),
    ));
    const endpointChanged = resolveVectorIndexConfig(settingsWithProvider(
      "embedding-a",
      provider("secret", "https://other.example/v1"),
    ));

    expect(vectorIndexConfigsEqual(baseline, providerChanged)).toBe(false);
    expect(vectorIndexConfigsEqual(baseline, endpointChanged)).toBe(false);
  });

  it("keeps URL credentials, query parameters, and fragments out of metadata", () => {
    const config = resolveVectorIndexConfig(settingsWithProvider(
      "embedding",
      provider(
        "secret",
        "https://user:password@relay.example/v1?token=query-secret#fragment-secret",
      ),
    ));

    expect(config.profile).toContain("https://relay.example/v1");
    expect(config.profile).not.toContain("user");
    expect(config.profile).not.toContain("password");
    expect(config.profile).not.toContain("query-secret");
    expect(config.profile).not.toContain("fragment-secret");
  });
});
