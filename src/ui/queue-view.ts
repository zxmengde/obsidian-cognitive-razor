/**
 * QueueView - 任务队列详情视图
 * 
 * 功能：
 * - 任务列表显示
 * - 任务操作（取消、重试）
 * - 并发控制
 */

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { TaskRecord, TaskState, QueueStatus } from "../types";

export const QUEUE_VIEW_TYPE = "cognitive-razor-queue";

/**
 * QueueView 组件
 */
export class QueueView extends ItemView {
  private tasksContainer: HTMLElement | null = null;
  private filterState: TaskState | "all" = "all";
  private concurrencyInput: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return QUEUE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "任务队列";
  }

  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cr-queue-view");

    // 渲染头部控制区
    this.renderHeader(container);

    // 渲染过滤器
    this.renderFilters(container);

    // 渲染任务列表
    this.tasksContainer = container.createDiv({ cls: "cr-tasks-container" });
    this.renderEmptyState();
  }

  async onClose(): Promise<void> {
    // 清理资源
    this.tasksContainer = null;
    this.concurrencyInput = null;
  }

  /**
   * 渲染头部控制区
   */
  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "cr-queue-header" });

    // 标题和状态
    const titleSection = header.createDiv({ cls: "cr-header-title" });
    titleSection.createEl("h2", { text: "任务队列" });

    // 并发控制
    const concurrencySection = header.createDiv({ cls: "cr-concurrency-control" });
    concurrencySection.createEl("label", {
      text: "并发数:",
      attr: { for: "cr-concurrency-input" }
    });

    this.concurrencyInput = concurrencySection.createEl("input", {
      type: "number",
      cls: "cr-concurrency-input",
      attr: {
        id: "cr-concurrency-input",
        min: "1",
        max: "10",
        value: "3",
        "aria-label": "并发任务数"
      }
    });

    this.concurrencyInput.addEventListener("change", () => {
      this.handleConcurrencyChange();
    });

    // 全局操作按钮
    const actions = header.createDiv({ cls: "cr-header-actions" });

    const pauseBtn = actions.createEl("button", {
      text: "暂停队列",
      attr: { "aria-label": "暂停队列" }
    });
    pauseBtn.addEventListener("click", () => {
      this.handlePauseQueue();
    });

    const clearBtn = actions.createEl("button", {
      text: "清空已完成",
      attr: { "aria-label": "清空已完成任务" }
    });
    clearBtn.addEventListener("click", () => {
      this.handleClearCompleted();
    });
  }

  /**
   * 渲染过滤器
   */
  private renderFilters(container: HTMLElement): void {
    const filters = container.createDiv({ cls: "cr-filters" });

    const filterOptions: Array<{ value: TaskState | "all"; label: string }> = [
      { value: "all", label: "全部" },
      { value: "Pending", label: "等待中" },
      { value: "Running", label: "执行中" },
      { value: "Completed", label: "已完成" },
      { value: "Failed", label: "失败" },
      { value: "Cancelled", label: "已取消" }
    ];

    filterOptions.forEach(option => {
      const btn = filters.createEl("button", {
        text: option.label,
        cls: option.value === this.filterState ? "cr-filter-active" : "",
        attr: { "aria-label": `筛选${option.label}任务` }
      });

      btn.addEventListener("click", () => {
        this.filterState = option.value;
        this.updateFilterButtons();
        this.handleFilterChange();
      });
    });
  }

  /**
   * 更新过滤按钮状态
   */
  private updateFilterButtons(): void {
    const filters = this.containerEl.querySelector(".cr-filters");
    if (!filters) return;

    const buttons = filters.querySelectorAll("button");
    buttons.forEach((btn, index) => {
      const filterOptions: Array<TaskState | "all"> = [
        "all", "Pending", "Running", "Completed", "Failed", "Cancelled"
      ];
      
      if (filterOptions[index] === this.filterState) {
        btn.addClass("cr-filter-active");
      } else {
        btn.removeClass("cr-filter-active");
      }
    });
  }

  /**
   * 更新任务列表
   */
  public updateTasks(tasks: TaskRecord[]): void {
    if (!this.tasksContainer) return;

    this.tasksContainer.empty();

    // 应用过滤
    const filteredTasks = this.filterState === "all"
      ? tasks
      : tasks.filter(t => t.state === this.filterState);

    if (filteredTasks.length === 0) {
      this.renderEmptyState();
      return;
    }

    // 按状态分组
    const groups = this.groupTasksByState(filteredTasks);

    // 渲染每个分组
    Object.entries(groups).forEach(([state, stateTasks]) => {
      if (stateTasks.length === 0) return;

      const group = this.tasksContainer!.createDiv({ cls: "cr-task-group" });
      group.createEl("h3", {
        text: `${this.getStateLabel(state as TaskState)} (${stateTasks.length})`,
        cls: "cr-group-title"
      });

      const list = group.createDiv({ cls: "cr-task-list" });
      stateTasks.forEach(task => {
        this.renderTaskItem(list, task);
      });
    });
  }

  /**
   * 渲染单个任务项
   */
  private renderTaskItem(container: HTMLElement, task: TaskRecord): void {
    const item = container.createDiv({
      cls: `cr-task-item cr-task-${task.state.toLowerCase()}`
    });

    // 任务信息
    const info = item.createDiv({ cls: "cr-task-info" });
    
    // 任务类型和 ID
    const header = info.createDiv({ cls: "cr-task-header" });
    header.createEl("span", {
      text: this.getTaskTypeLabel(task.taskType),
      cls: "cr-task-type"
    });
    header.createEl("span", {
      text: task.id.substring(0, 8),
      cls: "cr-task-id"
    });

    // 节点信息
    info.createEl("div", {
      text: `节点: ${task.nodeId}`,
      cls: "cr-task-node"
    });

    // 状态和时间
    const meta = info.createDiv({ cls: "cr-task-meta" });
    meta.createEl("span", {
      text: this.getStateLabel(task.state),
      cls: `cr-state-badge cr-state-${task.state.toLowerCase()}`
    });

    if (task.startedAt) {
      meta.createEl("span", {
        text: `开始: ${this.formatTimestamp(task.startedAt)}`,
        cls: "cr-task-time"
      });
    }

    if (task.completedAt) {
      meta.createEl("span", {
        text: `完成: ${this.formatTimestamp(task.completedAt)}`,
        cls: "cr-task-time"
      });
    }

    // 重试信息
    if (task.attempt > 0) {
      meta.createEl("span", {
        text: `重试: ${task.attempt}/${task.maxAttempts}`,
        cls: "cr-task-retry"
      });
    }

    // 错误信息
    if (task.errors && task.errors.length > 0) {
      const lastError = task.errors[task.errors.length - 1];
      const errorDiv = info.createDiv({ cls: "cr-task-error" });
      errorDiv.createEl("span", { text: "错误: ", cls: "cr-error-label" });
      errorDiv.createEl("span", {
        text: `[${lastError.code}] ${lastError.message}`,
        cls: "cr-error-message"
      });
    }

    // 操作按钮
    const actions = item.createDiv({ cls: "cr-task-actions" });

    if (task.state === "Running" || task.state === "Pending") {
      const cancelBtn = actions.createEl("button", {
        text: "取消",
        cls: "cr-btn-cancel",
        attr: { "aria-label": `取消任务 ${task.id}` }
      });
      cancelBtn.addEventListener("click", () => {
        this.handleCancelTask(task.id);
      });
    }

    if (task.state === "Failed") {
      const retryBtn = actions.createEl("button", {
        text: "重试",
        cls: "cr-btn-retry mod-cta",
        attr: { "aria-label": `重试任务 ${task.id}` }
      });
      retryBtn.addEventListener("click", () => {
        this.handleRetryTask(task.id);
      });
    }

    // 详情按钮
    const detailsBtn = actions.createEl("button", {
      text: "详情",
      attr: { "aria-label": `查看任务详情 ${task.id}` }
    });
    detailsBtn.addEventListener("click", () => {
      this.handleViewTaskDetails(task);
    });
  }

  /**
   * 按状态分组任务
   */
  private groupTasksByState(tasks: TaskRecord[]): Record<TaskState, TaskRecord[]> {
    const groups: Record<TaskState, TaskRecord[]> = {
      Pending: [],
      Running: [],
      Completed: [],
      Failed: [],
      Cancelled: []
    };

    tasks.forEach(task => {
      groups[task.state].push(task);
    });

    return groups;
  }

  /**
   * 渲染空状态
   */
  private renderEmptyState(): void {
    if (!this.tasksContainer) return;

    const emptyState = this.tasksContainer.createDiv({ cls: "cr-empty-state" });
    emptyState.createEl("div", {
      text: "暂无任务",
      cls: "cr-empty-text"
    });
    emptyState.createEl("div", {
      text: "创建概念后任务将显示在这里",
      cls: "cr-empty-hint"
    });
  }

  /**
   * 获取任务类型标签
   */
  private getTaskTypeLabel(taskType: string): string {
    const labels: Record<string, string> = {
      "embedding": "向量嵌入",
      "standardizeClassify": "标准化分类",
      "enrich": "内容生成",
      "reason:new": "新概念推理",
      "reason:incremental": "增量改进",
      "reason:merge": "合并推理",
      "ground": "接地验证"
    };
    return labels[taskType] || taskType;
  }

  /**
   * 获取状态标签
   */
  private getStateLabel(state: TaskState): string {
    const labels: Record<TaskState, string> = {
      Pending: "等待中",
      Running: "执行中",
      Completed: "已完成",
      Failed: "失败",
      Cancelled: "已取消"
    };
    return labels[state];
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  /**
   * 处理并发数变更
   */
  private handleConcurrencyChange(): void {
    if (!this.concurrencyInput) return;

    const value = parseInt(this.concurrencyInput.value);
    if (isNaN(value) || value < 1 || value > 10) {
      new Notice("并发数必须在 1-10 之间");
      this.concurrencyInput.value = "3";
      return;
    }

    // TODO: 调用 TaskQueue 更新并发数
    new Notice(`并发数已设置为 ${value}`);
  }

  /**
   * 处理暂停队列
   */
  private handlePauseQueue(): void {
    // TODO: 调用 TaskQueue 暂停/恢复
    new Notice("暂停队列功能待实现");
  }

  /**
   * 处理清空已完成任务
   */
  private handleClearCompleted(): void {
    // TODO: 调用 TaskQueue 清空已完成任务
    new Notice("清空已完成任务功能待实现");
  }

  /**
   * 处理过滤变更
   */
  private handleFilterChange(): void {
    // TODO: 重新获取并显示任务列表
    new Notice(`筛选: ${this.filterState}`);
  }

  /**
   * 处理取消任务
   */
  private handleCancelTask(taskId: string): void {
    // TODO: 调用 TaskQueue 取消任务
    new Notice(`取消任务功能待实现: ${taskId}`);
  }

  /**
   * 处理重试任务
   */
  private handleRetryTask(taskId: string): void {
    // TODO: 调用 TaskQueue 重试任务
    new Notice(`重试任务功能待实现: ${taskId}`);
  }

  /**
   * 处理查看任务详情
   */
  private handleViewTaskDetails(task: TaskRecord): void {
    // TODO: 打开任务详情模态框
    new Notice(`查看任务详情功能待实现: ${task.id}`);
  }

  /**
   * 刷新视图
   */
  public refresh(): void {
    // TODO: 从 TaskQueue 获取最新任务列表并更新显示
    // 这个方法会被 main.ts 中的队列事件监听器调用
  }
}
