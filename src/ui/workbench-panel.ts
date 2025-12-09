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
  StandardizedConcept
} from "../types";
import type { MergeHandler } from "../core/merge-handler";
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
  private mergeHandler: MergeHandler | null = null;
  private plugin: CognitiveRazorPlugin | null = null;
  private taskQueue: TaskQueue | null = null;
  private pipelineUnsubscribe: (() => void) | null = null;

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
   * 设置插件引用
   * 自动从插件组件中获取 TaskQueue 和 MergeHandler
   */
  public setPlugin(plugin: CognitiveRazorPlugin): void {
    this.plugin = plugin;
    const components = plugin.getComponents();
    this.taskQueue = components.taskQueue;
    // 自动设置 MergeHandler
    if (components.mergeHandler) {
      this.mergeHandler = components.mergeHandler;
    }
  }

  /**
   * 设置 MergeHandler（用于手动设置或测试）
   */
  public setMergeHandler(handler: MergeHandler): void {
    this.mergeHandler = handler;
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

    // 创建概念区域
    this.renderCreateConceptSection(container);

    // 重复概念面板
    this.renderDuplicatesSection(container);

    // 队列状态区域
    this.renderQueueStatusSection(container);

    // 最近操作区域
    this.renderRecentOpsSection(container);

    // 订阅管线事件以更新状态/确认按钮
    this.subscribePipelineEvents();

    // 如果有快速创建的待处理输入，在渲染完成后直接触发标准化流程
    if (this.pendingConceptInput) {
      const value = this.pendingConceptInput;
      this.pendingConceptInput = null;
      if (this.conceptInput) {
        this.conceptInput.value = value;
      }
      void this.handleStandardize(value);
    }
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
    this.pendingConceptInput = null;
  }
  /**
   * 渲染创建概念区域（可折叠）
   * Requirements: 5.1
   * 
   * 修改：使用 Modern Search Bar 设计 (Google/Bing 风格)
   */
  private renderCreateConceptSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-create-concept" });

    // 可折叠标题 (保持原样)
    const header = this.createCollapsibleHeader(
      section,
      this.t("workbench.createConcept.title"),
      "createConcept"
    );

    // 内容容器（可折叠）
    const content = section.createDiv({ cls: "cr-section-content" });
    this.sectionContents.set("createConcept", content);

    // 根据折叠状态设置显示
    if (this.collapseState.createConcept) {
      content.addClass("cr-collapsed");
    }

    // Modern Search Container
    const searchContainer = content.createDiv({ cls: "cr-modern-search-container" });

    // 1. Search Icon (Left)
    const searchIcon = searchContainer.createDiv({ cls: "cr-search-icon" });
    searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

    // 2. Input Field
    this.conceptInput = searchContainer.createEl("input", {
      type: "text",
      cls: "cr-modern-search-input",
      attr: {
        placeholder: this.t("workbench.createConcept.placeholder"),
        "aria-label": this.t("workbench.createConcept.placeholder")
      }
    });

    // 3. Action Button (Right)
    this.standardizeBtn = searchContainer.createEl("button", {
      cls: "cr-search-action-btn",
      attr: {
        "aria-label": this.t("workbench.createConcept.startButton"),
        "title": "Standardize (Enter)"
      }
    });
    // Initial Icon: Arrow Right
    this.standardizeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;

    this.standardizeBtn.addEventListener("click", () => {
      this.handleStandardize();
    });

    // 标准化结果容器
    this.standardizedResultContainer = content.createDiv({ cls: "cr-standardized-result" });
    this.standardizedResultContainer.style.display = "none";

    // 类型置信度表格容器
    this.typeConfidenceTableContainer = content.createDiv({ cls: "cr-type-confidence-table" });
    this.typeConfidenceTableContainer.style.display = "none";

    // 支持 Enter 键触发标准化
    if (this.conceptInput) {
      this.conceptInput.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.handleStandardize();
        }
      });
    }
  }

  private t(path: string): string {
    if (!this.plugin) return path;

    const i18n = this.plugin.getComponents().i18n;
    if (!i18n) return path;

    const translations = i18n.t();
    const keys = path.split('.');
    let value: any = translations;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) return path;
    }

    return typeof value === 'string' ? value : path;
  }

  /**
   * 渲染重复概念面板（可折叠）
   * Requirements: 5.1, 5.2
   */
  private renderDuplicatesSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-duplicates" });

    // 可折叠标题（带徽章）
    const header = this.createCollapsibleHeader(
      section,
      this.t("workbench.duplicates.title"),
      "duplicates",
      true // 显示徽章
    );

    // 徽章已在 createCollapsibleHeader 中创建

    // 内容容器（可折叠）
    const content = section.createDiv({ cls: "cr-section-content" });
    this.sectionContents.set("duplicates", content);

    // 根据折叠状态设置显示
    if (this.collapseState.duplicates) {
      content.addClass("cr-collapsed");
    }

    // 控制按钮组
    const controls = content.createDiv({ cls: "cr-duplicates-controls" });

    // 排序选择器
    const sortContainer = controls.createDiv({ cls: "cr-sort-container" });
    sortContainer.createEl("label", {
      text: this.t("workbench.duplicates.sortBy"),
      cls: "cr-control-label"
    });
    const sortSelect = sortContainer.createEl("select", { cls: "cr-sort-select" });
    sortSelect.createEl("option", { text: this.t("workbench.duplicates.sortBy") + " " + this.t("workbench.queueStatus.completed"), value: "similarity-desc" });
    sortSelect.createEl("option", { text: this.t("workbench.duplicates.sortBy") + " (Low to High)", value: "similarity-asc" });
    sortSelect.createEl("option", { text: "Time (New to Old)", value: "time-desc" });
    sortSelect.createEl("option", { text: "Time (Old to New)", value: "time-asc" });
    sortSelect.createEl("option", { text: this.t("workbench.queueStatus.type"), value: "type" });
    sortSelect.addEventListener("change", () => {
      this.currentSortOrder = sortSelect.value as DuplicateSortOrder;
      this.refreshDuplicates();
    });

    // 类型筛选器
    const filterContainer = controls.createDiv({ cls: "cr-filter-container" });
    filterContainer.createEl("label", {
      text: this.t("workbench.duplicates.filterBy"),
      cls: "cr-control-label"
    });
    const filterSelect = filterContainer.createEl("select", { cls: "cr-filter-select" });
    filterSelect.createEl("option", { text: "All", value: "all" });
    filterSelect.createEl("option", { text: "Domain", value: "Domain" });
    filterSelect.createEl("option", { text: "Issue", value: "Issue" });
    filterSelect.createEl("option", { text: "Theory", value: "Theory" });
    filterSelect.createEl("option", { text: "Entity", value: "Entity" });
    filterSelect.createEl("option", { text: "Mechanism", value: "Mechanism" });
    filterSelect.addEventListener("change", () => {
      this.currentTypeFilter = filterSelect.value as CRType | "all";
      this.refreshDuplicates();
    });

    // 批量操作按钮
    const batchActions = content.createDiv({ cls: "cr-batch-actions" });

    const selectAllBtn = batchActions.createEl("button", {
      text: this.t("workbench.duplicates.selectAll"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.t("workbench.duplicates.selectAll") }
    });
    selectAllBtn.addEventListener("click", () => this.handleSelectAll());

    const batchMergeBtn = batchActions.createEl("button", {
      text: this.t("workbench.duplicates.batchMerge"),
      cls: "cr-btn-small mod-cta",
      attr: { "aria-label": this.t("workbench.duplicates.batchMerge") }
    });
    batchMergeBtn.addEventListener("click", () => this.handleBatchMerge());

    const batchDismissBtn = batchActions.createEl("button", {
      text: this.t("workbench.duplicates.batchDismiss"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.t("workbench.duplicates.batchDismiss") }
    });
    batchDismissBtn.addEventListener("click", () => this.handleBatchDismiss());

    const viewHistoryBtn = batchActions.createEl("button", {
      text: this.t("workbench.duplicates.viewHistory"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.t("workbench.duplicates.viewHistory") }
    });
    viewHistoryBtn.addEventListener("click", () => this.handleViewMergeHistory());

    // 内容容器
    this.duplicatesContainer = content.createDiv({ cls: "cr-duplicates-list" });
    this.renderEmptyDuplicates();
  }

  /**
   * 渲染队列状态区域（可折叠）
   * Requirements: 5.1
   */
  private renderQueueStatusSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-queue-status" });

    // 可折叠标题
    this.createCollapsibleHeader(
      section,
      this.t("workbench.queueStatus.title"),
      "queueStatus"
    );

    // 内容容器（可折叠）
    const content = section.createDiv({ cls: "cr-section-content" });
    this.sectionContents.set("queueStatus", content);

    // 根据折叠状态设置显示
    if (this.collapseState.queueStatus) {
      content.addClass("cr-collapsed");
    }

    // 状态容器
    this.queueStatusContainer = content.createDiv({ cls: "cr-queue-status-content" });
    this.queueStatusContainer.setAttr("aria-live", "polite");
    this.renderQueueStatus({
      paused: false,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    });

    // 管线状态容器
    this.pipelineStatusContainer = content.createDiv({ cls: "cr-pipeline-status" });
    this.pipelineStatusContainer.setAttr("aria-live", "polite");
    this.pipelineStatusContainer.createEl("h4", { text: this.t("workbench.queueStatus.currentPipeline") });
    this.pipelineStatusContainer.createDiv({ cls: "cr-pipeline-list" });
  }

  /**
   * 渲染最近操作区域（可折叠）
   * Requirements: 5.1
   * 
   * 重构说明：整合撤销历史功能
   */
  private renderRecentOpsSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-recent-ops" });

    // 可折叠标题
    this.createCollapsibleHeader(
      section,
      "操作历史",
      "recentOps"
    );

    // 内容容器（可折叠）
    const content = section.createDiv({ cls: "cr-section-content" });
    this.sectionContents.set("recentOps", content);

    // 根据折叠状态设置显示
    if (this.collapseState.recentOps) {
      content.addClass("cr-collapsed");
    }

    // 工具栏
    const toolbar = content.createDiv({ cls: "cr-recent-ops-toolbar" });

    const refreshBtn = toolbar.createEl("button", {
      text: "刷新",
      cls: "cr-btn-small",
      attr: { "aria-label": "刷新操作历史" }
    });
    refreshBtn.addEventListener("click", () => {
      this.refreshRecentOps();
    });

    const clearAllBtn = toolbar.createEl("button", {
      text: "清空全部",
      cls: "cr-btn-small",
      attr: { "aria-label": "清空所有快照" }
    });
    clearAllBtn.addEventListener("click", () => {
      this.handleClearAllSnapshots();
    });

    // 操作列表容器
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
      this.standardizeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    }
  }

  /**
   * 渲染类型置信度表格
   * Requirements: 5.2
   * 
   * @param standardizedData 标准化结果数据
   */
  private renderTypeConfidenceTable(standardizedData: StandardizedConcept): void {
    if (!this.typeConfidenceTableContainer) return;

    // 清空容器
    this.typeConfidenceTableContainer.empty();
    this.typeConfidenceTableContainer.style.display = "block";

    // 隐藏标准化结果容器
    if (this.standardizedResultContainer) {
      this.standardizedResultContainer.style.display = "none";
    }

    // 创建表格标题
    const header = this.typeConfidenceTableContainer.createDiv({ cls: "cr-table-header" });
    header.createEl("h4", { text: this.t("workbench.createConcept.selectType") });
    header.createEl("p", {
      text: "请选择概念类型，每种类型都有对应的标准化名称",
      cls: "cr-standardized-name"
    });

    // 创建表格
    const table = this.typeConfidenceTableContainer.createEl("table", { cls: "cr-confidence-table" });

    // 表头
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: "类型" });
    headerRow.createEl("th", { text: "标准名称" });
    headerRow.createEl("th", { text: "置信度" });
    headerRow.createEl("th", { text: "操作" });

    // 表体
    const tbody = table.createEl("tbody");

    // 获取类型置信度并排序（任务 10.3）
    const typeConfidences = Object.entries(standardizedData.typeConfidences)
      .map(([type, confidence]) => ({
        type: type as CRType,
        confidence: confidence as number
      }))
      .sort((a, b) => b.confidence - a.confidence); // 降序排列

    // 渲染每一行
    typeConfidences.forEach(({ type, confidence }) => {
      const row = tbody.createEl("tr", { cls: "cr-confidence-row" });

      // 类型名称列
      const typeCell = row.createEl("td", { cls: "cr-type-cell" });
      typeCell.createEl("span", { text: type, cls: "cr-type-name" });

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
      confidenceCell.createEl("span", {
        text: `${(confidence * 100).toFixed(1)}%`,
        cls: "cr-confidence-percentage"
      });

      // 操作列
      const actionCell = row.createEl("td", { cls: "cr-action-cell" });
      const createBtn = actionCell.createEl("button", {
        text: this.t("workbench.createConcept.create"),
        cls: "mod-cta cr-create-btn",
        attr: { "aria-label": `${this.t("workbench.createConcept.create")} ${type}` }
      });

      // 绑定创建按钮点击事件（任务 10.4）
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
        ground.createEl("div", { text: "Ground 结果：", cls: "cr-muted" });
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

      form.createEl("label", { text: "中文名称：" });
      const nameCnInput = form.createEl("input", {
        type: "text",
        value: currentName.chinese,
        cls: "cr-input"
      });

      form.createEl("label", { text: "英文名称：" });
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
      typeSelect.createEl("option", { text: "自动选择", value: "" });
      types.forEach((type) => {
        typeSelect.createEl("option", { text: type, value: type });
      });
      typeSelect.value = ctx.type || ctx.standardizedData.primaryType || "";

      const saveBtn = form.createEl("button", { text: "保存编辑", cls: "cr-btn-small" });
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
      preview.createEl("h5", { text: "生成内容预览（写入前）" });
      const text = typeof ctx.generatedContent === "string"
        ? ctx.generatedContent
        : JSON.stringify(ctx.generatedContent, null, 2);
      preview.createEl("pre", { text });
    }

    const actions = this.standardizedResultContainer.createDiv({ cls: "cr-button-container" });

    if (ctx.stage === "awaiting_create_confirm") {
      const confirmBtn = actions.createEl("button", { text: "确认创建 Stub", cls: "mod-cta cr-btn-small" });
      confirmBtn.addEventListener("click", async () => {
        const po = this.plugin?.getComponents().pipelineOrchestrator;
        if (!po) return;
        const result = await po.confirmCreate(ctx.pipelineId);
        if (!result.ok) {
          new Notice(`确认创建失败: ${result.error.message}`);
        } else {
          new Notice("已确认创建，等待内容生成");
        }
      });
    } else if (ctx.stage === "awaiting_write_confirm") {
      const previewBtn = actions.createEl("button", { text: "预览并确认写入", cls: "mod-cta cr-btn-small" });
      previewBtn.addEventListener("click", () => this.showWritePreview(ctx));
    } else if (ctx.stage === "failed" && ctx.error) {
      actions.createEl("div", {
        text: `失败: ${ctx.error.message}`,
        cls: "cr-error-text"
      });
    } else if (ctx.stage === "completed") {
      if (ctx.snapshotId) {
        const undoBtn = actions.createEl("button", { text: "撤销写入", cls: "cr-btn-small" });
        undoBtn.addEventListener("click", () => this.handleUndo(ctx.snapshotId!));
        actions.createEl("span", { text: `快照: ${ctx.snapshotId}`, cls: "cr-muted" });
      } else {
        actions.createEl("span", { text: "已完成", cls: "cr-muted" });
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
      new Notice("已更新标准化结果");
      this.renderPipelinePreview();
    } else {
      new Notice(`更新失败: ${result.error.message}`);
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
    const badge = this.containerEl.querySelector(".cr-duplicates .cr-badge");
    if (badge) {
      badge.textContent = sortedDuplicates.length.toString();
    }

    if (sortedDuplicates.length === 0) {
      this.renderEmptyDuplicates();
      return;
    }

    // 渲染重复对列表（卡片样式）
    // 渲染重复对列表（List View 模式）
    sortedDuplicates.forEach(pair => {
      // 列表项容器 - 使用 cr-duplicate-card 类但样式已修改为列表项
      const item = this.duplicatesContainer!.createDiv({ cls: "cr-duplicate-card" });

      // 1. 选择框
      const checkbox = item.createEl("input", {
        type: "checkbox",
        cls: "cr-duplicate-checkbox",
        attr: { "aria-label": `Select ${pair.noteA.name} and ${pair.noteB.name}` }
      });
      checkbox.checked = this.selectedDuplicates.has(pair.id);
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          this.selectedDuplicates.add(pair.id);
        } else {
          this.selectedDuplicates.delete(pair.id);
        }
      });

      // 2. 主要内容区 (点击预览)
      const content = item.createDiv({ cls: "cr-duplicate-content cr-clickable" });

      // Flex 布局行
      const row = content.createDiv({ cls: "cr-duplicate-row" });
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "var(--cr-spacing-md)";
      row.style.width = "100%";

      // 名称
      const namesDigest = row.createEl("span", {
        text: `${pair.noteA.name} · ${pair.noteB.name}`,
        cls: "cr-duplicate-names",
        attr: { "title": `${pair.noteA.path}\n${pair.noteB.path}` }
      });
      namesDigest.style.flex = "1";
      namesDigest.style.fontSize = "0.95em";
      namesDigest.style.fontWeight = "500";
      // namesDigest.style.color = "var(--text-normal)"; // 已由 CSS 处理

      // 相似度 Pill
      const similarityPill = row.createEl("span", {
        cls: "cr-similarity-pill",
        text: `${(pair.similarity * 100).toFixed(0)}%`
      });
      similarityPill.style.fontWeight = "600";
      similarityPill.style.fontSize = "0.85em";
      similarityPill.style.padding = "2px 6px";
      similarityPill.style.borderRadius = "4px";
      similarityPill.style.backgroundColor = "var(--background-modifier-border)";
      similarityPill.style.color = pair.similarity > 0.8 ? "var(--color-green)" : "var(--color-orange)";

      // 类型 Badge
      row.createEl("span", {
        text: pair.type.substring(0, 1), // 仅显示首字母
        cls: "cr-type-tag",
        attr: { "title": pair.type }
      });

      // 点击事件
      content.addEventListener("click", () => {
        this.handleShowDuplicatePreview(pair);
      });

      // 3. 悬浮操作按钮 (Actions)
      const actions = item.createDiv({ cls: "cr-duplicate-card-actions" });
      actions.style.opacity = "0"; // 默认隐藏
      actions.style.transition = "opacity 0.2s ease";

      // Merge Button (Icon)
      const mergeBtn = actions.createEl("button", {
        cls: "cr-icon-btn", // 需要在 CSS 中确保这个类有合适的样式，或者内联
        attr: { "aria-label": this.t("workbench.duplicates.merge"), "title": this.t("workbench.duplicates.merge") }
      });
      mergeBtn.addClass("cr-btn-small"); // 复用现有类
      mergeBtn.style.padding = "4px";
      mergeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 9l3 3-3 3"></path><line x1="15" y1="4" x2="15" y2="20"></line></svg>`;
      mergeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleMergeDuplicate(pair);
      });

      // Dismiss Button (Icon)
      const dismissBtn = actions.createEl("button", {
        cls: "cr-icon-btn",
        attr: { "aria-label": this.t("workbench.duplicates.dismiss"), "title": this.t("workbench.duplicates.dismiss") }
      });
      dismissBtn.addClass("cr-btn-small");
      dismissBtn.style.padding = "4px";
      dismissBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      dismissBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleDismissDuplicate(pair);
      });

      // Hover effect logic
      item.addEventListener("mouseenter", () => { actions.style.opacity = "1"; });
      item.addEventListener("mouseleave", () => { actions.style.opacity = "0"; });
    });
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
   * 批量合并
   */
  private async handleBatchMerge(): Promise<void> {
    if (this.selectedDuplicates.size === 0) {
      new Notice(this.t("workbench.notifications.selectDuplicates"));
      return;
    }

    const count = this.selectedDuplicates.size;
    const confirmed = await this.showConfirmDialog(
      this.t("workbench.duplicates.batchMerge"),
      `${this.t("workbench.notifications.batchMergeConfirm")} (${count})`
    );

    if (!confirmed) return;

    let successCount = 0;
    let failCount = 0;

    // 注意：合并功能已被弃用，等待重构
    new Notice("合并功能已被弃用，等待重构");
    return;

    new Notice(`${this.t("workbench.notifications.batchMergeComplete")}: ${successCount} / ${failCount}`);
    this.selectedDuplicates.clear();
    this.refreshDuplicates();
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
   * 渲染队列状态
   * 遵循 A-NF-04：添加 aria-label 和键盘支持
   */
  private renderQueueStatus(status: QueueStatus): void {
    if (!this.queueStatusContainer) return;

    this.queueStatusContainer.empty();

    const grid = this.queueStatusContainer.createDiv({
      cls: "cr-queue-grid",
      attr: { role: "region", "aria-label": "队列统计信息" }
    });

    // 状态指示器
    const statusIndicator = grid.createDiv({ cls: "cr-queue-indicator" });
    const statusIcon = statusIndicator.createEl("span", {
      cls: status.paused ? "cr-status-paused" : "cr-status-active",
      attr: {
        "aria-label": status.paused ? this.t("workbench.queueStatus.queuePaused") : this.t("workbench.queueStatus.queueRunning"),
        role: "status"
      }
    });
    statusIcon.textContent = status.paused ? "⏸" : "▶";
    statusIndicator.createEl("span", {
      text: status.paused ? this.t("workbench.queueStatus.paused") : this.t("workbench.queueStatus.active"),
      attr: { "aria-hidden": "true" }
    });

    // 统计信息
    this.createStatItem(grid, this.t("workbench.queueStatus.pending"), status.pending, "cr-stat-pending");
    this.createStatItem(grid, this.t("workbench.queueStatus.running"), status.running, "cr-stat-running");
    this.createStatItem(grid, this.t("workbench.queueStatus.completed"), status.completed, "cr-stat-completed");
    this.createStatItem(grid, this.t("workbench.queueStatus.failed"), status.failed, "cr-stat-failed");

    // 操作按钮
    const actions = this.queueStatusContainer.createDiv({
      cls: "cr-queue-actions",
      attr: { role: "group", "aria-label": "队列操作" }
    });

    const toggleBtn = actions.createEl("button", {
      text: status.paused ? this.t("workbench.queueStatus.resumeQueue") : this.t("workbench.queueStatus.pauseQueue"),
      attr: {
        "aria-label": status.paused ? this.t("workbench.queueStatus.resumeQueue") : this.t("workbench.queueStatus.pauseQueue"),
        tabindex: "0"
      }
    });
    toggleBtn.addEventListener("click", () => {
      this.handleToggleQueue();
    });
    // 键盘支持
    toggleBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.handleToggleQueue();
      }
    });

    const viewBtn = actions.createEl("button", {
      text: this.t("workbench.queueStatus.viewDetails"),
      attr: {
        "aria-label": this.t("workbench.queueStatus.viewDetails"),
        tabindex: "0"
      }
    });
    viewBtn.addEventListener("click", () => {
      this.handleViewQueue();
    });
    // 键盘支持
    viewBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.handleViewQueue();
      }
    });
  }

  /**
   * 创建统计项
   * 遵循 A-NF-04：添加 aria-label 支持屏幕阅读器
   */
  private createStatItem(
    container: HTMLElement,
    label: string,
    value: number,
    className: string
  ): void {
    const item = container.createDiv({
      cls: `cr-stat-item ${className}`,
      attr: {
        role: "group",
        "aria-label": `${label}: ${value}`
      }
    });
    item.createEl("div", {
      text: value.toString(),
      cls: "cr-stat-value",
      attr: { "aria-hidden": "true" }
    });
    item.createEl("div", {
      text: label,
      cls: "cr-stat-label",
      attr: { "aria-hidden": "true" }
    });
  }

  /**
   * 渲染空最近操作
   */
  private renderEmptyRecentOps(): void {
    if (!this.recentOpsContainer) return;

    this.recentOpsContainer.createEl("div", {
      text: "暂无可撤销的操作",
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
        text: "撤销",
        cls: "cr-undo-btn cr-btn-small",
        attr: { "aria-label": `撤销: ${description}` }
      });
      undoBtn.addEventListener("click", async () => {
        await this.handleUndoSnapshot(snapshot.id);
      });
    });

    // 如果有更多快照，显示提示
    if (snapshots.length > 10) {
      const moreHint = this.recentOpsContainer.createDiv({ cls: "cr-more-hint" });
      moreHint.textContent = `还有 ${snapshots.length - 10} 个更早的快照`;
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
      new Notice("插件未初始化");
      return;
    }

    const undoManager = this.plugin.getComponents().undoManager;

    try {
      // 恢复快照
      const restoreResult = await undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        new Notice(`撤销失败: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      // 写入文件
      const file = this.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, snapshot.content);
        new Notice("撤销成功");
      } else {
        // 文件不存在，创建文件
        await this.app.vault.create(snapshot.path, snapshot.content);
        new Notice("撤销成功（文件已恢复）");
      }

      // 删除快照
      await undoManager.deleteSnapshot(snapshotId);

      // 刷新列表
      await this.refreshRecentOps();
    } catch (error) {
      console.error("撤销操作失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`撤销失败: ${errorMessage}`);
    }
  }

  /**
   * 处理清空所有快照
   */
  private async handleClearAllSnapshots(): Promise<void> {
    if (!this.plugin) {
      new Notice("插件未初始化");
      return;
    }

    const confirmed = await this.showConfirmDialog(
      "确认清空",
      "确定要清空所有快照吗？此操作不可撤销。"
    );

    if (!confirmed) return;

    const undoManager = this.plugin.getComponents().undoManager;
    const result = await undoManager.clearAllSnapshots();

    if (result.ok) {
      new Notice(`已清空 ${result.value} 个快照`);
      await this.refreshRecentOps();
    } else {
      new Notice(`清空失败: ${result.error.message}`);
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
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;

    const days = Math.floor(hours / 24);
    return `${days} 天前`;
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
      new Notice("插件未初始化");
      return;
    }

    const undoManager = this.plugin.getComponents().undoManager;

    try {
      // 恢复快照
      const restoreResult = await undoManager.restoreSnapshot(snapshotId);
      if (!restoreResult.ok) {
        new Notice(`撤销失败: ${restoreResult.error.message}`);
        return;
      }

      const snapshot = restoreResult.value;

      // 写入文件
      const file = this.app.vault.getAbstractFileByPath(snapshot.path);
      if (file && file instanceof TFile) {
        await this.app.vault.modify(file, snapshot.content);
        new Notice("撤销成功");
      } else {
        // 文件不存在，创建文件
        await this.app.vault.create(snapshot.path, snapshot.content);
        new Notice("撤销成功（文件已恢复）");
      }

      // 删除快照
      await undoManager.deleteSnapshot(snapshotId);
    } catch (error) {
      console.error("撤销操作失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`撤销失败: ${errorMessage}`);
    }
  }

  /**
   * 处理合并重复概念
   * 点击合并时先显示 DiffView 预览
   * Requirements: 5.3
   */
  private async handleMergeDuplicate(pair: DuplicatePair): Promise<void> {
    if (!this.plugin) {
      new Notice("插件未初始化");
      return;
    }

    try {
      // 读取两个笔记的内容
      const fileA = this.app.vault.getAbstractFileByPath(pair.noteA.path);
      const fileB = this.app.vault.getAbstractFileByPath(pair.noteB.path);

      if (!fileA || !(fileA instanceof TFile)) {
        new Notice(`文件不存在: ${pair.noteA.path}`);
        return;
      }

      if (!fileB || !(fileB instanceof TFile)) {
        new Notice(`文件不存在: ${pair.noteB.path}`);
        return;
      }

      const contentA = await this.app.vault.read(fileA);
      const contentB = await this.app.vault.read(fileB);

      // 显示合并预览 DiffView
      this.showMergePreviewDiffView(pair, contentA, contentB);
    } catch (error) {
      console.error("显示合并预览失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`显示合并预览失败: ${errorMessage}`);
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
      `合并预览: ${pair.noteA.name} ↔ ${pair.noteB.name}`,
      contentA,
      contentB,
      async () => {
        // 用户确认合并 - 创建合并任务
        await this.confirmMerge(pair);
      },
      () => {
        // 用户取消合并
        new Notice("已取消合并");
      }
    );

    diffView.open();
  }

  /**
   * 确认合并 - 创建合并任务
   */
  private async confirmMerge(pair: DuplicatePair): Promise<void> {
    if (!this.plugin) {
      new Notice(this.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    // 注意：合并功能已被弃用，等待重构
    new Notice("合并功能已被弃用，等待重构");
    return;
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
   * 处理查看队列详情（内联展开/折叠）
   * Requirements: 7.1, 7.2
   */
  private handleViewQueue(): void {
    if (!this.queueStatusContainer) return;

    // 查找或创建内联详情容器
    let detailsContainer = this.queueStatusContainer.querySelector(".cr-queue-details") as HTMLElement;

    if (!detailsContainer) {
      // 首次点击，创建详情容器
      detailsContainer = this.queueStatusContainer.createDiv({ cls: "cr-queue-details" });
      this.renderQueueDetails(detailsContainer);
    } else {
      // 切换显示/隐藏
      if (detailsContainer.style.display === "none") {
        detailsContainer.style.display = "block";
        this.renderQueueDetails(detailsContainer);
      } else {
        detailsContainer.style.display = "none";
      }
    }
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
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.taskId") });
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.type") });
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.status") });
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.progress") });
    headerRow.createEl("th", { text: this.t("workbench.queueStatus.actions") });

    // 表体
    const tbody = table.createEl("tbody");

    allTasks.forEach(task => {
      const row = tbody.createEl("tr", { cls: `cr-task-row cr-task-${task.state.toLowerCase()}` });

      // 任务 ID
      row.createEl("td", {
        text: task.id.substring(0, 8),
        cls: "cr-task-id",
        attr: { title: task.id }
      });

      // 任务类型
      row.createEl("td", {
        text: task.taskType,
        cls: "cr-task-type"
      });

      // 状态
      const statusCell = row.createEl("td", { cls: "cr-task-status" });
      const statusBadge = statusCell.createEl("span", {
        cls: `cr-status-badge cr-status-${task.state.toLowerCase()}`,
        text: this.getStatusLabel(task.state)
      });

      // 进度
      const progressCell = row.createEl("td", { cls: "cr-task-progress" });
      // TaskRecord 没有 progress 字段，显示尝试次数
      if (task.state === "Running") {
        progressCell.textContent = `${task.attempt}/${task.maxAttempts}`;
      } else {
        progressCell.textContent = "-";
      }

      // 操作按钮
      const actionCell = row.createEl("td", { cls: "cr-task-actions" });

      if (task.state === "Pending") {
        const cancelBtn = actionCell.createEl("button", {
          text: this.t("workbench.queueStatus.cancel"),
          cls: "cr-btn-small",
          attr: { "aria-label": `${this.t("workbench.queueStatus.cancel")} ${task.id}` }
        });
        cancelBtn.addEventListener("click", () => {
          this.handleCancelTask(task.id);
        });
      } else if (task.state === "Failed") {
        if (task.errors && task.errors.length > 0) {
          const lastError = task.errors[task.errors.length - 1];
          const errorIcon = actionCell.createEl("span", {
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
      Cancelled: "Cancelled"
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
      // 刷新详情显示
      const detailsContainer = this.queueStatusContainer?.querySelector(".cr-queue-details") as HTMLElement;
      if (detailsContainer) {
        this.renderQueueDetails(detailsContainer);
      }
      // 刷新队列状态
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
      // 刷新详情显示
      const detailsContainer = this.queueStatusContainer?.querySelector(".cr-queue-details") as HTMLElement;
      if (detailsContainer) {
        this.renderQueueDetails(detailsContainer);
      }
      // 刷新队列状态
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
      // 刷新详情显示
      const detailsContainer = this.queueStatusContainer?.querySelector(".cr-queue-details") as HTMLElement;
      if (detailsContainer) {
        this.renderQueueDetails(detailsContainer);
      }
      // 刷新队列状态
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

    new Notice(`已清除 ${clearedCount} 个失败的任务`);

    // 刷新详情显示
    const detailsContainer = this.queueStatusContainer?.querySelector(".cr-queue-details") as HTMLElement;
    if (detailsContainer) {
      this.renderQueueDetails(detailsContainer);
    }
    // 刷新队列状态
    this.updateQueueStatus(taskQueue.getStatus());
  }

  /**
   * 处理撤销操作
   */
  private async handleUndo(operationId: string): Promise<void> {
    if (!this.plugin) {
      new Notice("插件未初始化");
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
          new Notice("撤销成功");
        } else {
          new Notice("文件不存在，无法撤销");
        }
      } catch (error) {
        new Notice(`撤销失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      new Notice(`撤销失败: ${result.error.message}`);
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

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-merge-history-modal");
    contentEl.addClass("cr-scope");

    contentEl.createEl("h2", { text: "重复对历史" });

    if (!this.plugin) {
      contentEl.createEl("p", { text: "插件未初始化", cls: "cr-error-text" });
      return;
    }

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) {
      contentEl.createEl("p", { text: "重复管理器未初始化", cls: "cr-error-text" });
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
      new Notice("已撤销忽略，重复对已恢复到待处理列表");
      await this.renderList();
    } else {
      new Notice(`撤销失败: ${result.error.message}`);
    }
  }

  private async handleDelete(pairId: string): Promise<void> {
    if (!this.plugin) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new ConfirmDialog(
        this.app,
        "确认删除",
        "确定要永久删除这个重复对记录吗？此操作不可撤销。",
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
      new Notice("已删除重复对记录");
      await this.renderList();
    } else {
      new Notice(`删除失败: ${result.error.message}`);
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
