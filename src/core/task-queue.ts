/** 任务队列 - 负责任务调度、并发控制和持久化 */

import {
  ILogger,
  TaskRecord,
  TaskResult,
  QueueStatus,
  QueueEventListener,
  QueueEvent,
  QueueStateFile,
  Result,
  ok,
  err,
  CognitiveRazorError
} from "../types";
import { formatCRTimestamp } from "../utils/date-utils";
import { RetryHandler } from "./retry-handler";
import type { SimpleLockManager } from "./lock-manager";
import type { TaskRunner } from "./task-runner";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import { TaskQueueStore } from "./task-queue-store";

export class TaskQueue {
  private lockManager: SimpleLockManager;
  private logger: ILogger;
  private settingsStore: SettingsStore;
  private queueStore: TaskQueueStore;
  private taskRunner?: TaskRunner; // 可选，稍后通过 setTaskRunner 注入
  private retryHandler: RetryHandler; // 重试处理器
  
  private tasks: Map<string, TaskRecord>;
  private paused: boolean;
  private listeners: QueueEventListener[];
  private processingTasks: Set<string>;
  private isScheduling: boolean;
  private static readonly DEFAULT_TASK_TIMEOUT_MS = 3 * 60 * 1000;
  private static readonly DEFAULT_TASK_HISTORY_LIMIT = 300;

  constructor(
    lockManager: SimpleLockManager,
    fileStorage: FileStorage,
    logger: ILogger,
    settingsStore: SettingsStore,
    queuePath: string = "data/queue-state.json"
  ) {
    this.lockManager = lockManager;
    this.logger = logger;
    this.settingsStore = settingsStore;
    this.queueStore = new TaskQueueStore(fileStorage, logger, queuePath);
    this.retryHandler = new RetryHandler(logger);
    
    this.tasks = new Map();
    this.paused = false;
    this.listeners = [];
    this.processingTasks = new Set();
    this.isScheduling = false;

    this.logger.debug("TaskQueue", "TaskQueue 初始化完成", {
      queuePath: this.queueStore.getQueuePath()
    });
  }

  /** 设置 TaskRunner（依赖注入，避免循环依赖） */
  setTaskRunner(taskRunner: TaskRunner): void {
    this.taskRunner = taskRunner;
    this.logger.debug("TaskQueue", "TaskRunner 已注入");

    // 事件驱动调度：注入后立即尝试调度（处理 initialize 时因 taskRunner 未注入而跳过的任务）
    this.tryScheduleAll();
  }

  /** 初始化 - 加载队列状态 */
  async initialize(): Promise<Result<void>> {
    try {
      const loadResult = await this.queueStore.load();
      if (!loadResult.ok) {
        return loadResult;
      }

      const loaded = loadResult.value;
      if (!loaded) {
        this.logger.info("TaskQueue", "创建新的队列状态");
        return ok(undefined);
      }

      await this.restoreQueueState(loaded.state, loaded.migrated);

      return ok(undefined);
    } catch (error) {
      this.logger.error("TaskQueue", "初始化失败", error as Error);
      return err("E500_INTERNAL_ERROR", "初始化任务队列失败", error);
    }
  }

