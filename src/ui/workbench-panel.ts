/**
 * WorkbenchPanel - 统一工作台面板
 * 
 * 功能：
 * - 创建概念区域（可折叠）
 * - 重复概念面板（可折叠）
 * - 队列状态区域（可折叠）
 * - 最近操作区域（可折叠）
 * 
 * 遵循设计文档 section 8.5.1 的四区域布局规范
 * Requirements: 5.1
 */

import { ItemView, WorkspaceLeaf, Notice, TFile, App, Modal } from "obsidian";
import type {
  DuplicatePair,
  QueueStatus,
  CRType,
  StandardizedConcept,
  TaskRecord
} from "../types";
import { renderNamingTemplate } from "../core/naming-utils";

import type { TaskQueue } from "../core/task-queue";
import type { PipelineContext, PipelineEvent } from "../core/pipeline-orchestrator";
import type CognitiveRazorPlugin from "../../main";
import { UndoNotification } from "./undo-notification";
import { SimpleDiffView, buildLineDiff } from "./diff-view";

export const WORKBENCH_VIEW_TYPE = "cognitive-razor-workbench";

/**
 * 区域折叠状态
 */
interface SectionCollapseState {
  createConcept: boolean;
  duplicates: boolean;
  queueStatus: boolean;
  recentOps: boolean;
}

/**
 * 重复对排序顺序
 */
type DuplicateSortOrder =
  | "similarity-desc"
  | "similarity-asc"
  | "time-desc"
  | "time-asc"
  | "type";

/**
 * WorkbenchPanel 组件
 * 
 * 实现四区域可折叠布局：
 * 1. 创建概念 - 输入框 + 创建/深化按钮
 * 2. 重复概念 - 重复对列表 + 操作按钮
 * 3. 队列状态 - 运行统计 + 快捷操作
 * 4. 最近操作 - 可撤销操作列表
 * 
 * Requirements: 5.1
 */
export class WorkbenchPanel extends ItemView {
  private conceptInput: HTMLInputElement | null = null;
  private duplicatesContainer: HTMLElement | null = null;
  private queueStatusContainer: HTMLElement | null = null;
  private recentOpsContainer: HTMLElement | null = null;
  private pipelineStatusContainer: HTMLElement | null = null;
  private plugin: CognitiveRazorPlugin | null = null;
  private taskQueue: TaskQueue | null = null;
  private pipelineUnsubscribe: (() => void) | null = null;
  private queueUnsubscribe: (() => void) | null = null;

  // 标准化相关
  private standardizeBtn: HTMLButtonElement | null = null;
  private standardizedResultContainer: HTMLElement | null = null;
  private typeConfidenceTableContainer: HTMLElement | null = null;
  private currentStandardizedData: StandardizedConcept | null = null;
  private currentPipelineId: string | null = null;
  private pipelineContexts: Map<string, PipelineContext> = new Map();
  private pendingConceptInput: string | null = null;

  // 重复对管理相关
  private selectedDuplicates: Set<string> = new Set();
  private currentSortOrder: DuplicateSortOrder = "similarity-desc";
  private currentTypeFilter: CRType | "all" = "all";
  private allDuplicates: DuplicatePair[] = [];

  // 区域折叠状态（默认全部展开）
  private collapseState: SectionCollapseState = {
    createConcept: false,
    duplicates: false,
    queueStatus: false,
    recentOps: false,
  };

