import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type CachedMetadata } from "obsidian";
import { err, ok } from "../types";
import type { CRFrontmatter, DuplicatePair, ILogger, PluginSettings, Result } from "../types";
import type { FileStorage } from "../data/file-storage";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { DuplicateMergeService } from "./duplicate-merge-service";
import { formatCRTimestamp } from "../utils/date-utils";

const logger: ILogger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

afterEach(() => vi.useRealTimers());

function readFrontmatterTimestamp(content: string, field: "created" | "updated"): string | undefined {
  return new RegExp(`^${field}:\\s*(.*)$`, "m").exec(content)?.[1];
}

function file(path: string): TFile {
  const result = new TFile();
  result.path = path;
  result.name = path.split("/").at(-1) ?? path;
  result.basename = result.name.replace(/\.md$/i, "");
  result.extension = "md";
  return result;
}

function note(cruid: string, path: string, body: string, aliases: string[] = []): { file: TFile; content: string; frontmatter: CRFrontmatter } {
  const frontmatter = generateFrontmatter({ cruid, type: "entity", name: path.replace(/\.md$/i, ""), aliases });
  return { file: file(path), content: generateMarkdownContent(frontmatter, body), frontmatter };
}

interface FixtureOptions {
  modelContent?: string;
  finishReason?: string;
  unrelatedAliases?: unknown;
  removeResults?: Array<ReturnType<typeof ok<number>> | ReturnType<typeof err>>;
  providerEnabled?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const canonical = note("canonical", "notes/Canonical.md", "主笔记正文");
  const redundant = note("redundant", "archive/Redundant.md", "冗余笔记正文", ["旧别名"]);
  const incoming = note("incoming", "Inbox/Links.md", "[[archive/Redundant]]\n[[旧别名]]\n![[archive/Redundant#结论]]\n[[archive/Redundant|显示名]]\n[[Redundant]]");
  const sameName = note("same-name", "other/Redundant.md", "同名但不是目标");
  const files = new Map<string, { file: TFile; content: string; frontmatter: CRFrontmatter }>([
    [canonical.file.path, canonical], [redundant.file.path, redundant], [incoming.file.path, incoming], [sameName.file.path, sameName],
  ]);
  const pair: DuplicatePair = { id: "canonical--redundant", nodeIdA: "canonical", nodeIdB: "redundant", type: "entity", similarity: 0.93, status: "pending" };
  const storageFiles = new Map<string, string>();
  const active = new Map<string, TFile>([["canonical", canonical.file], ["redundant", redundant.file]]);
  const vault = {
    getMarkdownFiles: () => [...files.values()].map((entry) => entry.file),
    cachedRead: vi.fn(async (target: TFile) => files.get(target.path)?.content ?? ""),
    read: vi.fn(async (target: TFile) => files.get(target.path)?.content ?? ""),
    getAbstractFileByPath: (path: string) => files.get(path)?.file ?? null,
    trash: vi.fn(async (target: TFile) => { files.delete(target.path); active.delete(target.path.includes("Canonical") ? "canonical" : "redundant"); }),
  };
  const app = {
    vault,
    metadataCache: { getFileCache: vi.fn((target: TFile): CachedMetadata => ({
      frontmatter: { aliases: target.path === redundant.file.path ? ["旧别名"] : options.unrelatedAliases },
      links: [...(files.get(target.path)?.content ?? "").matchAll(/!?\[\[([^\]]+)\]\]/g)].map((match) => ({
        original: match[0], link: match[1],
        position: { start: { line: 0, col: 0, offset: match.index }, end: { line: 0, col: 0, offset: match.index + match[0].length } },
      })),
    })) },
  };
  const noteRepository = {
    replaceIfUnchanged: vi.fn(async (path: string, expected: string, content: string) => {
      const entry = files.get(path);
      if (!entry) return "missing" as const;
      if (entry.content === content) return "updated" as const;
      if (entry.content !== expected) return "changed" as const;
      entry.content = content;
      return "updated" as const;
    }),
  };
  let removeCall = 0;
  const duplicateManager = {
    getPair: (id: string) => id === pair.id ? { ...pair } : null,
    removePairsByNodeId: vi.fn(async () => options.removeResults?.[removeCall++] ?? ok(1)),
  };
  const settings = {
    getSettings: () => ({
      taskModels: { merge: { providerId: "provider", model: "model" } },
      providers: {
        provider: {
          apiKey: "test-key",
          apiFormat: "openai-responses",
          embeddingApiFormat: "disabled",
          defaultChatModel: "model",
          defaultEmbedModel: "",
          enabled: options.providerEnabled ?? true,
        },
      },
      defaultProviderId: "",
    } as unknown as PluginSettings),
  };
  const providerManager = { chat: vi.fn(async () => ok({ finishReason: options.finishReason, content: options.modelContent ?? JSON.stringify({ body: "合并正文", name: "Canonical", aliases: ["旧别名", "旧别名"], tags: ["tag"], parents: ["[[Parent]]"], sourceUids: ["source-1"], conflicts: ["冲突"] }) })) };
  const promptManager = { build: vi.fn(() => "<system_instructions>merge</system_instructions>\n<context_slots><merge_input>{{CTX_CURRENT}}</merge_input></context_slots>\n<output_schema>{}</output_schema>\n<task_instruction>merge</task_instruction>") };
  const atomicWrite = vi.fn(async (path: string, content: string): Promise<Result<void>> => { storageFiles.set(path, content); return ok(undefined); });
  const storage: FileStorage = { exists: async (path: string) => storageFiles.has(path), read: async (path: string) => ok(storageFiles.get(path) ?? ""), atomicWrite } as unknown as FileStorage;
  const reindex = vi.fn(async (): Promise<Result<{ indexed: number; failed: number }>> => ok({ indexed: 1, failed: 0 }));
  const service = new DuplicateMergeService({
    app: app as never,
    fileStorage: storage,
    noteRepository,
    cruidCache: { getFile: (id: string) => active.get(id) ?? null } as never,
    duplicateManager: duplicateManager as never,
    providerManager: providerManager as never,
    promptManager: promptManager as never,
    settingsStore: settings as never,
    reindex,
    logger,
  });
  return { service, app, files, active, vault, noteRepository, providerManager, duplicateManager, storage, atomicWrite, storageFiles, pair, canonical, redundant, incoming, reindex };
}

