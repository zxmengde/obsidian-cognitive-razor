import { describe, expect, it } from "vitest";
import { err, ok } from "../types";
import type { ProviderConfig } from "../types";
import { toProviderProbeReadModel } from "./provider-probe-result";

const config: ProviderConfig = {
  apiKey: "key",
  apiFormat: "openai-chat-completions",
  embeddingApiFormat: "openai-embeddings",
  defaultChatModel: "chat",
  defaultEmbedModel: "embed",
  enabled: true,
  enableWebSearch: false,
};

describe("provider probe read model", () => {
  it("represents complete, partial, and unavailable capabilities without raw errors", () => {
    expect(toProviderProbeReadModel(ok({ chat: true, embedding: true }), config)).toEqual({
      outcome: "success",
      chat: "available",
      embedding: "available",
    });
    expect(toProviderProbeReadModel(ok({
      chat: true,
      embedding: false,
      embeddingError: { code: "E204_PROVIDER_ERROR", message: "raw detail" },
    }), config)).toEqual({
      outcome: "partial",
      chat: "available",
      embedding: "unavailable",
    });
    expect(toProviderProbeReadModel(err("E204_PROVIDER_ERROR", "raw detail"), config)).toEqual({
      outcome: "failed",
      chat: "unavailable",
      embedding: "unavailable",
    });
  });

  it("preserves disabled capabilities and marks uncertain results for manual action", () => {
    const chatOnly = { ...config, embeddingApiFormat: "disabled" as const, defaultEmbedModel: "" };
    expect(toProviderProbeReadModel(err("E206_PROVIDER_REQUEST_UNCERTAIN", "unknown"), chatOnly)).toEqual({
      outcome: "uncertain",
      chat: "unavailable",
      embedding: "disabled",
    });
    expect(toProviderProbeReadModel(ok({ chat: true, embedding: false }), chatOnly)).toEqual({
      outcome: "success",
      chat: "available",
      embedding: "disabled",
    });
  });
});
