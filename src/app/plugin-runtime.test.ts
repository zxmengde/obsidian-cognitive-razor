import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { PluginRuntime } from "./plugin-runtime";
import { CreateOrchestrator } from "../core/create-orchestrator";
import { CruidCache } from "../core/cruid-cache";
import { DuplicateManager } from "../core/duplicate-manager";
import { DuplicateMergeService } from "../core/duplicate-merge-service";
import { ExpandOrchestrator } from "../core/expand-orchestrator";
import { I18n } from "../core/i18n";
import { ProviderManager } from "../core/provider-manager";
import { PromptManager } from "../core/prompt-manager";
import { SemanticIndexRebuilder } from "../core/semantic-index-rebuilder";
import { TaskQueue } from "../core/task-queue";
import { VectorIndex } from "../core/vector-index";
import { resolveVectorIndexConfig } from "../core/vector-config";
import { VerifyOrchestrator } from "../core/verify-orchestrator";
import { FileStorage } from "../data/file-storage";
import { Logger } from "../data/logger";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import type { SettingsStore } from "../data/settings-store";
import { err, ok } from "../types";

function createSettingsStore(): SettingsStore {
  return {
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    subscribe: () => () => undefined,
  } as unknown as SettingsStore;
}

function createRuntime(
  settingsStore: SettingsStore = createSettingsStore(),
  i18n: I18n = new I18n(),
): PluginRuntime {
  const app = { vault: {}, metadataCache: {} } as unknown as App;
  return new PluginRuntime(app, "plugin", settingsStore, i18n);
}

