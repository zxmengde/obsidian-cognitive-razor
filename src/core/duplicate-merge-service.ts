import type { App, TFile } from "obsidian";
import { err, ok, toErr } from "../types";
import type { CRFrontmatter, Result } from "../types";
import type {
  DuplicateMergeDraft, DuplicateMergeNoteSnapshot, DuplicateMergeOperation,
  DuplicateMergeOperationsStore, DuplicateMergePreview, LinkRepairPlan,
} from "../types";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import type { ILogger } from "../types";
import type { CruidCache } from "./cruid-cache";
import type { DuplicateManager } from "./duplicate-manager";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
import { buildTaskChatRequest } from "./task-execution-support";
import { extractFrontmatter, generateMarkdownContent, normalizeParents } from "./frontmatter-utils";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import { formatCRTimestamp } from "../utils/date-utils";
import { resolveAvailableProvider } from "./provider-config";
import { validateChatFinishReason } from "./provider-response-parsers";

const STORE_PATH = "data/duplicate-merge-operations.json";
const MERGE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["body", "name", "aliases", "tags", "parents", "sourceUids", "conflicts"],
  properties: {
    body: { type: "string" }, name: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    parents: { type: "array", items: { type: "string" } },
    sourceUids: { type: "array", items: { type: "string" } },
    conflicts: { type: "array", items: { type: "string" } },
  },
} as const;

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}

function validDraft(value: unknown): value is Omit<DuplicateMergeDraft, "pairId" | "canonicalNodeId" | "redundantNodeId" | "canonicalContentHash" | "redundantContentHash"> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const allowed = new Set(["body", "name", "aliases", "tags", "parents", "sourceUids", "conflicts"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) return false;
  return typeof candidate.body === "string" && !/^\s*---\s*(?:\r?\n|$)/.test(candidate.body) && typeof candidate.name === "string"
    && ["aliases", "tags", "parents", "sourceUids", "conflicts"].every((key) => Array.isArray(candidate[key]) && (candidate[key] as unknown[]).every((item) => typeof item === "string"));
}

const MERGE_PHASES: ReadonlySet<string> = new Set([
  "prepared", "canonical-written", "links-repaired", "canonical-indexed",
  "redundant-trash-pending", "redundant-trashed", "completed", "failed",
]);

function validSnapshot(value: unknown): value is DuplicateMergeNoteSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.nodeId === "string" && candidate.nodeId.length > 0
    && typeof candidate.path === "string" && candidate.path.length > 0
    && typeof candidate.content === "string" && typeof candidate.contentHash === "string"
    && !!candidate.frontmatter && typeof candidate.frontmatter === "object";
}

function validMergeOperation(value: unknown): value is DuplicateMergeOperation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0 || candidate.version !== "1.0.0"
    || typeof candidate.phase !== "string" || !MERGE_PHASES.has(candidate.phase)
    || typeof candidate.canonicalTargetContent !== "string" || !Array.isArray(candidate.completedPaths)
    || !candidate.completedPaths.every((path) => typeof path === "string") || typeof candidate.updatedAt !== "number") return false;
  const preview = candidate.preview;
  if (!preview || typeof preview !== "object") return false;
  const previewRecord = preview as Record<string, unknown>;
  if (typeof previewRecord.pairId !== "string" || typeof previewRecord.type !== "string"
    || typeof previewRecord.similarity !== "number" || !Number.isFinite(previewRecord.similarity)
    || !validSnapshot(previewRecord.canonical) || !validSnapshot(previewRecord.redundant)) return false;
  const draft = previewRecord.draft;
  if (!draft || typeof draft !== "object") return false;
  const draftRecord = draft as Record<string, unknown>;
  const draftData = {
    body: draftRecord.body, name: draftRecord.name, aliases: draftRecord.aliases,
    tags: draftRecord.tags, parents: draftRecord.parents, sourceUids: draftRecord.sourceUids,
    conflicts: draftRecord.conflicts,
  };
  if (!validDraft(draftData) || typeof draftRecord.pairId !== "string"
    || typeof draftRecord.canonicalNodeId !== "string" || typeof draftRecord.redundantNodeId !== "string"
    || typeof draftRecord.canonicalContentHash !== "string" || typeof draftRecord.redundantContentHash !== "string") return false;
  const plan = previewRecord.linkRepairPlan;
  if (!plan || typeof plan !== "object") return false;
  const planRecord = plan as Record<string, unknown>;
  if (!Array.isArray(planRecord.entries) || !Array.isArray(planRecord.skipped)
    || typeof planRecord.replacementCount !== "number" || !planRecord.skipped.every((item) => typeof item === "string")) return false;
  return planRecord.entries.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return typeof item.path === "string" && typeof item.expectedContent === "string"
      && typeof item.replacementContent === "string" && typeof item.replacements === "number";
  });
}

