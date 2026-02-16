/**
 * QueueSection — 队列区组件
 *
 * 负责显示任务队列状态、任务列表、暂停/恢复等操作。
 * 通过 QueueSectionDeps 注入依赖，不直接依赖 Plugin 实例。
 * 队列无任务时显示空状态提示文本。
 *
 * 需求: 6.1, 8.3
 */

import { Notice, setIcon } from "obsidian";
import type { QueueStatus, TaskRecord, CRType, StandardizedConcept } from "../../types";
import { safeErrorMessage } from "../../types";
import { renderNamingTemplate } from "../../core/naming-utils";
import type { QueueSectionDeps } from "./workbench-section-deps";
import { WorkbenchSection } from "./workbench-section";

export class QueueSection extends WorkbenchSection<QueueSectionDeps> {
  private queueStatusContainer: HTMLElement | null = null;
  private statusDot: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private expandIcon: HTMLElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private detailsContainer: HTMLElement | null = null;

  render(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "cr-queue-wrapper" });

    const statusBar = wrapper.createDiv({ cls: "cr-status-bar" });

    const queueIndicator = statusBar.createDiv({ cls: "cr-queue-indicator cr-clickable" });
    queueIndicator.setAttribute("role", "button");
    queueIndicator.setAttribute("tabindex", "0");
    queueIndicator.setAttribute("aria-expanded", "false");
    queueIndicator.setAttribute("aria-label", this.deps.t("workbench.queueStatus.viewDetails"));
    queueIndicator.setAttribute("data-tooltip-position", "top");

    this.statusDot = queueIndicator.createDiv({ cls: "cr-status-dot is-idle" });
    this.statusText = queueIndicator.createSpan({
      cls: "cr-status-text",
      text: this.deps.t("workbench.queueStatus.noTasks"),
      attr: { "aria-live": "polite" }
    });
    this.expandIcon = queueIndicator.createEl("span", {
      cls: "cr-expand-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(this.expandIcon, "chevron-right");

    const stats = statusBar.createDiv({ cls: "cr-quick-stats" });
    stats.setAttribute("aria-live", "polite");
    this.queueStatusContainer = stats;

    this.pauseBtn = statusBar.createEl("button", {
      cls: "cr-queue-control-btn",
      attr: {
        "aria-label": this.deps.t("workbench.queueStatus.pauseQueue"),
        "data-tooltip-position": "top"
      }
    });
    setIcon(this.pauseBtn, "pause");
    this.pauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.handleTogglePause();
    });

    this.detailsContainer = wrapper.createDiv({ cls: "cr-queue-details" });
    this.detailsContainer.style.display = "none";

    queueIndicator.addEventListener("click", () => {
      if (!this.detailsContainer || !this.expandIcon) {
        return;
      }

      const isExpanded = this.detailsContainer.style.display !== "none";
      if (isExpanded) {
        this.detailsContainer.style.display = "none";
        this.expandIcon.classList.remove("is-expanded");
        queueIndicator.setAttribute("aria-expanded", "false");
      } else {
        this.detailsContainer.style.display = "block";
        this.expandIcon.classList.add("is-expanded");
        queueIndicator.setAttribute("aria-expanded", "true");
        this.renderQueueDetails(this.detailsContainer);
      }
    });

    // 初始化状态显示
    this.renderStatus({
      paused: false,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    });
  }

  /**
   * 从 taskQueue 获取最新状态并更新 UI
   */
  update(): void {
    const status = this.deps.taskQueue.getStatus();
    this.renderStatus(status);
  }

  /**
   * 释放所有 DOM 引用，防止内存泄漏
   */
  dispose(): void {
    this.queueStatusContainer = null;
    this.statusDot = null;
    this.statusText = null;
    this.expandIcon = null;
    this.pauseBtn = null;
    this.detailsContainer = null;
  }

  /**
   * 兼容旧接口：WorkbenchPanel.onClose() 调用
   */
  onClose(): void {
    this.dispose();
  }

  /**
   * 刷新队列详情（如果已展开）
   */
  refreshDetailsIfVisible(): void {
    if (this.detailsContainer && this.detailsContainer.style.display !== "none") {
      this.renderQueueDetails(this.detailsContainer);
    }
  }

  /**
   * 渲染队列状态（紧凑版统计 + 状态指示器）
   */
  private renderStatus(status: QueueStatus): void {
    if (!this.queueStatusContainer) return;

    this.queueStatusContainer.empty();

    const stats = [
      { label: this.deps.t("workbench.queueStatus.pending"), value: status.pending, cls: "pending" },
      { label: this.deps.t("workbench.queueStatus.running"), value: status.running, cls: "running" },
      { label: this.deps.t("workbench.queueStatus.failed"), value: status.failed, cls: "failed" }
    ];

    let renderedCount = 0;
    stats.forEach(stat => {
      if (stat.value > 0) {
        const item = this.queueStatusContainer!.createDiv({ cls: `cr-stat-item cr-stat-${stat.cls}` });
        item.createSpan({ cls: "cr-stat-value", text: stat.value.toString() });
        item.createSpan({ cls: "cr-stat-label", text: stat.label });
        renderedCount++;
      }
    });

    // 空状态：队列无任务时显示提示文本（需求 8.3）
    if (renderedCount === 0) {
      this.queueStatusContainer.createDiv({
        cls: "cr-empty-stat",
        text: this.deps.t("workbench.queueStatus.noTasks")
      });
    }

    this.updateStatusIndicator(status);
  }

  private async handleTogglePause(): Promise<void> {
    try {
      const taskQueue = this.deps.taskQueue;
      const status = taskQueue.getStatus();

      if (status.paused) {
        await taskQueue.resume();
        new Notice(this.deps.t("workbench.queueStatus.queueResumed"));
      } else {
        await taskQueue.pause();
        new Notice(this.deps.t("workbench.queueStatus.queuePaused"));
      }

      const nextStatus = taskQueue.getStatus();
      this.renderStatus(nextStatus);
      this.updatePauseButton(nextStatus.paused);
    } catch (error) {
      this.deps.logError("切换队列暂停状态失败", error);
      this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.cancelFailed")));
    }
  }

  private updatePauseButton(isPaused: boolean): void {
    if (!this.pauseBtn) return;

    this.pauseBtn.empty();
    if (isPaused) {
      setIcon(this.pauseBtn, "play");
      this.pauseBtn.setAttribute("aria-label", this.deps.t("workbench.queueStatus.resumeQueue"));
      this.pauseBtn.setAttribute("data-tooltip-position", "top");
      this.pauseBtn.addClass("is-paused");
    } else {
      setIcon(this.pauseBtn, "pause");
      this.pauseBtn.setAttribute("aria-label", this.deps.t("workbench.queueStatus.pauseQueue"));
      this.pauseBtn.setAttribute("data-tooltip-position", "top");
      this.pauseBtn.removeClass("is-paused");
    }
  }

  private updateStatusIndicator(status: QueueStatus): void {
    if (!this.statusDot || !this.statusText) return;

    this.statusDot.removeClass("is-idle", "is-running", "is-paused", "is-error");

    if (status.failed > 0) {
      this.statusDot.addClass("is-error");
      this.statusText.textContent = this.deps.t("workbench.queueStatus.failed");
    } else if (status.paused) {
      this.statusDot.addClass("is-paused");
      this.statusText.textContent = this.deps.t("workbench.queueStatus.paused");
    } else if (status.running > 0) {
      this.statusDot.addClass("is-running");
      this.statusText.textContent = this.deps.t("workbench.queueStatus.running");
    } else {
      this.statusDot.addClass("is-idle");
      this.statusText.textContent = this.deps.t("workbench.queueStatus.noTasks");
    }

    this.updatePauseButton(status.paused);
  }

  private getTaskDisplayName(task: TaskRecord): string {
    const payload = task.payload as Record<string, unknown>;
    const namingTemplate = this.deps.getSettings().namingTemplate || "{{chinese}} ({{english}})";

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
        return standardName.length > 30 ? standardName.substring(0, 30) + "..." : standardName;
      }
    }

    if (payload?.filePath && typeof payload.filePath === "string") {
      const filePath = payload.filePath;
      const fileName = filePath.split("/").pop() || filePath;
      const noteName = fileName.replace(/\.md$/, "");
      return noteName.length > 30 ? noteName.substring(0, 30) + "..." : noteName;
    }

    if (payload?.userInput && typeof payload.userInput === "string") {
      const input = payload.userInput;
      return input.length > 20 ? input.substring(0, 20) + "..." : input;
    }

    return task.id.substring(0, 8);
  }

  private renderQueueDetails(container: HTMLElement): void {
    container.empty();

    const taskQueue = this.deps.taskQueue;
    const allTasks = taskQueue.getAllTasks();

    if (allTasks.length === 0) {
      container.createEl("p", {
        text: this.deps.t("workbench.queueStatus.noTasks"),
        cls: "cr-empty-state"
      });
      return;
    }

    const table = container.createEl("table", { cls: "cr-queue-details-table" });

    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: this.deps.t("workbench.queueStatus.noteName") });
    headerRow.createEl("th", { text: this.deps.t("workbench.queueStatus.type") });
    headerRow.createEl("th", { text: this.deps.t("workbench.queueStatus.status") });
    headerRow.createEl("th", { text: this.deps.t("workbench.queueStatus.actions") });

    const tbody = table.createEl("tbody");

    const sortedTasks = [...allTasks].sort((a, b) =>
      new Date(b.created).getTime() - new Date(a.created).getTime()
    );

    sortedTasks.forEach(task => {
      const row = tbody.createEl("tr", { cls: `cr-task-row cr-task-${task.state.toLowerCase()}` });

      const nameCell = row.createEl("td", { cls: "cr-task-name" });
      nameCell.createSpan({
        text: this.getTaskDisplayName(task),
        attr: {
          "aria-label": (task.payload as Record<string, unknown>)?.userInput as string || task.id,
          "data-tooltip-position": "top"
        }
      });

      row.createEl("td", {
        text: task.taskType,
        cls: "cr-task-type"
      });

      const statusCell = row.createEl("td", { cls: "cr-task-status" });
      statusCell.createEl("span", {
        cls: `cr-status-badge cr-status-${task.state.toLowerCase()}`,
        text: this.getStatusLabel(task.state)
      });

      const actionCell = row.createEl("td", { cls: "cr-task-actions" });

      if (task.state === "Pending") {
        const cancelBtn = actionCell.createEl("button", {
          text: this.deps.t("workbench.queueStatus.cancel"),
          cls: "cr-btn-small",
          attr: {
            "aria-label": `${this.deps.t("workbench.queueStatus.cancel")}`,
            "data-tooltip-position": "top"
          }
        });
        cancelBtn.addEventListener("click", () => {
          this.handleCancelTask(task.id);
        });
      } else if (task.state === "Failed") {
        if (task.errors && task.errors.length > 0) {
          const lastError = task.errors[task.errors.length - 1];
          const errorIcon = actionCell.createSpan({
            cls: "cr-error-icon",
            attr: {
              "aria-label": lastError.message,
              "data-tooltip-position": "top"
            }
          });
          setIcon(errorIcon, "alert-triangle");
        }
      } else if (task.state === "Completed") {
        const successIcon = actionCell.createSpan({
          cls: "cr-success-icon",
          attr: { "aria-hidden": "true" }
        });
        setIcon(successIcon, "check");
      }
    });

    const batchActions = container.createDiv({ cls: "cr-queue-batch-actions" });

    const retryFailedBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.retryFailed"),
      cls: "cr-btn-small mod-cta",
      attr: {
        "aria-label": this.deps.t("workbench.queueStatus.retryFailed"),
        "data-tooltip-position": "top"
      }
    });
    retryFailedBtn.addEventListener("click", () => {
      void this.handleRetryFailed();
    });

    const clearPendingBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.clearPending"),
      cls: "cr-btn-small",
      attr: {
        "aria-label": this.deps.t("workbench.queueStatus.clearPending"),
        "data-tooltip-position": "top"
      }
    });
    clearPendingBtn.addEventListener("click", () => {
      this.handleClearPending();
    });

    const clearCompletedBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.clearCompleted"),
      cls: "cr-btn-small",
      attr: {
        "aria-label": this.deps.t("workbench.queueStatus.clearCompleted"),
        "data-tooltip-position": "top"
      }
    });
    clearCompletedBtn.addEventListener("click", () => {
      void this.handleClearCompleted();
    });

    const clearFailedBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.clearFailed"),
      cls: "cr-btn-small",
      attr: {
        "aria-label": this.deps.t("workbench.queueStatus.clearFailed"),
        "data-tooltip-position": "top"
      }
    });
    clearFailedBtn.addEventListener("click", () => {
      this.handleClearFailed();
    });
  }

  private getStatusLabel(state: string): string {
    const labels: Record<string, string> = {
      Pending: this.deps.t("workbench.queueStatus.pending"),
      Running: this.deps.t("workbench.queueStatus.running"),
      Completed: this.deps.t("workbench.queueStatus.completed"),
      Failed: this.deps.t("workbench.queueStatus.failed"),
      Cancelled: this.deps.t("workbench.queueStatus.cancelled")
    };
    return labels[state] || state;
  }

  private handleCancelTask(taskId: string): void {
    const taskQueue = this.deps.taskQueue;
    try {
      taskQueue.cancel(taskId);
      new Notice(this.deps.t("workbench.notifications.taskCancelled"));
      this.refreshDetailsIfVisible();
      this.renderStatus(taskQueue.getStatus());
    } catch (error) {
      const message = safeErrorMessage(error, this.deps.t("workbench.notifications.cancelFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.cancelFailed")}: ${message}`);
    }
  }

  private async handleRetryFailed(): Promise<void> {
    try {
      const taskQueue = this.deps.taskQueue;
      const result = await taskQueue.retryFailed();

      if (result.ok) {
        new Notice(`${this.deps.t("workbench.notifications.retryComplete")}: ${result.value}`);
        this.refreshDetailsIfVisible();
        this.renderStatus(taskQueue.getStatus());
      } else {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.cancelFailed")}: ${result.error.message}`);
      }
    } catch (error) {
      this.deps.logError("重试失败任务异常", error);
      this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.cancelFailed")));
    }
  }

  private async handleClearCompleted(): Promise<void> {
    try {
      const taskQueue = this.deps.taskQueue;
      const result = await taskQueue.clearCompleted();

      if (result.ok) {
        new Notice(`${this.deps.t("workbench.notifications.clearComplete")}: ${result.value}`);
        this.refreshDetailsIfVisible();
        this.renderStatus(taskQueue.getStatus());
      } else {
        this.deps.showErrorNotice(`清除失败: ${result.error.message}`);
      }
    } catch (error) {
      this.deps.logError("清除已完成任务异常", error);
      this.deps.showErrorNotice(safeErrorMessage(error, "清除失败"));
    }
  }

  private handleClearFailed(): void {
    const taskQueue = this.deps.taskQueue;
    const allTasks = taskQueue.getAllTasks();

    let clearedCount = 0;
    allTasks.forEach(task => {
      if (task.state === "Failed") {
        try {
          taskQueue.cancel(task.id);
          clearedCount++;
        } catch {
          // 忽略单项失败
        }
      }
    });

    new Notice(`${this.deps.t("workbench.notifications.clearComplete")} (${clearedCount})`);

    this.refreshDetailsIfVisible();
    this.renderStatus(taskQueue.getStatus());
  }

  private handleClearPending(): void {
    const taskQueue = this.deps.taskQueue;
    const allTasks = taskQueue.getAllTasks();

    let clearedCount = 0;
    allTasks.forEach(task => {
      if (task.state === "Pending") {
        try {
          taskQueue.cancel(task.id);
          clearedCount++;
        } catch {
          // 忽略单项失败
        }
      }
    });

    new Notice(`${this.deps.t("workbench.notifications.clearComplete")} (${clearedCount})`);

    this.refreshDetailsIfVisible();
    this.renderStatus(taskQueue.getStatus());
  }
}
