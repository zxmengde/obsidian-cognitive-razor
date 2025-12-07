/**
 * 任务队列
 * 负责任务的调度、并发控制和持久化
 */

import {
  ITaskQueue,
  ITaskRunner,
  ILockManager,
  IFileStorage,
  ILogger,
  ISettingsStore,
  TaskRecord,
  QueueStatus,
  QueueEventListener,
  QueueEvent,
  QueueStateFile,
  Result,
  ok,
  err
} from "../types";

export class TaskQueue implements ITaskQueue {
  private lockManager: ILockManager;
  private fileStorage: IFileStorage;
  private logger: ILogger;
  private settingsStore: ISettingsStore;
  private queuePath: string;
  private taskRunner?: ITaskRunner; // 可选，稍后通过 setTaskRunner 注入
  
  private tasks: Map<string, TaskRecord>;
  private paused: boolean;
  private listeners: QueueEventListener[];
  private processingTasks: Set<string>;
  private schedulerInterval: NodeJS.Timeout | null;
  private lastPersistedContent: string | null;

  constructor(
    lockManager: ILockManager,
    fileStorage: IFileStorage,
    logger: ILogger,
    settingsStore: ISettingsStore,
    queuePath: string = "data/queue-state.json"
  ) {
    this.lockManager = lockManager;
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.queuePath = queuePath;
    
    this.tasks = new Map();
    this.paused = false;
    this.listeners = [];
    this.processingTasks = new Set();
    this.schedulerInterval = null;
    this.lastPersistedContent = null;

    this.logger.debug("TaskQueue", "TaskQueue 初始化完成", {
      queuePath
    });
  }

  /**
   * 设置 TaskRunner（依赖注入）
   * 
   * 注意：由于循环依赖问题，TaskRunner 需要在构造后注入
   * TaskQueue 需要 TaskRunner 来执行任务
   * TaskRunner 可能需要 TaskQueue 来入队后续任务
   */
  setTaskRunner(taskRunner: ITaskRunner): void {
    this.taskRunner = taskRunner;
    this.logger.debug("TaskQueue", "TaskRunner 已注入");
  }

  /**
   * 初始化（加载队列状态）
   */
  async initialize(): Promise<Result<void>> {
    try {
      const exists = await this.fileStorage.exists(this.queuePath);

      if (exists) {
        const readResult = await this.fileStorage.read(this.queuePath);
        if (!readResult.ok) {
          this.logger.error("TaskQueue", "读取队列状态失败", undefined, {
            error: readResult.error
          });
          return readResult;
        }

        try {
          const queueState: QueueStateFile = JSON.parse(readResult.value);
          await this.restoreQueueState(queueState);
        } catch (parseError) {
          this.logger.error("TaskQueue", "解析队列状态失败", parseError as Error);
          // 继续使用空队列
        }
      } else {
        this.logger.info("TaskQueue", "创建新的队列状态");
      }

      // 启动调度器
      this.startScheduler();

      return ok(undefined);
    } catch (error) {
      this.logger.error("TaskQueue", "初始化失败", error as Error);
      return err("E304", "初始化任务队列失败", error);
    }
  }

