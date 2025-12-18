import { describe, expect, it, vi } from "vitest";
import { TaskQueue } from "./task-queue";
import { SimpleLockManager } from "./lock-manager";
import { ok } from "../types";
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
      maxTaskHistory: 300,
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
                payload: {},
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

