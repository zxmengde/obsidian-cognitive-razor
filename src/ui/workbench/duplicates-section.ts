import { Notice, TFile, setIcon } from "obsidian";
import type { DuplicatePair } from "../../types";
import type { WorkbenchSectionDeps } from "./workbench-section-deps";
import { SimpleDiffView } from "../diff-view";
import { MergeNameSelectionModal } from "../merge-modals";
import { ConfirmDialog, DuplicatePreviewModal, MergeHistoryModal } from "./workbench-modals";

type DuplicateSortOrder =
  | "similarity-desc"
  | "similarity-asc"
  | "time-desc"
  | "time-asc"
  | "type";

export class DuplicatesSection {
  private deps: WorkbenchSectionDeps;

  private container: HTMLElement | null = null;
  private sectionEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;

  private selectedDuplicates: Set<string> = new Set();
  private currentSortOrder: DuplicateSortOrder = "similarity-desc";
  private currentTypeFilter: DuplicatePair["type"] | "all" = "all";
  private allDuplicates: DuplicatePair[] = [];

  constructor(deps: WorkbenchSectionDeps) {
    this.deps = deps;
  }

  mount(options: { content: HTMLElement; badge: HTMLElement; section: HTMLElement }): void {
    this.container = options.content;
    this.badgeEl = options.badge;
    this.sectionEl = options.section;
    this.renderEmpty();
    this.refresh();
  }

  onClose(): void {
    this.container = null;
    this.sectionEl = null;
    this.badgeEl = null;
    this.selectedDuplicates.clear();
    this.allDuplicates = [];
  }

  reveal(): void {
    this.refresh();
    this.sectionEl?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  openOperationHistory(): void {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;
    const modal = new MergeHistoryModal(this.deps.app, plugin);
    modal.open();
  }

  refresh(): void {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    try {
      const duplicateManager = plugin.getComponents().duplicateManager;
      if (!duplicateManager) return;
      const pairs = duplicateManager.getPendingPairs();
      this.update(pairs);
    } catch (error) {
      this.deps.logWarn("刷新重复列表失败", { error });
      this.deps.showErrorNotice(`${this.deps.t("common.error")}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  update(duplicates: DuplicatePair[]): void {
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
    if (pair.similarity > 0.9) fill.style.backgroundColor = "var(--color-red)";
    else if (pair.similarity > 0.8) fill.style.backgroundColor = "var(--color-orange)";
    else fill.style.backgroundColor = "var(--color-yellow)";

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
      attr: { "aria-label": this.deps.t("workbench.duplicates.merge") }
    });
    setIcon(mergeBtn, "git-merge");
    mergeBtn.onclick = (e) => { e.stopPropagation(); void this.handleMergeDuplicate(pair); };

    const dismissBtn = actions.createEl("button", {
      cls: "cr-icon-btn",
      attr: { "aria-label": this.deps.t("workbench.duplicates.dismiss") }
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
      const modal = new ConfirmDialog(this.deps.app, title, message, resolve);
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

      const contentA = await this.deps.app.vault.read(fileA);
      const contentB = await this.deps.app.vault.read(fileB);

      this.showDuplicatePreviewModal(pair, contentA, contentB);
    } catch (error) {
      this.deps.logError("显示预览失败", error, { pairId: pair.id });
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      () => { void this.handleDismissDuplicate(pair); }
    );
    modal.open();
  }

  private async handleMergeDuplicate(pair: DuplicatePair): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

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

      const contentA = await this.deps.app.vault.read(fileA);
      const contentB = await this.deps.app.vault.read(fileB);

      this.showMergePreviewDiffView(pair, contentA, contentB);
    } catch (error) {
      this.deps.logError("显示合并预览失败", error, { pairId: pair.id });
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      }
    );

    diffView.open();
  }

  private async confirmMerge(pair: DuplicatePair): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const components = plugin.getComponents();
    const orchestrator = components.pipelineOrchestrator;

    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.orchestratorNotInitialized"));
      return;
    }

    const modal = new MergeNameSelectionModal(
      this.deps.app,
      pair,
      {
        onConfirm: async (finalFileName: string, keepNodeId: string) => {
          try {
            const result = orchestrator.startMergePipeline(pair, keepNodeId, finalFileName);
            if (!result.ok) {
              this.deps.showErrorNotice(`启动合并失败: ${result.error.message}`);
              return;
            }

            new Notice(this.deps.t("workbench.notifications.mergeStarted"));

            const duplicateManager = components.duplicateManager;
            if (duplicateManager) {
              await duplicateManager.updateStatus(pair.id, "merging");
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.deps.showErrorNotice(`启动合并失败: ${errorMessage}`);
          }
        },
        onCancel: () => {
          new Notice(this.deps.t("workbench.notifications.mergeCancelled"));
        },
        resolveName: (nodeId: string) => components.cruidCache?.getName(nodeId) || nodeId
      }
    );
    modal.open();
  }

  private async handleDismissDuplicate(pair: DuplicatePair): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    try {
      const duplicateManager = plugin.getComponents().duplicateManager;

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.dismissFailed")}: ${errorMessage}`);
    }
  }
}
