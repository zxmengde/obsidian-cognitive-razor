import { showWarning } from "../ui/feedback";
import { CardGenerationService } from "../core/card-generation-service";
import type { App } from "obsidian";
import { err } from "../types";
import type { PluginSettings, Result } from "../types";
import { FileStorage } from "../data/file-storage";
import { WorkflowStore } from "../data/workflow-store";
import { Logger, reportHostDiagnostic } from "../data/logger";
import { SettingsStore } from "../data/settings-store";
import { Validator } from "../data/validator";
import { ContentRenderer } from "../core/content-renderer";
import { CreateOrchestrator } from "../core/create-orchestrator";
import { CruidCache } from "../core/cruid-cache";
import { DuplicateManager } from "../core/duplicate-manager";
import { ExpandOrchestrator } from "../core/expand-orchestrator";
import { I18n } from "../core/i18n";
import { NoteRepository } from "../core/note-repository";
import { PromptManager } from "../core/prompt-manager";
import { ProviderManager } from "../core/provider-manager";
import { schemaRegistry } from "../core/schema-registry";
import { SemanticIndexRebuilder } from "../core/semantic-index-rebuilder";
import type { SemanticIndexPort } from "./settings-application";
import { TaskQueue } from "../core/task-queue";
import { TaskRunner } from "../core/task-runner";
import { VectorIndex } from "../core/vector-index";
import { recoverInterruptedReset } from "../data/runtime-data-maintenance";
import {
  resolveVectorIndexConfig,
  vectorIndexConfigsEqual,
} from "../core/vector-config";
import type { VectorIndexConfig } from "../core/vector-config";
import { VerifyOrchestrator } from "../core/verify-orchestrator";
import { WorkflowCoordinator } from "../core/workflow-coordinator";
import { WorkbenchApplication } from "./workbench-application";
import { InMemoryExternalCallLedger } from "../core/external-call-ledger";
import { DuplicateMergeService } from "../core/duplicate-merge-service";
import type { ExternalCallLedger } from "../core/external-call-ledger";

/**
 * The runtime owns every service that performs vault I/O, background work, or
 * network work. It is created only when the user opens the workbench or starts
 * an operation, and has one corresponding disposal path.
 */
export class PluginRuntime {
  private fileStorage!: FileStorage;
  logger!: Logger;
  private validator!: Validator;
  private cruidCache!: CruidCache;
  private vectorIndex!: VectorIndex;
  private providerManager!: ProviderManager;
  private readonly externalCallLedger: ExternalCallLedger;
  private promptManager!: PromptManager;
  private semanticIndexRebuilder!: SemanticIndexRebuilder;
  duplicateManager!: DuplicateManager;
  private taskRunner!: TaskRunner;
  private cardGeneration!: CardGenerationService;
  private workflowStore!: WorkflowStore;
  private workflowCoordinator!: WorkflowCoordinator;
  taskQueue!: TaskQueue;
  createOrchestrator!: CreateOrchestrator;
  verifyOrchestrator!: VerifyOrchestrator;
  expandOrchestrator!: ExpandOrchestrator;
  private workbenchApplication?: WorkbenchApplication;
  private duplicateMergeService!: DuplicateMergeService;

  private initialized = false;
  private disposed = false;
  private startPromise: Promise<void> | undefined;
  private disposePromise: Promise<void> | undefined;
  private cleanupPromise: Promise<void> | undefined;
  private lifecycleGeneration = 0;
  private unsubscribeSettings: (() => void) | undefined;
  private unsubscribeDelete: (() => void) | undefined;
  /** 已触发的删除后清理按链收尾，避免卸载时访问已释放索引。 */
  private deleteCleanupChain: Promise<void> = Promise.resolve();
  private vectorReconfigure = Promise.resolve();
  private appliedVectorConfig: VectorIndexConfig | undefined;
  private requestedVectorConfig: VectorIndexConfig | undefined;

