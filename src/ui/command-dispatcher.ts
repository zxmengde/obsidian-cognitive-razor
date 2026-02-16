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
 * 核心命令：
 * - cognitive-razor:open-workbench
 * - cognitive-razor:create-concept
 * - cognitive-razor:improve-note（Amend/修订）
 * - cognitive-razor:merge-duplicates
 */

import { Plugin, Notice, MarkdownView, TFile, Menu } from "obsidian";
import { SimpleInputModal } from "./simple-input-modal";
import { WorkbenchPanel, WORKBENCH_VIEW_TYPE } from "./workbench-panel";
import { TaskQueue } from "../core/task-queue";
import { COMMAND_IDS, getCoreCommandIds, isValidCommandId } from "./command-utils";
import type CognitiveRazorPlugin from "../../main";
import { formatMessage } from "../core/i18n";
import { safeErrorMessage } from "../types";

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
   * 获取 i18n 文本
   */
  private t(path: string): string {
    try {
      const keys = path.split(".");
      let current: unknown = this.plugin.getI18n().t();
      for (const key of keys) {
        if (current && typeof current === "object" && key in current) {
          current = (current as Record<string, unknown>)[key];
        } else {
          return path;
        }
      }
      return typeof current === "string" ? current : path;
    } catch {
      return path;
    }
  }

  /**
   * 记录错误日志
   */
  private logError(context: string, error: unknown, extra?: Record<string, unknown>): void {
    const logger = this.plugin.getComponents().logger;
    if (logger) {
      logger.error("CommandDispatcher", context, error instanceof Error ? error : new Error(String(error)), extra);
    }
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
   * 遵循设计文档第 12 章：命令系统
   * 核心命令：
   * - 打开 Workbench
   * - 创建概念
   * - 对当前笔记启动 Amend（修订）
   * - 对当前重复对启动 Merge
   */
  public registerAllCommands(): void {
    // 核心命令：打开工作台
    this.registerWorkbenchCommands();

    // 核心命令：创建概念
    this.registerConceptCommands();

    // 核心命令：修订
    this.registerImproveCommands();

    // Expand（当前笔记拓展）
    this.registerExpandCommands();

    // 核心命令：合并重复对
    this.registerMergeCommands();

    // 阶段 2：重要功能命令
    this.registerUtilityCommands();

    // 注册文件菜单（增量改进）
    this.registerFileMenu();
  }

  /**
   * 注册工具类命令（阶段 2）
   */
  private registerUtilityCommands(): void {
    const t = this.plugin.getI18n().t();

    // 插入图片
    this.registerCommand({
      id: COMMAND_IDS.INSERT_IMAGE,
      name: this.t("workbench.buttons.insertImage"),
      icon: "image",
      editorRequired: true,
      handler: async () => {
        const workbench = await this.openWorkbench();
        await workbench?.startImageInsert();
      }
    });

    // 事实核查（Verify）
    this.registerCommand({
      id: COMMAND_IDS.VERIFY_CURRENT_NOTE,
      name: this.t("workbench.buttons.verify"),
      icon: "check",
      editorRequired: true,
      handler: async () => {
        const verifyOrchestrator = this.plugin.getComponents().verifyOrchestrator;
        if (!verifyOrchestrator) {
          new Notice(this.t("workbench.notifications.orchestratorNotInitialized"));
          return;
        }

        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
          new Notice(this.t("workbench.notifications.openMarkdownFirst"));
          return;
        }

        const result = verifyOrchestrator.startVerifyPipeline(activeFile.path);
        if (!result.ok) {
          new Notice(formatMessage(t.workbench.notifications.startFailed, { message: result.error.message }));
          return;
        }

        new Notice(this.t("workbench.notifications.verifyStarted"));
        await this.openWorkbench();
      }
    });

    // 查看重复概念
    this.registerCommand({
      id: COMMAND_IDS.VIEW_DUPLICATES,
      name: t.workbench.duplicates.title,
      icon: "copy",
      handler: async () => {
        const workbench = await this.openWorkbench();
        workbench?.revealDuplicates();
      }
    });

    // 暂停队列
    this.registerCommand({
      id: COMMAND_IDS.PAUSE_QUEUE,
      name: t.workbench.queueStatus.pauseQueue,
      icon: "pause",
      handler: async () => {
        const taskQueue = this.taskQueue ?? this.plugin.getComponents().taskQueue;
        if (!taskQueue) {
          new Notice(t.workbench.notifications.systemNotInitialized);
          return;
        }
        await taskQueue.pause();
        new Notice(t.workbench.notifications.queuePaused);
      }
    });

    // 恢复队列
    this.registerCommand({
      id: COMMAND_IDS.RESUME_QUEUE,
      name: t.workbench.queueStatus.resumeQueue,
      icon: "play",
      handler: async () => {
        const taskQueue = this.taskQueue ?? this.plugin.getComponents().taskQueue;
        if (!taskQueue) {
          new Notice(t.workbench.notifications.systemNotInitialized);
          return;
        }
        await taskQueue.resume();
        new Notice(t.workbench.queueStatus.queueResumed);
      }
    });

    // 重试失败任务
    this.registerCommand({
      id: COMMAND_IDS.RETRY_FAILED,
      name: t.workbench.queueStatus.retryFailed,
      icon: "refresh-cw",
      handler: async () => {
        const taskQueue = this.taskQueue ?? this.plugin.getComponents().taskQueue;
        if (!taskQueue) {
          new Notice(t.workbench.notifications.systemNotInitialized);
          return;
        }

        const result = await taskQueue.retryFailed();
        if (!result.ok) {
          new Notice(`${t.common.error}: ${result.error.message}`);
          return;
        }

        new Notice(`${t.workbench.notifications.retryComplete}: ${result.value}`);
        await this.openWorkbench();
      }
    });

    // 清空队列（取消所有 Pending 任务）
    this.registerCommand({
      id: COMMAND_IDS.CLEAR_QUEUE,
      name: t.workbench.queueStatus.clearPending || "清空队列",
      icon: "trash",
      handler: async () => {
        const taskQueue = this.taskQueue ?? this.plugin.getComponents().taskQueue;
        if (!taskQueue) {
          new Notice(t.workbench.notifications.systemNotInitialized);
          return;
        }

        const tasks = taskQueue.getAllTasks();
        const cancellable = tasks.filter(t => t.state === "Pending");

        let cancelled = 0;
        for (const task of cancellable) {
          try {
            taskQueue.cancel(task.id);
            cancelled++;
          } catch (error) {
            this.logError("取消任务失败", error, { taskId: task.id });
          }
        }

        new Notice(`${t.workbench.notifications.clearComplete}: ${cancelled}`);
      }
    });

    // 查看操作历史（合并历史）
    this.registerCommand({
      id: COMMAND_IDS.VIEW_OPERATION_HISTORY,
      name: t.workbench.recentOps.title,
      icon: "history",
      handler: async () => {
        const workbench = await this.openWorkbench();
        workbench?.openOperationHistory();
      }
    });

  }

  /**
   * 注册文件菜单（右键菜单）
   */
  private registerFileMenu(): void {
    const t = this.plugin.getI18n().t();
    // 使用 workspace.on 注册文件菜单事件
    const workspace = this.plugin.app.workspace as unknown as {
      on: (event: string, callback: (menu: Menu, file: TFile) => void) => { unload: () => void };
    };
    this.plugin.registerEvent(
      workspace.on("file-menu", (menu: Menu, file: TFile) => {
        // 只对 Markdown 文件显示菜单
        if (file.extension !== "md") {
          return;
        }

        // 添加改进菜单项
        menu.addItem((item) => {
          item
            .setTitle(t.commands.improveNote)
            .setIcon("sparkles")
            .onClick(async () => {
              await this.improveNote(file.path);
            });
        });
      })
    );
  }

  /**
   * 注册增量改进命令
   */
  private registerImproveCommands(): void {
    this.registerCommand({
      id: COMMAND_IDS.IMPROVE_NOTE,
      name: this.t("commands.improveNote"),
      icon: "sparkles",
      handler: async () => {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          await this.improveNote(activeFile.path);
        }
      },
      checkCallback: (checking) => {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
          return false;
        }
        if (!checking) {
          void this.improveNote(activeFile.path);
        }
        return true;
      }
    });
  }

  /**
   * 注册拓展命令
   */
  private registerExpandCommands(): void {
    this.registerCommand({
      id: COMMAND_IDS.EXPAND_CURRENT_NOTE,
      name: this.t("commands.expandNote"),
      icon: "git-branch",
      handler: async () => {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          await this.runExpand(activeFile);
        }
      },
      checkCallback: (checking) => {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
          return false;
        }
        if (!checking) {
          void this.runExpand(activeFile);
        }
        return true;
      }
    });
  }

  /**
   * 注册合并重复对命令
   * 
   * 遵循设计文档第 12 章：命令系统
   */
  private registerMergeCommands(): void {
    this.registerCommand({
      id: COMMAND_IDS.MERGE_DUPLICATES,
      name: this.t("commands.mergeDuplicates"),
      icon: "git-merge",
      handler: async () => {
        await this.openMergeFromWorkbench();
      }
    });
  }

  /**
   * 从工作台启动拓展
   */
  private async runExpand(file: TFile): Promise<void> {
    try {
      const workbench = await this.openWorkbench();
      if (!workbench) {
        new Notice(this.t("workbench.notifications.workbenchNotInitialized"));
        return;
      }
      await workbench.handleStartExpand(file);
    } catch (error) {
      const logger = this.plugin.getComponents().logger;
      logger?.error("CommandDispatcher", "拓展操作失败", error instanceof Error ? error : new Error(String(error)));
      new Notice(safeErrorMessage(error, this.t("workbench.notifications.startFailed")));
    }
  }

  /**
   * 从工作台打开合并流程
   */
  private async openMergeFromWorkbench(): Promise<void> {
    // 打开工作台
    const workbench = await this.openWorkbench();
    if (!workbench) {
      new Notice(this.t("workbench.notifications.workbenchNotInitialized"));
      return;
    }

    // 获取待处理的重复对
    const components = this.plugin.getComponents();
    const duplicateManager = components.duplicateManager;
    const pendingPairs = duplicateManager.getPendingPairs();

    if (pendingPairs.length === 0) {
      new Notice(this.t("workbench.notifications.noPendingDuplicates"));
      return;
    }

    // 提示用户在工作台中选择重复对进行合并
    new Notice(formatMessage(
      this.t("workbench.notifications.pendingDuplicatesHint"),
      { count: pendingPairs.length }
    ));
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
      name: this.t("commands.openWorkbench"),
      icon: "brain",
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
      name: this.t("commands.createConcept"),
      icon: "plus",
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
            this.logError(`命令执行失败: ${def.id}`, error, { commandId: def.id });
            const errorMessage = safeErrorMessage(error);
            new Notice(formatMessage(this.t("workbench.notifications.commandFailed"), { message: errorMessage }));
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
            this.logError(`命令检查失败: ${def.id}`, error, { commandId: def.id });
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
            this.logError(`命令执行失败: ${def.id}`, error, { commandId: def.id });
            const errorMessage = safeErrorMessage(error);
            new Notice(formatMessage(this.t("workbench.notifications.commandFailed"), { message: errorMessage }));
          }
        },
        hotkeys: def.hotkeys
      });
    }
  }

  /**
   * 执行命令
   * 
   * 注意：如果命令不存在会抛出异常，调用者需要处理
   */
  public async executeCommand(commandId: string): Promise<void> {
    const def = this.commands.get(commandId);
    if (!def) {
      const error = new Error(`未找到命令: ${commandId}`);
      this.logError("执行命令失败：命令不存在", error, { commandId });
      throw error;
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
      title: this.t("workbench.createConcept.title"),
      placeholder: this.t("workbench.createConcept.placeholder"),
      onSubmit: async (input) => {
        const workbench = await this.openWorkbench();
        if (!workbench) {
          new Notice(this.t("workbench.notifications.workbenchNotInitialized"));
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

  /**
   * 修订笔记
   * 
   * 遵循设计文档 6.7：Amend（修订）流程
   * - 创建快照
   * - 生成候选改写
   * - DiffView 确认后落盘
   */
  private async improveNote(filePath: string): Promise<void> {
    try {
      const components = this.plugin.getComponents();
      const orchestrator = components.amendOrchestrator;

      if (!orchestrator) {
        new Notice(this.t("workbench.notifications.orchestratorNotInitialized"));
        return;
      }

      // 显示输入框获取改进指令
      const modal = new SimpleInputModal(this.plugin.app, {
        title: this.t("workbench.amendModal.title"),
        placeholder: this.t("workbench.amendModal.placeholder"),
        onSubmit: async (instruction) => {
          try {
            if (!instruction.trim()) {
              new Notice(this.t("workbench.notifications.improveInstructionRequired"));
              return;
            }

            // 启动修订管线
            const result = orchestrator.startAmendPipeline(filePath, instruction);
            
            if (!result.ok) {
              new Notice(formatMessage(this.t("workbench.notifications.startFailed"), { message: result.error.message }));
              return;
            }

            new Notice(this.t("workbench.notifications.improveStarted"));
            
            // 打开工作台以便查看进度
            await this.openWorkbench();
          } catch (error) {
            const logger = this.plugin.getComponents().logger;
            logger?.error("CommandDispatcher", "修订操作失败", error instanceof Error ? error : new Error(String(error)));
            new Notice(safeErrorMessage(error, this.t("workbench.notifications.startFailed")));
          }
        },
        onCancel: () => {
          // 用户取消
        }
      });

      modal.open();
    } catch (error) {
      const logger = this.plugin.getComponents().logger;
      logger?.error("CommandDispatcher", "打开修订对话框失败", error instanceof Error ? error : new Error(String(error)));
      new Notice(safeErrorMessage(error, this.t("workbench.notifications.startFailed")));
    }
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
