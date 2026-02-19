/**
 * CommandDispatcher - 命令统一分发器
 *
 * 功能：
 * - 注册所有命令（遵循 A-FUNC-09 UI 注册规范）
 * - 实现快捷键绑定（遵循 A-UCD-05 多输入一致）
 * - 实现命令分发
 *
 * 命令通过新的 Svelte 工作台视图（WorkbenchView）
 * 触发对应的 UI 流程，不再使用旧的原生 DOM Modal。
 *
 * @see 需求 21.3
 */

import { Notice, TFile } from "obsidian";
import { VIEW_TYPE_CR_WORKBENCH } from "./svelte/workbench-view";
import { TaskQueue } from "../core/task-queue";
import { COMMAND_IDS } from "./command-utils";
import type CognitiveRazorPlugin from "../../main";
import { formatMessage } from "../core/i18n";
import { safeErrorMessage } from "../types";
import { showSuccess, showError, showWarning } from "./feedback";

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
 *
 * 所有命令通过 Svelte 工作台视图和 Orchestrator API 触发 UI 流程：
 * - Define/Create → 打开工作台，聚焦 CreateSection 搜索框
 * - Expand → 打开工作台（拓展由内联面板处理）
 * - Verify → 直接调用 VerifyOrchestrator
 * - Visualize → 打开工作台（配图由内联面板处理）
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
     * 获取当前活动的 Markdown 文件，不存在时显示警告
     * @returns TFile 或 null（已显示警告）
     */
    private getActiveMarkdownFile(): TFile | null {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
            showWarning(this.t("workbench.notifications.openMarkdownFirst"));
            return null;
        }
        return activeFile;
    }

    /**
     * 构建需要活动 Markdown 文件的命令定义片段（handler + checkCallback）
     *
     * 消除 getActiveFile + extension 检查的重复模式（DRY）。
     */
    private withActiveMarkdownFile(action: (file: TFile) => void | Promise<void>): Pick<CommandDefinition, "handler" | "checkCallback"> {
        return {
            handler: async () => {
                const file = this.getActiveMarkdownFile();
                if (file) await action(file);
            },
            checkCallback: (checking) => {
                const activeFile = this.plugin.app.workspace.getActiveFile();
                if (!activeFile || activeFile.extension !== "md") return false;
                if (!checking) void action(activeFile);
                return true;
            },
        };
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
     */
    public registerAllCommands(): void {
        this.registerWorkbenchCommands();
        this.registerConceptCommands();
        this.registerExpandCommands();
        this.registerUtilityCommands();
        this.registerFileMenu();
    }

    /**
     * 注册工具类命令
     */
    private registerUtilityCommands(): void {
        const t = this.plugin.getI18n().t();

        // 事实核查（Verify）— 直接调用 Orchestrator
        this.registerCommand({
            id: COMMAND_IDS.VERIFY_CURRENT_NOTE,
            name: this.t("workbench.buttons.verify"),
            icon: "check",
            editorRequired: true,
            handler: async () => {
                const verifyOrchestrator = this.plugin.getComponents().verifyOrchestrator;
                if (!verifyOrchestrator) {
                    showWarning(this.t("workbench.notifications.orchestratorNotInitialized"));
                    return;
                }

                const activeFile = this.getActiveMarkdownFile();
                if (!activeFile) return;

                const result = verifyOrchestrator.startVerifyPipeline(activeFile.path);
                if (!result.ok) {
                    showError(formatMessage(t.workbench.notifications.startFailed, { message: result.error.message }));
                    return;
                }

                showSuccess(this.t("workbench.notifications.verifyStarted"));
                await this.openWorkbench();
            }
        });

        // 查看重复概念 — 打开工作台
        this.registerCommand({
            id: COMMAND_IDS.VIEW_DUPLICATES,
            name: t.workbench.duplicates.title,
            icon: "copy",
            handler: async () => {
                await this.openWorkbench();
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
                    showWarning(t.workbench.notifications.systemNotInitialized);
                    return;
                }
                await taskQueue.pause();
                showSuccess(t.workbench.notifications.queuePaused);
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
                    showWarning(t.workbench.notifications.systemNotInitialized);
                    return;
                }
                await taskQueue.resume();
                showSuccess(t.workbench.queueStatus.queueResumed);
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
                    showWarning(t.workbench.notifications.systemNotInitialized);
                    return;
                }

                const result = await taskQueue.retryFailed();
                if (!result.ok) {
                    showError(`${t.common.error}: ${result.error.message}`);
                    return;
                }

                showSuccess(`${t.workbench.notifications.retryComplete}: ${result.value}`);
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
                    showWarning(t.workbench.notifications.systemNotInitialized);
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

                showSuccess(`${t.workbench.notifications.clearComplete}: ${cancelled}`);
            }
        });

    }

    /**
     * 注册文件菜单（右键菜单）
     */
    private registerFileMenu(): void {
        // 右键菜单暂无额外项
    }

    /**
     * 注册拓展命令
     * 打开工作台，拓展由内联面板处理
     */
    private registerExpandCommands(): void {
        this.registerCommand({
            id: COMMAND_IDS.EXPAND_CURRENT_NOTE,
            name: this.t("commands.expandNote"),
            icon: "git-branch",
            ...this.withActiveMarkdownFile(() => this.openWorkbench()),
        });
    }

    /**
     * 注册工作台相关命令
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
     * 打开工作台，聚焦 CreateSection 搜索框
     */
    private registerConceptCommands(): void {
        this.registerCommand({
            id: COMMAND_IDS.CREATE_CONCEPT,
            name: this.t("commands.createConcept"),
            icon: "plus",
            handler: async () => {
                await this.openWorkbench();
            }
        });
    }

    /**
     * 注册单个命令
     */
    private registerCommand(def: CommandDefinition): void {
        this.commands.set(def.id, def);

        if (def.editorRequired) {
            this.plugin.addCommand({
                id: def.id,
                name: def.name,
                icon: def.icon,
                editorCallback: async () => {
                    try {
                        await def.handler();
                    } catch (error) {
                        this.logError(`命令执行失败: ${def.id}`, error, { commandId: def.id });
                        showError(error, this.t("workbench.notifications.commandFailed"));
                    }
                },
                hotkeys: def.hotkeys
            });
        } else if (def.checkCallback) {
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
            this.plugin.addCommand({
                id: def.id,
                name: def.name,
                icon: def.icon,
                callback: async () => {
                    try {
                        await def.handler();
                    } catch (error) {
                        this.logError(`命令执行失败: ${def.id}`, error, { commandId: def.id });
                        showError(error, this.t("workbench.notifications.commandFailed"));
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
     */
    public getCommand(commandId: string): CommandDefinition | undefined {
        return this.commands.get(commandId);
    }

    /**
     * 检查命令是否已注册
     */
    public hasCommand(commandId: string): boolean {
        return this.commands.has(commandId);
    }

    // ========================================================================
    // 命令实现
    // ========================================================================

    /**
     * 打开工作台（Svelte WorkbenchView）
     * 如果已打开则聚焦，否则在右侧边栏创建
     */
    private async openWorkbench(): Promise<void> {
        const { workspace } = this.plugin.app;

        // 检查是否已经打开
        const existing = workspace.getLeavesOfType(VIEW_TYPE_CR_WORKBENCH);
        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]);
            return;
        }

        // 在右侧边栏打开
        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_CR_WORKBENCH,
                active: true
            });
            workspace.revealLeaf(leaf);
        }
    }

}