  // 区域内容容器引用（用于折叠/展开）
  private sectionContents: Map<keyof SectionCollapseState, HTMLElement> = new Map();

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  /**
   * Helper to resolve i18n keys
   */
  private t(path: string): string {
    if (!this.plugin) return path;
    try {
      const keys = path.split('.');
      let current: any = this.plugin.getI18n().t();
      for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
          current = current[key];
        } else {
          return path;
        }
      }
      return typeof current === 'string' ? current : path;
    } catch (e) {
      return path;
    }
  }

  /**
   * 设置插件引用
   */
  public setPlugin(plugin: CognitiveRazorPlugin): void {
    this.plugin = plugin;
    const components = plugin.getComponents();
    this.taskQueue = components.taskQueue;
  }

  getViewType(): string {
    return WORKBENCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Cognitive Razor 工作台";
  }

  getIcon(): string {
    return "brain";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cr-workbench-panel");
    container.addClass("cr-scope");

    // 主要操作区：创建概念
    this.renderCreateConceptSection(container);

    // 状态概览卡片（紧凑版）
    this.renderStatusOverview(container);

    // 可展开区域：重复概念和历史
    this.renderExpandableSections(container);

    // 订阅管线事件
    this.subscribePipelineEvents();

    // 订阅队列事件（实时更新任务列表）
    this.subscribeQueueEvents();

    // 处理待处理输入
    if (this.pendingConceptInput) {
      const value = this.pendingConceptInput;
      this.pendingConceptInput = null;
      if (this.conceptInput) {
        this.conceptInput.value = value;
      }
      void this.handleStandardize(value);
    }
  }

  /**
   * 渲染状态概览 - 增强版
   * 支持点击展开任务列表、暂停/恢复队列
   */
  private renderStatusOverview(container: HTMLElement): void {
    // 外层容器（包含状态栏和可展开的详情）
    const wrapper = container.createDiv({ cls: "cr-queue-wrapper" });
    
    // 状态栏（一行）
    const statusBar = wrapper.createDiv({ cls: "cr-status-bar" });
    
    // 左侧：状态指示器（可点击展开）
    const queueIndicator = statusBar.createDiv({ cls: "cr-queue-indicator cr-clickable" });
    queueIndicator.setAttribute("role", "button");
    queueIndicator.setAttribute("tabindex", "0");
    queueIndicator.setAttribute("aria-expanded", "false");
    queueIndicator.setAttribute("title", this.t("workbench.queueStatus.viewDetails"));
    
    const statusDot = queueIndicator.createDiv({ cls: "cr-status-dot is-idle" });
    const statusText = queueIndicator.createSpan({ 
      cls: "cr-status-text",
      text: this.t("workbench.queueStatus.noTasks")
    });
    const expandIcon = queueIndicator.createSpan({ cls: "cr-expand-icon", text: "▶" });

    // 中间：快速统计（只显示有值的）
    const stats = statusBar.createDiv({ cls: "cr-quick-stats" });
    this.queueStatusContainer = stats;
    
    // 右侧：暂停/恢复按钮
    const pauseBtn = statusBar.createEl("button", {
      cls: "cr-queue-control-btn",
      attr: { 
        "aria-label": this.t("workbench.queueStatus.pauseQueue"),
        "title": this.t("workbench.queueStatus.pauseQueue")
      }
    });
    pauseBtn.innerHTML = "⏸";
    pauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handleTogglePause();
    });

    // 任务详情容器（默认隐藏，点击展开）
    const detailsContainer = wrapper.createDiv({ cls: "cr-queue-details" });
    detailsContainer.style.display = "none";

    // 点击展开/折叠任务列表
    queueIndicator.addEventListener("click", () => {
      const isExpanded = detailsContainer.style.display !== "none";
      if (isExpanded) {
        detailsContainer.style.display = "none";
        expandIcon.textContent = "▶";
        queueIndicator.setAttribute("aria-expanded", "false");
      } else {
        detailsContainer.style.display = "block";
        expandIcon.textContent = "▼";
        queueIndicator.setAttribute("aria-expanded", "true");
        this.renderQueueDetails(detailsContainer);
      }
    });
    
    // 初始化状态显示
    this.renderQueueStatus({
      paused: false,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    });
  }

  /**
   * 处理暂停/恢复队列
   */
  private async handleTogglePause(): Promise<void> {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const status = taskQueue.getStatus();

    if (status.paused) {
      await taskQueue.resume();
      new Notice(this.t("workbench.queueStatus.queueResumed"));
    } else {
      await taskQueue.pause();
      new Notice(this.t("workbench.queueStatus.queuePaused"));
    }

    // 刷新状态显示
    this.updateQueueStatus(taskQueue.getStatus());
    this.updatePauseButton(taskQueue.getStatus().paused);
  }

  /**
   * 更新暂停按钮状态
   */
  private updatePauseButton(isPaused: boolean): void {
    const pauseBtn = this.containerEl.querySelector(".cr-queue-control-btn") as HTMLButtonElement;
    if (!pauseBtn) return;

    if (isPaused) {
      pauseBtn.innerHTML = "▶";
      pauseBtn.setAttribute("aria-label", this.t("workbench.queueStatus.resumeQueue"));
      pauseBtn.setAttribute("title", this.t("workbench.queueStatus.resumeQueue"));
      pauseBtn.addClass("is-paused");
    } else {
      pauseBtn.innerHTML = "⏸";
      pauseBtn.setAttribute("aria-label", this.t("workbench.queueStatus.pauseQueue"));
      pauseBtn.setAttribute("title", this.t("workbench.queueStatus.pauseQueue"));
      pauseBtn.removeClass("is-paused");
    }
  }

  /**
   * 获取队列详情容器
   */
  private getQueueDetailsContainer(): HTMLElement | null {
    return this.containerEl.querySelector(".cr-queue-details") as HTMLElement | null;
  }

  /**
   * 刷新队列详情（如果已展开）
   */
  private refreshQueueDetailsIfVisible(): void {
    const detailsContainer = this.getQueueDetailsContainer();
    if (detailsContainer && detailsContainer.style.display !== "none") {
      this.renderQueueDetails(detailsContainer);
    }
  }

  /**
   * 渲染可展开区域
   */
  private renderExpandableSections(container: HTMLElement): void {
    const sections = container.createDiv({ cls: "cr-expandable-sections" });

    // 重复概念（默认折叠）
    this.renderCollapsibleSection(
      sections,
      this.t("workbench.duplicates.title"),
      "duplicates",
      (content) => {
        this.duplicatesContainer = content;
        this.renderEmptyDuplicates();
      }
    );

    // 操作历史（默认折叠）
    this.renderCollapsibleSection(
      sections,
      this.t("workbench.recentOps.title"),
      "history",
      (content) => {
        this.recentOpsContainer = content;
        this.refreshRecentOps();
      }
    );
  }

  /**
   * 渲染可折叠区域
   */
  private renderCollapsibleSection(
    container: HTMLElement,
    title: string,
    id: string,
    renderContent: (content: HTMLElement) => void
  ): void {
    const section = container.createDiv({ cls: "cr-collapsible-section" });
    
    const header = section.createDiv({ cls: "cr-section-header" });
    const icon = header.createSpan({ cls: "cr-collapse-icon", text: "▶" });
    header.createEl("h3", { text: title, cls: "cr-section-title" });
    
    const badge = header.createSpan({ cls: "cr-badge", text: "0" });
    badge.style.display = "none";

    const content = section.createDiv({ cls: "cr-section-content cr-collapsed" });

    header.onclick = () => {
      const isCollapsed = content.hasClass("cr-collapsed");
      if (isCollapsed) {
        content.removeClass("cr-collapsed");
        icon.textContent = "▼";
      } else {
        content.addClass("cr-collapsed");
        icon.textContent = "▶";
      }
    };

    renderContent(content);
  }

  async onClose(): Promise<void> {
    // 清理资源
    this.conceptInput = null;
    this.duplicatesContainer = null;
    this.queueStatusContainer = null;
    this.recentOpsContainer = null;
    this.pipelineStatusContainer = null;
    if (this.pipelineUnsubscribe) {
      this.pipelineUnsubscribe();
      this.pipelineUnsubscribe = null;
    }
    if (this.queueUnsubscribe) {
      this.queueUnsubscribe();
      this.queueUnsubscribe = null;
    }
    this.pendingConceptInput = null;
  }
  /**
   * 渲染创建概念区域 - 简化版搜索框
   */
  private renderCreateConceptSection(container: HTMLElement): void {
    const heroContainer = container.createDiv({ cls: "cr-hero-container" });
    const wrapper = heroContainer.createDiv({ cls: "cr-search-wrapper" });

    // Input Field
    this.conceptInput = wrapper.createEl("input", {
      type: "text",
      cls: "cr-hero-input",
      attr: {
        placeholder: this.t("workbench.createConcept.placeholder"),
        "aria-label": this.t("workbench.createConcept.title")
      }
    });

    // Action Button
    this.standardizeBtn = wrapper.createEl("button", {
      cls: "cr-search-action-btn",
      attr: {
        "aria-label": this.t("workbench.createConcept.startButton"),
        "title": `${this.t("workbench.createConcept.standardizing")} (Enter)`
      }
    });
    this.standardizeBtn.innerHTML = `⏎`;

    // Event Listeners
    this.standardizeBtn.addEventListener("click", () => this.handleStandardize());

    this.conceptInput.addEventListener("input", () => {
      const hasValue = this.conceptInput?.value.trim();
      if (this.standardizeBtn) {
        this.standardizeBtn.disabled = !hasValue;
      }
    });

    this.conceptInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && this.conceptInput?.value.trim()) {
        e.preventDefault();
        this.handleStandardize();
      }
    });

    // 结果容器
    this.standardizedResultContainer = container.createDiv({ cls: "cr-standardized-result" });
    this.standardizedResultContainer.style.display = "none";

    this.typeConfidenceTableContainer = container.createDiv({ cls: "cr-type-confidence-table" });
    this.typeConfidenceTableContainer.style.display = "none";
  }

  /**
   * 渲染队列状态 - 紧凑版
   * 只在快速统计区域显示有值的统计项
   */
  private renderQueueStatus(status: QueueStatus): void {
    if (!this.queueStatusContainer) return;

    this.queueStatusContainer.empty();

    // 只显示有值的统计项
    const stats = [
      { label: this.t("workbench.queueStatus.pending"), value: status.pending, cls: "pending" },
      { label: this.t("workbench.queueStatus.running"), value: status.running, cls: "running" },
      { label: this.t("workbench.queueStatus.failed"), value: status.failed, cls: "failed" }
    ];

    stats.forEach(stat => {
      // 只显示有值的项
      if (stat.value > 0) {
        const item = this.queueStatusContainer!.createDiv({ cls: `cr-stat-item cr-stat-${stat.cls}` });
        item.createSpan({ cls: "cr-stat-value", text: stat.value.toString() });
        item.createSpan({ cls: "cr-stat-label", text: stat.label });
      }
    });

    // 更新左侧状态指示器文本
    this.updateStatusIndicator(status);
  }

  /**
   * 更新状态指示器
   */
  private updateStatusIndicator(status: QueueStatus): void {
    const dot = this.containerEl.querySelector(".cr-status-dot");
    const text = this.containerEl.querySelector(".cr-queue-indicator .cr-status-text");
    
    if (!dot || !text) return;

    dot.removeClass("is-idle", "is-running", "is-paused", "is-error");
    
    if (status.failed > 0) {
      dot.addClass("is-error");
      text.textContent = this.t("workbench.queueStatus.failed");
    } else if (status.paused) {
      dot.addClass("is-paused");
      text.textContent = this.t("workbench.queueStatus.paused");
    } else if (status.running > 0) {
      dot.addClass("is-running");
      text.textContent = this.t("workbench.queueStatus.running");
    } else {
      dot.addClass("is-idle");
      text.textContent = this.t("workbench.queueStatus.noTasks");
    }

    // 同步更新暂停按钮状态
    this.updatePauseButton(status.paused);
  }

  /**
   * 渲染重复概念面板 - 简化版列表
   */
  private renderDuplicatesSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-duplicates-section" });

    // Header with refresh button
    const header = section.createDiv({ cls: "cr-duplicates-header" });
    header.createEl("h3", { 
      text: this.t("workbench.duplicates.title"),
      cls: "cr-section-title" 
    });

    const refreshBtn = header.createEl("button", {
      cls: "cr-icon-btn",
      attr: { 
        "aria-label": this.t("workbench.duplicates.refresh") || "Refresh",
        "title": this.t("workbench.duplicates.refresh") || "Refresh"
      }
    });
    refreshBtn.innerHTML = `↺`;
    refreshBtn.onclick = () => this.refreshDuplicates();

    // List Container
    this.duplicatesContainer = section.createDiv({ cls: "cr-duplicates-list" });
    this.renderEmptyDuplicates();
  }


  /**
   * 渲染最近操作区域（可折叠）
   * Requirements: 5.1
   * 
   * 重构说明：整合撤销历史功能
   */
  private renderRecentOpsSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-recent-ops" });

    // Create header with actions
    const header = this.createCollapsibleHeader(
      section,
      this.t("workbench.recentOps.title"),
      "recentOps"
    );

    // Add actions to header
    const actionsContainer = header.createDiv({ cls: "cr-section-header-actions" });

    // Refresh Button
    const refreshBtn = actionsContainer.createEl("button", {
      text: this.t("workbench.recentOps.refresh"),
      cls: "cr-header-btn",
      attr: { "aria-label": this.t("workbench.recentOps.refresh") }
    });
    refreshBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent collapse
      this.refreshRecentOps();
    };

    // Clear All Button
    const clearAllBtn = actionsContainer.createEl("button", {
      text: this.t("workbench.recentOps.clearAll"),
      cls: "cr-header-btn",
      attr: { "aria-label": this.t("workbench.recentOps.clearAll") }
    });
    clearAllBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent collapse
      this.handleClearAllSnapshots();
    };


    // Content Container
    const content = section.createDiv({ cls: "cr-section-content" });
    this.sectionContents.set("recentOps", content);

    if (this.collapseState.recentOps) {
      content.addClass("cr-collapsed");
    }

    // Operation List
    this.recentOpsContainer = content.createDiv({ cls: "cr-recent-ops-list" });
    this.refreshRecentOps();
  }

  /**
   * 创建可折叠标题
   * @param section 区域容器
   * @param title 标题文本
   * @param sectionKey 区域键名
   * @param showBadge 是否显示徽章
   * @returns 标题元素
   */
  private createCollapsibleHeader(
    section: HTMLElement,
    title: string,
    sectionKey: keyof SectionCollapseState,
    showBadge: boolean = false
  ): HTMLElement {
    const header = section.createDiv({ cls: "cr-section-header cr-collapsible-header" });
    header.setAttr("role", "button");
    header.setAttr("tabindex", "0");
    header.setAttr("aria-expanded", String(!this.collapseState[sectionKey]));

    // 折叠图标
    const collapseIcon = header.createEl("span", {
      cls: "cr-collapse-icon",
      attr: { "aria-hidden": "true" }
    });
    collapseIcon.textContent = this.collapseState[sectionKey] ? "▶" : "▼";

    // 标题
    const titleEl = header.createEl("h3", {
      text: title,
      cls: "cr-section-title"
    });

    // 徽章（可选）
    if (showBadge) {
      const badge = header.createEl("span", {
        cls: "cr-badge",
        attr: { "aria-label": `${title}数量` }
      });
      badge.textContent = "0";
    }

    // 点击切换折叠状态
    header.addEventListener("click", (e) => {
      // 防止点击徽章时触发折叠
      if ((e.target as HTMLElement).classList.contains("cr-badge")) {
        return;
      }
      this.toggleSection(sectionKey, collapseIcon);
      header.setAttr("aria-expanded", String(!this.collapseState[sectionKey]));
    });

    // 键盘支持
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggleSection(sectionKey, collapseIcon);
        header.setAttr("aria-expanded", String(!this.collapseState[sectionKey]));
      }
    });

    // 添加可点击样式
    header.addClass("cr-clickable");

    return header;
  }

  /**
   * 切换区域折叠状态
   * @param sectionKey 区域键名
   * @param icon 折叠图标元素
   */
  private toggleSection(
    sectionKey: keyof SectionCollapseState,
    icon: HTMLElement
  ): void {
    // 切换状态
    this.collapseState[sectionKey] = !this.collapseState[sectionKey];

    // 更新图标
    icon.textContent = this.collapseState[sectionKey] ? "▶" : "▼";

    // 更新内容显示
    const content = this.sectionContents.get(sectionKey);
    if (content) {
      if (this.collapseState[sectionKey]) {
        content.addClass("cr-collapsed");
      } else {
        content.removeClass("cr-collapsed");
      }
    }
  }

  /**
   * 处理标准化（直接调用 API，不进入任务队列）
   * Requirements: 5.1
   */
  private async handleStandardize(descriptionOverride?: string): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.systemNotInitialized"));
      return;
    }

    const description = (descriptionOverride ?? this.conceptInput?.value ?? "").trim();
    if (!description) {
      new Notice(this.t("workbench.notifications.enterDescription"));
      return;
    }

    // 确保输入框与传入值同步
    if (this.conceptInput) {
      this.conceptInput.value = description;
    }

    // 禁用按钮并显示加载状态
    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = true;
      this.standardizeBtn.innerHTML = `<div class="cr-loading-spinner" style="width: 16px; height: 16px; border-width: 2px;"></div>`;
    }

    try {
      const components = this.plugin.getComponents();
      const po = components.pipelineOrchestrator;

      // 直接调用标准化 API（不入队）
      const result = await po.standardizeDirect(description);

      if (!result.ok) {
        new Notice(`${this.t("workbench.notifications.standardizeFailed")}: ${result.error.message}`);
        return;
      }

      // 保存标准化结果
      this.currentStandardizedData = result.value;

      // 显示类型置信度表格
      this.renderTypeConfidenceTable(result.value);

      new Notice(this.t("workbench.notifications.standardizeComplete"));
    } catch (error) {
      console.error("标准化失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.standardizeFailed")}: ${errorMessage}`);
    } finally {
      this.resetStandardizeButton();
    }
  }

  /**
   * 从命令入口快速创建概念：复用标准化 → 选择类型流程
   */
  public async startQuickCreate(description: string): Promise<void> {
    const value = description.trim();
    if (!value) {
      new Notice(this.t("workbench.notifications.enterDescription"));
      return;
    }

    this.pendingConceptInput = value;

    // 视图已渲染时直接触发标准化，否则等待 onOpen 消费 pendingConceptInput
    if (this.conceptInput) {
      this.conceptInput.value = value;
      await this.handleStandardize(value);
      this.pendingConceptInput = null;
    }
  }

  /**
   * 重置标准化按钮
   */
  private resetStandardizeButton(): void {
    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = false;
      this.standardizeBtn.innerHTML = `⏎`;
    }
  }

  /**
   * 渲染类型置信度表格 - 优化版
   */
  private renderTypeConfidenceTable(standardizedData: StandardizedConcept): void {
    if (!this.typeConfidenceTableContainer) return;

    this.typeConfidenceTableContainer.empty();
    this.typeConfidenceTableContainer.style.display = "block";

    if (this.standardizedResultContainer) {
      this.standardizedResultContainer.style.display = "none";
    }

    // 标题区域
    const header = this.typeConfidenceTableContainer.createDiv({ cls: "cr-table-header" });
    header.createEl("h4", { 
      text: this.t("workbench.createConcept.selectType")
    });

    // 表格
    const table = this.typeConfidenceTableContainer.createEl("table", { cls: "cr-confidence-table" });

    // 表头
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: this.t("workbench.typeConfidenceTable.type") });
    headerRow.createEl("th", { text: this.t("workbench.typeConfidenceTable.standardName") });
    headerRow.createEl("th", { text: this.t("workbench.typeConfidenceTable.confidence") });
    headerRow.createEl("th", { text: this.t("workbench.typeConfidenceTable.action") });

    // 表体
    const tbody = table.createEl("tbody");

    // 排序类型置信度
    const typeConfidences = Object.entries(standardizedData.typeConfidences)
      .map(([type, confidence]) => ({
        type: type as CRType,
        confidence: confidence as number
      }))
      .sort((a, b) => b.confidence - a.confidence);

    // 渲染行
    typeConfidences.forEach(({ type, confidence }, index) => {
      const row = tbody.createEl("tr", { cls: "cr-confidence-row" });

      // 类型列
      const typeCell = row.createEl("td", { cls: "cr-type-cell" });
      const typeLabel = typeCell.createEl("span", { text: type, cls: "cr-type-name" });
      
      // 高亮最高置信度
      if (index === 0) {
        typeLabel.style.fontWeight = "600";
        typeLabel.style.color = "var(--interactive-accent)";
      }

      // 标准名称列
      const nameCell = row.createEl("td", { cls: "cr-name-cell" });
      const typeName = standardizedData.standardNames[type];
      nameCell.createEl("span", {
        text: `${typeName.chinese} (${typeName.english})`,
        cls: "cr-standard-name"
      });

      // 置信度列
      const confidenceCell = row.createEl("td", { cls: "cr-confidence-cell" });
      const confidenceBar = confidenceCell.createDiv({ cls: "cr-confidence-bar" });
      const confidenceFill = confidenceBar.createDiv({ cls: "cr-confidence-fill" });
      confidenceFill.style.width = `${confidence * 100}%`;
      
      // 根据置信度调整颜色
      if (confidence > 0.8) {
        confidenceFill.style.background = "var(--interactive-accent)";
      } else if (confidence > 0.6) {
        confidenceFill.style.background = "var(--color-orange)";
      } else {
        confidenceFill.style.background = "var(--text-muted)";
      }
      
      confidenceCell.createEl("span", {
        text: `${(confidence * 100).toFixed(0)}%`,
        cls: "cr-confidence-percentage"
      });

      // 操作列
      const actionCell = row.createEl("td", { cls: "cr-action-cell" });
      const createBtn = actionCell.createEl("button", {
        text: this.t("workbench.createConcept.create"),
        cls: index === 0 ? "mod-cta cr-create-btn" : "cr-create-btn",
        attr: { "aria-label": `${this.t("workbench.createConcept.create")} ${type}` }
      });

      createBtn.addEventListener("click", () => {
        this.handleCreateConcept(type, standardizedData);
      });
    });
  }

  /**
   * 处理创建概念
   * Requirements: 5.4
   * 
   * @param selectedType 用户选择的类型
   * @param standardizedData 标准化数据
   */
  private async handleCreateConcept(
    selectedType: CRType,
    standardizedData: StandardizedConcept
  ): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    try {
      const components = this.plugin.getComponents();
      const po = components.pipelineOrchestrator;

      // 使用标准化数据和选择的类型启动创建管线
      const result = po.startCreatePipelineWithStandardized(standardizedData, selectedType);

      if (!result.ok) {
        new Notice(`${this.t("workbench.notifications.createFailed")}: ${result.error.message}`);
        return;
      }

      this.currentPipelineId = result.value;
      new Notice(`${this.t("workbench.notifications.conceptCreated")} (${result.value})`);

      // 隐藏表格并重置输入（任务 10.5）
      this.hideTypeConfidenceTable();
      this.resetConceptInput();
    } catch (error) {
      console.error("创建概念失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.createFailed")}: ${errorMessage}`);
    }
  }

  /**
   * 隐藏类型置信度表格
   * Requirements: 5.6
   */
  private hideTypeConfidenceTable(): void {
    if (this.typeConfidenceTableContainer) {
      this.typeConfidenceTableContainer.style.display = "none";
      this.typeConfidenceTableContainer.empty();
    }
    this.currentStandardizedData = null;
  }

  /**
   * 重置概念输入框
   * Requirements: 5.6
   */
  private resetConceptInput(): void {
    if (this.conceptInput) {
      this.conceptInput.value = "";
      this.conceptInput.focus();
    }
  }

  /**
   * 渲染当前管线的标准化/确认视图
   * 覆盖标准化结果展示、类型歧义选择和写入前预览
   */
  private renderPipelinePreview(): void {
    if (!this.standardizedResultContainer) return;

    const ctx = this.currentPipelineId
      ? this.pipelineContexts.get(this.currentPipelineId)
      : undefined;

    this.standardizedResultContainer.empty();

    if (!ctx) {
      this.standardizedResultContainer.style.display = "none";
      return;
    }

    this.standardizedResultContainer.style.display = "block";

    const stageLabel: Record<PipelineContext["stage"], string> = {
      idle: "空闲",
      standardizing: "标准化",
      enriching: "丰富中",
      embedding: "向量嵌入",
      awaiting_create_confirm: "等待创建确认",
      reasoning: "内容生成",
      grounding: "Ground 校验",
      awaiting_write_confirm: "等待写入确认",
      writing: "写入中",
      deduplicating: "去重中",
      completed: "已完成",
      failed: "失败"
    };

    // 创建管线的过渡界面不再展示，直接交由管线列表与通知处理
    if (ctx.kind === "create") {
      this.standardizedResultContainer.style.display = "none";
      return;
    }

    // 非创建管线：直接提供预览/确认入口
    if (ctx.kind) {
      const summary = this.standardizedResultContainer.createDiv({ cls: "cr-pipeline-summary" });
      summary.createEl("div", { text: `管线类型：${ctx.kind === "incremental" ? "增量改进" : "合并"}` });
      summary.createEl("div", { text: `阶段：${stageLabel[ctx.stage] || ctx.stage}` });
      if (ctx.groundingResult) {
        const ground = summary.createDiv({ cls: "cr-grounding" });
        ground.setAttr("aria-live", "polite");
        ground.createEl("div", { text: this.t("workbench.pipeline.groundingResult"), cls: "cr-muted" });
        ground.createEl("div", { text: `${ctx.groundingResult.overall_assessment ?? "unknown"}` });
      }

      const actions = summary.createDiv({ cls: "cr-pipeline-actions" });
      const previewBtn = actions.createEl("button", {
        text: "预览并确认写入",
        cls: "mod-cta",
        attr: { "aria-label": "预览并确认写入" }
      });
      previewBtn.addEventListener("click", () => {
        this.showWritePreview(ctx);
      });

      return;
    }

    this.standardizedResultContainer.createEl("h4", {
      text: `管线 ${ctx.pipelineId}`
    });
    this.standardizedResultContainer.createEl("div", {
      text: `阶段：${stageLabel[ctx.stage] || ctx.stage}`,
      cls: "cr-pipeline-stage"
    });

    // 标准化结果编辑区
    if (ctx.standardizedData) {
      const form = this.standardizedResultContainer.createDiv({ cls: "cr-standardize-preview" });

      const currentName = ctx.standardizedData.standardNames[ctx.type];

      form.createEl("label", { text: this.t("workbench.pipeline.chineseName") });
      const nameCnInput = form.createEl("input", {
        type: "text",
        value: currentName.chinese,
        cls: "cr-input"
      });

      form.createEl("label", { text: this.t("workbench.pipeline.englishName") });
      const nameEnInput = form.createEl("input", {
        type: "text",
        value: currentName.english,
        cls: "cr-input"
      });

      const typeSelect = form.createEl("select", { cls: "cr-select" });
      const typeOptions = Object.keys(ctx.standardizedData.typeConfidences || {});
      const types = typeOptions.length > 0
        ? typeOptions
        : ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
      typeSelect.createEl("option", { text: this.t("workbench.pipeline.autoSelect"), value: "" });
      types.forEach((type) => {
        typeSelect.createEl("option", { text: type, value: type });
      });
      typeSelect.value = ctx.type || ctx.standardizedData.primaryType || "";

      const saveBtn = form.createEl("button", { text: this.t("workbench.pipeline.saveEdit"), cls: "cr-btn-small" });
      saveBtn.addEventListener("click", async () => {
        const updatedNames = { ...ctx.standardizedData!.standardNames };
        updatedNames[ctx.type] = {
          chinese: nameCnInput.value.trim() || currentName.chinese,
          english: nameEnInput.value.trim() || currentName.english
        };

        await this.applyStandardizationEdits(ctx.pipelineId, {
          standardNames: updatedNames,
          primaryType: typeSelect.value ? typeSelect.value as CRType : undefined
        });
      });

      // 类型置信度显示
      const typeRow = form.createDiv({ cls: "cr-type-confidences" });
      const sortedTypes = Object.entries(ctx.standardizedData.typeConfidences || {})
        .sort(([, a], [, b]) => b - a);
      if (sortedTypes.length > 0) {
        sortedTypes.forEach(([type, score]) => {
          const pill = typeRow.createDiv({ cls: "cr-type-item" });
          pill.createSpan({ text: type });
          pill.createSpan({ text: `${(score * 100).toFixed(1)}%`, cls: "cr-type-confidence" });
        });
      }
    }

    // 内容预览（生成后）
    if (ctx.generatedContent) {
      const preview = this.standardizedResultContainer.createDiv({ cls: "cr-generated-preview" });
      preview.createEl("h5", { text: this.t("workbench.pipeline.generatedContentPreview") });
      const text = typeof ctx.generatedContent === "string"
        ? ctx.generatedContent
        : JSON.stringify(ctx.generatedContent, null, 2);
      preview.createEl("pre", { text });
    }

    const actions = this.standardizedResultContainer.createDiv({ cls: "cr-button-container" });

    if (ctx.stage === "awaiting_create_confirm") {
      const confirmBtn = actions.createEl("button", { text: this.t("workbench.pipeline.confirmCreate"), cls: "mod-cta cr-btn-small" });
      confirmBtn.addEventListener("click", async () => {
        const po = this.plugin?.getComponents().pipelineOrchestrator;
        if (!po) return;
        const result = await po.confirmCreate(ctx.pipelineId);
        if (!result.ok) {
          new Notice(`${this.t("workbench.notifications.confirmCreateFailed")}: ${result.error.message}`);
        } else {
          new Notice(this.t("workbench.notifications.confirmCreateWaiting"));
        }
      });
    } else if (ctx.stage === "awaiting_write_confirm") {
      const previewBtn = actions.createEl("button", { text: this.t("workbench.pipeline.previewWrite"), cls: "mod-cta cr-btn-small" });
      previewBtn.addEventListener("click", () => this.showWritePreview(ctx));
    } else if (ctx.stage === "failed" && ctx.error) {
      actions.createEl("div", {
        text: `${this.t("workbench.queueStatus.failed")}: ${ctx.error.message}`,
        cls: "cr-error-text"
      });
    } else if (ctx.stage === "completed") {
      if (ctx.snapshotId) {
        const undoBtn = actions.createEl("button", { text: this.t("workbench.recentOps.undo"), cls: "cr-btn-small" });
        undoBtn.addEventListener("click", () => this.handleUndo(ctx.snapshotId!));
        actions.createEl("span", { text: `Snapshot: ${ctx.snapshotId}`, cls: "cr-muted" });
      } else {
        actions.createEl("span", { text: this.t("workbench.queueStatus.completed"), cls: "cr-muted" });
      }
    }
  }

  /**
   * 更新标准化结果（用户编辑）
   */
  private async applyStandardizationEdits(
    pipelineId: string,
    updates: Partial<PipelineContext["standardizedData"]>
  ): Promise<void> {
    if (!this.plugin) return;
    const po = this.plugin.getComponents().pipelineOrchestrator;
    const result = po.updateStandardizedData(pipelineId, updates);
    if (result.ok) {
      new Notice(this.t("workbench.notifications.standardizeUpdated"));
      this.renderPipelinePreview();
    } else {
      new Notice(`${this.t("common.error")}: ${result.error.message}`);
    }
  }

  /**
   * 写入前预览（Diff + 撤销提示）
   */
  private async showWritePreview(ctx: PipelineContext): Promise<void> {
    if (!this.plugin) return;
    const po = this.plugin.getComponents().pipelineOrchestrator;
    const preview = await po.buildWritePreview(ctx.pipelineId);
    if (!preview.ok) {
      new Notice(`${this.t("workbench.notifications.writePreviewFailed")}: ${preview.error.message}`);
      return;
    }

    const { previousContent, newContent, targetPath } = preview.value;
    const diffView = new SimpleDiffView(
      this.app,
      `${this.t("workbench.pipeline.previewWrite")}: ${targetPath}`,
      previousContent,
      newContent,
      async () => {
        const result = await po.confirmWrite(ctx.pipelineId);
        if (!result.ok) {
          new Notice(`${this.t("workbench.notifications.writeFailed")}: ${result.error.message}`);
        } else {
          new Notice(this.t("workbench.notifications.writeSuccess"));
        }
      },
      () => {
        new Notice(this.t("workbench.notifications.mergeCancelled"));
      }
    );

    diffView.open();
  }

  /**
   * 更新重复概念列表
   */
  public updateDuplicates(duplicates: DuplicatePair[]): void {
    if (!this.duplicatesContainer) return;

    // 保存原始数据
    this.allDuplicates = duplicates;

    // 应用筛选
    let filteredDuplicates = duplicates;
    if (this.currentTypeFilter !== "all") {
      filteredDuplicates = duplicates.filter(pair => pair.type === this.currentTypeFilter);
    }

    // 应用排序
    const sortedDuplicates = this.sortDuplicates(filteredDuplicates);

    this.duplicatesContainer.empty();

    // 更新徽章数量
    const badge = this.containerEl.querySelector(".cr-duplicates-header .cr-badge");
    if (badge) {
      badge.textContent = sortedDuplicates.length.toString();
    }

    if (sortedDuplicates.length === 0) {
      this.renderEmptyDuplicates();
      return;
    }

    // 渲染重复对列表
    const list = this.duplicatesContainer.createDiv({ cls: "cr-duplicates-list-inner" });

    sortedDuplicates.forEach(pair => {
      this.renderDuplicateItem(list, pair);
    });
  }

  /**
   * 渲染单个重复对项目
   */
  private renderDuplicateItem(container: HTMLElement, pair: DuplicatePair): void {
    const item = container.createDiv({ cls: "cr-duplicate-item" });

    // Checkbox
    const checkboxWrapper = item.createDiv({ cls: "cr-checkbox-wrapper" });
    const checkbox = checkboxWrapper.createEl("input", {
      type: "checkbox",
      cls: "cr-duplicate-checkbox"
    });
    // 检查是否已选中
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

    // Status Bar (Similarity)
    const statusBar = item.createDiv({ cls: "cr-duplicate-status-bar" });
    const fill = statusBar.createDiv({ cls: "cr-status-fill" });
    fill.style.width = `${pair.similarity * 100}%`;
    // Color based on similarity
    if (pair.similarity > 0.9) fill.style.backgroundColor = "var(--color-red)";
    else if (pair.similarity > 0.8) fill.style.backgroundColor = "var(--color-orange)";
    else fill.style.backgroundColor = "var(--color-yellow)";

    // Content
    const content = item.createDiv({ cls: "cr-duplicate-content" });

    // Header (Notes)
    const header = content.createDiv({ cls: "cr-duplicate-header" });
    header.createDiv({ cls: "cr-duplicate-note", text: pair.noteA.name });
    header.createDiv({ cls: "cr-duplicate-arrow", text: "↔" });
    header.createDiv({ cls: "cr-duplicate-note", text: pair.noteB.name });

    // Metadata
    const meta = content.createDiv({ cls: "cr-duplicate-meta" });
    meta.createSpan({ cls: "cr-meta-tag", text: pair.type });
    meta.createSpan({ cls: "cr-meta-text", text: `${(pair.similarity * 100).toFixed(0)}%` });

    // Actions (Hover)
    const actions = item.createDiv({ cls: "cr-duplicate-actions" });

    const mergeBtn = actions.createEl("button", {
      cls: "cr-icon-btn",
      attr: { "aria-label": this.t("workbench.duplicates.merge") }
    });
    mergeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 9l3 3-3 3"></path><line x1="15" y1="4" x2="15" y2="20"></line></svg>`;
    mergeBtn.onclick = (e) => { e.stopPropagation(); this.handleMergeDuplicate(pair); };

    const dismissBtn = actions.createEl("button", {
      cls: "cr-icon-btn",
      attr: { "aria-label": this.t("workbench.duplicates.dismiss") }
    });
    dismissBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    dismissBtn.onclick = (e) => { e.stopPropagation(); this.handleDismissDuplicate(pair); };

    // Click to preview
    item.onclick = (e) => {
      // Avoid triggering if clicking checkbox or buttons
      if (e.target === checkbox || actions.contains(e.target as Node)) return;
      this.handleShowDuplicatePreview(pair);
    };

    // Hover effect
    item.addEventListener("mouseenter", () => { actions.style.opacity = "1"; });
    item.addEventListener("mouseleave", () => { actions.style.opacity = "0"; });
  }

  /**
   * 排序重复对
   */
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

  /**
   * 全选/取消全选
   */
  private handleSelectAll(): void {
    if (!this.duplicatesContainer) return;

    const checkboxes = this.duplicatesContainer.querySelectorAll<HTMLInputElement>(".cr-duplicate-checkbox");
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);

    checkboxes.forEach(cb => {
      cb.checked = !allChecked;
      const pairId = this.allDuplicates.find(p =>
        cb.parentElement?.textContent?.includes(p.noteA.name) &&
        cb.parentElement?.textContent?.includes(p.noteB.name)
      )?.id;

      if (pairId) {
        if (!allChecked) {
          this.selectedDuplicates.add(pairId);
        } else {
          this.selectedDuplicates.delete(pairId);
        }
      }
    });
  }

  /**
   * 批量合并（已弃用）
   */
  private async handleBatchMerge(): Promise<void> {
    new Notice("合并功能已被弃用");
  }

  /**
   * 批量忽略
   */
  private async handleBatchDismiss(): Promise<void> {
    if (this.selectedDuplicates.size === 0) {
      new Notice(this.t("workbench.notifications.selectDuplicates"));
      return;
    }

    const count = this.selectedDuplicates.size;
    const confirmed = await this.showConfirmDialog(
      this.t("workbench.duplicates.batchDismiss"),
      `${this.t("workbench.notifications.batchDismissConfirm")} (${count})`
    );

    if (!confirmed) return;

    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) {
      new Notice(this.t("workbench.notifications.duplicateManagerNotInitialized"));
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const pairId of this.selectedDuplicates) {
      const result = await duplicateManager.updateStatus(pairId, "dismissed");
      if (result.ok) {
        successCount++;
      } else {
        failCount++;
      }
    }

    new Notice(`${this.t("workbench.notifications.batchDismissComplete")}: ${successCount} / ${failCount}`);
    this.selectedDuplicates.clear();
    this.refreshDuplicates();
  }

  /**
   * 查看合并历史
   */
  private handleViewMergeHistory(): void {
    const modal = new MergeHistoryModal(this.app, this.plugin);
    modal.open();
  }

  /**
   * 显示确认对话框
   */
  private showConfirmDialog(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmDialog(this.app, title, message, resolve);
      modal.open();
    });
  }

  /**
   * 显示重复对预览
   */
  private async handleShowDuplicatePreview(pair: DuplicatePair): Promise<void> {
    try {
      // 读取两个笔记的内容
      const fileA = this.app.vault.getAbstractFileByPath(pair.noteA.path);
      const fileB = this.app.vault.getAbstractFileByPath(pair.noteB.path);

      if (!fileA || !(fileA instanceof TFile)) {
        new Notice(`${this.t("workbench.notifications.fileNotFound")}: ${pair.noteA.path}`);
        return;
      }

      if (!fileB || !(fileB instanceof TFile)) {
        new Notice(`${this.t("workbench.notifications.fileNotFound")}: ${pair.noteB.path}`);
        return;
      }

      const contentA = await this.app.vault.read(fileA);
      const contentB = await this.app.vault.read(fileB);

      // 创建预览模态框
      this.showDuplicatePreviewModal(pair, contentA, contentB);
    } catch (error) {
      console.error("显示预览失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.previewFailed")}: ${errorMessage}`);
    }
  }

  /**
   * 显示重复对预览模态框
   */
  private showDuplicatePreviewModal(
    pair: DuplicatePair,
    contentA: string,
    contentB: string
  ): void {
    const modal = new DuplicatePreviewModal(
      this.app,
      pair,
      contentA,
      contentB,
      () => this.handleMergeDuplicate(pair),
      () => this.handleDismissDuplicate(pair)
    );
    modal.open();
  }

  /**
   * 渲染空重复列表
   */
  private renderEmptyDuplicates(): void {
    if (!this.duplicatesContainer) return;

    this.duplicatesContainer.createEl("div", {
      text: this.t("workbench.duplicates.empty"),
      cls: "cr-empty-state"
    });
  }

  /**
   * 更新队列状态
   */
  public updateQueueStatus(status: QueueStatus): void {
    this.renderQueueStatus(status);
  }

  /**


  /**
   * 渲染空最近操作
   */
  private renderEmptyRecentOps(): void {
    if (!this.recentOpsContainer) return;

    this.recentOpsContainer.createEl("div", {
      text: this.t("workbench.recentOps.empty"),
      cls: "cr-empty-state"
    });
  }

  /**
   * 刷新操作历史
   * 整合撤销历史视图的功能
   */
  private async refreshRecentOps(): Promise<void> {
    if (!this.recentOpsContainer || !this.plugin) return;

    this.recentOpsContainer.empty();

    const undoManager = this.plugin.getComponents().undoManager;
    const result = await undoManager.listSnapshots();

    if (!result.ok || result.value.length === 0) {
      this.renderEmptyRecentOps();
      return;
    }

    // 按时间排序（最新的在前）
    const snapshots = result.value.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );

    // 只显示最近 10 个
    const recentSnapshots = snapshots.slice(0, 10);

    recentSnapshots.forEach(snapshot => {
      const item = this.recentOpsContainer!.createDiv({ cls: "cr-recent-op-item" });

      const info = item.createDiv({ cls: "cr-op-info" });

      // 操作描述
      const description = `${this.getOperationDisplayName(snapshot.taskId)}: ${snapshot.path.split("/").pop()}`;
      info.createEl("div", { text: description, cls: "cr-op-description" });

      // 时间
      info.createEl("div", { text: this.formatTime(snapshot.created), cls: "cr-op-time" });

      // 撤销按钮
      const undoBtn = item.createEl("button", {
        text: this.t("workbench.recentOps.undo"),
        cls: "cr-undo-btn cr-btn-small",
        attr: { "aria-label": `${this.t("workbench.recentOps.undo")}: ${description}` }
      });
      undoBtn.addEventListener("click", async () => {
        await this.handleUndoSnapshot(snapshot.id);
      });
    });

    // 如果有更多快照，显示提示
    if (snapshots.length > 10) {
      const moreHint = this.recentOpsContainer.createDiv({ cls: "cr-more-hint" });
      const moreCount = snapshots.length - 10;
      moreHint.textContent = this.t("workbench.recentOps.moreSnapshots").replace("{count}", String(moreCount));
    }
  }

  /**
   * 获取操作显示名称
   */
  private getOperationDisplayName(taskId: string): string {
    const operationNames: Record<string, string> = {
      enrich: "内容生成",
      merge: "合并笔记",
      "incremental-improve": "增量改进",
      "manual-edit": "手动编辑",
      standardize: "标准化",
      create: "创建笔记",
    };

    // 尝试从 taskId 中提取操作类型
    for (const [key, name] of Object.entries(operationNames)) {
      if (taskId.includes(key)) {
        return name;
      }
    }

    return "操作";
  }

  /**
   * 处理撤销快照
   */
  private async handleUndoSnapshot(snapshotId: string): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const undoManager = this.plugin.getComponents().undoManager;

    try {
      // 恢复快照
      const restoreResult = await undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        new Notice(`${this.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      // 写入文件
      const file = this.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, snapshot.content);
        new Notice(this.t("workbench.notifications.undoSuccess"));
      } else {
        // 文件不存在，创建文件
        await this.app.vault.create(snapshot.path, snapshot.content);
        new Notice(this.t("workbench.notifications.undoSuccessRestored"));
      }

      // 删除快照
      await undoManager.deleteSnapshot(snapshotId);

      // 刷新列表
      await this.refreshRecentOps();
    } catch (error) {
      console.error("撤销操作失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.undoFailed")}: ${errorMessage}`);
    }
  }

  /**
   * 处理清空所有快照
   */
  private async handleClearAllSnapshots(): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const confirmed = await this.showConfirmDialog(
      this.t("workbench.recentOps.clearAllConfirmTitle"),
      this.t("workbench.recentOps.clearAllConfirmMessage")
    );

    if (!confirmed) return;

    const undoManager = this.plugin.getComponents().undoManager;
    const result = await undoManager.clearAllSnapshots();

    if (result.ok) {
      new Notice(`${this.t("workbench.notifications.clearComplete")} (${result.value})`);
      await this.refreshRecentOps();
    } else {
      new Notice(`${this.t("common.error")}: ${result.error.message}`);
    }
  }

  /**
   * 更新最近操作列表
   */
  public updateRecentOps(operations: RecentOperation[]): void {
    if (!this.recentOpsContainer) return;

    this.recentOpsContainer.empty();

    if (operations.length === 0) {
      this.renderEmptyRecentOps();
      return;
    }

    operations.forEach(op => {
      const item = this.recentOpsContainer!.createDiv({ cls: "cr-recent-op-item" });

      const info = item.createDiv({ cls: "cr-op-info" });
      info.createEl("div", { text: op.description, cls: "cr-op-description" });
      info.createEl("div", { text: this.formatTime(op.timestamp), cls: "cr-op-time" });

      if (op.canUndo) {
        const undoBtn = item.createEl("button", {
          text: this.t("workbench.recentOps.undo"),
          cls: "cr-undo-btn",
          attr: { "aria-label": `${this.t("workbench.recentOps.undo")}: ${op.description}` }
        });
        undoBtn.addEventListener("click", () => {
          this.handleUndo(op.id);
        });
      }
    });
  }

  /**
   * 格式化时间
   */
  private formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return this.t("workbench.recentOps.timeJustNow");
    if (minutes < 60) return this.t("workbench.recentOps.timeMinutesAgo").replace("{minutes}", String(minutes));

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.t("workbench.recentOps.timeHoursAgo").replace("{hours}", String(hours));

    const days = Math.floor(hours / 24);
    return this.t("workbench.recentOps.timeDaysAgo").replace("{days}", String(days));
  }

  /**
   * 显示撤销 Toast 通知
   * 写入完成后显示 5 秒可撤销提示
   * Requirements: 5.4
   * 
   * @param message 通知消息
   * @param snapshotId 快照 ID
   * @param filePath 文件路径
   */
  public showUndoToast(
    message: string,
    snapshotId: string,
    filePath: string
  ): void {
    if (!this.plugin) {
      return;
    }

    const undoManager = this.plugin.getComponents().undoManager;

    const notification = new UndoNotification({
      message,
      snapshotId,
      filePath,
      onUndo: async (id: string) => {
        await this.handleUndoFromToast(id);
      },
      timeout: 5000, // 5 秒超时
    });

    notification.show();
  }

  /**
   * 处理来自 Toast 的撤销操作
   * @param snapshotId 快照 ID
   */
  private async handleUndoFromToast(snapshotId: string): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const undoManager = this.plugin.getComponents().undoManager;

    try {
      // 恢复快照
      const restoreResult = await undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        new Notice(`${this.t("workbench.notifications.undoFailed")}: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      // 写入文件
      const file = this.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, snapshot.content);
        new Notice(this.t("workbench.notifications.undoSuccess"));
      } else {
        // 文件不存在，创建文件
        await this.app.vault.create(snapshot.path, snapshot.content);
        new Notice(this.t("workbench.notifications.undoSuccessRestored"));
      }

      // 删除快照
      await undoManager.deleteSnapshot(snapshotId);

      // 刷新操作历史列表
      await this.refreshRecentOps();
    } catch (error) {
      console.error("撤销操作失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.undoFailed")}: ${errorMessage}`);
    }
  }

  /**
   * 处理合并重复概念
   * 点击合并时先显示 DiffView 预览
   * Requirements: 5.3
   */
  private async handleMergeDuplicate(pair: DuplicatePair): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    try {
      // 读取两个笔记的内容
      const fileA = this.app.vault.getAbstractFileByPath(pair.noteA.path);
      const fileB = this.app.vault.getAbstractFileByPath(pair.noteB.path);

      if (!fileA || !(fileA instanceof TFile)) {
        new Notice(`${this.t("workbench.notifications.fileNotFound")}: ${pair.noteA.path}`);
        return;
      }

      if (!fileB || !(fileB instanceof TFile)) {
        new Notice(`${this.t("workbench.notifications.fileNotFound")}: ${pair.noteB.path}`);
        return;
      }

      const contentA = await this.app.vault.read(fileA);
      const contentB = await this.app.vault.read(fileB);

      // 显示合并预览 DiffView
      this.showMergePreviewDiffView(pair, contentA, contentB);
    } catch (error) {
      console.error("显示合并预览失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.previewFailed")}: ${errorMessage}`);
    }
  }

  /**
   * 显示合并预览 DiffView
   * Requirements: 5.3
   */
  private showMergePreviewDiffView(
    pair: DuplicatePair,
    contentA: string,
    contentB: string
  ): void {
    const diffView = new SimpleDiffView(
      this.app,
      `${this.t("workbench.duplicates.merge")}: ${pair.noteA.name} ↔ ${pair.noteB.name}`,
      contentA,
      contentB,
      async () => {
        // 用户确认合并 - 创建合并任务
        await this.confirmMerge(pair);
      },
      () => {
        // 用户取消合并
        new Notice(this.t("workbench.notifications.mergeCancelled"));
      }
    );

    diffView.open();
  }

  /**
   * 确认合并（已弃用）
   */
  private async confirmMerge(pair: DuplicatePair): Promise<void> {
    new Notice("合并功能已被弃用");
  }

  /**
   * 处理忽略重复概念
   */
  private async handleDismissDuplicate(pair: DuplicatePair): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    try {
      // 获取 DuplicateManager
      const components = this.plugin.getComponents();
      const duplicateManager = components.duplicateManager;

      if (!duplicateManager) {
        new Notice(this.t("workbench.notifications.duplicateManagerNotInitialized"));
        return;
      }

      // 更新状态为 dismissed
      const result = await duplicateManager.updateStatus(pair.id, "dismissed");

      if (!result.ok) {
        new Notice(`${this.t("workbench.notifications.dismissFailed")}: ${result.error.message}`);
        return;
      }

      new Notice(`${this.t("workbench.notifications.dismissSuccess")}: ${pair.noteA.name} ↔ ${pair.noteB.name}`);

      // 刷新重复列表
      this.refreshDuplicates();
    } catch (error) {
      console.error("忽略重复对失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`${this.t("workbench.notifications.dismissFailed")}: ${errorMessage}`);
    }
  }

  /**
   * 刷新重复列表
   */
  private refreshDuplicates(): void {
    if (!this.plugin) return;

    try {
      const components = this.plugin.getComponents();
      const duplicateManager = components.duplicateManager;

      if (!duplicateManager) return;

      // 获取待处理的重复对（同步方法）
      const pairs = duplicateManager.getPendingPairs();
      this.updateDuplicates(pairs);
    } catch (error) {
      console.error("刷新重复列表失败:", error);
    }
  }

  /**
   * 处理切换队列状态
   */
  private async handleToggleQueue(): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const taskQueue = this.plugin.getComponents().taskQueue;
    const status = taskQueue.getStatus();

    if (status.paused) {
      await taskQueue.resume();
      new Notice(this.t("workbench.notifications.queueResumed"));
    } else {
      await taskQueue.pause();
      new Notice(this.t("workbench.notifications.queuePaused"));
    }

    // 刷新显示
    this.updateQueueStatus(taskQueue.getStatus());
  }

  /**
  * 订阅管线事件
  * 遵循 A-UCD-03：写入完成后显示撤销入口
  */
  private subscribePipelineEvents(): void {
    if (!this.plugin) return;
    const po = this.plugin.getComponents().pipelineOrchestrator;
    if (!po) return;

    // 先渲染当前活跃管线
    this.updatePipelineContexts(po.getActivePipelines());

    // 注册订阅
    this.pipelineUnsubscribe = po.subscribe((event) => {
      // A-UCD-03: 写入完成后显示撤销通知
      if (event.type === "pipeline_completed" && event.context.snapshotId && event.context.filePath) {
        const kindLabel = event.context.kind === "create" ? "创建"
          : event.context.kind === "incremental" ? "增量改进"
            : "合并";
        this.showUndoToast(
          `${kindLabel}完成: ${event.context.filePath.split("/").pop()}`,
          event.context.snapshotId,
          event.context.filePath
        );
      }
      
      // 管线失败时显示错误通知
      if (event.type === "pipeline_failed" && event.context.error) {
        new Notice(event.context.error.message, 8000); // 显示8秒
      }
      
      this.updatePipelineContexts(po.getActivePipelines());
    });
  }

  /**
   * 更新管线列表（用于订阅 PipelineOrchestrator 事件）
   */
  public updatePipelineContexts(contexts: PipelineContext[]): void {
    if (!this.pipelineStatusContainer) return;
    const list = this.pipelineStatusContainer.querySelector(".cr-pipeline-list");
    if (!list) return;

    const stageLabel: Record<PipelineContext["stage"], string> = {
      idle: "空闲",
      standardizing: "标准化",
      enriching: "丰富中",
      embedding: "向量嵌入",
      awaiting_create_confirm: "等待创建确认",
      reasoning: "内容生成",
      grounding: "Ground 校验",
      awaiting_write_confirm: "等待写入确认",
      writing: "写入中",
      deduplicating: "去重中",
      completed: "已完成",
      failed: "失败"
    };

    this.pipelineContexts = new Map(contexts.map((c) => [c.pipelineId, c]));

    // 维持当前选中的管线
    if (!this.currentPipelineId && contexts.length > 0) {
      this.currentPipelineId = contexts[0].pipelineId;
    }
    if (this.currentPipelineId && !this.pipelineContexts.has(this.currentPipelineId)) {
      this.currentPipelineId = contexts[0]?.pipelineId ?? null;
    }

    list.empty();

    if (contexts.length === 0) {
      list.createEl("div", { text: this.t("workbench.queueStatus.noPipeline"), cls: "cr-empty-text" });
      this.currentPipelineId = null;
      this.renderPipelinePreview();
      return;
    }

    contexts.forEach((ctx) => {
      const item = list.createDiv({ cls: "cr-pipeline-item" });
      item.createEl("div", { text: `${this.t("workbench.pipeline.id")}: ${ctx.pipelineId}`, cls: "cr-pipeline-id" });
      item.createEl("div", { text: `${this.t("workbench.pipeline.type")}: ${ctx.type}`, cls: "cr-pipeline-type" });
      item.createEl("div", { text: `${this.t("workbench.pipeline.stage")}: ${stageLabel[ctx.stage] || ctx.stage}`, cls: "cr-pipeline-stage" });

      const actions = item.createDiv({ cls: "cr-pipeline-actions" });
      const viewBtn = actions.createEl("button", { text: this.t("workbench.pipeline.view"), cls: "cr-btn-small" });
      viewBtn.addEventListener("click", () => {
        this.currentPipelineId = ctx.pipelineId;
        this.renderPipelinePreview();
      });

      if (ctx.stage === "awaiting_create_confirm") {
        const btn = actions.createEl("button", { text: this.t("workbench.pipeline.confirmCreate"), cls: "mod-cta cr-btn-small" });
        btn.addEventListener("click", async () => {
          const po = this.plugin?.getComponents().pipelineOrchestrator;
          if (!po) return;
          const result = await po.confirmCreate(ctx.pipelineId);
          if (!result.ok) {
            new Notice(`${this.t("workbench.notifications.confirmCreateFailed")}: ${result.error.message}`);
          }
        });
      } else if (ctx.stage === "awaiting_write_confirm") {
        const btn = actions.createEl("button", { text: this.t("workbench.pipeline.previewWrite"), cls: "mod-cta cr-btn-small" });
        btn.addEventListener("click", () => this.showWritePreview(ctx));
      } else if (ctx.stage === "failed" && ctx.error) {
        actions.createEl("span", { text: ctx.error.message, cls: "cr-error-text" });
      }
    });

    this.renderPipelinePreview();
  }

  /**
   * 订阅队列事件（实时更新任务列表）
   */
  private subscribeQueueEvents(): void {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    this.queueUnsubscribe = taskQueue.subscribe(() => {
      // 更新状态栏
      this.updateQueueStatus(taskQueue.getStatus());
      // 刷新详情（如果已展开）
      this.refreshQueueDetailsIfVisible();
    });
  }

  /**
   * 从任务中提取显示名称
   * 优先使用标准化数据生成标准笔记名，其次从 filePath 解析
   */
  private getTaskDisplayName(task: TaskRecord): string {
    const payload = task.payload as Record<string, unknown>;
    const settings = this.plugin?.settings;
    const namingTemplate = settings?.namingTemplate || "{{chinese}} ({{english}})";
    
    // 优先使用标准化数据生成标准笔记名
    const standardizedData = payload?.standardizedData as StandardizedConcept | undefined;
    const conceptType = (payload?.conceptType as CRType) || standardizedData?.primaryType;
    
    if (standardizedData?.standardNames && conceptType) {
      const nameData = standardizedData.standardNames[conceptType];
      if (nameData?.chinese || nameData?.english) {
        const standardName = renderNamingTemplate(namingTemplate, {
          chinese: nameData.chinese || "",
          english: nameData.english || "",
          type: conceptType
        });
        // 截断过长的名称
        return standardName.length > 30 ? standardName.substring(0, 30) + "..." : standardName;
      }
    }
    
    // 其次从 filePath 解析笔记名
    if (payload?.filePath && typeof payload.filePath === "string") {
      const filePath = payload.filePath;
      // 提取文件名（不含扩展名）
      const fileName = filePath.split("/").pop() || filePath;
      const noteName = fileName.replace(/\.md$/, "");
      return noteName.length > 30 ? noteName.substring(0, 30) + "..." : noteName;
    }
    
    // 再次使用 userInput
    if (payload?.userInput && typeof payload.userInput === "string") {
      const input = payload.userInput;
      return input.length > 20 ? input.substring(0, 20) + "..." : input;
    }
    
    // 最后使用任务 ID 的前 8 位
    return task.id.substring(0, 8);
  }

  /**
   * 渲染队列详情（内联）
   * Requirements: 7.2
   * 
   * @param container 详情容器
   */
  private renderQueueDetails(container: HTMLElement): void {
    if (!this.plugin) return;

    container.empty();

    const taskQueue = this.plugin.getComponents().taskQueue;
    const allTasks = taskQueue.getAllTasks();

    if (allTasks.length === 0) {
      container.createEl("p", {
        text: this.t("workbench.queueStatus.noTasks"),
        cls: "cr-empty-state"
      });
      return;
    }

    // 创建任务列表表格
    const table = container.createEl("table", { cls: "cr-queue-details-table" });

    // 表头
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.noteName") }); // 笔记名
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.type") });
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.status") });
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.actions") });

    // 表体
    const tbody = table.createEl("tbody");

    // 按时间倒序排列（最新的在前）
    const sortedTasks = [...allTasks].sort((a, b) => 
      new Date(b.created).getTime() - new Date(a.created).getTime()
    );

    sortedTasks.forEach(task => {
      const row = tbody.createEl("tr", { cls: `cr-task-row cr-task-${task.state.toLowerCase()}` });

      // 概念名称
      const nameCell = row.createEl("td", { cls: "cr-task-name" });
      nameCell.createSpan({
        text: this.getTaskDisplayName(task),
        attr: { title: (task.payload as Record<string, unknown>)?.userInput as string || task.id }
      });

      // 任务类型
      row.createEl("td", {
        text: task.taskType,
        cls: "cr-task-type"
      });

      // 状态
      const statusCell = row.createEl("td", { cls: "cr-task-status" });
      statusCell.createEl("span", {
        cls: `cr-status-badge cr-status-${task.state.toLowerCase()}`,
        text: this.getStatusLabel(task.state)
      });

      // 操作按钮
      const actionCell = row.createEl("td", { cls: "cr-task-actions" });

      if (task.state === "Pending") {
        const cancelBtn = actionCell.createEl("button", {
          text: this.t("workbench.queueStatus.cancel"),
          cls: "cr-btn-small",
          attr: { "aria-label": `${this.t("workbench.queueStatus.cancel")}` }
        });
        cancelBtn.addEventListener("click", () => {
          this.handleCancelTask(task.id);
        });
      } else if (task.state === "Failed") {
        if (task.errors && task.errors.length > 0) {
          const lastError = task.errors[task.errors.length - 1];
          actionCell.createEl("span", {
            text: "⚠",
            cls: "cr-error-icon",
            attr: { title: lastError.message }
          });
        }
      } else if (task.state === "Completed") {
        actionCell.createEl("span", {
          text: "✓",
          cls: "cr-success-icon"
        });
      }
    });

    // 批量操作按钮
    const batchActions = container.createDiv({ cls: "cr-queue-batch-actions" });

    const retryFailedBtn = batchActions.createEl("button", {
      text: this.t("workbench.queueStatus.retryFailed"),
      cls: "cr-btn-small mod-cta",
      attr: { "aria-label": this.t("workbench.queueStatus.retryFailed") }
    });
    retryFailedBtn.addEventListener("click", () => {
      this.handleRetryFailed();
    });

    const clearCompletedBtn = batchActions.createEl("button", {
      text: this.t("workbench.queueStatus.clearCompleted"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.t("workbench.queueStatus.clearCompleted") }
    });
    clearCompletedBtn.addEventListener("click", () => {
      this.handleClearCompleted();
    });

    const clearFailedBtn = batchActions.createEl("button", {
      text: this.t("workbench.queueStatus.clearFailed"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.t("workbench.queueStatus.clearFailed") }
    });
    clearFailedBtn.addEventListener("click", () => {
      this.handleClearFailed();
    });
  }

  /**
   * 获取状态标签
   */
  private getStatusLabel(state: string): string {
    const labels: Record<string, string> = {
      Pending: this.t("workbench.queueStatus.pending"),
      Running: this.t("workbench.queueStatus.running"),
      Completed: this.t("workbench.queueStatus.completed"),
      Failed: this.t("workbench.queueStatus.failed"),
      Cancelled: this.t("workbench.queueStatus.cancelled")
    };
    return labels[state] || state;
  }

  /**
   * 处理取消任务
   */
  private handleCancelTask(taskId: string): void {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const result = taskQueue.cancel(taskId);

    if (result.ok) {
      new Notice(this.t("workbench.notifications.taskCancelled"));
      this.refreshQueueDetailsIfVisible();
      this.updateQueueStatus(taskQueue.getStatus());
    } else {
      new Notice(`${this.t("workbench.notifications.cancelFailed")}: ${result.error.message}`);
    }
  }

  /**
   * 处理重试所有失败任务
   */
  private async handleRetryFailed(): Promise<void> {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const result = await taskQueue.retryFailed();

    if (result.ok) {
      new Notice(`${this.t("workbench.notifications.retryComplete")}: ${result.value}`);
      this.refreshQueueDetailsIfVisible();
      this.updateQueueStatus(taskQueue.getStatus());
    } else {
      new Notice(`${this.t("workbench.notifications.cancelFailed")}: ${result.error.message}`);
    }
  }

  /**
   * 处理清除已完成任务
   */
  private async handleClearCompleted(): Promise<void> {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const result = await taskQueue.clearCompleted();

    if (result.ok) {
      new Notice(`${this.t("workbench.notifications.clearComplete")}: ${result.value}`);
      this.refreshQueueDetailsIfVisible();
      this.updateQueueStatus(taskQueue.getStatus());
    } else {
      new Notice(`清除失败: ${result.error.message}`);
    }
  }

  /**
   * 处理清除失败任务
   * 注意：TaskQueue 没有 clearFailed 方法，这里手动实现
   */
  private handleClearFailed(): void {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const allTasks = taskQueue.getAllTasks();

    // 手动取消所有失败的任务
    let clearedCount = 0;
    allTasks.forEach(task => {
      if (task.state === "Failed") {
        const result = taskQueue.cancel(task.id);
        if (result.ok) {
          clearedCount++;
        }
      }
    });

    new Notice(`${this.t("workbench.notifications.clearComplete")} (${clearedCount})`);

    this.refreshQueueDetailsIfVisible();
    this.updateQueueStatus(taskQueue.getStatus());
  }

  /**
   * 处理撤销操作
   */
  private async handleUndo(operationId: string): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const undoManager = this.plugin.getComponents().undoManager;
    const result = await undoManager.restoreSnapshot(operationId);

    if (result.ok) {
      // 恢复快照内容到文件（使用 path 而不是 filePath）
      const snapshot = result.value;
      try {
        const file = this.plugin.app.vault.getAbstractFileByPath(snapshot.path);
        if (file instanceof TFile) {
          await this.plugin.app.vault.modify(file, snapshot.content);
          // 删除快照
          await undoManager.deleteSnapshot(operationId);
          // 刷新列表
          await this.refreshRecentOps();
          new Notice(this.t("workbench.notifications.undoSuccess"));
        } else {
          // 文件不存在，创建文件
          await this.plugin.app.vault.create(snapshot.path, snapshot.content);
          // 删除快照
          await undoManager.deleteSnapshot(operationId);
          // 刷新列表
          await this.refreshRecentOps();
          new Notice(this.t("workbench.notifications.undoSuccessRestored"));
        }
      } catch (error) {
        new Notice(`${this.t("workbench.notifications.undoFailed")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      new Notice(`${this.t("workbench.notifications.undoFailed")}: ${result.error.message}`);
    }
  }
}

/**
 * 最近操作记录
 */
interface RecentOperation {
  /** 操作 ID */
  id: string;
  /** 操作描述 */
  description: string;
  /** 时间戳 */
  timestamp: string;
  /** 是否可撤销 */
  canUndo: boolean;
}

/**
 * 重复对预览模态框（改进版）
 */
class DuplicatePreviewModal extends Modal {
  private pair: DuplicatePair;
  private contentA: string;
  private contentB: string;
  private onMerge: () => void;
  private onDismiss: () => void;

  constructor(
    app: App,
    pair: DuplicatePair,
    contentA: string,
    contentB: string,
    onMerge: () => void,
    onDismiss: () => void
  ) {
    super(app);
    this.pair = pair;
    this.contentA = contentA;
    this.contentB = contentB;
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

    // 笔记 A 面板
    const panelA = sideBySideView.createDiv({ cls: "cr-preview-panel" });
    const headerA = panelA.createDiv({ cls: "cr-panel-header" });
    headerA.createEl("h3", { text: this.pair.noteA.name, cls: "cr-panel-title" });
    headerA.createEl("div", {
      text: this.pair.noteA.path,
      cls: "cr-panel-path"
    });
    const contentAEl = panelA.createEl("pre", { cls: "cr-panel-content" });
    contentAEl.textContent = this.contentA;

    // 笔记 B 面板
    const panelB = sideBySideView.createDiv({ cls: "cr-preview-panel" });
    const headerB = panelB.createDiv({ cls: "cr-panel-header" });
    headerB.createEl("h3", { text: this.pair.noteB.name, cls: "cr-panel-title" });
    headerB.createEl("div", {
      text: this.pair.noteB.path,
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
      this.openFile(this.pair.noteA.path);
    });

    const openBBtn = buttonContainer.createEl("button", {
      text: "📄 打开 B"
    });
    openBBtn.addEventListener("click", () => {
      this.openFile(this.pair.noteB.path);
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
      new Notice(`文件不存在: ${path}`);
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
class ConfirmDialog extends Modal {
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
class MergeHistoryModal extends Modal {
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
    const keys = path.split('.');
    let value: unknown = translations;

    for (const key of keys) {
      value = (value as Record<string, unknown>)?.[key];
      if (value === undefined) return path;
    }

    return typeof value === 'string' ? value : path;
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
      info.createEl("div", {
        text: `${pair.noteA.name} ↔ ${pair.noteB.name}`,
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
      new Notice(`${this.t("workbench.notifications.undoFailed")}: ${result.error.message}`);
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
      new Notice(`${this.t("common.error")}: ${result.error.message}`);
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
