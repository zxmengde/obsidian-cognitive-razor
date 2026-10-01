import { err, toErr } from "../types";
import type {
  ProviderCapabilities,
  ProviderConfig,
  PluginSettings,
  Result,
  TaskModelConfig,
  TaskType,
  ILogger,
} from "../types";
import type { SettingsStore, SettingsUpdate } from "../data/settings-store";
import type {
  ProviderProbeGateway,
  ProviderProbeRequest,
} from "../core/model-gateway";
import type {
  SemanticIndexRebuildProgress,
  SemanticIndexRebuildSummary,
  SemanticIndexStatus,
} from "../core/semantic-index-rebuilder";
import type {
  VectorCleanupSummary,
  VectorIndexMaintenanceReport,
} from "../core/vector-index";
import type { VectorFileRef } from "../types";

export interface SemanticIndexPort {
  rebuildSemanticIndex(
    onProgress?: (progress: SemanticIndexRebuildProgress) => void,
  ): Promise<Result<SemanticIndexRebuildSummary>>;
  rebuildDuplicatePairs(): Promise<Result<number>>;
  cancelSemanticIndexRebuild(): void;
  scanSemanticIndex(): Promise<Result<SemanticIndexStatus>>;
  embedMissingSemanticIndex(): Promise<Result<{ eligible: number; indexed: number; skipped: number; failed: number }>>;
  embedOneSemanticIndex(cruid: string): Promise<Result<{ indexed: number; failed: number }>>;
  inspectVectorFiles(): Promise<Result<VectorIndexMaintenanceReport>>;
  cleanupOrphanedVectorFiles(expected: VectorFileRef[]): Promise<Result<VectorCleanupSummary>>;
}

export interface SettingsApplicationDeps {
  settingsStore: SettingsStore;
  providerProbe: ProviderProbeGateway;
  ensureSemanticIndex: () => Promise<SemanticIndexPort>;
  rebuildSemanticNote?: (path: string) => Promise<Result<{ indexed: number; failed: number }>>;
  logger?: ILogger;
  /** Optional host hook that backs up and clears plugin runtime data. */
  resetRuntimeData?: () => Promise<Result<void>>;
}

export type SettingsSaveStatus = "idle" | "saving" | "saved" | "save-failed";

export interface SettingsSaveState {
  status: SettingsSaveStatus;
  operationId: number;
  error?: { code: string; message: string };
}

export type SemanticIndexRebuildStatus =
  | "idle"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface SemanticIndexRebuildState {
  status: SemanticIndexRebuildStatus;
  operationId: number;
  cancelRequested: boolean;
  progress?: SemanticIndexRebuildProgress;
  summary?: SemanticIndexRebuildSummary;
  error?: { code: string; message: string };
}

/** Application boundary for settings-adjacent operational actions. */
export class SettingsApplication {
  private activeSemanticIndex: SemanticIndexPort | undefined;
  private duplicatePairsRebuild: Promise<Result<number>> | undefined;
  private cancelRequested = false;
  private operationSequence = 0;
  private saveState: SettingsSaveState = { status: "idle", operationId: 0 };
  private rebuildState: SemanticIndexRebuildState = {
    status: "idle",
    operationId: 0,
    cancelRequested: false,
  };
  private rebuildOperationSequence = 0;
  private readonly saveListeners = new Set<(state: SettingsSaveState) => void>();
  private readonly settingsListeners = new Set<(settings: PluginSettings) => void>();
  private readonly rebuildListeners = new Set<(state: SemanticIndexRebuildState) => void>();
  private logger?: ILogger;
  private pendingListenerErrors: Error[] = [];
  private pendingSettingsListenerErrors: Error[] = [];
  private pendingRebuildListenerErrors: Error[] = [];
  private unsubscribeSettings: (() => void) | undefined;
  private disposed = false;
  private lastFailedMutation: {
    operationId: number;
    operation: () => Promise<Result<void>>;
  } | undefined;

  constructor(private readonly deps: SettingsApplicationDeps) {
    this.logger = deps.logger;
    this.unsubscribeSettings = deps.settingsStore.subscribe(() => this.publishSettings());
  }