  /** 入队任务 - 检查锁冲突和重复入队 */
  enqueue(task: Omit<TaskRecord, "id" | "created" | "updated">): string {
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
          throw new CognitiveRazorError(
            "E320_TASK_CONFLICT",
            `节点 ${task.nodeId} 已有任务在队列中（${existingTask.taskType}，状态：${existingTask.state}），无法重复入队`,
            {
              nodeId: task.nodeId,
              existingTaskId: existingTask.id,
              existingTaskType: existingTask.taskType,
              existingTaskState: existingTask.state
            }
          );
        }
      }

      // 锁在调度时获取：入队不因锁而失败，避免“可等待任务”被误判为错误

      // 创建完整的任务记录
      const now = formatCRTimestamp();
      // 仅使用显式传入的 typeLockKey（不再从 payload 推断）
      const explicitTypeLockKey = typeof task.typeLockKey === "string"
        ? task.typeLockKey
        : undefined;
      const fullTask: TaskRecord = {
        ...task,
        id: taskId,
        created: now,
        updated: now,
        state: "Pending",
        lockKey: task.lockKey ?? task.nodeId,
        typeLockKey: explicitTypeLockKey
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

      // Requirements 8.4: 记录任务状态变更日志
      this.logger.info("TaskQueue", `任务状态变更: ${taskId}`, {
        event: "TASK_STATE_CHANGE",
        taskId,
        previousState: null,
        newState: "Pending",
        taskType: task.taskType,
        nodeId: task.nodeId
      });

      // 事件驱动调度：入队后立即尝试调度
      this.tryScheduleAll();

      return taskId;
    } catch (error) {
      this.logger.error("TaskQueue", "任务入队失败", error instanceof Error ? error : new Error(String(error)), {
        nodeId: task.nodeId,
        taskType: task.taskType
      });
      if (error instanceof CognitiveRazorError) {
        throw error;
      }
      throw new CognitiveRazorError("E500_INTERNAL_ERROR", "任务入队失败", error);
    }
  }

  /** 取消任务 - 支持 Pending/Running/Failed 状态 */
  cancel(taskId: string): boolean {
    try {
      const task = this.tasks.get(taskId);
      if (!task) {
        this.logger.warn("TaskQueue", "任务不存在", { taskId });
        throw new CognitiveRazorError("E311_NOT_FOUND", `任务不存在: ${taskId}`);
      }

      // 可以取消 Pending、Running 或 Failed 状态的任务
      // Completed 和 Cancelled 状态的任务不能再次取消
      if (task.state !== "Pending" && task.state !== "Running" && task.state !== "Failed") {
        this.logger.warn("TaskQueue", "任务状态不允许取消", {
          taskId,
          state: task.state
        });
        throw new CognitiveRazorError("E310_INVALID_STATE", `任务状态不允许取消: ${task.state}`);
      }

      // 记录之前的状态
      const previousState = task.state;

      // Running 任务尝试中断执行（如果支持）
      if (task.state === "Running") {
        try {
          this.taskRunner?.abort(taskId);
        } catch (error) {
          this.logger.warn("TaskQueue", "中断运行中任务失败（忽略）", {
            taskId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // 更新任务状态
      task.state = "Cancelled";
      task.updated = formatCRTimestamp();

      // 释放锁
      if (task.lockKey) {
        this.lockManager.release(task.lockKey);
      }

      // 从处理中集合移除
      this.processingTasks.delete(taskId);

      // 发布事件
      this.publishEvent({
        type: "task-cancelled",
        taskId,
        timestamp: task.updated
      });

      // Requirements 8.4: 记录任务状态变更日志
      this.logger.info("TaskQueue", `任务状态变更: ${taskId}`, {
        event: "TASK_STATE_CHANGE",
        taskId,
        previousState,
        newState: "Cancelled"
      });

      return true;
    } catch (error) {
      this.logger.error("TaskQueue", "取消任务失败", error as Error, {
        taskId
      });
      if (error instanceof CognitiveRazorError) {
        throw error;
      }
      throw new CognitiveRazorError("E500_INTERNAL_ERROR", "取消任务失败", error);
    }
  }

  /** 暂停队列 */
  async pause(): Promise<void> {
    this.paused = true;
    await this.saveQueue();
    
    this.publishEvent({
      type: "queue-paused",
      timestamp: formatCRTimestamp()
    });

    this.logger.info("TaskQueue", "队列已暂停");
  }

  /** 恢复队列 */
  async resume(): Promise<void> {
    this.paused = false;
    await this.saveQueue();
    
    this.publishEvent({
      type: "queue-resumed",
      timestamp: formatCRTimestamp()
    });

    this.logger.info("TaskQueue", "队列已恢复");

    // 事件驱动调度：恢复后立即尝试调度
    this.tryScheduleAll();
  }

  /** 获取队列状态 */
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

  /** 订阅队列事件 */
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

  /** 获取任务 */
  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /** 更新任务状态 */
  updateTask(taskId: string, updates: Partial<TaskRecord>): Result<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err("E311_NOT_FOUND", `任务不存在: ${taskId}`);
    }

    Object.assign(task, updates);
    task.updated = formatCRTimestamp();

    return ok(undefined);
  }

  /** 停止调度器（事件驱动模式，保留接口兼容性） */
  stop(): void {
    this.logger.debug("TaskQueue", "调度器停止（事件驱动模式）");
  }

  /** 获取所有任务 */
  getAllTasks(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }

  /** 清理已完成的任务 */
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

      this.logger.info("TaskQueue", `清理了 ${tasksToRemove.length} 个已完成任务`);

      return ok(tasksToRemove.length);
    } catch (error) {
      this.logger.error("TaskQueue", "清理任务失败", error as Error);
      return err("E500_INTERNAL_ERROR", "清理任务失败", error);
    }
  }

  /** 清理所有已完成的任务 */
  async clearCompleted(): Promise<Result<number>> {
    // 清理所有已完成的任务
    return this.cleanupCompletedTasks(new Date());
  }

  /** 重试所有失败的任务 */
  async retryFailed(): Promise<Result<number>> {
    try {
      let retriedCount = 0;

      for (const task of this.tasks.values()) {
        if (task.state === "Failed") {
          // 重置任务状态
          task.state = "Pending";
          task.attempt = 0;
          task.errors = [];
          task.updated = formatCRTimestamp();
          retriedCount++;
        }
      }

      this.logger.info("TaskQueue", `重试了 ${retriedCount} 个失败任务`);

      return ok(retriedCount);
    } catch (error) {
      this.logger.error("TaskQueue", "重试任务失败", error as Error);
      return err("E500_INTERNAL_ERROR", "重试任务失败", error);
    }
  }

  // 私有方法

  /** 事件驱动调度 - 填满并发槽 */
  private tryScheduleAll(): void {
    if (this.isScheduling) {
      return;
    }
    this.isScheduling = true;
    try {
      const settings = this.settingsStore.getSettings();
      const concurrency = settings.concurrency;
      let scheduledCount = 0;

      // 循环调度直到填满并发槽
      while (this.processingTasks.size < concurrency) {
        const scheduled = this.scheduleOneTask();
        if (!scheduled) break;
        scheduledCount++;
      }

      if (scheduledCount > 0) {
        this.logger.debug("TaskQueue", "批量调度完成", {
          scheduledCount,
          processingCount: this.processingTasks.size,
          concurrency
        });
      }
    } finally {
      this.isScheduling = false;
    }
  }

  /** 调度单个任务 */
  private scheduleOneTask(): boolean {
    // 如果队列暂停，不调度新任务
    if (this.paused) {
      return false;
    }

    // 如果没有注入 TaskRunner，无法执行任务
    if (!this.taskRunner) {
      this.logger.warn("TaskQueue", "TaskRunner 未注入，无法执行任务");
      return false;
    }

    // 查找第一个 Pending 状态且可获取锁的任务
    for (const task of this.tasks.values()) {
      if (task.state === "Pending") {
        // 检查节点锁 + 类型锁：锁不可用则保持 Pending，等待下一次调度（非阻塞）
        const nodeLockKey = task.lockKey || task.nodeId;
        const acquiredNode = this.lockManager.tryAcquire(nodeLockKey);
        if (!acquiredNode) {
          continue;
        }

        const typeLockKey = task.typeLockKey;
        if (typeLockKey) {
          const acquiredType = this.lockManager.tryAcquire(typeLockKey);
          if (!acquiredType) {
            this.lockManager.release(nodeLockKey);
            continue;
          }
        }

        // 标记为处理中
        this.processingTasks.add(task.id);
        task.lockKey = nodeLockKey;

        // 更新任务状态
        const previousState = task.state;
        task.state = "Running";
        task.startedAt = formatCRTimestamp();
        task.updated = task.startedAt;

        // 发布事件
        this.publishEvent({
          type: "task-started",
          taskId: task.id,
          timestamp: task.startedAt
        });

        // Requirements 8.4: 记录任务状态变更日志
        this.logger.info("TaskQueue", `任务状态变更: ${task.id}`, {
          event: "TASK_STATE_CHANGE",
          taskId: task.id,
          previousState,
          newState: "Running",
          taskType: task.taskType,
          nodeId: task.nodeId
        });

        // 异步执行任务（不阻塞调度）
        this.executeTask(task).catch((error) => {
          this.logger.error("TaskQueue", `任务执行异常: ${task.id}`, error as Error);
        });

        return true;
      }
    }

    return false;
  }

  /** 执行任务 - 调用 TaskRunner 并处理结果 */
  private async executeTask(task: TaskRecord): Promise<void> {
    if (!this.taskRunner) {
      this.logger.error("TaskQueue", "TaskRunner 未注入", undefined, {
        taskId: task.id
      });
      // 即使 TaskRunner 未注入，也要清理任务状态
      this.handleTaskExecutionFailure(task, {
        code: "E310_INVALID_STATE",
        message: "TaskRunner 未注入"
      });
      return;
    }

    let timeoutHandle: NodeJS.Timeout | null = null;

    try {
      this.logger.debug("TaskQueue", `开始执行任务: ${task.id}`, {
        taskType: task.taskType,
        attempt: task.attempt + 1,
        nodeId: task.nodeId
      });

      const timeoutMs = this.settingsStore.getSettings().taskTimeoutMs || TaskQueue.DEFAULT_TASK_TIMEOUT_MS;
      let timedOut = false;
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.logger.warn("TaskQueue", `任务超时，触发自动取消: ${task.id}`, {
          taskId: task.id,
          timeoutMs
        });
        this.taskRunner?.abort(task.id);
      }, Math.max(1000, timeoutMs));

      // 调用 TaskRunner 执行任务
      const result = await this.taskRunner.run(task);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (timedOut && result.ok) {
        await this.handleTaskFailure(task, { code: "E201_PROVIDER_TIMEOUT", message: "任务执行超时" });
        return;
      }

      if (result.ok) {
        // Requirements 6.2: 任务成功，更新状态为 Completed
        await this.handleTaskSuccess(task, result.value);
      } else {
        // Requirements 6.2: 任务失败，根据重试策略处理
        await this.handleTaskFailure(task, result.error);
      }

    } catch (error) {
      // 捕获未预期的异常
      this.logger.error("TaskQueue", `任务执行异常: ${task.id}`, error as Error, {
        taskType: task.taskType,
        nodeId: task.nodeId
      });

      await this.handleTaskExecutionFailure(task, {
        code: "E500_INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /** 处理任务成功 */
  private async handleTaskSuccess(task: TaskRecord, taskResult: TaskResult): Promise<void> {
    const previousState = task.state;
    task.state = "Completed";
    task.completedAt = formatCRTimestamp();
    task.updated = task.completedAt;
    task.result = taskResult.data;
    
    // 将结果也写回 payload，方便旧代码读取
    if (taskResult.data !== undefined) {
      task.payload = {
        ...task.payload,
        result: taskResult.data
      };
    }

    // Requirements 8.4: 记录任务状态变更日志
    this.logger.info("TaskQueue", `任务状态变更: ${task.id}`, {
      event: "TASK_STATE_CHANGE",
      taskId: task.id,
      previousState,
      newState: "Completed",
      taskType: task.taskType,
      nodeId: task.nodeId
    });

    // 释放锁（必须先释放，再发布事件以便下游入队不被锁阻塞）
    this.releaseTaskLocks(task);

    // 发布完成事件
    this.publishEvent({
      type: "task-completed",
      taskId: task.id,
      timestamp: task.completedAt
    });

    // 从处理中集合移除
    this.processingTasks.delete(task.id);

    this.trimHistory();

    // 事件驱动调度：任务完成后立即尝试调度下一个
    this.tryScheduleAll();
  }

  /** 处理任务失败 - 根据错误类型决定是否重试 */
  private async handleTaskFailure(task: TaskRecord, error: { code: string; message: string }): Promise<void> {
    const previousState = task.state;
    task.attempt++;
    
    // 记录错误
    if (!task.errors) {
      task.errors = [];
    }
    task.errors.push({
      code: error.code,
      message: error.message,
      timestamp: formatCRTimestamp(),
      attempt: task.attempt
    });

    // Requirements 6.4: 使用 RetryHandler 分类错误并确定重试策略
    const errorClassification = this.retryHandler.classifyError(error.code);
    
    // 动态更新 maxAttempts（如果当前值小于分类建议的值）
    if (task.maxAttempts < errorClassification.maxAttempts) {
      task.maxAttempts = errorClassification.maxAttempts;
      this.logger.debug("TaskQueue", `更新任务最大重试次数: ${task.id}`, {
        taskId: task.id,
        errorCode: error.code,
        errorCategory: errorClassification.category,
        newMaxAttempts: task.maxAttempts
      });
    }

    // 检查是否需要重试
    const settings = this.settingsStore.getSettings();
    const shouldRetry = settings.autoRetry && 
                       errorClassification.retryable && 
                       task.attempt < task.maxAttempts;

    if (shouldRetry) {
      // Requirements 6.4: 重试 - 重置为 Pending 状态
      task.state = "Pending";
      task.updated = formatCRTimestamp();

      // Requirements 8.4: 记录任务状态变更日志（重试）
      this.logger.warn("TaskQueue", `任务状态变更: ${task.id}`, {
        event: "TASK_STATE_CHANGE",
        taskId: task.id,
        previousState,
        newState: "Pending",
        reason: "retry",
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        errorCode: error.code,
        errorMessage: error.message,
        errorCategory: errorClassification.category,
        retryStrategy: errorClassification.strategy
      });

      // 释放锁（重试时会重新获取）
      this.releaseTaskLocks(task);

      // 从处理中集合移除
      this.processingTasks.delete(task.id);
    } else {
      // Requirements 6.4: 不再重试 - 标记为 Failed
      task.state = "Failed";
      task.updated = formatCRTimestamp();

      const failureReason = !settings.autoRetry ? "autoRetry disabled" :
                           !errorClassification.retryable ? "non-retryable error" :
                           "max attempts reached";

      // Requirements 8.4: 记录任务状态变更日志（失败）
      this.logger.error("TaskQueue", `任务状态变更: ${task.id}`, undefined, {
        event: "TASK_STATE_CHANGE",
        taskId: task.id,
        previousState,
        newState: "Failed",
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        errorCode: error.code,
        errorMessage: error.message,
        errorCategory: errorClassification.category,
        failureReason
      });

      // 发布失败事件
      this.publishEvent({
        type: "task-failed",
        taskId: task.id,
        timestamp: task.updated
      });

      // 释放锁
      this.releaseTaskLocks(task);

      // 从处理中集合移除
      this.processingTasks.delete(task.id);
    }

    this.trimHistory();

    // 事件驱动调度：任务失败后立即尝试调度下一个
    this.tryScheduleAll();
  }

  /**
   * 处理任务执行异常（未预期的错误）
   */
  private async handleTaskExecutionFailure(task: TaskRecord, error: { code: string; message: string }): Promise<void> {
    const previousState = task.state;
    task.state = "Failed";
    task.updated = formatCRTimestamp();
    
    if (!task.errors) {
      task.errors = [];
    }
    task.errors.push({
      code: error.code,
      message: error.message,
      timestamp: formatCRTimestamp(),
      attempt: task.attempt
    });

    // Requirements 8.4: 记录任务状态变更日志（异常）
    this.logger.error("TaskQueue", `任务状态变更: ${task.id}`, undefined, {
      event: "TASK_STATE_CHANGE",
      taskId: task.id,
      previousState,
      newState: "Failed",
      reason: "exception",
      errorCode: error.code,
      errorMessage: error.message
    });

    // 释放锁
    this.releaseTaskLocks(task);

    // 从处理中集合移除
    this.processingTasks.delete(task.id);

    this.trimHistory();

    // 发布失败事件
    this.publishEvent({
      type: "task-failed",
      taskId: task.id,
      timestamp: task.updated
    });
  }

  /**
   * 释放任务持有的所有锁
   */
  private releaseTaskLocks(task: TaskRecord): void {
    if (task.lockKey) {
      this.lockManager.release(task.lockKey);
    }
    if (task.typeLockKey) {
      this.lockManager.release(task.typeLockKey);
    }
  }

  /**
   * 保存队列状态
   * 
   * 遵循 Requirements 2.2：入队成功后立即写入 queue-state.json
   * 
   * Phase 2.2：仅持久化最小队列状态（pendingTasks + paused）
   * 
   * 注意：此方法是异步的，但在 enqueue 中被调用时不会阻塞返回。
   * 这是为了保持同步 API，避免阻塞入队流程。
   * 写入操作会立即开始，但可能在 enqueue 返回后完成。
   */
  private saveQueue(): Promise<void> {
    const pendingTasks = Array.from(this.tasks.values())
      .filter((task) => task.state === "Pending" || task.state === "Running")
      .map((task) => ({
        id: task.id,
        nodeId: task.nodeId,
        taskType: task.taskType,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        providerRef: task.providerRef,
        promptRef: task.promptRef,
        payload: task.payload,
        created: task.created,
        updated: task.updated,
        errors: task.errors,
      }));

    const queueState: QueueStateFile = {
      version: "2.0.0",
      pendingTasks,
      paused: this.paused,
    };

    return this.queueStore.save(queueState);
  }

  /**
   * 获取最后持久化的内容（用于测试）
   * 
   * 注意：此方法仅用于测试目的，验证 Requirements 2.2
   */
  getLastPersistedContent(): string | null {
    return this.queueStore.getLastPersistedContent();
  }

  /**
   * 获取队列文件路径
   */
  getQueuePath(): string {
    return this.queueStore.getQueuePath();
  }

  /**
   * 从持久化文件恢复队列状态
   */
  private async restoreQueueState(queueState: QueueStateFile, migrated: boolean): Promise<void> {
    // 先清空内存状态
    this.tasks.clear();
    this.processingTasks.clear();

    // 恢复暂停状态；重启恢复时，为安全起见不自动调度 Pending
    this.paused = queueState.paused || queueState.pendingTasks.length > 0;

    const now = formatCRTimestamp();

    for (const persisted of queueState.pendingTasks) {
      const restoredTask: TaskRecord = {
        id: persisted.id,
        nodeId: persisted.nodeId,
        taskType: persisted.taskType,
        state: "Pending",
        attempt: persisted.attempt,
        maxAttempts: persisted.maxAttempts,
        providerRef: persisted.providerRef,
        promptRef: persisted.promptRef,
        payload: persisted.payload ?? {},
        created: persisted.created ?? now,
        updated: persisted.updated ?? now,
        errors: persisted.errors,
      };

      this.tasks.set(restoredTask.id, restoredTask);
    }

    // 启动时不保留任何锁
    this.lockManager.clear();

    this.logger.info("TaskQueue", "队列状态恢复成功", {
      taskCount: this.tasks.size,
      paused: this.paused,
      migrated
    });

    // 若检测到旧格式，立即落盘为最新结构以关闭分叉
    if (migrated) {
      await this.saveQueue();
    }
  }

  /**
   * 限制历史任务数量，避免 queue-state.json 无限增长
   */
  private trimHistory(): void {
    const limit = this.settingsStore.getSettings().maxTaskHistory || TaskQueue.DEFAULT_TASK_HISTORY_LIMIT;
    const removableStates = new Set(["Completed", "Failed", "Cancelled"]);
    const candidates = Array.from(this.tasks.values()).filter((task) => removableStates.has(task.state));

    if (candidates.length <= limit) {
      return;
    }

    candidates.sort((a, b) => {
      const aTime = a.updated || a.created;
      const bTime = b.updated || b.created;
      return aTime.localeCompare(bTime);
    });

    const removeCount = candidates.length - limit;
    const toRemove = candidates.slice(0, removeCount);

    for (const task of toRemove) {
      this.tasks.delete(task.id);
    }

    if (removeCount > 0) {
      this.logger.info("TaskQueue", "裁剪任务历史", {
        removed: removeCount,
        limit
      });
    }
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
  checkLockConflict(nodeId: string, _crType?: string): { lockKey: string; lockType: 'node' | 'type' } | null {
    // 检查节点锁
    if (this.lockManager.isLocked(nodeId)) {
      return { lockKey: nodeId, lockType: 'node' };
    }

    // 检查类型锁（可选）
    if (_crType) {
      const typeLockKey = `type:${_crType}`;
      if (this.lockManager.isLocked(typeLockKey)) {
        return { lockKey: typeLockKey, lockType: 'type' };
      }
    }

    return null;
  }
}
