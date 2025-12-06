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
import type CognitiveRazorPlugin from "../../main";

export const QUEUE_VIEW_TYPE = "cognitive-razor-queue";

/**
 * QueueView 组件
 */
export class QueueView extends ItemView {
  private plugin: CognitiveRazorPlugin | null = null;
  private tasksContainer: HTMLElement | null = null;
  private filterState: TaskState | "all" = "all";
  private concurrencyInput: HTMLInputElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private expandedTaskIds: Set<string> = new Set();

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  /**
   * 设置插件实例
   */
  setPlugin(plugin: CognitiveRazorPlugin): void {
    this.plugin = plugin;
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

    const currentConcurrency = this.plugin?.getComponents().settings.concurrency || 3;
    this.concurrencyInput = concurrencySection.createEl("input", {
      type: "number",
      cls: "cr-concurrency-input",
      attr: {
        id: "cr-concurrency-input",
        min: "1",
        max: "10",
        value: String(currentConcurrency),
        "aria-label": "并发任务数"
      }
    });

    this.concurrencyInput.addEventListener("change", () => {
      this.handleConcurrencyChange();
    });

    // 全局操作按钮
    const actions = header.createDiv({ cls: "cr-header-actions" });

    const status = this.plugin?.getComponents().taskQueue.getStatus();
    const isPaused = status?.paused || false;

    this.pauseBtn = actions.createEl("button", {
      text: isPaused ? "恢复队列" : "暂停队列",
      attr: { "aria-label": isPaused ? "恢复队列" : "暂停队列" }
    });
    this.pauseBtn.addEventListener("click", () => {
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
    const isExpanded = this.expandedTaskIds.has(task.id);
    
    const item = container.createDiv({
      cls: `cr-task-item cr-task-${task.state.toLowerCase()}`
    });

    // 任务信息
    const info = item.createDiv({ cls: "cr-task-info" });
    
    // 任务类型和 ID（可点击展开）
    const header = info.createDiv({ cls: "cr-task-header" });
    header.style.cursor = "pointer";
    
    const expandIcon = header.createEl("span", {
      text: isExpanded ? "▼" : "▶",
      cls: "cr-expand-icon"
    });
    
    header.createEl("span", {
      text: this.getTaskTypeLabel(task.taskType),
      cls: "cr-task-type"
    });
    header.createEl("span", {
      text: task.id.substring(0, 8),
      cls: "cr-task-id"
    });

    // 点击展开/收起
    header.addEventListener("click", () => {
      this.handleTaskClick(task.id);
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

    if (task.created) {
      meta.createEl("span", {
        text: `创建: ${this.formatTimestamp(task.created)}`,
        cls: "cr-task-time"
      });
    }

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

    // 展开的详情
    if (isExpanded) {
      const details = info.createDiv({ cls: "cr-task-details" });
      
      // Payload
      if (task.payload && Object.keys(task.payload).length > 0) {
        details.createEl("h4", { text: "任务载荷" });
        const payloadPre = details.createEl("pre", { cls: "cr-task-payload" });
        payloadPre.textContent = JSON.stringify(task.payload, null, 2);
      }

      // Result
      if (task.result && Object.keys(task.result).length > 0) {
        details.createEl("h4", { text: "任务结果" });
        const resultPre = details.createEl("pre", { cls: "cr-task-result" });
        resultPre.textContent = JSON.stringify(task.result, null, 2);
      }

      // 错误历史
      if (task.errors && task.errors.length > 0) {
        details.createEl("h4", { text: "错误历史" });
        const errorsList = details.createEl("ul", { cls: "cr-error-history" });
        task.errors.forEach(error => {
          const errorItem = errorsList.createEl("li");
          errorItem.createEl("span", {
            text: `[${error.code}] ${error.message}`,
            cls: "cr-error-text"
          });
          errorItem.createEl("span", {
            text: ` (尝试 ${error.attempt}, ${this.formatTimestamp(error.timestamp)})`,
            cls: "cr-error-meta"
          });
        });
      }
    }

    // 操作按钮
    const actions = item.createDiv({ cls: "cr-task-actions" });

    if (task.state === "Running" || task.state === "Pending") {
      const cancelBtn = actions.createEl("button", {
        text: "取消",
        cls: "cr-btn-cancel",
        attr: { "aria-label": `取消任务 ${task.id}` }
      });
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleCancelTask(task.id);
      });
    }

    if (task.state === "Failed") {
      const retryBtn = actions.createEl("button", {
        text: "重试",
        cls: "cr-btn-retry mod-cta",
        attr: { "aria-label": `重试任务 ${task.id}` }
      });
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleRetryTask(task.id);
      });
    }
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
    if (!this.concurrencyInput || !this.plugin) return;

    const value = parseInt(this.concurrencyInput.value);
    if (isNaN(value) || value < 1 || value > 10) {
      new Notice("并发数必须在 1-10 之间");
      const currentConcurrency = this.plugin.getComponents().settings.concurrency;
      this.concurrencyInput.value = String(currentConcurrency);
      return;
    }

    // 更新设置
    const components = this.plugin.getComponents();
    components.settings.concurrency = value;
    components.settingsStore.save();

    new Notice(`并发数已设置为 ${value}`);
  }

