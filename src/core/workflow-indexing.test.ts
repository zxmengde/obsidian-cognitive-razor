import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type Vault } from "obsidian";
import { FileStorage } from "../data/file-storage";
import { WorkflowStore } from "../data/workflow-store";
import { DEFAULT_SETTINGS, type SettingsStore } from "../data/settings-store";
import { TaskQueue } from "./task-queue";
import { WorkflowCoordinator, type WorkflowCoordinatorDeps } from "./workflow-coordinator";
import { NoteRepository } from "./note-repository";
import { ContentRenderer } from "./content-renderer";
import type { TaskRunner } from "./task-runner";
import { err, ok, type ConfirmedConcept, type ILogger, type Result, type TaskRecord, type TaskExecutionContext } from "../types";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import type { NoteState, WorkflowArtifact } from "../types";
import { recoverInterruptedReset } from "../data/runtime-data-maintenance";

const concept: ConfirmedConcept = { type: "entity", name: { chinese: "验收概念", english: "Acceptance" }, coreDefinition: "测试定义", parents: [], source: "define" };
const queues: TaskQueue[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const queue of queues.splice(0)) await queue.dispose();
});

/** Real storage, queue, coordinator and note projection; only the host adapter
 * and billable model boundary are simulated. Reloads use serialized bytes. */
type FixtureOptions = Pick<WorkflowCoordinatorDeps, "failurePoint" | "indexNote" | "onIndexingFailed"> & {
  autoVerify?: boolean;
  semanticIndexing?: boolean;
};
async function fixture(files = new Map<string, string>(), options: FixtureOptions = {}) {
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const indexNote = vi.fn(options.indexNote ?? (async () => ok({ indexed: 1, failed: 0 })));
  const onIndexingFailed = vi.fn(options.onIndexingFailed ?? (() => undefined));
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
  const resetRecovery = await recoverInterruptedReset(storage);
  if (!resetRecovery.ok) throw new Error(resetRecovery.error.message);
  await storage.recoverIncompleteWrites();
  const store = new WorkflowStore(storage, logger);
  await store.initialize();
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.enableAutoVerify = options.autoVerify ?? false;
  settings.enableSemanticIndexing = options.semanticIndexing ?? true;
  settings.concurrency = 1;
  const settingsStore = { getSettings: () => settings, subscribe: () => () => undefined } as unknown as SettingsStore;
  const queue = new TaskQueue(logger, settingsStore, { fileStorage: storage });
  queues.push(queue);
  const repository = new NoteRepository({ vault } as App, logger);
  const coordinator = new WorkflowCoordinator({ workflowStore: store, taskQueue: queue, noteRepository: repository, contentRenderer: new ContentRenderer(), settingsStore, logger, failurePoint: options.failurePoint, indexNote, onIndexingFailed });
  queue.attachWorkflowPort(coordinator.queuePort);
  const initialized = await queue.initialize();
  if (initialized.ok) await coordinator.initializeAndRecover();
  const run = vi.fn(async (task: TaskRecord, _context: TaskExecutionContext): Promise<Result<Record<string, unknown>>> => {
    if (task.stageId === "tag") return ok({ aliases: ["Alias"], tags: ["acceptance"] });
    if (task.stageId === "verify") return ok({ reportText: "已核查的测试报告 $&", responseId: "verify-response" });
    return ok({ phaseResult: task.stageId === "core" ? { definition: "测试定义" } : { holistic_understanding: "测试综述" }, responseId: `${task.stageId}-response` });
  });
  const runner = { run, abort: vi.fn() } as unknown as TaskRunner;
  const start = () => queue.setTaskRunner(runner);
  return { files, vault, storage, store, queue, coordinator, repository, run, start, settings, initialized, indexNote, onIndexingFailed, logger };
}

async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.coordinator.startCreate(concept, { targetPathOverride: "Acceptance.md" });
  expect(result.ok).toBe(true);
  return result.ok ? result.value : "";
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function completed(f: Fixture, count = 3) {
  await vi.waitFor(() => expect(f.queue.getSnapshot().status).toMatchObject({ completed: count, pending: 0, running: 0, failed: 0 }));
  await vi.waitFor(() => expect(f.store.list()).toHaveLength(0));
}

const indexingCases: Array<{ label: string; indexNote: NonNullable<WorkflowCoordinatorDeps["indexNote"]>; failed: boolean }> = [
  { label: "successful indexing", indexNote: async () => ok({ indexed: 1, failed: 0 }), failed: false },
  { label: "successful no-op", indexNote: async () => ok({ indexed: 0, failed: 0 }), failed: false },
  { label: "Result error", indexNote: async () => err("E303_DISK_FULL", "full"), failed: true },
  { label: "counted failure", indexNote: async () => ok({ indexed: 0, failed: 1 }), failed: true },
  { label: "partial failure", indexNote: async () => ok({ indexed: 1, failed: 1 }), failed: true },
  { label: "thrown exception", indexNote: async () => { throw new Error("embedding unavailable"); }, failed: true },
];

