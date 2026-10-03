import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";
import { SettingsStore } from "../data/settings-store";
import { SettingsApplication } from "./settings-application";
import { ProviderManager } from "../core/provider-manager";
import { ObsidianProviderTransport } from "../core/provider-transport";
import { resolveTaskModelSnapshot } from "../core/task-model-resolver";
import { buildTaskChatRequest } from "../core/task-execution-support";
import type { PluginSettings, ProviderApiFormat } from "../types";

vi.mock("obsidian", async original => ({ ...await original<typeof import("obsidian")>(), requestUrl: vi.fn() }));
const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function harness() {
  let disk: PluginSettings | null = null;
  const plugin = { loadData: async () => structuredClone(disk), saveData: vi.fn(async (value: PluginSettings) => { disk = JSON.parse(JSON.stringify(value)); }) };
  const store = new SettingsStore(plugin as never);
  expect((await store.loadSettings()).ok).toBe(true);
  const application = new SettingsApplication({ settingsStore: store, providerProbe: { probe: vi.fn() }, ensureSemanticIndex: vi.fn() } as never);
  expect((await application.addProvider("fixture", { apiKey: "", baseUrl: "https://example.test/v1", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings", defaultChatModel: "initial-chat", defaultEmbedModel: "initial-embed", capabilities: { temperature: true, topP: true }, parameters: { temperature: 0.8, topP: 0.9, maxTokens: 800, embeddingDimension: 3 } })).ok).toBe(true);
  return { store, application, plugin, reload: async () => { const next = new SettingsStore(plugin as never); expect((await next.loadSettings()).ok).toBe(true); return next; } };
}
function response(format: ProviderApiFormat) {
  return { status: 200, text: "", json: format === "openai-responses" ? { output_text: "ok" } : format === "gemini-generative-language" ? { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] } : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } };
}
afterEach(() => { vi.restoreAllMocks(); vi.mocked(requestUrl).mockReset(); vi.useRealTimers(); });

describe("settings persistence to actual transport payload", () => {
  it.each(["openai-chat-completions", "openai-responses", "gemini-generative-language"] as const)("applies saved and reloaded provider/model/parameters to %s", async format => {
    const h = await harness(); const manager = new ProviderManager(h.store, logger);
    try {
      const json = vi.spyOn(ObsidianProviderTransport.prototype, "requestJson");
      expect((await h.application.updateProvider("fixture", { apiFormat: format, baseUrl: "https://changed.example.test/custom", defaultChatModel: "changed-default" })).ok).toBe(true);
      expect((await h.application.updateTaskModel("write", { model: "task-model", parameters: { temperature: 0.25, topP: null, maxTokens: 2048 } })).ok).toBe(true);
      expect((await h.application.updateSettings({ providerTimeoutMs: 45_000, providerMaxAttempts: 1, directoryScheme: { entity: "New/Entities" }, cardsSourceRoot: "New", cardsTargetRoot: "Decks/New" })).ok).toBe(true);
      const reloaded = await h.reload();
      expect(reloaded.getSettings()).toEqual(h.store.getSettings());
      expect(reloaded.getSettings()).toMatchObject({ directoryScheme: { entity: "New/Entities" }, cardsSourceRoot: "New", cardsTargetRoot: "Decks/New" });
      vi.mocked(requestUrl).mockResolvedValue(response(format) as never);
      const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
      // The already-created service must read newly persisted settings, too.
      expect((await manager.chat(buildTaskChatRequest("write", "<system_instructions>policy</system_instructions>input", resolveTaskModelSnapshot(h.store.getSettings(), "write"), schema))).ok).toBe(true);
      expect(json.mock.calls[0][1]).toBe(45_000);
      const params = vi.mocked(requestUrl).mock.calls[0][0] as RequestUrlParam;
      expect(params.url).toContain("https://changed.example.test/custom/");
      const body = JSON.parse(params.body as string);
      const schemaPayload = format === "gemini-generative-language" ? body.generationConfig.responseSchema : format === "openai-responses" ? body.text.format.schema : body.response_format.json_schema.schema;
      expect(schemaPayload).toEqual({ ...schema, additionalProperties: false });
      if (format === "openai-responses") expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
      if (format === "openai-chat-completions") expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
      if (format === "gemini-generative-language") {
        expect(params.url).toContain("task-model:generateContent");
        expect(body.generationConfig).toMatchObject({ temperature: 0.25, maxOutputTokens: 2048, responseMimeType: "application/json" });
        expect(body.generationConfig).not.toHaveProperty("topP");
      } else {
        expect(body).toMatchObject({ model: "task-model", temperature: 0.25 });
        expect(body).not.toHaveProperty("top_p");
        expect(body[format === "openai-responses" ? "max_output_tokens" : "max_tokens"]).toBe(2048);
      }
      const freshManager = new ProviderManager(reloaded, logger);
      try { expect((await freshManager.chat(buildTaskChatRequest("write", "<system_instructions>policy</system_instructions>input", resolveTaskModelSnapshot(reloaded.getSettings(), "write"), schema))).ok).toBe(true); }
      finally { freshManager.dispose(); }
      expect(JSON.parse((vi.mocked(requestUrl).mock.calls[1][0] as RequestUrlParam).body as string)).toEqual(body);
    } finally { manager.dispose(); h.application.dispose(); }
  });

  it("applies changed embedding model/dimensions and does not repair a temporary transport failure", async () => {
    const h = await harness(); const manager = new ProviderManager(h.store, logger);
    try {
      expect((await h.application.updateTaskModel("index", { model: "embed-new", parameters: { embeddingDimension: 2 } })).ok).toBe(true);
      const reloaded = await h.reload(); const snapshot = resolveTaskModelSnapshot(reloaded.getSettings(), "index");
      vi.mocked(requestUrl).mockResolvedValue({ status: 200, json: { data: [{ embedding: [1, 0] }] }, text: "" } as never);
      expect((await manager.embed({ providerId: snapshot.providerId, providerSnapshot: snapshot.providerSnapshot, model: snapshot.model, dimensions: snapshot.embeddingDimension, input: "synthetic note" })).ok).toBe(true);
      expect(JSON.parse((vi.mocked(requestUrl).mock.calls[0][0] as RequestUrlParam).body as string)).toEqual({ model: "embed-new", dimensions: 2, input: "synthetic note" });
      const before = h.store.getSettings(); h.plugin.saveData.mockRejectedValueOnce(new Error("synthetic disk failure"));
      expect((await h.application.updateTaskModel("index", { model: "must-not-apply" })).ok).toBe(false);
      expect(h.store.getSettings()).toEqual(before); expect((await h.reload()).getSettings()).toEqual(before);
    } finally { manager.dispose(); h.application.dispose(); }
  });

  it("tests JSON Schema and provider-default parameters without requiring a task override", async () => {
    const h = await harness(); const manager = new ProviderManager(h.store, logger);
    try {
      vi.mocked(requestUrl).mockResolvedValue(response("openai-chat-completions") as never);
      const config = h.store.getSettings().providers.fixture;
      config.parameters = { ...config.parameters, temperature: 0.3, maxTokens: 64 };
      expect((await manager.probe({ providerId: "fixture", configOverride: config, taskType: "define" })).ok).toBe(true);
      const body = JSON.parse((vi.mocked(requestUrl).mock.calls[0][0] as RequestUrlParam).body as string);
      expect(body).toMatchObject({ temperature: 0.3, max_tokens: 64, response_format: { type: "json_schema", json_schema: { strict: true } } });
    } finally { manager.dispose(); h.application.dispose(); }
  });

  it("uses the live retry cap and does not automatically retry an uncertain timeout", async () => {
    vi.useFakeTimers(); const h = await harness(); const manager = new ProviderManager(h.store, logger);
    try {
      expect((await h.application.updateSettings({ providerMaxAttempts: 1, providerTimeoutMs: 10_000 })).ok).toBe(true);
      const request = () => buildTaskChatRequest("write", "<system_instructions>policy</system_instructions>input", resolveTaskModelSnapshot(h.store.getSettings(), "write"));
      vi.mocked(requestUrl).mockResolvedValue({ status: 429, json: {}, text: "known rate limit" } as never);
      const capped = manager.chat(request()); await vi.runAllTimersAsync(); expect((await capped).ok).toBe(false); expect(requestUrl).toHaveBeenCalledOnce();
      vi.mocked(requestUrl).mockClear();
      expect((await h.application.updateSettings({ providerMaxAttempts: 2 })).ok).toBe(true);
      const twice = manager.chat(request()); await vi.runAllTimersAsync(); expect((await twice).ok).toBe(false); expect(requestUrl).toHaveBeenCalledTimes(2);
      vi.mocked(requestUrl).mockClear(); vi.mocked(requestUrl).mockImplementation(() => new Promise(() => {}) as never);
      const uncertain = manager.chat(request()); await vi.advanceTimersByTimeAsync(10_001);
      expect(await uncertain).toMatchObject({ ok: false, error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN" } }); expect(requestUrl).toHaveBeenCalledOnce();
    } finally { manager.dispose(); h.application.dispose(); }
  });
});
