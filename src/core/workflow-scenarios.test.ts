import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type Vault } from "obsidian";
import { FileStorage } from "../data/file-storage";
import { WorkflowStore } from "../data/workflow-store";
import { DEFAULT_SETTINGS, type SettingsStore } from "../data/settings-store";
import { TaskQueue } from "./task-queue";
import { WorkflowCoordinator, type WorkflowCoordinatorDeps, type WorkflowCommitFailurePoint } from "./workflow-coordinator";
import { NoteRepository } from "./note-repository";
import { ContentRenderer } from "./content-renderer";
import type { TaskRunner } from "./task-runner";
import { err, ok, type ConfirmedConcept, type ILogger, type Result, type TaskRecord, type TaskExecutionContext } from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import { extractFrontmatter } from "./frontmatter-utils";
import { getWriteStageIds } from "./stage-catalog";
import { backupAndClearPluginData, recoverInterruptedReset } from "../data/runtime-data-maintenance";

const concept: ConfirmedConcept = { type: "entity", name: { chinese: "验收概念", english: "Acceptance" }, coreDefinition: "测试定义", parents: [], source: "define" };
const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const queues: TaskQueue[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const queue of queues.splice(0)) await queue.dispose();
});

function readFrontmatterTimestamp(content: string, field: "created" | "updated"): string | undefined {
  return new RegExp(`^${field}:\\s*(.*)$`, "m").exec(content)?.[1];
}

/** Real storage, queue, coordinator and note projection; only the host adapter
 * and billable model boundary are simulated. Reloads use serialized bytes. */
async function fixture(files = new Map<string, string>(), failurePoint?: WorkflowCoordinatorDeps["failurePoint"]) {
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
  settings.enableAutoVerify = true;
  settings.concurrency = 1;
  const settingsStore = { getSettings: () => settings, subscribe: () => () => undefined } as unknown as SettingsStore;
  const queue = new TaskQueue(logger, settingsStore, { fileStorage: storage });
  queues.push(queue);
  const repository = new NoteRepository({ vault } as App, logger);
  const coordinator = new WorkflowCoordinator({ workflowStore: store, taskQueue: queue, noteRepository: repository, contentRenderer: new ContentRenderer(), settingsStore, logger, failurePoint });
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
  return { files, vault, storage, store, queue, coordinator, repository, run, start, settings, initialized };
}

async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await f.coordinator.startCreate(concept, { targetPathOverride: "Acceptance.md" });
  expect(result.ok).toBe(true);
  return result.ok ? result.value : "";
}

it("does not re-enqueue a Create stage after recovery marks its running request interrupted", async () => {
  const f = await fixture();
  let release!: (value: Result<Record<string, unknown>>) => void;
  f.run.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  await create(f); f.start();
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
  const reloaded = await fixture(new Map(f.files)); reloaded.start();
  expect(reloaded.queue.getSnapshot().tasks).toHaveLength(1);
  expect(reloaded.queue.getSnapshot().status.interrupted).toBe(1);
  expect(reloaded.run).not.toHaveBeenCalled();
  await f.queue.cancelAllActiveDurably(); release(ok({ aliases: [], tags: [] }));
});

it("retains unknown queued stages without restarting their active workflow", async () => {
  const f = await fixture();
  await create(f);
  const path = "plugin/data/queue-state-v5.json";
  const queued = JSON.parse(f.files.get(path)!);
  queued.tasks[0].stageId = "retired-stage";
  f.files.set(path, JSON.stringify(queued));
  const reloaded = await fixture(new Map(f.files)); reloaded.start();
  expect(reloaded.initialized.ok).toBe(true);
  expect(reloaded.queue.getSnapshot().tasks).toHaveLength(0);
  expect(reloaded.run).not.toHaveBeenCalled();
  await reloaded.queue.pauseDurably();
  expect(JSON.parse(reloaded.files.get(path)!).tasks[0].stageId).toBe("retired-stage");
});

async function completed(f: Awaited<ReturnType<typeof fixture>>, count = 4) {
  await vi.waitFor(() => expect(f.queue.getSnapshot().status).toMatchObject({ completed: count, pending: 0, running: 0, failed: 0 }));
}

