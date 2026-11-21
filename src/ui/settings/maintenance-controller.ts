import type { SettingsApplication } from "../../app/settings-application";
import type { I18n } from "../../core/i18n";
import type { SemanticIndexStatus } from "../../core/semantic-index-rebuilder";
import type { VectorIndexMaintenanceReport } from "../../core/vector-index";

export interface MaintenanceFeedback {
  level: "success" | "error";
  message: string;
}

export interface MaintenanceState {
  indexStatus: SemanticIndexStatus | null;
  indexScanRunning: boolean;
  missingEmbedRunning: boolean;
  missingEmbedFeedback: MaintenanceFeedback | null;
  vectorReport: VectorIndexMaintenanceReport | null;
  vectorScanRunning: boolean;
  vectorCleanupRunning: boolean;
  vectorCleanupFeedback: MaintenanceFeedback | null;
  duplicateRebuildRunning: boolean;
  duplicateRebuildFeedback: MaintenanceFeedback | null;
  importError: string | undefined;
}

const INITIAL_STATE: MaintenanceState = {
  indexStatus: null,
  indexScanRunning: false,
  missingEmbedRunning: false,
  missingEmbedFeedback: null,
  vectorReport: null,
  vectorScanRunning: false,
  vectorCleanupRunning: false,
  vectorCleanupFeedback: null,
  duplicateRebuildRunning: false,
  duplicateRebuildFeedback: null,
  importError: undefined,
};

/**
 * 维护与备份页的操作状态。原生设置行各自渲染按钮，但「同一时间只跑一项维护」
 * 与各项结果必须共享，所以状态集中在这里，按钮与结果区都订阅它。
 */
export class MaintenanceController {
  private state: MaintenanceState = { ...INITIAL_STATE };
  private readonly listeners = new Set<(state: MaintenanceState) => void>();

  constructor(private readonly settingsApplication: SettingsApplication, private readonly i18n: I18n) {}

  getState(): MaintenanceState {
    return this.state;
  }

