/**
 * TaskQueue 组件
 * 负责任务入队、持久化、并发调度和状态管理
 * 验证需求：6.1, 6.3, 6.4
 */

import {
  Result,
  ok,
  err,
  TaskRecord,
  TaskState,
  TaskType,
  QueueStatus,
  QueueEvent,
  QueueEventType,
  QueueEventListener,
} from "../types";
import { FileStorage } from "../data/file-storage";
import { LockManager } from "./lock-manager";

/**
 * TaskQueue 配置
 */
export interface TaskQueueConfig {
  /** FileStorage 实例 */
  storage: FileStorage;
  /** LockManager 实例 */
  lockManager: LockManager;
  /** 最大并发任务数 */
  concurrency: number;
  /** 队列状态文件路径 */
  queueFile?: string;
}

/**
 * 任务创建参数
 */
export interface CreateTaskParams {
  /** 关联的节点 ID */
  nodeId: string;
  /** 任务类型 */
  taskType: TaskType;
  /** Provider 引用 */
  providerRef?: string;
  /** Prompt 引用 */
  promptRef?: string;
  /** 最大尝试次数 */
  maxAttempts?: number;
  /** 任务载荷数据 */
  payload?: Record<string, unknown>;
}

/**
 * TaskQueue 组件
 */
export class TaskQueue {
  private storage: FileStorage;
  private lockManager: LockManager;
  private concurrency: number;
  private queueFile: string;

  /** 所有任务 Map<taskId, TaskRecord> */
  private tasks: Map<string, TaskRecord>;
  /** 是否暂停 */
  private paused: boolean;
  /** 事件监听器 */
  private listeners: Set<QueueEventListener>;
  /** 运行中的任务数 */
  private runningCount: number;

  constructor(config: TaskQueueConfig) {
    this.storage = config.storage;
    this.lockManager = config.lockManager;
    this.concurrency = config.concurrency;
    this.queueFile = config.queueFile || "queue/tasks.json";

    this.tasks = new Map();
    this.paused = false;
    this.listeners = new Set();
    this.runningCount = 0;
  }

  /**
   * 初始化队列
   * 从持久化存储加载任务
   */
  async initialize(): Promise<Result<void>> {
    // 确保队列目录存在
    const queueDir = this.queueFile.substring(0, this.queueFile.lastIndexOf("/"));
    const dirResult = await this.storage.ensureDir(queueDir);
    if (!dirResult.ok) {
      return dirResult;
    }

    // 如果队列文件不存在，创建空队列
    const exists = await this.storage.exists(this.queueFile);
    if (!exists) {
      const initResult = await this.storage.writeJSON(this.queueFile, []);
      if (!initResult.ok) {
        return initResult;
      }
      return ok(undefined);
    }

    // 加载任务
    const loadResult = await this.loadTasks();
    if (!loadResult.ok) {
      return loadResult;
    }

    return ok(undefined);
  }

  /**
   * 入队任务
   */
  async enqueue(params: CreateTaskParams): Promise<Result<string>> {
    // 检查节点是否已被锁定
    if (this.lockManager.isNodeLocked(params.nodeId)) {
      const lock = this.lockManager.getNodeLock(params.nodeId);
      return err(
        "LOCK_CONFLICT",
        `节点 ${params.nodeId} 已被任务 ${lock?.taskId} 锁定`,
        { lock }
      );
    }

    // 生成任务 ID
    const taskId = this.generateTaskId();
    const timestamp = new Date().toISOString();

    // 创建任务记录
    const task: TaskRecord = {
      id: taskId,
      nodeId: params.nodeId,
      taskType: params.taskType,
      state: "Pending",
      providerRef: params.providerRef,
      promptRef: params.promptRef,
      attempt: 0,
      maxAttempts: params.maxAttempts || 3,
      payload: params.payload || {},
      created: timestamp,
      updated: timestamp,
    };

    // 添加到任务列表
    this.tasks.set(taskId, task);

    // 持久化
    const saveResult = await this.saveTasks();
    if (!saveResult.ok) {
      // 回滚
      this.tasks.delete(taskId);
      return err(
        "QUEUE_SAVE_ERROR",
        `保存队列失败: ${taskId}`,
        saveResult.error
      );
    }

    // 触发事件
    this.emitEvent({
      type: "task-added",
      taskId,
      timestamp: new Date().toISOString(),
    });

    return ok(taskId);
  }

