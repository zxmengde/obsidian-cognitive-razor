/**
 * WorkbenchPanel — 工作台容器组件
 *
 * 纯容器，通过组合模式装配 4 个独立 Section：
 * 1. CreateSection  — 创建概念（默认展开）
 * 2. DuplicatesSection — 重复概念（默认展开）
 * 3. QueueSection — 队列状态（默认折叠）
 * 4. RecentOpsSection — 操作历史（默认折叠）
 *
 * 职责：
 * - 创建 Section 依赖并实例化各 Section
 * - 渲染 Section 到容器
 * - 订阅管线/队列事件并委托更新到 Section
 * - 实现防抖 UI 更新（150ms 窗口），仅更新有变化的 Section
 * - 卸载时清理所有 Section 的事件监听器和定时器
 *
 * 需求: 6.2, 6.3, 6.4, 8.1, 8.5, 19.1, 19.2
 */

import { ItemView, WorkspaceLeaf, Notice, TFile, setIcon } from "obsidian";
import type {
    DuplicatePair,
    QueueStatus,
    PipelineContext,
    WorkbenchUIState,
} from "../types";
import { DEFAULT_UI_STATE, safeErrorMessage } from "../types";
import { formatMessage } from "../core/i18n";

import type CognitiveRazorPlugin from "../../main";
import { SimpleDiffView } from "./diff-view";
import { MergeHistoryModal } from "./workbench/workbench-modals";

import type { CreateSectionDeps, DuplicatesSectionDeps, QueueSectionDeps, RecentOpsSectionDeps } from "./workbench/workbench-section-deps";
import { CreateSection } from "./workbench/create-section";
import { QueueSection } from "./workbench/queue-section";
import { DuplicatesSection } from "./workbench/duplicates-section";
import { RecentOpsSection } from "./workbench/recent-ops-section";

export const WORKBENCH_VIEW_TYPE = "cognitive-razor-workbench";
const ERROR_NOTICE_DURATION = 6000;

/** 防抖 UI 更新窗口（毫秒） */
const UI_DEBOUNCE_MS = 150;

/**
 * 区域折叠状态
 */
interface SectionCollapseState {
    createConcept: boolean;
    duplicates: boolean;
    queueStatus: boolean;
    recentOps: boolean;
}

/**
 * WorkbenchPanel — 纯容器组件
 *
 * 通过组合模式装配各 Section，自身不包含业务渲染逻辑。
 * 需求: 6.2, 6.3, 6.4, 8.1, 8.5, 19.1, 19.2
 */
export class WorkbenchPanel extends ItemView {
    private plugin: CognitiveRazorPlugin | null = null;
    private pipelineUnsubscribers: (() => void)[] = [];
    private queueUnsubscribe: (() => void) | null = null;

    // 四个独立 Section
    private createSection: CreateSection;
    private queueSection: QueueSection;
    private duplicatesSection: DuplicatesSection;
    private recentOpsSection: RecentOpsSection;

    // 区域折叠状态（创建区和重复对区默认展开，队列区和历史区默认折叠）
    private collapseState: SectionCollapseState = {
        createConcept: false,
        duplicates: false,
        queueStatus: true,
        recentOps: true,
    };

    // 防抖 UI 更新
    private updateTimer: number | null = null;
    private dirtyFlags = { queue: false, duplicates: false, recentOps: false, create: false };

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;

        // --- CreateSection 依赖 ---
        const createDeps: CreateSectionDeps = {
            app: this.app,
            t: (path) => this.t(path),
            showErrorNotice: (message) => this.showErrorNotice(message),
            logError: (context, error, extra) => this.logError(context, error, extra),
            logWarn: (context, extra) => this.logWarn(context, extra),
            resolveNoteName: (nodeId) => this.resolveNoteName(nodeId),
            resolveNotePath: (nodeId) => this.resolveNotePath(nodeId),
            registerEvent: (eventRef) => this.registerEvent(eventRef),
            getContainerEl: () => this.containerEl,
            get createOrchestrator() { return self.plugin!.getComponents().createOrchestrator; },
            get amendOrchestrator() { return self.plugin!.getComponents().amendOrchestrator; },
            get expandOrchestrator() { return self.plugin!.getComponents().expandOrchestrator; },
            get imageInsertOrchestrator() { return self.plugin!.getComponents().imageInsertOrchestrator; },
            get verifyOrchestrator() { return self.plugin!.getComponents().verifyOrchestrator; },
            getSettings: () => this.plugin!.settings,
            getTranslations: () => this.plugin!.getI18n().t(),
        };
        this.createSection = new CreateSection(createDeps);

