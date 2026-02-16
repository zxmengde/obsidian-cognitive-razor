/**
 * StatusBadge - 状态栏徽章组件
 *
 * 功能（Requirements 13.1, 13.2, 13.3, 13.4, 19.2）：
 * - 图标 + 简短文本显示 5 种状态（idle/active/paused/error/offline）
 * - 队列有任务时显示数量，有失败任务时使用醒目错误样式
 * - 点击打开 Workbench 并定位到相关区域
 * - 防抖更新（300ms 窗口）
 */

import { Plugin, setIcon } from "obsidian";
import type { QueueStatus } from "../types";
import { formatStatusBadgeText, type BadgeState } from "./status-badge-format";
import { COMMAND_IDS } from "./command-utils";
import { formatMessage } from "../core/i18n";
import type { I18n } from "../core/i18n";

/** StatusBadge 依赖 */
interface StatusBadgeDeps {
    plugin: Plugin;
    i18n: I18n;
}

/** 所有状态 CSS 类名 */
const ALL_STATUS_CLASSES = [
    "cr-status-idle",
    "cr-status-active",
    "cr-status-paused",
    "cr-status-failed",
    "cr-status-offline",
] as const;

/** 防抖窗口（毫秒） */
const DEBOUNCE_MS = 300;

/**
 * StatusBadge 组件
 */
export class StatusBadge {
    private plugin: Plugin;
    private i18n: I18n;
    private statusBarItem: HTMLElement;
    private queueStatus: QueueStatus = {
        paused: false,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
    };
    private isOffline: boolean = false;
    private updateTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(deps: StatusBadgeDeps) {
        this.plugin = deps.plugin;
        this.i18n = deps.i18n;
        this.statusBarItem = deps.plugin.addStatusBarItem();
        this.statusBarItem.addClass("cr-status-badge", "cr-scope");
        this.setupClickHandler();
        this.render();
    }

    // ========================================================================
    // 渲染
    // ========================================================================

    /**
     * 渲染状态徽章
     */
    private render(): void {
        this.statusBarItem.empty();

        const display = formatStatusBadgeText(
            this.queueStatus,
            this.isOffline,
            (state, count) => this.getStatusText(state, count),
        );

        // 图标
        const iconSpan = this.statusBarItem.createSpan({ cls: "cr-status-icon" });
        setIcon(iconSpan, display.icon);

        // 文本
        const textSpan = this.statusBarItem.createSpan({ cls: "cr-status-text" });
        textSpan.textContent = display.text;

        // 状态样式类
        for (const cls of ALL_STATUS_CLASSES) {
            this.statusBarItem.removeClass(cls);
        }
        this.statusBarItem.addClass(display.cssClass);

        // 无障碍
        this.statusBarItem.setAttribute("aria-label", this.getAriaLabel(display.state));
        this.statusBarItem.setAttribute("data-tooltip-position", "top");
    }

    /**
     * 通过 i18n 获取状态文本
     */
    private getStatusText(state: BadgeState, count: number): string {
        const t = this.i18n.t();
        const badge = (t as Record<string, unknown>)["statusBadge"] as Record<string, string> | undefined;
        if (!badge) return this.getFallbackText(state, count);

        const template = badge[state];
        if (!template) return this.getFallbackText(state, count);

        return formatMessage(template, { count });
    }

    /**
     * 获取无障碍标签
     */
    private getAriaLabel(state: BadgeState): string {
        const t = this.i18n.t();
        const badge = (t as Record<string, unknown>)["statusBadge"] as Record<string, string> | undefined;
        if (!badge) return `Cognitive Razor - ${state}`;

        const ariaKey = `aria${state.charAt(0).toUpperCase()}${state.slice(1)}` as string;
        const template = badge[ariaKey];
        if (!template) return `Cognitive Razor - ${state}`;

        const { running, pending, failed } = this.queueStatus;
        const activeCount = running + pending;
        const count = state === "error" ? failed : activeCount;

        return formatMessage(template, { count });
    }

    /**
     * 回退文本（i18n 不可用时）
     */
    private getFallbackText(state: BadgeState, count: number): string {
        switch (state) {
            case "idle": return "CR";
            case "active": return `${count}`;
            case "paused": return `⏸ ${count}`;
            case "error": return `${count}!`;
            case "offline": return "CR";
        }
    }

    // ========================================================================
    // 点击处理
    // ========================================================================

    /**
     * 设置点击处理器 — 点击直接打开 Workbench（Requirements 13.4）
     */
    private setupClickHandler(): void {
        this.statusBarItem.addEventListener("click", () => {
            this.openWorkbench();
        });

        // 键盘无障碍
        this.statusBarItem.setAttribute("tabindex", "0");
        this.statusBarItem.setAttribute("role", "button");

        this.statusBarItem.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.openWorkbench();
            }
        });
    }

    /**
     * 打开工作台
     */
    private openWorkbench(): void {
        this.executeCommand(COMMAND_IDS.OPEN_WORKBENCH);
    }

    /**
     * 执行命令
     */
    private executeCommand(commandId: string): void {
        const appWithCommands = this.plugin.app as unknown as {
            commands: { executeCommandById: (id: string) => boolean };
        };
        appWithCommands.commands.executeCommandById(commandId);
    }

    // ========================================================================
    // 公共 API
    // ========================================================================

    /**
     * 更新队列状态（防抖 300ms，Requirements 19.2）
     */
    public updateStatus(status: QueueStatus): void {
        this.queueStatus = status;
        this.scheduleRender();
    }

    /**
     * 设置离线状态
     */
    public setOffline(offline: boolean): void {
        this.isOffline = offline;
        this.scheduleRender();
    }

    /**
     * 获取当前状态文本（用于测试）
     */
    public getStatusText_forTest(): string {
        return formatStatusBadgeText(
            this.queueStatus,
            this.isOffline,
            (state, count) => this.getStatusText(state, count),
        ).text;
    }

    // ========================================================================
    // 防抖
    // ========================================================================

    /**
     * 调度防抖渲染（300ms 窗口）
     */
    private scheduleRender(): void {
        if (this.updateTimer !== null) return;
        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            this.render();
        }, DEBOUNCE_MS);
    }

    // ========================================================================
    // 生命周期
    // ========================================================================

    /**
     * 清理资源
     */
    public destroy(): void {
        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        this.statusBarItem.remove();
    }
}