  /**
   * 取消任务
   */
  async cancel(taskId: string): Promise<Result<boolean>> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err("TASK_NOT_FOUND", `任务不存在: ${taskId}`);
    }

    // 只能取消 Pending 或 Running 状态的任务
    if (task.state !== "Pending" && task.state !== "Running") {
      return err(
        "INVALID_STATE",
        `任务状态不允许取消: ${task.state}`,
        { task }
      );
    }

    // 如果任务正在运行，减少运行计数
    const wasRunning = task.state === "Running";

    // 更新任务状态
    task.state = "Cancelled";
    task.updated = new Date().toISOString();

    // 释放锁
    const releaseResult = this.lockManager.releaseAllLocksForTask(taskId);
    if (!releaseResult.ok) {
      // 记录错误但继续
      console.error(`释放任务锁失败: ${taskId}`, releaseResult.error);
    }

    // 持久化
    const saveResult = await this.saveTasks();
    if (!saveResult.ok) {
      return err(
        "QUEUE_SAVE_ERROR",
        `保存队列失败: ${taskId}`,
        saveResult.error
      );
    }

    // 如果任务之前正在运行，减少运行计数
    if (wasRunning) {
      this.runningCount = Math.max(0, this.runningCount - 1);
    }

    // 触发事件
    this.emitEvent({
      type: "task-cancelled",
      taskId,
      timestamp: new Date().toISOString(),
    });

    return ok(true);
  }

  /**
   * 暂停队列
   */
  pause(): void {
    this.paused = true;
    this.emitEvent({
      type: "queue-paused",
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 恢复队列
   */
  resume(): void {
    this.paused = false;
    this.emitEvent({
      type: "queue-resumed",
      timestamp: new Date().toISOString(),
    });
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
      failed,
    };
  }

  /**
   * 订阅队列事件
   * 返回取消订阅函数
   */
  subscribe(listener: QueueEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskRecord[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取指定状态的任务
   */
  getTasksByState(state: TaskState): TaskRecord[] {
    return Array.from(this.tasks.values()).filter((t) => t.state === state);
  }

  /**
   * 更新任务状态
   * 内部方法，供 TaskRunner 使用
   */
  async updateTaskState(
    taskId: string,
    state: TaskState,
    updates?: Partial<TaskRecord>
  ): Promise<Result<void>> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err("TASK_NOT_FOUND", `任务不存在: ${taskId}`);
    }

    // 更新状态
    const oldState = task.state;
    task.state = state;
    task.updated = new Date().toISOString();

    // 应用其他更新
    if (updates) {
      Object.assign(task, updates);
    }

    // 更新运行计数
    if (oldState !== "Running" && state === "Running") {
      this.runningCount++;
      task.startedAt = new Date().toISOString();
    } else if (oldState === "Running" && state !== "Running") {
      this.runningCount = Math.max(0, this.runningCount - 1);
      task.completedAt = new Date().toISOString();
    }

    // 持久化
    const saveResult = await this.saveTasks();
    if (!saveResult.ok) {
      return saveResult;
    }

    // 触发事件
    let eventType: QueueEventType;
    switch (state) {
      case "Running":
        eventType = "task-started";
        break;
      case "Completed":
        eventType = "task-completed";
        break;
      case "Failed":
        eventType = "task-failed";
        break;
      case "Cancelled":
        eventType = "task-cancelled";
        break;
      default:
        eventType = "task-added";
    }

    this.emitEvent({
      type: eventType,
      taskId,
      timestamp: new Date().toISOString(),
    });

    return ok(undefined);
  }

  /**
   * 清理已完成的任务
   * 删除指定时间之前完成的任务
   */
  async cleanupCompletedTasks(beforeDate: Date): Promise<Result<number>> {
    let cleanedCount = 0;

    for (const [taskId, task] of this.tasks.entries()) {
      if (
        (task.state === "Completed" || task.state === "Failed" || task.state === "Cancelled") &&
        task.completedAt &&
        new Date(task.completedAt) < beforeDate
      ) {
        this.tasks.delete(taskId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      const saveResult = await this.saveTasks();
      if (!saveResult.ok) {
        return saveResult;
      }
    }

    return ok(cleanedCount);
  }

  /**
   * 加载任务
   */
  private async loadTasks(): Promise<Result<void>> {
    const readResult = await this.storage.readJSON<TaskRecord[]>(this.queueFile);
    if (!readResult.ok) {
      return err(
        "QUEUE_LOAD_ERROR",
        "加载队列失败",
        readResult.error
      );
    }

    // 重建任务 Map
    this.tasks.clear();
    for (const task of readResult.value) {
      this.tasks.set(task.id, task);
      
      // 统计运行中的任务
      if (task.state === "Running") {
        this.runningCount++;
      }
    }

    return ok(undefined);
  }

  /**
   * 保存任务
   */
  private async saveTasks(): Promise<Result<void>> {
    const tasksArray = Array.from(this.tasks.values());
    const saveResult = await this.storage.writeJSON(this.queueFile, tasksArray);
    if (!saveResult.ok) {
      return err(
        "QUEUE_SAVE_ERROR",
        "保存队列失败",
        saveResult.error
      );
    }

    return ok(undefined);
  }

  /**
   * 触发事件
   */
  private emitEvent(event: QueueEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("队列事件监听器错误:", error);
      }
    }
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `task-${timestamp}-${random}`;
  }
}