describe("Create maturity checkpoints", () => {
  const maturity = (f: Awaited<ReturnType<typeof fixture>>) => extractFrontmatter(f.files.get("Acceptance.md")!)?.frontmatter.status;

  it.each(["domain", "issue", "theory", "entity", "mechanism"] as const)("marks %s draft only in the final committed Write", async (type) => {
    const observed: Array<{ stage: string; status: string | undefined }> = [];
    const f = await fixture(undefined, (point, context) => {
      if (point === "vault-commit-confirmed") observed.push({ stage: context.stageId, status: maturity(f) });
    });
    expect((await f.coordinator.startCreate({ ...concept, type }, { targetPathOverride: "Acceptance.md" })).ok).toBe(true);
    expect(maturity(f)).toBe("seed");
    f.start(); const writes = getWriteStageIds(type); await completed(f, writes.length + 2);
    expect(observed).toEqual([
      { stage: "tag", status: "seed" },
      ...writes.map((stage, index) => ({ stage, status: index === writes.length - 1 ? "draft" : "seed" })),
      { stage: "verify", status: "draft" },
    ]);
    expect(f.run.mock.calls.filter(([task]) => task.stageId === "verify")).toHaveLength(1);
  });

  async function pausedAfterCore() {
    const f = await fixture(undefined, async (point, context) => {
      if (point === "applied-checkpoint" && context.stageId === "core") await f.queue.pauseDurably();
    });
    await create(f); f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status).toMatchObject({ paused: true, completed: 2, pending: 1, running: 0 }));
    return f;
  }

  it("keeps an incomplete Write seed while paused and reloaded, then runs one Verify after the final Write", async () => {
    const f = await pausedAfterCore(); expect(maturity(f)).toBe("seed");
    const reload = await fixture(new Map(f.files)); reload.start();
    expect(maturity(reload)).toBe("seed"); expect(reload.queue.getSnapshot().status.paused).toBe(true);
    expect(reload.run).not.toHaveBeenCalled();
    await reload.queue.resumeDurably(); await completed(reload);
    expect(maturity(reload)).toBe("draft");
    expect(reload.run.mock.calls.map(([task]) => task.stageId)).toEqual(["synthesis", "verify"]);
  });

  it.each(["failed", "cancelled"] as const)("never upgrades a %s incomplete Write or schedules Verify on reload", async (stop) => {
    const f = await pausedAfterCore(); const next = f.queue.getSnapshot().tasks.find(task => task.state === "pending")!;
    if (stop === "cancelled") expect((await f.queue.cancelDurably(next.id)).ok).toBe(true);
    else {
      f.run.mockImplementation(async () => err("E211_MODEL_SCHEMA_VIOLATION", "synthetic failure"));
      await f.queue.resumeDurably(); await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
    }
    expect(maturity(f)).toBe("seed");
    const reload = await fixture(new Map(f.files)); reload.start(); await reload.queue.resumeDurably();
    expect(maturity(reload)).toBe("seed"); expect(reload.run).not.toHaveBeenCalled();
    expect(reload.queue.getSnapshot().tasks.some(task => task.stageId === "verify")).toBe(false);
  });

  it("keeps seed if the last Write result is valid but its Vault commit fails", async () => {
    const f = await pausedAfterCore();
    vi.spyOn(f.repository, "replaceIfUnchanged").mockRejectedValueOnce(new Error("synthetic disk failure"));
    await f.queue.resumeDurably(); await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
    expect(maturity(f)).toBe("seed");
    expect(f.store.list()[0]?.pendingStageResult?.stageId).toBe("synthesis");
    expect(f.queue.getSnapshot().tasks.some(task => task.stageId === "verify")).toBe(false);
  });

  it("retains draft after all Writes are committed even if Verify fails", async () => {
    const f = await fixture(); const normal = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (task, context) => task.stageId === "verify" ? err("E401_PROVIDER_NOT_CONFIGURED", "synthetic missing audit provider") : normal(task, context));
    await create(f); f.start(); await vi.waitFor(() => expect(f.queue.getSnapshot().status).toMatchObject({ completed: 3, failed: 1, running: 0 }));
    expect(maturity(f)).toBe("draft"); expect(f.files.get("Acceptance.md")).not.toContain("事实核查报告");
  });

  it("replays a saved intermediate Write as seed before finishing later Writes", async () => {
    let saved: Map<string, string> | undefined;
    const f = await fixture(undefined, (point, context) => {
      if (point === "vault-commit-confirmed" && context.stageId === "core") {
        saved = new Map(f.files); throw new Error("synthetic crash after intermediate Vault commit");
      }
    });
    await create(f); f.start(); await vi.waitFor(() => expect(saved).toBeDefined());
    expect(maturity(f)).toBe("seed");
    const replayStatuses: Array<{ stage: string; status: string | undefined }> = [];
    const reload = await fixture(saved, (point, context) => {
      if (point === "vault-commit-confirmed") replayStatuses.push({ stage: context.stageId, status: maturity(reload) });
    });
    reload.start(); await completed(reload);
    expect(replayStatuses).toEqual([{ stage: "core", status: "seed" }, { stage: "synthesis", status: "draft" }, { stage: "verify", status: "draft" }]);
    expect(reload.run.mock.calls.map(([task]) => task.stageId)).toEqual(["synthesis", "verify"]);
  });
});

