/**
 * CommandDispatcher - 命令统一分发器
 * 
 * 功能：
 * - 注册所有命令
 * - 实现快捷键绑定
 * - 实现命令分发
 */

import { Plugin, Notice, MarkdownView, TFile, Menu } from "obsidian";
import { IncrementalImproveModal } from "./incremental-improve-modal";
import { TaskQueue } from "../core/task-queue";

/**
 * 命令处理器类型
 */
export type CommandHandler = () => void | Promise<void>;

/**
 * 命令定义
 */
export interface CommandDefinition {
  /** 命令 ID */
  id: string;
  /** 命令名称 */
  name: string;
  /** 命令图标 */
  icon?: string;
  /** 快捷键 */
  hotkeys?: Array<{
    modifiers: Array<"Mod" | "Ctrl" | "Meta" | "Shift" | "Alt">;
    key: string;
  }>;
  /** 命令处理器 */
  handler: CommandHandler;
  /** 是否需要编辑器 */
  editorRequired?: boolean;
  /** 检查回调（用于条件命令） */
  checkCallback?: (checking: boolean) => boolean;
}

/**
 * CommandDispatcher 组件
 */
export class CommandDispatcher {
  private plugin: Plugin;
  private commands: Map<string, CommandDefinition> = new Map();
  private taskQueue: TaskQueue | null = null;

  constructor(plugin: Plugin, taskQueue?: TaskQueue) {
    this.plugin = plugin;
    this.taskQueue = taskQueue || null;
  }

  /**
   * 设置 TaskQueue（用于延迟初始化）
   */
  public setTaskQueue(taskQueue: TaskQueue): void {
    this.taskQueue = taskQueue;
  }

  /**
   * 注册所有命令
   */
  public registerAllCommands(): void {
    // 工作台相关命令
    this.registerWorkbenchCommands();

    // 概念创建命令
    this.registerConceptCommands();

    // 队列管理命令
    this.registerQueueCommands();

    // 笔记操作命令
    this.registerNoteCommands();

    // 视图切换命令
    this.registerViewCommands();

    // 注册文件菜单
    this.registerFileMenu();
  }

  /**
   * 注册文件菜单（右键菜单）
   */
  private registerFileMenu(): void {
    // 使用 workspace.on 注册文件菜单事件
    // 注意：file-menu 事件在 Obsidian API 中存在，但类型定义可能不完整
    const workspace = this.plugin.app.workspace as any;
    this.plugin.registerEvent(
      workspace.on("file-menu", (menu: Menu, file: TFile) => {
        // 只对 Markdown 文件显示菜单
        if (file.extension !== "md") {
          return;
        }

        // 添加增量改进菜单项
        menu.addItem((item) => {
          item
            .setTitle("增量改进笔记")
            .setIcon("edit")
            .onClick(async () => {
              await this.improveNoteFromFile(file);
            });
        });
      })
    );
  }

