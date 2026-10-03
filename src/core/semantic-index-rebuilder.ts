import type { App } from "obsidian";
import { err, ok, toErr } from "../types";
import type { CRType, EmbedRequest, ILogger, PluginSettings, Result, ResolvedTaskConfig, VectorEntry } from "../types";
import type { SettingsStore } from "../data/settings-store";
import type { CruidCache, CruidCacheEntry } from "./cruid-cache";
import type { DuplicateManager } from "./duplicate-manager";
import { extractFrontmatter } from "./frontmatter-utils";
import type { ModelGateway } from "./model-gateway";
import { buildSemanticIndexText, semanticIndexTextHash } from "./semantic-index-text";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import type {
  VectorCleanupSummary,
  VectorIndex,
  VectorIndexMaintenanceReport,
} from "./vector-index";
import type { VectorFileRef } from "../types";
import {
  resolveVectorIndexConfig,
  vectorIndexConfigsEqual,
} from "./vector-config";
import type { VectorIndexConfig } from "./vector-config";

type SemanticIndexRebuildPhase =
  | "scanning"
  | "embedding"
  | "committing"
  | "duplicates";

export interface SemanticIndexRebuildProgress {
  phase: SemanticIndexRebuildPhase;
  completed: number;
  total: number;
  failed: number;
}

export interface SemanticIndexRebuildSummary {
  totalNotes: number;
  indexed: number;
  skipped: number;
  duplicatePairs?: number;
  duplicateRefreshFailed: boolean;
}

interface RebuildCandidate {
  entry: CruidCacheEntry;
  content: string;
  input: string;
  sourceHash: string;
  type: CRType;
  status: "draft" | "evergreen";
}

export interface MissingVectorNote {
  cruid: string;
  name: string;
  path: string;
  type: CRType;
  status: "draft" | "evergreen";
}

export interface SemanticIndexStatus {
  eligible: number;
  indexed: number;
  missing: number;
  missingNotes: MissingVectorNote[];
}

interface SemanticIndexRebuilderDeps {
  app: App;
  cruidCache: CruidCache;
  providerManager: ModelGateway;
  vectorIndex: VectorIndex;
  duplicateManager: DuplicateManager;
  settingsStore: SettingsStore;
  logger: ILogger;
}

type ProgressListener = (progress: SemanticIndexRebuildProgress) => void;

