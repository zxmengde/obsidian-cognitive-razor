import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import type { SettingsStore } from "../data/settings-store";
import { err, ok } from "../types";
import type {
  EmbedRequest,
  EmbedResponse,
  ILogger,
  PluginSettings,
  Result,
} from "../types";
import type { CruidCache } from "./cruid-cache";
import type { DuplicateManager } from "./duplicate-manager";
import type { ProviderManager } from "./provider-manager";
import { SemanticIndexRebuilder } from "./semantic-index-rebuilder";
import type { VectorIndex } from "./vector-index";
import { resolveVectorIndexConfig } from "./vector-config";

function createFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function note(cruid: string, name = cruid): string {
  return `---\ncruid: ${cruid}\ntype: domain\nname: "${name}"\nstatus: draft\ncreated: 2026-08-17T00:00:00+08:00\nupdated: 2026-08-17T00:00:00+08:00\naliases: []\ntags: [test]\nparents: []\n---\n\n# ${name}\n\nBody`;
}

function noteWithStatus(cruid: string, status: "seed" | "draft" | "evergreen"): string {
  return note(cruid).replace("status: draft", `status: ${status}`);
}

function createSettings(): PluginSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers.embedding = {
    apiKey: "test-only",
    baseUrl: "https://embedding.example/v1",
    apiFormat: "disabled",
    enableWebSearch: false,
    embeddingApiFormat: "openai-embeddings",
    defaultChatModel: "",
    defaultEmbedModel: "embed-model",
    enabled: true,
  };
  settings.defaultProviderId = "embedding";
  settings.taskModels.index = {
    providerId: "embedding",
    model: "embed-model",
    embeddingDimension: 3,
  };
  return settings;
}

function createHarness(contents: Record<string, string>) {
  let settings = createSettings();
  let settingsListener: ((value: PluginSettings) => void) | undefined;
  const files = new Map(
    Object.keys(contents).map((path) => [path, createFile(path)]),
  );
  const cachedRead = vi.fn(async (file: TFile) => contents[file.path]);
  const read = vi.fn(async (file: TFile) => contents[file.path]);
  const app = {
    vault: {
      cachedRead,
      read,
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    },
  } as unknown as App;
  const entries = [...files.entries()].map(([path, file]) => ({
    cruid: file.basename,
    path,
    file,
  }));
  const cruidCache = {
    snapshotEntries: vi.fn(async () => entries),
    getFile: vi.fn((cruid: string) => entries.find((entry) => entry.cruid === cruid)?.file ?? null),
    waitUntilReady: vi.fn(async () => undefined),
  } as unknown as CruidCache;
  const settingsStore = {
    getSettings: () => structuredClone(settings),
    subscribe: (listener: (value: PluginSettings) => void) => {
      settingsListener = listener;
      return () => { settingsListener = undefined; };
    },
  } as unknown as SettingsStore;
  const config = resolveVectorIndexConfig(settings);
  const embed = vi.fn(async (
    _request: EmbedRequest,
    _signal?: AbortSignal,
  ): Promise<Result<EmbedResponse>> => ok({ embedding: [1, 0, 0], tokensUsed: 1 }));
  const replaceAll = vi.fn(async (vectors: unknown[]) => ok(vectors.length));
  const rebuildFromIndex = vi.fn(async (): Promise<Result<number>> => ok(2));
  const clearAll = vi.fn(async (): Promise<Result<number>> => ok(0));
  const refreshNode = vi.fn(async (): Promise<Result<number>> => ok(0));
  const indexed = new Set<string>();
  const upsert = vi.fn(async (entry: { uid: string }) => { indexed.add(entry.uid); return ok(undefined); });
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const service = new SemanticIndexRebuilder({
    app,
    cruidCache,
    providerManager: { embed } as unknown as ProviderManager,
    vectorIndex: {
      getEmbeddingProfile: () => config.profile,
      getEmbeddingModel: () => config.model,
      getEmbeddingDimension: () => config.dimension,
      replaceAll,
      has: (uid: string) => indexed.has(uid),
      upsert,
    } as unknown as VectorIndex,
    duplicateManager: { rebuildFromIndex, clearAll, refreshNode } as unknown as DuplicateManager,
    settingsStore,
    logger,
  });
  return {
    service,
    contents,
    cachedRead,
    embed,
    replaceAll,
    rebuildFromIndex,
    clearAll,
    refreshNode,
    upsert,
    indexed,
    setSettings(next: PluginSettings) {
      settings = structuredClone(next);
      settingsListener?.(structuredClone(next));
    },
    getSettings: () => structuredClone(settings),
  };
}

