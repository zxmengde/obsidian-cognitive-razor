import { Notice, TFile } from "obsidian";
import type { SnapshotMetadata } from "../../types";
import type { WorkbenchSectionDeps } from "./workbench-section-deps";
import { UndoNotification } from "../undo-notification";
import { ConfirmDialog, SnapshotDiffModal } from "./workbench-modals";

export class RecentOpsSection {
  private deps: WorkbenchSectionDeps;

  private container: HTMLElement | null = null;
  private sectionEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;

  constructor(deps: WorkbenchSectionDeps) {
    this.deps = deps;
  }

  mount(options: { content: HTMLElement; badge: HTMLElement; section: HTMLElement }): void {
    this.container = options.content;
    this.badgeEl = options.badge;
    this.sectionEl = options.section;
    void this.refresh();
  }

  onClose(): void {
    this.container = null;
    this.sectionEl = null;
    this.badgeEl = null;
  }

  reveal(): void {
    this.sectionEl?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async refresh(): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!this.container || !plugin) return;

    this.container.empty();

    const undoManager = plugin.getComponents().undoManager;
    const result = await undoManager.listSnapshots();

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
        attr: { "aria-label": `${this.deps.t("workbench.recentOps.undo")}: ${description}` }
      });
      undoBtn.addEventListener("click", async () => {
        await this.handleUndoSnapshot(snapshot.id);
      });

      const viewBtn = item.createEl("button", {
        text: this.deps.t("workbench.recentOps.viewSnapshot"),
        cls: "cr-view-snapshot-btn cr-btn-small",
        attr: { "aria-label": `${this.deps.t("workbench.recentOps.viewSnapshot")}: ${description}` }
      });
      viewBtn.addEventListener("click", async () => {
        await this.handleViewSnapshotDiff(snapshot);
      });
    });

    if (snapshots.length > 10) {
      const moreHint = this.container.createDiv({ cls: "cr-more-hint" });
      const moreCount = snapshots.length - 10;
      moreHint.textContent = this.deps.t("workbench.recentOps.moreSnapshots").replace("{count}", String(moreCount));
    }
  }

  showUndoToast(message: string, snapshotId: string, filePath: string): void {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

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
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const confirmed = await this.showConfirmDialog(
      this.deps.t("workbench.recentOps.clearAllConfirmTitle"),
      this.deps.t("workbench.recentOps.clearAllConfirmMessage")
    );

    if (!confirmed) return;

    const undoManager = plugin.getComponents().undoManager;
    const result = await undoManager.clearAllSnapshots();

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
      enrich: "标记",
      merge: "合并",
      amend: "修订",
      "manual-edit": "手动编辑",
      standardize: "定义",
      create: "创建笔记",
    };

    for (const [key, name] of Object.entries(operationNames)) {
      if (taskId.includes(key)) {
        return name;
      }
    }

    return "操作";
  }

  private async handleUndoSnapshot(snapshotId: string): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const undoManager = plugin.getComponents().undoManager;

    try {
      const restoreResult = await undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      const file = this.deps.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.deps.app.vault.modify(file, snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccess"));
      } else {
        await this.deps.app.vault.create(snapshot.path, snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccessRestored"));
      }

      await undoManager.deleteSnapshot(snapshotId);
      await this.refresh();
    } catch (error) {
      this.deps.logError("撤销操作失败", error, { snapshotId });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${errorMessage}`);
    }
  }

  private async handleViewSnapshotDiff(snapshot: SnapshotMetadata): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const undoManager = plugin.getComponents().undoManager;
    const snapshotResult = await undoManager.restoreSnapshot(snapshot.id);
    if (!snapshotResult.ok) {
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${snapshotResult.error.message}`);
      return;
    }

    const snapshotContent = snapshotResult.value.content;
    let currentContent = snapshotContent;
    const file = this.deps.app.vault.getAbstractFileByPath(snapshot.path);
    if (file && file instanceof TFile) {
      currentContent = await this.deps.app.vault.read(file);
    }

    const modal = new SnapshotDiffModal(this.deps.app, {
      snapshot,
      snapshotContent,
      currentContent,
      onRestore: async () => {
        const restoreResult = await undoManager.restoreSnapshotToFile(snapshot.id);
        if (!restoreResult.ok) {
          this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
          return;
        }
        new Notice(this.deps.t("workbench.notifications.undoSuccess"));
        await this.refresh();
      }
    });
    modal.open();
  }

  private async handleUndoFromToast(snapshotId: string): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const undoManager = plugin.getComponents().undoManager;

    try {
      const restoreResult = await undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      const file = this.deps.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.deps.app.vault.modify(file, snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccess"));
      } else {
        await this.deps.app.vault.create(snapshot.path, snapshot.content);
        new Notice(this.deps.t("workbench.notifications.undoSuccessRestored"));
      }

      await undoManager.deleteSnapshot(snapshotId);
      await this.refresh();
    } catch (error) {
      this.deps.logError("撤销操作失败（Toast）", error, { snapshotId });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.undoFailed")}: ${errorMessage}`);
    }
  }

  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmDialog(this.deps.app, title, message, resolve);
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
