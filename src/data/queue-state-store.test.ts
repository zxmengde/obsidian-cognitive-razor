import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../types";
import type { FileStorage } from "./file-storage";
import {
  QUEUE_STATE_PATH,
  QUEUE_STATE_VERSION,
  QueueStateStore,
} from "./queue-state-store";
import type { PersistedQueueState } from "./queue-state-store";

function storage(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fileStorage = {
    read: vi.fn(async (path: string) => {
      const value = files.get(path);
      return value === undefined ? err("E301_FILE_NOT_FOUND", "missing") : ok(value);
    }),
    atomicWrite: vi.fn(async (path: string, value: string) => {
      files.set(path, value);
      return ok(undefined);
    }),
    delete: vi.fn(async (path: string) => {
      files.delete(path);
      return ok(undefined);
    }),
  } as unknown as FileStorage;
  return { fileStorage, files };
}

const state: PersistedQueueState = {
  version: QUEUE_STATE_VERSION,
  paused: false,
  nextQueueOrder: 2,
  tasks: [],
};

describe("QueueStateStore", () => {
  it.each([{}, { upstreamStatus: 524 }, { requestTimeoutMs: 60000 }])("round-trips safe diagnostics and older errors without diagnostics (%j)", async (diagnostics) => {
    const { fileStorage } = storage();
    const store = new QueueStateStore(fileStorage);
    const next: PersistedQueueState = { ...state, tasks: [{ id: "synthetic", workflowId: "workflow", nodeId: "note", stageId: "verify", state: "interrupted", queueOrder: 1, createdAt: 1, updatedAt: 61000, startedAt: 1000, finishedAt: 61000, attempt: 1,
      error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN", kind: "uncertain", message: "safe", ...diagnostics },
    }] };
    expect((await store.save(next)).ok).toBe(true);
    expect(await new QueueStateStore(fileStorage).load()).toEqual(ok({ kind: "ready", state: next }));
  });

  it("preserves unknown stage records without blocking known tasks or overwriting unknown data", async () => {
    const unknown = { id: "old", workflowId: "old-workflow", nodeId: "old-node", stageId: "retired-stage", state: "pending", queueOrder: 1, createdAt: 1, updatedAt: 1, attempt: 1 };
    const { fileStorage, files } = storage({ [QUEUE_STATE_PATH]: JSON.stringify({ ...state, tasks: [unknown] }) });
    const store = new QueueStateStore(fileStorage);
    expect(await store.load()).toEqual(ok({ kind: "ready", state }));
    expect((await store.save({ ...state, paused: true })).ok).toBe(true);
    expect(JSON.parse(files.get(QUEUE_STATE_PATH)!).tasks).toEqual([unknown]);
  });
  it("loads only the current schema", async () => {
    const { fileStorage } = storage({ [QUEUE_STATE_PATH]: JSON.stringify(state) });
    const store = new QueueStateStore(fileStorage);

    await expect(store.load()).resolves.toEqual({ ok: true, value: { kind: "ready", state } });
  });

  it("quarantines a prior schema that still uses taskType", async () => {
    const legacy = {
      version: "6.0.0",
      paused: false,
      nextQueueOrder: 2,
      tasks: [{
        id: "legacy-task",
        workflowId: "legacy-workflow",
        nodeId: "legacy-node",
        taskType: "tag",
        stageId: "tag",
        state: "pending",
        queueOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        attempt: 1,
      }],
    };
    const { fileStorage } = storage({ [QUEUE_STATE_PATH]: JSON.stringify(legacy) });
    const store = new QueueStateStore(fileStorage);

    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: {
        kind: "quarantined",
        reason: "unsupported-schema",
      },
    });
  });

  it("treats a missing current queue state as empty", async () => {
    const { fileStorage } = storage();
    const store = new QueueStateStore(fileStorage);

    await expect(store.load()).resolves.toEqual({ ok: true, value: { kind: "empty" } });
  });

  it("owns atomic save", async () => {
    const { fileStorage, files } = storage();
    const store = new QueueStateStore(fileStorage);

    await expect(store.save(state)).resolves.toEqual(ok(undefined));
    expect(files.get(QUEUE_STATE_PATH)).toBe(JSON.stringify(state, null, 2));
    expect(files.has(QUEUE_STATE_PATH)).toBe(true);
  });
});

it("round-trips a result receipt without serializing response content and rejects malformed receipts", async () => {
  const item = { id: "receipt", workflowId: "w", nodeId: "n", stageId: "core" as const, state: "failed" as const, queueOrder: 1, createdAt: 1, updatedAt: 2, attempt: 1, resultPendingCommit: true as const };
  const { fileStorage } = storage(); const store = new QueueStateStore(fileStorage);
  const receipt = { ...state, tasks: [item] };
  expect((await store.save(receipt)).ok).toBe(true);
  expect(await new QueueStateStore(fileStorage).load()).toEqual(ok({ kind: "ready", state: receipt }));
  for (const invalid of [false, "true", 1, { response: "must not be persisted here" }]) {
    const f = storage({ [QUEUE_STATE_PATH]: JSON.stringify({ ...state, tasks: [{ ...item, resultPendingCommit: invalid }] }) });
    expect((await new QueueStateStore(f.fileStorage).load())).toMatchObject({ ok: true, value: { kind: "quarantined" } });
  }
});
