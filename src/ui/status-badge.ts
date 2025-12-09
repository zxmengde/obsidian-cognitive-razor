/**
 * StatusBadge - 状态栏徽章组件
 * 
 * 功能：
 * - 状态栏徽章显示
 * - 快捷入口
 * 
 * 状态格式显示 (Requirements 5.5):
 * - 正常: [CR: running/pending ⏳] 例如 [CR: 1/3 ⏳]
 * - 暂停: [CR: ⏸️ n] 例如 [CR: ⏸️ 3]
 * - 有失败: [CR: running/pending ⚠️failed] 例如 [CR: 1/3 ⚠️1]
 * - 离线: [CR: 📴]
 * - 空闲: [CR: ✓]
 */

import { Plugin, Menu } from "obsidian";
import type { QueueStatus } from "../types";
import { formatStatusBadgeText } from "./status-badge-format";

/**
 * StatusBadge 组件
 */
export class StatusBadge {
  private plugin: Plugin;
  private statusBarItem: HTMLElement;
  private queueStatus: QueueStatus = {
    paused: false,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0
  };
  private isOffline: boolean = false;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.statusBarItem = plugin.addStatusBarItem();
    this.statusBarItem.addClass("cr-status-badge");
    this.statusBarItem.addClass("cr-scope");
    this.render();
    this.setupClickHandler();
  }

  /**
   * 渲染状态徽章
   * 使用 formatStatusBadgeText 函数生成符合规范的格式
   */
  private render(): void {
    this.statusBarItem.empty();

    // 使用格式化函数生成状态文本
    const statusText = formatStatusBadgeText(this.queueStatus, this.isOffline);
    
    // 创建状态文本元素
    const textSpan = this.statusBarItem.createSpan({
      cls: "cr-status-text",
      attr: {
        "aria-label": this.getAriaLabel()
      }
    });
    textSpan.textContent = statusText;

    // 根据状态添加样式类
    this.updateStatusClasses();

    // 设置标题提示
    this.statusBarItem.setAttribute("title", this.getTooltip());
  }

  /**
   * 更新状态样式类
   */
  private updateStatusClasses(): void {
    // 移除所有状态类
    this.statusBarItem.removeClass(
      "cr-status-idle",
      "cr-status-active",
      "cr-status-paused",
      "cr-status-failed",
      "cr-status-offline"
    );

    const { running, pending, failed, paused } = this.queueStatus;
    const activeCount = running + pending;

    if (this.isOffline) {
      this.statusBarItem.addClass("cr-status-offline");
    } else if (activeCount === 0 && failed === 0) {
      this.statusBarItem.addClass("cr-status-idle");
    } else if (paused && activeCount > 0) {
      this.statusBarItem.addClass("cr-status-paused");
    } else if (failed > 0) {
      this.statusBarItem.addClass("cr-status-failed");
    } else {
      this.statusBarItem.addClass("cr-status-active");
    }
  }

  /**
   * 获取无障碍标签
   */
  private getAriaLabel(): string {
    if (this.isOffline) {
      return "Cognitive Razor - 离线";
    }

    const parts: string[] = [];
    
    if (this.queueStatus.paused) {
      parts.push("队列已暂停");
    }
    
    if (this.queueStatus.running > 0) {
      parts.push(`${this.queueStatus.running} 个任务执行中`);
    }
    
    if (this.queueStatus.pending > 0) {
      parts.push(`${this.queueStatus.pending} 个任务等待中`);
    }
    
    if (this.queueStatus.failed > 0) {
      parts.push(`${this.queueStatus.failed} 个任务失败`);
    }
    
    if (parts.length === 0) {
      return "Cognitive Razor - 空闲";
    }
    
    return `Cognitive Razor - ${parts.join(", ")}`;
  }

  /**
   * 获取工具提示
   */
  private getTooltip(): string {
    const lines: string[] = ["Cognitive Razor"];
    
    if (this.isOffline) {
      lines.push("状态: 离线");
      lines.push("");
      lines.push("点击查看菜单");
      return lines.join("\n");
    }
    
    if (this.queueStatus.paused) {
      lines.push("状态: 已暂停");
    } else {
      lines.push("状态: 运行中");
    }
    
    lines.push(`等待: ${this.queueStatus.pending}`);
    lines.push(`执行: ${this.queueStatus.running}`);
    lines.push(`完成: ${this.queueStatus.completed}`);
    
    if (this.queueStatus.failed > 0) {
      lines.push(`失败: ${this.queueStatus.failed}`);
    }
    
    lines.push("");
    lines.push("点击查看菜单");
    
    return lines.join("\n");
  }

  /**
   * 设置点击处理器
   */
  private setupClickHandler(): void {
    this.statusBarItem.addEventListener("click", (event: MouseEvent) => {
      this.showMenu(event);
    });

    // 支持键盘访问
    this.statusBarItem.setAttribute("tabindex", "0");
    this.statusBarItem.setAttribute("role", "button");
    
    this.statusBarItem.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.showMenu(event as unknown as MouseEvent);
      }
    });
  }

  /**
   * 显示快捷菜单
   */
  private showMenu(event: MouseEvent): void {
    const menu = new Menu();

    // 打开工作台
    menu.addItem((item) => {
      item
        .setTitle("打开工作台")
        .setIcon("brain")
        .onClick(() => {
          this.openWorkbench();
        });
    });

    // 打开队列视图
    menu.addItem((item) => {
      item
        .setTitle("查看任务队列")
        .setIcon("list-checks")
        .onClick(() => {
          this.openWorkbench();
        });
    });

    menu.addSeparator();

    // 创建概念
    menu.addItem((item) => {
      item
        .setTitle("创建概念")
        .setIcon("plus")
        .onClick(() => {
          this.createConcept();
        });
    });

    menu.addSeparator();

    // 暂停/恢复队列
    const isPaused = this.queueStatus.paused;
    menu.addItem((item) => {
      item
        .setTitle(isPaused ? "恢复队列" : "暂停队列")
        .setIcon(isPaused ? "play" : "pause")
        .onClick(() => {
          this.toggleQueue();
        });
    });

    // 如果有失败任务，显示重试选项
    if (this.queueStatus.failed > 0) {
      menu.addItem((item) => {
        item
          .setTitle("重试失败任务")
          .setIcon("refresh-cw")
          .onClick(() => {
            this.retryFailedTasks();
          });
      });
    }

    menu.addSeparator();

    // 设置
    menu.addItem((item) => {
      item
        .setTitle("插件设置")
        .setIcon("settings")
        .onClick(() => {
          this.openSettings();
        });
    });

    menu.showAtMouseEvent(event);
  }

  /**
   * 更新队列状态
   */
  public updateStatus(status: QueueStatus): void {
    this.queueStatus = status;
    this.render();
  }

  /**
   * 设置离线状态
   */
  public setOffline(offline: boolean): void {
    this.isOffline = offline;
    this.render();
  }

  /**
   * 获取当前状态文本（用于测试）
   */
  public getStatusText(): string {
    return formatStatusBadgeText(this.queueStatus, this.isOffline);
  }

  /**
   * 打开工作台（替代原队列视图）
   */
  private openWorkbench(): void {
    this.plugin.app.workspace.trigger("cognitive-razor:open-workbench");
  }

  /**
   * 创建概念
   */
  private createConcept(): void {
    this.plugin.app.workspace.trigger("cognitive-razor:create-concept");
  }

  /**
   * 切换队列状态
   */
  private toggleQueue(): void {
    this.plugin.app.workspace.trigger("cognitive-razor:toggle-queue");
  }

  /**
   * 重试失败任务
   */
  private retryFailedTasks(): void {
    this.plugin.app.workspace.trigger("cognitive-razor:retry-failed");
  }

  /**
   * 打开设置
   */
  private openSettings(): void {
    // @ts-ignore - Obsidian 内部 API
    this.plugin.app.setting.open();
    // @ts-ignore - Obsidian 内部 API
    this.plugin.app.setting.openTabById(this.plugin.manifest.id);
  }

  /**
   * 清理资源
   */
  public destroy(): void {
    this.statusBarItem.remove();
  }
}
