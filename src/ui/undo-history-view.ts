/**
 * 撤销历史视图
 * 显示所有可撤销的操作历史
 */

import { ItemView, WorkspaceLeaf, Notice, App, Modal, TFile } from "obsidian";
import type { SnapshotMetadata } from "../core/undo-manager";
import type { UndoManager } from "../core/undo-manager";
import type CognitiveRazorPlugin from "../../main";

export const UNDO_HISTORY_VIEW_TYPE = "cognitive-razor-undo-history";

/**
 * 撤销历史视图类
 */
export class UndoHistoryView extends ItemView {
  private plugin: CognitiveRazorPlugin | null = null;
  private undoManager: UndoManager | null = null;
  private snapshots: SnapshotMetadata[] = [];

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  /**
   * 设置插件实例
   */
  setPlugin(plugin: CognitiveRazorPlugin): void {
    this.plugin = plugin;
    const components = plugin.getComponents();
    this.undoManager = components.undoManager;
  }

  /**
   * 获取视图类型
   */
  getViewType(): string {
    return UNDO_HISTORY_VIEW_TYPE;
  }

  /**
   * 获取显示文本
   */
  getDisplayText(): string {
    return "操作历史";
  }

  /**
   * 获取图标
   */
  getIcon(): string {
    return "history";
  }

  /**
   * 视图打开时调用
   */
  async onOpen(): Promise<void> {
    await this.refresh();
  }

  /**
   * 视图关闭时调用
   */
  async onClose(): Promise<void> {
    // 清理资源
  }

  /**
   * 刷新视图
   */
  async refresh(): Promise<void> {
    if (!this.undoManager) {
      return;
    }

    // 获取所有快照
    const result = await this.undoManager.listSnapshots();
    if (!result.ok) {
      new Notice(`加载操作历史失败: ${result.error.message}`);
      return;
    }

    this.snapshots = result.value;

    // 按创建时间排序（最新的在前）
    this.snapshots.sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );

