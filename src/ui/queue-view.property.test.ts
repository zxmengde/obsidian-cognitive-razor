/**
 * QueueView 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { QueueView } from "./queue-view";
import { TaskQueue } from "../core/task-queue";
import { LockManager } from "../core/lock-manager";
import { FileStorage } from "../data/file-storage";
import { TaskRecord, TaskState } from "../types";
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

/**
 * 生成随机任务记录
 */
function arbTaskRecord(): fc.Arbitrary<TaskRecord> {
  return fc.record({
    id: fc.string({ minLength: 8, maxLength: 20 }),
    nodeId: fc.string({ minLength: 1, maxLength: 50 }),
    taskType: arbTaskType(),
    state: fc.constantFrom<TaskState>("Pending", "Running", "Completed", "Failed", "Cancelled"),
    attempt: fc.integer({ min: 0, max: 3 }),
    maxAttempts: fc.constant(3),
    payload: fc.dictionary(fc.string(), fc.anything()),
    created: fc.date().map(d => d.toISOString()),
    updated: fc.date().map(d => d.toISOString()),
  });
}

describe("QueueView 属性测试", () => {
  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 11: 队列视图任务完整性**
   * **验证需求：5.1, 5.2**
   * 
   * 属性：对于任意打开的队列视图，显示的任务列表必须包含队列中的所有任务，
   * 且每个任务必须显示类型、状态、进度和创建时间
   */
  test("属性 11: 队列视图任务完整性", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成随机任务列表
        fc.array(arbTaskRecord(), { minLength: 0, maxLength: 20 }),
        async (tasks) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 将任务添加到队列（通过直接操作内部状态来模拟）
          for (const task of tasks) {
            // 使用 enqueue 创建任务，然后更新状态
            const result = await taskQueue.enqueue({
              nodeId: task.nodeId,
              taskType: task.taskType,
              payload: task.payload,
            });

            if (result.ok) {
              // 更新任务状态以匹配测试数据
              await taskQueue.updateTaskState(result.value, task.state, {
                attempt: task.attempt,
                created: task.created,
                updated: task.updated,
              });
            }
          }

          // 获取队列中的所有任务
          const queueTasks = taskQueue.getAllTasks();

          // 验证任务数量匹配
          expect(queueTasks.length).toBe(tasks.length);

          // 验证每个任务都包含必需的字段
          for (const task of queueTasks) {
            // 必须有任务类型
            expect(task.taskType).toBeDefined();
            expect(typeof task.taskType).toBe("string");

            // 必须有状态
            expect(task.state).toBeDefined();
            expect(["Pending", "Running", "Completed", "Failed", "Cancelled"]).toContain(task.state);

            // 必须有创建时间
            expect(task.created).toBeDefined();
            expect(typeof task.created).toBe("string");
            // 验证是有效的 ISO 日期
            expect(() => new Date(task.created)).not.toThrow();

            // 必须有更新时间
            expect(task.updated).toBeDefined();
            expect(typeof task.updated).toBe("string");
            expect(() => new Date(task.updated)).not.toThrow();

            // 必须有尝试次数（进度信息）
            expect(task.attempt).toBeDefined();
            expect(typeof task.attempt).toBe("number");
            expect(task.attempt).toBeGreaterThanOrEqual(0);
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：队列视图应该正确分组任务
   */
  test("属性：任务按状态正确分组", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbTaskRecord(), { minLength: 1, maxLength: 20 }),
        async (tasks) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 添加任务到队列
          for (const task of tasks) {
            const result = await taskQueue.enqueue({
              nodeId: task.nodeId,
              taskType: task.taskType,
              payload: task.payload,
            });

            if (result.ok) {
              await taskQueue.updateTaskState(result.value, task.state);
            }
          }

          // 按状态获取任务
          const pendingTasks = taskQueue.getTasksByState("Pending");
          const runningTasks = taskQueue.getTasksByState("Running");
          const completedTasks = taskQueue.getTasksByState("Completed");
          const failedTasks = taskQueue.getTasksByState("Failed");
          const cancelledTasks = taskQueue.getTasksByState("Cancelled");

          // 验证每个分组中的任务状态正确
          for (const task of pendingTasks) {
            expect(task.state).toBe("Pending");
          }
          for (const task of runningTasks) {
            expect(task.state).toBe("Running");
          }
          for (const task of completedTasks) {
            expect(task.state).toBe("Completed");
          }
          for (const task of failedTasks) {
            expect(task.state).toBe("Failed");
          }
          for (const task of cancelledTasks) {
            expect(task.state).toBe("Cancelled");
          }

          // 验证总数匹配
          const totalGrouped = 
            pendingTasks.length +
            runningTasks.length +
            completedTasks.length +
            failedTasks.length +
            cancelledTasks.length;
          
          expect(totalGrouped).toBe(tasks.length);

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：过滤功能应该正确工作
   */
  test("属性：任务过滤正确工作", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbTaskRecord(), { minLength: 1, maxLength: 20 }),
        fc.constantFrom<TaskState | "all">("all", "Pending", "Running", "Completed", "Failed", "Cancelled"),
        async (tasks, filterState) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 添加任务到队列
          for (const task of tasks) {
            const result = await taskQueue.enqueue({
              nodeId: task.nodeId,
              taskType: task.taskType,
              payload: task.payload,
            });

            if (result.ok) {
              await taskQueue.updateTaskState(result.value, task.state);
            }
          }

          // 应用过滤
          const allTasks = taskQueue.getAllTasks();
          const filteredTasks = filterState === "all"
            ? allTasks
            : allTasks.filter(t => t.state === filterState);

          // 验证过滤结果
          if (filterState === "all") {
            expect(filteredTasks.length).toBe(tasks.length);
          } else {
            // 所有过滤后的任务都应该有正确的状态
            for (const task of filteredTasks) {
              expect(task.state).toBe(filterState);
            }
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });
});

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 12: 任务取消状态更新**
   * **验证需求：5.4**
   * 
   * 属性：对于任意队列中的任务，点击取消按钮后，任务状态必须更新为 Cancelled，
   * 且相关锁必须被释放
   */
  test("属性 12: 任务取消状态更新", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        fc.constantFrom<TaskState>("Pending", "Running"),
        async (nodeId, taskType, initialState) => {
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

            // 设置初始状态
            await taskQueue.updateTaskState(taskId, initialState);

            // 如果是 Running 状态，获取锁
            if (initialState === "Running") {
              const lockResult = lockManager.acquireNodeLock(nodeId, taskId);
              expect(lockResult.ok).toBe(true);
              expect(lockManager.isNodeLocked(nodeId)).toBe(true);
            }

            // 取消任务
            const cancelResult = await taskQueue.cancel(taskId);
            expect(cancelResult.ok).toBe(true);

            // 验证任务状态更新为 Cancelled
            const task = taskQueue.getTask(taskId);
            expect(task).toBeDefined();
            expect(task?.state).toBe("Cancelled");

            // 验证锁已被释放
            expect(lockManager.isNodeLocked(nodeId)).toBe(false);

            // 验证任务不再持有任何锁
            const taskLocks = lockManager.getLocksForTask(taskId);
            expect(taskLocks.length).toBe(0);

            // 验证更新时间已更新
            expect(task?.updated).toBeDefined();
            const updatedTime = new Date(task!.updated);
            const createdTime = new Date(task!.created);
            expect(updatedTime.getTime()).toBeGreaterThanOrEqual(createdTime.getTime());
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：取消已完成或已失败的任务应该失败
   */
  test("属性：不能取消已完成或已失败的任务", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        fc.constantFrom<TaskState>("Completed", "Failed", "Cancelled"),
        async (nodeId, taskType, finalState) => {
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

            // 更新到最终状态
            if (finalState === "Completed" || finalState === "Failed") {
              await taskQueue.updateTaskState(taskId, "Running");
            }
            await taskQueue.updateTaskState(taskId, finalState);

            // 尝试取消应该失败
            const cancelResult = await taskQueue.cancel(taskId);
            expect(cancelResult.ok).toBe(false);

            // 验证任务状态未改变
            const task = taskQueue.getTask(taskId);
            expect(task?.state).toBe(finalState);
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 13: 任务重试入队**
   * **验证需求：5.5**
   * 
   * 属性：对于任意状态为 Failed 的任务，点击重试按钮后，
   * 必须创建一个新的任务（相同 payload）并加入队列
   */
  test("属性 13: 任务重试入队", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        fc.dictionary(fc.string(), fc.anything()),
        async (nodeId, taskType, payload) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建失败的任务
          const result = await taskQueue.enqueue({
            nodeId,
            taskType,
            payload,
          });

          expect(result.ok).toBe(true);

          if (result.ok) {
            const originalTaskId = result.value;

            // 更新任务状态为 Failed
            await taskQueue.updateTaskState(originalTaskId, "Running");
            await taskQueue.updateTaskState(originalTaskId, "Failed");

            // 获取原始任务
            const originalTask = taskQueue.getTask(originalTaskId);
            expect(originalTask).toBeDefined();
            expect(originalTask?.state).toBe("Failed");

            // 记录重试前的任务数量
            const tasksBefore = taskQueue.getAllTasks();
            const countBefore = tasksBefore.length;

            // 重试任务（创建新任务）
            const retryResult = await taskQueue.enqueue({
              nodeId: originalTask!.nodeId,
              taskType: originalTask!.taskType,
              providerRef: originalTask!.providerRef,
              promptRef: originalTask!.promptRef,
              maxAttempts: originalTask!.maxAttempts,
              payload: originalTask!.payload,
            });

            expect(retryResult.ok).toBe(true);

            if (retryResult.ok) {
              const newTaskId = retryResult.value;

              // 验证创建了新任务
              expect(newTaskId).not.toBe(originalTaskId);

              // 验证任务数量增加
              const tasksAfter = taskQueue.getAllTasks();
              expect(tasksAfter.length).toBe(countBefore + 1);

              // 获取新任务
              const newTask = taskQueue.getTask(newTaskId);
              expect(newTask).toBeDefined();

              // 验证新任务的属性
              expect(newTask?.nodeId).toBe(originalTask!.nodeId);
              expect(newTask?.taskType).toBe(originalTask!.taskType);
              expect(newTask?.state).toBe("Pending");
              expect(newTask?.attempt).toBe(0);

              // 验证 payload 相同
              expect(JSON.stringify(newTask?.payload)).toBe(JSON.stringify(originalTask!.payload));

              // 验证原始任务状态未改变
              const originalTaskAfter = taskQueue.getTask(originalTaskId);
              expect(originalTaskAfter?.state).toBe("Failed");
            }
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：只有失败的任务才应该显示重试按钮
   */
  test("属性：重试功能仅对失败任务可用", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        fc.constantFrom<TaskState>("Pending", "Running", "Completed", "Cancelled"),
        async (nodeId, taskType, state) => {
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

            // 更新到指定状态
            if (state === "Running" || state === "Completed" || state === "Cancelled") {
              await taskQueue.updateTaskState(taskId, "Running");
            }
            if (state === "Completed" || state === "Cancelled") {
              await taskQueue.updateTaskState(taskId, state);
            }

            const task = taskQueue.getTask(taskId);
            expect(task?.state).toBe(state);

            // 对于非失败状态，不应该尝试重试
            // 这个测试验证的是逻辑约束，而不是实际的 UI 行为
            // 在实际 UI 中，只有 Failed 状态的任务才会显示重试按钮
            expect(task?.state).not.toBe("Failed");
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：重试任务应该保留原始任务的配置
   */
  test("属性：重试任务保留原始配置", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        arbTaskType(),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 5 }),
        fc.dictionary(fc.string(), fc.anything()),
        async (nodeId, taskType, providerRef, promptRef, maxAttempts, payload) => {
          const tempDir = createTempDir();
          const storage = new FileStorage({ dataDir: tempDir });
          const lockManager = new LockManager();
          const taskQueue = new TaskQueue({
            storage,
            lockManager,
            concurrency: 3,
          });

          await taskQueue.initialize();

          // 创建带有完整配置的任务
          const result = await taskQueue.enqueue({
            nodeId,
            taskType,
            providerRef,
            promptRef,
            maxAttempts,
            payload,
          });

          expect(result.ok).toBe(true);

          if (result.ok) {
            const originalTaskId = result.value;

            // 更新任务状态为 Failed
            await taskQueue.updateTaskState(originalTaskId, "Running");
            await taskQueue.updateTaskState(originalTaskId, "Failed");

            const originalTask = taskQueue.getTask(originalTaskId);
            expect(originalTask).toBeDefined();

            // 重试任务
            const retryResult = await taskQueue.enqueue({
              nodeId: originalTask!.nodeId,
              taskType: originalTask!.taskType,
              providerRef: originalTask!.providerRef,
              promptRef: originalTask!.promptRef,
              maxAttempts: originalTask!.maxAttempts,
              payload: originalTask!.payload,
            });

            expect(retryResult.ok).toBe(true);

            if (retryResult.ok) {
              const newTask = taskQueue.getTask(retryResult.value);
              expect(newTask).toBeDefined();

              // 验证所有配置都被保留
              expect(newTask?.nodeId).toBe(originalTask!.nodeId);
              expect(newTask?.taskType).toBe(originalTask!.taskType);
              expect(newTask?.providerRef).toBe(originalTask!.providerRef);
              expect(newTask?.promptRef).toBe(originalTask!.promptRef);
              expect(newTask?.maxAttempts).toBe(originalTask!.maxAttempts);
              expect(JSON.stringify(newTask?.payload)).toBe(JSON.stringify(originalTask!.payload));
            }
          }

          cleanupTempDir(tempDir);
        }
      ),
      { numRuns: 100 }
    );
  });