describe("DuplicateMergeService", () => {
  it("preserves both original parent sets in the preview, then respects explicit user edits", async () => {
    const f = fixture();
    f.canonical.frontmatter.parents = ["[[Domains/A, B]]", "[[Shared]]"];
    f.redundant.frontmatter.parents = ["[[Domains/Other]]", "[[Shared]]"];
    for (const entry of [f.canonical, f.redundant]) entry.content = generateMarkdownContent(entry.frontmatter, "body");
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.draft.parents).toEqual(["[[Domains/A, B]]", "[[Shared]]", "[[Domains/Other]]", "[[Parent]]"]);
    const edited = { ...prepared.value.draft, parents: ["[[Domains/A, B]]", "[[User/Replacement]]"] };
    expect((await f.service.confirmMerge(edited, prepared.value.linkRepairPlan)).ok).toBe(true);
    expect(extractFrontmatter(f.canonical.content)?.frontmatter.parents).toEqual(edited.parents);
  });

  it("allows the user to remove all parents at confirmation", async () => {
    const f = fixture();
    f.canonical.frontmatter.parents = ["[[Original]]"];
    f.canonical.content = generateMarkdownContent(f.canonical.frontmatter, "body");
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!prepared.ok) throw new Error("preview failed");
    expect((await f.service.confirmMerge({ ...prepared.value.draft, parents: [] }, prepared.value.linkRepairPlan)).ok).toBe(true);
    expect(extractFrontmatter(f.canonical.content)?.frontmatter.parents).toEqual([]);
  });

  it("prevents concurrent journal mutations from undoing another recovery removal on rollback", async () => {
    const f = fixture();
    f.reindex.mockResolvedValue(err("E204_PROVIDER_ERROR", "offline"));
    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    await f.service.confirmMerge(preview.value.draft, preview.value.linkRepairPlan);
    const first = f.service.getRecoveryOperations()[0];
    const second = { ...first, id: "second-operation" };
    f.storageFiles.set("data/duplicate-merge-operations.json", JSON.stringify({ version: "1.0.0", operations: [first, second] }));
    await f.service.initialize();
    let release!: () => void;
    f.atomicWrite.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(err("E303_DISK_FULL", "full")); }));
    const removing = f.service.discardRecovery(first.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    const otherRemoval = await f.service.discardRecovery(second.id);
    release();
    expect((await removing).ok).toBe(false);
    // An accepted deletion must stay deleted; a conflicting action may be
    // rejected while the first journal write owns the rollback snapshot.
    if (!otherRemoval.ok) expect(otherRemoval.error.code).toBe("E320_TASK_CONFLICT");
    expect(f.service.getRecoveryOperations().map((operation) => operation.id))
      .toEqual(otherRemoval.ok ? [first.id] : [first.id, second.id]);
  });

  it("only rewrites links recognized by Obsidian, leaving literal examples untouched", async () => {
    const f = fixture();
    const literal = "`[[archive/Redundant]]`\n```md\n[[archive/Redundant]]\n```\n%% [[archive/Redundant]] %%\n";
    f.incoming.content = literal + "[[archive/Redundant]]";
    const getCache = f.app.metadataCache.getFileCache.getMockImplementation()!;
    f.app.metadataCache.getFileCache.mockImplementation((target) => {
      const cache = getCache(target);
      return target.path === f.incoming.file.path
        ? { ...cache, links: cache.links?.filter((link) => link.position.start.offset === literal.length) }
        : cache;
    });
    const result = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.linkRepairPlan.entries[0].replacementContent).toBe(literal + "[[notes/Canonical]]");
  });

  it.each(["length", "content_filter"])("rejects interrupted model output even if its JSON is valid (%s)", async (finishReason) => {
    const f = fixture({ finishReason });
    expect(await f.service.prepareMerge(f.pair.id, "canonical")).toMatchObject({ ok: false });
    expect(f.noteRepository.replaceIfUnchanged).not.toHaveBeenCalled();
  });

  it.each([42, { invalid: true }])("ignores malformed aliases in unrelated notes (%j)", async (unrelatedAliases) => {
    const f = fixture({ unrelatedAliases });
    expect(await f.service.prepareMerge(f.pair.id, "canonical")).toMatchObject({ ok: true });
  });

  it("preserves headings and display names in links with surrounding whitespace", async () => {
    const f = fixture();
    f.incoming.content = "[[ archive/Redundant#结论|显示名]]\n![[  archive/Redundant.md#结论]]";
    const result = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.linkRepairPlan.entries[0].replacementContent)
      .toBe("[[ notes/Canonical#结论|显示名]]\n![[  notes/Canonical.md#结论]]");
  });

  it("keeps recovery visible when the final journal cleanup fails", async () => {
    const f = fixture();
    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    f.atomicWrite.mockImplementation(async (path, content) => {
      if (JSON.parse(content).operations.length === 0) return err("E303_DISK_FULL", "disk full");
      f.storageFiles.set(path, content);
      return ok(undefined);
    });
    expect(await f.service.confirmMerge(preview.value.draft, preview.value.linkRepairPlan)).toMatchObject({ ok: false });
    expect(f.service.getRecoveryOperations()).toHaveLength(1);
    expect(f.service.getRecoveryOperations()[0].phase).toBe("redundant-trashed");
  });

  it("preserves custom canonical properties and CRLF link-note content during merge", async () => {
    const f = fixture();
    f.canonical.content = f.canonical.content.replace("\n---\n", "\ncssclasses: [wide-page]\n---\n");
    f.incoming.content = f.incoming.content.replace(/\n/g, "\r\n");
    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    const result = await f.service.confirmMerge(preview.value.draft, preview.value.linkRepairPlan);
    expect(result.ok).toBe(true);
    expect(f.canonical.content).toContain("cssclasses:");
    expect(f.incoming.content).toBe(preview.value.linkRepairPlan.entries[0].replacementContent);
    expect(f.incoming.content).toContain("---\r\n\r\n[[notes/Canonical]]\r\n[[notes/Canonical]]");
  });

  it("stamps the merged note with the merge time and keeps its creation time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const created = new Date("2027-01-01T00:00:00Z");
    const merged = new Date("2027-01-01T00:30:00Z");
    vi.setSystemTime(created);
    const f = fixture();
    expect(readFrontmatterTimestamp(f.canonical.content, "updated")).toBe(formatCRTimestamp(created));

    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    vi.setSystemTime(merged);
    const result = await f.service.confirmMerge(preview.value.draft, preview.value.linkRepairPlan);

    expect(result.ok).toBe(true);
    const content = f.files.get(f.canonical.file.path)?.content ?? "";
    expect(readFrontmatterTimestamp(content, "created")).toBe(formatCRTimestamp(created));
    expect(readFrontmatterTimestamp(content, "updated")).toBe(formatCRTimestamp(merged));
  });

  it("refuses to prepare a merge through a disabled provider", async () => {
    const f = fixture({ providerEnabled: false });

    const result = await f.service.prepareMerge(f.pair.id, "canonical");

    expect(result).toMatchObject({ ok: false, error: { code: "E401_PROVIDER_NOT_CONFIGURED" } });
    expect(f.providerManager.chat).not.toHaveBeenCalled();
  });

  it("does not retarget a real filename that happens to be the redundant note's alias", async () => {
    const f = fixture();
    const aliasFile = note("alias-file", "旧别名.md", "另一篇真实笔记");
    f.files.set(aliasFile.file.path, aliasFile);
    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.value.linkRepairPlan.entries[0].replacementContent).toContain("[[旧别名]]");
  });

  it("waits for an in-flight merge on disposal and prevents its later trash step", async () => {
    const f = fixture();
    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.reindex.mockImplementation(async () => { await gate; return ok({ indexed: 1, failed: 0 }); });
    const merging = f.service.confirmMerge(preview.value.draft, preview.value.linkRepairPlan);
    await vi.waitFor(() => expect(f.reindex).toHaveBeenCalled());
    let stopped = false;
    const disposing = f.service.dispose().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await disposing;
    expect(await merging).toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    expect(f.vault.trash).not.toHaveBeenCalled();
    expect(await f.service.resumeMerge(f.service.getRecoveryOperations()[0].id)).toMatchObject({ ok: false });
  });

  it("preserves a redundant note edited while the merged note is being indexed", async () => {
    const f = fixture();
    const preview = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!preview.ok) throw new Error("preview failed");
    f.reindex.mockImplementation(async () => {
      f.redundant.content += "\n用户新写的重要内容";
      return ok({ indexed: 1, failed: 0 });
    });
    const result = await f.service.confirmMerge(preview.value.draft, preview.value.linkRepairPlan);
    expect(result).toMatchObject({ ok: false, error: { code: "E320_TASK_CONFLICT" } });
    expect(f.vault.trash).not.toHaveBeenCalled();
    expect(f.files.get(f.redundant.file.path)?.content).toContain("用户新写的重要内容");
  });

  it("prepares a deduplicated draft and a conservative link plan", async () => {
    const f = fixture();
    const result = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.aliases).toEqual(["旧别名"]);
    expect(result.value.linkRepairPlan.replacementCount).toBe(4);
    expect(result.value.linkRepairPlan.entries[0].replacementContent).toContain("[[notes/Canonical]]");
    expect(result.value.linkRepairPlan.skipped.some((item) => item.includes("[[Redundant]]"))).toBe(true);
  });

  it("rejects extra fields and frontmatter in model body before any Vault write", async () => {
    const extra = fixture({ modelContent: JSON.stringify({ body: "正文", name: "n", aliases: [], tags: [], parents: [], sourceUids: [], conflicts: [], extra: true }) });
    const invalid = await extra.service.prepareMerge(extra.pair.id, "canonical");
    expect(invalid.ok).toBe(false);
    expect(extra.noteRepository.replaceIfUnchanged).not.toHaveBeenCalled();
    const frontmatter = fixture({ modelContent: JSON.stringify({ body: "---\nname: bad\n---\n正文", name: "n", aliases: [], tags: [], parents: [], sourceUids: [], conflicts: [] }) });
    expect((await frontmatter.service.prepareMerge(frontmatter.pair.id, "canonical")).ok).toBe(false);
  });

  it("refuses confirmation after either source note changes", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    f.canonical.content += "\n外部编辑";
    const result = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);
    expect(result).toMatchObject({ ok: false, error: { code: "E320_TASK_CONFLICT" } });
    expect(f.noteRepository.replaceIfUnchanged).not.toHaveBeenCalled();
    expect(f.vault.trash).not.toHaveBeenCalled();
  });

  it("serializes concurrent confirmations for the same pair", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const first = f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);
    await Promise.resolve();
    const second = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);
    expect(second).toMatchObject({ ok: false, error: { code: "E320_TASK_CONFLICT" } });
    await first;
  });

  it("runs all phases and resumes pair cleanup after trash checkpoint failure", async () => {
    const f = fixture({ removeResults: [err("E500_INTERNAL_ERROR", "暂时失败"), ok(1)] });
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const first = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);
    expect(first.ok).toBe(false);
    expect(f.vault.trash).toHaveBeenCalledOnce();
    const recovery = f.service.getRecoveryOperations();
    expect(recovery).toHaveLength(1);
    expect(recovery[0].phase).toBe("redundant-trashed");
    const resumed = await f.service.resumeMerge(recovery[0].id);
    expect(resumed).toMatchObject({ ok: true, value: { phase: "completed" } });
    expect(f.vault.trash).toHaveBeenCalledOnce();
    expect(f.duplicateManager.removePairsByNodeId).toHaveBeenCalledTimes(2);
    expect(f.files.has(f.redundant.file.path)).toBe(false);
    expect(f.files.get(f.canonical.file.path)?.content).toContain("合并正文");
    expect(f.files.get(f.canonical.file.path)?.content).toContain('parents: ["[[Parent]]"]');
  });

  it("stops before the next side effect when a phase checkpoint cannot be saved", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    let writes = 0;
    f.atomicWrite.mockImplementation(async (path: string, content: string) => {
      writes += 1;
      if (writes === 2) return err("E303_DISK_FULL", "disk full");
      f.storageFiles.set(path, content);
      return ok(undefined);
    });
    const result = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(f.noteRepository.replaceIfUnchanged).toHaveBeenCalledTimes(1);
    expect(f.vault.trash).not.toHaveBeenCalled();
    expect(f.service.getRecoveryOperations()[0]).toMatchObject({ phase: "canonical-written" });
  });

  it("keeps a recovery record when discarding it cannot be persisted", async () => {
    const f = fixture({ removeResults: [err("E500_INTERNAL_ERROR", "暂时失败")] });
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);
    const recovery = f.service.getRecoveryOperations();
    expect(recovery).toHaveLength(1);

    f.atomicWrite.mockImplementationOnce(async () => err("E303_DISK_FULL", "disk full"));
    const discarded = await f.service.discardRecovery(recovery[0].id);

    expect(discarded).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(f.service.getRecoveryOperations()).toHaveLength(1);
  });

  it("stops before trash when the durable trash intent cannot be saved", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    let writes = 0;
    f.atomicWrite.mockImplementation(async (path: string, content: string) => {
      writes += 1;
      if (writes === 5) return err("E303_DISK_FULL", "disk full");
      f.storageFiles.set(path, content);
      return ok(undefined);
    });
    const result = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(f.vault.trash).not.toHaveBeenCalled();
    const persisted = JSON.parse(f.storageFiles.get("data/duplicate-merge-operations.json") ?? "{}");
    expect(persisted.operations[0].phase).toBe("canonical-indexed");
  });

  it("leaves a recoverable trash intent when its post-trash checkpoint fails", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    let writes = 0;
    f.atomicWrite.mockImplementation(async (path: string, content: string) => {
      writes += 1;
      if (writes === 6) return err("E303_DISK_FULL", "disk full");
      f.storageFiles.set(path, content);
      return ok(undefined);
    });
    const result = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(f.vault.trash).toHaveBeenCalledOnce();
    const persisted = JSON.parse(f.storageFiles.get("data/duplicate-merge-operations.json") ?? "{}");
    expect(persisted.operations[0].phase).toBe("redundant-trash-pending");

    const reloaded = await f.service.initialize();
    expect(reloaded.ok).toBe(true);
    const resumed = await f.service.resumeMerge(persisted.operations[0].id);
    expect(resumed).toMatchObject({ ok: true, value: { phase: "completed" } });
    expect(f.vault.trash).toHaveBeenCalledOnce();
  });

  it("finishes recovery without repeating writes when trash removes the file before rejecting", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!prepared.ok) throw new Error("preview failed");
    f.vault.trash.mockImplementationOnce(async (target) => {
      f.files.delete(target.path);
      f.active.delete("redundant");
      throw new Error("adapter error after moving the file to trash");
    });

    const first = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);
    expect(first.ok).toBe(false);
    expect(f.files.has(f.redundant.file.path)).toBe(false);
    const mergedContent = f.files.get(f.canonical.file.path)?.content;
    const recovery = f.service.getRecoveryOperations()[0];
    expect((await f.service.initialize()).ok).toBe(true);
    const resumed = await f.service.resumeMerge(recovery.id);

    expect(resumed).toMatchObject({ ok: true, value: { phase: "completed" } });
    expect(f.files.get(f.canonical.file.path)?.content).toBe(mergedContent);
    expect(f.service.getRecoveryOperations()).toEqual([]);
    expect(f.vault.trash).toHaveBeenCalledOnce();
  });

  it("retries only trash after a rejected call, preserving later edits to already repaired notes", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    if (!prepared.ok) throw new Error("preview failed");
    f.vault.trash.mockRejectedValueOnce(new Error("adapter error before moving the file"));

    expect((await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan)).ok).toBe(false);
    expect(f.files.has(f.redundant.file.path)).toBe(true);
    f.canonical.content += "\n用户修改合并后的主笔记";
    f.incoming.content += "\n用户修改已修复链接的笔记";
    const canonicalContent = f.canonical.content;
    const incomingContent = f.incoming.content;
    const recovery = f.service.getRecoveryOperations()[0];
    expect((await f.service.initialize()).ok).toBe(true);

    expect(await f.service.resumeMerge(recovery.id)).toMatchObject({ ok: true, value: { phase: "completed" } });
    expect(f.files.get(f.canonical.file.path)?.content).toBe(canonicalContent);
    expect(f.files.get(f.incoming.file.path)?.content).toBe(incomingContent);
    expect(f.files.has(f.redundant.file.path)).toBe(false);
  });

  it("drops a completed merge from the durable log so it cannot grow without bound", async () => {
    const f = fixture();
    const prepared = await f.service.prepareMerge(f.pair.id, "canonical");
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const result = await f.service.confirmMerge(prepared.value.draft, prepared.value.linkRepairPlan);

    expect(result).toMatchObject({ ok: true, value: { phase: "completed" } });
    expect(f.service.getRecoveryOperations()).toEqual([]);
    const persisted = JSON.parse(f.storageFiles.get("data/duplicate-merge-operations.json") ?? "{}");
    expect(persisted.operations).toEqual([]);
    expect(f.storageFiles.get("data/duplicate-merge-operations.json")).not.toContain("合并正文");
  });

  it("skips malformed recovery records instead of exposing a crashing operation", async () => {
    const f = fixture();
    f.storageFiles.set("data/duplicate-merge-operations.json", JSON.stringify({
      version: "1.0.0",
      operations: [null, { id: "broken", phase: "canonical-indexed" }],
    }));

    const initialized = await f.service.initialize();

    expect(initialized.ok).toBe(true);
    expect(f.service.getRecoveryOperations()).toEqual([]);
  });

  it("preserves malformed recovery JSON for manual diagnosis", async () => {
    const f = fixture();
    const malformed = "{not-json";
    f.storageFiles.set("data/duplicate-merge-operations.json", malformed);

    const initialized = await f.service.initialize();

    expect(initialized.ok).toBe(true);
    expect(f.service.getRecoveryOperations()).toEqual([]);
    expect(f.atomicWrite).not.toHaveBeenCalled();
    expect(f.storageFiles.get("data/duplicate-merge-operations.json")).toBe(malformed);
  });
});