describe("workflow user scenarios", () => {
  it("preserves edits made immediately after the Tag write is confirmed", async () => {
    const f = await fixture();
    await create(f);
    const read = f.vault.cachedRead.bind(f.vault);
    let editedContent: string | undefined;
    vi.spyOn(f.vault, "cachedRead").mockImplementation(async (file) => {
      const content = await read(file);
      if (!editedContent && file.path === "Acceptance.md" && content.includes('tags: ["acceptance"]')) {
        editedContent = `${content}\n用户在标签提交后补充的内容\n`;
        f.files.set(file.path, editedContent);
      }
      return content;
    });
    f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.running).toBe(0));
    await vi.waitFor(() => expect(f.queue.getSnapshot().tasks.some((task) => task.stageId === "core" && (task.state === "failed" || task.state === "completed"))).toBe(true));
    expect(editedContent).toBeDefined();
    expect(f.files.get("Acceptance.md")).toBe(editedContent);
    expect(f.queue.getSnapshot().tasks.find((task) => task.stageId === "core")?.error?.code).toBe("E320_TASK_CONFLICT");
  });

  it("runs Tag -> Core -> Synthesis -> automatic Verify and keeps terminal history after reload", async () => {
    const f = await fixture();
    await create(f);
    f.start();
    await completed(f);
    expect(f.run.mock.calls.map(([task]) => task.stageId)).toEqual(["tag", "core", "synthesis", "verify"]);
    expect(f.files.get("Acceptance.md")).toContain("status: draft");
    expect(f.files.get("Acceptance.md")).toContain("已核查的测试报告 $&");
    await vi.waitFor(() => expect(f.store.list()).toHaveLength(0));
    const reload = await fixture(new Map(f.files));
    expect(reload.queue.getSnapshot().status.completed).toBe(4);
    reload.start();
    expect(reload.run).not.toHaveBeenCalled();
  });

  it("derives the note's updated time from the durable stage commit and keeps created", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const created = new Date("2027-01-01T00:00:00Z");
    const committed = new Date("2027-01-01T00:05:00Z");
    vi.setSystemTime(created);

    const wroteNote: Array<{ stage: string; updated?: string; committedAt?: number }> = [];
    const observed: { files?: Map<string, string>; store?: WorkflowStore } = {};
    const f = await fixture(undefined, (at, context) => {
      if (at !== "vault-commit-confirmed") return;
      wroteNote.push({
        stage: context.stageId,
        updated: readFrontmatterTimestamp(observed.files?.get("Acceptance.md") ?? "", "updated"),
        committedAt: observed.store?.get(context.workflowId)?.pendingStageResult?.committedAt,
      });
    });
    observed.files = f.files;
    observed.store = f.store;

    await create(f);
    const draft = f.files.get("Acceptance.md") ?? "";
    expect(readFrontmatterTimestamp(draft, "created")).toBe(formatCRTimestamp(created));
    expect(readFrontmatterTimestamp(draft, "updated")).toBe(formatCRTimestamp(created));

    vi.setSystemTime(committed);
    f.start();
    await completed(f);

    expect(wroteNote.map((entry) => entry.stage)).toEqual(["tag", "core", "synthesis", "verify"]);
    for (const entry of wroteNote) {
      expect(entry.committedAt).toBeDefined();
      // The visible update time follows the durable commit, so a replay after a
      // crash renders byte-identical content.
      expect(entry.updated).toBe(formatCRTimestamp(new Date(entry.committedAt ?? 0)));
    }
    const finalContent = f.files.get("Acceptance.md") ?? "";
    expect(readFrontmatterTimestamp(finalContent, "created")).toBe(formatCRTimestamp(created));
    const finalUpdated = readFrontmatterTimestamp(finalContent, "updated");
    expect(finalUpdated).toBe(formatCRTimestamp(new Date(wroteNote.at(-1)?.committedAt ?? 0)));
    expect(finalUpdated).not.toBe(formatCRTimestamp(created));
  });

  it.each(["pending-checkpoint", "vault-commit-confirmed", "applied-checkpoint", "follow-up-intent"] as WorkflowCommitFailurePoint[])("recovers serialized bytes at %s without resending the paid stage", async (point) => {
    let crashBytes: Map<string, string> | undefined;
    const f = await fixture(undefined, (at, context) => {
      if (at === point && context.stageId === (point === "follow-up-intent" ? "core" : "verify")) {
        crashBytes = new Map(f.files);
        throw new Error("simulated process crash");
      }
    });
    await create(f);
    f.start();
    await vi.waitFor(() => expect(crashBytes).toBeDefined());
    const reload = await fixture(crashBytes);
    reload.start();
    await completed(reload);
    expect(reload.run.mock.calls.map(([task]) => task.stageId)).toEqual(point === "follow-up-intent" ? ["synthesis", "verify"] : []);
    expect(reload.files.get("Acceptance.md")?.match(/<!-- cognitive-razor:verify-report -->/g)).toHaveLength(1);
  });

  it("recovers a paid Verify result after a second crash during recovery without resending", async () => {
    let crashBytes: Map<string, string> | undefined;
    const f = await fixture(undefined, (point, context) => {
      if (point === "pending-checkpoint" && context.stageId === "verify") {
        crashBytes = new Map(f.files);
        throw new Error("first synthetic crash");
      }
    });
    await create(f);
    f.start();
    await vi.waitFor(() => expect(crashBytes).toBeDefined());
    const recoveringBytes = new Map(crashBytes!);
    let secondCrashBytes: Map<string, string> | undefined;
    const recovering = await fixture(recoveringBytes, (point, context) => {
      if (point === "vault-commit-confirmed" && context.stageId === "verify") {
        secondCrashBytes = new Map(recoveringBytes);
        throw new Error("second synthetic crash");
      }
    });
    recovering.start();
    await vi.waitFor(() => expect(secondCrashBytes).toBeDefined());
    expect(recovering.run).not.toHaveBeenCalled();
    const reload = await fixture(new Map(secondCrashBytes!));
    reload.start();
    await completed(reload);
    expect(reload.run).not.toHaveBeenCalled();
    expect(reload.files.get("Acceptance.md")?.match(/<!-- cognitive-razor:verify-report -->/g)).toHaveLength(1);
    expect(reload.files.get("Acceptance.md")).toBe(secondCrashBytes!.get("Acceptance.md"));
  });

  it("keeps the final receipt when saving queue completion fails, then recovers without a model call", async () => {
    const f = await fixture();
    const write = f.storage.atomicWrite.bind(f.storage);
    vi.spyOn(f.storage, "atomicWrite").mockImplementation(async (path, content) => {
      if (path.includes("queue-state") && JSON.parse(content).tasks.some((task: TaskRecord) => task.stageId === "verify" && task.state === "completed")) return err("E303_DISK_FULL", "full");
      return write(path, content);
    });
    await create(f);
    f.start();
    await vi.waitFor(() => expect(f.store.list()[0]?.state).toBe("completed"));
    const reload = await fixture(new Map(f.files));
    reload.start();
    await completed(reload);
    expect(reload.run).not.toHaveBeenCalled();
  });

  it("rejects simultaneous creation and simultaneous Verify before two artifacts can be created", async () => {
    const f = await fixture();
    const creates = await Promise.all([f.coordinator.startCreate(concept, { targetPathOverride: "Acceptance.md" }), f.coordinator.startCreate(concept, { targetPathOverride: "Acceptance.md" })]);
    expect(creates.filter((result) => result.ok)).toHaveLength(1);
    f.start();
    await completed(f);
    const verifies = await Promise.all([f.coordinator.startVerify("Acceptance.md"), f.coordinator.startVerify("Acceptance.md")]);
    expect(verifies.filter((result) => result.ok)).toHaveLength(1);
  });

  it("retains artifacts on bulk cancellation and preserves notes", async () => {
    const f = await fixture();
    const id = await create(f);
    const note = f.files.get("Acceptance.md");
    expect(await f.queue.cancelAllActiveDurably()).toEqual(ok(1));
    expect(f.store.get(id)?.state).toBe("cancelled");
    expect(f.files.get("Acceptance.md")).toBe(note);
    const reload = await fixture(new Map(f.files));
    reload.start();
    expect(reload.run).not.toHaveBeenCalled();
    expect(reload.store.get(id)?.state).toBe("cancelled");
  });

  it("keeps an uncheckpointed model response for a local save retry", async () => {
    const f = await fixture();
    const write = f.storage.atomicWrite.bind(f.storage);
    let fail = true;
    vi.spyOn(f.storage, "atomicWrite").mockImplementation(async (path, content) => {
      if (fail && path.includes("workflows/") && JSON.parse(content).pendingStageResult) { fail = false; return err("E303_DISK_FULL", "full"); }
      return write(path, content);
    });
    await create(f);
    f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
    const task = f.queue.getSnapshot().tasks.find((candidate) => candidate.state === "failed")!;
    expect(task.result).toMatchObject({ tags: ["acceptance"] });
    await f.queue.retryDurably(task.id);
    await completed(f);
    expect(f.run.mock.calls.filter(([candidate]) => candidate.stageId === "tag")).toHaveLength(1);
  });

  it("refuses to overwrite external edits and retains the paid result", async () => {
    let once = true;
    const f = await fixture(undefined, (point, context) => {
      if (once && point === "pending-checkpoint" && context.stageId === "verify") {
        once = false;
        f.files.set("Acceptance.md", `${f.files.get("Acceptance.md")}\n用户新内容`);
      }
    });
    await create(f);
    f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
    expect(f.files.get("Acceptance.md")).toContain("用户新内容");
    expect(f.store.list()[0]?.pendingStageResult?.stageId).toBe("verify");
    expect(f.queue.getSnapshot().tasks.at(-1)?.error?.code).toBe("E320_TASK_CONFLICT");
  });

  it("refuses to overwrite external edits committed after Verify starts", async () => {
    const f = await fixture();
    await create(f);
    f.start();
    await completed(f);
    const before = f.files.get("Acceptance.md");
    const externallyEdited = `${before}\n用户在 Verify 启动后新增的内容`;
    const originalCreate = f.store.create.bind(f.store);
    vi.spyOn(f.store, "create").mockImplementation(async (artifact) => {
      f.files.set("Acceptance.md", externallyEdited);
      return originalCreate(artifact);
    });

    const started = await f.coordinator.startVerify("Acceptance.md");
    expect(started.ok).toBe(true);
    f.start();
    await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));

    expect(f.files.get("Acceptance.md")).toBe(externallyEdited);
    expect(f.queue.getSnapshot().tasks.at(-1)?.error?.code).toBe("E320_TASK_CONFLICT");
    expect(f.store.list()[0]?.pendingStageResult?.stageId).toBe("verify");
  });

  it.each(["{broken", JSON.stringify({ version: "6.0.0", tasks: [] })])("never overwrites a damaged or legacy queue during shutdown: %s", async (bytes) => {
    const f = await fixture(new Map([["plugin/data/queue-state-v5.json", bytes]]));
    expect(f.initialized.ok).toBe(false);
    await f.queue.dispose();
    expect(f.files.get("plugin/data/queue-state-v5.json")).toBe(bytes);
  });
});


