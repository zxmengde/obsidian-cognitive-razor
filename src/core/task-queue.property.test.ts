/**
 * TaskQueue 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { TaskQueue, CreateTaskParams } from "./task-queue";
import { LockManager } from "./lock-manager";
import { FileStorage } from "../data/file-storage";
import { arbTaskType } from "../test-utils";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * 创建临时测试目录
 */
function createTempDir(): string {
  const tempDir = path.join(
    os.tmpdir(),
    `cr-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * 清理临时目录
 */
function cleanupTempDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

describe("TaskQueue 属性测试", () => {
  /**
   * **Feature: cognitive-razor, Property 14: 任务取消释放锁**
   * **验证需求：6.5**
   * 
   * 属性：对于任意被取消的任务，系统必须释放该任务持有的所有锁，且任务状态必须更新为 Cancelled
   */
  test("属性 14: 任务取消释放锁", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成随机的节点 ID
        fc.string({ minLength: 1, maxLength: 50 }),
        // 生成随机的任务类型
        arbTaskType(),
        async (nodeId, taskType) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建任务
          const params: CreateTaskParams = {
            nodeId,
            taskType,
          };

          const enqueueResult = await taskQueue.enqueue(params);
          expect(enqueueResult.ok).toBe(true);

          if (enqueueResult.ok) {
            const taskId = enqueueResult.value;

            // 模拟任务获取锁
            const lockResult = lockManager.acquireNodeLock(nodeId, taskId);
            expect(lockResult.ok).toBe(true);

            // 验证节点已被锁定
            expect(lockManager.isNodeLocked(nodeId)).toBe(true);

            // 取消任务
            const cancelResult = await taskQueue.cancel(taskId);
            expect(cancelResult.ok).toBe(true);

            // 验证任务状态为 Cancelled
            const task = taskQueue.getTask(taskId);
            expect(task?.state).toBe("Cancelled");

            // 验证锁已被释放
            expect(lockManager.isNodeLocked(nodeId)).toBe(false);

            // 验证任务不再持有任何锁
            const taskLocks = lockManager.getLocksForTask(taskId);
            expect(taskLocks.length).toBe(0);
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：取消任务后，其他任务应该能够获取该节点的锁
   */
  test("属性：取消任务后锁可被其他任务获取", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        arbTaskType(),
        async (nodeId, taskType1, taskType2) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建第一个任务
          const result1 = await taskQueue.enqueue({
            nodeId,
            taskType: taskType1,
          });

          expect(result1.ok).toBe(true);

          if (result1.ok) {
            const taskId1 = result1.value;

            // 第一个任务获取锁
            lockManager.acquireNodeLock(nodeId, taskId1);

            // 第二个任务应该无法入队（节点已锁定）
            const result2 = await taskQueue.enqueue({
              nodeId,
              taskType: taskType2,
            });
            expect(result2.ok).toBe(false);

            // 取消第一个任务
            await taskQueue.cancel(taskId1);

            // 现在第二个任务应该能够入队
            const result3 = await taskQueue.enqueue({
              nodeId,
              taskType: taskType2,
            });
            expect(result3.ok).toBe(true);

            if (result3.ok) {
              // 第二个任务应该能够获取锁
              const lockResult = lockManager.acquireNodeLock(nodeId, result3.value);
              expect(lockResult.ok).toBe(true);
            }
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：取消多个锁的任务应该释放所有锁
   */
  test("属性：取消任务释放所有持有的锁", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
          minLength: 2,
          maxLength: 5,
        }),
        arbTaskType(),
        async (nodeIds, taskType) => {
          // 确保节点 ID 唯一
          const uniqueNodeIds = Array.from(new Set(nodeIds));
          fc.pre(uniqueNodeIds.length >= 2);

          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建任务（只使用第一个节点入队）
          const result = await taskQueue.enqueue({
            nodeId: uniqueNodeIds[0],
            taskType,
          });

          expect(result.ok).toBe(true);

          if (result.ok) {
            const taskId = result.value;

            // 任务获取多个节点的锁
            for (const nodeId of uniqueNodeIds) {
              const lockResult = lockManager.acquireNodeLock(nodeId, taskId);
              expect(lockResult.ok).toBe(true);
            }

            // 验证所有节点都被锁定
            for (const nodeId of uniqueNodeIds) {
              expect(lockManager.isNodeLocked(nodeId)).toBe(true);
            }

            // 取消任务
            await taskQueue.cancel(taskId);

            // 验证所有锁都被释放
            for (const nodeId of uniqueNodeIds) {
              expect(lockManager.isNodeLocked(nodeId)).toBe(false);
            }

            // 验证任务不再持有任何锁
            const taskLocks = lockManager.getLocksForTask(taskId);
            expect(taskLocks.length).toBe(0);
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：取消不存在的任务不应该影响现有锁
   */
  test("属性：取消不存在的任务不影响现有锁", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        async (nodeId, fakeTaskId, taskType) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建真实任务
          const result = await taskQueue.enqueue({
            nodeId,
            taskType,
          });

          expect(result.ok).toBe(true);

          if (result.ok) {
            const realTaskId = result.value;

            // 确保假任务 ID 与真实任务 ID 不同
            fc.pre(fakeTaskId !== realTaskId);

            // 真实任务获取锁
            lockManager.acquireNodeLock(nodeId, realTaskId);

            // 尝试取消不存在的任务
            const cancelResult = await taskQueue.cancel(fakeTaskId);
            expect(cancelResult.ok).toBe(false);

            // 验证真实任务的锁仍然存在
            expect(lockManager.isNodeLocked(nodeId)).toBe(true);
            const lock = lockManager.getNodeLock(nodeId);
            expect(lock?.taskId).toBe(realTaskId);
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：已完成的任务不能被取消
   */
  test("属性：已完成的任务不能被取消", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        async (nodeId, taskType) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建任务
          const result = await taskQueue.enqueue({
            nodeId,
            taskType,
          });

          expect(result.ok).toBe(true);

          if (result.ok) {
            const taskId = result.value;

            // 更新任务状态为 Completed
            await taskQueue.updateTaskState(taskId, "Running");
            await taskQueue.updateTaskState(taskId, "Completed");

            // 尝试取消已完成的任务应该失败
            const cancelResult = await taskQueue.cancel(taskId);
            expect(cancelResult.ok).toBe(false);
            if (!cancelResult.ok) {
              expect(cancelResult.error.code).toBe("INVALID_STATE");
            }

            // 验证任务状态仍然是 Completed
            const task = taskQueue.getTask(taskId);
            expect(task?.state).toBe("Completed");
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });
});