  async rebuildSpecifiedNote(path: string): Promise<Result<{ indexed: number; failed: number }>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    try {
      return await (this.deps.rebuildSemanticNote?.(path.trim()) ?? err("E310_INVALID_STATE", "索引服务尚未就绪"));
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "重建指定笔记向量失败");
    }
  }

  getSettings(): PluginSettings {
    return this.deps.settingsStore.getSettings();
  }

  subscribeSettings(listener: (settings: PluginSettings) => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }

  isTaskModelDefault(taskType: TaskType): boolean {
    return this.deps.settingsStore.isTaskModelDefault(taskType);
  }

  exportSettings(): string {
    return this.deps.settingsStore.exportSettings();
  }

  getSaveState(): SettingsSaveState {
    return { ...this.saveState, error: this.saveState.error ? { ...this.saveState.error } : undefined };
  }

  subscribeSaveState(listener: (state: SettingsSaveState) => void): () => void {
    this.saveListeners.add(listener);
    return () => this.saveListeners.delete(listener);
  }

  getSemanticIndexRebuildState(): SemanticIndexRebuildState {
    return cloneRebuildState(this.rebuildState);
  }

  subscribeSemanticIndexRebuildState(listener: (state: SemanticIndexRebuildState) => void): () => void {
    this.rebuildListeners.add(listener);
    return () => this.rebuildListeners.delete(listener);
  }

  updateSettings(partial: SettingsUpdate): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.updateSettings(partial));
  }

  updateTaskModel(taskType: TaskType, updates: Partial<TaskModelConfig>): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.updateTaskModel(taskType, updates));
  }

  resetTaskModel(taskType: TaskType): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.resetTaskModel(taskType));
  }

  addProvider(id: string, config: ProviderConfig): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.addProvider(id, config));
  }

  updateProvider(id: string, updates: Partial<ProviderConfig>): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.updateProvider(id, updates));
  }

  removeProvider(id: string): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.removeProvider(id));
  }

  importSettings(json: string): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.importSettings(json));
  }

  resetToDefaults(): Promise<Result<void>> {
    return this.runMutation(() => this.deps.settingsStore.resetToDefaults());
  }

  async resetAndStart(): Promise<Result<void>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    // Runtime-data clearing and the settings reset are one user-visible
    // mutation: a failed backup/clear must reach the save-state read model, or
    // the dialog silently reports nothing.
    return this.runMutation(async () => {
      if (this.deps.resetRuntimeData) {
        const cleared = await this.deps.resetRuntimeData();
        if (!cleared.ok) return cleared;
      }
      return this.deps.settingsStore.resetToDefaults();
    });
  }

  retryLastSave(): Promise<Result<void>> {
    const failed = this.lastFailedMutation;
    if (!failed || this.saveState.status !== "save-failed" || failed.operationId !== this.saveState.operationId) {
      return Promise.resolve(err("E310_INVALID_STATE", "没有可重试的设置保存"));
    }
    return this.runMutation(failed.operation);
  }

  rebuildDuplicatePairs(): Promise<Result<number>> {
    if (this.disposed) return Promise.resolve(err("E310_INVALID_STATE", "设置应用已释放"));
    if (this.saveState.status === "saving") {
      return Promise.resolve(err("E320_TASK_CONFLICT", "设置正在保存"));
    }
    if (this.rebuildState.status === "running") {
      return Promise.resolve(err("E320_TASK_CONFLICT", "语义索引正在重建"));
    }
    if (this.duplicatePairsRebuild) {
      return Promise.resolve(err("E320_TASK_CONFLICT", "重复项正在重算"));
    }
    const settings = this.deps.settingsStore.getSettings();
    if (!settings.enableSemanticIndexing || !settings.enableDuplicateDetection) {
      return Promise.resolve(err("E310_INVALID_STATE", "请先启用语义索引和重复概念检测"));
    }

    const operation = this.rebuildDuplicatePairsInternal();
    this.duplicatePairsRebuild = operation;
    void operation.then(
      () => {
        if (this.duplicatePairsRebuild === operation) this.duplicatePairsRebuild = undefined;
      },
      () => {
        if (this.duplicatePairsRebuild === operation) this.duplicatePairsRebuild = undefined;
      },
    );
    return operation;
  }

  private async rebuildDuplicatePairsInternal(): Promise<Result<number>> {
    try {
      const semanticIndex = await this.deps.ensureSemanticIndex();
      if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
      return await semanticIndex.rebuildDuplicatePairs();
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "重算重复项失败");
    }
  }

  async testProvider(
    request: ProviderProbeRequest,
    signal?: AbortSignal,
  ): Promise<Result<ProviderCapabilities>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    try {
      return await this.deps.providerProbe.probe(request, signal);
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "Provider 测试失败");
    }
  }

  async rebuildSemanticIndex(): Promise<Result<SemanticIndexRebuildSummary>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    if (this.saveState.status === "saving") {
      return err("E320_TASK_CONFLICT", "设置正在保存");
    }
    if (this.duplicatePairsRebuild) {
      return err("E320_TASK_CONFLICT", "重复项正在重算");
    }
    if (this.rebuildState.status === "running") {
      return err("E320_TASK_CONFLICT", "语义索引正在重建");
    }
    const operationId = ++this.rebuildOperationSequence;
    this.cancelRequested = false;
    this.setRebuildState({
      status: "running",
      operationId,
      cancelRequested: false,
      progress: undefined,
      summary: undefined,
      error: undefined,
    });
    let result: Result<SemanticIndexRebuildSummary>;
    try {
      const semanticIndex = await this.deps.ensureSemanticIndex();
      if (this.disposed) {
        semanticIndex.cancelSemanticIndexRebuild();
        return err("E310_INVALID_STATE", "设置应用已释放");
      }
      this.activeSemanticIndex = semanticIndex;
      if (this.cancelRequested) {
        result = err("E310_INVALID_STATE", "语义索引重建已取消，旧索引保持不变");
      } else {
        result = await semanticIndex.rebuildSemanticIndex((progress) => {
          if (!this.disposed && operationId === this.rebuildOperationSequence) {
            this.setRebuildState({
              ...this.rebuildState,
              progress: { ...progress },
            });
          }
        });
      }
    } catch (error) {
      result = toErr(error, "E500_INTERNAL_ERROR", "重建语义索引失败");
    } finally {
      this.activeSemanticIndex = undefined;
    }
    if (!this.disposed && operationId === this.rebuildOperationSequence) {
      if (result.ok) {
        this.setRebuildState({
          ...this.rebuildState,
          status: result.value.duplicateRefreshFailed || result.value.skipped > 0 ? "partial" : "completed",
          cancelRequested: false,
          summary: { ...result.value },
          error: undefined,
        });
      } else if (this.cancelRequested && result.error.code === "E310_INVALID_STATE") {
        this.setRebuildState({
          ...this.rebuildState,
          status: "cancelled",
          cancelRequested: false,
          error: undefined,
        });
      } else {
        this.setRebuildState({
          ...this.rebuildState,
          status: "failed",
          cancelRequested: false,
          error: { code: result.error.code, message: result.error.message },
        });
      }
    }
    return result;
  }

  async scanSemanticIndex(): Promise<Result<SemanticIndexStatus>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    try {
      return await (await this.deps.ensureSemanticIndex()).scanSemanticIndex();
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "扫描缺失向量失败");
    }
  }

  async embedMissingSemanticIndex(): Promise<Result<{ eligible: number; indexed: number; skipped: number; failed: number }>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    if (this.saveState.status === "saving" || this.rebuildState.status === "running" || this.duplicatePairsRebuild) {
      return err("E320_TASK_CONFLICT", "当前已有语义索引维护操作正在进行");
    }
    try {
      return await (await this.deps.ensureSemanticIndex()).embedMissingSemanticIndex();
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "生成缺失向量失败");
    }
  }

  async embedOneSemanticIndex(cruid: string): Promise<Result<{ indexed: number; failed: number }>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    if (this.saveState.status === "saving" || this.rebuildState.status === "running" || this.duplicatePairsRebuild) {
      return err("E320_TASK_CONFLICT", "当前已有语义索引维护操作正在进行");
    }
    try { return await (await this.deps.ensureSemanticIndex()).embedOneSemanticIndex(cruid); }
    catch (error) { return toErr(error, "E500_INTERNAL_ERROR", "生成单篇向量失败"); }
  }

  async inspectVectorFiles(): Promise<Result<VectorIndexMaintenanceReport>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    try {
      return await (await this.deps.ensureSemanticIndex()).inspectVectorFiles();
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "盘点向量文件失败");
    }
  }

  async cleanupOrphanedVectorFiles(expected: VectorFileRef[]): Promise<Result<VectorCleanupSummary>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    if (this.saveState.status === "saving" || this.rebuildState.status === "running" || this.duplicatePairsRebuild) {
      return err("E320_TASK_CONFLICT", "当前已有语义索引维护操作正在进行");
    }
    try {
      return await (await this.deps.ensureSemanticIndex()).cleanupOrphanedVectorFiles(expected);
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "清理多余向量文件失败");
    }
  }

  cancelSemanticIndexRebuild(): void {
    this.cancelRequested = true;
    if (this.rebuildState.status === "running") {
      this.setRebuildState({ ...this.rebuildState, cancelRequested: true });
    }
    this.activeSemanticIndex?.cancelSemanticIndexRebuild();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelRequested = true;
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = undefined;
    this.settingsListeners.clear();
    this.saveListeners.clear();
    this.rebuildListeners.clear();
    this.activeSemanticIndex?.cancelSemanticIndexRebuild();
    this.activeSemanticIndex = undefined;
  }

  setLogger(logger: ILogger): void {
    this.logger = logger;
    const pending = this.pendingListenerErrors.splice(0);
    for (const error of pending) {
      this.logListenerError(error);
    }
    const pendingSettings = this.pendingSettingsListenerErrors.splice(0);
    for (const error of pendingSettings) {
      this.logSettingsListenerError(error);
    }
    const pendingRebuild = this.pendingRebuildListenerErrors.splice(0);
    for (const error of pendingRebuild) {
      this.logRebuildListenerError(error);
    }
  }

  private async runMutation(operation: () => Promise<Result<void>>): Promise<Result<void>> {
    if (this.disposed) return err("E310_INVALID_STATE", "设置应用已释放");
    const operationId = ++this.operationSequence;
    this.lastFailedMutation = undefined;
    this.setSaveState({ status: "saving", operationId });
    let result: Result<void>;
    try {
      result = await operation();
    } catch (error) {
      result = toErr(error, "E500_INTERNAL_ERROR", "设置保存失败");
    }
    if (operationId === this.operationSequence) {
      if (result.ok) {
        this.lastFailedMutation = undefined;
        this.setSaveState({ status: "saved", operationId });
      } else {
        this.lastFailedMutation = { operationId, operation };
        this.setSaveState({
          status: "save-failed",
          operationId,
          error: { code: result.error.code, message: result.error.message },
        });
      }
    }
    return result;
  }

  private setSaveState(state: SettingsSaveState): void {
    this.saveState = state;
    const snapshot = this.getSaveState();
    for (const listener of this.saveListeners) {
      try {
        listener(snapshot);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (this.logger) {
          this.logListenerError(error);
        } else {
          this.pendingListenerErrors.push(error);
        }
      }
    }
  }

  private logListenerError(error: Error): void {
    try {
      this.logger?.error("SettingsApplication", "保存状态监听器执行失败", error);
    } catch {
      // Diagnostics must never change the result of the settings mutation.
    }
  }

  private publishSettings(): void {
    const snapshot = this.deps.settingsStore.getSettings();
    for (const listener of this.settingsListeners) {
      try {
        listener(snapshot);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (this.logger) {
          this.logSettingsListenerError(error);
        } else {
          this.pendingSettingsListenerErrors.push(error);
        }
      }
    }
  }

  private logSettingsListenerError(error: Error): void {
    try {
      this.logger?.error("SettingsApplication", "设置读模型监听器执行失败", error);
    } catch {
      // Diagnostics must never change the result of the settings mutation.
    }
  }

  private setRebuildState(state: SemanticIndexRebuildState): void {
    this.rebuildState = cloneRebuildState(state);
    const snapshot = this.getSemanticIndexRebuildState();
    for (const listener of this.rebuildListeners) {
      try {
        listener(snapshot);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (this.logger) {
          this.logRebuildListenerError(error);
        } else {
          this.pendingRebuildListenerErrors.push(error);
        }
      }
    }
  }

  private logRebuildListenerError(error: Error): void {
    try {
      this.logger?.error("SettingsApplication", "索引重建状态监听器执行失败", error);
    } catch {
      // Diagnostics must never change the result of the settings operation.
    }
  }
}

function cloneRebuildState(state: SemanticIndexRebuildState): SemanticIndexRebuildState {
  return {
    ...state,
    progress: state.progress ? { ...state.progress } : undefined,
    summary: state.summary ? { ...state.summary } : undefined,
    error: state.error ? { ...state.error } : undefined,
  };
}