function linkTarget(inner: string): string {
  return inner.split("|", 1)[0].split("#", 1)[0].trim().replace(/\.md$/i, "");
}

function buildLinkPlan(app: App, redundant: TFile, canonical: TFile, snapshots: Map<string, string>): LinkRepairPlan {
  const files = app.vault.getMarkdownFiles();
  const filePaths = new Set(files.map((file) => file.path.replace(/\.md$/i, "")));
  const aliases = new Map<string, TFile[]>();
  const basenames = new Map<string, TFile[]>();
  for (const file of files) {
    basenames.set(file.basename, [...(basenames.get(file.basename) ?? []), file]);
    const cache = app.metadataCache.getFileCache(file);
    const rawAliases: unknown = cache?.frontmatter?.aliases;
    for (const alias of (Array.isArray(rawAliases) ? rawAliases : typeof rawAliases === "string" ? [rawAliases] : [])) {
      if (typeof alias !== "string") continue;
      aliases.set(alias, [...(aliases.get(alias) ?? []), file]);
    }
  }
  const entries: LinkRepairPlan["entries"] = [];
  const skipped: string[] = [];
  const redundantPath = redundant.path.replace(/\.md$/i, "");
  const canonicalPath = canonical.path.replace(/\.md$/i, "");
  const replaceLinks = (text: string, filePath: string, onSkip: (value: string) => void, bodyLinks?: Map<number, string>, startOffset = 0): { content: string; replacements: number } => {
    let replacements = 0;
    const content = text.replace(/(!?\[\[([^\]]+)\]\])/g, (whole, _full: string, inner: string, offset: number) => {
      // Obsidian owns Markdown parsing. Never rewrite code, comments or other
      // literal text, and require cached positions to match this exact snapshot.
      if (bodyLinks && bodyLinks.get(startOffset + offset) !== whole) return whole;
      const target = linkTarget(inner);
      const directPath = target === redundantPath;
      const uniqueFilename = target === redundant.basename && (basenames.get(redundant.basename) ?? []).length === 1;
      const aliasMatches = aliases.get(target) ?? [];
      const filenameCollision = basenames.has(target) || filePaths.has(target);
      const uniqueAlias = !filenameCollision && aliasMatches.length === 1 && aliasMatches[0].path === redundant.path;
      if (!directPath && !uniqueFilename && !uniqueAlias) {
        if ((aliasMatches.length > 1 && aliasMatches.some((item) => item.path === redundant.path))
          || (target === redundant.basename && (basenames.get(redundant.basename) ?? []).length > 1)) onSkip(`${filePath}: ${whole}`);
        return whole;
      }
      replacements += 1;
      const leadingWhitespace = inner.length - inner.trimStart().length;
      const suffix = inner.slice(leadingWhitespace + target.length);
      return `${whole.startsWith("!") ? "!" : ""}[[${inner.slice(0, leadingWhitespace)}${canonicalPath}${suffix}]]`;
    });
    return { content, replacements };
  };
  for (const file of files) {
    if (file.path === canonical.path || file.path === redundant.path) continue;
    const original = snapshots.get(file.path);
    if (original === undefined) continue;
    const cache = app.metadataCache.getFileCache(file);
    const bodyLinks = new Map([...(cache?.links ?? []), ...(cache?.embeds ?? [])]
      .map((link) => [link.position.start.offset, link.original]));
    const parsed = extractFrontmatter(original);
    let replacementContent = original;
    let replacements = 0;
    if (parsed) {
      const header = /^---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)[ \t]*---[ \t]*(?:(?:\r\n|\n|\r)|$)/.exec(original)?.[0] ?? "";
      const bodyResult = replaceLinks(original.slice(header.length), file.path, (value) => skipped.push(value), bodyLinks, header.length);
      replacements += bodyResult.replacements;
      let frontmatter = header;
      const parentsBlock = /(^parents:[^\r\n]*(?:\r?\n[ \t]*-[^\r\n]*)*)/m.exec(frontmatter);
      if (parentsBlock) {
        const parentResult = replaceLinks(parentsBlock[0], file.path, (value) => skipped.push(value));
        replacements += parentResult.replacements;
        frontmatter = frontmatter.slice(0, parentsBlock.index) + parentResult.content + frontmatter.slice(parentsBlock.index + parentsBlock[0].length);
      }
      replacementContent = frontmatter + bodyResult.content;
    } else {
      const bodyResult = replaceLinks(original, file.path, (value) => skipped.push(value), bodyLinks);
      replacements = bodyResult.replacements;
      replacementContent = bodyResult.content;
    }
    if (replacements > 0) entries.push({ path: file.path, expectedContent: original, replacementContent, replacements });
  }
  return { entries, replacementCount: entries.reduce((sum, entry) => sum + entry.replacements, 0), skipped: [...new Set(skipped)] };
}

