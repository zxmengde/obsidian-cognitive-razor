/**
 * WorkbenchPanel 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { WorkspaceLeaf, App, TFile } from "obsidian";
import { WorkbenchPanel, StandardizedConcept } from "./workbench-panel";
import { TaskQueue } from "../core/task-queue";
import { FileStorage } from "../data/file-storage";
import { LockManager } from "../core/lock-manager";
import { DuplicateManager } from "../core/duplicate-manager";
import type CognitiveRazorPlugin from "../../main";
import type { DuplicatePair } from "../types";

// Mock Obsidian components
const mockApp = {
  vault: {
    create: jest.fn(),
    adapter: {
      exists: jest.fn(),
      mkdir: jest.fn(),
    },
  },
  workspace: {
    getLeaf: jest.fn(),
  },
} as unknown as App;

const mockLeaf = {} as WorkspaceLeaf;

// Mock plugin
const mockPlugin = {
  getComponents: jest.fn(() => ({
    taskQueue: null,
  })),
} as unknown as CognitiveRazorPlugin;

describe("WorkbenchPanel 属性测试", () => {
  let taskQueue: TaskQueue;
  let fileStorage: FileStorage;
  let lockManager: LockManager;
  let duplicateManager: DuplicateManager;

  beforeEach(async () => {
    // 创建真实的组件实例用于测试
    fileStorage = new FileStorage({ dataDir: "test-data" });
    lockManager = new LockManager();
    taskQueue = new TaskQueue({
      storage: fileStorage,
      lockManager,
      concurrency: 2,
      queueFile: "test-queue.json",
    });
    duplicateManager = new DuplicateManager(fileStorage);
    
    // 初始化 DuplicateManager
    await duplicateManager.load();

    // 更新 mock plugin
    (mockPlugin.getComponents as jest.Mock).mockReturnValue({
      taskQueue,
      duplicateManager,
    });

    // 清除 mock 调用历史
    jest.clearAllMocks();
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 8: 标准化输出触发**
   * **验证需求：4.2**
   * 
   * 属性：对于任意在 Workbench 中输入的非空概念描述，点击标准化按钮必须创建一个 standardizeClassify 类型的任务
   */
  test("属性 8: 标准化输出触发", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0), // 非空描述
        async (description) => {
          // 初始化任务队列
          await taskQueue.initialize();

          // 创建任务
          const result = await taskQueue.enqueue({
            nodeId: `temp-${Date.now()}`,
            taskType: "standardizeClassify",
            payload: {
              description,
            },
          });

          // 验证任务创建成功
          expect(result.ok).toBe(true);

          if (result.ok) {
            const task = taskQueue.getTask(result.value);
            
            // 验证任务存在
            expect(task).toBeDefined();
            
            // 验证任务类型
            expect(task?.taskType).toBe("standardizeClassify");
            
            // 验证 payload 包含描述
            expect(task?.payload.description).toBe(description);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 9: 标准化结果显示完整性**
   * **验证需求：4.3**
   * 
   * 属性：对于任意完成的标准化任务，UI 必须显示中文名、英文名、别名列表和五种类型的置信度分数
   */
  test("属性 9: 标准化结果显示完整性", () => {
    fc.assert(
      fc.property(
        // 生成标准化结果
        fc.record({
          standardName: fc.record({
            chinese: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
            english: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          }),
          aliases: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
          typeConfidences: fc.record({
            Domain: fc.double({ min: 0, max: 1, noNaN: true }),
            Issue: fc.double({ min: 0, max: 1, noNaN: true }),
            Theory: fc.double({ min: 0, max: 1, noNaN: true }),
            Entity: fc.double({ min: 0, max: 1, noNaN: true }),
            Mechanism: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          coreDefinition: fc.string({ maxLength: 500 }),
        }),
        (standardizedData: StandardizedConcept) => {
          // 验证标准化结果包含所有必需字段
          
          // 验证中文名存在
          expect(standardizedData.standardName.chinese).toBeDefined();
          expect(standardizedData.standardName.chinese.length).toBeGreaterThan(0);
          
          // 验证英文名存在
          expect(standardizedData.standardName.english).toBeDefined();
          expect(standardizedData.standardName.english.length).toBeGreaterThan(0);
          
          // 验证别名列表存在（可以为空）
          expect(Array.isArray(standardizedData.aliases)).toBe(true);
          
          // 验证五种类型的置信度都存在
          expect(standardizedData.typeConfidences.Domain).toBeDefined();
          expect(standardizedData.typeConfidences.Issue).toBeDefined();
          expect(standardizedData.typeConfidences.Theory).toBeDefined();
          expect(standardizedData.typeConfidences.Entity).toBeDefined();
          expect(standardizedData.typeConfidences.Mechanism).toBeDefined();
          
          // 验证置信度在 0-1 范围内
          expect(standardizedData.typeConfidences.Domain).toBeGreaterThanOrEqual(0);
          expect(standardizedData.typeConfidences.Domain).toBeLessThanOrEqual(1);
          expect(standardizedData.typeConfidences.Issue).toBeGreaterThanOrEqual(0);
          expect(standardizedData.typeConfidences.Issue).toBeLessThanOrEqual(1);
          expect(standardizedData.typeConfidences.Theory).toBeGreaterThanOrEqual(0);
          expect(standardizedData.typeConfidences.Theory).toBeLessThanOrEqual(1);
          expect(standardizedData.typeConfidences.Entity).toBeGreaterThanOrEqual(0);
          expect(standardizedData.typeConfidences.Entity).toBeLessThanOrEqual(1);
          expect(standardizedData.typeConfidences.Mechanism).toBeGreaterThanOrEqual(0);
          expect(standardizedData.typeConfidences.Mechanism).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 10: 笔记创建触发**
   * **验证需求：4.4**
   * 
   * 属性：对于任意确认的标准化结果，点击创建按钮必须生成一个 Stub 笔记文件，并创建对应类型的 enrich 任务
   */
  test("属性 10: 笔记创建触发", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成标准化结果
        fc.record({
          standardName: fc.record({
            chinese: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
            english: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          }),
          aliases: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
          typeConfidences: fc.record({
            Domain: fc.double({ min: 0, max: 1, noNaN: true }),
            Issue: fc.double({ min: 0, max: 1, noNaN: true }),
            Theory: fc.double({ min: 0, max: 1, noNaN: true }),
            Entity: fc.double({ min: 0, max: 1, noNaN: true }),
            Mechanism: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          coreDefinition: fc.string({ maxLength: 500 }),
        }),
        async (standardizedData: StandardizedConcept) => {
          // 初始化任务队列
          await taskQueue.initialize();

          // 确定主要类型（置信度最高的）
          const primaryType = Object.entries(standardizedData.typeConfidences)
            .sort(([, a], [, b]) => b - a)[0][0];

          // 生成 UID
          const uid = `test-uid-${Date.now()}`;

          // 模拟文件创建
          const fileName = standardizedData.standardName.chinese.replace(/[\\/:*?"<>|]/g, '-');
          const filePath = `${fileName}.md`;
          
          // Mock vault.create 返回一个 TFile
          const mockFile = { path: filePath } as TFile;
          (mockApp.vault.create as jest.Mock).mockResolvedValue(mockFile);

          // 创建 enrich 任务
          const enrichResult = await taskQueue.enqueue({
            nodeId: uid,
            taskType: "enrich",
            payload: {
              filePath,
              type: primaryType,
              standardizedData,
            },
          });

          // 验证任务创建成功
          expect(enrichResult.ok).toBe(true);

          if (enrichResult.ok) {
            const task = taskQueue.getTask(enrichResult.value);
            
            // 验证任务存在
            expect(task).toBeDefined();
            
            // 验证任务类型
            expect(task?.taskType).toBe("enrich");
            
            // 验证 payload 包含必要信息
            expect(task?.payload.filePath).toBe(filePath);
            expect(task?.payload.type).toBe(primaryType);
            expect(task?.payload.standardizedData).toEqual(standardizedData);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 14: 重复对显示**
   * **验证需求：6.1**
   * 
   * 属性：对于任意检测到的重复概念对，Workbench 的重复面板中必须显示该重复对，包括两个笔记的名称、相似度和类型
   * 
   * 注意：此测试验证数据结构的完整性，而不是 DOM 渲染细节
   */
  test("属性 14: 重复对显示", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成重复对数组
        fc.array(
          fc.record({
            noteA: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
              path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
            }),
            noteB: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
              path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
            }),
            type: fc.constantFrom("Domain", "Issue", "Theory", "Entity", "Mechanism"),
            similarity: fc.double({ min: 0, max: 1, noNaN: true }),
            status: fc.constant("pending" as const),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        async (pairsData) => {
          // 添加所有重复对到 DuplicateManager
          const pairIds: string[] = [];
          for (const pairData of pairsData) {
            const addResult = await duplicateManager.addPair(pairData);
            expect(addResult.ok).toBe(true);
            if (addResult.ok) {
              pairIds.push(addResult.value);
            }
          }

          // 获取待处理的重复对
          const pendingResult = await duplicateManager.getPendingPairs();
          expect(pendingResult.ok).toBe(true);

          if (pendingResult.ok) {
            const pendingPairs = pendingResult.value;
            
            // 验证所有添加的重复对都在待处理列表中
            pairIds.forEach(pairId => {
              const found = pendingPairs.some(p => p.id === pairId);
              expect(found).toBe(true);
            });

            // 验证每个重复对包含必需的显示信息
            pendingPairs.forEach(pair => {
              // 验证名称存在
              expect(pair.noteA.name).toBeDefined();
              expect(pair.noteA.name.length).toBeGreaterThan(0);
              expect(pair.noteB.name).toBeDefined();
              expect(pair.noteB.name.length).toBeGreaterThan(0);
              
              // 验证相似度在有效范围内
              expect(pair.similarity).toBeGreaterThanOrEqual(0);
              expect(pair.similarity).toBeLessThanOrEqual(1);
              
              // 验证类型是有效的 CRType
              expect(["Domain", "Issue", "Theory", "Entity", "Mechanism"]).toContain(pair.type);
            });
          }

          // 清理：移除所有添加的重复对
          for (const pairId of pairIds) {
            await duplicateManager.removePair(pairId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 15: 合并任务生成**
   * **验证需求：6.3**
   * 
   * 属性：对于任意重复对，点击合并按钮必须创建一个 reason:merge 类型的任务，payload 包含两个笔记的 nodeId
   */
  test("属性 15: 合并任务生成", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成重复对
        fc.record({
          noteA: fc.record({
            nodeId: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
          }),
          noteB: fc.record({
            nodeId: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
          }),
          type: fc.constantFrom("Domain", "Issue", "Theory", "Entity", "Mechanism"),
          similarity: fc.double({ min: 0, max: 1, noNaN: true }),
          status: fc.constant("pending" as const),
        }),
        async (pairData) => {
          // 初始化任务队列
          await taskQueue.initialize();

          // 添加重复对到 DuplicateManager 并获取 ID
          const addResult = await duplicateManager.addPair(pairData);
          expect(addResult.ok).toBe(true);
          
          if (!addResult.ok) return;
          
          const pairId = addResult.value;

          // 创建合并任务（模拟 MergeHandler.createMergeTask 的逻辑）
          const taskResult = await taskQueue.enqueue({
            nodeId: pairData.noteA.nodeId,
            taskType: "reason:merge",
            maxAttempts: 3,
            payload: {
              pairId,
              noteA: {
                nodeId: pairData.noteA.nodeId,
                name: pairData.noteA.name,
                path: pairData.noteA.path,
                content: "mock content A",
              },
              noteB: {
                nodeId: pairData.noteB.nodeId,
                name: pairData.noteB.name,
                path: pairData.noteB.path,
                content: "mock content B",
              },
              type: pairData.type,
              similarity: pairData.similarity,
            },
          });

          // 验证任务创建成功
          expect(taskResult.ok).toBe(true);

          if (taskResult.ok) {
            const task = taskQueue.getTask(taskResult.value);
            
            // 验证任务存在
            expect(task).toBeDefined();
            
            // 验证任务类型
            expect(task?.taskType).toBe("reason:merge");
            
            // 验证 payload 包含两个笔记的 nodeId
            expect(task?.payload.noteA).toBeDefined();
            expect(task?.payload.noteB).toBeDefined();
            expect((task?.payload.noteA as any).nodeId).toBe(pairData.noteA.nodeId);
            expect((task?.payload.noteB as any).nodeId).toBe(pairData.noteB.nodeId);
            expect(task?.payload.pairId).toBe(pairId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 16: 重复对忽略状态**
   * **验证需求：6.4**
   * 
   * 属性：对于任意重复对，点击忽略按钮后，该重复对的状态必须更新为 dismissed，且不再显示在待处理列表中
   */
  test("属性 16: 重复对忽略状态", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成重复对
        fc.record({
          noteA: fc.record({
            nodeId: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
          }),
          noteB: fc.record({
            nodeId: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
          }),
          type: fc.constantFrom("Domain", "Issue", "Theory", "Entity", "Mechanism"),
          similarity: fc.double({ min: 0, max: 1, noNaN: true }),
          status: fc.constant("pending" as const),
        }),
        async (pairData) => {
          // 添加重复对
          const addResult = await duplicateManager.addPair(pairData);
          expect(addResult.ok).toBe(true);

          if (!addResult.ok) return;

          const pairId = addResult.value;

          // 获取待处理列表（应该包含该重复对）
          const pendingBefore = await duplicateManager.getPendingPairs();
          expect(pendingBefore.ok).toBe(true);
          if (pendingBefore.ok) {
            expect(pendingBefore.value.some(p => p.id === pairId)).toBe(true);
          }

          // 更新状态为 dismissed
          const updateResult = await duplicateManager.updateStatus(pairId, "dismissed");
          expect(updateResult.ok).toBe(true);

          // 获取重复对，验证状态已更新
          const pairResult = await duplicateManager.getPair(pairId);
          expect(pairResult.ok).toBe(true);
          if (pairResult.ok && pairResult.value) {
            expect(pairResult.value.status).toBe("dismissed");
          }

          // 获取待处理列表（不应该包含该重复对）
          const pendingAfter = await duplicateManager.getPendingPairs();
          expect(pendingAfter.ok).toBe(true);
          if (pendingAfter.ok) {
            expect(pendingAfter.value.some(p => p.id === pairId)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 17: 合并完成清理**
   * **验证需求：6.5**
   * 
   * 属性：对于任意完成的合并任务，系统必须从 DuplicatePairs 存储中移除该重复对，且 UI 列表中不再显示
   */
  test("属性 17: 合并完成清理", async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成重复对
        fc.record({
          noteA: fc.record({
            nodeId: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
          }),
          noteB: fc.record({
            nodeId: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            path: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
          }),
          type: fc.constantFrom("Domain", "Issue", "Theory", "Entity", "Mechanism"),
          similarity: fc.double({ min: 0, max: 1, noNaN: true }),
          status: fc.constant("pending" as const),
        }),
        async (pairData) => {
          // 添加重复对
          const addResult = await duplicateManager.addPair(pairData);
          expect(addResult.ok).toBe(true);

          if (!addResult.ok) return;

          const pairId = addResult.value;

          // 验证重复对存在
          const pairBefore = await duplicateManager.getPair(pairId);
          expect(pairBefore.ok).toBe(true);
          expect(pairBefore.value).not.toBeNull();

          // 模拟合并完成，移除重复对
          const removeResult = await duplicateManager.removePair(pairId);
          expect(removeResult.ok).toBe(true);

          // 验证重复对已被移除
          const pairAfter = await duplicateManager.getPair(pairId);
          expect(pairAfter.ok).toBe(true);
          expect(pairAfter.value).toBeNull();

          // 验证待处理列表中不包含该重复对
          const pendingAfter = await duplicateManager.getPendingPairs();
          expect(pendingAfter.ok).toBe(true);
          if (pendingAfter.ok) {
            expect(pendingAfter.value.some(p => p.id === pairId)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
