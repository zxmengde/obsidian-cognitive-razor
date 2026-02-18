/**
 * ModalManager 单元测试
 *
 * 验证：
 * - 同类型 Modal 防堆叠
 * - 不同类型 Modal 可共存
 * - close / closeAll / dispose 正确清理
 * - isOpen 状态查询
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ModalManager } from "./modal-manager";
import type { ModalType } from "./modal-manager";
import type { ILogger } from "../types";

// ============================================================================
// Mock 依赖
// ============================================================================

/** 模拟 mountSvelteComponent，返回可追踪的 destroy */
vi.mock("./bridge/mount", () => ({
    mountSvelteComponent: vi.fn((_target: HTMLElement, _component: unknown, _props: unknown) => {
        const destroyFn = vi.fn();
        return { destroy: destroyFn };
    }),
}));

function createMockLogger(): ILogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
        getLevel: vi.fn().mockReturnValue("debug"),
        getLogs: vi.fn().mockReturnValue([]),
        clearLogs: vi.fn(),
    };
}

/** 假 Svelte 组件（仅需满足 Component 类型签名） */
const FakeComponent = (() => {}) as unknown as import("svelte").Component;

// ============================================================================
// 测试
// ============================================================================

describe("ModalManager", () => {
    let manager: ModalManager;
    let logger: ILogger;

    beforeEach(() => {
        logger = createMockLogger();
        manager = new ModalManager({ logger });
    });

    afterEach(() => {
        manager.dispose();
        // 清理可能残留的 DOM 容器
        document.querySelectorAll(".cr-modal-container").forEach((el) => el.remove());
    });

    it("show() 成功打开 Modal 并返回 true", () => {
        const result = manager.show("confirm", FakeComponent, { title: "test" });
        expect(result).toBe(true);
        expect(manager.isOpen("confirm")).toBe(true);
    });

    it("同类型 Modal 防堆叠：第二次 show() 返回 false", () => {
        manager.show("confirm", FakeComponent, { title: "first" });
        const result = manager.show("confirm", FakeComponent, { title: "second" });
        expect(result).toBe(false);
        // DOM 中只有一个容器
        const containers = document.querySelectorAll(".cr-modal-container--confirm");
        expect(containers.length).toBe(1);
    });

    it("不同类型 Modal 可共存", () => {
        manager.show("confirm", FakeComponent, { title: "confirm" });
        manager.show("provider", FakeComponent, { mode: "add" });
        expect(manager.isOpen("confirm")).toBe(true);
        expect(manager.isOpen("provider")).toBe(true);
    });

    it("close() 关闭指定类型并移除 DOM 容器", () => {
        manager.show("confirm", FakeComponent, { title: "test" });
        expect(document.querySelectorAll(".cr-modal-container--confirm").length).toBe(1);

        manager.close("confirm");
        expect(manager.isOpen("confirm")).toBe(false);
        expect(document.querySelectorAll(".cr-modal-container--confirm").length).toBe(0);
    });

    it("close() 对未打开的类型无副作用", () => {
        // 不应抛异常
        manager.close("provider");
        expect(manager.isOpen("provider")).toBe(false);
    });

    it("closeAll() 关闭所有打开的 Modal", () => {
        manager.show("confirm", FakeComponent, { title: "a" });
        manager.show("provider", FakeComponent, { mode: "add" });

        manager.closeAll();
        expect(manager.isOpen("confirm")).toBe(false);
        expect(manager.isOpen("provider")).toBe(false);
        expect(document.querySelectorAll(".cr-modal-container").length).toBe(0);
    });

    it("关闭后可重新打开同类型 Modal", () => {
        manager.show("confirm", FakeComponent, { title: "first" });
        manager.close("confirm");

        const result = manager.show("confirm", FakeComponent, { title: "second" });
        expect(result).toBe(true);
        expect(manager.isOpen("confirm")).toBe(true);
    });

    it("dispose() 等同于 closeAll()", () => {
        manager.show("confirm", FakeComponent, { title: "a" });
        manager.show("provider", FakeComponent, { mode: "add" });

        manager.dispose();
        expect(manager.isOpen("confirm")).toBe(false);
        expect(manager.isOpen("provider")).toBe(false);
    });

    it("show() 创建的 DOM 容器带有正确的 CSS 类", () => {
        manager.show("confirm", FakeComponent, {});
        const container = document.querySelector(".cr-modal-container--confirm");
        expect(container).not.toBeNull();
        expect(container?.classList.contains("cr-modal-container")).toBe(true);
    });
});
