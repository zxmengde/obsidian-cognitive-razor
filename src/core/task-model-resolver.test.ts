import { describe, expect, it } from "vitest";
import type { PluginSettings } from "../types";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { resolveTaskModelSnapshot } from "./task-model-resolver";

function settings(): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    defaultProviderId: "claude",
    providers: {
      claude: {
        apiKey: "key",
        apiFormat: "openai-chat-completions",
        enableWebSearch: false,
        capabilities: { temperature: true, topP: true, reasoning: true },
        embeddingApiFormat: "disabled",
        defaultChatModel: "claude-opus-5",
        defaultEmbedModel: "",
        enabled: true,
      },
      openai: {
        apiKey: "key",
        apiFormat: "openai-responses",
        enableWebSearch: false,
        capabilities: { temperature: true, topP: true, reasoning: true, nativeWebSearch: true },
        embeddingApiFormat: "openai-embeddings",
        defaultChatModel: "gpt-5.6-sol",
        defaultEmbedModel: "text-embedding-3-small",
        enabled: true,
      },
    },
    taskModels: {
      ...DEFAULT_SETTINGS.taskModels,
      define: { ...DEFAULT_SETTINGS.taskModels.define, providerId: "", model: "", temperature: 0.2, topP: 0.8 },
      index: { ...DEFAULT_SETTINGS.taskModels.index, providerId: "", model: "" },
    },
  };
}

describe("resolveTaskModelSnapshot", () => {
  it("uses the selected Provider default chat model when task model is blank", () => {
    expect(resolveTaskModelSnapshot(settings(), "define")).toMatchObject({
      providerId: "claude",
      model: "claude-opus-5",
      temperature: 0.2,
      topP: 0.8,
    });
  });

  it("uses the selected Provider default embedding model and keeps embedding dimensions", () => {
    expect(resolveTaskModelSnapshot(settings(), "index", "openai")).toMatchObject({
      providerId: "openai",
      model: "text-embedding-3-small",
      embeddingDimension: undefined,
    });
  });

  it("keeps an explicit task model over the Provider default", () => {
    const current = settings();
    current.taskModels.define.model = "custom-define";
    expect(resolveTaskModelSnapshot(current, "define").model).toBe("custom-define");
  });

  it("applies explicit reasoning sampling suppression equally to unknown model names", () => {
    const first = settings();
    first.taskModels.define.model = "gpt-6-astra";
    first.taskModels.define.parameters = { temperature: 0, topP: 0, reasoning_effort: "custom" };
    expect(resolveTaskModelSnapshot(first, "define").temperature).toBeUndefined();
    const second = structuredClone(first);
    second.taskModels.define.model = "my-alias";
    expect(resolveTaskModelSnapshot(first, "define")).toMatchObject({
      model: "gpt-6-astra", configuredSampling: { temperature: 0, topP: 0 }, reasoningEffort: "custom",
    });
    expect(resolveTaskModelSnapshot(second, "define")).toMatchObject({
      model: "my-alias", configuredSampling: { temperature: 0, topP: 0 }, reasoningEffort: "custom",
    });
  });

  it("freezes request controls without copying embedding settings into chat tasks", () => {
    const current = settings();
    current.taskModels.verify = {
      ...current.taskModels.verify,
      maxTokens: 4096,
      reasoning_effort: "high",
      embeddingDimension: 999,
    };

    expect(resolveTaskModelSnapshot(current, "verify")).toMatchObject({
      maxTokens: 4096,
      reasoningEffort: "high",
      embeddingDimension: undefined,
    });
  });

  it("preserves the explicit omit state instead of inheriting Provider parameters", () => {
    const current = settings();
    current.providers.claude.parameters = { temperature: 0.8, topP: 0.9, maxTokens: 2048 };
    current.taskModels.define.parameters = { temperature: null, topP: 0.1, maxTokens: null };
    expect(resolveTaskModelSnapshot(current, "define")).toMatchObject({ topP: 0.1 });
    const snapshot = resolveTaskModelSnapshot(current, "define");
    expect(snapshot.temperature).toBeUndefined();
    expect(snapshot.maxTokens).toBeUndefined();
  });

  it("retains mismatched protocol parameters so request validation can reject them", () => {
    const current = settings();
    current.taskModels.define.providerId = "openai";
    current.taskModels.define.parameters = { reasoning_effort: "custom", thinkingLevel: "HIGH" };
    expect(resolveTaskModelSnapshot(current, "define")).toMatchObject({
      reasoningEffort: "custom",
      thinkingLevel: "HIGH",
    });
  });
});

it("lets Cards inherit missing fields while keeping explicit overrides and snapshots intact", () => {
  const current = settings();
  current.taskModels.cards = { providerId: "", model: "" };
  const original = structuredClone(current);
  const inherited = resolveTaskModelSnapshot(current, "cards");
  expect(inherited.providerId).toBe(current.defaultProviderId);
  expect(inherited.model).toBe(current.providers[current.defaultProviderId].defaultChatModel);
  expect(current).toEqual(original);
  current.taskModels.cards = { providerId: "openai", model: "custom-cards" };
  expect(resolveTaskModelSnapshot(current, "cards")).toMatchObject({ providerId: "openai", model: "custom-cards" });
  current.defaultProviderId = "openai";
  expect(inherited.providerId).toBe(original.defaultProviderId);
  current.taskModels.cards = { providerId: "missing-existing-override", model: "kept" };
  expect(resolveTaskModelSnapshot(current, "cards")).toMatchObject({ providerId: "missing-existing-override", model: "kept", providerSnapshot: undefined });
});


it.each(["openai-responses", "openai-chat-completions"] as const)("keeps saved sampling while resolving the wire values for %s", (apiFormat) => {
  const current = settings();
  current.providers.openai.apiFormat = apiFormat;
  current.providers.openai.defaultChatModel = "gpt-6.1-sol";
  current.taskModels.define.providerId = "openai";
  const before = structuredClone(current);
  const resolved = resolveTaskModelSnapshot(current, "define");
  expect(resolved.temperature).toBeUndefined();
  expect(resolved.topP).toBeUndefined();
  expect(resolved.reasoningEffort).toBeUndefined();
  expect(resolved).toMatchObject({ configuredSampling: { temperature: 0.2, topP: 0.8 } });
  expect(current).toEqual(before);
  current.taskModels.define.model = "custom-alias";
  expect(resolveTaskModelSnapshot(current, "define")).toMatchObject({ temperature: 0.2, topP: 0.8 });
});
