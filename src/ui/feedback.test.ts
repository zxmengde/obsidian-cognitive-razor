/**
 * 统一反馈服务测试
 *
 * 验证：
 * - 各级别通知的正确创建
 * - UI 错误映射过滤
 * - 同级去重逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    showSuccess,
    showWarning,
    showError,
} from "./feedback";

// ============================================================================
// Mock Obsidian 模块
// ============================================================================

interface MockNoticeInstance {
    message: string;
    duration: number;
    noticeEl: HTMLDivElement;
    hide: ReturnType<typeof vi.fn>;
}

const mockNoticeInstances: MockNoticeInstance[] = [];

vi.mock("obsidian", () => {
    class MockNotice {
        message: string;
        duration: number;
        noticeEl: HTMLDivElement;
        hide: ReturnType<typeof vi.fn>;

        constructor(message: string, duration: number) {
            this.message = message;
            this.duration = duration;
            const el = document.createElement("div");
            // Obsidian 对 HTMLElement 的扩展方法
            (el as any).empty = function() { this.innerHTML = ""; };
            (el as any).addClass = function(...cls: string[]) { this.classList.add(...cls); };
            (el as any).createDiv = function(opts?: { cls?: string; text?: string }) {
                const div = document.createElement("div");
                if (opts?.cls) div.className = opts.cls;
                if (opts?.text) div.textContent = opts.text;
                this.appendChild(div);
                // 递归添加 createDiv/createEl/setAttr
                (div as any).createDiv = (el as any).createDiv;
                (div as any).createEl = (el as any).createEl;
                (div as any).setAttr = function(k: string, v: string) { this.setAttribute(k, v); };
                return div;
            };
            (el as any).createEl = function(tag: string, opts?: { text?: string; cls?: string; attr?: Record<string, string> }) {
                const child = document.createElement(tag);
                if (opts?.text) child.textContent = opts.text;
                if (opts?.cls) child.className = opts.cls;
                if (opts?.attr) {
                    for (const [k, v] of Object.entries(opts.attr)) {
                        child.setAttribute(k, v);
                    }
                }
                this.appendChild(child);
                return child;
            };
            this.noticeEl = el as HTMLDivElement;
            this.hide = vi.fn();
            mockNoticeInstances.push(this as unknown as MockNoticeInstance);
        }
    }

    return {
        Notice: MockNotice,
        setIcon: vi.fn(),
    };
});

// ============================================================================
// 测试
// ============================================================================

describe("feedback 统一反馈服务", () => {
    let testTime = Date.UTC(2026, 7, 16);

    beforeEach(() => {
        mockNoticeInstances.length = 0;
        vi.useFakeTimers();
        testTime += 3000;
        vi.setSystemTime(testTime);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("showSuccess", () => {
        it("应创建 3s 持续时间的 Notice", () => {
            showSuccess("操作成功");
            expect(mockNoticeInstances).toHaveLength(1);
            expect(mockNoticeInstances[0].message).toBe("操作成功");
            expect(mockNoticeInstances[0].duration).toBe(3000);
        });
    });

    describe("showWarning", () => {
        it("应创建 5s 持续时间的 Notice", () => {
            showWarning("请注意");
            expect(mockNoticeInstances).toHaveLength(1);
            expect(mockNoticeInstances[0].message).toBe("请注意");
            expect(mockNoticeInstances[0].duration).toBe(5000);
        });
    });

    describe("showError", () => {
        it("字符串错误直接显示，持续 6s", () => {
            showError("自定义错误消息", "操作失败");
            expect(mockNoticeInstances).toHaveLength(1);
            expect(mockNoticeInstances[0].message).toBe("自定义错误消息");
            expect(mockNoticeInstances[0].duration).toBe(6000);
        });

        it("Error 对象通过 safeErrorMessage 过滤，返回 fallback", () => {
            showError(new Error("internal stack trace"), "操作失败");
            expect(mockNoticeInstances).toHaveLength(1);
            expect(mockNoticeInstances[0].message).toBe("操作失败");
        });

        it("CognitiveRazorError 风格对象显示安全错误描述", () => {
            showError({ code: "E201_PROVIDER_TIMEOUT", message: "超时" }, "操作失败");
            expect(mockNoticeInstances).toHaveLength(1);
            expect(mockNoticeInstances[0].message).toBe("Provider 请求超时，结果未知");
        });
    });

    describe("去重逻辑", () => {
        it("同级同消息在 2s 内不重复弹出", () => {
            showSuccess("操作成功");
            showSuccess("操作成功");
            expect(mockNoticeInstances).toHaveLength(1);
        });

        it("不同消息不去重", () => {
            showSuccess("操作 A 成功");
            showSuccess("操作 B 成功");
            expect(mockNoticeInstances).toHaveLength(2);
        });

        it("不同级别不去重", () => {
            showSuccess("消息");
            showWarning("消息");
            expect(mockNoticeInstances).toHaveLength(2);
        });

        it("超过去重窗口后允许重复", () => {
            showSuccess("操作成功");
            vi.advanceTimersByTime(2100);
            showSuccess("操作成功");
            expect(mockNoticeInstances).toHaveLength(2);
        });
    });

});
