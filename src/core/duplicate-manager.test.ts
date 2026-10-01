import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../types";
import type { DuplicatePairsStore, ILogger } from "../types";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import { DuplicateManager } from "./duplicate-manager";
import type { VectorIndex } from "./vector-index";

const STORE_PATH = "data/duplicate-pairs.json";

function createLogger(): ILogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createStorage(
  files: Map<string, string>,
  failWrites: { value: boolean } = { value: false },
): FileStorage {
  return {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => ok(files.get(path) ?? ""),
    atomicWrite: vi.fn(async (path: string, content: string) => {
      if (failWrites.value) {
        return err("E303_DISK_FULL", "disk full");
      }
      files.set(path, content);
      return ok(undefined);
    }),
  } as unknown as FileStorage;
}

function createManager(
  storage: FileStorage,
  vectorIndex: VectorIndex = {
    getVectorsByType: async () => ok([]),
  } as unknown as VectorIndex,
  settingsStore: SettingsStore = {
    getSettings: () => ({ similarityThreshold: 0.85 }),
    subscribe: () => () => undefined,
  } as unknown as SettingsStore,
): DuplicateManager {
  return new DuplicateManager(
    vectorIndex,
    storage,
    createLogger(),
    settingsStore,
    STORE_PATH,
  );
}

function currentStore(): DuplicatePairsStore {
  return {
    version: "2.0.0",
    pairs: [
      {
        id: "a--b",
        nodeIdA: "a",
        nodeIdB: "b",
        type: "entity",
        similarity: 0.92,
        status: "pending",
      },
      {
        id: "c--d",
        nodeIdA: "c",
        nodeIdB: "d",
        type: "entity",
        similarity: 0.9,
        status: "dismissed",
      },
    ],
  };
}