  /**
   * 将任务加入队列
   * 
   * 遵循 Requirements 2.1：入队前检查 LockManager 是否存在冲突锁
   * 遵循 A-FUNC-01：同一 nodeId 不能重复入队
   * - 检查是否已有同 nodeId 的 Pending/Running 任务
   * - 检查节点锁（nodeId）
   * - 检查类型锁（用于去重检测等场景）
   * 冲突时返回错误
   */
  enqueue(task: Omit<TaskRecord, 'id' | 'created' | 'updated'>): Result<string> {
    try {
      // 生成任务 ID
      const taskId = this.generateTaskId();

      // 检查是否已有同 nodeId 的 Pending/Running 任务
      // 遵循 A-FUNC-01：防止同一概念的并发操作
      for (const existingTask of this.tasks.values()) {
        if (existingTask.nodeId === task.nodeId && 
            (existingTask.state === "Pending" || existingTask.state === "Running")) {
          this.logger.warn("TaskQueue", "同一节点已有任务在队列中，无法入队", {
            taskId,
            nodeId: task.nodeId,
            existingTaskId: existingTask.id,
            existingTaskState: existingTask.state,
            existingTaskType: existingTask.taskType
          });
          return err("E400", `节点 ${task.nodeId} 已有任务在队列中（${existingTask.taskType}，状态：${existingTask.state}），无法重复入队`, {
            nodeId: task.nodeId,
            existingTaskId: existingTask.id,
            existingTaskType: existingTask.taskType,
            existingTaskState: existingTask.state
          });
        }
      }

      // 检查锁冲突 - 节点锁
      const nodeLockKey = task.nodeId;
      if (this.lockManager.isLocked(nodeLockKey)) {
        this.logger.warn("TaskQueue", "节点锁冲突，无法入队", {
          taskId,
          lockKey: nodeLockKey,
          nodeId: task.nodeId,
          lockType: "node"
        });
        return err("E400", `节点 ${task.nodeId} 已被锁定，无法入队`, {
          lockKey: nodeLockKey,
          lockType: "node"
        });
      }

      // 检查锁冲突 - 类型锁（用于去重检测等需要类型级别锁的场景）
      // 从 payload 中获取类型信息（如果存在）
      const crType = (task.payload?.type as string | undefined) || (task.payload?.conceptType as string | undefined);
      if (crType) {
        const typeLockKey = `type:${crType}`;
        if (this.lockManager.isLocked(typeLockKey)) {
          this.logger.warn("TaskQueue", "类型锁冲突，无法入队", {
            taskId,
            lockKey: typeLockKey,
            nodeId: task.nodeId,
            crType,
            lockType: "type"
          });
          return err("E400", `类型 ${crType} 已被锁定，无法入队`, {
            lockKey: typeLockKey,
            lockType: "type"
          });
        }
      }

      // 创建完整的任务记录
      const now = new Date().toISOString();
      const fullTask: TaskRecord = {
        ...task,
        id: taskId,
        created: now,
        updated: now,
        state: "Pending"
      };

      // 添加到队列
      this.tasks.set(taskId, fullTask);

      // 持久化 - 入队成功后立即写入 queue-state.json (Requirements 2.2)
      this.saveQueue();

      // 发布事件
      this.publishEvent({
        type: "task-added",
        taskId,
        timestamp: now
      });

      this.logger.info("TaskQueue", `任务已入队: ${taskId}`, {
        taskType: task.taskType,
        nodeId: task.nodeId
      });

      return ok(taskId);
    } catch (error) {
      this.logger.error("TaskQueue", "任务入队失败", error as Error, {
        nodeId: task.nodeId,
        taskType: task.taskType
      });
      return err("E304", "任务入队失败", error);
    }
  }

  /**
   * 取消任务
   */
  cancel(taskId: string): Result<boolean> {
    try {
      const task = this.tasks.get(taskId);
      if (!task) {
        this.logger.warn("TaskQueue", "任务不存在", { taskId });
        return err("E304", `任务不存在: ${taskId}`);
      }

      // 只能取消 Pending 或 Running 状态的任务
      if (task.state !== "Pending" && task.state !== "Running") {
        this.logger.warn("TaskQueue", "任务状态不允许取消", {
          taskId,
          state: task.state
        });
        return err("E304", `任务状态不允许取消: ${task.state}`);
      }

      // 更新任务状态
      task.state = "Cancelled";
      task.updated = new Date().toISOString();

      // 释放锁
      if (task.lockKey) {
        this.lockManager.release(task.lockKey);
      }
      if (task.typeLockKey) {
        this.lockManager.release(task.typeLockKey);
      }

      // 从处理中集合移除
      this.processingTasks.delete(taskId);

      // 持久化
      this.saveQueue();

      // 发布事件
      this.publishEvent({
        type: "task-cancelled",
        taskId,
        timestamp: task.updated
      });

      this.logger.info("TaskQueue", `任务已取消: ${taskId}`);

      return ok(true);
    } catch (error) {
      this.logger.error("TaskQueue", "取消任务失败", error as Error, {
        taskId
      });
      return err("E304", "取消任务失败", error);
    }
  }