it("captures collapsed verification presentation once and recovers it without rewriting or paying again", async () => {
  let crashBytes: Map<string, string> | undefined;
  const f = await fixture(undefined, (point, context) => {
    if (point === "pending-checkpoint" && context.stageId === "verify") {
      crashBytes = new Map(f.files);
      throw new Error("synthetic report checkpoint crash");
    }
  });
  f.settings.verifyReportPresentation = "collapsed";
  await create(f); f.start();
  await vi.waitFor(() => expect(crashBytes).toBeDefined());
  const reload = await fixture(crashBytes);
  expect(reload.settings.verifyReportPresentation).toBe("expanded");
  reload.start(); await completed(reload);
  const content = reload.files.get("Acceptance.md")!;
  expect(content).toContain("> [!info]- 事实核查报告");
  expect(content.match(/<!-- cognitive-razor:verify-report -->/g)).toHaveLength(1);
  expect(reload.run).not.toHaveBeenCalled();
  reload.settings.verifyReportPresentation = "collapsed";
  expect(reload.files.get("Acceptance.md")).toBe(content);
});


it.each(["pending-checkpoint", "vault-commit-confirmed"] as const)("freezes typed link directories across changes and interruption at %s", async (failurePoint) => {
  let crashBytes: Map<string, string> | undefined;
  const f = await fixture(undefined, (point, context) => {
    if (point === failurePoint && context.stageId === "structure") {
      crashBytes = new Map(f.files);
      throw new Error("synthetic structure commit crash");
    }
  });
  f.settings.enableAutoVerify = false;
  f.settings.directoryScheme.entity = "Original Entities";
  f.settings.directoryScheme.mechanism = "Original Mechanisms";
  const started = await f.coordinator.startCreate({ ...concept, type: "theory" }, { targetPathOverride: "Theory.md" });
  if (!started.ok) throw new Error("start failed");
  expect(f.store.get(started.value)?.directoryScheme?.entity).toBe("Original Entities");
  f.settings.directoryScheme.entity = "Changed Entities";
  f.settings.directoryScheme.mechanism = "Changed Mechanisms";
  const run = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (task, context) => task.stageId === "structure"
    ? ok({ phaseResult: { entities: [{ name: "Same" }], mechanisms: [{ name: "Same" }] } })
    : run(task, context));
  f.start();
  await vi.waitFor(() => expect(crashBytes).toBeDefined());
  const reloaded = await fixture(crashBytes);
  reloaded.start();
  await vi.waitFor(() => expect(reloaded.queue.getSnapshot().status).toMatchObject({ completed: 4, running: 0, pending: 0, failed: 0 }));
  const content = reloaded.files.get("Theory.md")!;
  expect(content).toContain("[[Original Entities/Same|Same]]");
  expect(content).toContain("[[Original Mechanisms/Same|Same]]");
  expect(content).not.toContain("Changed");
  expect(reloaded.run).not.toHaveBeenCalled();
  if (failurePoint === "vault-commit-confirmed") expect(content).toBe(crashBytes!.get("Theory.md"));
  const secondReload = await fixture(new Map(reloaded.files));
  secondReload.start();
  expect(secondReload.files.get("Theory.md")).toBe(content);
  expect(secondReload.run).not.toHaveBeenCalled();
});