describe.each(["normal Write", "applied-checkpoint recovery"] as const)("non-blocking indexing after %s", (route) => {
  async function finish(options: FixtureOptions = {}) {
    let crashBytes: Map<string, string> | undefined;
    const first = await fixture(undefined, {
      ...options,
      failurePoint: route === "normal Write" ? undefined : (point, context) => {
        if (point === "applied-checkpoint" && context.stageId === "synthesis") {
          crashBytes = new Map(first.files);
          throw new Error("simulated crash before indexing");
        }
      },
    });
    await create(first); first.start();
    if (route === "normal Write") { await completed(first); return first; }
    await vi.waitFor(() => expect(crashBytes).toBeDefined());
    expect(first.indexNote).not.toHaveBeenCalled();
    const recovered = await fixture(crashBytes, options);
    recovered.start();
    await completed(recovered);
    expect(recovered.run).not.toHaveBeenCalled();
    return recovered;
  }

  it.each(indexingCases)("keeps generated note and queue completed for $label", async ({ indexNote, failed }) => {
    const f = await finish({ indexNote });
    expect(f.files.get("Acceptance.md")).toContain("测试综述");
    expect(f.indexNote).toHaveBeenCalledOnce();
    expect(f.indexNote).toHaveBeenCalledWith(extractFrontmatter(f.files.get("Acceptance.md")!)?.frontmatter.cruid);
    if (failed) {
      expect(f.onIndexingFailed).toHaveBeenCalledExactlyOnceWith("Acceptance");
      expect(f.logger.warn).toHaveBeenCalledWith("WorkflowCoordinator", expect.stringContaining("自动向量化未完成"), expect.objectContaining({ workflowId: expect.any(String) }));
    } else {
      expect(f.onIndexingFailed).not.toHaveBeenCalled();
      expect(f.logger.warn).not.toHaveBeenCalled();
    }
    const reloaded = await fixture(new Map(f.files)); reloaded.start();
    expect(reloaded.indexNote).not.toHaveBeenCalled();
    expect(reloaded.onIndexingFailed).not.toHaveBeenCalled();
  });

  it.each(["synchronous", "asynchronous"])("also tolerates a %s notification exception", async (mode) => {
    const f = await finish({
      indexNote: async () => err("E303_DISK_FULL", "full"),
      onIndexingFailed: mode === "synchronous"
        ? () => { throw new Error("notice unavailable"); }
        : async () => { throw new Error("notice unavailable"); },
    });
    expect(f.indexNote).toHaveBeenCalledOnce();
    expect(f.onIndexingFailed).toHaveBeenCalledExactlyOnceWith("Acceptance");
    expect(f.logger.warn).toHaveBeenCalledWith("WorkflowCoordinator", "自动向量化失败通知未能显示", expect.any(Object));
  });

  it("does not request indexing or issue a warning when semantic indexing is disabled", async () => {
    const f = await finish({ semanticIndexing: false, indexNote: async () => { throw new Error("must not run"); } });
    expect(f.indexNote).not.toHaveBeenCalled();
    expect(f.onIndexingFailed).not.toHaveBeenCalled();
    expect(f.logger.warn).not.toHaveBeenCalled();
  });
});

describe.each([false, true])("completed receipt (autoVerify=%s)", (autoVerify) => {
  it.each(indexingCases)("does not charge indexing twice when replaying a completed receipt after $label", async ({ indexNote, failed }) => {
    const f = await fixture(undefined, { indexNote, autoVerify });
    const finalStage = autoVerify ? "verify" : "synthesis";
    const write = f.storage.atomicWrite.bind(f.storage);
    vi.spyOn(f.storage, "atomicWrite").mockImplementation(async (path, content) => {
      if (path.includes("queue-state") && JSON.parse(content).tasks.some((task: TaskRecord) => task.stageId === finalStage && task.state === "completed")) {
        return err("E303_DISK_FULL", "queue commit failed");
      }
      return write(path, content);
    });
    await create(f); f.start();
    await vi.waitFor(() => expect(f.indexNote).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.store.list()[0]?.state).toBe("completed"));
    if (failed) await vi.waitFor(() => expect(f.onIndexingFailed).toHaveBeenCalledOnce());
    const reload = await fixture(new Map(f.files), { indexNote }); reload.start();
    await completed(reload, autoVerify ? 4 : 3);
    expect(reload.run).not.toHaveBeenCalled();
    expect(reload.indexNote).not.toHaveBeenCalled();
    expect(reload.onIndexingFailed).not.toHaveBeenCalled();
    expect(f.indexNote).toHaveBeenCalledOnce();
  });
});

const maturityCases = (["seed", "draft", "evergreen"] as const)
  .flatMap((status) => ["通过", "建议修改", "未通过"].map((report) => ({ status, report })));

