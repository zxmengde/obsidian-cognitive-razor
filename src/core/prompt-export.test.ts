import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { requestUrl, type Plugin, type RequestUrlParam } from "obsidian";
import { DEFAULT_SETTINGS, SettingsStore } from "../data/settings-store";
import { Validator } from "../data/validator";
import { CardsTaskExecutor } from "./cards-task-executor";
import { CreateOrchestrator } from "./create-orchestrator";
import { DuplicateMergeService } from "./duplicate-merge-service";
import { ProviderManager } from "./provider-manager";
import type { ProviderStreamRequest } from "./provider-streaming";
import { ResponsePipeline } from "./response-pipeline";
import { schemaRegistry } from "./schema-registry";
import { TagTaskExecutor } from "./tag-task-executor";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import { VerifyTaskExecutor } from "./verify-task-executor";
import { WriteTaskExecutor } from "./write-task-executor";
import type { PluginSettings, ProviderApiFormat, TaskExecutionContext, TaskRecord } from "../types";
import { capturePromptExample, createExportPromptManager, createPromptExamples, loadExportSettings, logger, preparePromptExample,
  type PromptExample } from "../../scripts/prompt-export-runtime";

vi.mock("obsidian", async importOriginal => ({ ...await importOriginal<typeof import("obsidian")>(), requestUrl: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const readPrompt = (path: string) => readFile(path, "utf8");
type Profile = { format: Exclude<ProviderApiFormat, "disabled">; streaming?: boolean; search?: boolean;
  cache?: "implicit" | "explicit"; continuation?: boolean; renderer?: boolean };
function settings(profile: Profile): PluginSettings {
  const data = structuredClone(DEFAULT_SETTINGS);
  data.defaultProviderId = "configured";
  data.enableStreamingKeepalive = profile.streaming ?? false;
  data.streamingTransport = profile.renderer ? "renderer-fetch" : "node-http";
  data.providerMaxAttempts = 3;
  data.providers.configured = {
    apiKey: "secret-credential-must-not-be-exported", baseUrl: "https://example.test/custom/v1", apiFormat: profile.format,
    embeddingApiFormat: "disabled", defaultChatModel: profile.cache ? "gpt-6.1-sol" : "configured-model", defaultEmbedModel: "", enabled: true,
    capabilities: { temperature: true, topP: true, reasoning: true, nativeWebSearch: profile.search ?? false,
      promptCaching: !!profile.cache, promptCacheMode: profile.cache, responseContinuation: profile.continuation ?? false },
    parameters: profile.format === "gemini-generative-language"
      ? { temperature: 0.4, topP: 0.8, maxTokens: 3210, thinkingBudget: 512 }
      : { temperature: 0.4, topP: 0.8, maxTokens: 3210, reasoning_effort: "high" },
  };
  return data;
}
async function actualSettings(raw: PluginSettings): Promise<SettingsStore> {
  const plugin = { loadData: async () => structuredClone(raw),
    saveData: async () => { throw new Error("No setting writes in this test"); } } as unknown as Plugin;
  const store = new SettingsStore(plugin, logger);
  expect((await store.loadSettings()).ok).toBe(true);
  return store;
}

/** Independent reference calls product entry points with the default production
 * Obsidian transport (requestUrl/streamRequester/fetch mocked only at IO). */
async function reference(example: PromptExample, store: SettingsStore, manager: ProviderManager) {
  const promptManager = await createExportPromptManager(readPrompt);
  example = await preparePromptExample(example, { settingsStore: store, promptManager });
  const validator = new Validator();
  const shared = { settingsStore: store, providerManager: manager, promptManager, logger, schemaRegistry,
    responsePipeline: new ResponsePipeline(validator) };
  const signal = new AbortController().signal;
  const context: TaskExecutionContext = { modelSnapshot: resolveTaskModelSnapshot(store.getSettings(), example.taskType), attemptReason: "initial" };
  switch (example.taskType) {
    case "define": return new CreateOrchestrator({ ...shared, validator, workflowCoordinator: {} as never }).defineDirect(example.input!, signal);
    case "tag": return new TagTaskExecutor(shared).execute(example.task as TaskRecord<"tag">, signal, context);
    case "verify": return new VerifyTaskExecutor(shared).execute(example.task as TaskRecord<"verify">, signal, context);
    case "write": return new WriteTaskExecutor(shared).execute(example.task as TaskRecord<"write">, signal, context);
    case "cards": return new CardsTaskExecutor(shared).execute(example.task as TaskRecord<"cards">, signal, context);
    case "merge": return new DuplicateMergeService({ ...shared, app: {} as never, fileStorage: {} as never, noteRepository: {} as never,
      cruidCache: {} as never, duplicateManager: {} as never, reindex: vi.fn() }).prepareCapturedMerge(example.merge!, context.modelSnapshot, signal);
  }
}

const profiles: Profile[] = [
  { format: "openai-chat-completions" }, { format: "openai-chat-completions", streaming: true },
  { format: "openai-responses" }, { format: "openai-responses", streaming: true, search: true, cache: "explicit" },
  { format: "openai-responses", streaming: true, search: true, cache: "implicit" },
  { format: "openai-responses", streaming: true, continuation: true },
  { format: "openai-responses", streaming: true, renderer: true, search: true, cache: "explicit" },
  { format: "gemini-generative-language" }, { format: "gemini-generative-language", streaming: true, search: true },
];

describe.sequential("prompt exports match actual production transport", () => {
  it.each(["merge", "cards"])("rejects missing %s configuration consistently", async taskType => {
    const raw = settings({ format: "openai-responses" });
    Reflect.deleteProperty(raw.taskModels, taskType);
    const store = new SettingsStore({ loadData: async () => raw } as unknown as Plugin, logger);
    expect((await store.loadSettings()).ok).toBe(false);
    await expect(loadExportSettings(raw)).rejects.toThrow();
  });
  it.each(profiles)("preserves complete requests for %j", async profile => {
    const raw = settings(profile);
    const exportStore = await loadExportSettings(raw);
    const store = await actualSettings(raw);
    const promptManager = await createExportPromptManager(readPrompt);
    const examples = createPromptExamples(exportStore.getSettings());
    expect(examples.filter(e => !e.id.includes("history-fixture"))).toHaveLength(19);
    expect(examples).toHaveLength(25);
    for (const example of examples) {
      const captures: Array<{ url: string; body: string }> = [];
      vi.mocked(requestUrl).mockReset().mockImplementation((input) => {
        const params = input as RequestUrlParam;
        captures.push({ url: params.url, body: String(params.body) }); throw new Error("offline reference stop");
      });
      const streamRequester = vi.fn(async (input: ProviderStreamRequest) => {
        captures.push({ url: input.url, body: input.body }); throw new Error("offline reference stop");
      });
      const fetch = vi.spyOn(window, "fetch").mockImplementation(async (url, init) => {
        captures.push({ url: String(url), body: String(init?.body) }); throw new Error("offline reference stop");
      });
      const exported = await capturePromptExample(example, { settingsStore: exportStore, promptManager });
      expect(captures, example.id).toHaveLength(0);
      const manager = new ProviderManager(store, logger, undefined, streamRequester);
      try { expect((await reference(example, store, manager)).ok, example.id).toBe(false); }
      finally { manager.dispose(); fetch.mockRestore(); }
      expect(captures, example.id).toHaveLength(1);
      expect(exported.wire.body, example.id).toBe(captures[0].body);
      expect(JSON.parse(exported.wire.body), example.id).toEqual(JSON.parse(captures[0].body));
      expect(exported.wire.url, example.id).toBe(captures[0].url);
      expect(exported.wire.body).not.toContain(raw.providers.configured.apiKey);
      const body = JSON.parse(exported.wire.body);
      if (profile.format === "gemini-generative-language") expect(body.model).toBeUndefined();
      else expect(body.model).toBe(raw.providers.configured.defaultChatModel);
    }
  });

  it("preserves task-specific models, omissions, Merge schema, Verify metadata and Cards boundaries", async () => {
    const raw = settings({ format: "openai-responses", streaming: true, search: true, cache: "explicit" });
    raw.taskModels.cards = { providerId: "configured", model: "dedicated-cards-model", parameters: { maxTokens: 777, reasoning_effort: null } };
    const store = await loadExportSettings(raw), promptManager = await createExportPromptManager(readPrompt);
    const outputs = new Map<string, Record<string, unknown>>();
    for (const example of createPromptExamples(store.getSettings())) {
      outputs.set(example.id, JSON.parse((await capturePromptExample(example, { settingsStore: store, promptManager })).wire.body));
    }
    const cards = outputs.get("cards")!;
    expect(cards).toMatchObject({ model: "dedicated-cards-model", max_output_tokens: 777, stream: true });
    expect(cards).not.toHaveProperty("tools"); expect(cards).not.toHaveProperty("text"); expect(cards).not.toHaveProperty("reasoning");
    expect(outputs.get("merge")).toHaveProperty("text.format.schema.properties.parents");
    expect(outputs.get("verify")).toHaveProperty("tools"); expect(outputs.get("verify")).not.toHaveProperty("text");
    expect(JSON.stringify(outputs.get("verify"))).toContain("_verify_context");
    expect(JSON.stringify(outputs.get("tag"))).toContain("core_definition");
    expect(outputs.get("write-domain-core")).toHaveProperty("text.format.schema.properties.result.anyOf");
    expect(JSON.stringify(outputs.get("write-domain-core"))).toContain("<write_stage>core</write_stage>");
    expect(outputs.get("write-domain-narrative-history-fixture")).not.toHaveProperty("previous_response_id");
  });

  it("labels synthetic history and uses the actual continuation policy without a fabricated response", async () => {
    const store = await loadExportSettings(settings({ format: "openai-responses", continuation: true }));
    const promptManager = await createExportPromptManager(readPrompt);
    const example = createPromptExamples(store.getSettings()).find(e => e.id === "write-domain-narrative-history-fixture")!;
    expect(example.fixture).toContain("不表示真实续接");
    const result = await capturePromptExample(example, { settingsStore: store, promptManager });
    expect(JSON.parse(result.wire.body).previous_response_id).toBe("fixture_response_id_not_from_upstream");
    expect(result).not.toHaveProperty("response");
    const system = result.request.messages.find(message => message.role === "system")?.content ?? "";
    expect(system).toContain("<knowledge_policy>");
    expect(system).toContain("<writing_rules>");
    expect(system).not.toContain("<hierarchy_rules>");
    const split = settings({ format: "openai-responses", continuation: true });
    split.taskModels.verify = { providerId: "configured", model: "separate-verify-model" };
    const splitStore = await loadExportSettings(split);
    const verify = createPromptExamples(splitStore.getSettings()).find(e => e.id === "verify-history-fixture")!;
    const separate = await capturePromptExample(verify, { settingsStore: splitStore, promptManager });
    expect(JSON.parse(separate.wire.body)).not.toHaveProperty("previous_response_id");
    expect(JSON.stringify(separate.request.messages)).not.toContain("离线上下文示例，不是真实模型回答");
  });

  it("loads custom disk templates into a fresh PromptManager", async () => {
    const store = await loadExportSettings(settings({ format: "openai-responses" }));
    const example = createPromptExamples(store.getSettings()).find(e => e.id === "write-domain-core")!;
    const original = await createExportPromptManager(readPrompt);
    const custom = await createExportPromptManager(async path => (await readPrompt(path)).replace("<writing_rules>", "<writing_rules>\nCUSTOM_DISK_RULE"));
    const first = await capturePromptExample(example, { settingsStore: store, promptManager: original });
    const second = await capturePromptExample(example, { settingsStore: store, promptManager: custom });
    expect(first.wire.body).not.toContain("CUSTOM_DISK_RULE"); expect(second.wire.body).toContain("CUSTOM_DISK_RULE");
  });

  it("fails visibly for unconfigured or unsupported requests rather than inventing a model or omitting constraints", async () => {
    const store = await loadExportSettings(null), promptManager = await createExportPromptManager(readPrompt);
    const example = createPromptExamples(store.getSettings())[0];
    await expect(capturePromptExample(example, { settingsStore: store, promptManager })).rejects.toThrow("E401_PROVIDER_NOT_CONFIGURED");
    const unsupported = await loadExportSettings(settings({ format: "openai-chat-completions", search: true }));
    const write = createPromptExamples(unsupported.getSettings()).find(e => e.id === "write-domain-core")!;
    await expect(capturePromptExample(write, { settingsStore: unsupported, promptManager })).rejects.toThrow("E101_INVALID_INPUT");
    const invalid = settings({ format: "openai-responses" });
    await expect(loadExportSettings({ ...invalid, defaultProviderId: undefined })).rejects.toThrow("E101_INVALID_INPUT");
    await expect(loadExportSettings({ ...invalid, defaultProviderId: "", providers: null })).rejects.toThrow("E101_INVALID_INPUT");
    await expect(loadExportSettings({ ...invalid, taskModels: [] })).rejects.toThrow("E101_INVALID_INPUT");
    await expect(loadExportSettings({ ...invalid, taskModels: { ...invalid.taskModels,
      write: { ...invalid.taskModels.write, parameters: { unknownRequestOption: "private-value" } } } })).rejects.toThrow("E101_INVALID_INPUT");
    await expect(loadExportSettings({ ...invalid, providers: { configured: { ...invalid.providers.configured, capabilities: "invalid-shape" } } })).rejects.toThrow("E101_INVALID_INPUT");
  });
});