  /**
   * 注册工作台相关命令
   */
  private registerWorkbenchCommands(): void {
    this.registerCommand({
      id: "open-workbench",
      name: "打开工作台",
      icon: "brain",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "w" }
      ],
      handler: async () => {
        await this.openWorkbench();
      }
    });
  }

  /**
   * 注册概念创建命令
   */
  private registerConceptCommands(): void {
    this.registerCommand({
      id: "create-concept",
      name: "创建概念",
      icon: "plus",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "n" }
      ],
      handler: async () => {
        await this.createConcept();
      }
    });

    this.registerCommand({
      id: "create-concept-from-selection",
      name: "从选中文本创建概念",
      icon: "plus-circle",
      editorRequired: true,
      handler: async () => {
        await this.createConceptFromSelection();
      }
    });
  }

  /**
   * 注册队列管理命令
   */
  private registerQueueCommands(): void {
    this.registerCommand({
      id: "open-queue",
      name: "打开任务队列",
      icon: "list-checks",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "q" }
      ],
      handler: async () => {
        await this.openQueue();
      }
    });

    this.registerCommand({
      id: "toggle-queue",
      name: "暂停/恢复队列",
      icon: "pause",
      handler: async () => {
        await this.toggleQueue();
      }
    });

    this.registerCommand({
      id: "clear-completed-tasks",
      name: "清空已完成任务",
      icon: "trash",
      handler: async () => {
        await this.clearCompletedTasks();
      }
    });

    this.registerCommand({
      id: "retry-failed-tasks",
      name: "重试失败任务",
      icon: "refresh-cw",
      handler: async () => {
        await this.retryFailedTasks();
      }
    });
  }

  /**
   * 注册笔记操作命令
   */
  private registerNoteCommands(): void {
    this.registerCommand({
      id: "enrich-note",
      name: "生成笔记内容",
      icon: "wand",
      editorRequired: true,
      handler: async () => {
        await this.enrichNote();
      }
    });

    this.registerCommand({
      id: "improve-note",
      name: "增量改进笔记",
      icon: "edit",
      editorRequired: true,
      handler: async () => {
        await this.improveNote();
      }
    });

    this.registerCommand({
      id: "check-duplicates",
      name: "检查重复概念",
      icon: "copy",
      editorRequired: true,
      handler: async () => {
        await this.checkDuplicates();
      }
    });

    this.registerCommand({
      id: "undo-last-operation",
      name: "撤销上次操作",
      icon: "undo",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "z" }
      ],
      handler: async () => {
        await this.undoLastOperation();
      }
    });
  }

  /**
   * 注册视图切换命令
   */
  private registerViewCommands(): void {
    this.registerCommand({
      id: "toggle-workbench",
      name: "切换工作台显示",
      icon: "layout-sidebar",
      handler: async () => {
        await this.toggleWorkbench();
      }
    });

    this.registerCommand({
      id: "toggle-queue-view",
      name: "切换队列视图显示",
      icon: "layout-list",
      handler: async () => {
        await this.toggleQueueView();
      }
    });

    this.registerCommand({
      id: "open-undo-history",
      name: "打开操作历史",
      icon: "history",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "h" }
      ],
      handler: async () => {
        await this.openUndoHistory();
      }
    });
  }

  /**
   * 注册单个命令
   */
  private registerCommand(def: CommandDefinition): void {
    this.commands.set(def.id, def);

    if (def.editorRequired) {
      // 需要编辑器的命令
      this.plugin.addCommand({
        id: def.id,
        name: def.name,
        icon: def.icon,
        editorCallback: async (editor, view) => {
          try {
            await def.handler();
          } catch (error) {
            console.error(`命令执行失败: ${def.id}`, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            new Notice(`命令执行失败: ${errorMessage}`);
          }
        },
        hotkeys: def.hotkeys
      });
    } else if (def.checkCallback) {
      // 条件命令
      this.plugin.addCommand({
        id: def.id,
        name: def.name,
        icon: def.icon,
        checkCallback: (checking) => {
          try {
            return def.checkCallback!(checking);
          } catch (error) {
            console.error(`命令检查失败: ${def.id}`, error);
            return false;
          }
        },
        hotkeys: def.hotkeys
      });
    } else {
      // 普通命令
      this.plugin.addCommand({
        id: def.id,
        name: def.name,
        icon: def.icon,
        callback: async () => {
          try {
            await def.handler();
          } catch (error) {
            console.error(`命令执行失败: ${def.id}`, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            new Notice(`命令执行失败: ${errorMessage}`);
          }
        },
        hotkeys: def.hotkeys
      });
    }
  }

  /**
   * 执行命令
   */
  public async executeCommand(commandId: string): Promise<void> {
    const def = this.commands.get(commandId);
    if (!def) {
      throw new Error(`未找到命令: ${commandId}`);
    }

    await def.handler();
  }

  /**
   * 获取所有命令
   */
  public getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  // ========================================================================
  // 命令实现
  // ========================================================================

  /**
   * 打开工作台
   */
  private async openWorkbench(): Promise<void> {
    const { workspace } = this.plugin.app;
    
    // 检查是否已经打开
    const existing = workspace.getLeavesOfType("cognitive-razor-workbench");
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // 在右侧边栏打开
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: "cognitive-razor-workbench",
        active: true
      });
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * 创建概念
   */
  private async createConcept(): Promise<void> {
    // TODO: 打开创建概念对话框
    new Notice("创建概念功能待实现");
  }

  /**
   * 从选中文本创建概念
   */
  private async createConceptFromSelection(): Promise<void> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请在编辑器中选择文本");
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();
    
    if (!selection) {
      new Notice("请先选择文本");
      return;
    }

    // TODO: 使用选中文本创建概念
    new Notice(`从选中文本创建概念: ${selection.substring(0, 50)}...`);
  }

  /**
   * 打开队列
   */
  private async openQueue(): Promise<void> {
    const { workspace } = this.plugin.app;
    
    // 检查是否已经打开
    const existing = workspace.getLeavesOfType("cognitive-razor-queue");
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // 在右侧边栏打开
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: "cognitive-razor-queue",
        active: true
      });
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * 切换队列状态
   */
  private async toggleQueue(): Promise<void> {
    // TODO: 调用 TaskQueue 切换暂停/恢复
    new Notice("切换队列状态功能待实现");
  }

  /**
   * 清空已完成任务
   */
  private async clearCompletedTasks(): Promise<void> {
    // TODO: 调用 TaskQueue 清空已完成任务
    new Notice("清空已完成任务功能待实现");
  }

  /**
   * 重试失败任务
   */
  private async retryFailedTasks(): Promise<void> {
    // TODO: 调用 TaskQueue 重试失败任务
    new Notice("重试失败任务功能待实现");
  }

  /**
   * 生成笔记内容
   */
  private async enrichNote(): Promise<void> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请在编辑器中打开笔记");
      return;
    }

    // TODO: 调用 TaskRunner 生成内容
    new Notice("生成笔记内容功能待实现");
  }

  /**
   * 增量改进笔记
   */
  private async improveNote(): Promise<void> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请在编辑器中打开笔记");
      return;
    }

    const file = view.file;
    if (!file) {
      new Notice("无法获取当前文件");
      return;
    }

    await this.improveNoteFromFile(file);
  }

  /**
   * 从文件触发增量改进
   */
  private async improveNoteFromFile(file: TFile): Promise<void> {
    if (!this.taskQueue) {
      new Notice("任务队列未初始化");
      return;
    }

    // 打开增量改进模态框
    const modal = new IncrementalImproveModal(
      this.plugin.app,
      file,
      this.taskQueue
    );
    modal.open();
  }

  /**
   * 检查重复概念
   */
  private async checkDuplicates(): Promise<void> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请在编辑器中打开笔记");
      return;
    }

    // TODO: 调用 DuplicateManager 检查重复
    new Notice("检查重复概念功能待实现");
  }

  /**
   * 撤销上次操作
   */
  private async undoLastOperation(): Promise<void> {
    // TODO: 调用 UndoManager 执行撤销
    new Notice("撤销上次操作功能待实现");
  }

  /**
   * 切换工作台显示
   */
  private async toggleWorkbench(): Promise<void> {
    const { workspace } = this.plugin.app;
    const existing = workspace.getLeavesOfType("cognitive-razor-workbench");
    
    if (existing.length > 0) {
      // 已打开，关闭它
      existing[0].detach();
    } else {
      // 未打开，打开它
      await this.openWorkbench();
    }
  }

  /**
   * 切换队列视图显示
   */
  private async toggleQueueView(): Promise<void> {
    const { workspace } = this.plugin.app;
    const existing = workspace.getLeavesOfType("cognitive-razor-queue");
    
    if (existing.length > 0) {
      // 已打开，关闭它
      existing[0].detach();
    } else {
      // 未打开，打开它
      await this.openQueue();
    }
  }

  /**
   * 打开撤销历史视图
   */
  private async openUndoHistory(): Promise<void> {
    const { workspace } = this.plugin.app;
    
    // 检查是否已经打开
    const existing = workspace.getLeavesOfType("cognitive-razor-undo-history");
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // 在右侧边栏打开
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: "cognitive-razor-undo-history",
        active: true
      });
      workspace.revealLeaf(leaf);
    }
  }
}
