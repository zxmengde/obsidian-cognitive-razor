/**
 * DuplicatesSection — 重复对区组件
 *
 * 负责显示重复概念对列表，支持合并、忽略、预览操作。
 * 通过 DuplicatesSectionDeps 注入依赖，不直接依赖 Plugin 实例。
 *
 * 需求: 6.1, 8.2
 */

import { Notice, TFile, setIcon } from "obsidian";
import type { DuplicatePair } from "../../types";
import { safeErrorMessage } from "../../types";
import type { DuplicatesSectionDeps } from "./workbench-section-deps";
import { WorkbenchSection } from "./workbench-section";
import { SimpleDiffView } from "../diff-view";
import { MergeNameSelectionModal } from "../merge-modals";
import { ConfirmDialog, DuplicatePreviewModal } from "./workbench-modals";
import { formatMessage } from "../../core/i18n";

type DuplicateSortOrder =
  | "similarity-desc"
  | "similarity-asc"
  | "time-desc"
  | "time-asc"
  | "type";

export class DuplicatesSection extends WorkbenchSection<DuplicatesSectionDeps> {
  private container: HTMLElement | null = null;
  private sectionEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;

  private selectedDuplicates: Set<string> = new Set();
  private currentSortOrder: DuplicateSortOrder = "similarity-desc";
  private currentTypeFilter: DuplicatePair["type"] | "all" = "all";
  private allDuplicates: DuplicatePair[] = [];

  /**
   * 挂载到可折叠区域（由 WorkbenchPanel 的 renderCollapsibleSection 调用）
   */
  mount(options: { content: HTMLElement; badge: HTMLElement; section: HTMLElement }): void {
    this.container = options.content;
    this.badgeEl = options.badge;
    this.sectionEl = options.section;
    this.renderEmpty();
    this.refresh();
  }

  render(container: HTMLElement): void {
    // 由 mount() 处理实际渲染（可折叠区域模式）
    this.container = container;
    this.renderEmpty();
    this.refresh();
  }

  update(): void {
    this.refresh();
  }

  dispose(): void {
    this.container = null;
    this.sectionEl = null;
    this.badgeEl = null;
    this.selectedDuplicates.clear();
    this.allDuplicates = [];
  }

  /**
   * 兼容旧接口：WorkbenchPanel.onClose() 调用
   */
  onClose(): void {
    this.dispose();
  }

