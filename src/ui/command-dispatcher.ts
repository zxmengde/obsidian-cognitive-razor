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
import { IncrementalImproveModal } from "./incremental-improve-modal";
import { TaskQueue } from "../core/task-queue";
import { 
  COMMAND_PREFIX, 
  COMMAND_IDS, 
  getCoreCommandIds, 
  isValidCommandId 
} from "./command-utils";
import type CognitiveRazorPlugin from "../../main";
import type { DuplicatePair, SnapshotMetadata } from "../types";

// 重新导出常量，保持向后兼容
export { COMMAND_PREFIX, COMMAND_IDS };

/**
 * 命令处理器类型
 */
export type CommandHandler = () => void | Promise<void>;

/**
 * 命令定义
 */
export interface CommandDefinition {
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

    this.registerCommand({
      id: COMMAND_IDS.CREATE_CONCEPT_FROM_SELECTION,
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
   * 
   * Requirements 9.3: cognitive-razor:open-queue (Ctrl/Cmd + Shift + Q)
   * Requirements 9.4: cognitive-razor:pause-queue (Ctrl/Cmd + Shift + P)
   */
  private registerQueueCommands(): void {
    // 核心命令：打开队列
    // Requirements 9.3: ID = cognitive-razor:open-queue, 快捷键 = Ctrl/Cmd + Shift + Q
    this.registerCommand({
      id: COMMAND_IDS.OPEN_QUEUE,
      name: "打开任务队列",
      icon: "list-checks",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "q" }
      ],
      handler: async () => {
        await this.openQueue();
      }
    });

    // 核心命令：暂停队列
    // Requirements 9.4: ID = cognitive-razor:pause-queue, 快捷键 = Ctrl/Cmd + Shift + P
    this.registerCommand({
      id: COMMAND_IDS.PAUSE_QUEUE,
      name: "暂停/恢复队列",
      icon: "pause",
      hotkeys: [
        { modifiers: ["Mod", "Shift"], key: "p" }
      ],
      handler: async () => {
        await this.toggleQueue();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.CLEAR_COMPLETED_TASKS,
      name: "清空已完成任务",
      icon: "trash",
      handler: async () => {
        await this.clearCompletedTasks();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.RETRY_FAILED_TASKS,
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
      id: COMMAND_IDS.ENRICH_NOTE,
      name: "生成笔记内容",
      icon: "wand",
      editorRequired: true,
      handler: async () => {
        await this.enrichNote();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.IMPROVE_NOTE,
      name: "增量改进笔记",
      icon: "edit",
      editorRequired: true,
      handler: async () => {
        await this.improveNote();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.CHECK_DUPLICATES,
      name: "检查重复概念",
      icon: "copy",
      editorRequired: true,
      handler: async () => {
        await this.checkDuplicates();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.UNDO_LAST_OPERATION,
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
      id: COMMAND_IDS.TOGGLE_WORKBENCH,
      name: "切换工作台显示",
      icon: "layout-sidebar",
      handler: async () => {
        await this.toggleWorkbench();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.TOGGLE_QUEUE_VIEW,
      name: "切换队列视图显示",
      icon: "layout-list",
      handler: async () => {
        await this.toggleQueueView();
      }
    });

    this.registerCommand({
      id: COMMAND_IDS.OPEN_UNDO_HISTORY,
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
   * 
   * 遵循设计文档 A-FUNC-05：启动创建管线
   * 遵循设计文档 A-UCD-01：三步完成核心任务
   */
  private async createConcept(): Promise<void> {
    // 动态导入 Modal 和 PipelineOrchestrator
    const { CreateConceptModal } = await import("./create-concept-modal");
    const components = (this.plugin as any).getComponents?.();
    
    if (!components?.pipelineOrchestrator) {
      new Notice("系统未初始化，请稍后再试");
      return;
    }

    const pipelineOrchestrator = components.pipelineOrchestrator;

    // 打开创建概念对话框
    const modal = new CreateConceptModal(this.plugin.app, {
      onSubmit: (input, type) => {
        // 启动创建管线
        const result = pipelineOrchestrator.startCreatePipeline(input, type);
        
        if (result.ok) {
          new Notice(`创建管线已启动: ${result.value}`);
          
          // 打开工作台以查看进度
          this.openWorkbench();
        } else {
          new Notice(`启动失败: ${result.error.message}`);
        }
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    });

    modal.open();
  }

  /**
   * 从选中文本创建概念
   * 
   * 遵循设计文档 A-FUNC-05：启动创建管线
   */
  private async createConceptFromSelection(): Promise<void> {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("请在编辑器中选择文本");
      return;
    }

    const editor = view.editor;
    const selection = editor.getSelection();
    
    if (!selection || !selection.trim()) {
      new Notice("请先选择文本");
      return;
    }

    // 动态导入 Modal 和 PipelineOrchestrator
    const { CreateConceptModal } = await import("./create-concept-modal");
    const components = (this.plugin as any).getComponents?.();
    
    if (!components?.pipelineOrchestrator) {
      new Notice("系统未初始化，请稍后再试");
      return;
    }

    const pipelineOrchestrator = components.pipelineOrchestrator;

    // 打开创建概念对话框，预填选中文本
    const modal = new CreateConceptModal(this.plugin.app, {
      defaultValue: selection.trim(),
      onSubmit: (input, type) => {
        // 启动创建管线
        const result = pipelineOrchestrator.startCreatePipeline(input, type);
        
        if (result.ok) {
          new Notice(`创建管线已启动: ${result.value}`);
          
          // 打开工作台以查看进度
          this.openWorkbench();
        } else {
          new Notice(`启动失败: ${result.error.message}`);
        }
      }
    });

    modal.open();
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
    if (!this.taskQueue) {
      new Notice("任务队列未初始化");
      return;
    }

    const status = this.taskQueue.getStatus();
    if (status.paused) {
      this.taskQueue.resume();
      new Notice("队列已恢复运行");
    } else {
      this.taskQueue.pause();
      new Notice("队列已暂停");
    }
  }

  /**
   * 清空已完成任务
   */
  private async clearCompletedTasks(): Promise<void> {
    if (!this.taskQueue) {
      new Notice("任务队列未初始化");
      return;
    }

    const result = await this.taskQueue.clearCompleted();
    if (result.ok) {
      new Notice(`已清空 ${result.value} 个已完成任务`);
    } else {
      new Notice(`清空失败: ${result.error.message}`);
    }
  }

  /**
   * 重试失败任务
   */
  private async retryFailedTasks(): Promise<void> {
    if (!this.taskQueue) {
      new Notice("任务队列未初始化");
      return;
    }

    const result = await this.taskQueue.retryFailed();
    if (result.ok) {
      new Notice(`已重新排队 ${result.value} 个失败任务`);
    } else {
      new Notice(`重试失败: ${result.error.message}`);
    }
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

    const file = view.file;
    if (!file) {
      new Notice("无法获取当前文件");
      return;
    }

    // 复用增量改进流程，引导用户输入生成意图
    await this.improveNoteFromFile(file);
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
    const components = this.plugin.getComponents();
    if (!components.pipelineOrchestrator) {
      new Notice("管线编排器未初始化");
      return;
    }

    // 打开增量改进模态框
    const modal = new IncrementalImproveModal(
      this.plugin.app,
      file,
      components.pipelineOrchestrator
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

    const file = view.file;
    if (!file) {
      new Notice("无法获取当前文件");
      return;
    }

    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;
    if (!duplicateManager) {
      new Notice("重复管理器未初始化");
      return;
    }

    // 直接从待处理列表中过滤当前文件
    const pending = duplicateManager.getPendingPairs();
    const related = pending.filter(
      (p: DuplicatePair) => p.noteA.path === file.path || p.noteB.path === file.path
    );

    if (related.length > 0) {
      new Notice(`发现 ${related.length} 个待处理重复对，已在工作台显示`);
      // 刷新工作台重复列表
      const workbenchLeaves = this.plugin.app.workspace.getLeavesOfType("cognitive-razor-workbench");
      if (workbenchLeaves.length > 0) {
        (workbenchLeaves[0].view as any).updateDuplicates(pending);
      }
    } else {
      new Notice("当前笔记未检测到待处理重复对（如需，先运行创建/合并流程以生成索引）");
    }
  }

  /**
   * 撤销上次操作
   */
  private async undoLastOperation(): Promise<void> {
    const undoManager = this.plugin.getComponents().undoManager;
    const snapshotsResult = await undoManager.listSnapshots();
    if (!snapshotsResult.ok || snapshotsResult.value.length === 0) {
      new Notice("暂无可撤销的快照");
      return;
    }

    // 按时间排序，取最新
    const snapshots = snapshotsResult.value.sort(
      (a: SnapshotMetadata, b: SnapshotMetadata) => new Date(b.created).getTime() - new Date(a.created).getTime()
    );
    const latest = snapshots[0];

    const restoreResult = await undoManager.restoreSnapshotToFile(latest.id);
    if (!restoreResult.ok) {
      new Notice(`撤销失败: ${restoreResult.error.message}`);
      return;
    }

    new Notice(`已撤销到快照 ${latest.id}`);
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
