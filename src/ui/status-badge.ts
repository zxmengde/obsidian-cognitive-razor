/**
 * StatusBadge - 状态栏徽章组件
 * 
 * 功能：
 * - 状态栏徽章显示
 * - 快捷入口
 */

import { Plugin, Menu } from "obsidian";
import type { QueueStatus } from "../types";

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

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.statusBarItem = plugin.addStatusBarItem();
    this.statusBarItem.addClass("cr-status-badge");
    this.render();
    this.setupClickHandler();
  }

  /**
   * 渲染状态徽章
   */
  private render(): void {
    this.statusBarItem.empty();

    // 图标
    const icon = this.statusBarItem.createSpan({
      cls: "cr-status-icon",
      attr: { "aria-hidden": "true" }
    });
    icon.textContent = this.getStatusIcon();

    // 任务计数
    const count = this.statusBarItem.createSpan({
      cls: "cr-status-count",
      attr: {
        "aria-label": this.getAriaLabel()
      }
    });

    const activeCount = this.queueStatus.pending + this.queueStatus.running;
    if (activeCount > 0) {
      count.textContent = activeCount.toString();
      count.addClass("cr-status-active");
    } else if (this.queueStatus.failed > 0) {
      count.textContent = this.queueStatus.failed.toString();
      count.addClass("cr-status-failed");
    } else {
      count.textContent = "✓";
      count.addClass("cr-status-idle");
    }

    // 暂停指示器
    if (this.queueStatus.paused && activeCount > 0) {
      const pausedIndicator = this.statusBarItem.createSpan({
        cls: "cr-status-paused-indicator",
        attr: { "aria-label": "队列已暂停" }
      });
      pausedIndicator.textContent = "⏸";
    }

    // 设置标题提示
    this.statusBarItem.setAttribute("title", this.getTooltip());
  }

  /**
   * 获取状态图标
   */
  private getStatusIcon(): string {
    const activeCount = this.queueStatus.pending + this.queueStatus.running;
    
    if (this.queueStatus.paused && activeCount > 0) {
      return "⏸";
    }
    
    if (this.queueStatus.running > 0) {
      return "⚙";
    }
    
    if (this.queueStatus.failed > 0) {
      return "⚠";
    }
    
    if (activeCount > 0) {
      return "⏳";
    }
    
    return "🧠";
  }

  /**
   * 获取无障碍标签
   */
  private getAriaLabel(): string {
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
      return "Cognitive Razor - 无活动任务";
    }
    
    return `Cognitive Razor - ${parts.join(", ")}`;
  }

  /**
   * 获取工具提示
   */
  private getTooltip(): string {
    const lines: string[] = ["Cognitive Razor"];
    
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
          this.openQueueView();
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
   * 打开工作台
   */
  private openWorkbench(): void {
    // TODO: 激活工作台视图
    this.plugin.app.workspace.trigger("cognitive-razor:open-workbench");
  }

  /**
   * 打开队列视图
   */
  private openQueueView(): void {
    // TODO: 激活队列视图
    this.plugin.app.workspace.trigger("cognitive-razor:open-queue");
  }

  /**
   * 创建概念
   */
  private createConcept(): void {
    // TODO: 打开创建概念对话框
    this.plugin.app.workspace.trigger("cognitive-razor:create-concept");
  }

  /**
   * 切换队列状态
   */
  private toggleQueue(): void {
    // TODO: 调用 TaskQueue 切换暂停/恢复
    this.plugin.app.workspace.trigger("cognitive-razor:toggle-queue");
  }

  /**
   * 重试失败任务
   */
  private retryFailedTasks(): void {
    // TODO: 调用 TaskQueue 重试所有失败任务
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