async function prepareVerify(f: Fixture, status: NoteState, automatic: boolean) {
  const snapshot = generateMarkdownContent(generateFrontmatter({ cruid: "verify-node", type: "entity", name: "Acceptance", status }), "正文");
  f.files.set("Acceptance.md", snapshot);
  if (!automatic) {
    expect((await f.coordinator.startVerify("Acceptance.md")).ok).toBe(true);
    return;
  }
  // Model a completed Write checkpoint at the Verify boundary. Verify must
  // preserve any captured maturity, including migrated/historic artifacts.
  const artifact: WorkflowArtifact = {
    version: "7.0.0", workflowId: "automatic-verify", kind: "create", state: "active",
    nodeId: "verify-node", type: "entity", filePath: "Acceptance.md", noteTitle: "Acceptance",
    parents: [], concept: { name: concept.name, coreDefinition: concept.coreDefinition }, autoVerify: true,
    accumulated: {}, contentSnapshot: snapshot, noteCreated: true,
    appliedStageIds: ["tag", "core", "synthesis"], createdAt: Date.now(), updatedAt: Date.now(),
  };
  expect((await f.store.create(artifact)).ok).toBe(true);
  expect((await f.coordinator.initializeAndRecover()).ok).toBe(true);
}

describe.each([false, true])("Verify preserves maturity (automatic=%s)", (automatic) => {
  it.each(maturityCases)("preserves $status for report $report", async ({ status, report }) => {
    const f = await fixture();
    await prepareVerify(f, status, automatic);
    f.run.mockImplementation(async () => ok({ reportText: report }));
    f.start(); await completed(f, 1);
    const content = f.files.get("Acceptance.md")!;
    expect(extractFrontmatter(content)?.frontmatter.status).toBe(status);
    expect(content).toContain(report);
    if (!automatic) expect(f.indexNote).not.toHaveBeenCalled();
  });

  it.each(maturityCases)("preserves $status for cached $report without re-requesting Verify", async ({ status, report }) => {
    let crashBytes: Map<string, string> | undefined;
    const f = await fixture(undefined, { failurePoint: (point, context) => {
      if (point === "vault-commit-confirmed" && context.stageId === "verify") {
        crashBytes = new Map(f.files);
        throw new Error("simulated crash after report write");
      }
    } });
    await prepareVerify(f, status, automatic);
    f.run.mockImplementation(async () => ok({ reportText: report }));
    f.start();
    await vi.waitFor(() => expect(crashBytes).toBeDefined());
    const reload = await fixture(crashBytes); reload.start(); await completed(reload, 1);
    const content = reload.files.get("Acceptance.md")!;
    expect(extractFrontmatter(content)?.frontmatter.status).toBe(status);
    expect(content).toContain(report);
    expect(content.match(/<!-- cognitive-razor:verify-report -->/g)).toHaveLength(1);
    expect(reload.run).not.toHaveBeenCalled();
    if (!automatic) expect(reload.indexNote).not.toHaveBeenCalled();
  });
});


it.each(["通过", "建议修改", "未通过"])("keeps draft through the full automatic Verify pipeline for %s", async (report) => {
  const f = await fixture(undefined, { autoVerify: true });
  const originalRun = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (task, context) => task.stageId === "verify" ? ok({ reportText: report }) : originalRun(task, context));
  await create(f); f.start(); await completed(f, 4);
  expect(f.run.mock.calls.map(([task]) => task.stageId)).toEqual(["tag", "core", "synthesis", "verify"]);
  expect(extractFrontmatter(f.files.get("Acceptance.md")!)?.frontmatter.status).toBe("draft");
  expect(f.files.get("Acceptance.md")).toContain(report);
  expect(f.indexNote).toHaveBeenCalledOnce();
  expect(f.onIndexingFailed).not.toHaveBeenCalled();
});


describe("indexing respects workflow disposal", () => {
  it("does not start indexing when disposed while saving the completed receipt", async () => {
    const f = await fixture();
    const update = f.store.update.bind(f.store);
    vi.spyOn(f.store, "update").mockImplementation(async (workflowId, patch) => {
      const result = await update(workflowId, patch);
      if (patch.state === "completed") await f.coordinator.dispose();
      return result;
    });
    await create(f); f.start(); await completed(f);
    expect(f.indexNote).not.toHaveBeenCalled();
    expect(f.onIndexingFailed).not.toHaveBeenCalled();
  });

  it.each(["error-result", "counted-failure", "exception"])("suppresses a late %s notification after disposal", async (failure) => {
    let resolveIndex!: (result: Result<{ indexed: number; failed: number }>) => void;
    let rejectIndex!: (cause: unknown) => void;
    const f = await fixture(undefined, { indexNote: () => new Promise((resolve, reject) => {
      resolveIndex = resolve;
      rejectIndex = reject;
    }) });
    await create(f); f.start();
    await vi.waitFor(() => expect(f.indexNote).toHaveBeenCalledOnce());
    await f.coordinator.dispose();
    if (failure === "exception") rejectIndex(new Error("late embedding failure"));
    else resolveIndex(failure === "error-result" ? err("E303_DISK_FULL", "late failure") : ok({ indexed: 0, failed: 1 }));
    await completed(f);
    expect(f.indexNote).toHaveBeenCalledOnce();
    expect(f.onIndexingFailed).not.toHaveBeenCalled();
    expect(f.logger.warn).not.toHaveBeenCalled();
  });
});