    // 渲染视图
    this.render();
  }

  /**
   * 渲染视图
   */
  private render(): void {
    const container = this.containerEl.children[1];
    container.empty();

    // 添加标题
    container.createEl("h4", { text: "操作历史" });

    // 如果没有历史记录
    if (this.snapshots.length === 0) {
      container.createDiv({
        text: "暂无可撤销的操作",
        cls: "undo-history-empty",
      });
      return;
    }

    // 创建历史列表
    const listContainer = container.createDiv({
      cls: "undo-history-list",
    });

    // 渲染每个快照
    for (const snapshot of this.snapshots) {
      this.renderSnapshotItem(listContainer, snapshot);
    }
  }

  /**
   * 渲染单个快照项
   */
  private renderSnapshotItem(
    container: HTMLElement,
    snapshot: SnapshotMetadata
  ): void {
    const item = container.createDiv({
      cls: "undo-history-item",
    });

    // 创建信息区域
    const infoContainer = item.createDiv({
      cls: "undo-history-item-info",
    });

    // 操作类型
    infoContainer.createDiv({
      text: this.getOperationDisplayName(snapshot.operation),
      cls: "undo-history-item-operation",
    });

    // 文件路径
    infoContainer.createDiv({
      text: snapshot.filePath,
      cls: "undo-history-item-path",
    });

    // 时间
    const timeText = this.formatTime(snapshot.created);
    infoContainer.createDiv({
      text: timeText,
      cls: "undo-history-item-time",
    });

    // 创建操作按钮区域
    const actionsContainer = item.createDiv({
      cls: "undo-history-item-actions",
    });

    // 撤销按钮
    const undoButton = actionsContainer.createEl("button", {
      text: "撤销",
      cls: "undo-history-item-button",
    });

    undoButton.addEventListener("click", async () => {
      await this.handleUndo(snapshot);
    });

    // 查看详情按钮
    const detailsButton = actionsContainer.createEl("button", {
      text: "详情",
      cls: "undo-history-item-button-secondary",
    });

    detailsButton.addEventListener("click", () => {
      this.showSnapshotDetails(snapshot);
    });
  }

  /**
   * 处理撤销操作
   */
  private async handleUndo(snapshot: SnapshotMetadata): Promise<void> {
    if (!this.undoManager || !this.plugin) {
      new Notice("系统未初始化");
      return;
    }

    try {
      // 恢复快照
      const restoreResult = await this.undoManager.restoreSnapshot(
        snapshot.id
      );
      if (!restoreResult.ok) {
        new Notice(`恢复快照失败: ${restoreResult.error.message}`);
        return;
      }

      const restoredSnapshot = restoreResult.value;

      // 写入文件
      const file = this.app.vault.getAbstractFileByPath(restoredSnapshot.filePath);
      if (file && file instanceof TFile) {
        // 使用 vault API 写入
        await this.app.vault.modify(file, restoredSnapshot.content);
      } else {
        // 文件不存在，创建新文件
        await this.app.vault.create(restoredSnapshot.filePath, restoredSnapshot.content);
      }

      // 删除快照
      const deleteResult = await this.undoManager.deleteSnapshot(snapshot.id);
      if (!deleteResult.ok) {
        new Notice(`删除快照失败: ${deleteResult.error.message}`);
        // 但不影响撤销操作
      }

      new Notice(`已撤销操作: ${this.getOperationDisplayName(snapshot.operation)}`);

      // 刷新视图
      await this.refresh();
    } catch (error) {
      console.error("撤销操作失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`撤销失败: ${errorMessage}`);
    }
  }

  /**
   * 显示快照详情
   */
  private showSnapshotDetails(snapshot: SnapshotMetadata): void {
    // 创建详情模态框
    const modal = new SnapshotDetailsModal(this.app, snapshot);
    modal.open();
  }

  /**
   * 获取操作显示名称
   */
  private getOperationDisplayName(operation: string): string {
    const operationNames: Record<string, string> = {
      enrich: "内容生成",
      merge: "合并笔记",
      "incremental-improve": "增量改进",
      "manual-edit": "手动编辑",
      standardize: "标准化",
      create: "创建笔记",
    };

    return operationNames[operation] || operation;
  }

  /**
   * 格式化时间
   */
  private formatTime(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMinutes < 1) {
      return "刚刚";
    } else if (diffMinutes < 60) {
      return `${diffMinutes} 分钟前`;
    } else if (diffHours < 24) {
      return `${diffHours} 小时前`;
    } else if (diffDays < 7) {
      return `${diffDays} 天前`;
    } else {
      return date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
}

/**
 * 快照详情模态框
 */
class SnapshotDetailsModal extends Modal {
  private snapshot: SnapshotMetadata;

  constructor(app: App, snapshot: SnapshotMetadata) {
    super(app);
    this.snapshot = snapshot;
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "快照详情" });

    // 快照 ID
    const idContainer = contentEl.createDiv({ cls: "snapshot-detail-row" });
    idContainer.createEl("strong", { text: "快照 ID: " });
    idContainer.createSpan({ text: this.snapshot.id });

    // 文件路径
    const pathContainer = contentEl.createDiv({ cls: "snapshot-detail-row" });
    pathContainer.createEl("strong", { text: "文件路径: " });
    pathContainer.createSpan({ text: this.snapshot.filePath });

    // 操作类型
    const opContainer = contentEl.createDiv({ cls: "snapshot-detail-row" });
    opContainer.createEl("strong", { text: "操作类型: " });
    opContainer.createSpan({ text: this.snapshot.operation });

    // 创建时间
    const timeContainer = contentEl.createDiv({ cls: "snapshot-detail-row" });
    timeContainer.createEl("strong", { text: "创建时间: " });
    const date = new Date(this.snapshot.created);
    timeContainer.createSpan({
      text: date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    });

    // 关闭按钮
    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container",
    });
    const closeButton = buttonContainer.createEl("button", { text: "关闭" });
    closeButton.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