        // --- QueueSection 依赖 ---
        const queueDeps: QueueSectionDeps = {
            app: this.app,
            t: (path) => this.t(path),
            showErrorNotice: (message) => this.showErrorNotice(message),
            logError: (context, error, extra) => this.logError(context, error, extra),
            logWarn: (context, extra) => this.logWarn(context, extra),
            resolveNoteName: (nodeId) => this.resolveNoteName(nodeId),
            resolveNotePath: (nodeId) => this.resolveNotePath(nodeId),
            registerEvent: (eventRef) => this.registerEvent(eventRef),
            getContainerEl: () => this.containerEl,
            get taskQueue() { return self.plugin!.getComponents().taskQueue; },
            getSettings: () => this.plugin!.settings,
        };
        this.queueSection = new QueueSection(queueDeps);

        // --- DuplicatesSection 依赖 ---
        const duplicatesDeps: DuplicatesSectionDeps = {
            app: this.app,
            t: (path) => this.t(path),
            showErrorNotice: (message) => this.showErrorNotice(message),
            logError: (context, error, extra) => this.logError(context, error, extra),
            logWarn: (context, extra) => this.logWarn(context, extra),
            resolveNoteName: (nodeId) => this.resolveNoteName(nodeId),
            resolveNotePath: (nodeId) => this.resolveNotePath(nodeId),
            registerEvent: (eventRef) => this.registerEvent(eventRef),
            getContainerEl: () => this.containerEl,
            get duplicateManager() { return self.plugin!.getComponents().duplicateManager; },
            get mergeOrchestrator() { return self.plugin!.getComponents().mergeOrchestrator; },
            get cruidCache() { return self.plugin!.getComponents().cruidCache; },
        };
        this.duplicatesSection = new DuplicatesSection(duplicatesDeps);