  subscribe(listener: (state: MaintenanceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 任一维护、重建或设置保存进行中时，其余维护按钮都不可用。 */
  isRunning(): boolean {
    const state = this.state;
    return this.settingsApplication.getSemanticIndexRebuildState().status === "running"
      || state.duplicateRebuildRunning || state.indexScanRunning || state.missingEmbedRunning
      || state.vectorScanRunning || state.vectorCleanupRunning
      || this.settingsApplication.getSaveState().status === "saving";
  }

  private set(partial: Partial<MaintenanceState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }

  async scanSemanticIndex(force = false): Promise<void> {
    if (this.state.indexScanRunning || (!force && this.isRunning())) return;
    this.set({ indexScanRunning: true });
    try {
      const result = await this.settingsApplication.scanSemanticIndex();
      if (result.ok) this.set({ indexStatus: result.value });
      else this.set({ missingEmbedFeedback: { level: "error", message: result.error.message } });
    } finally { this.set({ indexScanRunning: false }); }
  }

  async embedMissing(): Promise<void> {
    if (this.state.missingEmbedRunning || this.isRunning()) return;
    this.set({ missingEmbedRunning: true, missingEmbedFeedback: null });
    try {
      const result = await this.settingsApplication.embedMissingSemanticIndex();
      this.set({
        missingEmbedFeedback: result.ok
          ? { level: result.value.failed > 0 ? "error" : "success", message: this.i18n.format("settings.advanced.semanticIndexing.missingComplete", { indexed: result.value.indexed, skipped: result.value.skipped, failed: result.value.failed }) }
          : { level: "error", message: result.error.message },
      });
      // 补齐结果已带回剩余缺失列表；只有失败时才需要重新扫描。
      if (result.ok) this.set({ indexStatus: result.value.status });
      else await this.scanSemanticIndex(true);
    } finally { this.set({ missingEmbedRunning: false }); }
  }

  async embedOne(cruid: string): Promise<void> {
    if (this.state.missingEmbedRunning || this.isRunning()) return;
    this.set({ missingEmbedRunning: true });
    const result = await this.settingsApplication.embedOneSemanticIndex(cruid);
    this.set({
      missingEmbedRunning: false,
      missingEmbedFeedback: result.ok
        ? { level: result.value.failed > 0 ? "error" : "success", message: this.i18n.t("settings.advanced.semanticIndexing.embedOneComplete") }
        : { level: "error", message: result.error.message },
    });
    // 单篇成功只影响列表中的这一项，本地移除即可，不必全库重扫。
    const status = this.state.indexStatus;
    if (result.ok && result.value.indexed > 0 && status) {
      const missingNotes = status.missingNotes.filter((note) => note.cruid !== cruid);
      this.set({ indexStatus: { ...status, indexed: status.eligible - missingNotes.length, missing: missingNotes.length, missingNotes } });
    } else {
      await this.scanSemanticIndex(true);
    }
  }

  async rebuildSpecifiedNote(path: string): Promise<void> {
    if (this.isRunning() || !path.trim()) return;
    this.set({ missingEmbedRunning: true });
    try {
      const result = await this.settingsApplication.rebuildSpecifiedNote(path);
      this.set({
        missingEmbedFeedback: result.ok
          ? { level: result.value.failed ? "error" : "success", message: this.i18n.format("cards.rebuildComplete", result.value) }
          : { level: "error", message: result.error.message },
      });
    } finally { this.set({ missingEmbedRunning: false }); }
  }

  async scanVectorFiles(force = false): Promise<void> {
    if (this.state.vectorScanRunning || (!force && this.isRunning())) return;
    this.set({ vectorScanRunning: true, vectorReport: null, vectorCleanupFeedback: null });
    try {
      const result = await this.settingsApplication.inspectVectorFiles();
      if (result.ok) this.set({ vectorReport: result.value });
      else this.set({ vectorCleanupFeedback: { level: "error", message: result.error.message } });
    } finally { this.set({ vectorScanRunning: false }); }
  }

  async cleanupVectorFiles(): Promise<void> {
    const report = this.state.vectorReport;
    if (!report || this.state.vectorCleanupRunning || this.isRunning()) return;
    this.set({ vectorCleanupRunning: true, vectorCleanupFeedback: null });
    try {
      const result = await this.settingsApplication.cleanupOrphanedVectorFiles(report.orphanFiles);
      this.set({
        vectorCleanupFeedback: result.ok
          ? { level: result.value.failed > 0 ? "error" : "success", message: this.i18n.format("settings.advanced.semanticIndexing.cleanupVectorFilesComplete", { ...result.value }) }
          : { level: "error", message: result.error.message },
      });
      await this.scanVectorFiles(true);
    } finally { this.set({ vectorCleanupRunning: false }); }
  }

  async rebuildDuplicatePairs(): Promise<void> {
    if (this.isRunning()) return;
    this.set({ duplicateRebuildRunning: true, duplicateRebuildFeedback: null });
    try {
      const result = await this.settingsApplication.rebuildDuplicatePairs();
      this.set({
        duplicateRebuildFeedback: result.ok
          ? { level: "success", message: this.i18n.format("settings.advanced.semanticIndexing.rebuildDuplicatesComplete", { count: result.value }) }
          : { level: "error", message: this.i18n.t("settings.advanced.semanticIndexing.rebuildDuplicatesFailed") },
      });
    } catch {
      this.set({ duplicateRebuildFeedback: { level: "error", message: this.i18n.t("settings.advanced.semanticIndexing.rebuildDuplicatesFailed") } });
    } finally {
      this.set({ duplicateRebuildRunning: false });
    }
  }

  async importSettings(json: string): Promise<void> {
    this.set({ importError: undefined });
    try {
      // importSettings 用 Result 报告拒绝；忽略返回值会把失败当成成功。
      const result = await this.settingsApplication.importSettings(json);
      if (!result.ok) this.set({ importError: this.i18n.t("settings.importExport.importFailed") });
    } catch {
      this.set({ importError: this.i18n.t("settings.importExport.importFailed") });
    }
  }

  clearImportError(): void {
    if (this.state.importError !== undefined) this.set({ importError: undefined });
  }

  /** 离开维护页时取消可取消的重建，与原设置页卸载时的行为一致。 */
  dispose(): void {
    this.settingsApplication.cancelSemanticIndexRebuild();
    this.listeners.clear();
  }
}
