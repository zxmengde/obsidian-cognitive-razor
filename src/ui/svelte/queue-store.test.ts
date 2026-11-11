import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { build, transform } from "esbuild";
import { compileModule } from "svelte/compiler";
import type { QueueApplication } from "../../app/workbench-application";
import type { QueueEventListener, QueueStatus, TaskRecord } from "../../types";

type Store = { status: QueueStatus; tasks: TaskRecord[]; destroy(): void };
let bridge: { createQueueStore: (queue: QueueApplication) => Store; flushSync: () => void; effectRoot: (fn: () => void) => () => void; effect: (fn: () => void) => void };
beforeAll(async () => {
  const result = await build({
    stdin: { contents: 'export { createQueueStore } from "./src/ui/bridge/reactive.svelte.ts"; export { flushSync } from "svelte"; export * from "queue-store-probe";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "QueueStoreTest",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { "@": "./src" },
    plugins: [{ name: "runes", setup(builder) {
      builder.onResolve({ filter: /^queue-store-probe$/ }, () => ({ path: "probe.svelte.js", namespace: "probe" }));
      builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({ resolveDir: process.cwd(), loader: "js", contents: compileModule(
        "export function effectRoot(fn) { return $effect.root(fn); } export function effect(fn) { $effect(fn); }", { filename: "probe.svelte.js" }).js.code }));
      builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
        const source = await transform(await readFile(path, "utf8"), { loader: "ts" });
        return { contents: compileModule(source.code, { filename: path }).js.code, loader: "js" };
      });
    } }],
  });
  bridge = new Function(`${result.outputFiles[0].text}; return QueueStoreTest;`)();
});

function task(id: string, state: TaskRecord["state"], updatedAt = 1): TaskRecord {
  return { id, nodeId: id, stageId: "core", payload: {}, state, createdAt: 1, updatedAt, attempt: 1 } as TaskRecord;
}

describe("queue store", () => {
  it("keeps unchanged tasks and status by identity so only the changed row recomputes", () => {
    let tasks = [task("a", "pending"), task("b", "completed"), task("c", "completed")];
    const status: QueueStatus = { paused: false, total: 3, pending: 1, running: 0, completed: 2, failed: 0, cancelled: 0, interrupted: 0 };
    let listener: QueueEventListener = () => undefined;
    const queue = {
      getSnapshot: () => structuredClone({ status, tasks }),
      subscribe: (callback: QueueEventListener) => { listener = callback; return () => { listener = () => undefined; }; },
    } as unknown as QueueApplication;
    const store = bridge.createQueueStore(queue);
    const runs = { status: 0, list: 0 };
    const stop = bridge.effectRoot(() => {
      bridge.effect(() => { void store.status; runs.status++; });
      bridge.effect(() => { void store.tasks; runs.list++; });
    });
    try {
      bridge.flushSync();
      const [a, b, c] = store.tasks;
      const initialStatus = store.status;

      listener({ type: "task-started", taskId: "a" });
      bridge.flushSync();
      expect(store.tasks[0]).toBe(a);
      expect(store.status).toBe(initialStatus);
      expect(runs).toEqual({ status: 1, list: 1 });

      tasks = [task("a", "running", 2), tasks[1], tasks[2]];
      listener({ type: "task-started", taskId: "a" });
      bridge.flushSync();
      expect(store.tasks[0]).not.toBe(a);
      expect(store.tasks[0].state).toBe("running");
      expect(store.tasks[1]).toBe(b);
      expect(store.tasks[2]).toBe(c);
      expect(runs).toEqual({ status: 1, list: 2 });

      tasks = [tasks[0], tasks[2]];
      listener({ type: "task-removed", taskId: "b", task: task("b", "completed") });
      bridge.flushSync();
      expect(store.tasks.map(item => item.id)).toEqual(["a", "c"]);
      expect(store.tasks[1]).toBe(c);
    } finally { stop(); store.destroy(); }
  });
});
