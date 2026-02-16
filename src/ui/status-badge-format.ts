/**
 * StatusBadge 格式化函数
 *
 * 5 种状态映射（Requirements 13.1, 13.2, 13.3）:
 * - idle: 无任务 → check-circle 图标，绿色
 * - active: 有任务执行中 → loader 图标，蓝色
 * - paused: 队列暂停 → pause-circle 图标，黄色
 * - error: 有失败任务 → alert-triangle 图标，红色
 * - offline: Provider 未配置 → wifi-off 图标，灰色
 */

import type { QueueStatus } from "../types";

/** 状态类型 */
export type BadgeState = "idle" | "active" | "paused" | "error" | "offline";

export interface StatusBadgeFormatResult {
    /** 简短状态文本 */
    text: string;
    /** Obsidian 图标名称 */
    icon: string;
    /** CSS 状态类名 */
    cssClass: string;
    /** 当前状态类型 */
    state: BadgeState;
}

/**
 * 根据队列状态计算 BadgeState
 */
export function computeBadgeState(status: QueueStatus, isOffline: boolean): BadgeState {
    if (isOffline) return "offline";

    const { running, pending, failed, paused } = status;
    const activeCount = running + pending;

    if (failed > 0) return "error";
    if (paused && activeCount > 0) return "paused";
    if (activeCount > 0) return "active";
    return "idle";
}

/** 图标映射 */
const ICON_MAP: Record<BadgeState, string> = {
    idle: "check-circle",
    active: "loader-2",
    paused: "pause-circle",
    error: "alert-triangle",
    offline: "wifi-off",
};

/** CSS 类名映射 */
const CSS_CLASS_MAP: Record<BadgeState, string> = {
    idle: "cr-status-idle",
    active: "cr-status-active",
    paused: "cr-status-paused",
    error: "cr-status-failed",
    offline: "cr-status-offline",
};

/**
 * 格式化状态徽章显示信息
 *
 * @param status 队列状态
 * @param isOffline 是否离线
 * @param getText 文本获取函数（由调用方注入 i18n）
 */
export function formatStatusBadgeText(
    status: QueueStatus,
    isOffline: boolean = false,
    getText?: (state: BadgeState, count: number) => string,
): StatusBadgeFormatResult {
    const state = computeBadgeState(status, isOffline);
    const { running, pending, failed } = status;
    const activeCount = running + pending;

    // 计算显示数量
    let count = 0;
    if (state === "active" || state === "paused") count = activeCount;
    if (state === "error") count = failed;

    // 生成文本
    let text: string;
    if (getText) {
        text = getText(state, count);
    } else {
        // 回退：无 i18n 时使用简单文本
        text = formatFallbackText(state, count);
    }

    return {
        text,
        icon: ICON_MAP[state],
        cssClass: CSS_CLASS_MAP[state],
        state,
    };
}

/**
 * 回退文本（无 i18n 时使用）
 */
function formatFallbackText(state: BadgeState, count: number): string {
    switch (state) {
        case "idle": return "CR";
        case "active": return `${count}`;
        case "paused": return `⏸ ${count}`;
        case "error": return `${count}!`;
        case "offline": return "CR";
    }
}