  constructor(
    private readonly app: App,
    private readonly pluginDir: string,
    private readonly settingsStore: SettingsStore,
    private readonly i18n: I18n,
    externalCallLedger: ExternalCallLedger = new InMemoryExternalCallLedger(),
  ) {
    this.externalCallLedger = externalCallLedger;
  }

  get isReady(): boolean {
    return this.initialized && !this.disposed;
  }

  getConceptName(cruid: string): string | null {
    return this.cruidCache.getName(cruid);
  }

  getWorkbenchApplication(): WorkbenchApplication {
    if (!this.isReady || !this.workbenchApplication) {
      throw new Error("插件工作台尚未就绪");
    }
    return this.workbenchApplication;
  }

  private semanticIndexPort?: SemanticIndexPort;

  /** Readiness-guarded semantic index operations, exposed as one port. */
  getSemanticIndexPort(): SemanticIndexPort {
    this.semanticIndexPort ??= this.createSemanticIndexPort();
    return this.semanticIndexPort;
  }

  private createSemanticIndexPort(): SemanticIndexPort {
    const notReady = <T>(): Result<T> => err("E310_INVALID_STATE", "插件运行时尚未就绪");
    const guard = <T>(operation: () => Promise<Result<T>>): Promise<Result<T>> =>
      this.isReady ? operation() : Promise.resolve(notReady());
    const afterVectorReconfigure = async <T>(operation: () => Promise<Result<T>>): Promise<Result<T>> => {
      if (!this.isReady) return notReady();
      this.requestedVectorConfig = resolveVectorIndexConfig(this.settingsStore.getSettings());
      this.scheduleVectorReconfigure();
      await this.vectorReconfigure;
      if (!this.isReady) return err("E310_INVALID_STATE", "插件运行时正在释放");
      return operation();
    };
    return {
      rebuildSemanticIndex: (onProgress) =>
        afterVectorReconfigure(() => this.semanticIndexRebuilder.rebuild(onProgress)),
      rebuildDuplicatePairs: () =>
        afterVectorReconfigure(() => this.duplicateManager.rebuildFromIndex()),
      cancelSemanticIndexRebuild: () => {
        this.semanticIndexRebuilder?.cancel();
      },
      scanSemanticIndex: () => afterVectorReconfigure(() => this.semanticIndexRebuilder.scanStatus()),
      embedMissingSemanticIndex: () => afterVectorReconfigure(() => this.semanticIndexRebuilder.embedMissing()),
      embedOneSemanticIndex: (cruid) => afterVectorReconfigure(() => this.semanticIndexRebuilder.embedOne(cruid)),
      inspectVectorFiles: () => guard(() => this.semanticIndexRebuilder.inspectVectorFiles()),
      cleanupOrphanedVectorFiles: (expected) => guard(() => this.semanticIndexRebuilder.cleanupOrphanedVectorFiles(expected)),
    };
  }

  async rebuildSemanticNote(filePath: string) {
    if (!this.isReady) return err("E310_INVALID_STATE", "插件运行时尚未就绪");
    const cruid = this.cruidCache.getCruidByPath(filePath);
    if (!cruid) return err("E311_NOT_FOUND", "当前笔记不是 Cognitive Razor 笔记");
    return this.getSemanticIndexPort().embedOneSemanticIndex(cruid);
  }

