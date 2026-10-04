import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type Vault } from "obsidian";
import { FileStorage } from "../data/file-storage";
import { DEFAULT_SETTINGS, type SettingsStore } from "../data/settings-store";
import { Validator } from "../data/validator";
import { TaskQueue } from "./task-queue";
import { TaskRunner } from "./task-runner";
import { DuplicateMergeService } from "./duplicate-merge-service";
import { MergeDraftGenerationService } from "./merge-draft-generation-service";
import { NoteRepository } from "./note-repository";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { schemaRegistry } from "./schema-registry";
import { ok, err, type ILogger, type TaskRecord, type DuplicateMergePreview } from "../types";
import type { CruidCache } from "./cruid-cache";
import type { DuplicateManager } from "./duplicate-manager";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const queues: TaskQueue[] = [];
afterEach(async () => { for (const queue of queues.splice(0)) await queue.dispose(); vi.useRealTimers(); });
const paths = { a: "notes/主笔记.md", b: "archive/来源笔记.md" };
const notes = new Map(Object.entries(paths).map(([id, path]) => [path, generateMarkdownContent(generateFrontmatter({ cruid: id, type: "entity", name: id }), `原始正文 ${id}`)]));
async function fixture(files = new Map(notes)) {
  const folders = new Set<string>();
  const adapter = {
    stat: async (path: string) => files.has(path) ? { type: "file" } : folders.has(path) || [...files.keys()].some(key => key.startsWith(path + "/")) ? { type: "folder" } : null,
    exists: async (path: string) => files.has(path), mkdir: async (path: string) => { folders.add(path); },
    read: async (path: string) => { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path)!; },
    write: async (path: string, content: string) => { files.set(path, content); },
    rename: async (from: string, to: string) => { files.set(to, await adapter.read(from)); files.delete(from); },
    remove: async (path: string) => { files.delete(path); },
    list: async (path: string) => ({ files: [...files.keys()].filter(key => key.startsWith(path + "/") && !key.slice(path.length + 1).includes("/")), folders: [] }),
  };
  const file = (path: string) => { if (!files.has(path)) return null; const result = new TFile(); result.path = path; result.name = path.split("/").at(-1)!; result.basename = result.name.replace(/\.md$/, ""); return result; };
  const vault = {
    adapter, getAbstractFileByPath: file, cachedRead: async (f: TFile) => adapter.read(f.path),
    getMarkdownFiles: () => [...files.keys()].filter(path => path.endsWith(".md")).map(path => file(path)!),
    trash: vi.fn(async (f: TFile) => { files.delete(f.path); }),
    process: vi.fn(async (f: TFile, update: (s: string) => string) => { files.set(f.path, update(await adapter.read(f.path))); }),
  } as unknown as Vault;
  const app = { vault, metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: extractFrontmatter(files.get(f.path)!)?.frontmatter, links: [] }) } } as unknown as App;
  const storage = new FileStorage(vault, "plugin"); await storage.initialize(); await storage.recoverIncompleteWrites();
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers.test = { apiKey: "fake", baseUrl: "https://example.test", apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "merge-model", defaultEmbedModel: "", enabled: true, enableWebSearch: false };
  settings.taskModels.merge = { providerId: "test", model: "merge-model" };
  const settingsStore = { getSettings: () => settings, subscribe: () => () => undefined } as unknown as SettingsStore;
  const chat = vi.fn(async () => ok({ content: JSON.stringify({ body: "生成合并稿", name: "合并名称", aliases: [], tags: [], parents: [], sourceUids: [], conflicts: [] }), finishReason: "stop" }));
  const gateway = { chat } as unknown as ModelGateway;
  const prompt = { build: (_role: string, vars: Record<string, string>) => `<system_instructions>合并契约</system_instructions>\n${vars.CTX_CURRENT}` } as unknown as PromptManager;
  const merge = new DuplicateMergeService({ app, fileStorage: storage, noteRepository: new NoteRepository(app, logger), cruidCache: { getFile: (id: string) => file(paths[id as keyof typeof paths]) } as unknown as CruidCache, duplicateManager: { getPair: () => ({ id: "a--b", nodeIdA: "a", nodeIdB: "b", type: "entity", similarity: .9, status: "pending" }) } as unknown as DuplicateManager, providerManager: gateway, promptManager: prompt, settingsStore, reindex: async () => ok({ indexed: 1, failed: 0 }), logger });
  const queue = new TaskQueue(logger, settingsStore, { fileStorage: storage }); queues.push(queue);
  const service = new MergeDraftGenerationService({ storage, settings: settingsStore, queue, merge });
  queue.attachWorkflowPort(service.wrapPort({ resolve: async () => err("E310_INVALID_STATE", "not merge") }));
  expect((await queue.initialize()).ok).toBe(true);
  const runner = new TaskRunner({ providerManager: gateway, promptManager: prompt, validator: new Validator(), logger, schemaRegistry, settingsStore, duplicateMergeService: merge });
  const start = () => queue.setTaskRunner(runner);
  return { files, storage, queue, service, merge, chat, settings, vault, start };
}

