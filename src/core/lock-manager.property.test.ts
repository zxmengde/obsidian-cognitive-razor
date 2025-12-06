/**
 * LockManager 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { LockManager } from "./lock-manager";

describe("LockManager 属性测试", () => {
  /**
   * **Feature: cognitive-razor, Property 13: 节点锁互斥**
   * **验证需求：6.2**
   * 
   * 属性：对于任意 nodeId，在任意时刻最多只能有一个非完成状态的任务持有该节点的锁
   */
  test("属性 13: 节点锁互斥", () => {
    fc.assert(
      fc.property(
        // 生成随机的节点 ID
        fc.string({ minLength: 1, maxLength: 50 }),
        // 生成随机的任务 ID 列表（至少 2 个任务）
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
          minLength: 2,
          maxLength: 10,
        }),
        (nodeId, taskIds) => {
          const lockManager = new LockManager();

          // 第一个任务应该能成功获取锁
          const firstResult = lockManager.acquireNodeLock(nodeId, taskIds[0]);
          expect(firstResult.ok).toBe(true);

          // 验证节点已被锁定
          expect(lockManager.isNodeLocked(nodeId)).toBe(true);

          // 所有其他任务都应该无法获取同一节点的锁
          for (let i = 1; i < taskIds.length; i++) {
            const result = lockManager.acquireNodeLock(nodeId, taskIds[i]);
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("LOCK_CONFLICT");
            }
          }

          // 验证只有第一个任务持有锁
          const nodeLock = lockManager.getNodeLock(nodeId);
          expect(nodeLock).toBeDefined();
          expect(nodeLock?.taskId).toBe(taskIds[0]);

          // 验证锁数量为 1
          expect(lockManager.getLockCount()).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：释放锁后，其他任务应该能够获取该锁
   */
  test("属性：锁释放后可重新获取", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (nodeId, taskId1, taskId2) => {
          // 确保两个任务 ID 不同
          fc.pre(taskId1 !== taskId2);

          const lockManager = new LockManager();

          // 任务 1 获取锁
          const acquire1 = lockManager.acquireNodeLock(nodeId, taskId1);
          expect(acquire1.ok).toBe(true);

          // 任务 2 无法获取锁
          const acquire2 = lockManager.acquireNodeLock(nodeId, taskId2);
          expect(acquire2.ok).toBe(false);

          // 任务 1 释放锁
          const release1 = lockManager.releaseNodeLock(nodeId, taskId1);
          expect(release1.ok).toBe(true);

          // 任务 2 现在应该能获取锁
          const acquire2Again = lockManager.acquireNodeLock(nodeId, taskId2);
          expect(acquire2Again.ok).toBe(true);

          // 验证任务 2 持有锁
          const nodeLock = lockManager.getNodeLock(nodeId);
          expect(nodeLock?.taskId).toBe(taskId2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：不同节点的锁互不影响
   */
  test("属性：不同节点的锁互不影响", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
          minLength: 2,
          maxLength: 10,
        }),
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
          minLength: 2,
          maxLength: 10,
        }),
        (nodeIds, taskIds) => {
          // 确保节点 ID 唯一
          const uniqueNodeIds = Array.from(new Set(nodeIds));
          fc.pre(uniqueNodeIds.length >= 2);

          const lockManager = new LockManager();

          // 每个节点都应该能被不同的任务锁定
          for (let i = 0; i < Math.min(uniqueNodeIds.length, taskIds.length); i++) {
            const result = lockManager.acquireNodeLock(
              uniqueNodeIds[i],
              taskIds[i]
            );
            expect(result.ok).toBe(true);
          }

          // 验证所有节点都被锁定
          for (let i = 0; i < Math.min(uniqueNodeIds.length, taskIds.length); i++) {
            expect(lockManager.isNodeLocked(uniqueNodeIds[i])).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：releaseAllLocksForTask 应该释放任务的所有锁
   */
  test("属性：releaseAllLocksForTask 释放所有锁", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (taskId, nodeIds) => {
          // 确保节点 ID 唯一
          const uniqueNodeIds = Array.from(new Set(nodeIds));

          const lockManager = new LockManager();

          // 任务获取多个节点的锁
          for (const nodeId of uniqueNodeIds) {
            const result = lockManager.acquireNodeLock(nodeId, taskId);
            expect(result.ok).toBe(true);
          }

          // 验证所有节点都被锁定
          for (const nodeId of uniqueNodeIds) {
            expect(lockManager.isNodeLocked(nodeId)).toBe(true);
          }

          // 释放任务的所有锁
          const releaseResult = lockManager.releaseAllLocksForTask(taskId);
          expect(releaseResult.ok).toBe(true);
          if (releaseResult.ok) {
            expect(releaseResult.value).toBe(uniqueNodeIds.length);
          }

          // 验证所有节点都已解锁
          for (const nodeId of uniqueNodeIds) {
            expect(lockManager.isNodeLocked(nodeId)).toBe(false);
          }

          // 验证锁数量为 0
          expect(lockManager.getLockCount()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：只有锁的持有者才能释放锁
   */
  test("属性：只有持有者才能释放锁", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (nodeId, ownerId, otherId) => {
          // 确保两个任务 ID 不同
          fc.pre(ownerId !== otherId);

          const lockManager = new LockManager();

          // 持有者获取锁
          const acquireResult = lockManager.acquireNodeLock(nodeId, ownerId);
          expect(acquireResult.ok).toBe(true);

          // 非持有者尝试释放锁应该失败
          const releaseResult = lockManager.releaseNodeLock(nodeId, otherId);
          expect(releaseResult.ok).toBe(false);
          if (!releaseResult.ok) {
            expect(releaseResult.error.code).toBe("LOCK_NOT_OWNER");
          }

          // 验证锁仍然存在
          expect(lockManager.isNodeLocked(nodeId)).toBe(true);
          const lock = lockManager.getNodeLock(nodeId);
          expect(lock?.taskId).toBe(ownerId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
