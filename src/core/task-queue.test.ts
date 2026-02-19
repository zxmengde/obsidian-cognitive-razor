import { describe, expect, it, vi } from "vitest";
import { TaskQueue } from "./task-queue";
import { SimpleLockManager } from "./lock-manager";
import { err, ok } from "../types";
import type { ILogger, TaskRecord } from "../types";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import type { TaskRunner } from "./task-runner";

function createLogger(): ILogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    getLogContent: () => "",
    clear: () => {},
  };
}

function createInMemoryFileStorage(files: Map<string, string>): FileStorage {
  const storage = {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      const value = files.get(path);
      return ok(value ?? "");
    },
    atomicWrite: async (path: string, content: string) => {
      files.set(path, content);
      return ok(undefined);
    },
  };

  return storage as unknown as FileStorage;
}

function createSettingsStore(settings: { concurrency: number; taskTimeoutMs?: number; autoRetry?: boolean }): SettingsStore {
  return {
    getSettings: () => ({
      concurrency: settings.concurrency,
      taskTimeoutMs: settings.taskTimeoutMs ?? 1000,
      autoRetry: settings.autoRetry ?? false,
      maxRetryAttempts: 1,
    }),
  } as unknown as SettingsStore;
}

describe("TaskQueue 启动恢复安全策略", () => {
  it("存在 Pending 时强制 paused=true，且 setTaskRunner 不会自动调度", async () => {
    const queuePath = "data/queue-state.json";
    const files = new Map<string, string>([
      [
        queuePath,
        JSON.stringify(
          {
            version: "2.0.0",
            paused: false,
            pendingTasks: [
              {
                id: "t-1",
                nodeId: "n-1",
                taskType: "write",
                attempt: 0,
                maxAttempts: 1,
                payload: { conceptType: "Domain" },
              },
            ],
          },
          null,
          2
        ),
      ],
    ]);

    const logger = createLogger();
    const fileStorage = createInMemoryFileStorage(files);
    const settingsStore = createSettingsStore({ concurrency: 1, taskTimeoutMs: 1000, autoRetry: false });
    const lockManager = new SimpleLockManager();

    const queue = new TaskQueue(lockManager, fileStorage, logger, settingsStore, queuePath);
    const initResult = await queue.initialize();
    expect(initResult.ok).toBe(true);
    expect(queue.getStatus().paused).toBe(true);
    expect(queue.getStatus().pending).toBe(1);

    const run = vi.fn(async (task: TaskRecord) => {
      return ok({ taskId: task.id, state: "Completed", data: {} });
    });

    const taskRunner = { run, abort: () => {} } as unknown as TaskRunner;
    queue.setTaskRunner(taskRunner);

    expect(run).toHaveBeenCalledTimes(0);

    await queue.resume();
    await new Promise((r) => setTimeout(r, 0));

    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.getStatus().paused).toBe(false);
    expect(queue.getStatus().pending).toBe(0);
  });
});

describe("TaskQueue 持久化触发时机", () => {
  function createPendingWriteTask(nodeId: string): Omit<TaskRecord, "id" | "created" | "updated"> {
    return {
      nodeId,
      taskType: "write",
      state: "Pending",
      attempt: 0,
      maxAttempts: 2,
      providerRef: "provider-1",
      promptRef: "prompt-1",
      payload: { conceptType: "Domain" },
    };
  }

  it("cancel/retry/clear/running/completed/failed 路径都会触发 scheduleSave", async () => {
    const queuePath = "data/queue-state.json";
    const logger = createLogger();
    const fileStorage = createInMemoryFileStorage(new Map<string, string>());
    const settingsStore = createSettingsStore({ concurrency: 1, taskTimeoutMs: 1000, autoRetry: false });

    const queue = new TaskQueue(new SimpleLockManager(), fileStorage, logger, settingsStore, queuePath);
    const initResult = await queue.initialize();
    expect(initResult.ok).toBe(true);

    const scheduleSaveSpy = vi
      .spyOn(queue as unknown as { scheduleSave: () => void }, "scheduleSave")
      .mockImplementation(() => {});

    const pendingTaskId = queue.enqueue(createPendingWriteTask("node-pending"));
    const afterEnqueueCalls = scheduleSaveSpy.mock.calls.length;
    queue.cancel(pendingTaskId);
    expect(scheduleSaveSpy.mock.calls.length).toBeGreaterThan(afterEnqueueCalls);

    const failedTaskId = queue.enqueue(createPendingWriteTask("node-failed"));
    queue.updateTask(failedTaskId, {
      state: "Failed",
      errors: [{ code: "E500_INTERNAL_ERROR", message: "failed", timestamp: "2025-01-01T00:00:00Z", attempt: 1 }],
    });
    const beforeRetryCalls = scheduleSaveSpy.mock.calls.length;
    const retryResult = await queue.retryFailed();
    expect(retryResult.ok).toBe(true);
    expect(scheduleSaveSpy.mock.calls.length).toBeGreaterThan(beforeRetryCalls);

    const completedTaskId = queue.enqueue(createPendingWriteTask("node-completed"));
    queue.updateTask(completedTaskId, {
      state: "Completed",
      completedAt: "2000-01-01T00:00:00.000Z",
    });
    const beforeClearCalls = scheduleSaveSpy.mock.calls.length;
    const clearResult = await queue.clearCompleted();
    expect(clearResult.ok).toBe(true);
    expect(scheduleSaveSpy.mock.calls.length).toBeGreaterThan(beforeClearCalls);

    const runOk = vi.fn(async (task: TaskRecord) => ok({ taskId: task.id, state: "Completed", data: {} }));
    queue.setTaskRunner({ run: runOk, abort: () => {} } as unknown as TaskRunner);
    const beforeSuccessCalls = scheduleSaveSpy.mock.calls.length;
    queue.enqueue(createPendingWriteTask("node-success"));
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduleSaveSpy.mock.calls.length).toBeGreaterThan(beforeSuccessCalls);

    const failQueue = new TaskQueue(
      new SimpleLockManager(),
      createInMemoryFileStorage(new Map<string, string>()),
      createLogger(),
      settingsStore,
      "data/queue-state-failed.json"
    );
    const failInitResult = await failQueue.initialize();
    expect(failInitResult.ok).toBe(true);

    const failScheduleSpy = vi
      .spyOn(failQueue as unknown as { scheduleSave: () => void }, "scheduleSave")
      .mockImplementation(() => {});

    failQueue.setTaskRunner({
      run: async () => err("E201_PROVIDER_ERROR", "provider failed"),
      abort: () => {},
    } as unknown as TaskRunner);

    const beforeFailCalls = failScheduleSpy.mock.calls.length;
    failQueue.enqueue(createPendingWriteTask("node-run-failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(failScheduleSpy.mock.calls.length).toBeGreaterThan(beforeFailCalls);
  });
});
