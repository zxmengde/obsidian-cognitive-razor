import { describe, expect, it } from "vitest";
import { Validator } from "../data/validator";
import { DEFAULT_MODEL_CAPABILITIES, type TaskModelSnapshot } from "../types";
import { schemaRegistry, buildPhaseJsonSchema } from "./schema-registry";
import { getWriteStageDefinitions } from "./stage-catalog";
import { buildStableWriteSchema, decodeWriteEnvelope, usesStableWriteEnvelope } from "./write-output-codec";

function sample(schema: unknown): unknown {
  const s = schema as { type?: string; enum?: unknown[]; properties?: Record<string, unknown> };
  if (s.enum) return s.enum[0];
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([key, value]) => [key, sample(value)]));
  if (s.type === "array") return [];
  if (s.type === "boolean") return true;
  if (s.type === "number" || s.type === "integer") return 1;
  return "已验证的合成内容";
}

describe("stable Write output contract", () => {
  it.each(["domain", "issue", "theory", "entity", "mechanism"] as const)("preserves every original %s stage field and rejects other stages locally", async type => {
    const full = schemaRegistry.getSchema(type), stable = buildStableWriteSchema(type, full), validator = new Validator();
    for (const stage of getWriteStageDefinitions(type)) {
      const phase = buildPhaseJsonSchema(full, stage.fields), fields = sample(phase) as Record<string, unknown>;
      const raw = JSON.stringify({ result: { stage: stage.id, ...fields } });
      expect((await validator.validate(raw, stable)).valid).toBe(true);
      const decoded = decodeWriteEnvelope(raw, type, stage.id);
      expect(decoded.ok).toBe(true); if (!decoded.ok) throw Error(decoded.error.message);
      expect((await validator.validate(JSON.stringify(decoded.value.fields), phase)).valid).toBe(true);
      expect(decoded.value.fields).toEqual(fields);
      for (const other of getWriteStageDefinitions(type).filter(other => other.id !== stage.id)) {
        expect(decodeWriteEnvelope(raw, type, other.id)).toMatchObject({ ok: false, error: { code: "E211_MODEL_SCHEMA_VIOLATION" } });
      }
      expect(decodeWriteEnvelope(JSON.stringify({ result: { stage: stage.id, ...fields }, extra: true }), type, stage.id).ok).toBe(false);
      const extra = decodeWriteEnvelope(JSON.stringify({ result: { stage: stage.id, ...fields, extra: true } }), type, stage.id);
      expect(extra.ok && (await validator.validate(JSON.stringify(extra.value.fields), phase)).valid).toBe(false);
      const missing = decodeWriteEnvelope(JSON.stringify({ result: { stage: stage.id } }), type, stage.id);
      expect(missing.ok && (await validator.validate(JSON.stringify(missing.value.fields), phase)).valid).toBe(false);
    }
  });

  it("limits the new wire contract to the documented, tested Responses caching model", () => {
    const model: TaskModelSnapshot = { providerId: "p", model: "gpt-6.1-sol", providerSnapshot: { apiFormat: "openai-responses", apiKey: "synthetic", enabled: true, embeddingApiFormat: "disabled", defaultChatModel: "gpt-6.1-sol", defaultEmbedModel: "" }, capabilities: { ...DEFAULT_MODEL_CAPABILITIES, promptCaching: true } };
    expect(usesStableWriteEnvelope(model)).toBe(true);
    expect(usesStableWriteEnvelope({ ...model, model: "custom-gateway-gpt-6.1-sol" })).toBe(false);
    expect(usesStableWriteEnvelope({ ...model, model: "gpt-6-sol" })).toBe(false);
    expect(usesStableWriteEnvelope({ ...model, capabilities: { ...model.capabilities!, promptCaching: false } })).toBe(false);
    expect(usesStableWriteEnvelope({ ...model, providerSnapshot: { ...model.providerSnapshot!, apiFormat: "openai-chat-completions" } })).toBe(false);
    expect(usesStableWriteEnvelope({ ...model, providerSnapshot: { ...model.providerSnapshot!, apiFormat: "gemini-generative-language" } })).toBe(false);
  });

  it.each(["not JSON", "{}", '{"result":[]}', '{"result":{"stage":"unknown"}}', '{"result":{"stage":null}}', '{"unrelated":{"stage":"core"}}'])("rejects unproven envelope shape %s", raw => {
    expect(decodeWriteEnvelope(raw, "domain", "core").ok).toBe(false);
  });
  it.each(["tag", "verify", "cards"])("does not accept the non-Write %s role as historical field coverage", stage => {
    expect(decodeWriteEnvelope(JSON.stringify({ result: { stage } }), "domain").ok).toBe(false);
  });
});