  async start(): Promise<void> {
    if (this.isReady) {
      return;
    }
    if (this.disposed) {
      throw new Error("插件运行时已释放");
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    const generation = ++this.lifecycleGeneration;
    this.cleanupPromise = undefined;
    const startPromise = this.initialize(generation).catch(async (error: unknown) => {
      await this.cleanupResources();
      throw error;
    });
    this.startPromise = startPromise;
    startPromise.then(
      () => {
        if (this.startPromise === startPromise && !this.isReady) {
          this.startPromise = undefined;
        }
      },
      () => {
        if (this.startPromise === startPromise) {
          this.startPromise = undefined;
        }
      },
    );
    return startPromise;
  }

  private async initialize(generation: number): Promise<void> {
    await this.initializeStorageAndLogging(generation);
    this.validator = new Validator();
    await this.initializeVectorIndex(generation);
    await this.initializeModelServices(generation);
    await this.initializeDuplicateState(generation);
    await this.initializeTaskServices();
    this.assertActive(generation);

    this.unsubscribeSettings = this.settingsStore.subscribe((settings) => {
      this.applySettings(settings);
    });
    this.applySettings(this.settingsStore.getSettings());
    await this.reconcileVectorConfigBeforeReady(generation);
    this.initialized = true;
    this.logger.info("PluginRuntime", "插件运行时已就绪");
  }

  private async initializeStorageAndLogging(generation: number): Promise<void> {
    this.assertActive(generation);
    this.fileStorage = new FileStorage(this.app.vault, this.pluginDir);
    this.requireSuccess(await this.fileStorage.initialize(), "初始化插件数据目录失败");
    this.assertActive(generation);

    this.requireSuccess(await recoverInterruptedReset(this.fileStorage), "恢复未完成重置失败");
    this.assertActive(generation);
    const recovery = await this.fileStorage.recoverIncompleteWrites();
    const recoveredFiles = this.requireSuccess(recovery, "恢复未完成文件写入失败");
    this.assertActive(generation);

    this.logger = new Logger("data/app.log", {
      write: async (path, content) => this.unwrapWrite(path, content),
      read: async (path) => this.unwrapRead(path),
      exists: async (path) => this.fileStorage.exists(path),
    }, this.settingsStore.getSettings().logLevel);
    await this.logger.initialize();
    this.settingsStore.setLogger?.(this.logger);
    this.i18n.setLogger(this.logger);

    if (recoveredFiles > 0) {
      this.logger.info("PluginRuntime", "已恢复未完成文件写入", { count: recoveredFiles });
    }
    this.assertActive(generation);
  }

  private async initializeVectorIndex(generation: number): Promise<void> {
    this.cruidCache = new CruidCache(this.app, this.logger);
    this.cruidCache.start();
    // The workbench resolves CRUIDs synchronously while rendering its first
    // snapshot. Do not publish a ready runtime until the initial mapping is
    // complete, otherwise the UI can permanently capture UUID fallbacks.
    await this.cruidCache.waitUntilReady();
    this.assertActive(generation);

    const vectorConfig = resolveVectorIndexConfig(this.settingsStore.getSettings());
    this.vectorIndex = new VectorIndex(
      this.fileStorage,
      vectorConfig.model,
      vectorConfig.dimension,
      this.logger,
      this.cruidCache,
      vectorConfig.profile,
    );
    this.requireSuccess(await this.vectorIndex.load(), "加载向量索引失败");
    this.appliedVectorConfig = vectorConfig;
    this.assertActive(generation);
  }

  private async initializeModelServices(generation: number): Promise<void> {
    this.providerManager = new ProviderManager(this.settingsStore, this.logger, undefined, undefined, this.externalCallLedger);
    this.promptManager = new PromptManager(this.fileStorage, this.logger, "prompts");
    this.requireSuccess(await this.promptManager.preloadAllBaseComponents(), "加载基础提示词失败");
    this.requireSuccess(await this.promptManager.preloadAllTemplates(), "加载任务提示词失败");
    this.assertActive(generation);
  }

  private async initializeDuplicateState(generation: number): Promise<void> {
    this.duplicateManager = new DuplicateManager(
      this.vectorIndex,
      this.fileStorage,
      this.logger,
      this.settingsStore,
      "data/duplicate-pairs.json",
    );
    this.requireSuccess(await this.duplicateManager.initialize(), "加载重复项状态失败");
    if (this.vectorIndex.getEntryCount() === 0) {
      this.requireSuccess(await this.duplicateManager.clearAll(), "清理失效重复项失败");
    }
    this.assertActive(generation);
    this.unsubscribeDelete = this.cruidCache.onDelete(({ cruid, path }) => {
      this.deleteCleanupChain = this.deleteCleanupChain
        .then(() => this.removeDeletedNoteState(cruid, path, true))
        .catch((error: unknown) => {
          if (this.logger && !this.disposed) {
            this.logger.warn("PluginRuntime", "删除笔记后的状态清理异常", {
              cruid,
              path,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
    });
  }

  private async initializeTaskServices(): Promise<void> {
    this.workflowStore = new WorkflowStore(this.fileStorage, this.logger);
    this.requireSuccess(await this.workflowStore.initialize(), "加载工作流恢复数据失败");

    const noteRepository = new NoteRepository(this.app, this.logger);
    this.duplicateMergeService = new DuplicateMergeService({
      app: this.app,
      fileStorage: this.fileStorage,
      noteRepository,
      cruidCache: this.cruidCache,
      duplicateManager: this.duplicateManager,
      providerManager: this.providerManager,
      promptManager: this.promptManager,
      settingsStore: this.settingsStore,
      reindex: (path) => this.rebuildSemanticNote(path),
      logger: this.logger,
    });
    this.requireSuccess(await this.duplicateMergeService.initialize(), "加载合并操作状态失败");
    this.taskQueue = new TaskQueue(this.logger, this.settingsStore, {
      fileStorage: this.fileStorage,
    });
    this.workflowCoordinator = new WorkflowCoordinator({
      workflowStore: this.workflowStore,
      taskQueue: this.taskQueue,
      noteRepository,
      contentRenderer: new ContentRenderer(),
      settingsStore: this.settingsStore,
      logger: this.logger,
      indexNote: (cruid) => this.semanticIndexRebuilder.embedOne(cruid),
      onIndexingFailed: (noteTitle) => {
        if (!this.disposed) showWarning(this.i18n.format("workbench.notifications.indexingFailed", { noteTitle }));
      },
    });
    this.cardGeneration = new CardGenerationService({ storage: this.fileStorage, settings: this.settingsStore, notes: noteRepository, queue: this.taskQueue });
    this.requireSuccess(this.taskQueue.attachWorkflowPort(this.cardGeneration.wrapPort(this.workflowCoordinator.queuePort)), "连接任务队列工作流端口失败");
    this.requireSuccess(await this.taskQueue.initialize(), "加载任务队列失败");

    this.taskRunner = new TaskRunner({
      providerManager: this.providerManager,
      promptManager: this.promptManager,
      validator: this.validator,
      logger: this.logger,
      schemaRegistry,
      settingsStore: this.settingsStore,
    });
    this.semanticIndexRebuilder = new SemanticIndexRebuilder({
      app: this.app,
      cruidCache: this.cruidCache,
      providerManager: this.providerManager,
      vectorIndex: this.vectorIndex,
      duplicateManager: this.duplicateManager,
      settingsStore: this.settingsStore,
      logger: this.logger,
    });
    this.createOrchestrator = new CreateOrchestrator({
      promptManager: this.promptManager,
      schemaRegistry,
      settingsStore: this.settingsStore,
      logger: this.logger,
      providerManager: this.providerManager,
      validator: this.validator,
      workflowCoordinator: this.workflowCoordinator,
    });
    this.verifyOrchestrator = new VerifyOrchestrator({
      settingsStore: this.settingsStore,
      logger: this.logger,
      promptManager: this.promptManager,
      workflowCoordinator: this.workflowCoordinator,
    });
    this.expandOrchestrator = new ExpandOrchestrator({
      settingsStore: this.settingsStore,
      logger: this.logger,
      app: this.app,
      vectorIndex: this.vectorIndex,
    }, {
      createOrchestrator: this.createOrchestrator,
      fileStorage: this.fileStorage,
    });
    this.requireSuccess(await this.workflowCoordinator.initializeAndRecover(), "恢复工作流失败");
    // Do not start restored tasks until artifact recovery has reconciled any
    // missing next-stage records. This keeps startup deterministic and avoids
    // a provider call racing the recovery pass.
    this.taskQueue.setTaskRunner(this.taskRunner);
    this.workbenchApplication = new WorkbenchApplication({
      generateCards: (path) => this.cardGeneration.start(path),
      taskQueue: this.taskQueue,
      createOrchestrator: this.createOrchestrator,
      verifyOrchestrator: this.verifyOrchestrator,
      expandOrchestrator: this.expandOrchestrator,
      duplicateManager: this.duplicateManager,
      getConceptName: (cruid) => this.getConceptName(cruid),
      getConceptPath: (cruid) => this.cruidCache.getFile(cruid)?.path ?? null,
      rebuildSemanticNote: (filePath) => this.rebuildSemanticNote(filePath),
      workflowCoordinator: this.workflowCoordinator,
      duplicateMergeService: this.duplicateMergeService,
    });
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    void this.cardGeneration?.dispose();
    this.lifecycleGeneration++;
    if (this.disposePromise) {
      return this.disposePromise;
    }

    const start = this.startPromise;
    this.disposePromise = (async () => {
      if (start) {
        try {
          await start;
        } catch {
          // start() already cleaned resources after a failed initialization.
        }
      }
      await this.cleanupResources();
    })();
    return this.disposePromise;
  }

  private applySettings(settings: PluginSettings): void {
    if (this.disposed) {
      return;
    }
    this.logger.setLevel(settings.logLevel);
    this.requestedVectorConfig = resolveVectorIndexConfig(settings);
    if (!this.isReady) return;
    this.scheduleVectorReconfigure();
  }

  private async removeDeletedNoteState(
    cruid: string,
    path: string,
    acceptedBeforeDispose = false,
  ): Promise<void> {
    if (!acceptedBeforeDispose && !this.isReady) {
      return;
    }
    const generation = this.lifecycleGeneration;
    const indexResult = await this.vectorIndex.delete(cruid);
    if (!acceptedBeforeDispose && (generation !== this.lifecycleGeneration || !this.isReady)) {
      return;
    }
    if (!indexResult.ok && indexResult.error.code !== "E311_NOT_FOUND") {
      this.logger.warn("PluginRuntime", "删除笔记后清理向量索引失败", {
        cruid,
        path,
        error: indexResult.error,
      });
    }

    const duplicatesResult = await this.duplicateManager.removePairsByNodeId(cruid);
    if (!duplicatesResult.ok) {
      this.logger.warn("PluginRuntime", "删除笔记后清理重复项失败", {
        cruid,
        path,
        error: duplicatesResult.error,
      });
    }
  }

  private scheduleVectorReconfigure(): void {
    const next = this.requestedVectorConfig;
    if (!next) return;
    // Always enqueue a reconciliation: an in-flight B may still replace A,
    // even when a newer request has already changed the desired config to A.
    // The queued equality check coalesces unrelated/repeated saves safely.
    this.vectorReconfigure = this.vectorReconfigure
      .then(async () => {
        if (!this.isReady) {
          return;
        }
        // 多次设置保存可能在同一轮事件循环内到达，只应用最终的 embedding 配置。
        const latest = this.requestedVectorConfig ?? resolveVectorIndexConfig(this.settingsStore.getSettings());
        if (vectorIndexConfigsEqual(this.appliedVectorConfig, latest)) {
          return;
        }
        const result = await this.vectorIndex.reconfigure(
          latest.model,
          latest.dimension,
          latest.profile,
        );
        if (!result.ok) {
          this.logger.warn("PluginRuntime", "更新向量索引配置失败", { error: result.error });
          return;
        }
        const duplicateReset = await this.duplicateManager.clearAll();
        if (!duplicateReset.ok) {
          this.logger.warn("PluginRuntime", "向量配置已更新，但清理旧重复项失败", {
            error: duplicateReset.error,
          });
        }
        this.appliedVectorConfig = latest;
      })
      .catch((error: unknown) => {
        if (this.logger && this.isReady) {
          this.logger.error("PluginRuntime", "更新向量索引配置异常", error as Error);
        }
      });
  }

  private async reconcileVectorConfigBeforeReady(generation: number): Promise<void> {
    while (true) {
      this.assertActive(generation);
      const latest = this.requestedVectorConfig ?? resolveVectorIndexConfig(this.settingsStore.getSettings());
      if (vectorIndexConfigsEqual(this.appliedVectorConfig, latest)) {
        return;
      }

      const result = await this.vectorIndex.reconfigure(
        latest.model,
        latest.dimension,
        latest.profile,
      );
      this.requireSuccess(result, "同步最新向量索引配置失败");
      this.requireSuccess(await this.duplicateManager.clearAll(), "清理旧重复项失败");
      this.appliedVectorConfig = latest;
    }
  }

  private assertActive(generation: number): void {
    if (this.disposed || generation !== this.lifecycleGeneration) {
      throw new Error("插件运行时正在释放");
    }
  }

  private cleanupResources(): Promise<void> {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }
    this.cleanupPromise = this.releaseResources();
    return this.cleanupPromise;
  }

  private async releaseResources(): Promise<void> {
    await this.releaseSafely("CardGenerationService", () => this.cardGeneration?.dispose());
    // Merge commits also own vault writes and must settle before reset can
    // clear their journal or the index/cache dependencies are released.
    await this.releaseSafely("DuplicateMergeService", () => this.duplicateMergeService?.dispose());
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = undefined;
    this.unsubscribeDelete?.();
    this.unsubscribeDelete = undefined;

    // 删除事件可能已经进入异步清理链；先等它完成，再释放 Duplicate/Vector 服务。
    await this.releaseSafely("删除笔记后的状态清理", () => this.deleteCleanupChain);

    await Promise.all([
      this.releaseSafely("SemanticIndexRebuilder", () => this.semanticIndexRebuilder?.dispose()),
      this.releaseSafely("CreateOrchestrator", () => this.createOrchestrator?.dispose()),
      this.releaseSafely("VerifyOrchestrator", () => this.verifyOrchestrator?.dispose()),
      this.releaseSafely("ExpandOrchestrator", () => this.expandOrchestrator?.dispose()),
    ]);
    // Entry points wait for in-flight submissions before the durable workflow
    // owner and queue are stopped. This prevents a late enqueue from racing
    // shutdown and leaving an artifact without its scheduling record.
    await this.releaseSafely("WorkflowCoordinator", () => this.workflowCoordinator?.dispose());
    await this.releaseSafely("TaskQueue", () => this.taskQueue?.dispose());
    await Promise.all([
      this.releaseSafely("DuplicateManager", () => this.duplicateManager?.dispose()),
      this.releaseSafely("CruidCache", () => this.cruidCache?.dispose()),
    ]);
    await this.releaseSafely("向量配置变更", () => this.vectorReconfigure);
    await this.releaseSafely("VectorIndex", () => this.vectorIndex?.dispose());
    this.appliedVectorConfig = undefined;
    this.requestedVectorConfig = undefined;
    await this.releaseSafely("ProviderManager", () => this.providerManager?.dispose());

    if (this.logger) {
      try {
        this.logger.info("PluginRuntime", "插件运行时已释放");
        await this.logger.flush();
      } catch (error) {
        reportHostDiagnostic("PluginRuntime", "日志收尾失败", error, !this.logger.isSilent);
      }
    }
    this.i18n.setLogger(null);
    this.workbenchApplication = undefined;
    this.initialized = false;
  }

  private async releaseSafely(name: string, release: () => void | Promise<void>): Promise<void> {
    try {
      await release();
    } catch (error) {
      this.logger?.error("PluginRuntime", `释放 ${name} 失败`, error as Error);
    }
  }

  private async unwrapWrite(path: string, content: string): Promise<void> {
    const result = await this.fileStorage.write(path, content);
    if (!result.ok) {
      throw new Error(`写入日志文件失败: ${result.error.message}`);
    }
  }

  private async unwrapRead(path: string): Promise<string> {
    const result = await this.fileStorage.read(path);
    if (!result.ok) {
      if (result.error.code === "E301_FILE_NOT_FOUND") {
        return "";
      }
      throw new Error(`读取日志文件失败: ${result.error.message}`);
    }
    return result.value;
  }

  private requireSuccess<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, message: string): T {
    if (!result.ok) {
      throw new Error(`${message}: ${result.error.message}`);
    }
    return result.value;
  }
}
