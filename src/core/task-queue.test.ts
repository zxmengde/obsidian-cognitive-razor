import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { err, ok } from "../types";
import type {
  ILogger,
  NewTaskRecord,
  PluginSettings,
  QueueEvent,
  Result,
  ConfirmedConcept,
  TaskRecord,
} from "../types";
import type { SettingsStore } from "../data/settings-store";
import type { TaskRunner } from "./task-runner";
import { TaskQueue, QUEUE_STATE_PATH, QUEUE_STATE_VERSION } from "./task-queue";

function createLogger(): ILogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createSettingsStore(overrides: Partial<PluginSettings> = {}): SettingsStore {
  const settings: PluginSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    providers: {
      provider: {
        apiKey: "key",
        baseUrl: "https://example.test/v1",
        apiFormat: "openai-chat-completions",
        enableWebSearch: false,
        embeddingApiFormat: "openai-embeddings",
        defaultChatModel: "provider-chat",
        defaultEmbedModel: "provider-embed",
        enabled: true,
      },
    },
    defaultProviderId: "provider",
    ...overrides,
  };
  settings.taskModels = {
    ...settings.taskModels,
    tag: { ...settings.taskModels.tag, providerId: "provider", model: "tag-model" },
    write: { ...settings.taskModels.write, providerId: "provider", model: "write-model" },
    verify: { ...settings.taskModels.verify, providerId: "provider", model: "verify-model" },
  };
  return {
    getSettings: () => settings,
    subscribe: () => () => undefined,
  } as unknown as SettingsStore;
}

function createWriteTask(nodeId: string): NewTaskRecord<"core"> {
  return {
    nodeId,
    workflowId: `workflow-${nodeId}`,
    stageId: "core",
    payload: {
      concept: createConfirmedConcept(nodeId),
    },
  };
}

function createTagTask(nodeId: string): NewTaskRecord<"tag"> {
  return {
    nodeId,
    workflowId: `workflow-${nodeId}`,
    stageId: "tag",
    payload: { concept: createConfirmedConcept(nodeId) },
  };
}

function createConfirmedConcept(name: string): ConfirmedConcept {
  return {
    type: "domain",
    name: { chinese: name, english: name },
    coreDefinition: name,
    source: "define",
    parents: [],
  };
}

function createRunner(
  run: (task: TaskRecord) => Promise<Result<Record<string, unknown>>>,
  abort: (taskId: string) => void = () => undefined,
): TaskRunner {
  return { run, abort } as unknown as TaskRunner;
}

async function enqueue(queue: TaskQueue, intent: NewTaskRecord): Promise<string> {
  const result = await queue.enqueueDurably(intent);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

afterEach(() => {
  vi.useRealTimers();
});

it("exposes uncertain requests as interrupted and excludes them from bulk retry", async () => {
  const queue = new TaskQueue(createLogger(), createSettingsStore());
  const id = await enqueue(queue, createTagTask("interrupted"));
  queue.setTaskRunner(createRunner(async () => err("E206_PROVIDER_REQUEST_UNCERTAIN", "连接中断")));
  await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("interrupted"));
  expect(await queue.retryFailedDurably()).toEqual(ok(0));
  expect(queue.getSnapshot().status).toMatchObject({ interrupted: 1, failed: 0 });
  await queue.dispose();
});