it("replays an older artifact's bare links byte-identically without adopting today's directories", async () => {
  let crashBytes: Map<string, string> | undefined;
  const f = await fixture(undefined, (point, context) => {
    if (point === "vault-commit-confirmed" && context.stageId === "structure") {
      crashBytes = new Map(f.files);
      throw new Error("synthetic old artifact crash");
    }
  });
  f.settings.enableAutoVerify = false;
  const started = await f.coordinator.startCreate({ ...concept, type: "theory" }, { targetPathOverride: "Legacy.md" });
  if (!started.ok) throw new Error("start failed");
  await f.store.update(started.value, { directoryScheme: undefined });
  const run = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (task, context) => task.stageId === "structure"
    ? ok({ phaseResult: { entities: [{ name: "Legacy Child" }] } }) : run(task, context));
  f.start();
  await vi.waitFor(() => expect(crashBytes).toBeDefined());
  const reloaded = await fixture(crashBytes);
  reloaded.start();
  await vi.waitFor(() => expect(reloaded.queue.getSnapshot().status).toMatchObject({ completed: 4, running: 0, pending: 0, failed: 0 }));
  expect(reloaded.files.get("Legacy.md")).toContain("[[Legacy Child]]");
  expect(reloaded.files.get("Legacy.md")).toBe(crashBytes!.get("Legacy.md"));
  expect(reloaded.run).not.toHaveBeenCalled();
});

