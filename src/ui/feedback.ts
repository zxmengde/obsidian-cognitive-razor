/**
 * 统一反馈服务
 *
 * 需求 18.1-18.5：
 * - 统一出口，禁止业务代码散点使用 new Notice(...)
 * - 按级别分类：success(3s)、info(内联持久)、warning(5s)、error(6s)
 * - 错误消息通过 safeErrorMessage() 过滤，不暴露技术细节
 * - 同一操作链禁止连续弹出同级通知
 */

import { Notice } from "obsidian";
import { safeErrorMessage } from "../types";

// ============================================================================
// 类型定义
// ============================================================================

/** 反馈级别 */
export type FeedbackLevel = "success" | "info" | "warning" | "error";

/** 各级别的 Notice 持续时间（毫秒） */
const DURATION: Record<Exclude<FeedbackLevel, "info">, number> = {
    success: 3000,
    warning: 5000,
    error: 6000,
};

/** 去重记录 */
interface DedupeRecord {
    level: FeedbackLevel;
    message: string;
    timestamp: number;
}

// ============================================================================
// 去重逻辑
// ============================================================================

/** 去重窗口（毫秒）：同级同消息在此窗口内不重复弹出 */
const DEDUPE_WINDOW_MS = 2000;

/** 最近一条通知记录（用于去重） */
let lastNotice: DedupeRecord | null = null;

/**
 * 检查是否应该抑制本次通知（去重）
 * 同一操作链中，同级别 + 同消息在 DEDUPE_WINDOW_MS 内不重复弹出
 */
function shouldSuppress(level: FeedbackLevel, message: string): boolean {
    if (!lastNotice) return false;
    const now = Date.now();
    if (
        lastNotice.level === level &&
        lastNotice.message === message &&
        now - lastNotice.timestamp < DEDUPE_WINDOW_MS
    ) {
        return true;
    }
    return false;
}

/** 记录本次通知（用于后续去重判断） */
function recordNotice(level: FeedbackLevel, message: string): void {
    lastNotice = { level, message, timestamp: Date.now() };
}

/** 重置去重状态（测试用） */
export function resetDedupeState(): void {
    lastNotice = null;
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 显示成功通知（Notice 3s）
 */
export function showSuccess(message: string): void {
    if (shouldSuppress("success", message)) return;
    recordNotice("success", message);
    new Notice(message, DURATION.success);
}

/**
 * 显示警告通知（Notice 5s）
 */
export function showWarning(message: string): void {
    if (shouldSuppress("warning", message)) return;
    recordNotice("warning", message);
    new Notice(message, DURATION.warning);
}

/**
 * 显示错误通知（Notice 6s）
 * 自动通过 safeErrorMessage() 过滤，不暴露技术细节
 *
 * @param error - 原始错误对象或字符串
 * @param fallback - 当无法提取安全消息时的回退文案
 */
export function showError(error: unknown, fallback?: string): void {
    const message = typeof error === "string"
        ? error
        : safeErrorMessage(error, fallback);
    if (shouldSuppress("error", message)) return;
    recordNotice("error", message);
    new Notice(message, DURATION.error);
}


