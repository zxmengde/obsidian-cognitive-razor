/**
 * PipelineOrchestrator 属性测试
 * 
 * 使用 fast-check 进行属性测试，验证标准化绕过队列功能
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { PipelineOrchestrator } from "./pipeline-orchestrator";
import { 
  ITaskQueue,
  ITaskRunner,
  IDuplicateManager,
  ILogger,
  IFileStorage,
  IVectorIndex,
  IUndoManager,
  IPromptManager,
  IProviderManager,
  PluginSettings,
  StandardizedConcept,
  CRType,
  Result,
  ok,
  err
} from "../types";

// Mock Obsidian App type to avoid import issues in tests
interface MockApp {
  vault: {
    adapter: {
      exists: (path: string) => Promise<boolean>;
      mkdir: (path: string) => Promise<void>;
      write: (path: string, content: string) => Promise<void>;
      read: (path: string) => Promise<string>;
      remove: (path: string) => Promise<void>;
      rename: (oldPath: string, newPath: string) => Promise<void>;
    };
    getAbstractFileByPath: (path: string) => unknown;
  };
}

// ============================================================================
// Mock 工厂函数
// ============================================================================

const createMockApp = (): MockApp => {
  return {
    vault: {
      adapter: {
        exists: vi.fn().mockResolvedValue(false),
        mkdir: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue(""),
        remove: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined)
      },
      getAbstractFileByPath: vi.fn(() => null)
    }
  };
};

const createMockTaskQueue = (): ITaskQueue => ({
  enqueue: vi.fn(() => ok("task-id")),
  cancel: vi.fn(() => ok(true)),
  pause: vi.fn(),
  resume: vi.fn(),
  getStatus: vi.fn(() => ({ paused: false, pending: 0, running: 0, completed: 0, failed: 0 })),
  subscribe: vi.fn(() => () => {}),
  getTask: vi.fn(() => undefined)
});

const createMockTaskRunner = (): ITaskRunner => ({
  run: vi.fn(),
  abort: vi.fn()
});

const createMockDuplicateManager = (): IDuplicateManager => ({
  detect: vi.fn().mockResolvedValue(ok([])),
  getPendingPairs: vi.fn(() => []),
  updateStatus: vi.fn().mockResolvedValue(ok(undefined)),
  removePair: vi.fn().mockResolvedValue(ok(undefined)),
  markAsNonDuplicate: vi.fn().mockResolvedValue(ok(undefined)),
  startMerge: vi.fn().mockResolvedValue(ok("merge-id")),
  completeMerge: vi.fn().mockResolvedValue(ok(undefined)),
  subscribe: vi.fn(() => () => {})
});

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  getLogContent: vi.fn(() => ""),
  clear: vi.fn()
});

const createMockFileStorage = (): IFileStorage => ({
  read: vi.fn().mockResolvedValue(ok("{}")),
  write: vi.fn().mockResolvedValue(ok(undefined)),
  atomicWrite: vi.fn().mockResolvedValue(ok(undefined)),
  exists: vi.fn().mockResolvedValue(false),
  delete: vi.fn().mockResolvedValue(ok(undefined)),
  ensureDir: vi.fn().mockResolvedValue(ok(undefined)),
  initialize: vi.fn().mockResolvedValue(ok(undefined)),
  isInitialized: vi.fn(() => true)
});

const createMockVectorIndex = (): IVectorIndex => ({
  upsert: vi.fn().mockResolvedValue(ok(undefined)),
  delete: vi.fn().mockResolvedValue(ok(undefined)),
  search: vi.fn().mockResolvedValue(ok([])),
  getStats: vi.fn(() => ({ totalEntries: 0, byType: {} as Record<CRType, number>, lastUpdated: "" })),
  getEntry: vi.fn(() => undefined)
});

const createMockUndoManager = (): IUndoManager => ({
  initialize: vi.fn().mockResolvedValue(ok(undefined)),
  createSnapshot: vi.fn().mockResolvedValue(ok("snapshot-id")),
  restoreSnapshot: vi.fn().mockResolvedValue(ok({} as any)),
  restoreSnapshotToFile: vi.fn().mockResolvedValue(ok({} as any)),
  deleteSnapshot: vi.fn().mockResolvedValue(ok(undefined)),
  listSnapshots: vi.fn().mockResolvedValue(ok([])),
  cleanupExpiredSnapshots: vi.fn().mockResolvedValue(ok(0))
});

const createMockPromptManager = (): IPromptManager => ({
  build: vi.fn(() => ok("test prompt")),
  validateTemplate: vi.fn(() => ok(true)),
  getRequiredSlots: vi.fn(() => []),
  getOptionalSlots: vi.fn(() => []),
  resolveTemplateId: vi.fn(() => "test-template"),
  hasTemplate: vi.fn(() => true)
});

const createMockProviderManager = (): IProviderManager => ({
  chat: vi.fn(),
  embed: vi.fn(),
  checkAvailability: vi.fn(),
  clearAvailabilityCache: vi.fn(),
  getConfiguredProviders: vi.fn(() => []),
  setProvider: vi.fn(),
  removeProvider: vi.fn()
});

const createMockSettings = (): PluginSettings => ({
  version: "1.0.0",
  language: "zh",
  advancedMode: false,
  namingTemplate: "{{chinese}} ({{english}})",
  directoryScheme: {
    Domain: "1-领域",
    Issue: "2-议题",
    Theory: "3-理论",
    Entity: "4-实体",
    Mechanism: "5-机制"
  },
  similarityThreshold: 0.9,
  topK: 10,
  concurrency: 1,
  autoRetry: true,
  maxRetryAttempts: 3,
  maxSnapshots: 100,
  maxSnapshotAgeDays: 30,
  enableGrounding: false,
  providers: {
    "test-provider": {
      type: "openai",
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      defaultChatModel: "gpt-4o",
      defaultEmbedModel: "text-embedding-3-small",
      enabled: true
    }
  },
  defaultProviderId: "test-provider",
  taskModels: {
    standardizeClassify: { providerId: "test-provider", model: "gpt-4o", temperature: 0.3 },
    enrich: { providerId: "test-provider", model: "gpt-4o", temperature: 0.5 },
    embedding: { providerId: "test-provider", model: "text-embedding-3-small" },
    "reason:new": { providerId: "test-provider", model: "gpt-4o", temperature: 0.7 },
    "reason:incremental": { providerId: "test-provider", model: "gpt-4o", temperature: 0.7 },
    "reason:merge": { providerId: "test-provider", model: "gpt-4o", temperature: 0.5 },
    ground: { providerId: "test-provider", model: "gpt-4o", temperature: 0.3 }
  },
  logLevel: "debug"
});

// ============================================================================
// fast-check 生成器
// ============================================================================

// 生成随机用户输入
const userInputArb = fc.string({ minLength: 1, maxLength: 100 });

// 生成随机标准化概念
const standardizedConceptArb: fc.Arbitrary<StandardizedConcept> = fc.record({
  standardName: fc.record({
    chinese: fc.string({ minLength: 1, maxLength: 50 }),
    english: fc.string({ minLength: 1, maxLength: 50 })
  }),
  aliases: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
  typeConfidences: fc.record({
    Domain: fc.double({ min: 0, max: 1 }),
    Issue: fc.double({ min: 0, max: 1 }),
    Theory: fc.double({ min: 0, max: 1 }),
    Entity: fc.double({ min: 0, max: 1 }),
    Mechanism: fc.double({ min: 0, max: 1 })
  }),
  primaryType: fc.constantFrom("Domain", "Issue", "Theory", "Entity", "Mechanism") as fc.Arbitrary<CRType>,
  coreDefinition: fc.string({ minLength: 10, maxLength: 200 })
});

// ============================================================================
// 测试套件
// ============================================================================

describe("PipelineOrchestrator - Property Tests", () => {
  let orchestrator: PipelineOrchestrator;
  let mockTaskQueue: ITaskQueue;
  let mockProviderManager: IProviderManager;
  let mockPromptManager: IPromptManager;

  beforeEach(() => {
    // 重置所有 mock
    vi.clearAllMocks();

    // 创建 mock 依赖
    mockTaskQueue = createMockTaskQueue();
    mockProviderManager = createMockProviderManager();
    mockPromptManager = createMockPromptManager();

    // 创建 orchestrator 实例
    orchestrator = new PipelineOrchestrator({
      app: createMockApp() as any, // Cast to any to bypass type checking for mock
      taskQueue: mockTaskQueue,
      taskRunner: createMockTaskRunner(),
      duplicateManager: createMockDuplicateManager(),
      logger: createMockLogger(),
      fileStorage: createMockFileStorage(),
      vectorIndex: createMockVectorIndex(),
      undoManager: createMockUndoManager(),
      promptManager: mockPromptManager,
      providerManager: mockProviderManager,
      getSettings: createMockSettings
    });
  });

  /**
   * Feature: bug-fixes-v1, Property 5: Standardize Bypasses Queue
   * 
   * Validates: Requirements 4.1, 4.2
   * 
   * Property: For any "创建概念" initiation, the standardizeClassify operation 
   * SHALL complete and return results without any task being added to the Task Queue.
   */
  describe("Property 5: Standardize Bypasses Queue", () => {
    it("should call standardizeDirect without enqueuing any tasks", async () => {
      await fc.assert(
        fc.asyncProperty(userInputArb, async (userInput) => {
          // 准备：配置 mock 返回成功的标准化结果
          const mockStandardizedData: StandardizedConcept = {
            standardName: { chinese: "测试概念", english: "Test Concept" },
            aliases: ["别名1", "别名2"],
            typeConfidences: {
              Domain: 0.1,
              Issue: 0.2,
              Theory: 0.3,
              Entity: 0.8,
              Mechanism: 0.1
            },
            primaryType: "Entity",
            coreDefinition: "这是一个测试概念的核心定义"
          };

          const mockChatResponse = {
            content: JSON.stringify(mockStandardizedData),
            tokensUsed: 100,
            finishReason: "stop"
          };

          vi.mocked(mockProviderManager.chat).mockResolvedValue(ok(mockChatResponse));

          // 记录调用前的队列状态
          const enqueueCallsBefore = vi.mocked(mockTaskQueue.enqueue).mock.calls.length;

          // 执行：调用 standardizeDirect
          const result = await orchestrator.standardizeDirect(userInput);

          // 验证：应该成功返回结果
          expect(result.ok).toBe(true);

          // 验证：不应该有任何任务被加入队列
          const enqueueCallsAfter = vi.mocked(mockTaskQueue.enqueue).mock.calls.length;
          expect(enqueueCallsAfter).toBe(enqueueCallsBefore);

          // 验证：应该直接调用了 ProviderManager.chat
          expect(mockProviderManager.chat).toHaveBeenCalled();
        }),
        { numRuns: 100 } // 运行 100 次测试
      );
    });

    it("should return standardized data immediately without queue delay", async () => {
      await fc.assert(
        fc.asyncProperty(userInputArb, async (userInput) => {
          // 准备：配置 mock 返回成功的标准化结果
          const mockStandardizedData: StandardizedConcept = {
            standardName: { chinese: "概念", english: "Concept" },
            aliases: [],
            typeConfidences: {
              Domain: 0.2,
              Issue: 0.2,
              Theory: 0.2,
              Entity: 0.2,
              Mechanism: 0.2
            },
            primaryType: "Entity",
            coreDefinition: "核心定义"
          };

          vi.mocked(mockProviderManager.chat).mockResolvedValue(ok({
            content: JSON.stringify(mockStandardizedData),
            tokensUsed: 50,
            finishReason: "stop"
          }));

          // 执行：记录开始时间
          const startTime = Date.now();
          const result = await orchestrator.standardizeDirect(userInput);
          const elapsedTime = Date.now() - startTime;

          // 验证：应该立即返回（不超过 5 秒，考虑到 API 调用时间）
          expect(elapsedTime).toBeLessThan(5000);

          // 验证：结果应该包含标准化数据
          if (result.ok) {
            expect(result.value).toHaveProperty("standardName");
            expect(result.value).toHaveProperty("typeConfidences");
          }
        }),
        { numRuns: 50 }
      );
    });

    it("should handle API errors without affecting the task queue", async () => {
      await fc.assert(
        fc.asyncProperty(userInputArb, async (userInput) => {
          // 准备：配置 mock 返回 API 错误
          vi.mocked(mockProviderManager.chat).mockResolvedValue(
            err("E100", "API 调用失败")
          );

          // 记录调用前的队列状态
          const enqueueCallsBefore = vi.mocked(mockTaskQueue.enqueue).mock.calls.length;

          // 执行：调用 standardizeDirect
          const result = await orchestrator.standardizeDirect(userInput);

          // 验证：应该返回错误
          expect(result.ok).toBe(false);

          // 验证：即使失败，也不应该有任务被加入队列
          const enqueueCallsAfter = vi.mocked(mockTaskQueue.enqueue).mock.calls.length;
          expect(enqueueCallsAfter).toBe(enqueueCallsBefore);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * 额外测试：验证 startCreatePipelineWithStandardized 正确跳过标准化阶段
   */
  describe("startCreatePipelineWithStandardized", () => {
    it("should start pipeline from enrich stage, skipping standardize", () => {
      fc.assert(
        fc.property(standardizedConceptArb, (standardizedData) => {
          // 执行：使用已标准化数据启动管线
          const result = orchestrator.startCreatePipelineWithStandardized(
            standardizedData,
            standardizedData.primaryType
          );

          // 验证：应该成功返回管线 ID
          expect(result.ok).toBe(true);

          // 验证：应该只创建了 enrich 任务，没有 standardizeClassify 任务
          const enqueueCalls = vi.mocked(mockTaskQueue.enqueue).mock.calls;
          const lastCall = enqueueCalls[enqueueCalls.length - 1];
          
          if (lastCall) {
            const taskRecord = lastCall[0];
            expect(taskRecord.taskType).toBe("enrich");
            expect(taskRecord.taskType).not.toBe("standardizeClassify");
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
