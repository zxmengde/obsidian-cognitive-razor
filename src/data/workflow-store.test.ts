import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../types";
import type { ILogger, WorkflowArtifact } from "../types";
import type { FileStorage } from "./file-storage";
import { WorkflowStore } from "./workflow-store";

function logger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function artifact(): WorkflowArtifact {
  return {
    version: "7.0.0", workflowId: "workflow-test", kind: "create", state: "active", nodeId: "node-1",
    type: "domain", filePath: "1-领域/Test.md", noteTitle: "Test", parents: [],
    concept: { name: { chinese: "测试", english: "Test" }, coreDefinition: "definition" }, autoVerify: false,
    accumulated: { core: "value" }, contentSnapshot: "snapshot", noteCreated: true, appliedStageIds: [],
    createdAt: 1, updatedAt: 1,
  };
}

function storage(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fileStorage = {
    listFiles: vi.fn(async () => ok([...files.keys()])),
    read: vi.fn(async (path: string) => files.has(path) ? ok(files.get(path)!) : { ok: false, error: { code: "E301_FILE_NOT_FOUND", message: "missing" } }),
    exists: vi.fn(async (path: string) => files.has(path)),
    atomicWrite: vi.fn(async (path: string, content: string) => { files.set(path, content); return ok(undefined); }),
    delete: vi.fn(async (path: string) => { files.delete(path); return ok(undefined); }),
  } as unknown as FileStorage;
  return { fileStorage, files };
}

describe("WorkflowStore", () => {
  it("never publishes or inherits a failed concurrent patch", async () => {
    const { fileStorage, files } = storage();
    const store = new WorkflowStore(fileStorage, logger());
    await store.create(artifact());
    vi.mocked(fileStorage.atomicWrite).mockResolvedValueOnce(err("E303_DISK_FULL", "full"));
    const first = store.update("workflow-test", { accumulated: { lost: "not durable" } });
    const second = store.update("workflow-test", { state: "failed" });
    expect(store.get("workflow-test")?.accumulated).toEqual({ core: "value" });
    expect(await first).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect((await second).ok).toBe(true);
    expect(store.get("workflow-test")?.accumulated).toEqual({ core: "value" });
    expect(JSON.parse(files.get("data/workflows/workflow-test.json")!).accumulated).toEqual({ core: "value" });
  });

  it("leaves memory and disk at the last committed version after two failed writes", async () => {
    const { fileStorage, files } = storage();
    const store = new WorkflowStore(fileStorage, logger());
    await store.create(artifact());
    const before = files.get("data/workflows/workflow-test.json");
    vi.mocked(fileStorage.atomicWrite).mockResolvedValue(err("E303_DISK_FULL", "full"));
    await Promise.all([store.update("workflow-test", { state: "failed" }), store.update("workflow-test", { state: "cancelled" })]);
    expect(store.get("workflow-test")).toEqual(artifact());
    expect(files.get("data/workflows/workflow-test.json")).toBe(before);
  });

  it("serializes removal and recreation of the same ID", async () => {
    const { fileStorage } = storage();
    const store = new WorkflowStore(fileStorage, logger());
    await store.create(artifact());
    const results = await Promise.all([store.remove("workflow-test"), store.create({ ...artifact(), noteTitle: "New" })]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(store.get("workflow-test")?.noteTitle).toBe("New");
  });
  it("persists the compact 7.0.0 artifact without model snapshots or expectedContent", async () => {
    const { fileStorage, files } = storage();
    const store = new WorkflowStore(fileStorage, logger());
    await expect(store.create(artifact())).resolves.toEqual(ok(undefined));
    const persisted = JSON.parse(files.get("data/workflows/workflow-test.json")!);
    expect(persisted.version).toBe("7.0.0");
    expect(persisted).not.toHaveProperty("modelSnapshots");
    expect(persisted).not.toHaveProperty("pendingStageResult");
  });

  it("accepts a bounded compact source package", async () => {
    const { fileStorage, files } = storage();
    const store = new WorkflowStore(fileStorage, logger());
    const result = await store.create({
      ...artifact(),
      sources: { items: [{ url: "https://example.test/source", title: "Source" }] },
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(files.get("data/workflows/workflow-test.json")!).sources.items).toHaveLength(1);
  });

  it("skips old or malformed artifacts without creating a recovery file", async () => {
    const old = { ...artifact(), version: "6.0.0", modelSnapshots: {} };
    const { fileStorage } = storage({ "data/workflows/workflow-test.json": JSON.stringify(old) });
    const log = logger();
    const store = new WorkflowStore(fileStorage, log);
    await expect(store.initialize()).resolves.toEqual(ok(undefined));
    expect(store.list()).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it("writes each update from its call-time snapshot", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const { fileStorage, files } = storage();
    fileStorage.atomicWrite = vi.fn(async (path: string, content: string) => {
      writes.push({ path, content });
      await Promise.resolve();
      files.set(path, content);
      return ok(undefined);
    });
    const store = new WorkflowStore(fileStorage, logger());
    await store.create(artifact());

    const first = store.update("workflow-test", { accumulated: { phase: "first" } });
    const second = store.update("workflow-test", { accumulated: { phase: "second" } });
    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);

    expect(JSON.parse(writes.at(-2)!.content).accumulated).toEqual({ phase: "first" });
    expect(JSON.parse(writes.at(-1)!.content).accumulated).toEqual({ phase: "second" });
    expect(JSON.parse(files.get("data/workflows/workflow-test.json")!).accumulated).toEqual({ phase: "second" });
  });

  it("does not roll back a newer update when an earlier write fails", async () => {
    const { fileStorage, files } = storage();
    let writeCount = 0;
    fileStorage.atomicWrite = vi.fn(async (path: string, content: string) => {
      writeCount += 1;
      if (writeCount === 2) return { ok: false, error: { code: "E303_DISK_FULL", message: "full" } } as const;
      files.set(path, content);
      return ok(undefined);
    });
    const store = new WorkflowStore(fileStorage, logger());
    await store.create(artifact());

    const first = store.update("workflow-test", { accumulated: { phase: "first" } });
    const second = store.update("workflow-test", { accumulated: { phase: "second" } });
    await expect(first).resolves.toMatchObject({ ok: false });
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(store.get("workflow-test")?.accumulated).toEqual({ phase: "second" });
  });
});
