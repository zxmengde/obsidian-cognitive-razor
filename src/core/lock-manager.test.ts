/**
 * LockManager 单元测试
 */

import { LockManager } from "./lock-manager";

describe("LockManager", () => {
  let lockManager: LockManager;

  beforeEach(() => {
    lockManager = new LockManager();
  });

  describe("节点锁", () => {
    test("应该成功获取节点锁", () => {
      const result = lockManager.acquireNodeLock("node-1", "task-1");
      expect(result.ok).toBe(true);
      expect(lockManager.isNodeLocked("node-1")).toBe(true);
    });

    test("应该拒绝重复获取同一节点锁", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      const result = lockManager.acquireNodeLock("node-1", "task-2");
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOCK_CONFLICT");
      }
    });

    test("应该成功释放节点锁", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      const result = lockManager.releaseNodeLock("node-1", "task-1");
      
      expect(result.ok).toBe(true);
      expect(lockManager.isNodeLocked("node-1")).toBe(false);
    });

    test("应该拒绝非持有者释放节点锁", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      const result = lockManager.releaseNodeLock("node-1", "task-2");
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOCK_NOT_OWNER");
      }
    });

    test("应该拒绝释放不存在的节点锁", () => {
      const result = lockManager.releaseNodeLock("node-1", "task-1");
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOCK_NOT_FOUND");
      }
    });
  });

  describe("类型锁", () => {
    test("应该成功获取类型锁", () => {
      const result = lockManager.acquireTypeLock("Domain", "task-1");
      expect(result.ok).toBe(true);
      expect(lockManager.isTypeLocked("Domain")).toBe(true);
    });

    test("应该拒绝重复获取同一类型锁", () => {
      lockManager.acquireTypeLock("Domain", "task-1");
      const result = lockManager.acquireTypeLock("Domain", "task-2");
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOCK_CONFLICT");
      }
    });

    test("应该成功释放类型锁", () => {
      lockManager.acquireTypeLock("Domain", "task-1");
      const result = lockManager.releaseTypeLock("Domain", "task-1");
      
      expect(result.ok).toBe(true);
      expect(lockManager.isTypeLocked("Domain")).toBe(false);
    });
  });

  describe("任务锁管理", () => {
    test("应该释放任务持有的所有锁", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      lockManager.acquireNodeLock("node-2", "task-1");
      lockManager.acquireTypeLock("Domain", "task-1");
      
      const result = lockManager.releaseAllLocksForTask("task-1");
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(3);
      }
      expect(lockManager.isNodeLocked("node-1")).toBe(false);
      expect(lockManager.isNodeLocked("node-2")).toBe(false);
      expect(lockManager.isTypeLocked("Domain")).toBe(false);
    });

    test("应该正确获取任务持有的锁列表", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      lockManager.acquireNodeLock("node-2", "task-1");
      lockManager.acquireNodeLock("node-3", "task-2");
      
      const locks = lockManager.getLocksForTask("task-1");
      
      expect(locks.length).toBe(2);
      expect(locks.every((lock) => lock.taskId === "task-1")).toBe(true);
    });
  });

  describe("锁查询", () => {
    test("应该正确获取节点锁信息", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      const lock = lockManager.getNodeLock("node-1");
      
      expect(lock).toBeDefined();
      expect(lock?.taskId).toBe("task-1");
      expect(lock?.type).toBe("node");
    });

    test("应该正确获取类型锁信息", () => {
      lockManager.acquireTypeLock("Domain", "task-1");
      const lock = lockManager.getTypeLock("Domain");
      
      expect(lock).toBeDefined();
      expect(lock?.taskId).toBe("task-1");
      expect(lock?.type).toBe("type");
    });

    test("应该正确获取所有锁", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      lockManager.acquireTypeLock("Domain", "task-2");
      
      const allLocks = lockManager.getAllLocks();
      
      expect(allLocks.length).toBe(2);
    });

    test("应该正确获取锁数量", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      lockManager.acquireNodeLock("node-2", "task-2");
      
      expect(lockManager.getLockCount()).toBe(2);
    });
  });

  describe("锁清理", () => {
    test("应该清除所有锁", () => {
      lockManager.acquireNodeLock("node-1", "task-1");
      lockManager.acquireTypeLock("Domain", "task-2");
      
      lockManager.clearAllLocks();
      
      expect(lockManager.getLockCount()).toBe(0);
      expect(lockManager.isNodeLocked("node-1")).toBe(false);
      expect(lockManager.isTypeLocked("Domain")).toBe(false);
    });
  });
});
