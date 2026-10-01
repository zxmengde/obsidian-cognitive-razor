import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, SettingsStore } from "./settings-store";
import type { ILogger, PluginSettings, ProviderConfig } from "../types";

type TestPlugin = Plugin & { saved: unknown[] };

function createPlugin(
  initialData: unknown = null,
  saveData: (data: unknown) => Promise<void> = async () => undefined,
): TestPlugin {
  const saved: unknown[] = [];
  return {
    saved,
    async loadData() {
      return initialData;
    },
    async saveData(data: unknown) {
      saved.push(data);
      await saveData(data);
    },
  } as unknown as TestPlugin;
}

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    apiKey: "key-a",
    baseUrl: "https://provider.test/v1",
    apiFormat: "openai-chat-completions",
    enableWebSearch: false,
    embeddingApiFormat: "openai-embeddings",
    defaultChatModel: "chat-a",
    defaultEmbedModel: "embed-a",
    enabled: true,
    ...overrides,
  };
}

function settingsWithProvider(id = "A"): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    providers: { [id]: provider() },
    defaultProviderId: id,
    taskModels: {
      ...DEFAULT_SETTINGS.taskModels,
      define: { ...DEFAULT_SETTINGS.taskModels.define, providerId: id },
      tag: { ...DEFAULT_SETTINGS.taskModels.tag, providerId: id },
      write: { ...DEFAULT_SETTINGS.taskModels.write, providerId: id },
      verify: { ...DEFAULT_SETTINGS.taskModels.verify, providerId: id },
      index: { ...DEFAULT_SETTINGS.taskModels.index, providerId: id },
    },
  };
}