export class SemanticIndexRebuilder {
  private activeOperation: Promise<unknown> | undefined;
  private activeController: AbortController | undefined;
  private disposePromise: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly deps: SemanticIndexRebuilderDeps) {}

  async scanStatus(): Promise<Result<SemanticIndexStatus>> {
    if (this.disposed) return err("E310_INVALID_STATE", "语义索引服务已停止");
    const snapshot = await this.deps.cruidCache.snapshotEntries();
    const candidates = await this.collectCandidates(snapshot, new AbortController().signal);
    if (!candidates.ok) return candidates as Result<SemanticIndexStatus>;
    const missing = await this.findMissingCandidates(candidates.value);
    if (!missing.ok) return missing as Result<SemanticIndexStatus>;
    if (this.disposed) return err("E310_INVALID_STATE", "语义索引服务已停止");
    const missingNotes = missing.value
      .map((candidate) => ({ cruid: candidate.entry.cruid, name: candidate.entry.file.basename, path: candidate.entry.path, type: candidate.type, status: candidate.status }));
    return ok({ eligible: candidates.value.length, indexed: candidates.value.length - missingNotes.length, missing: missingNotes.length, missingNotes });
  }

  async embedMissing(): Promise<Result<{ eligible: number; indexed: number; skipped: number; failed: number }>> {
    return this.runTargeted(signal => this.embedMissingInternal(signal), true);
  }

  async inspectVectorFiles(): Promise<Result<VectorIndexMaintenanceReport>> {
    if (this.disposed) return err("E310_INVALID_STATE", "语义索引服务已停止");
    return this.deps.vectorIndex.inspectStorage();
  }

  async cleanupOrphanedVectorFiles(expected: VectorFileRef[]): Promise<Result<VectorCleanupSummary>> {
    if (this.disposed) return err("E310_INVALID_STATE", "语义索引服务已停止");
    return this.runTargeted(() => this.deps.vectorIndex.cleanupOrphanFiles(expected));
  }

  private async embedMissingInternal(signal: AbortSignal): Promise<Result<{ eligible: number; indexed: number; skipped: number; failed: number }>> {
    if (this.disposed) return err("E310_INVALID_STATE", "语义索引服务已停止");
    const settings = this.deps.settingsStore.getSettings();
    const prerequisite = this.validatePrerequisites(settings);
    if (!prerequisite.ok) return prerequisite as Result<{ eligible: number; indexed: number; skipped: number; failed: number }>;
    const candidates = await this.collectCandidates(await this.deps.cruidCache.snapshotEntries(), signal);
    if (!candidates.ok) return candidates as Result<{ eligible: number; indexed: number; skipped: number; failed: number }>;
    const missingResult = await this.findMissingCandidates(candidates.value);
    if (!missingResult.ok) return missingResult as Result<{ eligible: number; indexed: number; skipped: number; failed: number }>;
    const missing = missingResult.value;
    let indexed = 0; let failed = 0;
    const config = resolveVectorIndexConfig(settings);
    const model = resolveTaskModelSnapshot(settings, "index");
    for (const candidate of missing) {
      if (this.isStopped(signal)) return this.targetedStopped(signal);
      if (!this.currentConfigMatches(config)) {
        return err("E320_TASK_CONFLICT", "嵌入配置在补齐缺失向量期间发生变化，已中止");
      }
      const embedded = await this.deps.providerManager.embed(this.buildEmbedRequest(model, config, candidate.input), signal);
      if (this.isStopped(signal)) return this.targetedStopped(signal);
      if (!embedded.ok) { failed++; this.deps.logger.warn("SemanticIndexRebuilder", "缺失向量生成失败", { path: candidate.entry.path, errorCode: embedded.error.code }); continue; }
      const stable = await this.notesAreStable([candidate], signal);
      if (this.isStopped(signal)) return this.targetedStopped(signal);
      if (!stable.ok) {
        failed++;
        this.deps.logger.warn("SemanticIndexRebuilder", "笔记在补齐缺失向量期间发生变化，已跳过", { path: candidate.entry.path });
        continue;
      }
      if (!this.currentConfigMatches(config)) {
        return err("E320_TASK_CONFLICT", "嵌入配置在补齐缺失向量期间发生变化，已中止");
      }
      const written = await this.deps.vectorIndex.upsert({ uid: candidate.entry.cruid, type: candidate.type, embedding: embedded.value.embedding, sourceHash: candidate.sourceHash });
      if (!written.ok) { failed++; this.deps.logger.warn("SemanticIndexRebuilder", "缺失向量写入失败", { path: candidate.entry.path, errorCode: written.error.code }); continue; }
      indexed++;
      if (settings.enableDuplicateDetection) {
        // The duplicate store is derived from the index, so a vector written
        // here must refresh that node's pairs exactly like embedOne does.
        try {
          const refreshed = await this.deps.duplicateManager.refreshNode(candidate.entry.cruid, candidate.type, embedded.value.embedding);
          if (!refreshed.ok) this.deps.logger.warn("SemanticIndexRebuilder", "缺失向量已写入，但重复关系刷新失败", { path: candidate.entry.path, errorCode: refreshed.error.code });
        } catch (cause) {
          this.deps.logger.warn("SemanticIndexRebuilder", "缺失向量已写入，但重复关系刷新异常", { path: candidate.entry.path, error: cause });
        }
      }
    }
    return ok({ eligible: candidates.value.length, indexed, skipped: candidates.value.length - missing.length, failed });
  }

  async embedOne(cruid: string): Promise<Result<{ indexed: number; failed: number }>> {
    return this.runTargeted(signal => this.embedOneInternal(cruid, signal), true);
  }

  private async embedOneInternal(cruid: string, signal: AbortSignal): Promise<Result<{ indexed: number; failed: number }>> {
    if (this.disposed) return err("E310_INVALID_STATE", "语义索引服务已停止");
    const settings = this.deps.settingsStore.getSettings();
    const prerequisite = this.validatePrerequisites(settings);
    if (!prerequisite.ok) return prerequisite as Result<{ indexed: number; failed: number }>;
    const file = this.deps.cruidCache.getFile(cruid);
    if (!file) return err("E311_NOT_FOUND", "笔记不存在或不符合向量化条件");
    let content: string;
    try {
      content = await this.deps.app.vault.cachedRead(file);
    } catch {
      return err("E311_NOT_FOUND", "笔记不存在或不符合向量化条件");
    }
    if (this.isStopped(signal)) return this.targetedStopped(signal);
    const candidate = this.buildCandidate({ cruid, path: file.path, file }, content);
    if (!candidate) return err("E311_NOT_FOUND", "笔记不存在或不符合向量化条件");
    const config = resolveVectorIndexConfig(settings);
    const model = resolveTaskModelSnapshot(settings, "index");
    const embedded = await this.deps.providerManager.embed(this.buildEmbedRequest(model, config, candidate.input), signal);
    if (this.isStopped(signal)) return this.targetedStopped(signal);
    if (!embedded.ok) return ok({ indexed: 0, failed: 1 });
    const stable = await this.notesAreStable([candidate], signal);
    if (this.isStopped(signal)) return this.targetedStopped(signal);
    if (!stable.ok) return stable as Result<{ indexed: number; failed: number }>;
    if (!this.currentConfigMatches(config)) {
      return err("E320_TASK_CONFLICT", "嵌入配置在单篇生成期间发生变化，向量未写入");
    }
    const written = await this.deps.vectorIndex.upsert({ uid: candidate.entry.cruid, type: candidate.type, embedding: embedded.value.embedding, sourceHash: candidate.sourceHash });
    if (!written.ok) return ok({ indexed: 0, failed: 1 });
    if (settings.enableDuplicateDetection) {
      try {
        const refreshed = await this.deps.duplicateManager.refreshNode(
          candidate.entry.cruid,
          candidate.type,
          embedded.value.embedding,
        );
        if (!refreshed.ok) {
          this.deps.logger.warn("SemanticIndexRebuilder", "单篇向量已写入，但重复关系刷新失败", {
            cruid,
            error: refreshed.error,
          });
        }
      } catch (cause) {
        // The vector is already durable; a derived duplicate refresh failure
        // must not be reported as a missing vector or invite another charge.
        this.deps.logger.warn("SemanticIndexRebuilder", "单篇向量已写入，但重复关系刷新异常", {
          cruid,
          error: cause,
        });
      }
    }
    return ok({ indexed: 1, failed: 0 });
  }

  rebuild(onProgress?: ProgressListener): Promise<Result<SemanticIndexRebuildSummary>> {
    if (this.disposed) {
      return Promise.resolve(err("E310_INVALID_STATE", "语义索引重建服务已停止"));
    }
    if (this.activeOperation) {
      return Promise.resolve(err("E320_TASK_CONFLICT", "语义索引正在重建"));
    }

    const controller = new AbortController();
    this.activeController = controller;
    const operation = this.run(controller, onProgress);
    this.activeOperation = operation;
    void operation.then(() => {
      if (this.activeOperation === operation) {
        this.activeOperation = undefined;
        this.activeController = undefined;
      }
    });
    return operation;
  }

  cancel(): void {
    this.activeController?.abort(new Error("semantic index rebuild cancelled"));
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.cancel();
    const operation = this.activeOperation;
    this.disposePromise = (async () => {
      if (operation) await operation;
      this.activeOperation = undefined;
      this.activeController = undefined;
    })();
    return this.disposePromise;
  }

  private runTargeted<T>(operation: (signal: AbortSignal) => Promise<Result<T>>, watchSettings = false): Promise<Result<T>> {
    if (this.disposed) return Promise.resolve(err("E310_INVALID_STATE", "语义索引服务已停止"));
    if (this.activeOperation) return Promise.resolve(err("E320_TASK_CONFLICT", "语义索引维护操作正在进行"));
    const controller = new AbortController();
    this.activeController = controller;
    const initial = this.deps.settingsStore.getSettings();
    const config = resolveVectorIndexConfig(initial);
    const unsubscribe = watchSettings ? this.deps.settingsStore.subscribe(settings => {
      if (!settings.enableSemanticIndexing || settings.enableDuplicateDetection !== initial.enableDuplicateDetection ||
        !vectorIndexConfigsEqual(config, resolveVectorIndexConfig(settings)) ||
        resolveTaskModelSnapshot(settings, "index").providerSnapshot?.enabled !== true) controller.abort(new Error("embedding settings changed"));
    }) : () => {};
    const pending = (async () => {
      try { return await operation(controller.signal); }
      catch (cause) { return this.isStopped(controller.signal) ? this.targetedStopped(controller.signal) : toErr(cause, "E500_INTERNAL_ERROR", "语义索引维护失败"); }
      finally { unsubscribe(); }
    })();
    this.activeOperation = pending;
    void pending.then(() => {
      if (this.activeOperation === pending) { this.activeOperation = undefined; this.activeController = undefined; }
    });
    return pending;
  }

  private async run(
    controller: AbortController,
    onProgress?: ProgressListener,
  ): Promise<Result<SemanticIndexRebuildSummary>> {
    const initialSettings = this.deps.settingsStore.getSettings();
    const prerequisite = this.validatePrerequisites(initialSettings);
    if (!prerequisite.ok) return prerequisite;
    const vectorConfig = resolveVectorIndexConfig(initialSettings);
    const modelSnapshot = resolveTaskModelSnapshot(initialSettings, "index");
    const unsubscribe = this.deps.settingsStore.subscribe((settings) => {
      if (!settings.enableSemanticIndexing ||
        settings.enableDuplicateDetection !== initialSettings.enableDuplicateDetection ||
        !vectorIndexConfigsEqual(vectorConfig, resolveVectorIndexConfig(settings)) ||
        resolveTaskModelSnapshot(settings, "index").providerSnapshot?.enabled !== true) {
        controller.abort(new Error("embedding settings changed"));
      }
    });

    let committed = false;
    try {
      const snapshot = await this.deps.cruidCache.snapshotEntries();
      if (this.isStopped(controller.signal)) return this.cancelled();
      const candidates = await this.collectCandidates(snapshot, controller.signal, onProgress);
      if (!candidates.ok) return candidates;
      if (snapshot.length > 0 && candidates.value.length === 0) {
        return err("E101_INVALID_INPUT", "没有可索引的有效概念笔记，旧索引保持不变");
      }

      const vectors: VectorEntry[] = [];
      let failed = snapshot.length - candidates.value.length;
      this.emit(onProgress, {
        phase: "embedding",
        completed: 0,
        total: candidates.value.length,
        failed,
      });
      for (let index = 0; index < candidates.value.length; index += 1) {
        if (this.isStopped(controller.signal)) return this.cancelled();
        const candidate = candidates.value[index];
        const embedResult = await this.deps.providerManager.embed(
          this.buildEmbedRequest(modelSnapshot, vectorConfig, candidate.input),
          controller.signal,
        );
        if (this.isStopped(controller.signal)) return this.cancelled();
        if (embedResult.ok) {
          vectors.push({
            uid: candidate.entry.cruid,
            type: candidate.type,
            embedding: embedResult.value.embedding,
            sourceHash: candidate.sourceHash,
          });
        } else {
          failed += 1;
          this.deps.logger.warn("SemanticIndexRebuilder", "笔记嵌入失败，已跳过", {
            path: candidate.entry.path,
            errorCode: embedResult.error.code,
          });
        }
        this.emit(onProgress, {
          phase: "embedding",
          completed: index + 1,
          total: candidates.value.length,
          failed,
        });
      }

      if (candidates.value.length > 0 && vectors.length === 0) {
        return err("E204_PROVIDER_ERROR", "所有笔记的嵌入请求均失败，旧索引保持不变");
      }
      const stable = await this.notesAreStable(candidates.value, controller.signal);
      if (!stable.ok) return stable;
      if (!this.currentConfigMatches(vectorConfig) || this.isStopped(controller.signal)) {
        return this.cancelled("嵌入配置在重建期间发生变化，本次重建结果未提交");
      }

      this.emit(onProgress, {
        phase: "committing",
        completed: 0,
        total: vectors.length,
        failed,
      });
      if (this.isStopped(controller.signal) || !this.currentConfigMatches(vectorConfig)) return this.cancelled();
      const replaceResult = await this.deps.vectorIndex.replaceAll(vectors);
      if (!replaceResult.ok) return replaceResult as Result<SemanticIndexRebuildSummary>;
      committed = true;
      this.emit(onProgress, {
        phase: "committing",
        completed: vectors.length,
        total: vectors.length,
        failed,
      });

      this.emit(onProgress, {
        phase: "duplicates",
        completed: 0,
        total: 1,
        failed,
      });
      const duplicatesResult = initialSettings.enableDuplicateDetection
        ? await this.deps.duplicateManager.rebuildFromIndex()
        : await this.deps.duplicateManager.clearAll();
      const summary: SemanticIndexRebuildSummary = {
        totalNotes: snapshot.length,
        indexed: replaceResult.value,
        skipped: snapshot.length - replaceResult.value,
        duplicatePairs: initialSettings.enableDuplicateDetection && duplicatesResult.ok
          ? duplicatesResult.value
          : undefined,
        duplicateRefreshFailed: !duplicatesResult.ok,
      };
      if (!duplicatesResult.ok) {
        this.deps.logger.warn("SemanticIndexRebuilder", "语义索引已重建，但重复项刷新失败", {
          error: duplicatesResult.error,
        });
      }
      this.emit(onProgress, {
        phase: "duplicates",
        completed: 1,
        total: 1,
        failed,
      });
      this.deps.logger.info("SemanticIndexRebuilder", "语义索引重建完成", { ...summary });
      return ok(summary);
    } catch (error) {
      if (committed) return toErr(error, "E500_INTERNAL_ERROR", "语义索引已提交，但后续重复项刷新未完成");
      if (this.isStopped(controller.signal)) return this.cancelled();
      return toErr(error, "E500_INTERNAL_ERROR", "重建语义索引失败");
    } finally {
      unsubscribe();
    }
  }

  private validatePrerequisites(settings: PluginSettings): Result<void> {
    if (!settings.enableSemanticIndexing) {
      return err("E310_INVALID_STATE", "请先启用语义索引");
    }
    const snapshot = resolveTaskModelSnapshot(settings, "index");
    const provider = settings.providers[snapshot.providerId];
    if (!provider || !provider.enabled || provider.embeddingApiFormat !== "openai-embeddings") {
      return err("E401_PROVIDER_NOT_CONFIGURED", "Index 任务没有可用的嵌入 Provider");
    }
    if (!snapshot.model.trim()) {
      return err("E101_INVALID_INPUT", "Index 任务没有配置嵌入模型");
    }
    const config = resolveVectorIndexConfig(settings);
    if (this.deps.vectorIndex.getEmbeddingProfile() !== config.profile ||
      this.deps.vectorIndex.getEmbeddingModel() !== config.model ||
      (config.dimension !== undefined && this.deps.vectorIndex.getEmbeddingDimension() !== config.dimension)) {
      return err("E310_INVALID_STATE", "向量配置尚未应用，请稍后重试");
    }
    return ok(undefined);
  }

  private async findMissingCandidates(candidates: RebuildCandidate[]): Promise<Result<RebuildCandidate[]>> {
    // Routine note edits deliberately keep their existing embedding. Only
    // missing/unusable physical vectors enter the default repair operation.
    // Read storage, not recent caches: registration alone is not sufficient.
    const inspected = await this.deps.vectorIndex.inspectStorage();
    if (!inspected.ok) return inspected as Result<RebuildCandidate[]>;
    const unavailable = new Set([...inspected.value.missingEntries, ...inspected.value.invalidEntries, ...inspected.value.staleEntries].map(entry => entry.uid));
    return ok(candidates.filter(candidate => unavailable.has(candidate.entry.cruid) ||
      !this.deps.vectorIndex.has(candidate.entry.cruid)));
  }

  private targetedStopped(signal: AbortSignal): Result<never> {
    return signal.reason instanceof Error && signal.reason.message === "embedding settings changed"
      ? err("E320_TASK_CONFLICT", "索引设置已改变，维护操作已停止，尚未提交结果不会写入")
      : err("E310_INVALID_STATE", "语义索引维护已停止，尚未提交结果不会写入");
  }

  private async collectCandidates(
    snapshot: CruidCacheEntry[],
    signal: AbortSignal,
    onProgress?: ProgressListener,
  ): Promise<Result<RebuildCandidate[]>> {
    const candidates: RebuildCandidate[] = [];
    let failed = 0;
    this.emit(onProgress, { phase: "scanning", completed: 0, total: snapshot.length, failed });
    for (let index = 0; index < snapshot.length; index += 1) {
      if (this.isStopped(signal)) return this.cancelled();
      const entry = snapshot[index];
      try {
        if (this.deps.app.vault.getAbstractFileByPath(entry.path) !== entry.file) {
          failed += 1;
        } else {
          const content = await this.deps.app.vault.cachedRead(entry.file);
          const candidate = this.buildCandidate(entry, content);
          if (!candidate) {
            failed += 1;
          } else {
            candidates.push(candidate);
          }
        }
      } catch (error) {
        failed += 1;
        this.deps.logger.warn("SemanticIndexRebuilder", "读取待索引笔记失败，已跳过", {
          path: entry.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.emit(onProgress, {
        phase: "scanning",
        completed: index + 1,
        total: snapshot.length,
        failed,
      });
    }
    return ok(candidates);
  }

  /** Parse one note into an index candidate; null when the note is not
   * eligible (missing/invalid frontmatter or a seed note). */
  private buildCandidate(entry: CruidCacheEntry, content: string): RebuildCandidate | null {
    const parsed = extractFrontmatter(content);
    if (!parsed || parsed.frontmatter.cruid !== entry.cruid) return null;
    if (parsed.frontmatter.status !== "draft" && parsed.frontmatter.status !== "evergreen") {
      // seed notes are intentionally not eligible for semantic indexing.
      return null;
    }
    const input = buildSemanticIndexText({ name: parsed.frontmatter.name, type: parsed.frontmatter.type, aliases: parsed.frontmatter.aliases, tags: parsed.frontmatter.tags, body: parsed.body });
    return { entry, content, input, sourceHash: semanticIndexTextHash(input), type: parsed.frontmatter.type, status: parsed.frontmatter.status };
  }

  /** Single source for the embed request shape shared by rebuild, embedMissing
   * and embedOne. */
  private buildEmbedRequest(
    model: ResolvedTaskConfig,
    config: VectorIndexConfig,
    input: string,
  ): EmbedRequest {
    return {
      providerId: model.providerId,
      providerSnapshot: model.providerSnapshot,
      model: config.model,
      input,
      ...(model.embeddingDimension !== undefined ? { dimensions: model.embeddingDimension } : {}),
    };
  }

  private async notesAreStable(
    candidates: RebuildCandidate[],
    signal: AbortSignal,
  ): Promise<Result<void>> {
    for (const candidate of candidates) {
      if (this.isStopped(signal)) return this.cancelled();
      if (this.deps.cruidCache.getFile(candidate.entry.cruid) !== candidate.entry.file ||
        candidate.entry.file.path !== candidate.entry.path ||
        this.deps.app.vault.getAbstractFileByPath(candidate.entry.path) !== candidate.entry.file) {
        return err("E320_TASK_CONFLICT", "笔记在重建期间发生变化，旧索引保持不变");
      }
      try {
        if (await this.deps.app.vault.read(candidate.entry.file) !== candidate.content) {
          return err("E320_TASK_CONFLICT", "笔记在重建期间发生变化，旧索引保持不变");
        }
      } catch {
        return err("E320_TASK_CONFLICT", "笔记在重建期间发生变化，旧索引保持不变");
      }
    }
    return ok(undefined);
  }

  private currentConfigMatches(expected: VectorIndexConfig): boolean {
    return vectorIndexConfigsEqual(
      expected,
      resolveVectorIndexConfig(this.deps.settingsStore.getSettings()),
    );
  }

  private emit(listener: ProgressListener | undefined, progress: SemanticIndexRebuildProgress): void {
    if (!listener) return;
    try {
      listener({ ...progress });
    } catch (error) {
      this.deps.logger.warn("SemanticIndexRebuilder", "重建进度监听器执行失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private isStopped(signal: AbortSignal): boolean {
    return this.disposed || signal.aborted;
  }

  private cancelled(message = "语义索引重建已取消，旧索引保持不变"): Result<never> {
    return err("E310_INVALID_STATE", message);
  }
}