describe("DuplicateManager current store contract", () => {
  it("loads previously saved rounding overshoot without losing other decisions", async () => {
    const saved = currentStore();
    saved.pairs[0].similarity = 1.0000000000000002;
    const storage = createStorage(new Map([[STORE_PATH, JSON.stringify(saved)]]));
    const manager = createManager(storage);
    expect((await manager.initialize()).ok).toBe(true);
    expect(manager.getPair("a--b")?.similarity).toBe(1);
    expect(manager.getPair("c--d")?.status).toBe("dismissed");
    await manager.dispose();
  });

  it.each(["rebuild", "refresh"])("preserves duplicate decisions after reloading rounded cosine scores (%s)", async (operation) => {
    const files = new Map<string, string>();
    const storage = createStorage(files);
    const embedding = [0.5773502691896258, 0.5773502691896258, 0.5773502691896258];
    const vectors = {
      getVectorsByType: async (type: string) => ok(type === "entity"
        ? ["a", "b"].map((id) => ({ id, type, embedding })) : []),
    } as unknown as VectorIndex;
    const manager = createManager(storage, vectors);
    expect((await manager.initialize()).ok).toBe(true);
    expect((await (operation === "rebuild"
      ? manager.rebuildFromIndex()
      : manager.refreshNode("a", "entity", [1, 1, 1]))).ok).toBe(true);
    expect((await manager.markAsNonDuplicate("a--b")).ok).toBe(true);
    await manager.dispose();

    const reloaded = createManager(storage, vectors);
    expect((await reloaded.initialize()).ok).toBe(true);
    expect(reloaded.getPair("a--b")).toMatchObject({ status: "dismissed", similarity: 1 });
    await reloaded.dispose();
  });

  it("replaces legacy store shapes with an empty v2 store", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify({
      version: "1.0.0",
      pairs: [{ id: "legacy", noteA: { nodeId: "a" }, noteB: { nodeId: "b" } }],
      dismissedPairs: [],
    })]]);
    const manager = createManager(createStorage(files));

    expect((await manager.initialize()).ok).toBe(true);
    expect(manager.getPendingPairs()).toEqual([]);
    expect(JSON.parse(files.get(STORE_PATH) as string)).toEqual({ version: "2.0.0", pairs: [] });
  });

  it("publishes only pending pairs and persists dismissals", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const manager = createManager(createStorage(files));
    expect((await manager.initialize()).ok).toBe(true);

    const snapshots: string[][] = [];
    manager.subscribe((pairs) => snapshots.push(pairs.map((pair) => pair.id)));
    expect(snapshots).toEqual([["a--b"]]);

    expect((await manager.markAsNonDuplicate("a--b")).ok).toBe(true);
    expect(snapshots.at(-1)).toEqual([]);
    expect(manager.getPendingPairs()).toEqual([]);
    const persisted = JSON.parse(files.get(STORE_PATH) as string) as DuplicatePairsStore;
    expect(persisted.pairs.map((pair) => pair.status)).toEqual(["dismissed", "dismissed"]);
  });

  it("refreshes visible pending pairs when the similarity threshold changes", async () => {
    let threshold = 0.85;
    let settingsListener: ((settings: { similarityThreshold: number }) => void) | undefined;
    const unsubscribe = vi.fn();
    const settingsStore = {
      getSettings: () => ({ similarityThreshold: threshold }),
      subscribe: (listener: (settings: { similarityThreshold: number }) => void) => {
        settingsListener = listener;
        return unsubscribe;
      },
    } as unknown as SettingsStore;
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const manager = createManager(createStorage(files), undefined, settingsStore);
    expect((await manager.initialize()).ok).toBe(true);
    const snapshots: string[][] = [];
    manager.subscribe((pairs) => snapshots.push(pairs.map((pair) => pair.id)));

    threshold = 0.95;
    settingsListener?.({ similarityThreshold: threshold });
    expect(manager.getPendingPairs()).toEqual([]);
    expect(snapshots.at(-1)).toEqual([]);

    threshold = 0.85;
    settingsListener?.({ similarityThreshold: threshold });
    expect(manager.getPendingPairs().map((pair) => pair.id)).toEqual(["a--b"]);
    expect(snapshots.at(-1)).toEqual(["a--b"]);

    await manager.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rolls back an in-memory dismissal when persistence fails", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const failWrites = { value: false };
    const manager = createManager(createStorage(files, failWrites));
    expect((await manager.initialize()).ok).toBe(true);

    failWrites.value = true;
    const result = await manager.markAsNonDuplicate("a--b");

    expect(result.ok).toBe(false);
    expect(manager.getPendingPairs().map((pair) => pair.id)).toEqual(["a--b"]);
    expect((JSON.parse(files.get(STORE_PATH) as string) as DuplicatePairsStore).pairs[0].status).toBe("pending");
  });

  it("clears stale pairs atomically and rolls back when persistence fails", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const failWrites = { value: false };
    const manager = createManager(createStorage(files, failWrites));
    expect((await manager.initialize()).ok).toBe(true);

    failWrites.value = true;
    expect(await manager.clearAll()).toMatchObject({
      ok: false,
      error: { code: "E303_DISK_FULL" },
    });
    expect(manager.getPendingPairs().map((pair) => pair.id)).toEqual(["a--b"]);

    failWrites.value = false;
    expect(await manager.clearAll()).toEqual(ok(2));
    expect(manager.getPendingPairs()).toEqual([]);
    expect(JSON.parse(files.get(STORE_PATH) as string)).toEqual({ version: "2.0.0", pairs: [] });
    expect(await manager.clearAll()).toEqual(ok(0));
  });

  it("does not overwrite the store when an existing file is temporarily unreadable", async () => {
    const atomicWrite = vi.fn(async () => ok(undefined));
    const storage = {
      exists: vi.fn(async () => true),
      read: vi.fn(async () => err("E302_PERMISSION_DENIED", "temporarily unreadable")),
      atomicWrite,
    } as unknown as FileStorage;
    const manager = createManager(storage);

    const result = await manager.initialize();

    expect(result).toMatchObject({ ok: false, error: { code: "E302_PERMISSION_DENIED" } });
    expect(atomicWrite).not.toHaveBeenCalled();
  });

  it("runs concurrent same-type refreshes without silently skipping either request", async () => {
    const files = new Map<string, string>();
    const getVectorsByType = vi.fn(async () => ok([
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [1, 0] },
    ]));
    const manager = createManager(createStorage(files), { getVectorsByType } as unknown as VectorIndex);
    expect((await manager.initialize()).ok).toBe(true);

    const [first, second] = await Promise.all([
      manager.refreshNode("a", "entity", [1, 0]),
      manager.refreshNode("b", "entity", [1, 0]),
    ]);

    expect(first).toEqual(ok(1));
    expect(second).toEqual(ok(1));
    expect(getVectorsByType).toHaveBeenCalledTimes(2);
    expect(manager.getPendingPairs().map((pair) => pair.id)).toEqual(["a--b"]);
  });

  it("rebuilds all duplicate pairs and preserves still-valid dismissals", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const vectorsByType = {
      entity: [
        { id: "c", embedding: [1, 0] },
        { id: "d", embedding: [0.9, Math.sqrt(0.19)] },
        { id: "e", embedding: [1, 0] },
      ],
    };
    const getVectorsByType = vi.fn(async (type: keyof typeof vectorsByType) => (
      ok(vectorsByType[type] ?? [])
    ));
    const manager = createManager(
      createStorage(files),
      { getVectorsByType } as unknown as VectorIndex,
    );
    expect((await manager.initialize()).ok).toBe(true);

    const result = await manager.rebuildFromIndex();

    expect(result).toEqual(ok(3));
    expect(getVectorsByType).toHaveBeenCalledTimes(5);
    const persisted = JSON.parse(files.get(STORE_PATH) as string) as DuplicatePairsStore;
    expect(persisted.pairs.map((pair) => [pair.id, pair.status])).toEqual([
      ["c--d", "dismissed"],
      ["c--e", "pending"],
      ["d--e", "pending"],
    ]);
  });

  it("刷新单个节点时只重算其关系并保留仍命中的忽略状态", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify({
      version: "2.0.0",
      pairs: [{
        id: "a--b",
        nodeIdA: "a",
        nodeIdB: "b",
        type: "entity",
        similarity: 0.9,
        status: "dismissed",
      }],
    } satisfies DuplicatePairsStore)]]);
    const manager = createManager(
      createStorage(files),
      {
        getVectorsByType: async () => ok([
          { id: "a", embedding: [1, 0] },
          { id: "b", embedding: [1, 0] },
          { id: "c", embedding: [0, 1] },
        ]),
      } as unknown as VectorIndex,
    );
    expect((await manager.initialize()).ok).toBe(true);

    await expect(manager.refreshNode("a", "entity", [1, 0])).resolves.toEqual(ok(1));
    expect(manager.getPendingPairs()).toEqual([]);
    const persisted = JSON.parse(files.get(STORE_PATH) as string) as DuplicatePairsStore;
    expect(persisted.pairs).toEqual([expect.objectContaining({ id: "a--b", status: "dismissed" })]);
  });

  it("rolls back the rebuilt duplicate view when persistence fails", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const failWrites = { value: false };
    const manager = createManager(
      createStorage(files, failWrites),
      {
        getVectorsByType: async (type: string) => ok(type === "entity"
          ? [{ id: "x", embedding: [1, 0] }, { id: "y", embedding: [1, 0] }]
          : []),
      } as unknown as VectorIndex,
    );
    expect((await manager.initialize()).ok).toBe(true);
    failWrites.value = true;

    const result = await manager.rebuildFromIndex();

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(manager.getPendingPairs().map((pair) => pair.id)).toEqual(["a--b"]);
  });

  it("重复初始化不会重读状态，释放后拒绝重新初始化", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const storage = createStorage(files);
    const exists = vi.spyOn(storage, "exists");
    const manager = createManager(storage);

    expect((await manager.initialize()).ok).toBe(true);
    expect((await manager.initialize()).ok).toBe(true);
    expect(exists).toHaveBeenCalledTimes(1);

    await manager.dispose();
    const result = await manager.initialize();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("E310_INVALID_STATE");
    }
  });

  it("并发初始化共享一次读取，并在初始化期间卸载时停止恢复", async () => {
    const files = new Map<string, string>([[STORE_PATH, JSON.stringify(currentStore())]]);
    const storage = createStorage(files);
    let releaseExists!: () => void;
    const existsGate = new Promise<void>((resolve) => { releaseExists = resolve; });
    const exists = vi.spyOn(storage, "exists").mockImplementation(async () => {
      await existsGate;
      return true;
    });
    const manager = createManager(storage);

    const first = manager.initialize();
    const second = manager.initialize();
    expect(second).toBe(first);

    const disposal = manager.dispose();
    releaseExists();
    const [result] = await Promise.all([first, disposal]);

    expect(result.ok).toBe(false);
    expect(exists).toHaveBeenCalledTimes(1);
    expect(manager.getPendingPairs()).toEqual([]);
  });
});