it.each(["known", "uncertain"] as const)("restores E206/%s history without bulk or unconfirmed retry", async (kind) => {
  const state = { version: QUEUE_STATE_VERSION, paused: true, nextQueueOrder: 3, tasks: [
    { id: 'uncertain-history', workflowId: 'history', nodeId: 'history', stageId: 'core', state: 'failed', queueOrder: 1, createdAt: 1, updatedAt: 1, attempt: 1, error: { code: 'E206_PROVIDER_REQUEST_UNCERTAIN', message: 'synthetic', kind } },
    { id: 'known-history', workflowId: 'known-history', nodeId: 'known-history', stageId: 'core', state: 'failed', queueOrder: 2, createdAt: 1, updatedAt: 1, attempt: 1, error: { code: 'E204_PROVIDER_ERROR', message: 'synthetic', kind: 'known' } },
  ] };
  const files = new Map([[QUEUE_STATE_PATH, JSON.stringify(state)]]);
  const run = vi.fn(async () => ok({ content: 'synthetic' }));
  const queue = new TaskQueue(createLogger(), createSettingsStore(), {
    fileStorage: {
      read: async (path: string) => files.has(path) ? ok(files.get(path)!) : err('E301_FILE_NOT_FOUND', 'missing'),
      atomicWrite: async (path: string, value: string) => { files.set(path, value); return ok(undefined); },
    } as never,
    workflowPort: { resolve: async task => ok({ concept: createConfirmedConcept(task.nodeId) }) },
  });
  try {
    expect((await queue.initialize()).ok).toBe(true);
    queue.setTaskRunner(createRunner(run));
    expect(queue.getTask('uncertain-history')).toMatchObject({ state: 'interrupted', attempt: 1 });
    expect((await queue.retryDurably('uncertain-history')).ok).toBe(false);
    expect(await queue.retryFailedDurably()).toEqual(ok(1));
    expect(queue.getTask('uncertain-history')).toMatchObject({ state: 'interrupted', attempt: 1 });
    expect(queue.getTask('known-history')).toMatchObject({ state: 'pending', attempt: 2 });
    expect(run).not.toHaveBeenCalled();
    expect(await queue.retryUncertainDurably('uncertain-history')).toEqual(ok(true));
    expect(queue.getTask('uncertain-history')).toMatchObject({ state: 'pending', attempt: 2 });
    expect(run).not.toHaveBeenCalled();
    await queue.resumeDurably();
    await vi.waitFor(() => expect(queue.getSnapshot().status.completed).toBe(2));
    expect(run).toHaveBeenCalledTimes(2);
  } finally { await queue.dispose(); }
});

it("cleans business artifacts only after old completed queue history is durably pruned", async () => {
  const afterRemove = vi.fn(async (_task: TaskRecord) => undefined);
  const queue = new TaskQueue(createLogger(), createSettingsStore({ concurrency: 10 }), {
    workflowPort: { resolve: async () => ok({}), afterRemove },
  });
  await queue.pauseDurably();
  for (let index = 0; index < 202; index++) await enqueue(queue, createWriteTask(`history-${index}`));
  queue.setTaskRunner(createRunner(async () => ok({})));
  await queue.resumeDurably();
  await vi.waitFor(() => expect(queue.getSnapshot().status.completed).toBe(200));
  await vi.waitFor(() => expect(afterRemove).toHaveBeenCalled());
  expect(afterRemove.mock.calls.every(([task]) => task.state === "completed")).toBe(true);
  await queue.dispose();
});