function stubSuccessfulServices() {
  const fileInitialize = vi.spyOn(FileStorage.prototype, "initialize").mockResolvedValue(ok(undefined));
  const fileRecovery = vi.spyOn(FileStorage.prototype, "recoverIncompleteWrites").mockResolvedValue(ok(0));
  const fileRead = vi.spyOn(FileStorage.prototype, "read").mockResolvedValue(err("E301_FILE_NOT_FOUND", "missing"));
  const fileList = vi.spyOn(FileStorage.prototype, "listFiles").mockResolvedValue(ok([]));
  const loggerInitialize = vi.spyOn(Logger.prototype, "initialize").mockResolvedValue(undefined);
  vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "info").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  const loggerSetLevel = vi.spyOn(Logger.prototype, "setLevel").mockImplementation(() => undefined);
  const loggerFlush = vi.spyOn(Logger.prototype, "flush").mockResolvedValue(undefined);
  const cacheStart = vi.spyOn(CruidCache.prototype, "start").mockImplementation(() => undefined);
  const cacheReady = vi.spyOn(CruidCache.prototype, "waitUntilReady").mockResolvedValue(undefined);
  const cacheDispose = vi.spyOn(CruidCache.prototype, "dispose").mockResolvedValue(undefined);
  const vectorLoad = vi.spyOn(VectorIndex.prototype, "load").mockResolvedValue(ok(undefined));
  const vectorDispose = vi.spyOn(VectorIndex.prototype, "dispose").mockResolvedValue(undefined);
  vi.spyOn(PromptManager.prototype, "preloadAllBaseComponents").mockResolvedValue(ok(undefined));
  vi.spyOn(PromptManager.prototype, "preloadAllTemplates").mockResolvedValue(ok(undefined));
  vi.spyOn(DuplicateManager.prototype, "initialize").mockResolvedValue(ok(undefined));
  const duplicateClear = vi.spyOn(DuplicateManager.prototype, "clearAll").mockResolvedValue(ok(0));
  const duplicateDispose = vi.spyOn(DuplicateManager.prototype, "dispose").mockResolvedValue(undefined);
  const mergeDispose = vi.spyOn(DuplicateMergeService.prototype, "dispose").mockResolvedValue(undefined);
  const semanticRebuilderDispose = vi.spyOn(SemanticIndexRebuilder.prototype, "dispose")
    .mockResolvedValue(undefined);
  vi.spyOn(TaskQueue.prototype, "setTaskRunner").mockImplementation(() => undefined);
  const queueDispose = vi.spyOn(TaskQueue.prototype, "dispose").mockResolvedValue(undefined);
  const createDispose = vi.spyOn(CreateOrchestrator.prototype, "dispose");
  const verifyDispose = vi.spyOn(VerifyOrchestrator.prototype, "dispose");
  const expandDispose = vi.spyOn(ExpandOrchestrator.prototype, "dispose");
  const providerDispose = vi.spyOn(ProviderManager.prototype, "dispose");
  return {
    fileInitialize,
    fileRecovery,
    fileRead,
    fileList,
    loggerInitialize,
    loggerFlush,
    loggerSetLevel,
    cacheStart,
    cacheReady,
    cacheDispose,
    vectorLoad,
    vectorDispose,
    duplicateDispose,
    mergeDispose,
    duplicateClear,
    semanticRebuilderDispose,
    queueDispose,
    createDispose,
    verifyDispose,
    expandDispose,
    providerDispose,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PluginRuntime lifecycle", () => {
  it("runs concurrent start requests through one initialization", async () => {
    const services = stubSuccessfulServices();
    let releaseInitialize!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    services.fileInitialize.mockImplementation(async () => {
      await gate;
      return ok(undefined);
    });
    const runtime = createRuntime();

    const first = runtime.start();
    const second = runtime.start();
    expect(services.fileInitialize).toHaveBeenCalledTimes(1);
    releaseInitialize();
    await Promise.all([first, second]);

    expect(runtime.isReady).toBe(true);
    expect(services.cacheStart).toHaveBeenCalledTimes(1);
    expect(services.vectorLoad).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it("does not publish a ready runtime before the initial cruid scan completes", async () => {
    const services = stubSuccessfulServices();
    let releaseCacheReady!: () => void;
    const cacheReady = new Promise<void>((resolve) => {
      releaseCacheReady = resolve;
    });
    services.cacheReady.mockReturnValue(cacheReady);
    const runtime = createRuntime();

    const starting = runtime.start();
    await vi.waitFor(() => expect(services.cacheStart).toHaveBeenCalledTimes(1));
    expect(runtime.isReady).toBe(false);
    expect(services.vectorLoad).not.toHaveBeenCalled();

    releaseCacheReady();
    await starting;

    expect(runtime.isReady).toBe(true);
    expect(services.vectorLoad).toHaveBeenCalledTimes(1);
    await runtime.dispose();
  });

  it("releases partial resources when initialization fails", async () => {
    const services = stubSuccessfulServices();
    services.vectorLoad.mockResolvedValue(err("E500_INTERNAL_ERROR", "broken index"));
    const runtime = createRuntime();

    await expect(runtime.start()).rejects.toThrow("加载向量索引失败");

    expect(runtime.isReady).toBe(false);
    expect(services.cacheDispose).toHaveBeenCalledTimes(1);
    expect(services.vectorDispose).toHaveBeenCalledTimes(1);
    expect(services.loggerFlush).toHaveBeenCalledTimes(1);
    await runtime.dispose();
    expect(services.cacheDispose).toHaveBeenCalledTimes(1);
  });

  it("stops before opening data services when atomic-write recovery fails", async () => {
    const services = stubSuccessfulServices();
    services.fileRecovery.mockResolvedValue(err("E500_INTERNAL_ERROR", "backup could not be restored"));
    const runtime = createRuntime();

    await expect(runtime.start()).rejects.toThrow("恢复未完成文件写入失败");

    expect(services.loggerInitialize).not.toHaveBeenCalled();
    expect(services.cacheStart).not.toHaveBeenCalled();
    expect(services.vectorLoad).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("does not continue creating services when disposed during initialization", async () => {
    const services = stubSuccessfulServices();
    let releaseInitialize!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    services.fileInitialize.mockImplementation(async () => {
      await gate;
      return ok(undefined);
    });
    const runtime = createRuntime();

    const starting = runtime.start();
    const disposing = runtime.dispose();
    releaseInitialize();

    await expect(starting).rejects.toThrow("正在释放");
    await disposing;
    expect(runtime.isReady).toBe(false);
    expect(services.cacheStart).not.toHaveBeenCalled();
    expect(services.vectorLoad).not.toHaveBeenCalled();
  });

  it("disposes every owned service exactly once", async () => {
    const services = stubSuccessfulServices();
    const runtime = createRuntime();
    await runtime.start();

    await Promise.all([runtime.dispose(), runtime.dispose()]);

    expect(services.createDispose).toHaveBeenCalledTimes(1);
    expect(services.verifyDispose).toHaveBeenCalledTimes(1);
    expect(services.expandDispose).toHaveBeenCalledTimes(1);
    expect(services.queueDispose).toHaveBeenCalledTimes(1);
    expect(services.duplicateDispose).toHaveBeenCalledTimes(1);
    expect(services.mergeDispose).toHaveBeenCalledTimes(1);
    expect(services.semanticRebuilderDispose).toHaveBeenCalledTimes(1);
    expect(services.cacheDispose).toHaveBeenCalledTimes(1);
    expect(services.vectorDispose).toHaveBeenCalledTimes(1);
    expect(services.providerDispose).toHaveBeenCalledTimes(1);
    expect(services.loggerFlush).toHaveBeenCalledTimes(1);
  });

  it("continues releasing later services when one disposer fails", async () => {
    const services = stubSuccessfulServices();
    services.createDispose.mockRejectedValueOnce(new Error("create cleanup failed"));
    const i18n = new I18n();
    const runtime = createRuntime(createSettingsStore(), i18n);
    await runtime.start();

    await expect(runtime.dispose()).resolves.toBeUndefined();

    expect(services.verifyDispose).toHaveBeenCalledTimes(1);
    expect(services.queueDispose).toHaveBeenCalledTimes(1);
    expect(services.duplicateDispose).toHaveBeenCalledTimes(1);
    expect(services.semanticRebuilderDispose).toHaveBeenCalledTimes(1);
    expect(services.vectorDispose).toHaveBeenCalledTimes(1);
    expect(services.providerDispose).toHaveBeenCalledTimes(1);
    expect(services.loggerFlush).toHaveBeenCalledTimes(1);
    expect((i18n as unknown as { logger: unknown }).logger).toBeNull();
  });

  it("reconciles embedding settings changed while the runtime is starting", async () => {
    const services = stubSuccessfulServices();
    let currentSettings = structuredClone(DEFAULT_SETTINGS);
    const settingsStore = {
      getSettings: () => structuredClone(currentSettings),
      subscribe: () => () => undefined,
    } as unknown as SettingsStore;
    let releaseTemplates!: () => void;
    const templateGate = new Promise<void>((resolve) => {
      releaseTemplates = resolve;
    });
    vi.spyOn(PromptManager.prototype, "preloadAllTemplates").mockImplementation(async () => {
      await templateGate;
      return ok(undefined);
    });
    const reconfigure = vi.spyOn(VectorIndex.prototype, "reconfigure").mockResolvedValue(ok(undefined));
    const runtime = createRuntime(settingsStore);

    const starting = runtime.start();
    await vi.waitFor(() => expect(services.vectorLoad).toHaveBeenCalledTimes(1));
    currentSettings = structuredClone(currentSettings);
    currentSettings.taskModels.index.model = "embed-v2";
    currentSettings.logLevel = "error";
    releaseTemplates();
    await starting;

    expect(runtime.isReady).toBe(true);
    const expectedVectorConfig = resolveVectorIndexConfig(currentSettings);
    expect(reconfigure).toHaveBeenCalledWith(
      "embed-v2",
      expectedVectorConfig.dimension,
      expectedVectorConfig.profile,
    );
    expect(services.duplicateClear).toHaveBeenCalledTimes(2);
    expect(services.loggerSetLevel).toHaveBeenCalledWith("error");
    await runtime.dispose();
  });

  it("只为实际 embedding 配置变化排队一次重配置", async () => {
    const services = stubSuccessfulServices();
    const reconfigure = vi.spyOn(VectorIndex.prototype, "reconfigure")
      .mockResolvedValue(ok(undefined));
    let settingsListener: ((settings: typeof DEFAULT_SETTINGS) => void) | undefined;
    const settingsStore = {
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      subscribe: (listener: (settings: typeof DEFAULT_SETTINGS) => void) => {
        settingsListener = listener;
        return () => { settingsListener = undefined; };
      },
    } as unknown as SettingsStore;
    const runtime = createRuntime(settingsStore);
    await runtime.start();

    const unrelated = structuredClone(DEFAULT_SETTINGS);
    unrelated.providerTimeoutMs += 10000;
    unrelated.logLevel = "debug";
    settingsListener!(unrelated);

    const changed = structuredClone(DEFAULT_SETTINGS);
    changed.taskModels.index.model = "embed-v2";
    settingsListener!(changed);
    const changedAgain = structuredClone(changed);
    changedAgain.providerTimeoutMs += 10000;
    settingsListener!(changedAgain);

    await vi.waitFor(() => expect(reconfigure).toHaveBeenCalledTimes(1));
    await runtime.dispose();

    expect(reconfigure).toHaveBeenCalledTimes(1);
    const expectedVectorConfig = resolveVectorIndexConfig(changedAgain);
    expect(reconfigure).toHaveBeenCalledWith(
      "embed-v2",
      expectedVectorConfig.dimension,
      expectedVectorConfig.profile,
    );
    expect(services.duplicateClear).toHaveBeenCalledTimes(2);
    expect(services.loggerSetLevel).toHaveBeenCalledWith("debug");
    expect(services.vectorDispose).toHaveBeenCalledTimes(1);
  });

  it("waits for delete cleanup before disposing the vector index", async () => {
    const services = stubSuccessfulServices();
    let releaseDelete!: (result: ReturnType<typeof ok<void>>) => void;
    const deletePromise = new Promise<ReturnType<typeof ok<void>>>((resolve) => {
      releaseDelete = resolve;
    });
    const vectorDelete = vi.spyOn(VectorIndex.prototype, "delete")
      .mockImplementation(() => deletePromise);
    const duplicateCleanup = vi.spyOn(DuplicateManager.prototype, "removePairsByNodeId")
      .mockResolvedValue(ok(0));
    const runtime = createRuntime();
    await runtime.start();

    const cache = (runtime as unknown as { cruidCache: {
      deleteListeners: Array<(event: { cruid: string; path: string }) => void>;
    } }).cruidCache;
    expect(cache.deleteListeners).toHaveLength(1);
    cache.deleteListeners[0]({ cruid: "node-1", path: "note.md" });

    let disposed = false;
    const disposing = runtime.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(vectorDelete).toHaveBeenCalledWith("node-1");
    expect(disposed).toBe(false);
    expect(services.vectorDispose).not.toHaveBeenCalled();

    releaseDelete(ok(undefined));
    await disposing;

    expect(disposed).toBe(true);
    expect(duplicateCleanup).toHaveBeenCalledWith("node-1");
    expect(services.vectorDispose).toHaveBeenCalledTimes(1);
  });
});