describe("SettingsStore defaults and persistence", () => {
  it("loads pre-cards settings with empty independent model and configurable roots", async () => {
    const legacy = JSON.parse(JSON.stringify(settingsWithProvider()));
    delete legacy.taskModels.cards;
    delete legacy.cardsSourceRoot;
    delete legacy.cardsTargetRoot;
    const store = new SettingsStore(createPlugin(legacy));
    expect((await store.loadSettings()).ok).toBe(true);
    expect(store.getSettings()).toMatchObject({ cardsSourceRoot: "C-知识库", cardsTargetRoot: "D-习题库", taskModels: { cards: { providerId: "", model: "" } } });
    expect((await store.updateSettings({ cardsSourceRoot: "知识", cardsTargetRoot: "练习" })).ok).toBe(true);
    expect(store.getSettings().cardsTargetRoot).toBe("练习");
    expect((await store.updateSettings({ cardsTargetRoot: "../outside" })).ok).toBe(false);
    expect(store.getSettings().cardsTargetRoot).toBe("练习");
  });
  it("loads defaults without writing them on first use", async () => {
    const plugin = createPlugin();
    const store = new SettingsStore(plugin);

    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await store.loadSettings()).ok).toBe(true);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(plugin.saved).toHaveLength(0);
  });

  it("migrates settings without a log level to info without rewriting them", async () => {
    const legacy = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete legacy.logLevel;
    const plugin = createPlugin(legacy);
    const store = new SettingsStore(plugin);

    const result = await store.loadSettings();

    expect(result.ok).toBe(true);
    expect(store.getSettings().logLevel).toBe("info");
    expect(plugin.saved).toHaveLength(0);
  });

  it("applies defaults for newly introduced workflow controls without rewriting persisted settings", async () => {
    const legacy = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete legacy.providerMaxAttempts;
    delete legacy.enableSemanticIndexing;
    delete legacy.enableDuplicateDetection;
    delete legacy.enableStreamingKeepalive;
    const plugin = createPlugin(legacy);
    const store = new SettingsStore(plugin);

    expect((await store.loadSettings()).ok).toBe(true);
    expect(store.getSettings()).toMatchObject({
      providerMaxAttempts: 3,
      enableSemanticIndexing: true,
      enableDuplicateDetection: true,
      enableStreamingKeepalive: false,
    });
    expect(plugin.saved).toHaveLength(0);
  });

  it("persists supported log levels and rejects unknown values", async () => {
    const store = new SettingsStore(createPlugin());

    expect((await store.updateSettings({ logLevel: "debug" })).ok).toBe(true);
    expect(store.getSettings().logLevel).toBe("debug");
    const invalid = await store.updateSettings({ logLevel: "verbose" as never });

    expect(invalid.ok).toBe(false);
    expect(store.getSettings().logLevel).toBe("debug");
  });

  it("persists the streaming keepalive switch", async () => {
    const store = new SettingsStore(createPlugin());

    expect((await store.updateSettings({ enableStreamingKeepalive: true })).ok).toBe(true);
    expect(store.getSettings().enableStreamingKeepalive).toBe(true);
    expect((await store.updateSettings({ enableStreamingKeepalive: false })).ok).toBe(true);
    expect(store.getSettings().enableStreamingKeepalive).toBe(false);
  });

  it("returns isolated snapshots and persists only real changes", async () => {
    const plugin = createPlugin();
    const store = new SettingsStore(plugin);

    const first = await store.updateSettings({ concurrency: 2 });
    expect(first.ok).toBe(true);
    expect(plugin.saved).toHaveLength(1);

    const snapshot = store.getSettings();
    snapshot.directoryScheme.domain = "mutated";
    snapshot.taskModels.define.providerId = "mutated";
    expect(store.getSettings().directoryScheme.domain).toBe(DEFAULT_SETTINGS.directoryScheme.domain);
    expect(store.getSettings().taskModels.define.providerId).toBe("");

    expect((await store.updateSettings({ concurrency: 2 })).ok).toBe(true);
    expect(plugin.saved).toHaveLength(1);
  });

  it("keeps memory unchanged when persistence fails", async () => {
    const plugin = createPlugin(null, async () => {
      throw new Error("disk unavailable");
    });
    const store = new SettingsStore(plugin);
    const listener = vi.fn();
    store.subscribe(listener);

    const result = await store.updateSettings({ concurrency: 2 });

    expect(result.ok).toBe(false);
    expect(store.getSettings().concurrency).toBe(DEFAULT_SETTINGS.concurrency);
    expect(listener).not.toHaveBeenCalled();
  });

  it("serializes concurrent updates instead of dropping the earlier change", async () => {
    let releaseFirstSave!: () => void;
    const firstSaveBlocked = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let saveCount = 0;
    const plugin = createPlugin(null, async () => {
      saveCount += 1;
      if (saveCount === 1) {
        await firstSaveBlocked;
      }
    });
    const store = new SettingsStore(plugin);

    const first = store.updateSettings({ concurrency: 2 });
    const second = store.updateSettings({ providerTimeoutMs: 90_000 });
    await Promise.resolve();
    releaseFirstSave();

    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(store.getSettings()).toMatchObject({ concurrency: 2, providerTimeoutMs: 90_000 });
  });

  it("merges concurrent nested leaf updates against the latest persisted state", async () => {
    const store = new SettingsStore(createPlugin());

    const updates = await Promise.all([
      store.updateSettings({ directoryScheme: { domain: "知识/领域" } }),
      store.updateSettings({ directoryScheme: { issue: "知识/议题" } }),
      store.updateTaskModel("define", { temperature: 0.4 }),
      store.updateTaskModel("verify", { maxTokens: 2048 }),
    ]);

    expect(updates.every((result) => result.ok)).toBe(true);
    expect(store.getSettings()).toMatchObject({
      directoryScheme: {
        domain: "知识/领域",
        issue: "知识/议题",
      },
      taskModels: {
        define: { temperature: 0.4 },
        verify: { maxTokens: 2048 },
      },
    });
  });

  it("preserves unrelated task parameters when inheritance and omission are changed during a save", async () => {
    const settings = settingsWithProvider();
    settings.taskModels.write = {
      providerId: "A", model: "chat-a", maxTokens: 100,
      parameters: { temperature: 0.7, topP: 1, maxTokens: 200 },
    };
    let releaseSave!: () => void;
    const firstSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saves = 0;
    const plugin = createPlugin(settings, async () => { if (++saves === 1) await firstSave; });
    const store = new SettingsStore(plugin);
    await store.loadSettings();

    const temperature = store.updateTaskModel("write", { parameters: { temperature: 0.8 } });
    const inheritTokens = store.updateTaskModel("write", { parameters: { maxTokens: undefined }, maxTokens: undefined });
    const omitTopP = store.updateTaskModel("write", { parameters: { topP: null } });
    releaseSave();

    expect((await Promise.all([temperature, inheritTokens, omitTopP])).every((result) => result.ok)).toBe(true);
    expect(store.getSettings().taskModels.write).toEqual({
      providerId: "A", model: "chat-a", parameters: { temperature: 0.8, topP: null },
    });
    const reloaded = new SettingsStore(createPlugin(plugin.saved.at(-1)));
    await reloaded.loadSettings();
    expect(reloaded.getSettings().taskModels.write).toEqual(store.getSettings().taskModels.write);
  });

  it("preserves separate capability changes while another capability returns to inheritance", async () => {
    const settings = settingsWithProvider();
    settings.taskModels.write.capabilities = { nativeWebSearch: false, promptCaching: false, responseContinuation: false };
    const store = new SettingsStore(createPlugin(settings));
    await store.loadSettings();

    const results = await Promise.all([
      store.updateTaskModel("write", { capabilities: { promptCaching: true } }),
      store.updateTaskModel("write", { capabilities: { nativeWebSearch: undefined } }),
      store.updateTaskModel("write", { capabilities: { responseContinuation: true } }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(store.getSettings().taskModels.write.capabilities).toEqual({ promptCaching: true, responseContinuation: true });
  });

  it("isolates listener failures from a successful save", async () => {
    const plugin = createPlugin();
    const logger: ILogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const store = new SettingsStore(plugin, logger);
    store.subscribe(() => {
      throw new Error("view already destroyed");
    });

    const result = await store.updateSettings({ concurrency: 2 });

    expect(result.ok).toBe(true);
    expect(store.getSettings().concurrency).toBe(2);
    expect(plugin.saved).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      "SettingsStore",
      "设置监听器执行失败",
      expect.objectContaining({ message: "view already destroyed" }),
    );
  });
});

