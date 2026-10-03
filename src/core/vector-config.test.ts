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
  it("canonicalizes a bare origin and /v1 to the same effective embeddings endpoint", () => {
    const bare = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example")));
    const versioned = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1/")));
    expect(vectorIndexConfigsEqual(bare, versioned)).toBe(true);
    // Existing canonical profiles retain their representation, avoiding an
    // unrelated full reindex merely because the identity code was upgraded.
    expect(versioned.profile).toBe(JSON.stringify({
      providerId: "embedding", endpoint: "https://relay.example/v1",
      apiFormat: "openai-embeddings", model: "embed-model",
    }));
  });

  it("distinguishes route query changes without storing query names or values", () => {
    const alpha = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?deployment=alpha&unknown_private=secret-value")));
    const beta = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?deployment=beta&unknown_private=secret-value")));
    expect(vectorIndexConfigsEqual(alpha, beta)).toBe(false);
    expect(JSON.parse(alpha.profile).routeQueryHash).toMatch(/^[a-f0-9]{64}$/);
    for (const raw of ["deployment", "alpha", "unknown_private", "secret-value"]) expect(alpha.profile).not.toContain(raw);
  });

  it("normalizes route query key order but preserves repeated-value order", () => {
    const first = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?tenant=a&route=one&route=two")));
    const reordered = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?route=one&route=two&tenant=a")));
    const repeatedValuesChanged = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?route=two&route=one&tenant=a")));
    expect(vectorIndexConfigsEqual(first, reordered)).toBe(true);
    expect(vectorIndexConfigsEqual(first, repeatedValuesChanged)).toBe(false);
  });

  it("ignores recognized auth query rotation while retaining the deployment route", () => {
    const before = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("first-header-key", "https://user:old-pass@relay.example/v1?deployment=alpha&API_KEY=old-key&access_token=old-token#old")));
    const after = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("second-header-key", "https://user:new-pass@relay.example/v1?access_token=new-token&api_key=new-key&deployment=alpha#new")));
    expect(vectorIndexConfigsEqual(before, after)).toBe(true);
    for (const raw of ["old-pass", "old-key", "old-token", "new-pass", "new-key", "new-token"]) {
      expect(before.profile).not.toContain(raw);
      expect(after.profile).not.toContain(raw);
    }
  });

  it("conservatively invalidates unknown query changes rather than guessing that they are auth", () => {
    const before = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?deployment_key=first")));
    const after = resolveVectorIndexConfig(settingsWithProvider("embedding", provider("secret", "https://relay.example/v1?deployment_key=second")));
    expect(vectorIndexConfigsEqual(before, after)).toBe(false);
  });

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
