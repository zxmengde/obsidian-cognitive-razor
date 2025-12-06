/**
 * WorkbenchPanel - 统一工作台面板
 * 
 * 功能：
 * - 创建概念区域
 * - 重复概念面板
 * - 队列状态区域
 * - 最近操作区域
 */

import { ItemView, WorkspaceLeaf, Notice, TFile, App, Modal } from "obsidian";
import type {
  DuplicatePair,
  QueueStatus,
  CRType,
  CRFrontmatter,
  NoteState,
  StandardizedConcept,
  ChatRequest
} from "../types";
import type { MergeHandler } from "../core/merge-handler";
import type { TaskQueue } from "../core/task-queue";
import type { ProviderManager } from "../core/provider-manager";
import type { PromptManager } from "../core/prompt-manager";
import type CognitiveRazorPlugin from "../../main";
import { QUEUE_VIEW_TYPE } from "./queue-view";
import { Validator } from "../data/validator";

export const WORKBENCH_VIEW_TYPE = "cognitive-razor-workbench";

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
 */
export class WorkbenchPanel extends ItemView {
  private conceptInput: HTMLTextAreaElement | null = null;
  private duplicatesContainer: HTMLElement | null = null;
  private queueStatusContainer: HTMLElement | null = null;
  private recentOpsContainer: HTMLElement | null = null;
  private mergeHandler: MergeHandler | null = null;
  private plugin: CognitiveRazorPlugin | null = null;
  private taskQueue: TaskQueue | null = null;
  
  // 标准化相关
  private standardizeBtn: HTMLButtonElement | null = null;
  private standardizedResultContainer: HTMLElement | null = null;
  private standardizedData: StandardizedConcept | null = null;
  private createBtn: HTMLButtonElement | null = null;

  // 重复对管理相关
  private selectedDuplicates: Set<string> = new Set();
  private currentSortOrder: DuplicateSortOrder = "similarity-desc";
  private currentTypeFilter: CRType | "all" = "all";
  private allDuplicates: DuplicatePair[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }
  
  /**
   * 设置插件引用
   */
  public setPlugin(plugin: CognitiveRazorPlugin): void {
    this.plugin = plugin;
    const components = plugin.getComponents();
    this.taskQueue = components.taskQueue;
  }

  /**
   * 设置 MergeHandler
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

    // 创建概念区域
    this.renderCreateConceptSection(container);

    // 重复概念面板
    this.renderDuplicatesSection(container);

    // 队列状态区域
    this.renderQueueStatusSection(container);

    // 最近操作区域
    this.renderRecentOpsSection(container);
  }

  async onClose(): Promise<void> {
    // 清理资源
    this.conceptInput = null;
    this.duplicatesContainer = null;
    this.queueStatusContainer = null;
    this.recentOpsContainer = null;
  }

  /**
   * 渲染创建概念区域
   */
  private renderCreateConceptSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-create-concept" });
    
    // 标题
    section.createEl("h3", { text: "创建概念" });

    // 输入区域
    const inputContainer = section.createDiv({ cls: "cr-input-container" });
    
    this.conceptInput = inputContainer.createEl("textarea", {
      cls: "cr-concept-input",
      attr: {
        placeholder: "输入概念描述...",
        rows: "4",
        "aria-label": "概念描述输入框"
      }
    });

    // 按钮区域
    const buttonContainer = section.createDiv({ cls: "cr-button-container" });
    
    this.standardizeBtn = buttonContainer.createEl("button", {
      text: "标准化",
      cls: "mod-cta",
      attr: {
        "aria-label": "标准化概念"
      }
    });

    this.standardizeBtn.addEventListener("click", () => {
      this.handleStandardize();
    });

    // 标准化结果容器
    this.standardizedResultContainer = section.createDiv({ cls: "cr-standardized-result" });
    this.standardizedResultContainer.style.display = "none";