describe("SettingsStore validation and references", () => {
  it("rejects incomplete or malformed persisted data without overwriting memory", async () => {
    const plugin = createPlugin({
      ...DEFAULT_SETTINGS,
      providers: { broken: null },
      concurrency: 0,
    });
    const store = new SettingsStore(plugin);

    const result = await store.loadSettings();

    expect(result.ok).toBe(false);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(store.getSettings().providers).toEqual({});
    expect(plugin.saved).toHaveLength(0);
  });

  it("keeps configured providers when an external reload yields undefined", async () => {
    let data: unknown = {
      ...DEFAULT_SETTINGS,
      providers: {
        A: {
          apiKey: "user-key",
          apiFormat: "openai-chat-completions",
          embeddingApiFormat: "openai-embeddings",
          defaultChatModel: "chat",
          defaultEmbedModel: "embed",
          enabled: true,
        },
      },
      defaultProviderId: "A",
    };
    const plugin = {
      loadData: async () => data,
      saveData: async () => undefined,
    } as never;
    const store = new SettingsStore(plugin);
    expect((await store.loadSettings()).ok).toBe(true);

    data = undefined;
    const result = await store.loadSettings();
    expect(result.ok).toBe(false);
    expect(Object.keys(store.getSettings().providers)).toEqual(["A"]);
  });

  it("does not overwrite disk providers after a failed reload", async () => {
    const saved: unknown[] = [];
    const configured = {
      ...structuredClone(DEFAULT_SETTINGS),
      providers: {
        A: {
          apiKey: "user-key",
          apiFormat: "openai-chat-completions" as const,
          embeddingApiFormat: "openai-embeddings" as const,
          defaultChatModel: "chat",
          defaultEmbedModel: "embed",
          enabled: true,
        },
      },
      defaultProviderId: "A",
    };
    let data: unknown = configured;
    const plugin = {
      loadData: async () => data,
      saveData: async (next: unknown) => { saved.push(next); },
    } as never;
    const store = new SettingsStore(plugin);
    expect((await store.loadSettings()).ok).toBe(true);

    const broken = structuredClone(configured) as unknown as Record<string, unknown>;
    delete broken.providerTimeoutMs;
    data = broken;
    expect((await store.loadSettings()).ok).toBe(false);
    expect(Object.keys(store.getSettings().providers)).toEqual(["A"]);

    saved.length = 0;
    expect((await store.updateSettings({ concurrency: 2 })).ok).toBe(true);
    const written = saved.at(-1) as { providers: Record<string, unknown> };
    expect(Object.keys(written.providers)).toEqual(["A"]);
  });

  it("rejects directory schemes that escape the vault", async () => {
    const store = new SettingsStore(createPlugin());
    const result = await store.updateSettings({
      directoryScheme: {
        ...DEFAULT_SETTINGS.directoryScheme,
        domain: "../outside",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "E101_INVALID_INPUT" },
    });
    expect(store.getSettings().directoryScheme).toEqual(DEFAULT_SETTINGS.directoryScheme);
  });

  it("rejects invalid provider, scalar, and task model updates atomically", async () => {
    const store = new SettingsStore(createPlugin());

    const invalidProvider = await store.updateSettings({
      providers: { A: provider({ apiFormat: "unknown" as never }) },
    });
    expect(invalidProvider.ok).toBe(false);

    const invalidProviderUrl = await store.updateSettings({
      providers: { A: provider({ baseUrl: "file:///tmp/provider" }) },
    });
    expect(invalidProviderUrl.ok).toBe(false);

    const invalidScalar = await store.updateSettings({ concurrency: 0 });
    expect(invalidScalar.ok).toBe(false);

    const invalidModel = await store.updateSettings({
      taskModels: {
        ...DEFAULT_SETTINGS.taskModels,
        define: { ...DEFAULT_SETTINGS.taskModels.define, temperature: 3 },
      },
    });
    expect(invalidModel.ok).toBe(false);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("validates retry count", async () => {
    const store = new SettingsStore(createPlugin());

    expect((await store.updateSettings({ providerMaxAttempts: 1 })).ok).toBe(true);
    expect(store.getSettings()).toMatchObject({
      providerMaxAttempts: 1,
    });

    expect((await store.updateSettings({ providerMaxAttempts: 0 })).ok).toBe(false);
    expect((await store.updateSettings({ providerMaxAttempts: 4 })).ok).toBe(false);
    expect(store.getSettings()).toMatchObject({
      providerMaxAttempts: 1,
    });
  });

  it("cleans provider references when removing a provider", async () => {
    const store = new SettingsStore(createPlugin());
    const configured = settingsWithProvider("A");
    configured.providers.B = provider({ defaultChatModel: "chat-b" });
    configured.taskModels.define.providerId = "B";
    configured.defaultProviderId = "B";
    expect((await store.updateSettings(configured)).ok).toBe(true);

    expect((await store.removeProvider("B")).ok).toBe(true);
    const settings = store.getSettings();
    expect(settings.providers.B).toBeUndefined();
    expect(settings.defaultProviderId).toBe("");
    expect(settings.taskModels.define.providerId).toBe("");
  });

  it("preserves default and task routes when a provider is temporarily disabled", async () => {
    const store = new SettingsStore(createPlugin());
    const configured = settingsWithProvider("A");
    configured.providers.B = provider({ enabled: true });
    configured.defaultProviderId = "B";
    configured.taskModels.define.providerId = "B";
    configured.taskModels.index.providerId = "B";
    expect((await store.updateSettings(configured)).ok).toBe(true);

    expect((await store.updateProvider("B", { enabled: false })).ok).toBe(true);

    const settings = store.getSettings();
    expect(settings.defaultProviderId).toBe("B");
    expect(settings.taskModels.define.providerId).toBe("B");
    expect(settings.taskModels.index.providerId).toBe("B");

    expect((await store.updateProvider("B", { enabled: true })).ok).toBe(true);
    expect(store.getSettings().defaultProviderId).toBe("B");
    expect(store.getSettings().taskModels.define.providerId).toBe("B");
    expect(store.getSettings().taskModels.index.providerId).toBe("B");
  });

  it("preserves disabled provider references from bulk settings updates", async () => {
    const store = new SettingsStore(createPlugin());
    const configured = settingsWithProvider("A");
    configured.providers.B = provider({ enabled: false });
    configured.defaultProviderId = "B";
    configured.taskModels.verify.providerId = "B";

    expect((await store.updateSettings(configured)).ok).toBe(true);
    expect(store.getSettings()).toMatchObject({
      defaultProviderId: "B",
      taskModels: { verify: { providerId: "B" } },
    });
  });

  it("does not infer protocol defaults when an existing provider is edited", async () => {
    const store = new SettingsStore(createPlugin());
    expect((await store.addProvider("A", provider())).ok).toBe(true);

    const result = await store.updateProvider("A", {
      apiFormat: "openai-chat-completions",
      enableWebSearch: false,
    });

    expect(result.ok).toBe(true);
    expect(store.getSettings().providers.A).toMatchObject({
      apiFormat: "openai-chat-completions",
    });
    expect(store.getSettings().providers.A).not.toHaveProperty("enableWebSearch");
  });

  it("supports explicit protocol and embedding capability choices", async () => {
    const store = new SettingsStore(createPlugin());
    const result = await store.addProvider("Gemini", provider({
      apiFormat: "gemini-generative-language",
      embeddingApiFormat: "disabled",
      capabilities: { nativeWebSearch: true },
    }));

    expect(result.ok).toBe(true);
    expect(store.getSettings().providers.Gemini).toMatchObject({
      apiFormat: "gemini-generative-language",
      embeddingApiFormat: "disabled",
      capabilities: { nativeWebSearch: true },
    });
  });

  it("supports an embedding-only provider without making it the default chat provider", async () => {
    const store = new SettingsStore(createPlugin());
    const result = await store.addProvider("Embedding", provider({
      apiFormat: "disabled",
      defaultChatModel: "unused-chat-model",
      enableWebSearch: true,
      embeddingApiFormat: "openai-embeddings",
      defaultEmbedModel: "Qwen/Qwen3-Embedding-4B",
    }));

    expect(result.ok).toBe(true);
    expect(store.getSettings().defaultProviderId).toBe("");
    expect(store.getSettings().providers.Embedding).toMatchObject({
      defaultChatModel: "",
    });
    expect(store.getSettings().providers.Embedding).not.toHaveProperty("enableWebSearch");
    expect((await store.updateTaskModel("index", { providerId: "Embedding" })).ok).toBe(true);
    expect((await store.updateTaskModel("define", { providerId: "Embedding" })).ok).toBe(true);
    expect(store.getSettings().taskModels.index.providerId).toBe("Embedding");
    expect(store.getSettings().taskModels.define.providerId).toBe("Embedding");
  });

  it("rejects a provider with both chat and embedding disabled", async () => {
    const store = new SettingsStore(createPlugin());
    const result = await store.addProvider("Empty", provider({
      apiFormat: "disabled",
      embeddingApiFormat: "disabled",
      defaultChatModel: "",
      defaultEmbedModel: "",
    }));

    expect(result.ok).toBe(false);
    expect(store.getSettings().providers).toEqual({});
  });

  it("rejects object-prototype and control-character Provider IDs", async () => {
    const store = new SettingsStore(createPlugin());

    for (const id of ["__proto__", "constructor", "prototype", "bad\u0000id"]) {
      const result = await store.addProvider(id, provider());
      expect(result.ok).toBe(false);
    }
    expect(store.getSettings().providers).toEqual({});

    const imported = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    imported.providers = JSON.parse(`{"__proto__":${JSON.stringify(provider())}}`) as unknown;
    const loadStore = new SettingsStore(createPlugin(imported));
    expect((await loadStore.loadSettings()).ok).toBe(false);
    expect(loadStore.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects unsafe integers in unbounded task fields", async () => {
    const store = new SettingsStore(createPlugin());

    const result = await store.updateSettings({
      taskModels: {
        ...DEFAULT_SETTINGS.taskModels,
        verify: {
          ...DEFAULT_SETTINGS.taskModels.verify,
          maxTokens: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("SettingsStore optional fields and import/export", () => {
  it("clears optional provider and task model fields without leaving undefined keys", async () => {
    const store = new SettingsStore(createPlugin());
    expect((await store.addProvider("A", provider({
      apiFormat: "openai-chat-completions",
      embeddingApiFormat: "disabled",
    }))).ok).toBe(true);

    expect((await store.updateSettings({
      taskModels: {
        ...store.getSettings().taskModels,
        verify: { ...store.getSettings().taskModels.verify, reasoning_effort: "high", maxTokens: 2048 },
      },
    })).ok).toBe(true);
    expect((await store.updateSettings({
      taskModels: {
        ...store.getSettings().taskModels,
        verify: { ...store.getSettings().taskModels.verify, reasoning_effort: undefined, maxTokens: undefined },
      },
    })).ok).toBe(true);
    expect(store.getSettings().taskModels.verify).not.toHaveProperty("reasoning_effort");
    expect(store.getSettings().taskModels.verify).not.toHaveProperty("maxTokens");
  });

  it("redacts API keys from exported settings", async () => {
    const store = new SettingsStore(createPlugin());
    expect((await store.updateSettings({
      ...settingsWithProvider(),
    })).ok).toBe(true);

    const exported = JSON.parse(store.exportSettings()) as PluginSettings;
    expect(exported.providers.A.apiKey).toBe("");
    expect(exported.providers.A.defaultChatModel).toBe("chat-a");
  });

  it("rejects malformed JSON without echoing imported secrets or replacing state", async () => {
    const store = new SettingsStore(createPlugin());
    expect((await store.addProvider("A", provider())).ok).toBe(true);
    const before = store.getSettings();

    const result = await store.importSettings('{"apiKey":"secret-key"');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("secret-key");
      expect(JSON.stringify(result.error.details ?? {})).not.toContain("secret-key");
    }
    expect(store.getSettings()).toEqual(before);
  });

  it("imports a complete validated snapshot and does not write defaults during load", async () => {
    const imported = settingsWithProvider();
    imported.concurrency = 3;
    const plugin = createPlugin(imported);
    const store = new SettingsStore(plugin);

    expect((await store.loadSettings()).ok).toBe(true);
    expect(store.getSettings().concurrency).toBe(3);
    expect(plugin.saved).toHaveLength(0);
  });
});


describe("SettingsStore presentation controls", () => {
  const defaults = { verifyReportPresentation: "expanded", queueDefaultFilter: "all", queuePageSize: 50 };

  it("keeps existing report and queue defaults without rewriting old settings", async () => {
    const legacy = structuredClone(settingsWithProvider()) as unknown as Record<string, unknown>;
    for (const key of Object.keys(defaults)) delete legacy[key];
    const plugin = createPlugin(legacy);
    const store = new SettingsStore(plugin);
    expect((await store.loadSettings()).ok).toBe(true);
    expect(store.getSettings()).toMatchObject(defaults);
    expect(store.getSettings().providers.A.apiKey).toBe("key-a");
    expect(plugin.saved).toHaveLength(0);
    expect(legacy).not.toHaveProperty("queuePageSize");
    const imported = new SettingsStore(createPlugin());
    expect((await imported.importSettings(JSON.stringify(legacy))).ok).toBe(true);
    expect(imported.getSettings()).toMatchObject(defaults);
  });

  it.each([
    ["verifyReportPresentation", "hidden"], ["verifyReportPresentation", null],
    ["queueDefaultFilter", "completed"], ["queueDefaultFilter", 0],
    ["queuePageSize", 0], ["queuePageSize", 26], ["queuePageSize", "25"], ["queuePageSize", null],
  ])("safely defaults invalid loaded/imported %s=%s", async (key, value) => {
    const data = { ...structuredClone(DEFAULT_SETTINGS), [key as string]: value };
    const plugin = createPlugin(data);
    const store = new SettingsStore(plugin);
    expect((await store.loadSettings()).ok).toBe(true);
    expect(store.getSettings()).toMatchObject(defaults);
    expect(plugin.saved).toHaveLength(0);
    expect((await store.importSettings(JSON.stringify(data))).ok).toBe(true);
    expect(store.getSettings()).toMatchObject(defaults);
  });

  it("persists, reloads and exports valid choices through the existing settings route", async () => {
    const plugin = createPlugin();
    const store = new SettingsStore(plugin);
    const chosen = { verifyReportPresentation: "collapsed", queueDefaultFilter: "failed", queuePageSize: 100 } as const;
    expect((await store.updateSettings(chosen)).ok).toBe(true);
    expect(store.getSettings()).toMatchObject(chosen);
    expect(plugin.saved).toHaveLength(1);
    const exported = store.exportSettings();
    expect(JSON.parse(exported)).toMatchObject(chosen);
    const reloaded = new SettingsStore(createPlugin(plugin.saved[0]));
    expect((await reloaded.loadSettings()).ok).toBe(true);
    expect(reloaded.getSettings()).toMatchObject(chosen);
    const imported = new SettingsStore(createPlugin());
    expect((await imported.importSettings(exported)).ok).toBe(true);
    expect(imported.getSettings()).toMatchObject(chosen);
    expect((await store.updateSettings({ queueDefaultFilter: "active", queuePageSize: 25 })).ok).toBe(true);
    expect(store.getSettings()).toMatchObject({ queueDefaultFilter: "active", queuePageSize: 25 });
    expect((await store.updateSettings({ verifyReportPresentation: "expanded", queueDefaultFilter: "all", queuePageSize: 50 })).ok).toBe(true);
    expect(store.getSettings()).toMatchObject(defaults);
  });

  it.each([
    { verifyReportPresentation: "hidden" }, { verifyReportPresentation: undefined },
    { queueDefaultFilter: "complete" }, { queueDefaultFilter: null },
    { queuePageSize: 26 }, { queuePageSize: "100" }, { queuePageSize: Number.NaN },
  ])("rejects invalid live presentation edits atomically: %j", async (invalid) => {
    const plugin = createPlugin();
    const store = new SettingsStore(plugin);
    const before = store.getSettings();
    const listener = vi.fn();
    store.subscribe(listener);
    expect((await store.updateSettings({ concurrency: 2, ...invalid } as never)).ok).toBe(false);
    expect(store.getSettings()).toEqual(before);
    expect(plugin.saved).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps presentation settings unchanged after a failed save", async () => {
    const plugin = createPlugin(null, async () => { throw new Error("disk unavailable"); });
    const store = new SettingsStore(plugin);
    expect((await store.updateSettings({ verifyReportPresentation: "collapsed", queueDefaultFilter: "active", queuePageSize: 25 })).ok).toBe(false);
    expect(store.getSettings()).toMatchObject(defaults);
  });
});
