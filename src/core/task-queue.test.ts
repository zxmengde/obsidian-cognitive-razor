/**
 * TaskQueue 属性测试
 * 
 * 使用 fast-check 进行属性测试，验证任务状态变更日志功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { TaskQueue } from "./task-queue";
import { 
  ILockManager, 
  IFileStorage, 
  ILogger, 
  ISettingsStore, 
  ITaskRunner,
  PluginSettings, 
  LogLevel,
  TaskRecord,
  Result,
  ok
} from "../types";

// 创建模拟的 LockManager
const createMockLockManager = (): ILockManager => ({
  acquire: vi.fn(() => ok("lock-key")),
  release: vi.fn(),
  isLocked: vi.fn(() => false),
  getActiveLocks: vi.fn(() => []),
  restoreLocks: vi.fn(),
  releaseByTaskId: vi.fn(),
  clear: vi.fn()
});

// 创建模拟的 FileStorage
const createMockFileStorage = (): IFileStorage => ({
  read: vi.fn().mockResolvedValue({ ok: true, value: "{}" }),
  write: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  atomicWrite: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  exists: vi.fn().mockResolvedValue(false),
  delete: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
  initialize: vi.fn().mockResolvedValue({ ok: true, value: undefined })
});

// 创建模拟的 SettingsStore
const createMockSettingsStore = (): ISettingsStore => {
  const settings: PluginSettings = {
    version: "1.0.0",
    language: "zh",
    advancedMode: false,
    providers: {},
    defaultProviderId: "",
    similarityThreshold: 0.9,
    topK: 10,
    concurrency: 1,
    autoRetry: true,
    maxRetryAttempts: 3,
    maxSnapshots: 100,
    maxSnapshotAgeDays: 30,
    enableGrounding: false,
    taskModels: {} as PluginSettings["taskModels"],
    logLevel: "debug" as LogLevel
  };

  return {
    getSettings: () => settings,
    updateSettings: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    loadSettings: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    saveSettings: vi.fn().mockResolvedValue({ ok: true, value: undefined })
  };
};

// 创建模拟的 Logger，记录所有日志调用
interface LogCall {
  level: string;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

const createMockLogger = (): ILogger & { calls: LogCall[] } => {
  const calls: LogCall[] = [];
  
  return {
    calls,
    debug: vi.fn((module: string, message: string, context?: Record<string, unknown>) => {
      calls.push({ level: "debug", module, message, context });
    }),
    info: vi.fn((module: string, message: string, context?: Record<string, unknown>) => {
      calls.push({ level: "info", module, message, context });
    }),
    warn: vi.fn((module: string, message: string, context?: Record<string, unknown>) => {
      calls.push({ level: "warn", module, message, context });
    }),
    error: vi.fn((module: string, message: string, error?: Error, context?: Record<string, unknown>) => {
      calls.push({ level: "error", module, message, context });
    }),
    errorWithCode: vi.fn(),
    withTiming: vi.fn(),
    timing: vi.fn(),
    setLogLevel: vi.fn(),
    getLogLevel: vi.fn(() => "debug" as LogLevel)
  };
};

// 创建模拟的 TaskRunner
const createMockTaskRunner = (shouldSucceed = true): ITaskRunner => ({
  run: vi.fn().mockResolvedValue(
    shouldSucceed 
      ? { ok: true, value: { data: { result: "success" } } }
      : { ok: false, error: { code: "E100", message: "Test error" } }
  )
});

// 生成有效的节点 ID
const nodeIdArb = fc.string({ minLength: 1, maxLength: 30 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && s.trim().length > 0);

// 生成有效的任务类型
const taskTypeArb = fc.constantFrom(
  "standardizeClassify",
  "enrich",
  "embedding",
  "reason:new",
  "ground"
);

describe("TaskQueue State Change Logging", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * **Feature: bug-fixes-v1, Property 13: Task State Change Logging**
   * **Validates: Requirements 8.4**
   * 
   * *For any* task state transition, a log entry SHALL exist containing 
   * the task ID, previous state, and new state.
   */
  it("Property 13: Task State Change Logging - enqueue logs state change to Pending", async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeIdArb,
        taskTypeArb,
        async (nodeId, taskType) => {
          const mockLogger = createMockLogger();
          const mockLockManager = createMockLockManager();
          const mockFileStorage = createMockFileStorage();
          const mockSettingsStore = createMockSettingsStore();

          const taskQueue = new TaskQueue(
            mockLockManager,
            mockFileStorage,
            mockLogger,
            mockSettingsStore
          );

          // 入队任务
          const result = taskQueue.enqueue({
            nodeId,
            taskType,
            pipelineId: "test-pipeline",
            payload: {},
            maxAttempts: 3,
            attempt: 0
          });

          expect(result.ok).toBe(true);

          // 验证存在 TASK_STATE_CHANGE 日志
          const stateChangeLogs = mockLogger.calls.filter(
            call => call.context?.event === "TASK_STATE_CHANGE"
          );

          expect(stateChangeLogs.length).toBeGreaterThanOrEqual(1);

          // 验证日志包含必要的字段
          const log = stateChangeLogs[0];
          expect(log.context).toHaveProperty("taskId");
          expect(log.context).toHaveProperty("previousState", null);
          expect(log.context).toHaveProperty("newState", "Pending");
          expect(log.context).toHaveProperty("nodeId", nodeId);
          expect(log.context).toHaveProperty("taskType", taskType);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: bug-fixes-v1, Property 13: Task State Change Logging**
   * **Validates: Requirements 8.4**
   * 
   * 验证取消任务时记录状态变更日志
   */
  it("Property 13: Task State Change Logging - cancel logs state change to Cancelled", async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeIdArb,
        taskTypeArb,
        async (nodeId, taskType) => {
          const mockLogger = createMockLogger();
          const mockLockManager = createMockLockManager();
          const mockFileStorage = createMockFileStorage();
          const mockSettingsStore = createMockSettingsStore();

          const taskQueue = new TaskQueue(
            mockLockManager,
            mockFileStorage,
            mockLogger,
            mockSettingsStore
          );

          // 入队任务
          const enqueueResult = taskQueue.enqueue({
            nodeId,
            taskType,
            pipelineId: "test-pipeline",
            payload: {},
            maxAttempts: 3,
            attempt: 0
          });

          expect(enqueueResult.ok).toBe(true);
          const taskId = enqueueResult.value;

          // 清空日志记录
          mockLogger.calls.length = 0;

          // 取消任务
          const cancelResult = taskQueue.cancel(taskId);
          expect(cancelResult.ok).toBe(true);

          // 验证存在 TASK_STATE_CHANGE 日志
          const stateChangeLogs = mockLogger.calls.filter(
            call => call.context?.event === "TASK_STATE_CHANGE"
          );

          expect(stateChangeLogs.length).toBeGreaterThanOrEqual(1);

          // 验证日志包含必要的字段
          const log = stateChangeLogs[0];
          expect(log.context).toHaveProperty("taskId", taskId);
          expect(log.context).toHaveProperty("previousState", "Pending");
          expect(log.context).toHaveProperty("newState", "Cancelled");
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: bug-fixes-v1, Property 13: Task State Change Logging**
   * **Validates: Requirements 8.4**
   * 
   * 验证任务执行完成时记录状态变更日志
   */
  it("Property 13: Task State Change Logging - task completion logs state change", async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeIdArb,
        taskTypeArb,
        async (nodeId, taskType) => {
          const mockLogger = createMockLogger();
          const mockLockManager = createMockLockManager();
          const mockFileStorage = createMockFileStorage();
          const mockSettingsStore = createMockSettingsStore();
          const mockTaskRunner = createMockTaskRunner(true);

          const taskQueue = new TaskQueue(
            mockLockManager,
            mockFileStorage,
            mockLogger,
            mockSettingsStore
          );

          // 注入 TaskRunner
          taskQueue.setTaskRunner(mockTaskRunner);

          // 初始化队列
          await taskQueue.initialize();

          // 入队任务
          const enqueueResult = taskQueue.enqueue({
            nodeId,
            taskType,
            pipelineId: "test-pipeline",
            payload: {},
            maxAttempts: 3,
            attempt: 0
          });

          expect(enqueueResult.ok).toBe(true);

          // 清空日志记录
          mockLogger.calls.length = 0;

          // 触发调度器（模拟时间流逝）
          await vi.advanceTimersByTimeAsync(2000);

          // 验证存在 TASK_STATE_CHANGE 日志（Pending -> Running）
          const runningLogs = mockLogger.calls.filter(
            call => call.context?.event === "TASK_STATE_CHANGE" &&
                    call.context?.newState === "Running"
          );

          expect(runningLogs.length).toBeGreaterThanOrEqual(1);

          // 验证 Running 日志包含必要的字段
          const runningLog = runningLogs[0];
          expect(runningLog.context).toHaveProperty("taskId");
          expect(runningLog.context).toHaveProperty("previousState", "Pending");
          expect(runningLog.context).toHaveProperty("newState", "Running");

          // 验证存在 TASK_STATE_CHANGE 日志（Running -> Completed）
          const completedLogs = mockLogger.calls.filter(
            call => call.context?.event === "TASK_STATE_CHANGE" &&
                    call.context?.newState === "Completed"
          );

          expect(completedLogs.length).toBeGreaterThanOrEqual(1);

          // 验证 Completed 日志包含必要的字段
          const completedLog = completedLogs[0];
          expect(completedLog.context).toHaveProperty("taskId");
          expect(completedLog.context).toHaveProperty("previousState", "Running");
          expect(completedLog.context).toHaveProperty("newState", "Completed");

          // 停止调度器
          taskQueue.stop();
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * **Feature: bug-fixes-v1, Property 13: Task State Change Logging**
   * **Validates: Requirements 8.4**
   * 
   * 验证任务失败时记录状态变更日志
   */
  it("Property 13: Task State Change Logging - task failure logs state change", async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeIdArb,
        taskTypeArb,
        async (nodeId, taskType) => {
          const mockLogger = createMockLogger();
          const mockLockManager = createMockLockManager();
          const mockFileStorage = createMockFileStorage();
          
          // 禁用自动重试
          const mockSettingsStore = createMockSettingsStore();
          const settings = mockSettingsStore.getSettings();
          settings.autoRetry = false;
          
          const mockTaskRunner = createMockTaskRunner(false);

          const taskQueue = new TaskQueue(
            mockLockManager,
            mockFileStorage,
            mockLogger,
            mockSettingsStore
          );

          // 注入 TaskRunner
          taskQueue.setTaskRunner(mockTaskRunner);

          // 初始化队列
          await taskQueue.initialize();

          // 入队任务
          const enqueueResult = taskQueue.enqueue({
            nodeId,
            taskType,
            pipelineId: "test-pipeline",
            payload: {},
            maxAttempts: 1,
            attempt: 0
          });

          expect(enqueueResult.ok).toBe(true);

          // 清空日志记录
          mockLogger.calls.length = 0;

          // 触发调度器
          await vi.advanceTimersByTimeAsync(2000);

          // 验证存在 TASK_STATE_CHANGE 日志（Running -> Failed）
          const failedLogs = mockLogger.calls.filter(
            call => call.context?.event === "TASK_STATE_CHANGE" &&
                    call.context?.newState === "Failed"
          );

          expect(failedLogs.length).toBeGreaterThanOrEqual(1);

          // 验证 Failed 日志包含必要的字段
          const failedLog = failedLogs[0];
          expect(failedLog.context).toHaveProperty("taskId");
          expect(failedLog.context).toHaveProperty("previousState", "Running");
          expect(failedLog.context).toHaveProperty("newState", "Failed");

          // 停止调度器
          taskQueue.stop();
        }
      ),
      { numRuns: 20 }
    );
  });
});
