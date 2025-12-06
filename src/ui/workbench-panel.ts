/**
 * WorkbenchPanel - 统一工作台面板
 * 
 * 功能：
 * - 创建概念区域
 * - 重复概念面板
 * - 队列状态区域
 * - 最近操作区域
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { DuplicatePair, QueueStatus } from "../types";
import type { MergeHandler } from "../core/merge-handler";

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

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
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
    
    const createBtn = buttonContainer.createEl("button", {
      text: "创建概念",
      cls: "mod-cta",
      attr: {
        "aria-label": "创建概念"
      }
    });

    createBtn.addEventListener("click", () => {
      this.handleCreateConcept();
    });

    // 支持 Enter 键触发
    this.conceptInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleCreateConcept();
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
   * 处理创建概念
   */
  private handleCreateConcept(): void {
    if (!this.conceptInput) return;

    const description = this.conceptInput.value.trim();
    if (!description) {
      new Notice("请输入概念描述");
      return;
    }

    // TODO: 调用 TaskQueue 创建标准化任务
    new Notice("创建概念功能待实现");
    
    // 清空输入
    this.conceptInput.value = "";
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
      
      // 概念信息
      const info = item.createDiv({ cls: "cr-duplicate-info" });
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

      // 操作按钮
      const actions = item.createDiv({ cls: "cr-duplicate-actions" });
      
      const mergeBtn = actions.createEl("button", {
        text: "合并",
        cls: "mod-cta",
        attr: { "aria-label": `合并 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      mergeBtn.addEventListener("click", () => {
        this.handleMergeDuplicate(pair);
      });

      const dismissBtn = actions.createEl("button", {
        text: "忽略",
        attr: { "aria-label": `忽略重复对 ${pair.noteA.name} 和 ${pair.noteB.name}` }
      });
      dismissBtn.addEventListener("click", () => {
        this.handleDismissDuplicate(pair);
      });
    });
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
    }
  }

  /**
   * 处理忽略重复概念
   */
  private async handleDismissDuplicate(pair: DuplicatePair): Promise<void> {
    if (!this.mergeHandler) {
      new Notice("合并处理器未初始化");
      return;
    }

    // 调用 DuplicateManager 标记为已忽略
    // 注意：这里需要访问 DuplicateManager，暂时通过 MergeHandler 访问
    new Notice(`忽略功能待实现: ${pair.id}`);
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
