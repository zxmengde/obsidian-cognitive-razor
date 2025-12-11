/**
 * CommandDispatcher - 命令统一分发器
 * 
 * 功能：
 * - 注册所有命令（遵循 A-FUNC-09 UI 注册规范）
 * - 实现快捷键绑定（遵循 A-UCD-05 多输入一致）
 * - 实现命令分发
 * 
 * 命令 ID 格式：cognitive-razor:<action>-<target>
 * 
 * 核心命令（Requirements 9.1-9.4）：
 * - cognitive-razor:create-concept (Ctrl/Cmd + Shift + N)
 * - cognitive-razor:open-queue (Ctrl/Cmd + Shift + Q)
 * - cognitive-razor:pause-queue (Ctrl/Cmd + Shift + P)
 */

import { Plugin, Notice, MarkdownView, TFile, Menu } from "obsidian";
import { SimpleInputModal } from "./simple-input-modal";
import { WorkbenchPanel, WORKBENCH_VIEW_TYPE } from "./workbench-panel";
import { TaskQueue } from "../core/task-queue";
import { COMMAND_IDS, getCoreCommandIds, isValidCommandId } from "./command-utils";
import type CognitiveRazorPlugin from "../../main";
import type { DuplicatePair, SnapshotMetadata } from "../types";

/**
 * 命令处理器类型
 */
type CommandHandler = () => void | Promise<void>;

/**
 * 命令定义
 */
interface CommandDefinition {
  /** 命令 ID（格式：cognitive-razor:<action>-<target>） */
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
  private plugin: CognitiveRazorPlugin;
  private commands: Map<string, CommandDefinition> = new Map();
  private taskQueue: TaskQueue | null = null;

  constructor(plugin: CognitiveRazorPlugin, taskQueue?: TaskQueue) {
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
   * 
   * 重构说明：仅保留核心命令入口
   * - 创建概念（Create Concept）
   * - 打开工作台（Open Workbench）
   * 其他功能通过工作台内部操作完成
   */
  public registerAllCommands(): void {
    // 核心命令：创建概念
    this.registerConceptCommands();

    // 核心命令：打开工作台
    this.registerWorkbenchCommands();

    // 注册文件菜单（增量改进）
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

        // 文件菜单项可以在这里添加
        // 目前增量改进功能已弃用
      })
    );
  }

  /**
   * 注册工作台相关命令
   * 
   * 核心命令：打开工作台
   * 工作台是所有功能的统一入口
   */
  private registerWorkbenchCommands(): void {
    this.registerCommand({
      id: COMMAND_IDS.OPEN_WORKBENCH,
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
   * 
   * 核心命令：创建概念
   * Requirements 9.2: cognitive-razor:create-concept (Ctrl/Cmd + Shift + N)
   */
  private registerConceptCommands(): void {
    // 核心命令：创建概念
    // Requirements 9.2: ID = cognitive-razor:create-concept, 快捷键 = Ctrl/Cmd + Shift + N
    this.registerCommand({
      id: COMMAND_IDS.CREATE_CONCEPT,
      name: "创建概念",
      icon: "plus",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "n" }
      ],
      handler: async () => {
        await this.createConcept();
      }
    });
  }

  // 已移除队列管理、笔记操作、视图切换命令
  // 这些功能现在通过工作台内部操作完成

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

  /**
   * 获取命令定义
   * @param commandId 命令 ID
   * @returns 命令定义或 undefined
   */
  public getCommand(commandId: string): CommandDefinition | undefined {
    return this.commands.get(commandId);
  }

  /**
   * 检查命令是否已注册
   * @param commandId 命令 ID
   * @returns 是否已注册
   */
  public hasCommand(commandId: string): boolean {
    return this.commands.has(commandId);
  }

  /**
   * 获取核心命令 ID 列表
   * 返回 Requirements 9.1-9.4 定义的核心命令
   */
  public static getCoreCommandIds(): string[] {
    return getCoreCommandIds();
  }

  /**
   * 验证命令 ID 格式
   * 遵循 Requirements 9.1：命令 ID 格式为 cognitive-razor:<action>-<target>
   * @param commandId 命令 ID
   * @returns 是否符合格式
   */
  public static isValidCommandId(commandId: string): boolean {
    return isValidCommandId(commandId);
  }

  // ========================================================================
  // 命令实现
  // ========================================================================

  /**
   * 打开工作台
   */
  private async openWorkbench(): Promise<WorkbenchPanel | null> {
    const { workspace } = this.plugin.app;
    
    // 检查是否已经打开
    const existing = workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return existing[0].view as WorkbenchPanel;
    }

    // 在右侧边栏打开
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: WORKBENCH_VIEW_TYPE,
        active: true
      });
      workspace.revealLeaf(leaf);
      return leaf.view as WorkbenchPanel;
    }

    return null;
  }

  /**
   * 创建概念
   * 
   * 遵循设计文档 A-FUNC-05：启动创建管线
   * 遵循设计文档 A-UCD-01：三步完成核心任务
   */
  private async createConcept(): Promise<void> {
    const modal = new SimpleInputModal(this.plugin.app, {
      title: "创建概念",
      placeholder: "输入概念描述...",
      onSubmit: async (input) => {
        const workbench = await this.openWorkbench();
        if (!workbench) {
          new Notice("工作台未初始化，请稍后重试");
          return;
        }
        await workbench.startQuickCreate(input);
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    });

    modal.open();
  }

  // 已移除的命令实现方法：
  // - createConceptFromSelection (通过工作台创建)
  // - openQueue (队列功能已整合到工作台)
  // - toggleQueue (通过工作台操作)
  // - clearCompletedTasks (通过工作台操作)
  // - retryFailedTasks (通过工作台操作)
  // - enrichNote (通过文件菜单触发)

  // 已移除的命令实现方法：
  // - checkDuplicates (重复管理已整合到工作台)
  // - undoLastOperation (撤销功能已整合到工作台)
  // - toggleWorkbench (不再需要切换命令)
  // - toggleQueueView (队列视图已废除)
  // - openUndoHistory (历史视图已废除)
}