    // 支持 Ctrl+Enter 键触发标准化
    this.conceptInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleStandardize();
      }
    });
  }

  /**
   * 渲染重复概念面板
   */
  private renderDuplicatesSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-duplicates" });
    
    // 标题和控制栏
    const header = section.createDiv({ cls: "cr-section-header" });
    const titleRow = header.createDiv({ cls: "cr-header-title-row" });
    titleRow.createEl("h3", { text: "重复概念" });
    
    const badge = titleRow.createEl("span", {
      cls: "cr-badge",
      attr: { "aria-label": "重复概念数量" }
    });
    badge.textContent = "0";

    // 控制按钮组
    const controls = header.createDiv({ cls: "cr-duplicates-controls" });
    
    // 排序选择器
    const sortContainer = controls.createDiv({ cls: "cr-sort-container" });
    sortContainer.createEl("label", { text: "排序:", cls: "cr-control-label" });
    const sortSelect = sortContainer.createEl("select", { cls: "cr-sort-select" });
    sortSelect.createEl("option", { text: "相似度（高到低）", value: "similarity-desc" });
    sortSelect.createEl("option", { text: "相似度（低到高）", value: "similarity-asc" });
    sortSelect.createEl("option", { text: "检测时间（新到旧）", value: "time-desc" });
    sortSelect.createEl("option", { text: "检测时间（旧到新）", value: "time-asc" });
    sortSelect.createEl("option", { text: "类型", value: "type" });
    sortSelect.addEventListener("change", () => {
      this.currentSortOrder = sortSelect.value as DuplicateSortOrder;
      this.refreshDuplicates();
    });

    // 类型筛选器
    const filterContainer = controls.createDiv({ cls: "cr-filter-container" });
    filterContainer.createEl("label", { text: "类型:", cls: "cr-control-label" });
    const filterSelect = filterContainer.createEl("select", { cls: "cr-filter-select" });
    filterSelect.createEl("option", { text: "全部", value: "all" });
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
    const batchActions = header.createDiv({ cls: "cr-batch-actions" });
    
    const selectAllBtn = batchActions.createEl("button", {
      text: "全选",
      cls: "cr-btn-small",
      attr: { "aria-label": "全选重复对" }
    });
    selectAllBtn.addEventListener("click", () => this.handleSelectAll());

    const batchMergeBtn = batchActions.createEl("button", {
      text: "批量合并",
      cls: "cr-btn-small mod-cta",
      attr: { "aria-label": "批量合并选中的重复对" }
    });
    batchMergeBtn.addEventListener("click", () => this.handleBatchMerge());

    const batchDismissBtn = batchActions.createEl("button", {
      text: "批量忽略",
      cls: "cr-btn-small",
      attr: { "aria-label": "批量忽略选中的重复对" }
    });
    batchDismissBtn.addEventListener("click", () => this.handleBatchDismiss());

    const viewHistoryBtn = batchActions.createEl("button", {
      text: "查看历史",
      cls: "cr-btn-small",
      attr: { "aria-label": "查看合并历史" }
    });
    viewHistoryBtn.addEventListener("click", () => this.handleViewMergeHistory());

    // 内容容器
    this.duplicatesContainer = section.createDiv({ cls: "cr-duplicates-list" });
    this.renderEmptyDuplicates();
  }

  /**
   * 渲染队列状态区域
   */
  private renderQueueStatusSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-queue-status" });
    
    // 标题
    const header = section.createDiv({ cls: "cr-section-header" });
    header.createEl("h3", { text: "队列状态" });

    // 状态容器
    this.queueStatusContainer = section.createDiv({ cls: "cr-queue-status-content" });
    this.renderQueueStatus({
      paused: false,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    });
  }

  /**
   * 渲染最近操作区域
   */
  private renderRecentOpsSection(container: HTMLElement): void {
    const section = container.createDiv({ cls: "cr-section cr-recent-ops" });
    
    // 标题
    section.createEl("h3", { text: "最近操作" });

    // 操作列表容器
    this.recentOpsContainer = section.createDiv({ cls: "cr-recent-ops-list" });
    this.renderEmptyRecentOps();
  }

  /**
   * 处理标准化（直接调用 API，不进入任务队列）
   */
  private async handleStandardize(): Promise<void> {
    if (!this.conceptInput || !this.plugin) {
      new Notice("系统未初始化");
      return;
    }

    const description = this.conceptInput.value.trim();
    if (!description) {
      new Notice("请输入概念描述");
      return;
    }

    // 禁用按钮，防止重复点击
    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = true;
      this.standardizeBtn.textContent = "标准化中...";
    }

    try {
      const components = this.plugin.getComponents();
      const { providerManager, promptManager, settings } = components;

      // 渲染提示词
      const promptResult = promptManager.render("standardizeClassify", {
        concept_description: description,
        error_history: "",
      });

      if (!promptResult.ok) {
        new Notice(`提示词渲染失败: ${promptResult.error.message}`);
        this.resetStandardizeButton();
        return;
      }

      // 获取默认模型
      const providerConfig = settings.providers[settings.defaultProviderId];
      const model = providerConfig?.defaultChatModel || "gpt-4o";

      // 调用 API
      const chatRequest: ChatRequest = {
        providerId: settings.defaultProviderId,
        model,
        messages: [{ role: "user", content: promptResult.value }],
        temperature: 0.7,
      };

      const chatResult = await providerManager.chat(chatRequest);
      if (!chatResult.ok) {
        new Notice(`API 调用失败: ${chatResult.error.message}`);
        this.resetStandardizeButton();
        return;
      }

      // 验证 JSON
      const validator = new Validator();
      const jsonResult = validator.validateJSON(chatResult.value.content);
      if (!jsonResult.ok) {
        new Notice(`JSON 解析失败: ${jsonResult.error.message}`);
        this.resetStandardizeButton();
        return;
      }

      // 验证标准化输出
      const validationResult = validator.validateStandardizeOutput(jsonResult.value);
      if (!validationResult.valid) {
        const firstError = validationResult.errors[0];
        new Notice(`验证失败: ${firstError.message}`);
        this.resetStandardizeButton();
        return;
      }

      // 保存结果
      this.standardizedData = validationResult.data as StandardizedConcept;

      // 显示标准化结果
      this.renderStandardizedResult();

      // 重置标准化按钮
      this.resetStandardizeButton();

      new Notice("标准化完成");
    } catch (error) {
      new Notice(`标准化失败: ${error instanceof Error ? error.message : String(error)}`);
      this.resetStandardizeButton();
    }
  }

  /**
   * 渲染标准化结果
   */
  private renderStandardizedResult(): void {
    if (!this.standardizedResultContainer || !this.standardizedData) return;

    this.standardizedResultContainer.empty();
    this.standardizedResultContainer.style.display = "block";

    // 分隔线
    this.standardizedResultContainer.createEl("hr", { cls: "cr-divider" });

    // 标题
    this.standardizedResultContainer.createEl("h4", { text: "标准化结果" });

    // 中文名
    const chineseRow = this.standardizedResultContainer.createDiv({ cls: "cr-result-row" });
    chineseRow.createEl("span", { text: "中文名:", cls: "cr-result-label" });
    chineseRow.createEl("span", { text: this.standardizedData.standardName.chinese, cls: "cr-result-value" });

    // 英文名
    const englishRow = this.standardizedResultContainer.createDiv({ cls: "cr-result-row" });
    englishRow.createEl("span", { text: "英文名:", cls: "cr-result-label" });
    englishRow.createEl("span", { text: this.standardizedData.standardName.english, cls: "cr-result-value" });

    // 别名
    if (this.standardizedData.aliases.length > 0) {
      const aliasRow = this.standardizedResultContainer.createDiv({ cls: "cr-result-row" });
      aliasRow.createEl("span", { text: "别名:", cls: "cr-result-label" });
      aliasRow.createEl("span", { text: this.standardizedData.aliases.join(", "), cls: "cr-result-value" });
    }

    // 类型置信度
    const typeRow = this.standardizedResultContainer.createDiv({ cls: "cr-result-row" });
    typeRow.createEl("span", { text: "类型:", cls: "cr-result-label" });
    
    const typeContainer = typeRow.createDiv({ cls: "cr-type-confidences" });
    const sortedTypes = Object.entries(this.standardizedData.typeConfidences)
      .sort(([, a], [, b]) => b - a);
    
    sortedTypes.forEach(([type, confidence]) => {
      const typeItem = typeContainer.createDiv({ cls: "cr-type-item" });
      typeItem.createEl("span", { text: type, cls: "cr-type-name" });
      typeItem.createEl("span", { text: `(${(confidence * 100).toFixed(1)}%)`, cls: "cr-type-confidence" });
    });

    // 创建按钮
    const createBtnContainer = this.standardizedResultContainer.createDiv({ cls: "cr-button-container" });
    this.createBtn = createBtnContainer.createEl("button", {
      text: "创建",
      cls: "mod-cta",
      attr: { "aria-label": "创建笔记" }
    });

    this.createBtn.addEventListener("click", () => {
      this.handleCreate();
    });
  }

  /**
   * 重置标准化按钮
   */
  private resetStandardizeButton(): void {
    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = false;
      this.standardizeBtn.textContent = "标准化";
    }
  }

  /**
   * 处理创建笔记
   */
  private async handleCreate(): Promise<void> {
    if (!this.standardizedData || !this.plugin || !this.taskQueue) {
      new Notice("系统未初始化或缺少标准化数据");
      return;
    }

    // 禁用创建按钮
    if (this.createBtn) {
      this.createBtn.disabled = true;
      this.createBtn.textContent = "创建中...";
    }

    try {
      // 确定主要类型（置信度最高的）
      const primaryType = Object.entries(this.standardizedData.typeConfidences)
        .sort(([, a], [, b]) => b - a)[0][0] as CRType;

      // 生成 UID
      const uid = this.generateUID();

      // 创建 Frontmatter
      const now = new Date().toISOString();
      const frontmatter: CRFrontmatter = {
        uid,
        type: primaryType,
        status: "Stub" as NoteState,
        created: now,
        updated: now,
        aliases: this.standardizedData.aliases,
      };

      // 创建笔记文件名（使用中文名）
      const fileName = this.sanitizeFileName(this.standardizedData.standardName.chinese);
      const filePath = `${fileName}.md`;

      // 创建 Stub 笔记内容
      const content = this.createStubContent(frontmatter, this.standardizedData);

      // 写入文件
      const file = await this.app.vault.create(filePath, content);

      new Notice(`笔记已创建: ${fileName}`);

      // 创建 enrich 任务
      const enrichResult = await this.taskQueue.enqueue({
        nodeId: uid,
        taskType: "enrich",
        payload: {
          filePath,
          type: primaryType,
          standardizedData: this.standardizedData,
        },
      });

      if (!enrichResult.ok) {
        new Notice(`创建内容生成任务失败: ${enrichResult.error.message}`);
      } else {
        new Notice("内容生成任务已创建");
      }

      // 在编辑器中打开新笔记
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);

      // 清空输入和结果
      if (this.conceptInput) {
        this.conceptInput.value = "";
      }
      if (this.standardizedResultContainer) {
        this.standardizedResultContainer.style.display = "none";
      }
      this.standardizedData = null;

    } catch (error) {
      new Notice(`创建笔记失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // 重置创建按钮
      if (this.createBtn) {
        this.createBtn.disabled = false;
        this.createBtn.textContent = "创建";
      }
    }
  }

  /**
   * 生成 UUID v4
   */
  private generateUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 清理文件名（移除非法字符）
   */
  private sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '-');
  }

  /**
   * 创建 Stub 笔记内容
   */
  private createStubContent(frontmatter: CRFrontmatter, data: StandardizedConcept): string {
    const yamlLines = [
      '---',
      `uid: ${frontmatter.uid}`,
      `type: ${frontmatter.type}`,
      `status: ${frontmatter.status}`,
      `created: ${frontmatter.created}`,
      `updated: ${frontmatter.updated}`,
    ];

    if (frontmatter.aliases && frontmatter.aliases.length > 0) {
      yamlLines.push(`aliases:`);
      frontmatter.aliases.forEach(alias => {
        yamlLines.push(`  - ${alias}`);
      });
    }

    yamlLines.push('---');
    yamlLines.push('');

    // 添加标题
    yamlLines.push(`# ${data.standardName.chinese}`);
    yamlLines.push('');

    // 添加英文名
    yamlLines.push(`**English**: ${data.standardName.english}`);
    yamlLines.push('');

    // 添加核心定义（如果有）
    if (data.coreDefinition) {
      yamlLines.push(`## 核心定义`);
      yamlLines.push('');
      yamlLines.push(data.coreDefinition);
      yamlLines.push('');
    }

    // 添加占位符
    yamlLines.push(`## 详细说明`);
    yamlLines.push('');
    yamlLines.push('_内容生成中..._');
    yamlLines.push('');

    return yamlLines.join('\n');
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
    sortedDuplicates.forEach(pair => {
      const card = this.duplicatesContainer!.createDiv({ cls: "cr-duplicate-card" });
      
      // 选择框
      const checkbox = card.createEl("input", {
        type: "checkbox",
        cls: "cr-duplicate-checkbox",
        attr: { "aria-label": `选择重复对 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      checkbox.checked = this.selectedDuplicates.has(pair.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedDuplicates.add(pair.id);
        } else {
          this.selectedDuplicates.delete(pair.id);
        }
      });

      // 卡片内容
      const content = card.createDiv({ cls: "cr-duplicate-content cr-clickable" });
      
      // 标题行
      const titleRow = content.createDiv({ cls: "cr-duplicate-title-row" });
      titleRow.createEl("div", {
        text: `${pair.noteA.name} ↔ ${pair.noteB.name}`,
        cls: "cr-duplicate-names"
      });
      
      // 元信息行
      const metaRow = content.createDiv({ cls: "cr-duplicate-meta-row" });
      
      // 相似度指示器
      const similarityBar = metaRow.createDiv({ cls: "cr-similarity-bar" });
      const similarityFill = similarityBar.createDiv({ cls: "cr-similarity-fill" });
      similarityFill.style.width = `${pair.similarity * 100}%`;
      
      const similarityText = metaRow.createEl("span", {
        text: `${(pair.similarity * 100).toFixed(1)}%`,
        cls: "cr-similarity-text"
      });

      const typeTag = metaRow.createEl("span", {
        text: pair.type,
        cls: "cr-type-tag"
      });

      const timeText = metaRow.createEl("span", {
        text: this.formatTime(pair.detectedAt),
        cls: "cr-time-text"
      });

      // 点击内容区域显示预览
      content.addEventListener("click", () => {
        this.handleShowDuplicatePreview(pair);
      });

      // 操作按钮
      const actions = card.createDiv({ cls: "cr-duplicate-card-actions" });
      
      const mergeBtn = actions.createEl("button", {
        text: "合并",
        cls: "mod-cta cr-btn-small",
        attr: { "aria-label": `合并 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      mergeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleMergeDuplicate(pair);
      });

      const dismissBtn = actions.createEl("button", {
        text: "忽略",
        cls: "cr-btn-small",
        attr: { "aria-label": `忽略重复对 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      dismissBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleDismissDuplicate(pair);
      });
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
      new Notice("请先选择要合并的重复对");
      return;
    }

    const count = this.selectedDuplicates.size;
    const confirmed = await this.showConfirmDialog(
      "批量合并确认",
      `确定要合并选中的 ${count} 个重复对吗？这将创建 ${count} 个合并任务。`
    );

    if (!confirmed) return;

    let successCount = 0;
    let failCount = 0;

    for (const pairId of this.selectedDuplicates) {
      const pair = this.allDuplicates.find(p => p.id === pairId);
      if (pair && this.mergeHandler) {
        const result = await this.mergeHandler.createMergeTask(pair);
        if (result.ok) {
          successCount++;
        } else {
          failCount++;
        }
      }
    }

    new Notice(`批量合并完成：成功 ${successCount} 个，失败 ${failCount} 个`);
    this.selectedDuplicates.clear();
    this.refreshDuplicates();
  }

  /**
   * 批量忽略
   */
  private async handleBatchDismiss(): Promise<void> {
    if (this.selectedDuplicates.size === 0) {
      new Notice("请先选择要忽略的重复对");
      return;
    }

    const count = this.selectedDuplicates.size;
    const confirmed = await this.showConfirmDialog(
      "批量忽略确认",
      `确定要忽略选中的 ${count} 个重复对吗？`
    );

    if (!confirmed) return;

    if (!this.plugin) {
      new Notice("插件未初始化");
      return;
    }

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;

    if (!duplicateManager) {
      new Notice("重复管理器未初始化");
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

    new Notice(`批量忽略完成：成功 ${successCount} 个，失败 ${failCount} 个`);
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
        new Notice(`文件不存在: ${pair.noteA.path}`);
        return;
      }

      if (!fileB || !(fileB instanceof TFile)) {
        new Notice(`文件不存在: ${pair.noteB.path}`);
        return;
      }

      const contentA = await this.app.vault.read(fileA);
      const contentB = await this.app.vault.read(fileB);

      // 创建预览模态框
      this.showDuplicatePreviewModal(pair, contentA, contentB);
    } catch (error) {
      console.error("显示预览失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`显示预览失败: ${errorMessage}`);
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
      text: "暂无重复概念",
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
   */
  private renderQueueStatus(status: QueueStatus): void {
    if (!this.queueStatusContainer) return;

    this.queueStatusContainer.empty();

    const grid = this.queueStatusContainer.createDiv({ cls: "cr-queue-grid" });

    // 状态指示器
    const statusIndicator = grid.createDiv({ cls: "cr-queue-indicator" });
    const statusIcon = statusIndicator.createEl("span", {
      cls: status.paused ? "cr-status-paused" : "cr-status-active",
      attr: { "aria-label": status.paused ? "队列已暂停" : "队列运行中" }
    });
    statusIcon.textContent = status.paused ? "⏸" : "▶";
    statusIndicator.createEl("span", {
      text: status.paused ? "已暂停" : "运行中"
    });

    // 统计信息
    this.createStatItem(grid, "等待中", status.pending, "cr-stat-pending");
    this.createStatItem(grid, "执行中", status.running, "cr-stat-running");
    this.createStatItem(grid, "已完成", status.completed, "cr-stat-completed");
    this.createStatItem(grid, "失败", status.failed, "cr-stat-failed");

    // 操作按钮
    const actions = this.queueStatusContainer.createDiv({ cls: "cr-queue-actions" });
    
    const toggleBtn = actions.createEl("button", {
      text: status.paused ? "恢复" : "暂停",
      attr: { "aria-label": status.paused ? "恢复队列" : "暂停队列" }
    });
    toggleBtn.addEventListener("click", () => {
      this.handleToggleQueue();
    });

    const viewBtn = actions.createEl("button", {
      text: "查看详情",
      attr: { "aria-label": "查看队列详情" }
    });
    viewBtn.addEventListener("click", () => {
      this.handleViewQueue();
    });
  }

  /**
   * 创建统计项
   */
  private createStatItem(
    container: HTMLElement,
    label: string,
    value: number,
    className: string
  ): void {
    const item = container.createDiv({ cls: `cr-stat-item ${className}` });
    item.createEl("div", { text: value.toString(), cls: "cr-stat-value" });
    item.createEl("div", { text: label, cls: "cr-stat-label" });
  }

  /**
   * 渲染空最近操作
   */
  private renderEmptyRecentOps(): void {
    if (!this.recentOpsContainer) return;
    
    this.recentOpsContainer.createEl("div", {
      text: "暂无最近操作",
      cls: "cr-empty-state"
    });
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
          text: "撤销",
          cls: "cr-undo-btn",
          attr: { "aria-label": `撤销操作: ${op.description}` }
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
   * 处理合并重复概念
   */
  private async handleMergeDuplicate(pair: DuplicatePair): Promise<void> {
    if (!this.mergeHandler) {
      new Notice("合并处理器未初始化");
      return;
    }

    // 调用 MergeHandler 创建合并任务
    const result = await this.mergeHandler.createMergeTask(pair);
    if (!result.ok) {
      new Notice(`创建合并任务失败: ${result.error.message}`);
      return;
    }

    new Notice("合并任务已创建");
    
    // 刷新重复列表
    this.refreshDuplicates();
  }

  /**
   * 处理忽略重复概念
   */
  private async handleDismissDuplicate(pair: DuplicatePair): Promise<void> {
    if (!this.plugin) {
      new Notice("插件未初始化");
      return;
    }

    try {
      // 获取 DuplicateManager
      const components = this.plugin.getComponents();
      const duplicateManager = components.duplicateManager;

      if (!duplicateManager) {
        new Notice("重复管理器未初始化");
        return;
      }

      // 更新状态为 dismissed
      const result = await duplicateManager.updateStatus(pair.id, "dismissed");
      
      if (!result.ok) {
        new Notice(`忽略失败: ${result.error.message}`);
        return;
      }

      new Notice(`已忽略重复对: ${pair.noteA.name} ↔ ${pair.noteB.name}`);
      
      // 刷新重复列表
      this.refreshDuplicates();
    } catch (error) {
      console.error("忽略重复对失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`忽略失败: ${errorMessage}`);
    }
  }

  /**
   * 刷新重复列表
   */
  private async refreshDuplicates(): Promise<void> {
    if (!this.plugin) return;

    try {
      const components = this.plugin.getComponents();
      const duplicateManager = components.duplicateManager;

      if (!duplicateManager) return;

      // 获取待处理的重复对
      const result = await duplicateManager.getPendingPairs();
      
      if (result.ok) {
        this.updateDuplicates(result.value);
      }
    } catch (error) {
      console.error("刷新重复列表失败:", error);
    }
  }

  /**
   * 处理切换队列状态
   */
  private handleToggleQueue(): void {
    if (!this.plugin) {
      new Notice("插件未初始化");
      return;
    }

    const taskQueue = this.plugin.getComponents().taskQueue;
    const status = taskQueue.getStatus();
    
    if (status.paused) {
      taskQueue.resume();
      new Notice("队列已恢复运行");
    } else {
      taskQueue.pause();
      new Notice("队列已暂停");
    }
    
    // 刷新显示
    this.updateQueueStatus(taskQueue.getStatus());
  }

  /**
   * 处理查看队列详情
   */
  private handleViewQueue(): void {
    if (!this.plugin) {
      new Notice("插件未初始化");
      return;
    }

    // 打开队列视图
    this.plugin.app.workspace.getRightLeaf(false)?.setViewState({
      type: QUEUE_VIEW_TYPE,
      active: true,
    });
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
      // 恢复快照内容到文件
      const snapshot = result.value;
      try {
        const file = this.plugin.app.vault.getAbstractFileByPath(snapshot.filePath);
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
export interface RecentOperation {
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
    diffView.createEl("div", {
      text: "差异高亮功能开发中...",
      cls: "cr-placeholder-text"
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

    let pairsResult;
    if (this.currentTab === "merged") {
      pairsResult = await duplicateManager.getMergedPairs();
    } else {
      pairsResult = await duplicateManager.getDismissedPairs();
    }

    if (!pairsResult.ok) {
      this.listContainer.createEl("p", {
        text: `加载失败: ${pairsResult.error.message}`,
        cls: "cr-error-text"
      });
      return;
    }

    const pairs = pairsResult.value;

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
