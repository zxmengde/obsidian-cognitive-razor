/**
 * RecentOpsSection — 历史区组件
 *
 * 负责显示最近操作快照列表，支持撤销、查看 Diff 等操作。
 * 通过 RecentOpsSectionDeps 注入依赖，不直接依赖 Plugin 实例。
 *
 * 需求: 6.1
 */

import { Notice, TFile } from "obsidian";
import type { SnapshotMetadata } from "../../types";
import { safeErrorMessage } from "../../types";
import type { RecentOpsSectionDeps } from "./workbench-section-deps";
import { WorkbenchSection } from "./workbench-section";
import { UndoNotification } from "../undo-notification";
import { ConfirmDialog, SnapshotDiffModal } from "./workbench-modals";

export class RecentOpsSection extends WorkbenchSection<RecentOpsSectionDeps> {
  private container: HTMLElement | null = null;
  private sectionEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;

  /**
   * 挂载到可折叠区域（由 WorkbenchPanel 的 renderCollapsibleSection 调用）
   */
  mount(options: { content: HTMLElement; badge: HTMLElement; section: HTMLElement }): void {
    this.container = options.content;
    this.badgeEl = options.badge;
    this.sectionEl = options.section;
    void this.refresh();
  }

  render(container: HTMLElement): void {
    // 由 mount() 处理实际渲染（可折叠区域模式）
    this.container = container;
    void this.refresh();
  }

  update(): void {
    void this.refresh();
  }

  dispose(): void {
    this.container = null;
    this.sectionEl = null;
    this.badgeEl = null;
  }

  onClose(): void {
    this.dispose();
  }