interface Deps {
  app: App;
  fileStorage: FileStorage;
  noteRepository: { replaceIfUnchanged(path: string, expected: string, content: string): Promise<"updated" | "missing" | "changed"> };
  cruidCache: CruidCache;
  duplicateManager: DuplicateManager;
  providerManager: ModelGateway;
  promptManager: PromptManager;
  settingsStore: SettingsStore;
  reindex: (path: string) => Promise<Result<{ indexed: number; failed: number }>>;
  logger: ILogger;
}

export class DuplicateMergeService {
  private store: DuplicateMergeOperationsStore = { version: "1.0.0", operations: [] };
  private readonly active = new Set<string>();
  private readonly pendingMutations = new Set<Promise<unknown>>();
  private disposed = false;

  constructor(private readonly deps: Deps) {}

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.allSettled([...this.pendingMutations]);
  }

  private async mutate<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.disposed) return err("E310_INVALID_STATE", "合并服务已停止");
    // All pairs share one journal and rollback snapshot. Different pair IDs
    // must not write its temporary file or roll back each other's changes.
    if (this.pendingMutations.size > 0) return err("E320_TASK_CONFLICT", "另一项合并或恢复操作正在保存，请等待完成");
    const pending = operation();
    this.pendingMutations.add(pending);
    try { return await pending; } finally { this.pendingMutations.delete(pending); }
  }

  async initialize(): Promise<Result<void>> {
    if (!(await this.deps.fileStorage.exists(STORE_PATH))) return ok(undefined);
    const read = await this.deps.fileStorage.read(STORE_PATH);
    if (!read.ok) return read;
    try {
      const parsed = JSON.parse(read.value) as DuplicateMergeOperationsStore;
      if (parsed.version !== "1.0.0" || !Array.isArray(parsed.operations)) {
        this.deps.logger.warn("DuplicateMergeService", "重复合并恢复存储版本或结构无效，已跳过恢复", { path: STORE_PATH });
        return ok(undefined);
      }
      const operations = parsed.operations.filter(validMergeOperation);
      if (operations.length !== parsed.operations.length) {
        this.deps.logger.warn("DuplicateMergeService", "重复合并恢复存储包含无效操作，已跳过无效记录", {
          skipped: parsed.operations.length - operations.length,
        });
      }
      this.store = { version: "1.0.0", operations };
      return ok(undefined);
    } catch (error) {
      this.deps.logger.warn("DuplicateMergeService", "重复合并恢复存储不是有效 JSON，已跳过恢复并保留原文件", {
        path: STORE_PATH,
        error,
      });
      return ok(undefined);
    }
  }

  getRecoveryOperations(): DuplicateMergeOperation[] {
    return this.store.operations.filter((operation) => operation.phase !== "completed").map((operation) => ({ ...operation }));
  }

  async prepareMerge(pairId: string, canonicalNodeId: string, signal?: AbortSignal): Promise<Result<DuplicateMergePreview>> {
    if (this.disposed) return err("E310_INVALID_STATE", "合并服务已停止");
    const pair = this.deps.duplicateManager.getPair(pairId);
    if (!pair || pair.status !== "pending") return err("E311_NOT_FOUND", "重复对不存在或已处理");
    const redundantNodeId = canonicalNodeId === pair.nodeIdA ? pair.nodeIdB : canonicalNodeId === pair.nodeIdB ? pair.nodeIdA : "";
    if (!redundantNodeId) return err("E101_INVALID_INPUT", "主笔记必须属于该重复对");
    const canonical = await this.readSnapshot(canonicalNodeId);
    const redundant = await this.readSnapshot(redundantNodeId);
    if (!canonical.ok) return canonical; if (!redundant.ok) return redundant;
    if (signal?.aborted) return err("E310_INVALID_STATE", "合并已取消");
    const snapshots = new Map<string, string>();
    for (const file of this.deps.app.vault.getMarkdownFiles()) snapshots.set(file.path, await this.deps.app.vault.cachedRead(file));
    const settings = this.deps.settingsStore.getSettings();
    const model = resolveTaskModelSnapshot(settings, "merge");
    if (!model.providerId || !model.model) return err("E401_PROVIDER_NOT_CONFIGURED", "请先配置合并任务模型");
    // Merge is not a queued attempt, so it must obey the same provider
    // availability rule as every other entry point before spending a request.
    const provider = resolveAvailableProvider(settings, model.providerId);
    if (!provider.ok) return provider;
    const input = JSON.stringify({ canonical: canonical.value, redundant: redundant.value });
    let prompt: string;
    try { prompt = this.deps.promptManager.build("merge", { CTX_CURRENT: input }); }
    catch (error) { return toErr(error, "E405_TEMPLATE_INVALID", "合并提示词不可用"); }
    const response = await this.deps.providerManager.chat(buildTaskChatRequest("merge", prompt, model, MERGE_SCHEMA, "duplicate-merge"), signal);
    if (this.disposed) return err("E310_INVALID_STATE", "合并服务已停止");
    if (!response.ok) return response;
    const finish = validateChatFinishReason(response.value.finishReason);
    if (!finish.ok) return finish;
    let parsed: unknown;
    try { parsed = JSON.parse(response.value.content); } catch { return err("E205_PROVIDER_REQUEST_INVALID", "合并模型返回的 JSON 无效"); }
    if (!validDraft(parsed)) return err("E205_PROVIDER_REQUEST_INVALID", "合并模型返回字段不完整");
    const raw = parsed as Record<string, unknown>;
    const draft: DuplicateMergeDraft = {
      pairId, canonicalNodeId, redundantNodeId,
      canonicalContentHash: canonical.value.contentHash, redundantContentHash: redundant.value.contentHash,
      body: raw.body as string, name: raw.name as string,
      aliases: uniqueStrings(raw.aliases), tags: uniqueStrings(raw.tags), parents: uniqueStrings(raw.parents), sourceUids: uniqueStrings(raw.sourceUids), conflicts: uniqueStrings(raw.conflicts),
    };
    const redundantFile = this.deps.cruidCache.getFile(redundantNodeId);
    const canonicalFile = this.deps.cruidCache.getFile(canonicalNodeId);
    if (!redundantFile || !canonicalFile) return err("E311_NOT_FOUND", "重复对涉及的笔记已不存在");
    return ok({ pairId, type: pair.type, similarity: pair.similarity, canonical: canonical.value, redundant: redundant.value, draft, linkRepairPlan: buildLinkPlan(this.deps.app, redundantFile, canonicalFile, snapshots) });
  }

  async confirmMerge(draft: DuplicateMergeDraft, linkRepairPlan: LinkRepairPlan): Promise<Result<DuplicateMergeOperation>> {
    return this.mutate(() => this.confirmReserved(draft, linkRepairPlan));
  }

  private async confirmReserved(draft: DuplicateMergeDraft, linkRepairPlan: LinkRepairPlan): Promise<Result<DuplicateMergeOperation>> {
    if (this.active.has(draft.pairId)) return err("E320_TASK_CONFLICT", "该重复对正在处理中");
    this.active.add(draft.pairId);
    try {
      return await this.confirmMergeInternal(draft, linkRepairPlan);
    } finally {
      this.active.delete(draft.pairId);
    }
  }

  private async confirmMergeInternal(draft: DuplicateMergeDraft, linkRepairPlan: LinkRepairPlan): Promise<Result<DuplicateMergeOperation>> {
    const pair = this.deps.duplicateManager.getPair(draft.pairId);
    if (!pair || pair.status !== "pending") return err("E311_NOT_FOUND", "重复对不存在或已处理");
    const canonical = await this.readSnapshot(draft.canonicalNodeId); const redundant = await this.readSnapshot(draft.redundantNodeId);
    if (!canonical.ok) return canonical; if (!redundant.ok) return redundant;
    if (canonical.value.contentHash !== draft.canonicalContentHash || redundant.value.contentHash !== draft.redundantContentHash) return err("E320_TASK_CONFLICT", "笔记在生成合并稿后已修改，请重新生成");
    const currentSnapshots = new Map<string, string>();
    for (const file of this.deps.app.vault.getMarkdownFiles()) currentSnapshots.set(file.path, await this.deps.app.vault.cachedRead(file));
    const canonicalFile = this.deps.cruidCache.getFile(draft.canonicalNodeId);
    const redundantFile = this.deps.cruidCache.getFile(draft.redundantNodeId);
    if (!canonicalFile || !redundantFile) return err("E311_NOT_FOUND", "重复对涉及的笔记已不存在");
    const currentPlan = buildLinkPlan(this.deps.app, redundantFile, canonicalFile, currentSnapshots);
    if (JSON.stringify(currentPlan) !== JSON.stringify(linkRepairPlan)) return err("E320_TASK_CONFLICT", "链接修复预览已过期，请重新生成");
    // The merge rewrites the canonical note. `updated` is stamped here, before
    // the durable operation record, so a recovered merge writes identical bytes.
    const targetFm: CRFrontmatter = { ...canonical.value.frontmatter, name: draft.name.trim() || canonical.value.frontmatter.name, updated: formatCRTimestamp(), aliases: uniqueStrings(draft.aliases), tags: uniqueStrings(draft.tags), parents: normalizeParents(uniqueStrings(draft.parents)), sourceUids: uniqueStrings(draft.sourceUids) };
    const targetContent = generateMarkdownContent(targetFm, draft.body, canonical.value.content);
    const operation: DuplicateMergeOperation = { id: `${draft.pairId}:${draft.canonicalNodeId}`, version: "1.0.0", phase: "prepared", preview: { pairId: draft.pairId, type: pair.type, similarity: pair.similarity, canonical: canonical.value, redundant: redundant.value, draft, linkRepairPlan }, canonicalTargetContent: targetContent, completedPaths: [], updatedAt: Date.now() };
    this.store.operations = [...this.store.operations.filter((item) => item.id !== operation.id), operation];
    // Reserve the pair before the first await so two UI confirmations cannot
    // both pass the conflict check during the initial operation-log write.
    this.active.add(operation.id);
    const saved = await this.save();
    if (!saved.ok) { this.active.delete(operation.id); return saved; }
    try { return await this.execute(operation); } finally { this.active.delete(operation.id); }
  }

  async resumeMerge(operationId: string): Promise<Result<DuplicateMergeOperation>> {
    return this.mutate(() => this.resumeInternal(operationId));
  }

  private async resumeInternal(operationId: string): Promise<Result<DuplicateMergeOperation>> {
    const operation = this.store.operations.find((item) => item.id === operationId);
    if (!operation) return err("E311_NOT_FOUND", "合并操作不存在");
    const pairKey = operation.preview.pairId;
    if (this.active.has(operationId) || this.active.has(pairKey)) return err("E320_TASK_CONFLICT", "合并操作正在运行");
    this.active.add(operationId);
    this.active.add(pairKey);
    try { return await this.execute(operation); } finally { this.active.delete(operationId); this.active.delete(pairKey); }
  }

  async discardRecovery(operationId: string): Promise<Result<void>> {
    return this.mutate(() => this.discardInternal(operationId));
  }

  private async discardInternal(operationId: string): Promise<Result<void>> {
    if (this.active.has(operationId)) return err("E320_TASK_CONFLICT", "合并操作正在运行");
    const previous = this.store.operations;
    const operation = previous.find((item) => item.id === operationId);
    if (!operation) return err("E311_NOT_FOUND", "合并操作不存在");
    this.store.operations = previous.filter((item) => item.id !== operationId);
    const saved = await this.save();
    if (!saved.ok) {
      this.store.operations = previous;
      return saved;
    }
    return ok(undefined);
  }

  private async execute(operation: DuplicateMergeOperation): Promise<Result<DuplicateMergeOperation>> {
    if (this.disposed) return err("E310_INVALID_STATE", "合并服务已停止");
    if (operation.phase === "failed") {
      operation.phase = operation.completedPaths.includes(operation.preview.canonical.path) ? "canonical-written" : "prepared";
    }
    const preview = operation.preview;
    const canonicalFile = this.deps.cruidCache.getFile(preview.draft.canonicalNodeId);
    const redundantFile = this.deps.cruidCache.getFile(preview.draft.redundantNodeId);
    if (!canonicalFile) return this.fail(operation, "E311_NOT_FOUND", "主笔记不存在");
    // Once the trash step has completed, Obsidian removes the redundant file
    // from the active vault and CruidCache. Recovery must still be able to
    // finish pair cleanup after a checkpoint or restart at that boundary.
    if (operation.phase !== "redundant-trash-pending" && operation.phase !== "redundant-trashed" && operation.phase !== "completed" && !redundantFile) {
      return this.fail(operation, "E311_NOT_FOUND", "冗余笔记不存在");
    }
    if (operation.phase === "prepared") {
      const result = await this.deps.noteRepository.replaceIfUnchanged(canonicalFile.path, preview.canonical.content, operation.canonicalTargetContent);
      if (result === "changed") return this.fail(operation, "E320_TASK_CONFLICT", "主笔记已被修改");
      if (result === "missing") return this.fail(operation, "E311_NOT_FOUND", "主笔记不存在");
      operation.phase = "canonical-written"; operation.completedPaths.push(canonicalFile.path);
      const checkpoint = await this.checkpoint(operation);
      if (!checkpoint.ok) return checkpoint as Result<DuplicateMergeOperation>;
    }
    if (operation.phase === "canonical-written") {
      for (const entry of preview.linkRepairPlan.entries) {
        if (this.disposed) return err("E310_INVALID_STATE", "合并服务已停止");
        const file = this.deps.app.vault.getAbstractFileByPath(entry.path);
        if (file && "extension" in file) {
          const current = await this.deps.app.vault.cachedRead(file as TFile);
          if (current === entry.replacementContent) {
            if (!operation.completedPaths.includes(entry.path)) operation.completedPaths.push(entry.path);
            continue;
          }
        }
        const result = await this.deps.noteRepository.replaceIfUnchanged(entry.path, entry.expectedContent, entry.replacementContent);
        if (result === "changed") return this.fail(operation, "E320_TASK_CONFLICT", `链接所在笔记已修改: ${entry.path}`);
        if (result === "updated") operation.completedPaths.push(entry.path);
      }
      operation.phase = "links-repaired";
      const checkpoint = await this.checkpoint(operation);
      if (!checkpoint.ok) return checkpoint as Result<DuplicateMergeOperation>;
    }
    if (operation.phase === "links-repaired") {
      const indexed = await this.deps.reindex(canonicalFile.path);
      if (!indexed.ok || indexed.value.indexed === 0) return this.fail(operation, indexed.ok ? "E500_INTERNAL_ERROR" : indexed.error.code, indexed.ok ? "主笔记向量刷新失败" : indexed.error.message);
      operation.phase = "canonical-indexed";
      const checkpoint = await this.checkpoint(operation);
      if (!checkpoint.ok) return checkpoint as Result<DuplicateMergeOperation>;
    }
    if (operation.phase === "canonical-indexed") {
      operation.phase = "redundant-trash-pending";
      const intentCheckpoint = await this.checkpoint(operation);
      if (!intentCheckpoint.ok) return intentCheckpoint as Result<DuplicateMergeOperation>;
    }
    if (operation.phase === "redundant-trash-pending") {
      // This phase is durable before the irreversible action. If the file is
      // already gone after a restart, the trash action completed before the
      // process failed and recovery can continue with pair cleanup.
      if (!redundantFile) {
        operation.phase = "redundant-trashed";
        const inferredCheckpoint = await this.checkpoint(operation);
        if (!inferredCheckpoint.ok) return inferredCheckpoint as Result<DuplicateMergeOperation>;
      } else {
      // Indexing and recovery can take arbitrarily long. Never trash edits
      // made after the confirmation snapshot was captured.
      if (await this.deps.app.vault.read(redundantFile) !== preview.redundant.content) {
        return this.fail(operation, "E320_TASK_CONFLICT", "冗余笔记在合并期间已修改，未移入回收站");
      }
      if (this.disposed) return err("E310_INVALID_STATE", "合并服务已停止");
      try { await this.deps.app.vault.trash(redundantFile, false); } catch { return this.fail(operation, "E500_INTERNAL_ERROR", "冗余笔记移入回收站失败"); }
      operation.phase = "redundant-trashed";
      const checkpoint = await this.checkpoint(operation);
      if (!checkpoint.ok) return checkpoint as Result<DuplicateMergeOperation>;
      }
    }
    if (operation.phase === "redundant-trashed") {
      const cleaned = await this.deps.duplicateManager.removePairsByNodeId(preview.draft.redundantNodeId);
      if (!cleaned.ok) return this.fail(operation, cleaned.error.code, cleaned.error.message);
      operation.phase = "completed";
      // A completed merge is terminal and is never offered for recovery, so
      // its note snapshots and link-repair payloads must not accumulate in the
      // durable log forever.
      this.store.operations = this.store.operations.filter((item) => item.id !== operation.id);
      const checkpoint = await this.checkpoint(operation);
      if (!checkpoint.ok) {
        operation.phase = "redundant-trashed";
        this.store.operations.push(operation);
        return checkpoint as Result<DuplicateMergeOperation>;
      }
    }
    return ok(operation);
  }

  private async readSnapshot(nodeId: string): Promise<Result<DuplicateMergeNoteSnapshot>> {
    const file = this.deps.cruidCache.getFile(nodeId); if (!file) return err("E311_NOT_FOUND", `笔记不存在: ${nodeId}`);
    const content = await this.deps.app.vault.cachedRead(file); const parsed = extractFrontmatter(content); if (!parsed) return err("E101_INVALID_INPUT", `笔记 frontmatter 无效: ${file.path}`);
    return ok({ nodeId, path: file.path, content, contentHash: hash(content), frontmatter: parsed.frontmatter });
  }

  private async fail(operation: DuplicateMergeOperation, code: string, message: string): Promise<Result<DuplicateMergeOperation>> {
    // A rejected trash call may already have removed the file. Preserve the
    // durable intent so recovery can inspect its presence, finish pair cleanup
    // if absent, or validate the original snapshot before retrying trash.
    if (operation.phase !== "redundant-trash-pending" && operation.phase !== "redundant-trashed") operation.phase = "failed";
    operation.error = { code, message };
    operation.updatedAt = Date.now();
    await this.save();
    return err(code, message, { operationId: operation.id });
  }

  /** Persist a phase boundary before allowing the next external side effect. */
  private async checkpoint(operation: DuplicateMergeOperation): Promise<Result<void>> {
    const saved = await this.save();
    if (saved.ok) return this.disposed ? err("E310_INVALID_STATE", "合并服务已停止") : saved;
    operation.error = {
      code: saved.error.code,
      message: "合并检查点保存失败，后续步骤已暂停；请修复存储后继续恢复",
    };
    this.deps.logger.error("DuplicateMergeService", "合并检查点保存失败，已暂停后续步骤", undefined, {
      operationId: operation.id,
      phase: operation.phase,
      error: saved.error,
    });
    return err(saved.error.code, operation.error.message, { operationId: operation.id, phase: operation.phase });
  }
  private async save(): Promise<Result<void>> {
    const updatedAt = Date.now();
    for (const operation of this.store.operations) operation.updatedAt = updatedAt;
    return this.deps.fileStorage.atomicWrite(STORE_PATH, JSON.stringify(this.store, null, 2));
  }
}

/** Public application-facing name retained alongside the runtime service name. */
export { DuplicateMergeService as DuplicateMergeApplication };
