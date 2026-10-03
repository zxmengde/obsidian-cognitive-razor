import { describe, expect, it } from "vitest";
import { err, ok } from "../types";
import type { ProviderConfig } from "../types";
import { publicProviderEndpoint, toProviderProbeReadModel } from "./provider-probe-result";

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
  it('does not expose URL credentials, query names or query values in read-only summaries', () => {
    const raw = 'https://user:secret@provider.test/v1?tenant=private&token=sensitive#private';
    expect(publicProviderEndpoint(raw)).toBe('https://provider.test/v1');
    expect(publicProviderEndpoint('not a URL token=sensitive')).toBe('—');
    expect(raw).toContain('sensitive');
  });
  it('reports index-only scope and preserves its captured target on failure', () => {
    const target = { scope: 'index' as const, providerId: 'effective', model: 'override-embed', requestedDimensions: 256 };
    expect(toProviderProbeReadModel(ok({ chat: false, embedding: true, embeddingProbe: { model: 'override-embed', requestedDimensions: 256, actualDimensions: 256 } }), config, target)).toEqual({
      outcome: 'success', chat: 'disabled', embedding: 'available', target,
      embeddingProbe: { model: 'override-embed', requestedDimensions: 256, actualDimensions: 256 },
    });
    expect(toProviderProbeReadModel(err('E211_MODEL_SCHEMA_VIOLATION', 'Synthetic'), config, target)).toEqual({
      outcome: 'failed', chat: 'disabled', embedding: 'unavailable', target,
    });
    expect(toProviderProbeReadModel(ok({ chat: true, embedding: false }), config, target).outcome).toBe('failed');
  });
  it('does not require or claim an embedding check for a chat task on a dual-capability connection', () => {
    const target = { scope: 'cards' as const, providerId: 'effective', model: 'cards-override' };
    expect(toProviderProbeReadModel(ok({ chat: true, embedding: false }), config, target)).toEqual({
      outcome: 'success', chat: 'available', embedding: 'disabled', target,
    });
    expect(toProviderProbeReadModel(err('E206_PROVIDER_REQUEST_UNCERTAIN', 'private'), config, target)).toEqual({
      outcome: 'uncertain', chat: 'unavailable', embedding: 'disabled', target,
    });
  });
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
