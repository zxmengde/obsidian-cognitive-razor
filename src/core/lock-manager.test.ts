/**
 * SimpleLockManager 单元测试
 */
import { describe, expect, it, beforeEach } from "vitest";
import { SimpleLockManager } from "./lock-manager";

describe("SimpleLockManager", () => {
    let lockManager: SimpleLockManager;

    beforeEach(() => {
        lockManager = new SimpleLockManager();
    });

    it("tryAcquire 首次获取成功", () => {
        expect(lockManager.tryAcquire("key-1")).toBe(true);
    });

    it("tryAcquire 重复获取失败", () => {
        lockManager.tryAcquire("key-1");
        expect(lockManager.tryAcquire("key-1")).toBe(false);
    });

    it("release 后可重新获取", () => {
        lockManager.tryAcquire("key-1");
        lockManager.release("key-1");
        expect(lockManager.tryAcquire("key-1")).toBe(true);
    });

    it("isLocked 正确反映锁状态", () => {
        expect(lockManager.isLocked("key-1")).toBe(false);
        lockManager.tryAcquire("key-1");
        expect(lockManager.isLocked("key-1")).toBe(true);
        lockManager.release("key-1");
        expect(lockManager.isLocked("key-1")).toBe(false);
    });

    it("clear 清空所有锁", () => {
        lockManager.tryAcquire("key-1");
        lockManager.tryAcquire("key-2");
        lockManager.clear();
        expect(lockManager.isLocked("key-1")).toBe(false);
        expect(lockManager.isLocked("key-2")).toBe(false);
    });

    it("不同键互不影响", () => {
        lockManager.tryAcquire("key-1");
        expect(lockManager.tryAcquire("key-2")).toBe(true);
        expect(lockManager.isLocked("key-1")).toBe(true);
        expect(lockManager.isLocked("key-2")).toBe(true);
    });

    it("release 不存在的键不报错", () => {
        expect(() => lockManager.release("nonexistent")).not.toThrow();
    });
});
