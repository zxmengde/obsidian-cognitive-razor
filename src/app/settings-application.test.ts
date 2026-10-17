import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../types";
import type { ILogger, PluginSettings, ProviderCapabilities, ProviderConfig, Result } from "../types";
import type { ProviderProbeRequest } from "../core/model-gateway";
import type { SettingsStore } from "../data/settings-store";
import type {
  SemanticIndexPort,
  SettingsApplication,
} from "./settings-application";
import { SettingsApplication as SettingsApplicationImpl } from "./settings-application";

type SettingsStoreMock = SettingsStore & {
  updateSettings: ReturnType<typeof vi.fn>;
  resetToDefaults: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
};

function createSettingsStore(): SettingsStoreMock {
  return {
    getSettings: vi.fn(() => ({} as PluginSettings)),
    subscribe: vi.fn(() => () => undefined),
    isTaskModelDefault: vi.fn(() => true),
    exportSettings: vi.fn(() => "{}"),
    updateSettings: vi.fn(async () => ok(undefined)),
    updateTaskModel: vi.fn(async () => ok(undefined)),
    resetTaskModel: vi.fn(async () => ok(undefined)),
    addProvider: vi.fn(async () => ok(undefined)),
    updateProvider: vi.fn(async () => ok(undefined)),
    removeProvider: vi.fn(async () => ok(undefined)),
    importSettings: vi.fn(async () => ok(undefined)),
    resetToDefaults: vi.fn(async () => ok(undefined)),
  } as unknown as SettingsStoreMock;
}