  /**
   * 暂停队列
   */
  pause(): void {
    this.paused = true;
    this.saveQueue();
    
    this.publishEvent({
      type: "queue-paused",
      timestamp: new Date().toISOString()
    });

    this.logger.info("TaskQueue", "队列已暂停");
  }

  /**
   * 恢复队列
   */
  resume(): void {
    this.paused = false;
    this.saveQueue();
    
    this.publishEvent({
      type: "queue-resumed",
      timestamp: new Date().toISOString()
    });

    this.logger.info("TaskQueue", "队列已恢复");
  }

  /**
   * 获取队列状态
   */
  getStatus(): QueueStatus {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;

    for (const task of this.tasks.values()) {
      switch (task.state) {
        case "Pending":
          pending++;
          break;
        case "Running":
          running++;
          break;
        case "Completed":
          completed++;
          break;
        case "Failed":
          failed++;
          break;
      }
    }

    return {
      paused: this.paused,
      pending,
      running,
      completed,
      failed
    };
  }

  /**
   * 订阅队列事件
   */
  subscribe(listener: QueueEventListener): () => void {
    this.listeners.push(listener);

    // 返回取消订阅函数
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 更新任务状态
   */
  updateTask(taskId: string, updates: Partial<TaskRecord>): Result<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err("E304", `任务不存在: ${taskId}`);
    }

    Object.assign(task, updates);
    task.updated = new Date().toISOString();

    this.saveQueue();

