/**
 * TaskQueue 单元测试
 */

import { TaskQueue, CreateTaskParams } from "./task-queue";
import { LockManager } from "./lock-manager";
import { FileStorage } from "../data/file-storage";
import { QueueEvent } from "../types";
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

describe("TaskQueue", () => {
  let taskQueue: TaskQueue;
  let lockManager: LockManager;
  let storage: FileStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createTempDir();
    storage = new FileStorage({ dataDir: tempDir });
    lockManager = new LockManager();
    taskQueue = new TaskQueue({
      storage,
      lockManager,
      concurrency: 3,
    });

    await taskQueue.initialize();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("任务入队", () => {
    test("应该成功入队任务", async () => {
      const params: CreateTaskParams = {
        nodeId: "node-1",
        taskType: "standardizeClassify",
        payload: { input: "test" },
      };

      const result = await taskQueue.enqueue(params);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const task = taskQueue.getTask(result.value);
        expect(task).toBeDefined();
        expect(task?.nodeId).toBe("node-1");
        expect(task?.state).toBe("Pending");
      }
    });

    test("应该拒绝入队已锁定节点的任务", async () => {
      // 先获取锁
      lockManager.acquireNodeLock("node-1", "existing-task");

      const params: CreateTaskParams = {
        nodeId: "node-1",
        taskType: "standardizeClassify",
      };

      const result = await taskQueue.enqueue(params);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("LOCK_CONFLICT");
      }
    });

    test("应该触发 task-added 事件", async () => {
      const events: QueueEvent[] = [];
      taskQueue.subscribe((event) => events.push(event));

      const params: CreateTaskParams = {
        nodeId: "node-1",
        taskType: "standardizeClassify",
      };

      await taskQueue.enqueue(params);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("task-added");
    });
  });

  describe("任务取消", () => {
    test("应该成功取消 Pending 任务", async () => {
      const params: CreateTaskParams = {
        nodeId: "node-1",
        taskType: "standardizeClassify",
      };

      const enqueueResult = await taskQueue.enqueue(params);
      expect(enqueueResult.ok).toBe(true);

      if (enqueueResult.ok) {
        const cancelResult = await taskQueue.cancel(enqueueResult.value);
        expect(cancelResult.ok).toBe(true);

        const task = taskQueue.getTask(enqueueResult.value);
        expect(task?.state).toBe("Cancelled");
      }
    });

    test("应该拒绝取消不存在的任务", async () => {
      const result = await taskQueue.cancel("non-existent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TASK_NOT_FOUND");
      }
    });

    test("应该触发 task-cancelled 事件", async () => {
      const events: QueueEvent[] = [];
      taskQueue.subscribe((event) => events.push(event));

      const params: CreateTaskParams = {
        nodeId: "node-1",
        taskType: "standardizeClassify",
      };

      const enqueueResult = await taskQueue.enqueue(params);
      if (enqueueResult.ok) {
        await taskQueue.cancel(enqueueResult.value);
      }

      const cancelEvents = events.filter((e) => e.type === "task-cancelled");
      expect(cancelEvents.length).toBe(1);
    });
  });

  describe("队列暂停和恢复", () => {
    test("应该暂停队列", () => {
      taskQueue.pause();
      const status = taskQueue.getStatus();
      expect(status.paused).toBe(true);
    });

    test("应该恢复队列", () => {
      taskQueue.pause();
      taskQueue.resume();
      const status = taskQueue.getStatus();
      expect(status.paused).toBe(false);
    });

    test("应该触发 queue-paused 事件", () => {
      const events: QueueEvent[] = [];
      taskQueue.subscribe((event) => events.push(event));

      taskQueue.pause();

      const pauseEvents = events.filter((e) => e.type === "queue-paused");
      expect(pauseEvents.length).toBe(1);
    });

    test("应该触发 queue-resumed 事件", () => {
      const events: QueueEvent[] = [];
      taskQueue.subscribe((event) => events.push(event));

      taskQueue.pause();
      taskQueue.resume();

      const resumeEvents = events.filter((e) => e.type === "queue-resumed");
      expect(resumeEvents.length).toBe(1);
    });
  });

  describe("队列状态", () => {
    test("应该正确统计队列状态", async () => {
      // 添加多个任务
      await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });
      await taskQueue.enqueue({
        nodeId: "node-2",
        taskType: "enrich",
      });

      const status = taskQueue.getStatus();
      expect(status.pending).toBe(2);
      expect(status.running).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.failed).toBe(0);
    });
  });

  describe("任务查询", () => {
    test("应该获取指定任务", async () => {
      const params: CreateTaskParams = {
        nodeId: "node-1",
        taskType: "standardizeClassify",
      };

      const result = await taskQueue.enqueue(params);
      if (result.ok) {
        const task = taskQueue.getTask(result.value);
        expect(task).toBeDefined();
        expect(task?.id).toBe(result.value);
      }
    });

    test("应该获取所有任务", async () => {
      await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });
      await taskQueue.enqueue({
        nodeId: "node-2",
        taskType: "enrich",
      });

      const allTasks = taskQueue.getAllTasks();
      expect(allTasks.length).toBe(2);
    });

    test("应该按状态获取任务", async () => {
      const result1 = await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });
      await taskQueue.enqueue({
        nodeId: "node-2",
        taskType: "enrich",
      });

      if (result1.ok) {
        await taskQueue.cancel(result1.value);
      }

      const pendingTasks = taskQueue.getTasksByState("Pending");
      const cancelledTasks = taskQueue.getTasksByState("Cancelled");

      expect(pendingTasks.length).toBe(1);
      expect(cancelledTasks.length).toBe(1);
    });
  });

  describe("任务状态更新", () => {
    test("应该更新任务状态", async () => {
      const result = await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });

      if (result.ok) {
        const updateResult = await taskQueue.updateTaskState(
          result.value,
          "Running"
        );
        expect(updateResult.ok).toBe(true);

        const task = taskQueue.getTask(result.value);
        expect(task?.state).toBe("Running");
        expect(task?.startedAt).toBeDefined();
      }
    });

    test("应该更新运行计数", async () => {
      const result = await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });

      if (result.ok) {
        await taskQueue.updateTaskState(result.value, "Running");
        let status = taskQueue.getStatus();
        expect(status.running).toBe(1);

        await taskQueue.updateTaskState(result.value, "Completed");
        status = taskQueue.getStatus();
        expect(status.running).toBe(0);
        expect(status.completed).toBe(1);
      }
    });
  });

  describe("事件订阅", () => {
    test("应该正确订阅和取消订阅", async () => {
      const events: QueueEvent[] = [];
      const unsubscribe = taskQueue.subscribe((event) => events.push(event));

      await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });

      expect(events.length).toBe(1);

      // 取消订阅
      unsubscribe();

      await taskQueue.enqueue({
        nodeId: "node-2",
        taskType: "enrich",
      });

      // 不应该收到新事件
      expect(events.length).toBe(1);
    });
  });

  describe("任务清理", () => {
    test("应该清理旧的已完成任务", async () => {
      const result = await taskQueue.enqueue({
        nodeId: "node-1",
        taskType: "standardizeClassify",
      });

      if (result.ok) {
        // 先设置为 Running，再设置为 Completed，确保 completedAt 被设置
        await taskQueue.updateTaskState(result.value, "Running");
        await taskQueue.updateTaskState(result.value, "Completed");

        // 清理未来时间之前的任务（应该清理所有）
        const futureDate = new Date(Date.now() + 1000000);
        const cleanResult = await taskQueue.cleanupCompletedTasks(futureDate);

        expect(cleanResult.ok).toBe(true);
        if (cleanResult.ok) {
          expect(cleanResult.value).toBe(1);
        }

        const task = taskQueue.getTask(result.value);
        expect(task).toBeUndefined();
      }
    });
  });
});
