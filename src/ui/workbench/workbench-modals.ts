import { App, Modal, Notice, TFile } from "obsidian";
import type { DuplicatePair, SnapshotMetadata } from "../../types";
import type CognitiveRazorPlugin from "../../../main";
import { buildLineDiff, renderSideBySideDiff } from "../diff-view";

const ERROR_NOTICE_DURATION = 6000;

/**
 * 重复对预览模态框（改进版）
 */
export class DuplicatePreviewModal extends Modal {
  private pair: DuplicatePair;
  private contentA: string;
  private contentB: string;
  private resolveName: (nodeId: string) => string;
  private resolvePath: (nodeId: string) => string | null;
  private onMerge: () => void;
  private onDismiss: () => void;

  constructor(
    app: App,
    pair: DuplicatePair,
    contentA: string,
    contentB: string,
    resolvers: {
      resolveName: (nodeId: string) => string;
      resolvePath: (nodeId: string) => string | null;
    },
    onMerge: () => void,
    onDismiss: () => void
  ) {
    super(app);
    this.pair = pair;
    this.contentA = contentA;
    this.contentB = contentB;
    this.resolveName = resolvers.resolveName;
    this.resolvePath = resolvers.resolvePath;
    this.onMerge = onMerge;
    this.onDismiss = onDismiss;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-duplicate-preview-modal");
    contentEl.addClass("cr-scope");

    // 标题栏
    const header = contentEl.createDiv({ cls: "cr-preview-header" });
    header.createEl("h2", {
      text: "重复概念预览",
      cls: "cr-modal-title"
    });

    // 元信息卡片
    const metaCard = contentEl.createDiv({ cls: "cr-preview-meta-card" });

    const similarityRow = metaCard.createDiv({ cls: "cr-meta-row" });
    similarityRow.createEl("span", { text: "相似度:", cls: "cr-meta-label" });
    const similarityValue = similarityRow.createDiv({ cls: "cr-meta-value" });
    const similarityBar = similarityValue.createDiv({ cls: "cr-similarity-bar-large" });
    const similarityFill = similarityBar.createDiv({ cls: "cr-similarity-fill" });
    similarityFill.style.width = `${this.pair.similarity * 100}%`;
    similarityValue.createEl("span", {
      text: `${(this.pair.similarity * 100).toFixed(1)}%`,
      cls: "cr-similarity-percentage"
    });

    const typeRow = metaCard.createDiv({ cls: "cr-meta-row" });
    typeRow.createEl("span", { text: "类型:", cls: "cr-meta-label" });
    typeRow.createEl("span", {
      text: this.pair.type,
      cls: "cr-type-tag-large"
    });

    const timeRow = metaCard.createDiv({ cls: "cr-meta-row" });
    timeRow.createEl("span", { text: "检测时间:", cls: "cr-meta-label" });
    timeRow.createEl("span", {
      text: new Date(this.pair.detectedAt).toLocaleString("zh-CN"),
      cls: "cr-meta-value"
    });

    // 标签页切换
    const tabContainer = contentEl.createDiv({ cls: "cr-preview-tabs" });
    const sideBySideTab = tabContainer.createEl("button", {
      text: "并排对比",
      cls: "cr-tab-button cr-tab-active"
    });
    const diffTab = tabContainer.createEl("button", {
      text: "差异高亮",
      cls: "cr-tab-button"
    });

    // 预览容器
    const previewContainer = contentEl.createDiv({ cls: "cr-preview-container" });

    // 并排视图
    const sideBySideView = previewContainer.createDiv({ cls: "cr-side-by-side-view" });

    const nameA = this.resolveName(this.pair.nodeIdA);
    const nameB = this.resolveName(this.pair.nodeIdB);
    const pathA = this.resolvePath(this.pair.nodeIdA);
    const pathB = this.resolvePath(this.pair.nodeIdB);

    // 笔记 A 面板
    const panelA = sideBySideView.createDiv({ cls: "cr-preview-panel" });
    const headerA = panelA.createDiv({ cls: "cr-panel-header" });
    headerA.createEl("h3", { text: nameA, cls: "cr-panel-title" });
    headerA.createEl("div", {
      text: pathA || "",
      cls: "cr-panel-path"
    });
    const contentAEl = panelA.createEl("pre", { cls: "cr-panel-content" });
    contentAEl.textContent = this.contentA;

    // 笔记 B 面板
    const panelB = sideBySideView.createDiv({ cls: "cr-preview-panel" });
    const headerB = panelB.createDiv({ cls: "cr-panel-header" });
    headerB.createEl("h3", { text: nameB, cls: "cr-panel-title" });
    headerB.createEl("div", {
      text: pathB || "",
      cls: "cr-panel-path"
    });
    const contentBEl = panelB.createEl("pre", { cls: "cr-panel-content" });
    contentBEl.textContent = this.contentB;

    // 差异视图（初始隐藏）
    const diffView = previewContainer.createDiv({ cls: "cr-diff-view cr-hidden" });
    const diffLines = buildLineDiff(this.contentA, this.contentB);
    const diffList = diffView.createDiv({ cls: "cr-unified-diff" });
    diffLines.forEach((line, idx) => {
      const row = diffList.createDiv({ cls: `cr-diff-row cr-${line.type}` });
      row.createSpan({
        text: line.type === "add" ? "+" : line.type === "remove" ? "-" : " ",
        cls: "cr-diff-prefix"
      });
      row.createSpan({
        text: line.text || " ",
        cls: "cr-diff-text",
        attr: { "data-line": `${idx + 1}` }
      });
    });

    // 标签页切换逻辑
    sideBySideTab.addEventListener("click", () => {
      sideBySideTab.addClass("cr-tab-active");
      diffTab.removeClass("cr-tab-active");
      sideBySideView.removeClass("cr-hidden");
      diffView.addClass("cr-hidden");
    });

    diffTab.addEventListener("click", () => {
      diffTab.addClass("cr-tab-active");
      sideBySideTab.removeClass("cr-tab-active");
      diffView.removeClass("cr-hidden");
      sideBySideView.addClass("cr-hidden");
    });

    // 按钮区域
    const buttonContainer = contentEl.createDiv({ cls: "cr-modal-buttons" });

    const mergeBtn = buttonContainer.createEl("button", {
      text: "🔀 合并",
      cls: "mod-cta"
    });
    mergeBtn.addEventListener("click", () => {
      this.close();
      this.onMerge();
    });

    const dismissBtn = buttonContainer.createEl("button", {
      text: "🚫 忽略"
    });
    dismissBtn.addEventListener("click", () => {
      this.close();
      this.onDismiss();
    });

    const openABtn = buttonContainer.createEl("button", {
      text: "📄 打开 A"
    });
    openABtn.addEventListener("click", () => {
      if (!pathA) {
        new Notice(`文件不存在: ${this.pair.nodeIdA}`, ERROR_NOTICE_DURATION);
        return;
      }
      void this.openFile(pathA);
    });

    const openBBtn = buttonContainer.createEl("button", {
      text: "📄 打开 B"
    });
    openBBtn.addEventListener("click", () => {
      if (!pathB) {
        new Notice(`文件不存在: ${this.pair.nodeIdB}`, ERROR_NOTICE_DURATION);
        return;
      }
      void this.openFile(pathB);
    });

    const cancelBtn = buttonContainer.createEl("button", {
      text: "取消"
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  private async openFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file && file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } else {
      new Notice(`文件不存在: ${path}`, ERROR_NOTICE_DURATION);
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 确认对话框
 */
export class ConfirmDialog extends Modal {
  private title: string;
  private message: string;
  private onConfirm: (result: boolean) => void;

  constructor(app: App, title: string, message: string, onConfirm: (result: boolean) => void) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-confirm-dialog");
    contentEl.addClass("cr-scope");

    contentEl.createEl("h2", { text: this.title });
    contentEl.createEl("p", { text: this.message, cls: "cr-confirm-message" });

    const buttonContainer = contentEl.createDiv({ cls: "cr-modal-buttons" });

    const confirmBtn = buttonContainer.createEl("button", {
      text: "确定",
      cls: "mod-cta"
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm(true);
    });

    const cancelBtn = buttonContainer.createEl("button", {
      text: "取消"
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm(false);
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 合并历史模态框
 */
export class MergeHistoryModal extends Modal {
  private plugin: CognitiveRazorPlugin | null;
  private currentTab: "merged" | "dismissed" = "merged";
  private listContainer: HTMLElement | null = null;

  constructor(app: App, plugin: CognitiveRazorPlugin | null) {
    super(app);
    this.plugin = plugin;
  }

  /**
   * 获取翻译文本
   */
  private t(path: string): string {
    if (!this.plugin) return path;

    const i18n = this.plugin.getComponents().i18n;
    if (!i18n) return path;

    const translations = i18n.t();
    const keys = path.split(".");
    let value: unknown = translations;

    for (const key of keys) {
      value = (value as Record<string, unknown>)?.[key];
      if (value === undefined) return path;
    }

    return typeof value === "string" ? value : path;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-merge-history-modal");
    contentEl.addClass("cr-scope");

    contentEl.createEl("h2", { text: this.t("workbench.duplicateHistory.title") });

    if (!this.plugin) {
      contentEl.createEl("p", { text: this.t("workbench.notifications.pluginNotInitialized"), cls: "cr-error-text" });
      return;
    }

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) {
      contentEl.createEl("p", { text: this.t("workbench.notifications.duplicateManagerNotInitialized"), cls: "cr-error-text" });
      return;
    }

    const historyContainer = contentEl.createDiv({ cls: "cr-history-container" });

    // 标签页
    const tabContainer = historyContainer.createDiv({ cls: "cr-history-tabs" });
    const mergedTab = tabContainer.createEl("button", {
      text: "已合并",
      cls: "cr-tab-button cr-tab-active"
    });
    const dismissedTab = tabContainer.createEl("button", {
      text: "已忽略",
      cls: "cr-tab-button"
    });

    // 列表容器
    this.listContainer = historyContainer.createDiv({ cls: "cr-history-list" });

    // 标签页切换
    mergedTab.addEventListener("click", () => {
      mergedTab.addClass("cr-tab-active");
      dismissedTab.removeClass("cr-tab-active");
      this.currentTab = "merged";
      this.renderList();
    });

    dismissedTab.addEventListener("click", () => {
      dismissedTab.addClass("cr-tab-active");
      mergedTab.removeClass("cr-tab-active");
      this.currentTab = "dismissed";
      this.renderList();
    });

    // 初始渲染
    await this.renderList();

    const buttonContainer = contentEl.createDiv({ cls: "cr-modal-buttons" });
    const closeBtn = buttonContainer.createEl("button", {
      text: "关闭"
    });
    closeBtn.addEventListener("click", () => {
      this.close();
    });
  }

  private async renderList(): Promise<void> {
    if (!this.listContainer || !this.plugin) return;

    this.listContainer.empty();

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) return;

    let pairs: DuplicatePair[];
    if (this.currentTab === "merged") {
      pairs = duplicateManager.getMergedPairs();
    } else {
      pairs = duplicateManager.getDismissedPairs();
    }

    if (pairs.length === 0) {
      this.listContainer.createEl("p", {
        text: this.currentTab === "merged" ? "暂无已合并的重复对" : "暂无已忽略的重复对",
        cls: "cr-placeholder-text"
      });
      return;
    }

    // 渲染历史项
    pairs.forEach(pair => {
      const item = this.listContainer!.createDiv({ cls: "cr-history-item" });

      const info = item.createDiv({ cls: "cr-history-info" });
      const nameA = this.resolveName(pair.nodeIdA);
      const nameB = this.resolveName(pair.nodeIdB);
      info.createEl("div", {
        text: `${nameA} ↔ ${nameB}`,
        cls: "cr-history-names"
      });

      const meta = info.createDiv({ cls: "cr-history-meta" });
      meta.createEl("span", {
        text: `相似度: ${(pair.similarity * 100).toFixed(1)}%`,
        cls: "cr-history-similarity"
      });
      meta.createEl("span", {
        text: pair.type,
        cls: "cr-history-type"
      });
      meta.createEl("span", {
        text: new Date(pair.detectedAt).toLocaleString("zh-CN"),
        cls: "cr-history-time"
      });

      // 操作按钮
      const actions = item.createDiv({ cls: "cr-history-actions" });

      if (this.currentTab === "dismissed") {
        // 已忽略的可以撤销
        const undoBtn = actions.createEl("button", {
          text: "撤销忽略",
          cls: "cr-btn-small mod-cta"
        });
        undoBtn.addEventListener("click", async () => {
          await this.handleUndoDismiss(pair.id);
        });
      }

      const deleteBtn = actions.createEl("button", {
        text: "删除",
        cls: "cr-btn-small"
      });
      deleteBtn.addEventListener("click", async () => {
        await this.handleDelete(pair.id);
      });
    });
  }

  private async handleUndoDismiss(pairId: string): Promise<void> {
    if (!this.plugin) return;

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) return;

    const result = await duplicateManager.updateStatus(pairId, "pending");

    if (result.ok) {
      new Notice(this.t("workbench.notifications.undoDismissSuccess"));
      await this.renderList();
    } else {
      new Notice(`${this.t("workbench.notifications.undoFailed")}: ${result.error.message}`, ERROR_NOTICE_DURATION);
    }
  }

  private async handleDelete(pairId: string): Promise<void> {
    if (!this.plugin) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new ConfirmDialog(
        this.app,
        this.t("confirmDialogs.deleteDuplicatePair.title"),
        this.t("confirmDialogs.deleteDuplicatePair.message"),
        resolve
      );
      modal.open();
    });

    if (!confirmed) return;

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) return;

    const result = await duplicateManager.removePair(pairId);

    if (result.ok) {
      new Notice(this.t("workbench.notifications.deletePairSuccess"));
      await this.renderList();
    } else {
      new Notice(`${this.t("common.error")}: ${result.error.message}`, ERROR_NOTICE_DURATION);
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private resolveName(nodeId: string): string {
    const cache = this.plugin?.getComponents().cruidCache;
    return cache?.getName(nodeId) || nodeId;
  }
}

/**
 * 快照 Diff 预览模态框
 */
export class SnapshotDiffModal extends Modal {
  constructor(
    app: App,
    private options: {
      snapshot: SnapshotMetadata;
      snapshotContent: string;
      currentContent: string;
      onRestore: () => Promise<void>;
    }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-snapshot-diff");
    contentEl.addClass("cr-scope");

    contentEl.createEl("h2", {
      text: `快照预览: ${this.options.snapshot.id}`
    });
    contentEl.createEl("p", {
      text: `创建时间：${this.formatTime(this.options.snapshot.created)}`
    });

    const diffContainer = contentEl.createDiv({ cls: "cr-snapshot-diff-panel" });
    renderSideBySideDiff(
      diffContainer,
      this.options.snapshotContent,
      this.options.currentContent,
      "快照版本",
      "当前版本"
    );

    const actions = contentEl.createDiv({ cls: "cr-diff-actions" });

    const restoreBtn = actions.createEl("button", {
      text: "恢复此快照",
      cls: "mod-cta"
    });
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      await this.options.onRestore();
      this.close();
    });

    const closeBtn = actions.createEl("button", {
      text: "关闭"
    });
    closeBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString("zh-CN");
  }
}