        // --- RecentOpsSection 依赖 ---
        const recentOpsDeps: RecentOpsSectionDeps = {
            app: this.app,
            t: (path) => this.t(path),
            showErrorNotice: (message) => this.showErrorNotice(message),
            logError: (context, error, extra) => this.logError(context, error, extra),
            logWarn: (context, extra) => this.logWarn(context, extra),
            resolveNoteName: (nodeId) => this.resolveNoteName(nodeId),
            resolveNotePath: (nodeId) => this.resolveNotePath(nodeId),
            registerEvent: (eventRef) => this.registerEvent(eventRef),
            getContainerEl: () => this.containerEl,
            get undoManager() { return self.plugin!.getComponents().undoManager; },
        };
        this.recentOpsSection = new RecentOpsSection(recentOpsDeps);
    }

    // ─── 工具方法 ───

    /** i18n 翻译键解析 */
    private t(path: string): string {
        if (!this.plugin) return path;
        try {
            const keys = path.split('.');
            let current: unknown = this.plugin.getI18n().t();
            for (const key of keys) {
                if (current && typeof current === 'object' && key in current) {
                    current = (current as Record<string, unknown>)[key];
                } else {
                    return path;
                }
            }
            return typeof current === 'string' ? current : path;
        } catch {
            return path;
        }
    }

    /** 记录错误日志 */
    private logError(context: string, error: unknown, extra?: Record<string, unknown>): void {
        const logger = this.plugin?.getComponents().logger;
        if (logger) {
            logger.error("WorkbenchPanel", context, error instanceof Error ? error : new Error(String(error)), extra);
        }
    }

    /** 记录警告日志 */
    private logWarn(context: string, extra?: Record<string, unknown>): void {
        const logger = this.plugin?.getComponents().logger;
        if (logger) {
            logger.warn("WorkbenchPanel", context, extra);
        }
    }

    /** 显示错误通知 */
    private showErrorNotice(message: string): void {
        new Notice(message, ERROR_NOTICE_DURATION);
    }

    /** 通过 cruid 解析笔记名称 */
    private resolveNoteName(nodeId: string): string {
        const cache = this.plugin?.getComponents().cruidCache;
        return cache?.getName(nodeId) || nodeId;
    }

    /** 通过 cruid 解析笔记路径 */
    private resolveNotePath(nodeId: string): string | null {
        const cache = this.plugin?.getComponents().cruidCache;
        return cache?.getPath(nodeId) || null;
    }

    // ─── ItemView 接口 ───

    /** 设置插件引用（由 main.ts 在视图创建后调用） */
    public setPlugin(plugin: CognitiveRazorPlugin): void {
        this.plugin = plugin;
    }

    getViewType(): string {
        return WORKBENCH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Cognitive Razor 工作台";
    }

    getIcon(): string {
        return "brain";
    }

    // ─── 生命周期 ───

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("cr-workbench-panel");
        container.addClass("cr-scope");

        // 从设置中恢复 UI 状态（折叠/排序偏好），损坏或缺失时回退到默认值
        this.restoreUIState();

        // 1. 创建区（默认展开）
        this.createSection.render(container);

        // 2. 队列状态区（默认折叠）
        this.queueSection.render(container);

        // 3. 可折叠区域：重复概念 + 操作历史
        const sections = container.createDiv({ cls: "cr-expandable-sections" });

        this.renderCollapsibleSection(
            sections,
            this.t("workbench.duplicates.title"),
            "duplicates",
            (options) => this.duplicatesSection.mount(options)
        );

        this.renderCollapsibleSection(
            sections,
            this.t("workbench.recentOps.title"),
            "recentOps",
            (options) => this.recentOpsSection.mount(options)
        );

        // 4. 订阅管线事件
        this.subscribePipelineEvents();

        // 5. 订阅队列事件（实时更新）
        this.subscribeQueueEvents();

        // 6. 消费待处理输入（从命令入口传入的描述）
        await this.createSection.consumePendingInput();
    }

    async onClose(): Promise<void> {
        // 取消防抖定时器
        if (this.updateTimer !== null) {
            window.clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }

        // 清理各 Section
        this.createSection.onClose();
        this.queueSection.onClose();
        this.duplicatesSection.onClose();
        this.recentOpsSection.onClose();

        // 取消管线事件订阅
        for (const unsub of this.pipelineUnsubscribers) {
            unsub();
        }
        this.pipelineUnsubscribers = [];

        // 取消队列事件订阅
        if (this.queueUnsubscribe) {
            this.queueUnsubscribe();
            this.queueUnsubscribe = null;
        }
    }

    // ─── UI 状态持久化 ───

    /**
     * 从 PluginSettings.uiState 恢复折叠状态和排序偏好
     * 数据损坏或缺失时回退到默认布局
     * 需求: 11.2, 11.4
     */
    private restoreUIState(): void {
        try {
            const settings = this.plugin?.getComponents().settingsStore?.getSettings();
            const uiState: WorkbenchUIState | undefined = settings?.uiState;
            if (uiState && uiState.sectionCollapsed && typeof uiState.sectionCollapsed === 'object') {
                const defaults = DEFAULT_UI_STATE.sectionCollapsed;
                this.collapseState = {
                    createConcept: typeof uiState.sectionCollapsed.createConcept === 'boolean'
                        ? uiState.sectionCollapsed.createConcept : (defaults.createConcept ?? false),
                    duplicates: typeof uiState.sectionCollapsed.duplicates === 'boolean'
                        ? uiState.sectionCollapsed.duplicates : (defaults.duplicates ?? false),
                    queueStatus: typeof uiState.sectionCollapsed.queueStatus === 'boolean'
                        ? uiState.sectionCollapsed.queueStatus : (defaults.queueStatus ?? true),
                    recentOps: typeof uiState.sectionCollapsed.recentOps === 'boolean'
                        ? uiState.sectionCollapsed.recentOps : (defaults.recentOps ?? true),
                };
            }
            // 缺失或损坏时保持构造函数中的默认值
        } catch {
            // 回退到默认布局，不阻塞工作台打开
            this.logWarn("restoreUIState: 恢复 UI 状态失败，使用默认布局");
        }
    }

    /**
     * 将当前折叠状态持久化到 PluginSettings.uiState
     * 通过 SettingsStore.updateSettings() 写入 data.json
     * 需求: 11.1, 11.3
     */
    private persistUIState(): void {
        try {
            const settingsStore = this.plugin?.getComponents().settingsStore;
            if (!settingsStore) return;
            const currentSettings = settingsStore.getSettings();
            const currentUIState: WorkbenchUIState = currentSettings.uiState ?? { ...DEFAULT_UI_STATE };
            const updatedUIState: WorkbenchUIState = {
                ...currentUIState,
                sectionCollapsed: { ...this.collapseState },
            };
            // 异步写入，不阻塞 UI 交互
            settingsStore.updateSettings({ uiState: updatedUIState });
        } catch {
            // 持久化失败不影响 UI 操作
            this.logWarn("persistUIState: 持久化 UI 状态失败");
        }
    }

    // ─── 可折叠区域渲染 ───

    /**
     * 渲染可折叠区域
     * 各区域之间提供视觉分隔和标题标识
     */
    private renderCollapsibleSection(
        container: HTMLElement,
        title: string,
        sectionKey: keyof SectionCollapseState,
        renderContent: (options: { section: HTMLElement; badge: HTMLElement; content: HTMLElement }) => void
    ): void {
        const section = container.createDiv({ cls: "cr-collapsible-section" });

        const header = section.createDiv({ cls: "cr-section-header" });
        header.setAttr("role", "button");
        header.setAttr("tabindex", "0");
        const collapsed = this.collapseState[sectionKey];
        header.setAttr("aria-expanded", String(!collapsed));
        const contentId = `cr-section-${sectionKey}`;
        header.setAttr("aria-controls", contentId);

        const icon = header.createEl("span", {
            cls: "cr-collapse-icon",
            attr: { "aria-hidden": "true" }
        });
        setIcon(icon, "chevron-right");
        if (!collapsed) icon.classList.add("is-expanded");

        const titleId = `cr-section-title-${sectionKey}`;
        const titleEl = header.createEl("h3", { text: title, cls: "cr-section-title" });
        titleEl.setAttr("id", titleId);
        header.setAttr("aria-labelledby", titleId);

        const badge = header.createSpan({ cls: "cr-badge", text: "0" });
        badge.style.display = "none";

        const content = section.createDiv({ cls: "cr-section-content" });
        content.setAttr("id", contentId);
        content.setAttr("role", "region");
        content.setAttr("aria-labelledby", titleId);
        if (collapsed) content.addClass("cr-collapsed");

        // 切换折叠状态并持久化
        const toggle = (): void => {
            const nextState = !this.collapseState[sectionKey];
            this.collapseState[sectionKey] = nextState;
            if (nextState) {
                content.addClass("cr-collapsed");
                icon.classList.remove("is-expanded");
                header.setAttr("aria-expanded", "false");
            } else {
                content.removeClass("cr-collapsed");
                icon.classList.add("is-expanded");
                header.setAttr("aria-expanded", "true");
            }
            // 持久化折叠状态到 PluginSettings.uiState
            this.persistUIState();
        };

        header.onclick = () => toggle();
        header.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
            }
        });

        renderContent({ section, badge, content });
    }

    // ─── 防抖 UI 更新 ───

    /**
     * 调度防抖 UI 更新
     * 在 150ms 窗口内合并多次更新请求，仅更新有变化的 Section
     * 需求: 19.1, 19.2
     */
    private scheduleUpdate(): void {
        if (this.updateTimer !== null) return;
        this.updateTimer = window.setTimeout(() => {
            this.updateTimer = null;
            this.flushUpdate();
        }, UI_DEBOUNCE_MS);
    }

    /** 执行实际 UI 更新，仅刷新标记为脏的 Section */
    private flushUpdate(): void {
        if (this.dirtyFlags.queue) {
            this.dirtyFlags.queue = false;
            this.queueSection.update();
            this.queueSection.refreshDetailsIfVisible();
        }
        if (this.dirtyFlags.duplicates) {
            this.dirtyFlags.duplicates = false;
            this.duplicatesSection.update();
        }
        if (this.dirtyFlags.recentOps) {
            this.dirtyFlags.recentOps = false;
            this.recentOpsSection.update();
        }
        if (this.dirtyFlags.create) {
            this.dirtyFlags.create = false;
            this.createSection.update();
        }
    }

    // ─── 事件订阅 ───

    /**
     * 订阅管线事件
     * 写入完成后显示撤销入口，确认阶段弹出 Diff 预览
     */
    private subscribePipelineEvents(): void {
        if (!this.plugin) return;
        const components = this.plugin.getComponents();

        const handlePipelineEvent = (event: { type: string; context: PipelineContext }): void => {
            // 写入完成后显示撤销通知
            if (event.type === "pipeline_completed" && event.context.snapshotId && event.context.filePath) {
                const kindLabel = event.context.kind === "create" ? "创建"
                    : event.context.kind === "amend" ? "修订"
                        : event.context.kind === "merge" ? "合并"
                            : event.context.kind === "verify" ? "事实核查"
                                : "操作";
                this.showUndoToast(
                    `${kindLabel}完成: ${event.context.filePath.split("/").pop()}`,
                    event.context.snapshotId,
                    event.context.filePath
                );
            }

            // 管线失败时显示错误通知
            if (event.type === "pipeline_failed" && event.context.error) {
                this.showErrorNotice(event.context.error.message);
            }

            // merge / amend 进入待写入确认阶段时：自动弹出 Diff 预览
            if (event.type === "confirmation_required" &&
                (event.context.kind === "merge" || event.context.kind === "amend") &&
                event.context.stage === "review_changes") {
                void this.showWritePreview(event.context);
            }
        };

        // 订阅所有独立 Orchestrator 的事件
        if (components.createOrchestrator) {
            this.pipelineUnsubscribers.push(components.createOrchestrator.subscribe(handlePipelineEvent));
        }
        if (components.amendOrchestrator) {
            this.pipelineUnsubscribers.push(components.amendOrchestrator.subscribe(handlePipelineEvent));
        }
        if (components.mergeOrchestrator) {
            this.pipelineUnsubscribers.push(components.mergeOrchestrator.subscribe(handlePipelineEvent));
        }
        if (components.verifyOrchestrator) {
            this.pipelineUnsubscribers.push(components.verifyOrchestrator.subscribe(handlePipelineEvent));
        }
    }

    /**
     * 订阅队列事件（实时更新任务列表）
     * 使用防抖合并高频事件
     */
    private subscribeQueueEvents(): void {
        if (!this.plugin) return;

        const taskQueue = this.plugin.getComponents().taskQueue;

        const update = (): void => {
            this.dirtyFlags.queue = true;
            this.scheduleUpdate();
        };

        this.queueUnsubscribe = taskQueue.subscribe(update);

        // subscribe 不会立即触发，手动刷新一次保证 UI 与队列一致
        this.queueSection.update();
        this.queueSection.refreshDetailsIfVisible();
    }

    // ─── Diff 预览（管线确认阶段） ───

    /**
     * 写入前预览（Diff + 撤销提示）
     * 根据管线类型路由到对应 Orchestrator
     */
    private async showWritePreview(ctx: PipelineContext): Promise<void> {
        try {
            if (!this.plugin) return;
            const components = this.plugin.getComponents();

            const getOrchestrator = () => {
                if (ctx.kind === "merge") return components.mergeOrchestrator;
                if (ctx.kind === "amend") return components.amendOrchestrator;
                return components.createOrchestrator;
            };
            const orch = getOrchestrator();
            const preview = await orch.buildWritePreview(ctx.pipelineId);
            if (!preview.ok) {
                this.showErrorNotice(`${this.t("workbench.notifications.writePreviewFailed")}: ${preview.error.message}`);
                return;
            }

            const { previousContent, newContent, targetPath } = preview.value;
            const titlePrefix = ctx.kind === "merge"
                ? this.t("workbench.pipeline.mergePreview")
                : ctx.kind === "amend"
                    ? this.t("workbench.pipeline.amendPreview")
                    : this.t("workbench.pipeline.previewWrite");
            const cancelNotice = ctx.kind === "amend"
                ? this.t("workbench.notifications.amendCancelled")
                : ctx.kind === "merge"
                    ? this.t("workbench.notifications.mergeCancelled")
                    : this.t("workbench.notifications.writeCancelled");
            const successNotice = ctx.kind === "amend"
                ? this.t("workbench.notifications.amendCompleted")
                : ctx.kind === "merge"
                    ? this.t("workbench.notifications.mergeCompleted")
                    : this.t("workbench.notifications.writeSuccess");

            const diffView = new SimpleDiffView(
                this.app,
                `${titlePrefix}: ${targetPath}`,
                previousContent,
                newContent,
                async () => {
                    try {
                        const result = await orch.confirmWrite(ctx.pipelineId);
                        if (!result.ok) {
                            this.showErrorNotice(`${this.t("workbench.notifications.writeFailed")}: ${result.error.message}`);
                        } else {
                            new Notice(successNotice);
                        }
                    } catch (error) {
                        this.logError("确认写入失败", error, { pipelineId: ctx.pipelineId });
                        this.showErrorNotice(safeErrorMessage(error, this.t("workbench.notifications.writeFailed")));
                    }
                },
                () => {
                    new Notice(cancelNotice);
                },
                this.getDiffViewLabels()
            );

            diffView.open();
        } catch (error) {
            this.logError("显示写入预览失败", error, { pipelineId: ctx.pipelineId });
            this.showErrorNotice(safeErrorMessage(error, this.t("workbench.notifications.writePreviewFailed")));
        }
    }

    /** 获取 DiffView 按钮标签 */
    private getDiffViewLabels(): {
        accept: string; reject: string;
        acceptAria: string; rejectAria: string;
        modeLabel: string;
        unifiedView: string; unifiedViewAria: string;
        sideBySideView: string; sideBySideViewAria: string;
        leftTitle: string; rightTitle: string;
    } {
        return {
            accept: this.t("workbench.diffPreview.accept"),
            reject: this.t("workbench.diffPreview.reject"),
            acceptAria: this.t("workbench.diffPreview.acceptAria"),
            rejectAria: this.t("workbench.diffPreview.rejectAria"),
            modeLabel: this.t("workbench.diffPreview.modeLabel"),
            unifiedView: this.t("workbench.diffPreview.unifiedView"),
            unifiedViewAria: this.t("workbench.diffPreview.unifiedViewAria"),
            sideBySideView: this.t("workbench.diffPreview.sideBySideView"),
            sideBySideViewAria: this.t("workbench.diffPreview.sideBySideViewAria"),
            leftTitle: this.t("workbench.diffPreview.leftTitle"),
            rightTitle: this.t("workbench.diffPreview.rightTitle"),
        };
    }

    // ─── 公共 API（供 CommandDispatcher / main.ts 调用） ───

    /** 从命令入口快速创建概念 */
    public async startQuickCreate(description: string): Promise<void> {
        await this.createSection.startQuickCreate(description);
    }

    /** 启动修订（Amend）（针对当前激活笔记） */
    public async handleStartAmend(): Promise<void> {
        await this.createSection.handleStartAmend();
    }

    /** 启动拓展（层级/抽象） */
    public async handleStartExpand(file?: TFile): Promise<void> {
        await this.createSection.handleStartExpand(file);
    }

    /** 聚焦到"重复概念"区域 */
    public revealDuplicates(): void {
        this.duplicatesSection.reveal();
    }

    /** 打开操作历史（合并历史） */
    public openOperationHistory(): void {
        if (!this.plugin) return;
        const modal = new MergeHistoryModal(this.app, this.plugin);
        modal.open();
    }

    /** 启动图片生成流程 */
    public async startImageInsert(): Promise<void> {
        await this.createSection.startImageInsert();
    }

    /**
     * 更新重复概念列表（由 main.ts 的 duplicateManager 事件回调调用）
     */
    public updateDuplicates(duplicates: DuplicatePair[]): void {
        this.duplicatesSection.updateDuplicates(duplicates);
    }

    /**
     * 更新队列状态（由 main.ts 的 taskQueue 事件回调调用）
     * 通过防抖合并高频更新
     */
    public updateQueueStatus(_status: QueueStatus): void {
        this.dirtyFlags.queue = true;
        this.scheduleUpdate();
    }

    /**
     * 显示撤销 Toast 通知
     * 写入完成后显示 5 秒可撤销提示
     */
    public showUndoToast(
        message: string,
        snapshotId: string,
        filePath: string
    ): void {
        this.recentOpsSection.showUndoToast(message, snapshotId, filePath);
        void this.recentOpsSection.refresh();
    }
}
