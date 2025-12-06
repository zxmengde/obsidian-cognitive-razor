/**
 * 撤销通知组件
 * 在写入操作后显示带有撤销按钮的通知
 */

import { Notice } from "obsidian";

/**
 * 撤销通知选项
 */
export interface UndoNotificationOptions {
  /** 通知消息 */
  message: string;
  /** 快照 ID */
  snapshotId: string;
  /** 文件路径 */
  filePath: string;
  /** 撤销回调 */
  onUndo: (snapshotId: string) => void;
  /** 超时时间（毫秒），默认 5000ms */
  timeout?: number;
}

/**
 * 撤销通知类
 * 显示带有撤销按钮的通知，支持 5 秒内撤销操作
 */
export class UndoNotification {
  private notice: Notice | null = null;
  private options: UndoNotificationOptions;
  private expired: boolean = false;
  private triggered: boolean = false;
  private timeoutHandle: NodeJS.Timeout | null = null;

  constructor(options: UndoNotificationOptions) {
    this.options = {
      ...options,
      timeout: options.timeout ?? 5000, // 默认 5 秒
    };
  }

  /**
   * 显示通知
   */
  show(): void {
    // 创建通知
    this.notice = new Notice("", 0); // 0 表示不自动关闭

    // 清空通知内容
    this.notice.noticeEl.empty();

    // 创建通知容器
    const container = this.notice.noticeEl.createDiv({
      cls: "undo-notification-container",
    });

    // 添加消息文本
    container.createSpan({
      text: this.options.message,
      cls: "undo-notification-message",
    });

    // 添加撤销按钮
    const undoButton = container.createEl("button", {
      text: "撤销",
      cls: "undo-notification-button",
    });

    undoButton.addEventListener("click", () => {
      this.triggerUndo();
    });

    // 设置超时
    this.timeoutHandle = setTimeout(() => {
      this.expired = true;
      this.dismiss();
    }, this.options.timeout);
  }

  /**
   * 触发撤销操作
   * @returns 是否成功触发撤销
   */
  triggerUndo(): boolean {
    // 检查是否已过期
    if (this.expired) {
      return false;
    }

    // 检查是否已触发
    if (this.triggered) {
      return false;
    }

    // 标记为已触发
    this.triggered = true;

    // 调用撤销回调
    this.options.onUndo(this.options.snapshotId);

    // 关闭通知
    this.dismiss();

    return true;
  }

  /**
   * 关闭通知
   */
  dismiss(): void {
    // 清除超时
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    // 关闭通知
    if (this.notice) {
      this.notice.hide();
      this.notice = null;
    }
  }

  /**
   * 检查通知是否已过期
   */
  isExpired(): boolean {
    return this.expired;
  }

  /**
   * 获取快照 ID
   */
  getSnapshotId(): string {
    return this.options.snapshotId;
  }

  /**
   * 获取文件路径
   */
  getFilePath(): string {
    return this.options.filePath;
  }

  /**
   * 获取消息
   */
  getMessage(): string {
    return this.options.message;
  }
}