it("does not resend a stopped provider request after reset backup fails midway", async () => {
  const f = await fixture();
  f.run.mockResolvedValue(err("E500_INTERNAL_ERROR", "simulated stopped request"));
  await create(f); f.start();
  await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
  await f.queue.dispose();
  const originalNote = f.files.get("Acceptance.md");
  const write = f.vault.adapter.write.bind(f.vault.adapter);
  vi.spyOn(f.vault.adapter, "write").mockImplementation(async (path, content, options) => {
    if (path.includes("/backups/") && path.includes("/workflows/")) throw Object.assign(new Error("backup disk full"), { code: "ENOSPC" });
    return write(path, content, options);
  });
  expect((await backupAndClearPluginData(f.vault, "plugin", f.settings)).ok).toBe(false);
  const reload = await fixture(new Map(f.files)); reload.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reload.run).not.toHaveBeenCalled();
  expect(reload.queue.getSnapshot().status.failed).toBe(1);
  expect(reload.files.get("Acceptance.md")).toBe(originalNote);
});

it("retains interrupted requests after reset deletion fails and never resends them", async () => {
  const f = await fixture();
  let release!: (value: Result<Record<string, unknown>>) => void;
  f.run.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  await create(f); f.start();
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
  const interruptedBytes = new Map(f.files);
  await f.queue.cancelAllActiveDurably(); release(err("E500_INTERNAL_ERROR", "stopped original fixture")); await f.queue.dispose();
  const interrupted = await fixture(interruptedBytes);
  expect(interrupted.queue.getSnapshot().status.interrupted).toBe(1);
  await interrupted.queue.dispose();
  const remove = interrupted.vault.adapter.remove.bind(interrupted.vault.adapter);
  let crashBytes: Map<string, string> | undefined;
  vi.spyOn(interrupted.vault.adapter, "remove").mockImplementation(async (path) => {
    if (path.includes("/workflows/")) { crashBytes = new Map(interrupted.files); throw Object.assign(new Error("cannot delete workflow"), { code: "EACCES" }); }
    return remove(path);
  });
  expect((await backupAndClearPluginData(interrupted.vault, "plugin", interrupted.settings)).ok).toBe(false);
  const reload = await fixture(new Map(interrupted.files)); reload.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reload.run).not.toHaveBeenCalled(); expect(reload.queue.getSnapshot().status.interrupted).toBe(1);
  expect(crashBytes?.has("plugin/data/reset-in-progress.json")).toBe(true);
  const crashReload = await fixture(crashBytes); crashReload.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(crashReload.run).not.toHaveBeenCalled(); expect(crashReload.queue.getSnapshot().status.interrupted).toBe(1);
});