  reveal(): void {
    this.refresh();
    this.sectionEl?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  refresh(): void {
    try {
      const duplicateManager = this.deps.duplicateManager;
      if (!duplicateManager) return;
      const pairs = duplicateManager.getPendingPairs();
      this.updateDuplicates(pairs);
    } catch (error) {
      this.deps.logWarn("刷新重复列表失败", { error });
      this.deps.showErrorNotice(`${this.deps.t("common.error")}: ${safeErrorMessage(error)}`);
    }
  }

  updateDuplicates(duplicates: DuplicatePair[]): void {
    if (!this.container) return;

    this.allDuplicates = duplicates;

    let filteredDuplicates = duplicates;
    if (this.currentTypeFilter !== "all") {
      filteredDuplicates = duplicates.filter(pair => pair.type === this.currentTypeFilter);
    }

    const sortedDuplicates = this.sortDuplicates(filteredDuplicates);

    this.container.empty();

    if (this.badgeEl) {
      this.badgeEl.textContent = sortedDuplicates.length.toString();
      this.badgeEl.style.display = sortedDuplicates.length > 0 ? "" : "none";
    }

    if (sortedDuplicates.length === 0) {
      this.renderEmpty();
      return;
    }

    const list = this.container.createDiv({ cls: "cr-duplicates-list-inner" });
    sortedDuplicates.forEach(pair => {
      this.renderDuplicateItem(list, pair);
    });
  }

  private renderDuplicateItem(container: HTMLElement, pair: DuplicatePair): void {
    const item = container.createDiv({ cls: "cr-duplicate-item" });

    const checkboxWrapper = item.createDiv({ cls: "cr-checkbox-wrapper" });
    const checkbox = checkboxWrapper.createEl("input", {
      type: "checkbox",
      cls: "cr-duplicate-checkbox"
    });
    checkbox.dataset.pairId = pair.id;
    if (this.selectedDuplicates.has(pair.id)) {
      checkbox.checked = true;
    }
    checkbox.addEventListener("change", (e) => {
      if ((e.target as HTMLInputElement).checked) {
        this.selectedDuplicates.add(pair.id);
      } else {
        this.selectedDuplicates.delete(pair.id);
      }
    });

    const statusBar = item.createDiv({ cls: "cr-duplicate-status-bar" });
    const fill = statusBar.createDiv({ cls: "cr-status-fill" });
    fill.style.width = `${pair.similarity * 100}%`;
    if (pair.similarity > 0.9) fill.addClass("cr-similarity-high");
    else if (pair.similarity > 0.8) fill.addClass("cr-similarity-medium");
    else fill.addClass("cr-similarity-low");

    const content = item.createDiv({ cls: "cr-duplicate-content" });

    const header = content.createDiv({ cls: "cr-duplicate-header" });
    const nameA = this.deps.resolveNoteName(pair.nodeIdA);
    const nameB = this.deps.resolveNoteName(pair.nodeIdB);
    header.createDiv({ cls: "cr-duplicate-note", text: nameA });
    header.createDiv({ cls: "cr-duplicate-arrow", text: "↔" });
    header.createDiv({ cls: "cr-duplicate-note", text: nameB });

    const meta = content.createDiv({ cls: "cr-duplicate-meta" });
    meta.createSpan({ cls: "cr-meta-tag", text: pair.type });
    meta.createSpan({ cls: "cr-meta-text", text: `${(pair.similarity * 100).toFixed(0)}%` });

    const actions = item.createDiv({ cls: "cr-duplicate-actions" });

    const mergeBtn = actions.createEl("button", {
      cls: "cr-icon-btn",
      attr: {
        "aria-label": this.deps.t("workbench.duplicates.merge"),
        "data-tooltip-position": "top"
      }
    });
    setIcon(mergeBtn, "git-merge");
    mergeBtn.onclick = (e) => { e.stopPropagation(); void this.handleMergeDuplicate(pair); };

    const dismissBtn = actions.createEl("button", {
      cls: "cr-icon-btn",
      attr: {
        "aria-label": this.deps.t("workbench.duplicates.dismiss"),
        "data-tooltip-position": "top"
      }
    });
    setIcon(dismissBtn, "x");
    dismissBtn.onclick = (e) => { e.stopPropagation(); void this.handleDismissDuplicate(pair); };

    item.onclick = (e) => {
      if (e.target === checkbox || actions.contains(e.target as Node)) return;
      void this.handleShowDuplicatePreview(pair);
    };

    item.addEventListener("mouseenter", () => { actions.style.opacity = "1"; });
    item.addEventListener("mouseleave", () => { actions.style.opacity = "0"; });
  }

  private sortDuplicates(duplicates: DuplicatePair[]): DuplicatePair[] {
    const sorted = [...duplicates];

    switch (this.currentSortOrder) {
      case "similarity-desc":
        sorted.sort((a, b) => b.similarity - a.similarity);
        break;
      case "similarity-asc":
        sorted.sort((a, b) => a.similarity - b.similarity);
        break;
      case "time-desc":
        sorted.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
        break;
      case "time-asc":
        sorted.sort((a, b) => new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());
        break;
      case "type":
        sorted.sort((a, b) => a.type.localeCompare(b.type));
        break;
    }

    return sorted;
  }

  private renderEmpty(): void {
    if (!this.container) return;
    this.container.createEl("div", {
      text: this.deps.t("workbench.duplicates.empty"),
      cls: "cr-empty-state"
    });
  }

  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmDialog(this.deps.app, title, message, resolve, this.deps.t);
      modal.open();
    });
  }

  private async handleShowDuplicatePreview(pair: DuplicatePair): Promise<void> {
    try {
      const pathA = this.deps.resolveNotePath(pair.nodeIdA);
      const pathB = this.deps.resolveNotePath(pair.nodeIdB);

      if (!pathA) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pair.nodeIdA}`);
        return;
      }

      if (!pathB) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pair.nodeIdB}`);
        return;
      }

      const fileA = this.deps.app.vault.getAbstractFileByPath(pathA);
      const fileB = this.deps.app.vault.getAbstractFileByPath(pathB);

      if (!fileA || !(fileA instanceof TFile)) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pathA}`);
        return;
      }

      if (!fileB || !(fileB instanceof TFile)) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pathB}`);
        return;
      }

      const contentA = await this.deps.app.vault.cachedRead(fileA);
      const contentB = await this.deps.app.vault.cachedRead(fileB);

      this.showDuplicatePreviewModal(pair, contentA, contentB);
    } catch (error) {
      this.deps.logError("显示预览失败", error, { pairId: pair.id });
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.previewFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.previewFailed")}: ${errorMessage}`);
    }
  }

  private showDuplicatePreviewModal(pair: DuplicatePair, contentA: string, contentB: string): void {
    const modal = new DuplicatePreviewModal(
      this.deps.app,
      pair,
      contentA,
      contentB,
      {
        resolveName: (nodeId: string) => this.deps.resolveNoteName(nodeId),
        resolvePath: (nodeId: string) => this.deps.resolveNotePath(nodeId),
      },
      () => { void this.handleMergeDuplicate(pair); },
      () => { void this.handleDismissDuplicate(pair); },
      this.deps.t
    );
    modal.open();
  }

  private async handleMergeDuplicate(pair: DuplicatePair): Promise<void> {
    try {
      const pathA = this.deps.resolveNotePath(pair.nodeIdA);
      const pathB = this.deps.resolveNotePath(pair.nodeIdB);

      if (!pathA) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pair.nodeIdA}`);
        return;
      }

      if (!pathB) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pair.nodeIdB}`);
        return;
      }

      const fileA = this.deps.app.vault.getAbstractFileByPath(pathA);
      const fileB = this.deps.app.vault.getAbstractFileByPath(pathB);

      if (!fileA || !(fileA instanceof TFile)) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pathA}`);
        return;
      }

      if (!fileB || !(fileB instanceof TFile)) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.fileNotFound")}: ${pathB}`);
        return;
      }

      const contentA = await this.deps.app.vault.cachedRead(fileA);
      const contentB = await this.deps.app.vault.cachedRead(fileB);

      this.showMergePreviewDiffView(pair, contentA, contentB);
    } catch (error) {
      this.deps.logError("显示合并预览失败", error, { pairId: pair.id });
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.previewFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.previewFailed")}: ${errorMessage}`);
    }
  }

  private showMergePreviewDiffView(pair: DuplicatePair, contentA: string, contentB: string): void {
    const nameA = this.deps.resolveNoteName(pair.nodeIdA);
    const nameB = this.deps.resolveNoteName(pair.nodeIdB);
    const diffView = new SimpleDiffView(
      this.deps.app,
      `${this.deps.t("workbench.duplicates.merge")}: ${nameA} ↔ ${nameB}`,
      contentA,
      contentB,
      async () => {
        await this.confirmMerge(pair);
      },
      () => {
        new Notice(this.deps.t("workbench.notifications.mergeCancelled"));
      },
      this.getDiffViewLabels()
    );

    diffView.open();
  }

  private async confirmMerge(pair: DuplicatePair): Promise<void> {
    const orchestrator = this.deps.mergeOrchestrator;

    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.orchestratorNotInitialized"));
      return;
    }

    const cruidCache = this.deps.cruidCache;
    const duplicateManager = this.deps.duplicateManager;

    const modal = new MergeNameSelectionModal(
      this.deps.app,
      pair,
      {
        onConfirm: async (finalFileName: string, keepNodeId: string) => {
          try {
            const result = orchestrator.startMergePipeline(pair, keepNodeId, finalFileName);
            if (!result.ok) {
              this.deps.showErrorNotice(formatMessage(this.deps.t("workbench.notifications.startFailed"), { message: result.error.message }));
              return;
            }

            new Notice(this.deps.t("workbench.notifications.mergeStarted"));

            if (duplicateManager) {
              await duplicateManager.updateStatus(pair.id, "merging");
            }
          } catch (error) {
            const errorMessage = safeErrorMessage(error);
            this.deps.showErrorNotice(formatMessage(this.deps.t("workbench.notifications.startFailed"), { message: errorMessage }));
          }
        },
        onCancel: () => {
          new Notice(this.deps.t("workbench.notifications.mergeCancelled"));
        },
        resolveName: (nodeId: string) => cruidCache?.getName(nodeId) || nodeId,
        t: this.deps.t
      }
    );
    modal.open();
  }

  private async handleDismissDuplicate(pair: DuplicatePair): Promise<void> {
    try {
      const duplicateManager = this.deps.duplicateManager;

      if (!duplicateManager) {
        this.deps.showErrorNotice(this.deps.t("workbench.notifications.duplicateManagerNotInitialized"));
        return;
      }

      const result = await duplicateManager.updateStatus(pair.id, "dismissed");
      if (!result.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.dismissFailed")}: ${result.error.message}`);
        return;
      }

      new Notice(`${this.deps.t("workbench.notifications.dismissSuccess")}: ${this.deps.resolveNoteName(pair.nodeIdA)} ↔ ${this.deps.resolveNoteName(pair.nodeIdB)}`);

      this.refresh();
    } catch (error) {
      this.deps.logError("忽略重复对失败", error, { pairId: pair.id });
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.dismissFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.dismissFailed")}: ${errorMessage}`);
    }
  }

  private getDiffViewLabels(): { accept: string; reject: string; acceptAria: string; rejectAria: string } {
    return {
      accept: this.deps.t("workbench.diffPreview.accept"),
      reject: this.deps.t("workbench.diffPreview.reject"),
      acceptAria: this.deps.t("workbench.diffPreview.acceptAria"),
      rejectAria: this.deps.t("workbench.diffPreview.rejectAria"),
    };
  }
}
