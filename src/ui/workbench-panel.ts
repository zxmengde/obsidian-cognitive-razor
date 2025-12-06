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
  StandardizedConcept
} from "../types";
import type { MergeHandler } from "../core/merge-handler";
import type { TaskQueue } from "../core/task-queue";
import type CognitiveRazorPlugin from "../../main";

export const WORKBENCH_VIEW_TYPE = "cognitive-razor-workbench";

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
    
    // 标题
    const header = section.createDiv({ cls: "cr-section-header" });
    header.createEl("h3", { text: "重复概念" });
    
    const badge = header.createEl("span", {
      cls: "cr-badge",
      attr: { "aria-label": "重复概念数量" }
    });
    badge.textContent = "0";

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
   * 处理标准化
   */
  private async handleStandardize(): Promise<void> {
    if (!this.conceptInput || !this.taskQueue) {
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
      // 创建标准化任务
      const taskResult = await this.taskQueue.enqueue({
        nodeId: `temp-${Date.now()}`, // 临时 ID，因为还没有创建笔记
        taskType: "standardizeClassify",
        payload: {
          description,
        },
      });

      if (!taskResult.ok) {
        new Notice(`创建标准化任务失败: ${taskResult.error.message}`);
        return;
      }

      new Notice("标准化任务已创建，请稍候...");

      // 订阅任务完成事件
      const unsubscribe = this.taskQueue.subscribe((event) => {
        if (event.taskId === taskResult.value && event.type === "task-completed") {
          unsubscribe();
          this.handleStandardizeComplete(taskResult.value);
        } else if (event.taskId === taskResult.value && event.type === "task-failed") {
          unsubscribe();
          new Notice("标准化任务失败");
          this.resetStandardizeButton();
        }
      });
    } catch (error) {
      new Notice(`标准化失败: ${error instanceof Error ? error.message : String(error)}`);
      this.resetStandardizeButton();
    }
  }

  /**
   * 处理标准化完成
   */
  private handleStandardizeComplete(taskId: string): void {
    if (!this.taskQueue) return;

    const task = this.taskQueue.getTask(taskId);
    if (!task || !task.result) {
      new Notice("无法获取标准化结果");
      this.resetStandardizeButton();
      return;
    }

    // 解析标准化结果
    this.standardizedData = task.result as unknown as StandardizedConcept;

    // 显示标准化结果
    this.renderStandardizedResult();

    // 重置标准化按钮
    this.resetStandardizeButton();

    new Notice("标准化完成");
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

    this.duplicatesContainer.empty();

    // 更新徽章数量
    const badge = this.containerEl.querySelector(".cr-duplicates .cr-badge");
    if (badge) {
      badge.textContent = duplicates.length.toString();
    }

    if (duplicates.length === 0) {
      this.renderEmptyDuplicates();
      return;
    }

    // 渲染重复对列表
    duplicates.forEach(pair => {
      const item = this.duplicatesContainer!.createDiv({ cls: "cr-duplicate-item" });
      
      // 概念信息（可点击）
      const info = item.createDiv({ cls: "cr-duplicate-info cr-clickable" });
      info.createEl("div", {
        text: `${pair.noteA.name} ↔ ${pair.noteB.name}`,
        cls: "cr-duplicate-names"
      });
      
      const meta = info.createDiv({ cls: "cr-duplicate-meta" });
      meta.createEl("span", {
        text: `相似度: ${(pair.similarity * 100).toFixed(1)}%`,
        cls: "cr-similarity"
      });
      meta.createEl("span", {
        text: pair.type,
        cls: "cr-type-badge"
      });

      // 点击信息区域显示预览
      info.addEventListener("click", () => {
        this.handleShowDuplicatePreview(pair);
      });

      // 操作按钮
      const actions = item.createDiv({ cls: "cr-duplicate-actions" });
      
      const mergeBtn = actions.createEl("button", {
        text: "合并",
        cls: "mod-cta",
        attr: { "aria-label": `合并 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      mergeBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // 防止触发预览
        this.handleMergeDuplicate(pair);
      });

      const dismissBtn = actions.createEl("button", {
        text: "忽略",
        attr: { "aria-label": `忽略重复对 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      dismissBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // 防止触发预览
        this.handleDismissDuplicate(pair);
      });
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
    // TODO: 调用 TaskQueue 切换暂停/恢复
    new Notice("切换队列状态功能待实现");
  }

  /**
   * 处理查看队列详情
   */
  private handleViewQueue(): void {
    // TODO: 打开 QueueView
    new Notice("查看队列详情功能待实现");
  }

  /**
   * 处理撤销操作
   */
  private handleUndo(operationId: string): void {
    // TODO: 调用 UndoManager 执行撤销
    new Notice(`撤销功能待实现: ${operationId}`);
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
 * 重复对预览模态框
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

    // 标题
    contentEl.createEl("h2", {
      text: "重复概念预览",
      cls: "cr-modal-title"
    });

    // 元信息
    const metaContainer = contentEl.createDiv({ cls: "cr-preview-meta" });
    metaContainer.createEl("div", {
      text: `类型: ${this.pair.type}`,
      cls: "cr-meta-item"
    });
    metaContainer.createEl("div", {
      text: `相似度: ${(this.pair.similarity * 100).toFixed(1)}%`,
      cls: "cr-meta-item"
    });
    metaContainer.createEl("div", {
      text: `检测时间: ${new Date(this.pair.detectedAt).toLocaleString()}`,
      cls: "cr-meta-item"
    });

    // 预览容器
    const previewContainer = contentEl.createDiv({ cls: "cr-preview-container" });

    // 笔记 A 预览
    const previewA = previewContainer.createDiv({ cls: "cr-preview-pane" });
    previewA.createEl("h3", { text: this.pair.noteA.name });
    previewA.createEl("div", {
      text: this.pair.noteA.path,
      cls: "cr-preview-path"
    });
    const contentAEl = previewA.createEl("pre", { cls: "cr-preview-content" });
    contentAEl.textContent = this.contentA;

    // 笔记 B 预览
    const previewB = previewContainer.createDiv({ cls: "cr-preview-pane" });
    previewB.createEl("h3", { text: this.pair.noteB.name });
    previewB.createEl("div", {
      text: this.pair.noteB.path,
      cls: "cr-preview-path"
    });
    const contentBEl = previewB.createEl("pre", { cls: "cr-preview-content" });
    contentBEl.textContent = this.contentB;

    // 按钮区域
    const buttonContainer = contentEl.createDiv({ cls: "cr-modal-buttons" });

    const mergeBtn = buttonContainer.createEl("button", {
      text: "合并",
      cls: "mod-cta"
    });
    mergeBtn.addEventListener("click", () => {
      this.close();
      this.onMerge();
    });

    const dismissBtn = buttonContainer.createEl("button", {
      text: "忽略"
    });
    dismissBtn.addEventListener("click", () => {
      this.close();
      this.onDismiss();
    });

    const cancelBtn = buttonContainer.createEl("button", {
      text: "取消"
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