  /**
   * 处理暂停/恢复队列
   */
  private handlePauseQueue(): void {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const status = taskQueue.getStatus();

    if (status.paused) {
      taskQueue.resume();
      new Notice("队列已恢复");
      if (this.pauseBtn) {
        this.pauseBtn.textContent = "暂停队列";
        this.pauseBtn.setAttribute("aria-label", "暂停队列");
      }
    } else {
      taskQueue.pause();
      new Notice("队列已暂停");
      if (this.pauseBtn) {
        this.pauseBtn.textContent = "恢复队列";
        this.pauseBtn.setAttribute("aria-label", "恢复队列");
      }
    }
  }

  /**
   * 处理清空已完成任务
   */
  private async handleClearCompleted(): Promise<void> {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    
    // 清理 7 天前完成的任务
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const result = await taskQueue.cleanupCompletedTasks(sevenDaysAgo);
    
    if (result.ok) {
      new Notice(`已清理 ${result.value} 个已完成任务`);
      this.refresh();
    } else {
      new Notice(`清理失败: ${result.error.message}`);
    }
  }

  /**
   * 处理过滤变更
   */
  private handleFilterChange(): void {
    if (!this.plugin) return;
    
    // 重新获取并显示任务列表
    this.refresh();
  }

  /**
   * 处理取消任务
   */
  private async handleCancelTask(taskId: string): Promise<void> {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const result = await taskQueue.cancel(taskId);

    if (result.ok) {
      new Notice("任务已取消");
      this.refresh();
    } else {
      new Notice(`取消失败: ${result.error.message}`);
    }
  }

  /**
   * 处理重试任务
   */
  private async handleRetryTask(taskId: string): Promise<void> {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const task = taskQueue.getTask(taskId);
    
    if (!task) {
      new Notice("任务不存在");
      return;
    }

    // 创建新任务（相同 payload）
    const result = await taskQueue.enqueue({
      nodeId: task.nodeId,
      taskType: task.taskType,
      providerRef: task.providerRef,
      promptRef: task.promptRef,
      maxAttempts: task.maxAttempts,
      payload: task.payload,
    });

    if (result.ok) {
      new Notice("任务已重新入队");
      this.refresh();
    } else {
      new Notice(`重试失败: ${result.error.message}`);
    }
  }

  /**
   * 处理任务点击（展开/收起详情）
   */
  private handleTaskClick(taskId: string): void {
    if (this.expandedTaskIds.has(taskId)) {
      this.expandedTaskIds.delete(taskId);
    } else {
      this.expandedTaskIds.add(taskId);
    }
    
    // 刷新显示
    this.refresh();
  }

  /**
   * 刷新视图
   */
  public refresh(): void {
    if (!this.plugin) return;

    const taskQueue = this.plugin.getComponents().taskQueue;
    const tasks = taskQueue.getAllTasks();
    
    this.updateTasks(tasks);
  }
}