  reveal(): void {
    this.sectionEl?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async refresh(): Promise<void> {
    try {
      if (!this.container) return;

      this.container.empty();

      const result = await this.deps.undoManager.listSnapshots();

      if (!result.ok || result.value.length === 0) {
        this.renderEmpty();
        if (this.badgeEl) {
          this.badgeEl.textContent = "0";
          this.badgeEl.style.display = "none";
        }
        return;
      }

      const snapshots = result.value.sort(
        (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
      );

      if (this.badgeEl) {
        this.badgeEl.textContent = snapshots.length.toString();
        this.badgeEl.style.display = "";
      }

      const recentSnapshots = snapshots.slice(0, 10);

      recentSnapshots.forEach(snapshot => {
        const item = this.container!.createDiv({ cls: "cr-recent-op-item" });

        const info = item.createDiv({ cls: "cr-op-info" });

        const description = `${this.getOperationDisplayName(snapshot.taskId)}: ${snapshot.path.split("/").pop()}`;
        info.createEl("div", { text: description, cls: "cr-op-description" });

        info.createEl("div", { text: this.formatTime(snapshot.created), cls: "cr-op-time" });

        const undoBtn = item.createEl("button", {
          text: this.deps.t("workbench.recentOps.undo"),
          cls: "cr-undo-btn cr-btn-small",
          attr: {
            "aria-label": `${this.deps.t("workbench.recentOps.undo")}: ${description}`,
            "data-tooltip-position": "top"
          }
        });
        undoBtn.addEventListener("click", async () => {
          try {
            await this.handleUndoSnapshot(snapshot.id);
          } catch (error) {
            this.deps.logError("撤销操作失败", error, { snapshotId: snapshot.id });
            this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.undoFailed")));
          }
        });

        const viewBtn = item.createEl("button", {
          text: this.deps.t("workbench.recentOps.viewSnapshot"),
          cls: "cr-view-snapshot-btn cr-btn-small",
          attr: {
            "aria-label": `${this.deps.t("workbench.recentOps.viewSnapshot")}: ${description}`,
            "data-tooltip-position": "top"
          }
        });
        viewBtn.addEventListener("click", async () => {
          try {
            await this.handleViewSnapshotDiff(snapshot);
          } catch (error) {
            this.deps.logError("查看快照失败", error, { snapshotId: snapshot.id });
            this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.undoFailed")));
          }
        });
      });

      if (snapshots.length > 10) {
        const moreHint = this.container.createDiv({ cls: "cr-more-hint" });
        const moreCount = snapshots.length - 10;
        moreHint.textContent = this.deps.t("workbench.recentOps.moreSnapshots").replace("{count}", String(moreCount));
      }
    } catch (error) {
      this.deps.logError("刷新历史记录失败", error);
      // 不显示错误通知，避免频繁刷新时打扰用户
    }
  }

  showUndoToast(message: string, snapshotId: string, filePath: string): void {
    const notification = new UndoNotification({
      message,
      snapshotId,
      filePath,
      onUndo: async (id: string) => {
        await this.handleUndoFromToast(id);
      },
      timeout: 5000,
    });

    notification.show();
  }

  async clearAllSnapshots(): Promise<void> {
    const confirmed = await this.showConfirmDialog(
      this.deps.t("workbench.recentOps.clearAllConfirmTitle"),
      this.deps.t("workbench.recentOps.clearAllConfirmMessage")
    );

    if (!confirmed) return;

    const result = await this.deps.undoManager.clearAllSnapshots();

    if (result.ok) {
      new Notice(`${this.deps.t("workbench.notifications.clearComplete")} (${result.value})`);
      await this.refresh();
    } else {
      this.deps.showErrorNotice(`${this.deps.t("common.error")}: ${result.error.message}`);
    }
  }

  private renderEmpty(): void {
    if (!this.container) return;

    this.container.createEl("div", {
      text: this.deps.t("workbench.recentOps.empty"),
      cls: "cr-empty-state"
    });
  }

  private getOperationDisplayName(taskId: string): string {
    const operationNames: Record<string, string> = {
      enrich: this.deps.t("workbench.recentOps.operationLabels.enrich"),
      merge: this.deps.t("workbench.recentOps.operationLabels.merge"),
      amend: this.deps.t("workbench.recentOps.operationLabels.amend"),
      "manual-edit": this.deps.t("workbench.recentOps.operationLabels.manualEdit"),
      standardize: this.deps.t("workbench.recentOps.operationLabels.standardize"),
      create: this.deps.t("workbench.recentOps.operationLabels.create"),
    };

    for (const [key, name] of Object.entries(operationNames)) {
      if (taskId.includes(key)) {
        return name;
      }
    }

    return this.deps.t("workbench.recentOps.operationLabels.fallback");
  }

  private async handleUndoSnapshot(snapshotId: string): Promise<void> {
    try {
      const restoreResult = await this.deps.undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      // 需求 22.2：后台文件修改使用 Vault.process() 原子操作
      const file = this.deps.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.deps.app.vault.process(file, () => snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccess"));
      } else {
        await this.deps.app.vault.create(snapshot.path, snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccessRestored"));
      }

      await this.deps.undoManager.deleteSnapshot(snapshotId);
      await this.refresh();
    } catch (error) {
      this.deps.logError("撤销操作失败", error, { snapshotId });
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.undoFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${errorMessage}`);
    }
  }

  private async handleViewSnapshotDiff(snapshot: SnapshotMetadata): Promise<void> {
    const snapshotResult = await this.deps.undoManager.restoreSnapshot(snapshot.id);
    if (!snapshotResult.ok) {
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${snapshotResult.error.message}`);
      return;
    }

    const snapshotContent = snapshotResult.value.content;
    let currentContent = snapshotContent;
    const file = this.deps.app.vault.getAbstractFileByPath(snapshot.path);
    if (file && file instanceof TFile) {
      currentContent = await this.deps.app.vault.cachedRead(file);
    }

    const modal = new SnapshotDiffModal(this.deps.app, {
      snapshot,
      snapshotContent,
      currentContent,
      onRestore: async () => {
        const restoreResult = await this.deps.undoManager.restoreSnapshotToFile(snapshot.id);
        if (!restoreResult.ok) {
          this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
          return;
        }
        new Notice(this.deps.t("workbench.notifications.undoSuccess"));
        await this.refresh();
      },
      t: this.deps.t
    });
    modal.open();
  }

  private async handleUndoFromToast(snapshotId: string): Promise<void> {
    try {
      const restoreResult = await this.deps.undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      // 需求 22.2：后台文件修改使用 Vault.process() 原子操作
      const file = this.deps.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.deps.app.vault.process(file, () => snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccess"));
      } else {
        await this.deps.app.vault.create(snapshot.path, snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccessRestored"));
      }

      await this.deps.undoManager.deleteSnapshot(snapshotId);
      await this.refresh();
    } catch (error) {
      this.deps.logError("撤销操作失败（Toast）", error, { snapshotId });
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.undoFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${errorMessage}`);
    }
  }

  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmDialog(this.deps.app, title, message, resolve, this.deps.t);
      modal.open();
    });
  }

  private formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return this.deps.t("workbench.recentOps.timeJustNow");
    if (minutes < 60) return this.deps.t("workbench.recentOps.timeMinutesAgo").replace("{minutes}", String(minutes));

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.deps.t("workbench.recentOps.timeHoursAgo").replace("{hours}", String(hours));

    const days = Math.floor(hours / 24);
    return this.deps.t("workbench.recentOps.timeDaysAgo").replace("{days}", String(days));
  }
}