describe("queued duplicate merge draft generation", () => {
  it("durably captures selected primary/source before the request, deduplicates submissions, and never writes either note", async () => {
    const f = await fixture();
    const [accepted, duplicate] = await Promise.all([f.service.start("a--b", "b"), f.service.start("a--b", "a")]);
    expect(accepted.ok).toBe(true); expect(duplicate.ok).toBe(false);
    expect(f.chat).not.toHaveBeenCalled();
    const task = f.queue.getSnapshot().tasks[0];
    expect(task).toMatchObject({ stageId: "merge", nodeId: "b", filePath: paths.b, state: "pending" });
    const snapshot = task.stageId === "merge" ? task.payload.canonical.content : "";
    f.files.set(paths.b, snapshot + "\n阅读后的微调"); f.start();
    await vi.waitFor(() => expect(f.queue.getTask(task.id)?.state).toBe("completed"));
    expect(f.chat).toHaveBeenCalledOnce();
    const draft = await f.service.getDraft(task.workflowId!);
    expect(draft.ok && draft.value.canonical.content).toBe(snapshot);
    expect(f.files.get(paths.a)).toBe(notes.get(paths.a));
    expect(f.files.get(paths.b)).toBe(snapshot + "\n阅读后的微调");
    expect(f.vault.trash).not.toHaveBeenCalled(); expect(f.vault.process).not.toHaveBeenCalled();
    if (draft.ok) expect(await f.merge.confirmMerge(draft.value.draft, draft.value.linkRepairPlan)).toMatchObject({ ok: false, error: { code: "E320_TASK_CONFLICT" } });
  });
  it("restores pending snapshots and resumes a completed draft receipt without another request when queue completion failed", async () => {
    const f = await fixture(); await f.service.start("a--b", "a");
    const pending = await fixture(new Map(f.files)); pending.start();
    await vi.waitFor(() => expect(pending.queue.getSnapshot().status.completed).toBe(1)); expect(pending.chat).toHaveBeenCalledOnce();
    const write = f.storage.atomicWrite.bind(f.storage);
    vi.spyOn(f.storage, "atomicWrite").mockImplementation(async (path, text) => path.includes("queue-state") && JSON.parse(text).tasks.some((task: TaskRecord) => task.state === "completed") ? err("E303_DISK_FULL", "synthetic") : write(path, text));
    f.start(); await vi.waitFor(() => expect(f.queue.getSnapshot().tasks[0].localSavePending).toBe(true));
    const task = f.queue.getSnapshot().tasks[0];
    expect((await f.service.getDraft(task.workflowId!)).ok).toBe(true);
    const restored = await fixture(new Map(f.files)); restored.start();
    await vi.waitFor(() => expect(restored.queue.getTask(task.id)?.state).toBe("completed"));
    expect(restored.chat).not.toHaveBeenCalled();
    expect(restored.files.get(paths.a)).toBe(notes.get(paths.a)); expect(restored.files.get(paths.b)).toBe(notes.get(paths.b));
    expect((await restored.queue.removeTerminalDurably()).ok).toBe(true);
    expect((await restored.service.findReadyDraft("a--b")).ok).toBe(true);
    expect((await restored.service.getDraft(task.workflowId!)).ok).toBe(true);
  });
  it("retries an in-process draft storage failure using the queue's cached result, not the model", async () => {
    const f = await fixture(); await f.service.start("a--b", "a");
    const write = f.storage.atomicWrite.bind(f.storage); let blocked = true;
    vi.spyOn(f.storage, "atomicWrite").mockImplementation(async (path, text) => blocked && path.includes("merge-drafts") && JSON.parse(text).preview ? err("E303_DISK_FULL", "synthetic") : write(path, text));
    f.start(); await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
    const task = f.queue.getSnapshot().tasks[0]; expect(f.chat).toHaveBeenCalledOnce(); blocked = false;
    expect((await f.queue.retryDurably(task.id)).ok).toBe(true);
    await vi.waitFor(() => expect(f.queue.getTask(task.id)?.state).toBe("completed")); expect(f.chat).toHaveBeenCalledOnce();
  });
  it("keeps cancelled/running reload requests uncertain and discards uncooperative late results", async () => {
    const f = await fixture(); let release!: (value: Awaited<ReturnType<typeof f.chat>>) => void;
    const success = await f.chat(); f.chat.mockClear(); f.chat.mockImplementation(() => new Promise(resolve => release = resolve));
    await f.service.start("a--b", "a"); f.start(); await vi.waitFor(() => expect(f.chat).toHaveBeenCalledOnce());
    const task = f.queue.getSnapshot().tasks[0];
    const restored = await fixture(new Map(f.files)); restored.start();
    expect(restored.queue.getTask(task.id)?.state).toBe("interrupted"); expect(restored.chat).not.toHaveBeenCalled();
    expect((await f.queue.cancelDurably(task.id)).ok).toBe(true); release(success);
    await vi.waitFor(() => expect(f.queue.getTask(task.id)?.state).toBe("interrupted"));
    expect((await f.service.getDraft(task.workflowId!)).ok).toBe(false);
    expect(await f.queue.retryFailedDurably()).toEqual(ok(0)); expect((await f.service.start("a--b", "b")).ok).toBe(false);
    expect(f.files.get(paths.a)).toBe(notes.get(paths.a)); expect(f.files.get(paths.b)).toBe(notes.get(paths.b));
  });
  it("rejects a result or receipt for a different confirmed source", async () => {
    const f = await fixture(); const accepted = await f.service.start("a--b", "a"); expect(accepted.ok).toBe(true);
    const task = f.queue.getSnapshot().tasks[0];
    const fake = { ...task, nodeId: "wrong" } as TaskRecord;
    expect(await f.service.wrapPort({ resolve: async () => err("E310_INVALID_STATE", "not merge") }).resolve(fake as Parameters<ReturnType<typeof f.service.wrapPort>["resolve"]>[0])).toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    const artifactPath = [...f.files.keys()].find(path => path.includes("merge-drafts") && path.endsWith(".json"))!;
    const artifact = JSON.parse(f.files.get(artifactPath)!); artifact.preview = { ...artifact.input, draft: { canonicalNodeId: "other" } } as DuplicateMergePreview;
    f.files.set(artifactPath, JSON.stringify(artifact));
    expect((await f.service.getDraft(task.workflowId!)).ok).toBe(false);
  });
  it("treats a provider deadline as unknown, never retries automatically, and cannot commit a late draft", async () => {
    const f = await fixture(); f.settings.taskTimeoutMs = 1000;
    const success = await f.chat(); f.chat.mockClear();
    let release!: (value: typeof success) => void;
    f.chat.mockImplementation(() => new Promise(resolve => release = resolve));
    await f.service.start("a--b", "a");
    vi.useFakeTimers();
    try {
      f.start(); await vi.advanceTimersByTimeAsync(0); expect(f.chat).toHaveBeenCalledOnce();
      const task = f.queue.getSnapshot().tasks[0];
      await vi.advanceTimersByTimeAsync(1001);
      expect(f.queue.getTask(task.id)).toMatchObject({ state: "interrupted", error: { kind: "uncertain", code: "E206_PROVIDER_REQUEST_UNCERTAIN" } });
      expect(await f.queue.retryFailedDurably()).toEqual(ok(0));
      expect((await f.queue.retryDurably(task.id)).ok).toBe(false);
      release(success); await vi.advanceTimersByTimeAsync(0);
      expect((await f.service.getDraft(task.workflowId!)).ok).toBe(false); expect(f.chat).toHaveBeenCalledOnce();
      expect(f.files.get(paths.a)).toBe(notes.get(paths.a)); expect(f.files.get(paths.b)).toBe(notes.get(paths.b));
    } finally { release(success); vi.useRealTimers(); }
  });
  it("does not report acceptance or issue a request when the queue intent fails to save", async () => {
    const f = await fixture(); const write = f.storage.atomicWrite.bind(f.storage);
    vi.spyOn(f.storage, "atomicWrite").mockImplementation(async (path, text) => path.includes("queue-state") ? err("E303_DISK_FULL", "synthetic") : write(path, text));
    expect(await f.service.start("a--b", "a")).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    f.start(); expect(f.queue.getSnapshot().status.total).toBe(0); expect(f.chat).not.toHaveBeenCalled();
    expect([...f.files.keys()].filter(path => path.includes("merge-drafts") && path.endsWith(".json"))).toHaveLength(0);
  });
});
