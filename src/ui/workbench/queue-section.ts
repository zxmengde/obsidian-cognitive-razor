import { Notice, setIcon } from "obsidian";
import type { QueueStatus, TaskRecord, CRType, StandardizedConcept } from "../../types";
import { renderNamingTemplate } from "../../core/naming-utils";
import type { WorkbenchSectionDeps } from "./workbench-section-deps";

export class QueueSection {
  private deps: WorkbenchSectionDeps;

  private queueStatusContainer: HTMLElement | null = null;
  private statusDot: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private expandIcon: HTMLElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private detailsContainer: HTMLElement | null = null;

  constructor(deps: WorkbenchSectionDeps) {
    this.deps = deps;
  }

  render(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "cr-queue-wrapper" });

    const statusBar = wrapper.createDiv({ cls: "cr-status-bar" });

    const queueIndicator = statusBar.createDiv({ cls: "cr-queue-indicator cr-clickable" });
    queueIndicator.setAttribute("role", "button");
    queueIndicator.setAttribute("tabindex", "0");
    queueIndicator.setAttribute("aria-expanded", "false");
    queueIndicator.setAttribute("title", this.deps.t("workbench.queueStatus.viewDetails"));

    this.statusDot = queueIndicator.createDiv({ cls: "cr-status-dot is-idle" });
    this.statusText = queueIndicator.createSpan({
      cls: "cr-status-text",
      text: this.deps.t("workbench.queueStatus.noTasks")
    });
    this.expandIcon = queueIndicator.createEl("span", {
      cls: "cr-expand-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(this.expandIcon, "chevron-right");

    const stats = statusBar.createDiv({ cls: "cr-quick-stats" });
    this.queueStatusContainer = stats;

    this.pauseBtn = statusBar.createEl("button", {
      cls: "cr-queue-control-btn",
      attr: {
        "aria-label": this.deps.t("workbench.queueStatus.pauseQueue"),
        "title": this.deps.t("workbench.queueStatus.pauseQueue")
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

    this.update({
      paused: false,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    });
  }

  update(status: QueueStatus): void {
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

    if (renderedCount === 0) {
      this.queueStatusContainer.createDiv({
        cls: "cr-empty-stat",
        text: this.deps.t("workbench.queueStatus.noTasks")
      });
    }

    this.updateStatusIndicator(status);
  }

  refreshDetailsIfVisible(): void {
    if (this.detailsContainer && this.detailsContainer.style.display !== "none") {
      this.renderQueueDetails(this.detailsContainer);
    }
  }

  onClose(): void {
    this.queueStatusContainer = null;
    this.statusDot = null;
    this.statusText = null;
    this.expandIcon = null;
    this.pauseBtn = null;
    this.detailsContainer = null;
  }

  private async handleTogglePause(): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const taskQueue = plugin.getComponents().taskQueue;
    const status = taskQueue.getStatus();

    if (status.paused) {
      await taskQueue.resume();
      new Notice(this.deps.t("workbench.queueStatus.queueResumed"));
    } else {
      await taskQueue.pause();
      new Notice(this.deps.t("workbench.queueStatus.queuePaused"));
    }

    const nextStatus = taskQueue.getStatus();
    this.update(nextStatus);
    this.updatePauseButton(nextStatus.paused);
  }

  private updatePauseButton(isPaused: boolean): void {
    if (!this.pauseBtn) return;

    this.pauseBtn.innerHTML = "";
    if (isPaused) {
      setIcon(this.pauseBtn, "play");
      this.pauseBtn.setAttribute("aria-label", this.deps.t("workbench.queueStatus.resumeQueue"));
      this.pauseBtn.setAttribute("title", this.deps.t("workbench.queueStatus.resumeQueue"));
      this.pauseBtn.addClass("is-paused");
    } else {
      setIcon(this.pauseBtn, "pause");
      this.pauseBtn.setAttribute("aria-label", this.deps.t("workbench.queueStatus.pauseQueue"));
      this.pauseBtn.setAttribute("title", this.deps.t("workbench.queueStatus.pauseQueue"));
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
    const plugin = this.deps.getPlugin();
    const payload = task.payload as Record<string, unknown>;
    const namingTemplate = plugin?.settings?.namingTemplate || "{{chinese}} ({{english}})";

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
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    container.empty();

    const taskQueue = plugin.getComponents().taskQueue;
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
        attr: { title: (task.payload as Record<string, unknown>)?.userInput as string || task.id }
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
          attr: { "aria-label": `${this.deps.t("workbench.queueStatus.cancel")}` }
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
              title: lastError.message,
              "aria-hidden": "true"
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
      attr: { "aria-label": this.deps.t("workbench.queueStatus.retryFailed") }
    });
    retryFailedBtn.addEventListener("click", () => {
      void this.handleRetryFailed();
    });

    const clearPendingBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.clearPending"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.deps.t("workbench.queueStatus.clearPending") }
    });
    clearPendingBtn.addEventListener("click", () => {
      this.handleClearPending();
    });

    const clearCompletedBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.clearCompleted"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.deps.t("workbench.queueStatus.clearCompleted") }
    });
    clearCompletedBtn.addEventListener("click", () => {
      void this.handleClearCompleted();
    });

    const clearFailedBtn = batchActions.createEl("button", {
      text: this.deps.t("workbench.queueStatus.clearFailed"),
      cls: "cr-btn-small",
      attr: { "aria-label": this.deps.t("workbench.queueStatus.clearFailed") }
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
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const taskQueue = plugin.getComponents().taskQueue;
    try {
      taskQueue.cancel(taskId);
      new Notice(this.deps.t("workbench.notifications.taskCancelled"));
      this.refreshDetailsIfVisible();
      this.update(taskQueue.getStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.cancelFailed")}: ${message}`);
    }
  }

  private async handleRetryFailed(): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const taskQueue = plugin.getComponents().taskQueue;
    const result = await taskQueue.retryFailed();

    if (result.ok) {
      new Notice(`${this.deps.t("workbench.notifications.retryComplete")}: ${result.value}`);
      this.refreshDetailsIfVisible();
      this.update(taskQueue.getStatus());
    } else {
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.cancelFailed")}: ${result.error.message}`);
    }
  }

  private async handleClearCompleted(): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const taskQueue = plugin.getComponents().taskQueue;
    const result = await taskQueue.clearCompleted();

    if (result.ok) {
      new Notice(`${this.deps.t("workbench.notifications.clearComplete")}: ${result.value}`);
      this.refreshDetailsIfVisible();
      this.update(taskQueue.getStatus());
    } else {
      this.deps.showErrorNotice(`清除失败: ${result.error.message}`);
    }
  }

  private handleClearFailed(): void {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const taskQueue = plugin.getComponents().taskQueue;
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
    this.update(taskQueue.getStatus());
  }

  private handleClearPending(): void {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const taskQueue = plugin.getComponents().taskQueue;
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
    this.update(taskQueue.getStatus());
  }
}
