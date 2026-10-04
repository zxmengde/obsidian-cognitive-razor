import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { TFile, type App, type Vault } from "obsidian";
import { FileStorage } from "../data/file-storage";
import { DEFAULT_SETTINGS, type SettingsStore } from "../data/settings-store";
import { TaskQueue } from "./task-queue";
import { CardGenerationService } from "./card-generation-service";
import { NoteRepository } from "./note-repository";
import { generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { ok, err, type ILogger, type TaskRecord, type Result } from "../types";
import type { TaskRunner } from "./task-runner";
import { CardsTaskExecutor } from "./cards-task-executor";
import { PromptManager } from "./prompt-manager";
import { ProviderManager } from "./provider-manager";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const queues: TaskQueue[] = [];
afterEach(async () => { for (const queue of queues.splice(0)) await queue.dispose(); });
const sourcePath = "C-知识库/数学/测试.md";
const targetPath = "D-习题库/数学/测试-decks.md";
const sourceContent = generateMarkdownContent(generateFrontmatter({ cruid: "node", type: "entity", name: "测试" }), "完整知识正文");
async function fixture(files = new Map<string, string>([[sourcePath, sourceContent]])) {
  const folders = new Set<string>();
  const adapter = {
    stat: async (path: string) => files.has(path) ? { type: "file" } : folders.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`)) ? { type: "folder" } : null,
    exists: async (path: string) => files.has(path),
    mkdir: async (path: string) => { folders.add(path); },
    read: async (path: string) => { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path)!; },
    write: async (path: string, content: string) => { files.set(path, content); },
    rename: async (from: string, to: string) => { files.set(to, await adapter.read(from)); files.delete(from); },
    remove: async (path: string) => { files.delete(path); },
    list: async (path: string) => {
      const descendants = [...files.keys()].filter((key) => key.startsWith(`${path}/`));
      return {
        files: descendants.filter((key) => !key.slice(path.length + 1).includes("/")),
        folders: [...new Set(descendants.filter((key) => key.slice(path.length + 1).includes("/")).map((key) => `${path}/${key.slice(path.length + 1).split("/")[0]}`))],
      };
    },
  };
  const getFile = (path: string) => { if (!files.has(path)) return null; const file = new TFile(); file.path = path; return file; };
  const vault = {
    adapter,
    getAbstractFileByPath: getFile,
    cachedRead: async (file: TFile) => adapter.read(file.path),
    create: async (path: string, content: string) => { if (files.has(path)) throw new Error("already exists"); files.set(path, content); return getFile(path); },
    process: async (file: TFile, update: (content: string) => string) => { files.set(file.path, update(await adapter.read(file.path))); },
  } as unknown as Vault;
  const storage = new FileStorage(vault, "plugin");
  await storage.initialize();
  await storage.recoverIncompleteWrites();
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers.cards = { apiKey: "test", baseUrl: "https://example.test", apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled", defaultChatModel: "other", defaultEmbedModel: "", enabled: true, enableWebSearch: false };
  settings.taskModels.cards = { providerId: "cards", model: "cards-model" };
  const settingsStore = { getSettings: () => settings, subscribe: () => () => undefined } as unknown as SettingsStore;
  const queue = new TaskQueue(logger, settingsStore, { fileStorage: storage });
  queues.push(queue);
  const notes = new NoteRepository({ vault } as App, logger);
  const service = new CardGenerationService({ storage, settings: settingsStore, notes, queue });
  queue.attachWorkflowPort(service.wrapPort({ resolve: async () => err("E310_INVALID_STATE", "not cards") }));
  expect((await queue.initialize()).ok).toBe(true);
  const run = vi.fn(async (_task: TaskRecord): Promise<Result<Record<string, unknown>>> => ok({ markdown: "## 问题\n答案" }));
  const start = () => queue.setTaskRunner({ run, abort() {} } as unknown as TaskRunner);
  return { files, service, queue, run, start, settings, folders, adapter, storage };
}

describe("card generation durable flow", () => {
  it('restores a completed Cards receipt after queue-save failure without calling the model or appending twice', async () => {
    const f = await fixture();
    const write = f.storage.atomicWrite.bind(f.storage);
    vi.spyOn(f.storage, 'atomicWrite').mockImplementation(async (path, text) => {
      if (path.includes('queue-state') && JSON.parse(text).tasks.some((task: TaskRecord) => task.state === 'completed')) return err('E303_DISK_FULL', 'synthetic terminal save failure');
      return write(path, text);
    });
    expect((await f.service.start(sourcePath)).ok).toBe(true); f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().tasks[0].localSavePending).toBe(true));
    const task = f.queue.getSnapshot().tasks[0];
    expect((await f.service.start(sourcePath)).ok).toBe(false);
    const artifactPath = [...f.files.keys()].find(path => path.includes('/cards/') && path.endsWith('.json'))!;
    expect(JSON.parse(f.files.get(artifactPath)!).state).toBe('completed');
    const appended = f.files.get(targetPath);
    const restored = await fixture(new Map(f.files)); restored.start();
    await vi.waitFor(() => expect(restored.queue.getTask(task.id)?.state).toBe('completed'));
    expect(restored.run).not.toHaveBeenCalled();
    expect(restored.files.get(targetPath)).toBe(appended);
    // An append intent without its completion receipt cannot prove whether the effect ran.
    const uncertainFiles = new Map(f.files);
    uncertainFiles.set(artifactPath, JSON.stringify({ ...JSON.parse(f.files.get(artifactPath)!), state: 'committing' }));
    const uncertain = await fixture(uncertainFiles); uncertain.start();
    expect(uncertain.queue.getTask(task.id)?.state).toBe('interrupted');
    expect(uncertain.run).not.toHaveBeenCalled();
    expect(uncertain.files.get(targetPath)).toBe(appended);
  });
  it("does not append a streamed partial batch when Responses explicitly finishes incomplete without a reason", async () => {
    const f = await fixture();
    f.settings.enableStreamingKeepalive = true;
    f.settings.providers.cards.apiFormat = "openai-responses";
    const streamRequester = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: [
        'data: {"type":"response.created","response":{"status":"in_progress","incomplete_details":null}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"## 部分卡片\\n未完成的答案"}\n\n',
        'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":null}}\n\n',
      ].join(""),
    }));
    const providerManager = new ProviderManager({ getSettings: () => f.settings } as SettingsStore, logger, undefined, streamRequester);
    const promptManager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    expect((await promptManager.preloadAllTemplates()).ok).toBe(true);
    const executor = new CardsTaskExecutor({ providerManager, promptManager });
    f.run.mockImplementation(async (task) => {
      if (task.stageId !== "cards") throw new Error("unexpected stage");
      return executor.execute(task, new AbortController().signal, {
        attemptReason: "initial", modelSnapshot: resolveTaskModelSnapshot(f.settings, "cards"),
      });
    });
    try {
      expect((await f.service.start(sourcePath)).ok).toBe(true);
      f.start();
      await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
      expect(f.queue.getSnapshot().tasks[0].error?.code).toBe("E207_PROVIDER_RESPONSE_UNSUPPORTED");
      expect(f.files.has(targetPath)).toBe(false);
      expect(f.files.get(sourcePath)).toBe(sourceContent);
      expect(streamRequester).toHaveBeenCalledOnce();
    } finally { providerManager.dispose(); }
  });

  it("waits for an accepted artifact write before disposal permits data reset", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const write = f.adapter.write;
    const blockedWrite = vi.spyOn(f.adapter, "write").mockImplementation(async (path, content) => {
      if (path.includes("/cards/")) await gate;
      return write(path, content);
    });
    const starting = f.service.start(sourcePath);
    await vi.waitFor(() => expect(blockedWrite).toHaveBeenCalled());
    let disposed = false;
    const disposing = Promise.resolve(f.service.dispose()).then(() => { disposed = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(disposed).toBe(false);
    } finally { release(); }
    await starting;
    await disposing;
    expect(disposed).toBe(true);
    expect(f.queue.getSnapshot().status.total).toBe(0);
  });

  it("creates the Decks file and appends another generation while retaining manual edits", async () => {
    const f = await fixture();
    expect(await f.service.start(sourcePath)).toEqual(ok(targetPath));
    f.files.set(sourcePath, sourceContent + "\n后续修改");
    f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.completed).toBe(1));
    expect(f.run.mock.calls[0][0].payload).toMatchObject({ body: "完整知识正文", targetPath });
    expect(f.files.get(targetPath)).toBe("---\ntags: [decks]\n---\n\n## 问题\n答案\n");
    const manual = f.files.get(targetPath)! + "手工内容  ";
    f.files.set(targetPath, manual);
    expect((await f.service.start(sourcePath)).ok).toBe(true);
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.completed).toBe(2));
    expect(f.files.get(targetPath)).toBe(manual + "\n\n## 问题\n答案\n");
    expect(f.files.get(sourcePath)).toBe(sourceContent + "\n后续修改");
    expect(f.folders.has("D-习题库/数学")).toBe(true);
  });

  it("cancels in-flight generation before a late complete result can append", async () => {
    const f = await fixture();
    let resolve!: (value: Result<Record<string, unknown>>) => void;
    f.run.mockImplementation(() => new Promise((done) => resolve = done));
    await f.service.start(sourcePath); f.start();
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
    const task = f.queue.getSnapshot().tasks[0];
    expect((await f.queue.cancelDurably(task.id)).ok).toBe(true);
    resolve(ok({ markdown: "## 不应写入\n答案" }));
    await vi.waitFor(() => expect(f.queue.getTask(task.id)?.state).toBe("interrupted"));
    expect(f.files.has(targetPath)).toBe(false);
    expect(await f.queue.retryFailedDurably()).toEqual(ok(0));
  });

  it("persists cancellation across reload and ignores a delayed offline result while a fresh generation succeeds", async () => {
    const f = await fixture();
    let release!: (value: Result<Record<string, unknown>>) => void;
    f.run.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    await f.service.start(sourcePath); f.start();
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
    const task = f.queue.getSnapshot().tasks[0];
    expect(await f.queue.cancelDurably(task.id)).toEqual(ok(true));
    const restored = await fixture(new Map(f.files)); restored.start();
    expect(restored.queue.getTask(task.id)?.state).toBe('interrupted');
    expect(restored.run).not.toHaveBeenCalled();
    expect(await restored.queue.retryFailedDurably()).toEqual(ok(0));
    release(ok({ markdown: 'late offline result must be discarded' }));
    await f.queue.dispose();
    expect(f.files.has(targetPath)).toBe(false);
    expect((await restored.service.start(sourcePath)).ok).toBe(true);
    await vi.waitFor(() => expect(restored.queue.getSnapshot().status.completed).toBe(1));
    expect(restored.run).toHaveBeenCalledOnce();
    expect(restored.files.get(targetPath)).not.toContain('late offline result');
    expect(restored.queue.getTask(task.id)?.state).toBe('interrupted');
    expect(restored.files.get(sourcePath)).toBe(sourceContent);
  });

  it("restores pending snapshots but interrupts running requests without replay", async () => {
    const f = await fixture();
    await f.service.start(sourcePath);
    const pending = await fixture(new Map(f.files)); pending.start();
    await vi.waitFor(() => expect(pending.queue.getSnapshot().status.completed).toBe(1));
    let resolve!: (value: Result<Record<string, unknown>>) => void;
    f.run.mockImplementation(() => new Promise((done) => resolve = done)); f.start();
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
    const restored = await fixture(new Map(f.files)); restored.start();
    expect(restored.queue.getSnapshot().status.interrupted).toBe(1);
    expect(restored.run).not.toHaveBeenCalled();
    expect(restored.files.has(targetPath)).toBe(false);
    await f.queue.cancelAllActiveDurably(); resolve(ok({ markdown: "late" }));
  });

  it("uses the default chat configuration for Cards without creating a separate provider", async () => {
    const f = await fixture();
    f.settings.defaultProviderId = "cards";
    f.settings.taskModels.cards = { providerId: "", model: "" };
    expect(resolveTaskModelSnapshot(f.settings, "cards")).toMatchObject({ providerId: "cards", model: "other" });
    expect((await f.service.start(sourcePath)).ok).toBe(true);
    expect(f.queue.getSnapshot().status.pending).toBe(1);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.settings.taskModels.cards).toEqual({ providerId: "", model: "" });
  });

  it("requires an available resolved model and rejects ordinary notes or paths outside the source root", async () => {
    const f = await fixture();
    f.settings.taskModels.cards = { providerId: "", model: "" };
    expect(await f.service.start(sourcePath)).toMatchObject({ ok: false, error: { code: "E401_PROVIDER_NOT_CONFIGURED" } });
    f.settings.taskModels.cards = { providerId: "cards", model: "cards-model" };
    f.files.set(sourcePath, "普通 Markdown");
    expect((await f.service.start(sourcePath)).ok).toBe(false);
    f.files.set("elsewhere.md", sourceContent);
    expect((await f.service.start("elsewhere.md")).ok).toBe(false);
    expect(f.queue.getSnapshot().status.total).toBe(0);
  });

  it("migrates legacy uncertain failures to interrupted and retains that state on another reload", async () => {
    const f = await fixture();
    await f.service.start(sourcePath);
    f.run.mockResolvedValue(err("E206_PROVIDER_REQUEST_UNCERTAIN", "unknown")); f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.interrupted).toBe(1));
    const queuePath = "plugin/data/queue-state-v5.json";
    const old = JSON.parse(f.files.get(queuePath)!);
    old.tasks[0].state = "failed";
    f.files.set(queuePath, JSON.stringify(old));
    const reloaded = await fixture(new Map(f.files));
    expect(reloaded.queue.getSnapshot().status.interrupted).toBe(1);
    const twice = await fixture(new Map(reloaded.files));
    expect(twice.queue.getSnapshot().status.interrupted).toBe(1);
  });
});