describe("SettingsApplication", () => {
  it("returns a visible failure when specified-note indexing cannot start the runtime", async () => {
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
      rebuildSemanticNote: async () => { throw new Error("runtime startup failed"); },
    });
    await expect(application.rebuildSpecifiedNote("note.md")).resolves.toMatchObject({
      ok: false, error: { code: "E500_INTERNAL_ERROR" },
    });
  });

  it("keeps provider probes independent from semantic-index startup", async () => {
    const capabilities = {} as ProviderCapabilities;
    const config = {} as ProviderConfig;
    const signal = new AbortController().signal;
    const probe = vi.fn(async (
      request: ProviderProbeRequest,
      requestSignal?: AbortSignal,
    ): Promise<Result<ProviderCapabilities>> => {
      expect(request).toEqual({ providerId: "provider-1", configOverride: config, attemptReason: "manual-retry" });
      expect(requestSignal).toBe(signal);
      return ok(capabilities);
    });
    const ensureSemanticIndex = vi.fn(async () => ({
      rebuildSemanticIndex: vi.fn(),
      cancelSemanticIndexRebuild: vi.fn(),
    } as unknown as SemanticIndexPort));
    const application: SettingsApplication = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe },
      ensureSemanticIndex,
    });

    await expect(application.testProvider({
      providerId: "provider-1",
      configOverride: config,
      attemptReason: "manual-retry",
    }, signal))
      .resolves.toEqual(ok(capabilities));
    expect(probe).toHaveBeenCalledOnce();
    expect(ensureSemanticIndex).not.toHaveBeenCalled();
  });

  it("rebuilds duplicate pairs from the existing index without rebuilding embeddings", async () => {
    const settingsStore = createSettingsStore();
    settingsStore.getSettings.mockReturnValue({
      enableSemanticIndexing: true,
      enableDuplicateDetection: true,
    } as PluginSettings);
    const rebuildDuplicatePairs = vi.fn(async () => ok(3));
    const rebuildSemanticIndex = vi.fn();
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(async () => ({
        rebuildDuplicatePairs,
        rebuildSemanticIndex,
        cancelSemanticIndexRebuild: vi.fn(),
      } as unknown as SemanticIndexPort)),
    });

    await expect(application.rebuildDuplicatePairs()).resolves.toEqual(ok(3));

    expect(rebuildDuplicatePairs).toHaveBeenCalledOnce();
    expect(rebuildSemanticIndex).not.toHaveBeenCalled();
  });

  it("does not rebuild duplicate pairs before a threshold update is saved", async () => {
    const settingsStore = createSettingsStore();
    settingsStore.getSettings.mockReturnValue({
      enableSemanticIndexing: true,
      enableDuplicateDetection: true,
    } as PluginSettings);
    let resolveSave!: (result: Result<void>) => void;
    settingsStore.updateSettings.mockReturnValue(new Promise<Result<void>>((resolve) => {
      resolveSave = resolve;
    }));
    const ensureSemanticIndex = vi.fn();
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex,
    });

    const saving = application.updateSettings({ similarityThreshold: 0.9 });

    await expect(application.rebuildDuplicatePairs()).resolves.toEqual(
      err("E320_TASK_CONFLICT", "设置正在保存"),
    );
    expect(ensureSemanticIndex).not.toHaveBeenCalled();

    resolveSave(ok(undefined));
    await saving;
  });

  it("converts unexpected provider probe throws into a safe result", async () => {
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn(async () => { throw new Error("raw upstream response"); }) },
      ensureSemanticIndex: vi.fn(),
    });

    await expect(application.testProvider({ providerId: "provider-1" })).resolves.toEqual({
      ok: false,
      error: { code: "E500_INTERNAL_ERROR", message: "Provider 测试失败", details: expect.any(Object) },
    });
  });

  it("owns the settings read model and blocks mutations after dispose", async () => {
    const settingsStore = createSettingsStore();
    const unsubscribe = vi.fn();
    const settings = { value: 1 } as unknown as PluginSettings;
    let notifySettings!: () => void;
    settingsStore.subscribe.mockImplementation((listener: (value: PluginSettings) => void) => {
      notifySettings = () => listener(settings);
      return unsubscribe;
    });
    settingsStore.getSettings.mockReturnValue(settings);
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
    });
    const listener = vi.fn();
    application.subscribeSettings(listener);

    expect(application.getSettings()).toBe(settings);
    expect(application.isTaskModelDefault("define")).toBe(true);
    expect(application.exportSettings()).toBe("{}");
    notifySettings();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ value: 1 }));

    application.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await expect(application.updateSettings({ enableAutoVerify: true })).resolves.toEqual(
      err("E310_INVALID_STATE", "设置应用已释放"),
    );
    expect(settingsStore.updateSettings).not.toHaveBeenCalled();
  });

  it("preserves cancellation requested while runtime startup is pending", async () => {
    let resolveRuntime!: (port: SemanticIndexPort) => void;
    const runtimeReady = new Promise<SemanticIndexPort>((resolve) => {
      resolveRuntime = resolve;
    });
    const rebuildSemanticIndex = vi.fn(async () => ok({} as never));
    const cancelSemanticIndexRebuild = vi.fn();
    const semanticIndex = {
      rebuildSemanticIndex,
      rebuildDuplicatePairs: vi.fn(async () => ok(0)),
      cancelSemanticIndexRebuild,
    } as unknown as SemanticIndexPort;
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(() => runtimeReady),
    });

    const rebuilding = application.rebuildSemanticIndex();
    application.cancelSemanticIndexRebuild();
    resolveRuntime(semanticIndex);

    await expect(rebuilding).resolves.toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    expect(rebuildSemanticIndex).not.toHaveBeenCalled();
    expect(application.getSemanticIndexRebuildState().status).toBe("cancelled");
  });

  it("does not start semantic-index work after disposal during startup", async () => {
    let resolveRuntime!: (port: SemanticIndexPort) => void;
    const runtimeReady = new Promise<SemanticIndexPort>((resolve) => {
      resolveRuntime = resolve;
    });
    const rebuildSemanticIndex = vi.fn(async () => ok({} as never));
    const cancelSemanticIndexRebuild = vi.fn();
    const semanticIndex = {
      rebuildSemanticIndex,
      rebuildDuplicatePairs: vi.fn(async () => ok(0)),
      cancelSemanticIndexRebuild,
    } as unknown as SemanticIndexPort;
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(() => runtimeReady),
    });

    const rebuilding = application.rebuildSemanticIndex();
    application.dispose();
    resolveRuntime(semanticIndex);

    await expect(rebuilding).resolves.toEqual(err("E310_INVALID_STATE", "设置应用已释放"));
    expect(cancelSemanticIndexRebuild).toHaveBeenCalledOnce();
    expect(rebuildSemanticIndex).not.toHaveBeenCalled();
  });

  it("publishes one semantic-index rebuild read model", async () => {
    const progress = {
      phase: "embedding" as const,
      completed: 1,
      total: 2,
      failed: 0,
    };
    const summary = {
      totalNotes: 2,
      indexed: 2,
      skipped: 0,
      duplicateRefreshFailed: false,
    };
    const rebuildSemanticIndex = vi.fn(async (onProgress?: (value: typeof progress) => void) => {
      onProgress?.(progress);
      return ok(summary);
    });
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(async () => ({
        rebuildSemanticIndex,
        cancelSemanticIndexRebuild: vi.fn(),
      } as unknown as SemanticIndexPort)),
    });
    const states: string[] = [];
    application.subscribeSemanticIndexRebuildState((state) => states.push(state.status));

    await expect(application.rebuildSemanticIndex()).resolves.toEqual(ok(summary));

    expect(states).toEqual(["running", "running", "completed"]);
    expect(application.getSemanticIndexRebuildState()).toMatchObject({
      status: "completed",
      operationId: 1,
      cancelRequested: false,
      progress,
      summary,
    });
  });

  it("classifies a manually cancelled rebuild without showing a failure", async () => {
    let resolveRebuild!: (result: Result<never>) => void;
    const cancelSemanticIndexRebuild = vi.fn();
    const rebuildSemanticIndex = vi.fn(() => new Promise<Result<never>>((resolve) => {
      resolveRebuild = resolve;
    }));
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(async () => ({ rebuildSemanticIndex, cancelSemanticIndexRebuild } as unknown as SemanticIndexPort)),
    });

    const rebuilding = application.rebuildSemanticIndex();
    await Promise.resolve();
    application.cancelSemanticIndexRebuild();
    resolveRebuild(err("E310_INVALID_STATE", "语义索引重建已取消，旧索引保持不变"));

    await expect(rebuilding).resolves.toEqual(err("E310_INVALID_STATE", "语义索引重建已取消，旧索引保持不变"));
    expect(cancelSemanticIndexRebuild).toHaveBeenCalledOnce();
    expect(application.getSemanticIndexRebuildState()).toMatchObject({
      status: "cancelled",
      cancelRequested: false,
    });
  });

  it("exposes saved state without success notifications and ignores stale mutation completion", async () => {
    let resolveFirst!: (result: Result<void>) => void;
    const settingsStore = createSettingsStore();
    settingsStore.updateSettings
      .mockReturnValueOnce(new Promise<Result<void>>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(ok(undefined));
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
    });
    const states: string[] = [];
    application.subscribeSaveState((state) => states.push(state.status));

    const first = application.updateSettings({ enableAutoVerify: true });
    const second = application.updateSettings({ enableAutoVerify: false });
    resolveFirst(ok(undefined));
    await Promise.all([first, second]);

    expect(states).toEqual(["saving", "saving", "saved"]);
    expect(application.getSaveState()).toMatchObject({ status: "saved", operationId: 2 });
  });

  it("publishes a safe save-failed read model", async () => {
    const settingsStore = createSettingsStore();
    settingsStore.updateSettings.mockResolvedValueOnce({
      ok: false,
      error: { code: "E101_INVALID_INPUT", message: "设置校验失败", details: { raw: "hidden" } },
    });
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
    });

    await application.updateSettings({ enableAutoVerify: true });

    expect(application.getSaveState()).toEqual({
      status: "save-failed",
      operationId: 1,
      error: { code: "E101_INVALID_INPUT", message: "设置校验失败" },
    });
  });

  it("retries the last failed mutation in place", async () => {
    const settingsStore = createSettingsStore();
    settingsStore.updateSettings
      .mockResolvedValueOnce(err("E500_INTERNAL_ERROR", "保存设置失败"))
      .mockResolvedValueOnce(ok(undefined));
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
    });

    const partial = { enableAutoVerify: true };
    await expect(application.updateSettings(partial)).resolves.toEqual(
      err("E500_INTERNAL_ERROR", "保存设置失败"),
    );
    await expect(application.retryLastSave()).resolves.toEqual(ok(undefined));

    expect(settingsStore.updateSettings).toHaveBeenNthCalledWith(1, partial);
    expect(settingsStore.updateSettings).toHaveBeenNthCalledWith(2, partial);
    expect(application.getSaveState()).toMatchObject({ status: "saved", operationId: 2 });
  });

  it("reports a failed runtime-data reset through the save-state channel", async () => {
    const settingsStore = createSettingsStore();
    const resetRuntimeData = vi.fn(async () => err("E303_DISK_FULL", "磁盘空间不足"));
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
      resetRuntimeData,
    });
    const states: string[] = [];
    application.subscribeSaveState((state) => states.push(state.status));

    await expect(application.resetAndStart()).resolves.toEqual(err("E303_DISK_FULL", "磁盘空间不足"));

    expect(resetRuntimeData).toHaveBeenCalledOnce();
    expect(settingsStore.resetToDefaults).not.toHaveBeenCalled();
    expect(states).toEqual(["saving", "save-failed"]);
    expect(application.getSaveState()).toMatchObject({
      status: "save-failed",
      error: { code: "E303_DISK_FULL" },
    });
  });

  it("retries a failed runtime-data reset as one mutation", async () => {
    const settingsStore = createSettingsStore();
    const resetRuntimeData = vi.fn()
      .mockResolvedValueOnce(err("E500_INTERNAL_ERROR", "备份并重置运行数据失败"))
      .mockResolvedValueOnce(ok(undefined));
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
      resetRuntimeData,
    });

    await expect(application.resetAndStart()).resolves.toEqual(
      err("E500_INTERNAL_ERROR", "备份并重置运行数据失败"),
    );
    await expect(application.retryLastSave()).resolves.toEqual(ok(undefined));

    expect(resetRuntimeData).toHaveBeenCalledTimes(2);
    expect(settingsStore.resetToDefaults).toHaveBeenCalledOnce();
    expect(application.getSaveState()).toMatchObject({ status: "saved" });
  });

  it("clears runtime data before restoring default settings", async () => {
    const settingsStore = createSettingsStore();
    const order: string[] = [];
    const resetRuntimeData = vi.fn(async () => {
      order.push("cleared");
      return ok(undefined);
    });
    settingsStore.resetToDefaults.mockImplementation(async () => {
      order.push("defaults");
      return ok(undefined);
    });
    const application = new SettingsApplicationImpl({
      settingsStore,
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
      resetRuntimeData,
    });

    await expect(application.resetAndStart()).resolves.toEqual(ok(undefined));

    expect(order).toEqual(["cleared", "defaults"]);
    expect(application.getSaveState()).toMatchObject({ status: "saved" });
  });

  it("isolates save-state listener failures and reports them to the logger", async () => {
    const logger: ILogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const application = new SettingsApplicationImpl({
      settingsStore: createSettingsStore(),
      providerProbe: { probe: vi.fn() },
      ensureSemanticIndex: vi.fn(),
      logger,
    });
    application.subscribeSaveState(() => {
      throw new Error("view already destroyed");
    });

    await expect(application.updateSettings({ enableAutoVerify: true })).resolves.toEqual(ok(undefined));

    expect(logger.error).toHaveBeenCalledWith(
      "SettingsApplication",
      "保存状态监听器执行失败",
      expect.objectContaining({ message: "view already destroyed" }),
    );
    expect(application.getSaveState()).toMatchObject({ status: "saved" });
  });
});