    return ok(undefined);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      this.logger.info("TaskQueue", "调度器已停止");
    }
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 清理已完成的任务
   * @param beforeDate 清理此日期之前完成的任务
   * @returns 清理的任务数量
   */
  async cleanupCompletedTasks(beforeDate: Date): Promise<Result<number>> {
    try {
      const tasksToRemove: string[] = [];
      const beforeTime = beforeDate.getTime();

      for (const [taskId, task] of this.tasks.entries()) {
        if (task.state === "Completed" && task.completedAt) {
          const completedTime = new Date(task.completedAt).getTime();
          if (completedTime < beforeTime) {
            tasksToRemove.push(taskId);
          }
        }
      }

      for (const taskId of tasksToRemove) {
        this.tasks.delete(taskId);
      }

      // 持久化
      await this.saveQueue();

      this.logger.info("TaskQueue", `清理了 ${tasksToRemove.length} 个已完成任务`);

      return ok(tasksToRemove.length);
    } catch (error) {
      this.logger.error("TaskQueue", "清理任务失败", error as Error);
      return err("E304", "清理任务失败", error);
    }
  }

  /**
   * 清理已完成的任务（无参数版本）
   */
  async clearCompleted(): Promise<Result<number>> {
    // 清理所有已完成的任务
    return this.cleanupCompletedTasks(new Date());
  }

  /**
   * 重试所有失败的任务
   */
  async retryFailed(): Promise<Result<number>> {
    try {
      let retriedCount = 0;

      for (const task of this.tasks.values()) {
        if (task.state === "Failed") {
          // 重置任务状态
          task.state = "Pending";
          task.attempt = 0;
          task.errors = [];
          task.updated = new Date().toISOString();
          retriedCount++;
        }
      }

      // 持久化
      await this.saveQueue();

      this.logger.info("TaskQueue", `重试了 ${retriedCount} 个失败任务`);

      return ok(retriedCount);
    } catch (error) {
      this.logger.error("TaskQueue", "重试任务失败", error as Error);
      return err("E304", "重试任务失败", error);
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 启动调度器
   */
  private startScheduler(): void {
    // 每秒检查一次是否有任务可以执行
    this.schedulerInterval = setInterval(() => {
      this.scheduleNextTask();
    }, 1000);

    this.logger.info("TaskQueue", "调度器已启动");
  }

  /**
   * 调度下一个任务
   * 
   * 遵循设计文档：
   * - TaskQueue 负责调度和并发控制
   * - TaskRunner 负责实际执行
   * - 执行结果更新任务状态并持久化
   */
  private scheduleNextTask(): void {
    // 如果队列暂停，不调度新任务
    if (this.paused) {
      return;
    }

    // 如果没有注入 TaskRunner，无法执行任务
    if (!this.taskRunner) {
      this.logger.warn("TaskQueue", "TaskRunner 未注入，无法执行任务");
      return;
    }

    const settings = this.settingsStore.getSettings();
    const concurrency = settings.concurrency;

    // 如果已达到并发上限，不调度新任务
    if (this.processingTasks.size >= concurrency) {
      return;
    }

    // 查找第一个 Pending 状态的任务
    for (const task of this.tasks.values()) {
      if (task.state === "Pending") {
        // 检查锁
        const lockResult = this.lockManager.acquire(task.nodeId, "node", task.id);
        if (!lockResult.ok) {
          this.logger.debug("TaskQueue", `任务 ${task.id} 节点锁冲突，跳过`, {
            nodeId: task.nodeId,
            lockError: lockResult.error
          });
          continue;
        }

        // 尝试类型锁
        let typeLockKey: string | undefined;
        const crType = (task.payload?.type as string | undefined) || (task.payload?.conceptType as string | undefined);
        if (crType) {
          const typeLockResult = this.lockManager.acquire(`type:${crType}`, "type", task.id);
          if (!typeLockResult.ok) {
            // 释放节点锁并跳过
            this.lockManager.release(lockResult.value);
            this.logger.debug("TaskQueue", `任务 ${task.id} 类型锁冲突，跳过`, {
              nodeId: task.nodeId,
              crType,
              lockError: typeLockResult.error
            });
            continue;
          }
          typeLockKey = typeLockResult.value;
        }

        // 标记为处理中
        this.processingTasks.add(task.id);
        task.lockKey = lockResult.value;
        if (typeLockKey) {
          task.typeLockKey = typeLockKey;
        }

        // 更新任务状态
        task.state = "Running";
        task.startedAt = new Date().toISOString();
        task.updated = task.startedAt;

        this.saveQueue();

        // 发布事件
        this.publishEvent({
          type: "task-started",
          taskId: task.id,
          timestamp: task.startedAt
        });

        this.logger.info("TaskQueue", `任务开始执行: ${task.id}`, {
          taskType: task.taskType,
          nodeId: task.nodeId
        });

        // 异步执行任务（不阻塞调度器）
        this.executeTask(task).catch((error) => {
          this.logger.error("TaskQueue", `任务执行异常: ${task.id}`, error as Error);
        });

        // 只调度一个任务
        break;
      }
    }
  }

  /**
   * 执行任务
   * 
   * 调用 TaskRunner.run() 并处理结果
   */
  private async executeTask(task: TaskRecord): Promise<void> {
    if (!this.taskRunner) {
      this.logger.error("TaskQueue", "TaskRunner 未注入", undefined, {
        taskId: task.id
      });
      return;
    }

    try {
      this.logger.debug("TaskQueue", `开始执行任务: ${task.id}`, {
        taskType: task.taskType,
        attempt: task.attempt + 1
      });

      // 调用 TaskRunner 执行任务
      const result = await this.taskRunner.run(task);

      if (result.ok) {
        // 任务成功
        task.state = "Completed";
        task.completedAt = new Date().toISOString();
        task.updated = task.completedAt;
        task.result = result.value.data;
        // 将结果也写回 payload，方便旧代码读取
        if (result.value.data !== undefined) {
          task.payload = {
            ...task.payload,
            result: result.value.data
          };
        }

        this.logger.info("TaskQueue", `任务完成: ${task.id}`, {
          taskType: task.taskType,
          nodeId: task.nodeId
        });

        // 发布完成事件
        this.publishEvent({
          type: "task-completed",
          taskId: task.id,
          timestamp: task.completedAt
        });
      } else {
        // 任务失败
        task.attempt++;
        
        // 记录错误
        if (!task.errors) {
          task.errors = [];
        }
        task.errors.push({
          code: result.error.code,
          message: result.error.message,
          timestamp: new Date().toISOString(),
          attempt: task.attempt
        });

        // 检查是否需要重试
        const settings = this.settingsStore.getSettings();
        if (settings.autoRetry && task.attempt < task.maxAttempts) {
          // 重试：重置为 Pending 状态
          task.state = "Pending";
          task.updated = new Date().toISOString();

          this.logger.warn("TaskQueue", `任务失败，将重试: ${task.id}`, {
            attempt: task.attempt,
            maxAttempts: task.maxAttempts,
            error: result.error
          });
        } else {
          // 不再重试：标记为 Failed
          task.state = "Failed";
          task.updated = new Date().toISOString();

          this.logger.error("TaskQueue", `任务失败: ${task.id}`, undefined, {
            attempt: task.attempt,
            maxAttempts: task.maxAttempts,
            error: result.error
          });

          // 发布失败事件
          this.publishEvent({
            type: "task-failed",
            taskId: task.id,
            timestamp: task.updated
          });
        }
      }

      // 释放锁
      if (task.lockKey) {
        this.lockManager.release(task.lockKey);
        task.lockKey = undefined;
      }
      if (task.typeLockKey) {
        this.lockManager.release(task.typeLockKey);
        task.typeLockKey = undefined;
      }

      // 从处理中集合移除
      this.processingTasks.delete(task.id);

      // 持久化
      await this.saveQueue();

    } catch (error) {
      // 捕获未预期的异常
      this.logger.error("TaskQueue", `任务执行异常: ${task.id}`, error as Error);

      task.state = "Failed";
      task.updated = new Date().toISOString();
      
      if (!task.errors) {
        task.errors = [];
      }
      task.errors.push({
        code: "E304",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        attempt: task.attempt
      });

      // 释放锁
      if (task.lockKey) {
        this.lockManager.release(task.lockKey);
        task.lockKey = undefined;
      }
      if (task.typeLockKey) {
        this.lockManager.release(task.typeLockKey);
        task.typeLockKey = undefined;
      }

      // 从处理中集合移除
      this.processingTasks.delete(task.id);

      // 持久化
      await this.saveQueue();

      // 发布失败事件
      this.publishEvent({
        type: "task-failed",
        taskId: task.id,
        timestamp: task.updated
      });
    }
  }

  /**
   * 保存队列状态
   * 
   * 遵循 Requirements 2.2：入队成功后立即写入 queue-state.json
   * 
   * 注意：此方法是异步的，但在 enqueue 中被调用时不会阻塞返回。
   * 这是为了保持 ITaskQueue 接口的同步特性。
   * 写入操作会立即开始，但可能在 enqueue 返回后完成。
   */
  private async saveQueue(): Promise<void> {
    try {
      const settings = this.settingsStore.getSettings();
      
      const queueState: QueueStateFile = {
        version: "1.0.0",
        tasks: Array.from(this.tasks.values()),
        concurrency: settings.concurrency,
        paused: this.paused,
        stats: this.calculateStats(),
        locks: this.lockManager.getActiveLocks()
      };

      const content = JSON.stringify(queueState, null, 2);
      
      // 更新最后持久化的内容（用于测试验证）
      this.lastPersistedContent = content;

      const writeResult = await this.fileStorage.atomicWrite(
        this.queuePath,
        content
      );

      if (!writeResult.ok) {
        this.logger.error("TaskQueue", "保存队列状态失败", undefined, {
          error: writeResult.error
        });
      } else {
        this.logger.debug("TaskQueue", "队列状态已持久化", {
          path: this.queuePath,
          taskCount: queueState.tasks.length
        });
      }
    } catch (error) {
      this.logger.error("TaskQueue", "保存队列状态异常", error as Error);
    }
  }

  /**
   * 获取最后持久化的内容（用于测试）
   * 
   * 注意：此方法仅用于测试目的，验证 Requirements 2.2
   */
  getLastPersistedContent(): string | null {
    return this.lastPersistedContent;
  }

  /**
   * 获取队列文件路径
   */
  getQueuePath(): string {
    return this.queuePath;
  }

  /**
   * 从持久化文件恢复队列状态（包含锁清理）
   */
  private async restoreQueueState(queueState: QueueStateFile): Promise<void> {
    // 先清空内存状态
    this.tasks.clear();
    this.processingTasks.clear();

    // 恢复暂停状态
    this.paused = queueState.paused;

    // 恢复锁状态（用于后续清理）
    if (queueState.locks && queueState.locks.length > 0) {
      this.lockManager.restoreLocks(queueState.locks);
    } else {
      this.lockManager.clear();
    }

    const now = new Date().toISOString();
    const recoveredRunning: string[] = [];

    // 恢复任务，处理 Running → Pending 的恢复逻辑
    for (const task of queueState.tasks) {
      // 拷贝以避免修改原对象引用
      const restoredTask: TaskRecord = { ...task };

      // 重启后不存在正在运行的任务，统一降级为 Pending 并释放锁
      if (restoredTask.state === "Running") {
        restoredTask.state = "Pending";
        restoredTask.startedAt = undefined;
        restoredTask.completedAt = undefined;
        restoredTask.lockKey = undefined;
        restoredTask.typeLockKey = undefined;
        restoredTask.updated = now;
        recoveredRunning.push(restoredTask.id);
        this.lockManager.releaseByTaskId(restoredTask.id);
      } else {
        // 清理残留锁引用，锁管理器在上一步已恢复对应锁
        if (restoredTask.lockKey) {
          this.lockManager.release(restoredTask.lockKey);
        }
        if (restoredTask.typeLockKey) {
          this.lockManager.release(restoredTask.typeLockKey);
        }
        restoredTask.lockKey = undefined;
        restoredTask.typeLockKey = undefined;
      }

      this.tasks.set(restoredTask.id, restoredTask);
    }

    // 清除无任务关联的锁，避免阻塞后续调度
    const releasedLocks = this.releaseLocksWithoutTasks();

    if (recoveredRunning.length > 0 || releasedLocks > 0) {
      this.logger.warn("TaskQueue", "重启恢复时清理未完成任务和锁", {
        recoveredRunning,
        releasedLocks
      });
    }

    // 启动时不保留任何锁，运行时会在调度阶段重新获取
    this.lockManager.clear();

    this.logger.info("TaskQueue", "队列状态恢复成功", {
      taskCount: this.tasks.size,
      paused: this.paused
    });

    // 持久化清理后的状态，避免下一次启动重复恢复
    await this.saveQueue();
  }

  /**
   * 释放与当前任务集不匹配的锁
   */
  private releaseLocksWithoutTasks(): number {
    const activeLocks = this.lockManager.getActiveLocks();
    const validTaskIds = new Set(Array.from(this.tasks.keys()));
    let released = 0;

    for (const lock of activeLocks) {
      if (!validTaskIds.has(lock.taskId)) {
        this.lockManager.release(lock.key);
        released++;
      }
    }

    return released;
  }

  /**
   * 计算统计信息
   */
  private calculateStats() {
    let totalProcessed = 0;
    let totalFailed = 0;
    let totalCancelled = 0;
    let lastProcessedAt: string | undefined;

    for (const task of this.tasks.values()) {
      if (task.state === "Completed") {
        totalProcessed++;
        if (!lastProcessedAt || task.completedAt! > lastProcessedAt) {
          lastProcessedAt = task.completedAt;
        }
      } else if (task.state === "Failed") {
        totalFailed++;
      } else if (task.state === "Cancelled") {
        totalCancelled++;
      }
    }

    return {
      totalProcessed,
      totalFailed,
      totalCancelled,
      lastProcessedAt
    };
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 发布事件
   */
  private publishEvent(event: QueueEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error("TaskQueue", "事件监听器执行失败", error as Error, {
          eventType: event.type
        });
      }
    }
  }

  /**
   * 检查锁冲突
   * 
   * 遵循 Requirements 2.1：入队前检查 LockManager 是否存在冲突锁
   * 
   * @param nodeId 节点 ID
   * @param crType 知识类型（可选）
   * @returns 如果存在冲突，返回错误信息；否则返回 null
   */
  checkLockConflict(nodeId: string, crType?: string): { lockKey: string; lockType: 'node' | 'type' } | null {
    // 检查节点锁
    if (this.lockManager.isLocked(nodeId)) {
      return { lockKey: nodeId, lockType: 'node' };
    }

    // 检查类型锁
    if (crType) {
      const typeLockKey = `type:${crType}`;
      if (this.lockManager.isLocked(typeLockKey)) {
        return { lockKey: typeLockKey, lockType: 'type' };
      }
    }

    return null;
  }
}