describe("SemanticIndexRebuilder", () => {
  it("generates every embedding before replacing the index and refreshing duplicates", async () => {
    const harness = createHarness({
      "notes/a.md": note("a", "Alpha"),
      "notes/b.md": note("b", "Beta"),
    });
    const phases: string[] = [];

    const result = await harness.service.rebuild((progress) => phases.push(progress.phase));

    expect(result).toEqual(ok({
      totalNotes: 2,
      indexed: 2,
      skipped: 0,
      duplicatePairs: 2,
      duplicateRefreshFailed: false,
    }));
    expect(harness.embed).toHaveBeenCalledTimes(2);
    expect(harness.replaceAll).toHaveBeenCalledOnce();
    expect(harness.rebuildFromIndex).toHaveBeenCalledOnce();
    expect(phases).toContain("scanning");
    expect(phases).toContain("embedding");
    expect(phases).toContain("committing");
    expect(phases).toContain("duplicates");
    expect(harness.embed.mock.calls.every(([request]) => request.dimensions === 3)).toBe(true);
  });


  it("keeps the old index when every embedding request fails", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    harness.embed.mockResolvedValue(err("E204_PROVIDER_ERROR", "offline"));

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "E204_PROVIDER_ERROR" },
    });
    expect(harness.replaceAll).not.toHaveBeenCalled();
    expect(harness.rebuildFromIndex).not.toHaveBeenCalled();
  });

  it("keeps the old index when every cached note is invalid", async () => {
    const harness = createHarness({ "notes/a.md": "not a Cognitive Razor note" });

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
    expect(harness.embed).not.toHaveBeenCalled();
    expect(harness.replaceAll).not.toHaveBeenCalled();
  });

  it("commits successful notes and reports partial embedding failures", async () => {
    const harness = createHarness({
      "notes/a.md": note("a"),
      "notes/b.md": note("b"),
    });
    harness.embed
      .mockResolvedValueOnce(ok({ embedding: [1, 0, 0] }))
      .mockResolvedValueOnce(err("E204_PROVIDER_ERROR", "offline"));

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({ ok: true, value: { indexed: 1, skipped: 1 } });
    expect(harness.replaceAll).toHaveBeenCalledWith([
      { uid: "a", type: "domain", embedding: [1, 0, 0] },
    ]);
  });

  it("does not commit when a note changes after embeddings are generated", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    harness.embed.mockImplementation(async () => {
      harness.contents["notes/a.md"] = `${note("a")}\nchanged`;
      return ok({ embedding: [1, 0, 0] });
    });

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({ ok: false, error: { code: "E320_TASK_CONFLICT" } });
    expect(harness.replaceAll).not.toHaveBeenCalled();
  });

  it("cancels and preserves the old index when embedding settings change", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    harness.embed.mockImplementation(async (_request, signal?: AbortSignal) => {
      const changed = harness.getSettings();
      changed.taskModels.index.model = "other-model";
      harness.setSettings(changed);
      expect(signal?.aborted).toBe(true);
      return err("E310_INVALID_STATE", "cancelled");
    });

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    expect(harness.replaceAll).not.toHaveBeenCalled();
  });

  it("honors explicit cancellation and rejects a concurrent rebuild", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    harness.embed.mockImplementation(async (_request, signal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve(err("E310_INVALID_STATE", "cancelled")), {
        once: true,
      });
    }));

    const rebuilding = harness.service.rebuild();
    await vi.waitFor(() => expect(harness.embed).toHaveBeenCalledOnce());
    expect(await harness.service.rebuild()).toMatchObject({
      ok: false,
      error: { code: "E320_TASK_CONFLICT" },
    });
    harness.service.cancel();

    expect(await rebuilding).toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    expect(harness.replaceAll).not.toHaveBeenCalled();
  });

  it("reports duplicate refresh failure without rolling back a committed index", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    harness.rebuildFromIndex.mockResolvedValue(err("E303_DISK_FULL", "disk full"));

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({
      ok: true,
      value: {
        indexed: 1,
        duplicateRefreshFailed: true,
        duplicatePairs: undefined,
      },
    });
    expect(harness.replaceAll).toHaveBeenCalledOnce();
  });

  it("clears stale duplicate state instead of recomputing when detection is disabled", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    const settings = harness.getSettings();
    settings.enableDuplicateDetection = false;
    harness.setSettings(settings);

    const result = await harness.service.rebuild();

    expect(result).toMatchObject({
      ok: true,
      value: { indexed: 1, duplicateRefreshFailed: false, duplicatePairs: undefined },
    });
    expect(harness.clearAll).toHaveBeenCalledOnce();
    expect(harness.rebuildFromIndex).not.toHaveBeenCalled();
  });

  it("waits for an active request during disposal and rejects future rebuilds", async () => {
    const harness = createHarness({ "notes/a.md": note("a") });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    harness.embed.mockImplementation(async () => {
      await gate;
      return err("E310_INVALID_STATE", "cancelled");
    });

    const rebuilding = harness.service.rebuild();
    await vi.waitFor(() => expect(harness.embed).toHaveBeenCalledOnce());
    let disposed = false;
    const disposal = harness.service.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    release();
    await Promise.all([rebuilding, disposal]);

    expect(await harness.service.rebuild()).toMatchObject({
      ok: false,
      error: { code: "E310_INVALID_STATE" },
    });
  });

  it("only lists draft and evergreen notes as eligible and reports missing vectors", async () => {
    const harness = createHarness({
      "notes/seed.md": noteWithStatus("seed", "seed"),
      "notes/draft.md": noteWithStatus("draft", "draft"),
      "notes/evergreen.md": noteWithStatus("evergreen", "evergreen"),
    });
    harness.indexed.add("evergreen");
    await expect(harness.service.scanStatus()).resolves.toEqual(ok({
      eligible: 2,
      indexed: 1,
      missing: 1,
      missingNotes: [{ cruid: "draft", name: "draft", path: "notes/draft.md", type: "domain", status: "draft" }],
    }));
  });

  it("重新生成单篇向量后只刷新该节点的重复关系", async () => {
    const harness = createHarness({ "notes/a.md": note("a", "Alpha") });

    await expect(harness.service.embedOne("a")).resolves.toEqual(ok({ indexed: 1, failed: 0 }));
    expect(harness.embed).toHaveBeenCalledOnce();
    expect(harness.upsert).toHaveBeenCalledWith({ uid: "a", type: "domain", embedding: [1, 0, 0] });
    expect(harness.refreshNode).toHaveBeenCalledWith("a", "domain", [1, 0, 0]);
    expect(harness.rebuildFromIndex).not.toHaveBeenCalled();
  });

  it("单篇嵌入期间笔记发生变化时不写入过期向量", async () => {
    const harness = createHarness({ "notes/a.md": note("a", "Alpha") });
    harness.embed.mockImplementation(async () => {
      harness.contents["notes/a.md"] = `${note("a", "Alpha")}\nchanged`;
      return ok({ embedding: [1, 0, 0] });
    });

    await expect(harness.service.embedOne("a")).resolves.toMatchObject({
      ok: false,
      error: { code: "E320_TASK_CONFLICT" },
    });
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  it("补齐缺失向量后为每个新增节点刷新重复关系，不触发全库重算", async () => {
    const harness = createHarness({
      "notes/a.md": note("a", "Alpha"),
      "notes/b.md": note("b", "Beta"),
    });

    await expect(harness.service.embedMissing()).resolves.toEqual(
      ok({ eligible: 2, indexed: 2, skipped: 0, failed: 0 }),
    );

    expect(harness.refreshNode.mock.calls).toEqual([
      ["a", "domain", [1, 0, 0]],
      ["b", "domain", [1, 0, 0]],
    ]);
    expect(harness.rebuildFromIndex).not.toHaveBeenCalled();
  });

  it("关闭重复检测时补齐缺失向量不会刷新重复关系", async () => {
    const harness = createHarness({ "notes/a.md": note("a", "Alpha") });
    const settings = harness.getSettings();
    settings.enableDuplicateDetection = false;
    harness.setSettings(settings);

    await expect(harness.service.embedMissing()).resolves.toEqual(
      ok({ eligible: 1, indexed: 1, skipped: 0, failed: 0 }),
    );

    expect(harness.refreshNode).not.toHaveBeenCalled();
  });

  it("补齐缺失向量期间嵌入配置变化时中止且不写入新配置向量", async () => {
    const harness = createHarness({
      "notes/a.md": note("a", "Alpha"),
      "notes/b.md": note("b", "Beta"),
    });
    harness.embed.mockImplementation(async () => {
      const changed = harness.getSettings();
      changed.taskModels.index.model = "other-model";
      harness.setSettings(changed);
      return ok({ embedding: [1, 0, 0] });
    });

    const result = await harness.service.embedMissing();

    expect(result).toMatchObject({ ok: false, error: { code: "E320_TASK_CONFLICT" } });
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  it("补齐缺失向量期间笔记发生变化时跳过该笔记而不写入过期向量", async () => {
    const harness = createHarness({
      "notes/a.md": note("a", "Alpha"),
      "notes/b.md": note("b", "Beta"),
    });
    harness.embed.mockImplementation(async () => {
      harness.contents["notes/a.md"] = `${note("a", "Alpha")}\nchanged`;
      return ok({ embedding: [1, 0, 0] });
    });

    const result = await harness.service.embedMissing();

    expect(result).toMatchObject({ ok: true, value: { indexed: 1, failed: 1 } });
    expect(harness.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ uid: "a" }),
    );
    expect(harness.upsert).toHaveBeenCalledWith({ uid: "b", type: "domain", embedding: [1, 0, 0] });
  });

  it("单篇向量化只读取目标笔记文件而不扫描全库", async () => {
    const harness = createHarness({
      "notes/a.md": note("a", "Alpha"),
      "notes/b.md": note("b", "Beta"),
      "notes/c.md": note("c", "Gamma"),
    });

    await expect(harness.service.embedOne("b")).resolves.toEqual(ok({ indexed: 1, failed: 0 }));

    expect(harness.cachedRead).toHaveBeenCalledTimes(1);
    expect(harness.cachedRead).toHaveBeenCalledWith(
      expect.objectContaining({ path: "notes/b.md" }),
    );
    expect(harness.upsert).toHaveBeenCalledWith({ uid: "b", type: "domain", embedding: [1, 0, 0] });
  });
});


describe("single-note vector success is independent of duplicate refresh", () => {
  it.each(["error-result", "exception"])("does not report an already written vector missing after %s", async (failure) => {
    const harness = createHarness({ "notes/a.md": note("a", "Alpha") });
    if (failure === "exception") harness.refreshNode.mockRejectedValue(new Error("duplicate storage unavailable"));
    else harness.refreshNode.mockResolvedValue(err("E303_DISK_FULL", "duplicate storage full"));

    await expect(harness.service.embedOne("a")).resolves.toEqual(ok({ indexed: 1, failed: 0 }));
    expect(harness.embed).toHaveBeenCalledOnce();
    expect(harness.upsert).toHaveBeenCalledOnce();
    expect(harness.indexed.has("a")).toBe(true);
  });
});