it("preserves edits across duplicate Verify clicks, cancellation, late result and fresh-instance recovery", async () => {
  const f = await fixture(); await create(f); f.start(); await completed(f); f.run.mockClear();
  let release!: (value: Result<Record<string, unknown>>) => void;
  f.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const starts = await Promise.all([f.coordinator.startVerify("Acceptance.md"), f.coordinator.startVerify("Acceptance.md")]);
  expect(starts.filter(r => r.ok)).toHaveLength(1);
  await vi.waitFor(() => expect(release).toBeDefined());
  const task = f.queue.getSnapshot().tasks.find(t => t.state === "running")!;
  const edited = f.files.get("Acceptance.md") + "\n用户保留的新编辑"; f.files.set("Acceptance.md", edited);
  expect((await f.queue.cancelDurably(task.id)).ok).toBe(true);
  const reload = await fixture(new Map(f.files)); reload.start();
  release(ok({ reportText: "迟到结果不得覆盖", responseId: "late" }));
  await vi.waitFor(() => expect(f.queue.getSnapshot().status.running).toBe(0));
  expect(f.files.get("Acceptance.md")).toBe(edited); expect(reload.files.get("Acceptance.md")).toBe(edited);
  expect(reload.run).not.toHaveBeenCalled(); expect(reload.queue.getTask(task.id)).toMatchObject({ state: "interrupted", error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN" } });
  expect((await reload.coordinator.startVerify("Acceptance.md")).ok).toBe(true);
  await vi.waitFor(() => expect(reload.queue.getSnapshot().status.completed).toBe(5));
  expect(reload.run).toHaveBeenCalledOnce(); expect(reload.files.get("Acceptance.md")).toContain("用户保留的新编辑");
  expect(reload.files.get("Acceptance.md")).not.toContain("迟到结果不得覆盖");
  expect(f.files.get("Acceptance.md")).toBe(edited);
  expect(reload.files.get("Acceptance.md")?.match(/<!-- cognitive-razor:verify-report -->/g)).toHaveLength(1);
});

it("does not resend an uncertain Verify after two serialized reloads", async () => {
  const f = await fixture(); await create(f); f.start(); await completed(f); f.run.mockClear();
  f.run.mockResolvedValueOnce(err("E206_PROVIDER_REQUEST_UNCERTAIN", "synthetic disconnect"));
  const before = f.files.get("Acceptance.md"); expect((await f.coordinator.startVerify("Acceptance.md")).ok).toBe(true);
  await vi.waitFor(() => expect(f.queue.getSnapshot().tasks.some(t => t.state === "interrupted")).toBe(true));
  const reload = await fixture(new Map(f.files)); reload.start();
  const again = await fixture(new Map(reload.files)); again.start();
  expect(f.run).toHaveBeenCalledOnce(); expect(reload.run).not.toHaveBeenCalled(); expect(again.run).not.toHaveBeenCalled();
  expect(again.files.get("Acceptance.md")).toBe(before);
  expect(again.queue.getSnapshot().tasks.some(t => t.state === "interrupted")).toBe(true);
});

it("retains a paid Verify result on edit conflict across restart and local retry without another model call", async () => {
  const f = await fixture(); await create(f); f.start(); await completed(f); f.run.mockClear();
  let release!: (value: Result<Record<string, unknown>>) => void;
  f.run.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await f.coordinator.startVerify("Acceptance.md"); await vi.waitFor(() => expect(release).toBeDefined());
  const edited = f.files.get("Acceptance.md") + "\n生成期间的用户修改"; f.files.set("Acceptance.md", edited);
  release(ok({ reportText: "已付费但待解决冲突", responseId: "synthetic-paid" }));
  await vi.waitFor(() => expect(f.queue.getSnapshot().status.failed).toBe(1));
  const task = f.queue.getSnapshot().tasks.find(t => t.state === "failed")!;
  const reload = await fixture(new Map(f.files)); reload.start();
  expect((await reload.queue.retryDurably(task.id)).ok).toBe(true);
  await vi.waitFor(() => expect(reload.queue.getTask(task.id)?.state).toBe("failed"));
  expect(reload.queue.getTask(task.id)?.error?.code).toBe("E320_TASK_CONFLICT");
  expect(reload.run).not.toHaveBeenCalled(); expect(reload.files.get("Acceptance.md")).toBe(edited);
  expect(reload.store.list().some(a => a.pendingStageResult?.result.reportText === "已付费但待解决冲突")).toBe(true);
});
