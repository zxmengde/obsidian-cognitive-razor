import { expect, it, vi } from "vitest";
import { TaskQueue } from "./task-queue";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { err, ok } from "../types";
import type { Result, TaskRecord } from "../types";
import { queueTaskFeedback } from "../ui/queue-task-feedback";

it.each(["success", "failed", "uncertain"] as const)("recovers %s terminal saves without re-dispatching the request or losing the outcome", async outcome => {
  const settings = { ...structuredClone(DEFAULT_SETTINGS), concurrency: 1 };
  let blocked = true;
  const writes: Array<{ tasks: TaskRecord[] }> = [];
  const afterComplete = vi.fn(async () => undefined);
  const beforeFail = vi.fn(async () => undefined);
  const run = vi.fn(async (task: TaskRecord): Promise<Result<Record<string, unknown>>> => {
    if (task.nodeId !== "A" || outcome === "success") return ok({ validated: "preserved" });
    return err(outcome === "uncertain" ? "E206_PROVIDER_REQUEST_UNCERTAIN" : "E204_PROVIDER_ERROR", "synthetic model outcome");
  });
  const queue = new TaskQueue({ info() {}, debug() {}, warn() {}, error() {} },
    { getSettings: () => settings, subscribe: () => () => {} } as never,
    { fileStorage: { atomicWrite: async (_path: string, text: string) => {
      const value = JSON.parse(text);
      writes.push(value);
      if (blocked && value.tasks.some((task: TaskRecord) => task.nodeId === "A" && ["completed", "failed", "interrupted"].includes(task.state))) return err("E303_DISK_FULL", "synthetic local write failure");
      return ok(undefined);
    } } as never, workflowPort: { resolve: async () => ok({}), beforeFail, afterComplete } });
  queue.setTaskRunner({ run, abort() {} } as never);
  try {
    const a = await queue.enqueueDurably({ workflowId: "A", nodeId: "A", stageId: "tag", payload: {} });
    expect(a.ok).toBe(true); if (!a.ok) return;
    await vi.waitFor(() => expect(queue.getTask(a.value)?.localSavePending).toBe(true));
    const visible = queue.getTask(a.value)!;
    expect(visible.state).toBe("failed");
    expect(queueTaskFeedback(visible, "fallback")).toMatchObject({ uncertain: false, message: expect.stringContaining("本地") });
    expect(queue.getSnapshot().status).toMatchObject({ running: 0, failed: 1 });
    const b = await queue.enqueueDurably({ workflowId: "B", nodeId: "B", stageId: "tag", payload: {} });
    expect(b.ok).toBe(true);
    await queue.pauseDurably(); await queue.resumeDurably();
    expect(run).toHaveBeenCalledOnce();
    expect((await queue.removeDurably(a.value)).ok).toBe(false);
    expect((await queue.retryLocalSaveDurably(a.value)).ok).toBe(false);
    expect(queue.getTask(a.value)?.localSavePending).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    blocked = false;
    // Bulk handling must not interpret a just-saved failed outcome as permission to resend it.
    expect(await queue.retryFailedDurably()).toEqual(ok(1));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(queue.getSnapshot().status.running).toBe(0));
    expect(run.mock.calls.filter(([task]) => task.nodeId === "A")).toHaveLength(1);
    expect(queue.getTask(a.value)).toMatchObject({ state: outcome === "success" ? "completed" : outcome === "uncertain" ? "interrupted" : "failed", attempt: 1 });
    expect(queue.getTask(a.value)?.localSavePending).toBeUndefined();
    if (outcome !== "success") expect(beforeFail).toHaveBeenCalledOnce();
    expect(writes.every(write => write.tasks.every(task => !Object.hasOwn(task, "result") && !Object.hasOwn(task, "localSavePending")))).toBe(true);
  } finally { await queue.dispose(); }
});