describe("TaskQueue runtime model", () => {
  it("does not dispatch a model request after disposal starts during recovery lookup", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const resolveAppliedCompletion = vi.fn(async () => { await gate; return ok(undefined); });
    const run = vi.fn(async () => ok({}));
    const queue = new TaskQueue(createLogger(), createSettingsStore(), {
      workflowPort: { resolve: async () => ok({}), resolveAppliedCompletion },
    });
    queue.setTaskRunner(createRunner(run));
    await enqueue(queue, createWriteTask("stop-before-model"));
    await vi.waitFor(() => expect(resolveAppliedCompletion).toHaveBeenCalledOnce());
    const disposing = queue.dispose();
    release();
    await disposing;
    expect(run).not.toHaveBeenCalled();
  });

  it("waits for a local result commit even beyond the provider shutdown grace period", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const beforeComplete = vi.fn(async () => { await gate; return ok({}); });
    const queue = new TaskQueue(createLogger(), createSettingsStore(), {
      workflowPort: { resolve: async () => ok({}), beforeComplete },
    });
    queue.setTaskRunner(createRunner(async () => ok({ content: "saved response" })));
    await enqueue(queue, createWriteTask("slow-local-commit"));
    await vi.waitFor(() => expect(beforeComplete).toHaveBeenCalledOnce());
    let disposed = false;
    const disposing = queue.dispose().then(() => { disposed = true; });
    try {
      await vi.advanceTimersByTimeAsync(1500);
      expect(disposed).toBe(false);
    } finally { release(); }
    await disposing;
    expect(disposed).toBe(true);
  });

  it("does not remove a task that was retried while terminal history cleanup was queued", async () => {
    const afterRemove = vi.fn(async () => undefined);
    const atomicWrite = vi.fn().mockResolvedValue(ok(undefined));
    const queue = new TaskQueue(createLogger(), createSettingsStore(), {
      workflowPort: { resolve: async () => ok({}), afterRemove },
      fileStorage: { atomicWrite } as never,
    });
    const id = await enqueue(queue, createWriteTask("retry-during-cleanup"));
    queue.setTaskRunner(createRunner(async () => err("E204_PROVIDER_ERROR", "failed")));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("failed"));
    await queue.pauseDurably();
    let release!: () => void;
    atomicWrite.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(ok(undefined)); }));
    const blocker = enqueue(queue, createWriteTask("unrelated-write"));
    await vi.waitFor(() => expect(release).toBeDefined());
    const retry = queue.retryDurably(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cleanup = queue.removeTerminalDurably();
    release();
    await blocker;
    expect(await retry).toEqual(ok(true));
    expect(await cleanup).toEqual(ok(0));
    expect(queue.getTask(id)?.state).toBe("pending");
    expect(afterRemove).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it.each([false, true])("waits for an in-flight cancellation before committing a late response (hook failure: %s)", async (failCancellation) => {
    let finishRequest!: (value: Result<Record<string, unknown>>) => void;
    const response = new Promise<Result<Record<string, unknown>>>((resolve) => { finishRequest = resolve; });
    let finishCancellation!: () => void;
    const cancelling = new Promise<void>((resolve) => { finishCancellation = resolve; });
    const beforeFail = vi.fn(async () => {
      await cancelling;
      if (failCancellation) throw new Error("disk unavailable");
    });
    const beforeComplete = vi.fn(async () => ok({}));
    const run = vi.fn(() => response);
    const queue = new TaskQueue(createLogger(), createSettingsStore(), {
      workflowPort: { resolve: async () => ok({}), beforeFail, beforeComplete },
    });
    queue.setTaskRunner(createRunner(run));
    const id = await enqueue(queue, createWriteTask("cancel-before-commit"));
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const cancellation = queue.cancelDurably(id);
    await vi.waitFor(() => expect(beforeFail).toHaveBeenCalledOnce());
    finishRequest(ok({ content: "paid response" }));
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(beforeComplete).not.toHaveBeenCalled();
    } finally { finishCancellation(); }
    expect((await cancellation).ok).toBe(!failCancellation);
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe(failCancellation ? "completed" : "interrupted"));
    expect(beforeComplete).toHaveBeenCalledTimes(failCancellation ? 1 : 0);
    await queue.dispose();
  });

  it("keeps an active execution attached after an unrelated queue write rolls back", async () => {
    let release!: (result: Result<Record<string, unknown>>) => void;
    const response = new Promise<Result<Record<string, unknown>>>((resolve) => { release = resolve; });
    const atomicWrite = vi.fn().mockResolvedValue(ok(undefined));
    const queue = new TaskQueue(createLogger(), createSettingsStore(), { fileStorage: { atomicWrite } as never });
    const run = vi.fn(() => response);
    queue.setTaskRunner(createRunner(run));
    const id = await enqueue(queue, createWriteTask("active"));
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    atomicWrite.mockResolvedValueOnce(err("E303_DISK_FULL", "full"));
    expect((await queue.pauseDurably()).ok).toBe(false);
    release(ok({ saved: true }));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("completed"));
    expect(JSON.parse(atomicWrite.mock.calls.at(-1)![1]).tasks[0].state).toBe("completed");
    await queue.dispose();
  });

  it("uses the original model snapshot when settings change during a request", async () => {
    const store = createSettingsStore();
    const beforeComplete = vi.fn(async () => ok({}));
    const queue = new TaskQueue(createLogger(), store, { workflowPort: { resolve: async () => ok({}), beforeComplete } });
    queue.setTaskRunner(createRunner(async () => {
      store.getSettings().taskModels.write.model = "new-model";
      return ok({ responseId: "old-model-response" });
    }));
    const id = await enqueue(queue, createWriteTask("snapshot-commit"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("completed"));
    expect(beforeComplete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ modelSnapshot: expect.objectContaining({ model: "write-model" }) }));
    await queue.dispose();
  });

  it("does not age failed tasks out of the recoverable queue", async () => {
    const queue = new TaskQueue(createLogger(), createSettingsStore({ concurrency: 10 }));
    await queue.pauseDurably();
    for (let index = 0; index < 205; index++) await enqueue(queue, createWriteTask(`failed-${index}`));
    queue.setTaskRunner(createRunner(async () => err("E206_PROVIDER_REQUEST_UNCERTAIN", "unknown")));
    await queue.resumeDurably();
    await vi.waitFor(() => expect(queue.getSnapshot().status.interrupted).toBe(205));
    expect(queue.getSnapshot().tasks).toHaveLength(205);
    await queue.dispose();
  });
  it("exposes a terminal save failure and retries only the local write with execution ownership intact", async () => {
    let fail = true;
    const atomicWrite = vi.fn(async (_path: string, text: string) => {
      if (fail && JSON.parse(text).tasks.some((task: TaskRecord) => task.state === "failed")) return err("E303_DISK_FULL", "disk full");
      return ok(undefined);
    });
    const fileStorage = { atomicWrite } as never;
    const queue = new TaskQueue(createLogger(), createSettingsStore(), { fileStorage });
    const run = vi.fn(async () => err("E204_PROVIDER_ERROR", "upstream failed"));
    queue.setTaskRunner(createRunner(run));
    const id = await enqueue(queue, createWriteTask("persist-failure"));

    await vi.waitFor(() => expect(queue.getTask(id)?.localSavePending).toBe(true));
    expect(queue.getTask(id)).toMatchObject({ state: "failed", error: { stage: "storage", code: "E303_DISK_FULL" } });
    expect((await queue.cancelDurably(id)).ok).toBe(false);
    fail = false;
    await expect(queue.retryLocalSaveDurably(id)).resolves.toEqual(ok(true));
    expect(queue.getTask(id)).toMatchObject({ state: "failed", error: { code: "E204_PROVIDER_ERROR" }, attempt: 1 });
    expect(queue.getTask(id)?.localSavePending).toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
    await queue.dispose();
  });

  it("reads the latest settings when a pending task actually starts", async () => {
    const store = createSettingsStore();
    const queue = new TaskQueue(createLogger(), store);
    await queue.pauseDurably();
    const contexts: Array<{ modelSnapshot: { model: string } }> = [];
    queue.setTaskRunner({
      run: vi.fn(async (_task: TaskRecord, context: { modelSnapshot: { model: string } }) => {
        contexts.push(context);
        return ok({ done: true });
      }),
      abort: vi.fn(),
    } as unknown as TaskRunner);
    await enqueue(queue, createWriteTask("latest-settings"));
    store.getSettings().taskModels.write.model = "changed-before-start";
    await queue.resumeDurably();
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0]?.modelSnapshot.model).toBe("changed-before-start");
    await queue.dispose();
  });

  it("owns runtime metadata without persisting model settings at enqueue time", async () => {
    const store = createSettingsStore();
    const queue = new TaskQueue(createLogger(), store);
    const id = await enqueue(queue, createWriteTask("snapshot"));
    const task = queue.getTask(id);

    expect(task).toMatchObject({
      id,
      state: "pending",
    });
    expect(task).not.toHaveProperty("modelSnapshot");
    await queue.dispose();
  });

  it("publishes and retains the completed task for history", async () => {
    let completed: TaskRecord | undefined;
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    queue.subscribe((event) => {
      if (event.type === "task-completed") completed = event.task;
    });
    queue.setTaskRunner(createRunner(async () => ok({ content: "generated" })));

    const id = await enqueue(queue, createWriteTask("completed"));
    await vi.waitFor(() => expect(completed?.id).toBe(id));

    expect(completed?.result).toEqual({ content: "generated" });
    expect(queue.getTask(id)).toMatchObject({ state: "completed", attempt: 1 });
    expect(queue.getSnapshot().status).toMatchObject({ total: 1, completed: 1 });
    await queue.dispose();
  });

  it("rejects concurrent work for the same node", async () => {
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    await enqueue(queue, createWriteTask("same-node"));

    await expect(queue.enqueueDurably(createWriteTask("same-node"))).resolves.toMatchObject({
      ok: false,
      error: { code: "E320_TASK_CONFLICT" },
    });
    await queue.dispose();
  });

  it("fills only the configured number of execution slots", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const run = vi.fn(async (task: TaskRecord) => {
      if (task.nodeId === "first") await firstGate;
      return ok({});
    });
    const queue = new TaskQueue(
      createLogger(),
      createSettingsStore({ concurrency: 1, taskTimeoutMs: 60_000 }),
    );
    queue.setTaskRunner(createRunner(run));

    const firstId = await enqueue(queue, createWriteTask("first"));
    const secondId = await enqueue(queue, createWriteTask("second"));
    await vi.waitFor(() => expect(queue.getTask(firstId)?.state).toBe("running"));
    expect(queue.getTask(secondId)?.state).toBe("pending");

    releaseFirst();
    await vi.waitFor(() => expect(queue.getTask(secondId)?.state).toBe("completed"));
    expect(run).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("does not start a task cancelled by a synchronous start listener", async () => {
    const run = vi.fn(async () => ok({}));
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    queue.subscribe((event) => {
      if (event.type === "task-started") void queue.cancelDurably(event.taskId);
    });
    queue.setTaskRunner(createRunner(run));

    const id = await enqueue(queue, createWriteTask("cancel-on-start"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("cancelled"));
    expect(run).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it("fills newly available slots as soon as concurrency increases", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const baseStore = createSettingsStore({ concurrency: 1, taskTimeoutMs: 60_000 });
    let concurrency = 1;
    let settingsListener: ((settings: PluginSettings) => void) | undefined;
    const store = {
      getSettings: () => ({ ...baseStore.getSettings(), concurrency }),
      subscribe: (listener: (settings: PluginSettings) => void) => {
        settingsListener = listener;
        return () => { settingsListener = undefined; };
      },
    } as unknown as SettingsStore;
    const run = vi.fn(async (task: TaskRecord) => {
      await (task.nodeId === "first" ? firstGate : secondGate);
      return ok({});
    });
    const queue = new TaskQueue(createLogger(), store);
    queue.setTaskRunner(createRunner(run));
    const firstId = await enqueue(queue, createWriteTask("first"));
    const secondId = await enqueue(queue, createWriteTask("second"));
    await vi.waitFor(() => expect(queue.getTask(firstId)?.state).toBe("running"));
    expect(queue.getTask(secondId)?.state).toBe("pending");

    concurrency = 2;
    settingsListener?.(store.getSettings());
    await vi.waitFor(() => expect(queue.getTask(secondId)?.state).toBe("running"));

    releaseFirst();
    releaseSecond();
    await vi.waitFor(() => expect(queue.getSnapshot().status.completed).toBe(2));
    await queue.dispose();
  });

  it("does not start pending work while paused and resumes explicitly", async () => {
    const run = vi.fn(async () => ok({}));
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    await queue.pauseDurably();
    queue.setTaskRunner(createRunner(run));
    const id = await enqueue(queue, createWriteTask("paused"));

    expect(queue.getTask(id)?.state).toBe("pending");
    expect(run).not.toHaveBeenCalled();
    await queue.resumeDurably();
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("completed"));
    await queue.dispose();
  });

  it("releases the queue slot at timeout without waiting for the runner to settle", async () => {
    vi.useFakeTimers();
    let finish!: (result: Result<Record<string, unknown>>) => void;
    const pending = new Promise<Result<Record<string, unknown>>>((resolve) => { finish = resolve; });
    const run = vi.fn((task: TaskRecord) => task.nodeId === "timeout"
      ? pending
      : Promise.resolve(ok({})));
    const abort = vi.fn();
    const queue = new TaskQueue(
      createLogger(),
      createSettingsStore({ taskTimeoutMs: 1000 }),
    );
    queue.setTaskRunner(createRunner(run, abort));
    const id = await enqueue(queue, createWriteTask("timeout"));
    const nextId = await enqueue(queue, createWriteTask("after-timeout"));

    expect(queue.getTask(id)?.state).toBe("running");
    expect(queue.getTask(nextId)?.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1000);

    expect(abort).toHaveBeenCalledWith(id);
    expect(queue.getTask(id)).toMatchObject({
      state: "interrupted",
      error: expect.objectContaining({ code: "E206_PROVIDER_REQUEST_UNCERTAIN", kind: "uncertain" }),
    });
    expect(queue.getTask(nextId)?.state).toBe("completed");
    finish(err("E310_INVALID_STATE", "任务已被中断"));
    await Promise.resolve();
    await queue.dispose();
  });

  it("cancels all pending tasks with one observable batch event", async () => {
    const events: QueueEvent[] = [];
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    await queue.pauseDurably();
    queue.subscribe((event) => events.push(event));
    const first = await enqueue(queue, createWriteTask("pending-1"));
    const second = await enqueue(queue, createWriteTask("pending-2"));

    await expect(queue.cancelAllActiveDurably()).resolves.toEqual(ok(2));
    expect(queue.getTask(first)?.state).toBe("cancelled");
    expect(queue.getTask(second)?.state).toBe("cancelled");
    expect(events.filter((event) => event.type === "tasks-cancelled")).toHaveLength(1);
    await queue.dispose();
  });

  it("does not let a cancelled task's late result affect its replacement", async () => {
    let releaseFirst!: (result: Result<Record<string, unknown>>) => void;
    const firstResult = new Promise<Result<Record<string, unknown>>>((resolve) => { releaseFirst = resolve; });
    let releaseSecond!: (result: Result<Record<string, unknown>>) => void;
    const secondResult = new Promise<Result<Record<string, unknown>>>((resolve) => { releaseSecond = resolve; });
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      return calls === 1 ? firstResult : secondResult;
    });
    const queue = new TaskQueue(createLogger(), createSettingsStore({ taskTimeoutMs: 60_000 }));
    queue.setTaskRunner(createRunner(run, vi.fn()));

    const firstId = await enqueue(queue, createWriteTask("shared-node"));
    await vi.waitFor(() => expect(queue.getTask(firstId)?.state).toBe("running"));
    await expect(queue.cancelDurably(firstId)).resolves.toEqual(ok(true));
    const secondId = await enqueue(queue, createWriteTask("shared-node"));
    await vi.waitFor(() => expect(queue.getTask(secondId)?.state).toBe("running"));
    releaseFirst(ok({}));
    await Promise.resolve();
    expect(queue.getTask(secondId)?.state).toBe("running");

    releaseSecond(ok({}));
    await vi.waitFor(() => expect(queue.getTask(secondId)?.state).toBe("completed"));
    await queue.dispose();
  });

  it("retains failures while allowing a new workflow for the same node", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(err("E204_PROVIDER_ERROR", "temporary"))
      .mockImplementation(async () => ok({}));
    const queue = new TaskQueue(
      createLogger(),
      createSettingsStore(),
    );
    queue.setTaskRunner(createRunner(run));
    const failedId = await enqueue(queue, createWriteTask("restart"));

    await vi.waitFor(() => expect(queue.getTask(failedId)?.state).toBe("failed"));
    expect(run).toHaveBeenCalledTimes(1);

    const replacementId = await enqueue(queue, createWriteTask("restart"));
    expect(queue.getTask(failedId)?.state).toBe("failed");
    expect(queue.getSnapshot().status.failed).toBe(1);
    await vi.waitFor(() => expect(queue.getTask(replacementId)?.state).toBe("completed"));
    expect(run).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("retains only the safe Provider request count from nested failure details", async () => {
    const run = vi.fn().mockResolvedValue(err("E204_PROVIDER_ERROR", "upstream failed", {
      taskId: "runner-wrapper",
      details: {
        status: 503,
        rawResponse: "sensitive upstream body",
        providerAttempts: 3,
      },
    }));
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    queue.setTaskRunner(createRunner(run));

    const id = await enqueue(queue, createWriteTask("provider-attempts"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("failed"));

    expect(queue.getTask(id)?.error).toEqual({
      code: "E204_PROVIDER_ERROR",
      message: "upstream failed",
      kind: "known",
      stage: "provider",
      providerAttempts: 3,
    });
    expect(JSON.stringify(queue.getTask(id)?.error)).not.toContain("sensitive upstream body");
    await queue.dispose();
  });

  it("retries a failed task in place and reads configuration per attempt", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce(err("E204_PROVIDER_ERROR", "temporary"))
      .mockResolvedValueOnce(ok({ content: "recovered" }));
    const events: QueueEvent[] = [];
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    queue.subscribe((event) => events.push(event));
    queue.setTaskRunner(createRunner(run));

    const id = await enqueue(queue, createWriteTask("retry-in-place"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("failed"));
    await expect(queue.retryDurably(id)).resolves.toEqual(ok(true));
    expect(queue.getTask(id)).toMatchObject({ attempt: 2 });
    expect(run.mock.calls[0]?.[1]).toMatchObject({ attemptReason: "initial", modelSnapshot: { model: "write-model" } });
    expect(run.mock.calls[1]?.[1]).toMatchObject({ attemptReason: "manual-retry", modelSnapshot: { model: "write-model" } });
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("completed"));
    expect(queue.getTask(id)?.result).toEqual({ content: "recovered" });
    expect(queue.getTask(id)?.id).toBe(id);
    expect(events.filter((event) => event.type === "task-retried")).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("isolates a retry from the timed-out attempt's late result", async () => {
    vi.useFakeTimers();
    let finishFirst!: (result: Result<Record<string, unknown>>) => void;
    const firstResult = new Promise<Result<Record<string, unknown>>>((resolve) => { finishFirst = resolve; });
    let finishSecond!: (result: Result<Record<string, unknown>>) => void;
    const secondResult = new Promise<Result<Record<string, unknown>>>((resolve) => { finishSecond = resolve; });
    const run = vi.fn()
      .mockReturnValueOnce(firstResult)
      .mockReturnValueOnce(secondResult);
    const queue = new TaskQueue(
      createLogger(),
      createSettingsStore({ taskTimeoutMs: 1000 }),
    );
    queue.setTaskRunner(createRunner(run, vi.fn()));

    const id = await enqueue(queue, createWriteTask("retry-after-timeout"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("running"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.getTask(id)?.state).toBe("interrupted");

    await expect(queue.retryUncertainDurably(id)).resolves.toEqual(ok(true));
    expect(queue.getTask(id)).toMatchObject({ state: "running", attempt: 2 });
    finishFirst(ok({ content: "stale" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.getTask(id)).toMatchObject({ state: "running", attempt: 2 });
    expect(queue.getTask(id)?.result).toBeUndefined();

    finishSecond(ok({ content: "fresh" }));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("completed"));
    expect(queue.getTask(id)?.result).toEqual({ content: "fresh" });
    await queue.dispose();
  });

  it("retries failed tasks in a batch without creating same-node work", async () => {
    const queue = new TaskQueue(createLogger(), createSettingsStore({ concurrency: 1 }));
    await queue.pauseDurably();
    const first = await enqueue(queue, createWriteTask("batch-first"));
    const second = await enqueue(queue, createWriteTask("batch-second"));
    // Move both records to Failed through a runner, then pause before retrying.
    await queue.resumeDurably();
    queue.setTaskRunner(createRunner(async () => err("E204_PROVIDER_ERROR", "temporary")));
    await vi.waitFor(() => expect(queue.getTask(first)?.state).toBe("failed"));
    await vi.waitFor(() => expect(queue.getTask(second)?.state).toBe("failed"));
    await queue.pauseDurably();

    await expect(queue.retryFailedDurably()).resolves.toEqual(ok(2));
    expect(queue.getTask(first)?.attempt).toBe(2);
    expect(queue.getTask(second)?.attempt).toBe(2);
    expect(queue.getSnapshot().status.pending).toBe(2);
    await queue.dispose();
  });

  it("continues a workflow before starting the next note", async () => {
    const followUp = createWriteTask("note-a");
    const queue = new TaskQueue(createLogger(), createSettingsStore({ concurrency: 1 }), {
      workflowPort: {
        resolve: async () => ok({}),
        beforeComplete: async (task: TaskRecord) => task.workflowId === "workflow-note-a" && task.stageId === "tag"
          ? ok({ followUp })
          : ok({}),
      } as never,
    });
    const completed: Array<{ nodeId: string; stageId?: string }> = [];
    queue.subscribe((event) => {
      if (event.type === "task-completed") completed.push({ nodeId: event.task.nodeId, stageId: event.task.stageId });
    });
    await queue.pauseDurably();
    await enqueue(queue, createTagTask("note-a"));
    await enqueue(queue, createTagTask("note-b"));
    queue.setTaskRunner(createRunner(async () => ok({})));
    await queue.resumeDurably();

    await vi.waitFor(() => expect(completed).toHaveLength(3));
    expect(completed).toEqual([
      { nodeId: "note-a", stageId: "tag" },
      { nodeId: "note-a", stageId: "core" },
      { nodeId: "note-b", stageId: "tag" },
    ]);
    await queue.dispose();
  });

  it("does not duplicate a continuation already active for the workflow stage", async () => {
    const followUp = createWriteTask("note-a");
    const queue = new TaskQueue(createLogger(), createSettingsStore({ concurrency: 1 }), {
      workflowPort: {
        resolve: async () => ok({}),
        beforeComplete: async (task: TaskRecord) => task.workflowId === "workflow-note-a" && task.stageId === "tag"
          ? ok({ followUp })
          : ok({}),
      } as never,
    });
    queue.setTaskRunner(createRunner(async () => ok({ generated: true })));
    await queue.pauseDurably();
    const tagId = await enqueue(queue, createTagTask("note-a"));
    const existingCoreId = await enqueue(queue, followUp);
    await queue.resumeDurably();

    await vi.waitFor(() => expect(queue.getSnapshot().status.completed).toBe(2));
    expect(queue.getTask(tagId)?.state).toBe("completed");
    expect(queue.getTask(existingCoreId)?.state).toBe("completed");
    expect(queue.getSnapshot().tasks.filter((task) => task.workflowId === "workflow-note-a" && task.stageId === "core")).toHaveLength(1);
    await queue.dispose();
  });

  it("requires an explicit single-task retry for uncertain Provider failures", async () => {
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    queue.setTaskRunner(createRunner(async () => err(
      "E206_PROVIDER_REQUEST_UNCERTAIN",
      "result unknown",
      { kind: "upstream-http", status: 524, rawResponse: "synthetic secret body" },
    )));
    const id = await enqueue(queue, createWriteTask("uncertain-retry"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("interrupted"));
    await queue.pauseDurably();

    expect(queue.getTask(id)?.error?.kind).toBe("uncertain");
    expect(queue.getTask(id)?.error?.upstreamStatus).toBe(524);
    expect(JSON.stringify(queue.getTask(id)?.error)).not.toContain("synthetic secret body");
    await expect(queue.retryFailedDurably()).resolves.toEqual(ok(0));
    expect(queue.getTask(id)?.state).toBe("interrupted");
    await expect(queue.retryDurably(id)).resolves.toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    await expect(queue.retryUncertainDurably(id)).resolves.toEqual(ok(true));
    expect(queue.getTask(id)?.state).toBe("pending");
    await queue.dispose();
  });

  it("removes terminal history explicitly and keeps active work protected", async () => {
    let release!: (result: Result<Record<string, unknown>>) => void;
    const pending = new Promise<Result<Record<string, unknown>>>((resolve) => { release = resolve; });
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    queue.setTaskRunner(createRunner(() => pending, vi.fn()));
    const running = await enqueue(queue, createWriteTask("protected"));
    await vi.waitFor(() => expect(queue.getTask(running)?.state).toBe("running"));
    await expect(queue.removeDurably(running)).resolves.toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    await expect(queue.cancelDurably(running)).resolves.toEqual(ok(true));
    await expect(queue.removeTerminalDurably()).resolves.toEqual(ok(1));
    expect(queue.getTask(running)).toBeUndefined();
    release(ok({}));
    await queue.dispose();
  });

  it("bounds cancelled history instead of accumulating forever", async () => {
    const queue = new TaskQueue(createLogger(), createSettingsStore());
    await queue.pauseDurably();
    for (let index = 0; index < 205; index += 1) {
      await enqueue(queue, createWriteTask(`history-${index}`));
    }
    await expect(queue.cancelAllActiveDurably()).resolves.toEqual(ok(205));
    expect(queue.getSnapshot().tasks).toHaveLength(200);
    expect(queue.getSnapshot().status.cancelled).toBe(200);
    return queue.dispose();
  });

  it("does not expose an unexpected runner exception in queue state", async () => {
    const logger = createLogger();
    logger.error = vi.fn();
    const queue = new TaskQueue(logger, createSettingsStore());
    queue.setTaskRunner(createRunner(async () => {
      throw new Error("Authorization: Bearer fake-secret-token-value");
    }));
    const id = await enqueue(queue, createWriteTask("unexpected-error"));

    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("failed"));
    expect(queue.getTask(id)?.error).toEqual({
      code: "E500_INTERNAL_ERROR",
      message: "任务执行异常",
      kind: "known",
      stage: "runtime",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "TaskQueue",
      "任务执行器抛出异常",
      expect.any(Error),
      expect.objectContaining({ taskId: id }),
    );
    await queue.dispose();
  });

  it("aborts active work and leaves no resumable state on dispose", async () => {
    let release!: (result: Result<Record<string, unknown>>) => void;
    const pending = new Promise<Result<Record<string, unknown>>>((resolve) => { release = resolve; });
    const abort = vi.fn();
    const queue = new TaskQueue(
      createLogger(),
      createSettingsStore({ taskTimeoutMs: 60_000 }),
    );
    queue.setTaskRunner(createRunner(() => pending, abort));
    const id = await enqueue(queue, createWriteTask("dispose"));
    await vi.waitFor(() => expect(queue.getTask(id)?.state).toBe("running"));

    const disposing = queue.dispose();
    expect(abort).toHaveBeenCalledWith(id);
    release(ok({}));
    await disposing;

    expect(queue.getSnapshot()).toEqual({
      status: { paused: false, total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, interrupted: 0 },
      tasks: [],
    });
  });

  it("does not let a non-cooperative runner block queue disposal", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    const queue = new TaskQueue(
      createLogger(),
      createSettingsStore({ taskTimeoutMs: 60_000 }),
    );
    queue.setTaskRunner(createRunner(() => new Promise(() => undefined), abort));
    const id = await enqueue(queue, createWriteTask("stuck-dispose"));
    expect(queue.getTask(id)?.state).toBe("running");

    const disposing = queue.dispose();
    expect(abort).toHaveBeenCalledWith(id);
    await vi.advanceTimersByTimeAsync(1000);
    await disposing;

    expect(queue.getSnapshot().status.total).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
