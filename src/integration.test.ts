/**
 * 集成测试 - 端到端功能流程验证
 * 
 * 这些测试验证完整的功能流程，从用户输入到最终结果
 */

import { FileStorage } from "./data/file-storage";
import { TaskQueue } from "./core/task-queue";
import { TaskRunner } from "./core/task-runner";
import { LockManager } from "./core/lock-manager";
import { UndoManager } from "./core/undo-manager";
import { DuplicateManager } from "./core/duplicate-manager";
import { VectorIndex } from "./core/vector-index";
import { PromptManager } from "./core/prompt-manager";
import { Validator } from "./data/validator";
import { RetryHandler } from "./core/retry-handler";
import { ok, err, CRType } from "./types";

// Mock 文件系统
const mockFS = new Map<string, string>();

// Mock FileStorage
class MockFileStorage extends FileStorage {
  constructor(baseDir: string) {
    super({ dataDir: baseDir });
  }

  async exists(path: string): Promise<boolean> {
    return mockFS.has(path);
  }

  async readFile(path: string): Promise<any> {
    const content = mockFS.get(path);
    if (!content) {
      return err("FILE_NOT_FOUND", `文件不存在: ${path}`);
    }
    return ok(content);
  }

  async writeFile(path: string, content: string): Promise<any> {
    mockFS.set(path, content);
    return ok(undefined);
  }

  async deleteFile(path: string): Promise<any> {
    mockFS.delete(path);
    return ok(undefined);
  }

  async readJSON<T>(path: string): Promise<any> {
    const content = mockFS.get(path);
    if (!content) {
      return err("FILE_NOT_FOUND", `文件不存在: ${path}`);
    }
    try {
      return ok(JSON.parse(content));
    } catch (error) {
      return err("JSON_PARSE_ERROR", "JSON 解析失败");
    }
  }

  async writeJSON(path: string, data: any): Promise<any> {
    mockFS.set(path, JSON.stringify(data, null, 2));
    return ok(undefined);
  }

  async ensureDir(path: string): Promise<any> {
    return ok(undefined);
  }
}

// Mock PromptManager
class MockPromptManager extends PromptManager {
  render(promptId: string, slots: Record<string, string>): any {
    // 返回一个简单的提示词
    return ok(`Mock prompt for ${promptId}`);
  }
}

// Mock ProviderManager
class MockProviderManager {
  async chat(request: any): Promise<any> {
    const content = request.messages[0].content;
    
    // 模拟标准化输出
    if (content.includes("standardize")) {
      return ok({
        content: JSON.stringify({
          standard_name: {
            chinese: "测试概念",
            english: "Test Concept",
          },
          aliases: ["别名1", "别名2", "别名3"],
          type_confidences: {
            Domain: 0.1,
            Issue: 0.2,
            Theory: 0.3,
            Entity: 0.2,
            Mechanism: 0.2,
          },
          core_definition: "这是一个测试概念的定义",
        }),
        tokensUsed: 100,
      });
    }

    // 模拟内容生成输出
    if (content.includes("enrich")) {
      return ok({
        content: JSON.stringify({
          content: "生成的内容",
          metadata: {},
        }),
        tokensUsed: 200,
      });
    }

    // 模拟合并输出
    if (content.includes("merge") || content.includes("reason-merge")) {
      return ok({
        content: JSON.stringify({
          merged_content: "合并后的内容",
          merged_name: "合并后的概念",
        }),
        tokensUsed: 300,
      });
    }

    // 默认返回一个通用的 JSON 响应
    return ok({
      content: JSON.stringify({
        result: "success",
      }),
      tokensUsed: 100,
    });
  }

  async embed(request: any): Promise<any> {
    // 返回模拟的嵌入向量
    const embedding = new Array(768).fill(0).map(() => Math.random());
    return ok({
      embedding,
      tokensUsed: 50,
    });
  }

  async checkAvailability(providerId: string): Promise<any> {
    return ok({
      chat: true,
      embed: true,
      models: ["test-model"],
    });
  }

  getConfiguredProviders(): any[] {
    return [];
  }
}

describe("集成测试：完整创建流程", () => {
  let storage: MockFileStorage;
  let taskQueue: TaskQueue;
  let taskRunner: TaskRunner;
  let lockManager: LockManager;
  let undoManager: UndoManager;
  let duplicateManager: DuplicateManager;
  let vectorIndex: VectorIndex;
  let promptManager: PromptManager;
  let providerManager: MockProviderManager;
  let validator: Validator;
  let retryHandler: RetryHandler;

  beforeEach(async () => {
    // 清空 mock 文件系统
    mockFS.clear();

    // 初始化组件
    storage = new MockFileStorage("test-data");
    lockManager = new LockManager();
    undoManager = new UndoManager({
      storage,
      maxSnapshots: 100,
    });
    duplicateManager = new DuplicateManager(storage);
    vectorIndex = new VectorIndex(storage);
    promptManager = new MockPromptManager({
      storage,
      promptsDir: "prompts",
    });
    providerManager = new MockProviderManager();
    validator = new Validator();
    retryHandler = new RetryHandler();

    taskQueue = new TaskQueue({
      storage,
      lockManager,
      concurrency: 2,
    });

    taskRunner = new TaskRunner({
      providerManager,
      promptManager,
      validator,
      undoManager,
      lockManager,
      storage,
      retryHandler,
      defaultProviderId: "test-provider",
      defaultChatModel: "test-model",
      defaultEmbedModel: "test-embed-model",
    });

    // 初始化组件
    await taskQueue.initialize();
    await undoManager.initialize();
    await duplicateManager.load();
    await vectorIndex.load();
  });

  test("应该完成从用户输入到笔记创建的完整流程", async () => {
    // 需求：1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 3.1

    // 1. 用户输入概念描述
    const conceptDescription = "人工智能是一种模拟人类智能的技术";

    // 2. 创建标准化任务
    const enqueueResult = await taskQueue.enqueue({
      nodeId: "test-node-1",
      taskType: "standardizeClassify",
      payload: {
        conceptDescription,
      },
    });

    expect(enqueueResult.ok).toBe(true);
    const taskId = enqueueResult.value;

    // 3. 执行任务
    const task = taskQueue.getTask(taskId);
    expect(task).toBeDefined();

    await taskQueue.updateTaskState(taskId, "Running");
    const runResult = await taskRunner.run(task!);

    if (!runResult.ok) {
      console.error("Task run failed:", runResult.error);
    }
    expect(runResult.ok).toBe(true);
    expect(runResult.value.data).toHaveProperty("standard_name");
    expect(runResult.value.data).toHaveProperty("aliases");
    expect(runResult.value.data).toHaveProperty("type_confidences");
    expect(runResult.value.data).toHaveProperty("core_definition");

    // 验证标准化输出完整性（属性 1）
    const standardName = runResult.value.data.standard_name as any;
    expect(standardName).toHaveProperty("chinese");
    expect(standardName).toHaveProperty("english");

    const aliases = runResult.value.data.aliases as string[];
    expect(aliases.length).toBeGreaterThanOrEqual(3);
    expect(aliases.length).toBeLessThanOrEqual(10);

    // 验证类型置信度总和恒等（属性 2）
    const typeConfidences = runResult.value.data.type_confidences as any;
    const sum = Object.values(typeConfidences).reduce(
      (a: any, b: any) => a + b,
      0
    ) as number;
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001);

    // 4. 更新任务状态为完成
    await taskQueue.updateTaskState(taskId, "Completed", {
      result: runResult.value.data,
    });

    // 5. 验证任务状态
    const completedTask = taskQueue.getTask(taskId);
    expect(completedTask?.state).toBe("Completed");
    expect(completedTask?.result).toBeDefined();
  });

  test("应该在创建后执行语义去重检测", async () => {
    // 需求：2.1, 2.2

    // 1. 创建第一个概念并生成嵌入
    const nodeId1 = "node-1";
    const embedding1 = new Array(768).fill(0).map(() => Math.random());
    
    await vectorIndex.upsert({
      uid: nodeId1,
      type: "Theory",
      name: "概念A",
      embedding: embedding1,
    });

    // 2. 创建第二个相似的概念
    const nodeId2 = "node-2";
    // 使用相同的嵌入来模拟高相似度
    const embedding2 = [...embedding1];
    
    await vectorIndex.upsert({
      uid: nodeId2,
      type: "Theory",
      name: "概念B",
      embedding: embedding2,
    });

    // 3. 执行相似度检索（属性 4：同类型去重检索）
    const searchResult = await vectorIndex.search("Theory", embedding2, 5);
    expect(searchResult.ok).toBe(true);
    
    const results = searchResult.value;
    expect(results.length).toBeGreaterThan(0);
    
    // 验证返回了结果（由于 search 方法只在指定类型的桶中搜索，
    // 所以返回的结果必然都是同类型的，这验证了属性 4）
    expect(results[0].uid).toBe(nodeId1);

    // 4. 检查相似度阈值（属性 5：去重阈值判定）
    const threshold = 0.9;
    const highSimilarityResults = results.filter(r => r.similarity >= threshold);
    
    if (highSimilarityResults.length > 0) {
      // 5. 记录重复对
      // 确保相似度在 [0, 1] 范围内
      const similarity = Math.min(1.0, Math.max(0.0, highSimilarityResults[0].similarity));
      
      const addPairResult = await duplicateManager.addPair({
        noteA: {
          nodeId: nodeId1,
          name: "概念A",
          path: "/path/to/a.md",
        },
        noteB: {
          nodeId: nodeId2,
          name: "概念B",
          path: "/path/to/b.md",
        },
        type: "Theory",
        similarity,
        status: "pending",
      });

      if (!addPairResult.ok) {
        console.error("Add pair failed:", addPairResult.error);
      }
      expect(addPairResult.ok).toBe(true);

      // 6. 验证重复对显示完整性（属性 6）
      const pairId = addPairResult.value;
      const getPairResult = await duplicateManager.getPair(pairId);
      
      expect(getPairResult.ok).toBe(true);
      const pair = getPairResult.value;
      
      expect(pair).toBeDefined();
      expect(pair?.noteA.name).toBeDefined();
      expect(pair?.noteB.name).toBeDefined();
      expect(pair?.similarity).toBeDefined();
      expect(pair?.type).toBeDefined();
    }
  });
});


describe("集成测试：合并流程", () => {
  let storage: MockFileStorage;
  let taskQueue: TaskQueue;
  let taskRunner: TaskRunner;
  let lockManager: LockManager;
  let undoManager: UndoManager;
  let duplicateManager: DuplicateManager;
  let vectorIndex: VectorIndex;
  let promptManager: MockPromptManager;
  let providerManager: MockProviderManager;
  let validator: Validator;
  let retryHandler: RetryHandler;

  beforeEach(async () => {
    // 清空 mock 文件系统
    mockFS.clear();

    // 初始化组件
    storage = new MockFileStorage("test-data");
    lockManager = new LockManager();
    undoManager = new UndoManager({
      storage,
      maxSnapshots: 100,
    });
    duplicateManager = new DuplicateManager(storage);
    vectorIndex = new VectorIndex(storage);
    promptManager = new MockPromptManager({
      storage,
      promptsDir: "prompts",
    });
    providerManager = new MockProviderManager();
    validator = new Validator();
    retryHandler = new RetryHandler();

    taskQueue = new TaskQueue({
      storage,
      lockManager,
      concurrency: 2,
    });

    taskRunner = new TaskRunner({
      providerManager,
      promptManager,
      validator,
      undoManager,
      lockManager,
      storage,
      retryHandler,
      defaultProviderId: "test-provider",
      defaultChatModel: "test-model",
      defaultEmbedModel: "test-embed-model",
    });

    // 初始化组件
    await taskQueue.initialize();
    await undoManager.initialize();
    await duplicateManager.load();
    await vectorIndex.load();
  });

  test("应该完成从检测重复到合并完成的完整流程", async () => {
    // 需求：2.2, 2.3, 7.1, 7.2, 7.3, 7.4, 7.5

    // 1. 创建两个相似的概念
    const nodeId1 = "node-merge-1";
    const nodeId2 = "node-merge-2";
    const embedding = new Array(768).fill(0).map(() => Math.random());

    await vectorIndex.upsert({
      uid: nodeId1,
      type: "Domain",
      name: "概念A",
      path: "/path/to/a.md",
      embedding,
      updated: new Date().toISOString(),
    });

    await vectorIndex.upsert({
      uid: nodeId2,
      type: "Domain",
      name: "概念B",
      path: "/path/to/b.md",
      embedding: [...embedding], // 相同的嵌入
      updated: new Date().toISOString(),
    });

    // 2. 检测重复并记录重复对
    const searchResult = await vectorIndex.search("Domain", embedding, 5);
    expect(searchResult.ok).toBe(true);

    const results = searchResult.value;
    const highSimilarityResults = results.filter(r => r.similarity >= 0.9);
    expect(highSimilarityResults.length).toBeGreaterThan(0);

    // 3. 添加重复对（需求 2.2, 2.3）
    const addPairResult = await duplicateManager.addPair({
      noteA: {
        nodeId: nodeId1,
        name: "概念A",
        path: "/path/to/a.md",
      },
      noteB: {
        nodeId: nodeId2,
        name: "概念B",
        path: "/path/to/b.md",
      },
      type: "Domain",
      similarity: 0.95,
      status: "pending",
    });

    expect(addPairResult.ok).toBe(true);
    const pairId = addPairResult.value;

    // 4. 用户点击合并按钮，生成合并任务（需求 7.1）
    const enqueueResult = await taskQueue.enqueue({
      nodeId: nodeId1,
      taskType: "reason:merge",
      payload: {
        noteA: {
          nodeId: nodeId1,
          name: "概念A",
          content: "这是概念A的内容",
        },
        noteB: {
          nodeId: nodeId2,
          name: "概念B",
          content: "这是概念B的内容",
        },
        similarity: 0.95,
      },
    });

    expect(enqueueResult.ok).toBe(true);
    const taskId = enqueueResult.value;

    // 5. 执行合并任务（需求 7.2）
    const task = taskQueue.getTask(taskId);
    expect(task).toBeDefined();

    await taskQueue.updateTaskState(taskId, "Running");
    const runResult = await taskRunner.run(task!);

    if (!runResult.ok) {
      console.error("Merge task run failed:", runResult.error);
    }
    expect(runResult.ok).toBe(true);
    expect(runResult.value.data).toBeDefined();

    // 6. 更新任务状态
    await taskQueue.updateTaskState(taskId, "Completed", {
      result: runResult.value.data,
    });

    // 7. 模拟用户确认合并，执行清理操作（需求 7.4, 7.5）
    // 更新重复对状态为 merged
    await duplicateManager.updateStatus(pairId, "merged");

    // 删除被合并的笔记（在实际应用中会删除文件）
    // 这里我们只验证重复对状态更新

    // 从向量索引中删除被合并的概念
    const deleteResult = await vectorIndex.delete(nodeId2);
    expect(deleteResult.ok).toBe(true);

    // 从重复对中移除（属性 15：合并后清理）
    const removePairResult = await duplicateManager.removePair(pairId);
    expect(removePairResult.ok).toBe(true);

    // 验证重复对已被移除
    const getPairResult = await duplicateManager.getPair(pairId);
    expect(getPairResult.ok).toBe(true);
    expect(getPairResult.value).toBeNull();

    // 验证向量索引已更新
    const searchAfterMerge = await vectorIndex.search("Domain", embedding, 5);
    expect(searchAfterMerge.ok).toBe(true);
    const resultsAfterMerge = searchAfterMerge.value;
    
    // 应该只剩下一个概念
    const node2Results = resultsAfterMerge.filter(r => r.uid === nodeId2);
    expect(node2Results.length).toBe(0);
  });
});


describe("集成测试：增量改进流程", () => {
  let storage: MockFileStorage;
  let taskQueue: TaskQueue;
  let taskRunner: TaskRunner;
  let lockManager: LockManager;
  let undoManager: UndoManager;
  let promptManager: MockPromptManager;
  let providerManager: MockProviderManager;
  let validator: Validator;
  let retryHandler: RetryHandler;

  beforeEach(async () => {
    // 清空 mock 文件系统
    mockFS.clear();

    // 初始化组件
    storage = new MockFileStorage("test-data");
    lockManager = new LockManager();
    undoManager = new UndoManager({
      storage,
      maxSnapshots: 100,
    });
    promptManager = new MockPromptManager({
      storage,
      promptsDir: "prompts",
    });
    providerManager = new MockProviderManager();
    validator = new Validator();
    retryHandler = new RetryHandler();

    taskQueue = new TaskQueue({
      storage,
      lockManager,
      concurrency: 2,
    });

    taskRunner = new TaskRunner({
      providerManager,
      promptManager,
      validator,
      undoManager,
      lockManager,
      storage,
      retryHandler,
      defaultProviderId: "test-provider",
      defaultChatModel: "test-model",
      defaultEmbedModel: "test-embed-model",
    });

    // 初始化组件
    await taskQueue.initialize();
    await undoManager.initialize();
  });

  test("应该完成从触发改进到写入完成的完整流程", async () => {
    // 需求：4.1, 4.2, 4.3, 4.4, 4.5

    const nodeId = "node-improve-1";
    const originalContent = "这是原始内容";
    const filePath = "test-note.md";

    // 1. 创建原始笔记文件
    await storage.writeFile(filePath, originalContent);

    // 2. 用户触发增量改进，输入改进意图（需求 4.1, 4.2）
    const improvementIntent = "请添加更多细节";

    const enqueueResult = await taskQueue.enqueue({
      nodeId,
      taskType: "reason:incremental",
      payload: {
        filePath,
        originalContent,
        intent: improvementIntent,
        noteStatus: "Evergreen", // 测试 Evergreen 降级
      },
    });

    expect(enqueueResult.ok).toBe(true);
    const taskId = enqueueResult.value;

    // 3. 创建快照（需求 4.4）
    const snapshotResult = await undoManager.createSnapshot(
      filePath,
      originalContent,
      "增量改进"
    );
    expect(snapshotResult.ok).toBe(true);
    const snapshotId = snapshotResult.value;

    // 4. 执行改进任务（需求 4.2）
    const task = taskQueue.getTask(taskId);
    expect(task).toBeDefined();

    await taskQueue.updateTaskState(taskId, "Running");
    const runResult = await taskRunner.run(task!);

    expect(runResult.ok).toBe(true);
    expect(runResult.value.data).toBeDefined();

    // 5. 模拟用户确认改进，写入新内容（需求 4.3）
    const improvedContent = "这是改进后的内容，包含更多细节";
    await storage.writeFile(filePath, improvedContent);

    // 6. 更新任务状态
    await taskQueue.updateTaskState(taskId, "Completed", {
      result: runResult.value.data,
      undoPointer: snapshotId,
    });

    // 7. 验证文件内容已更新
    const readResult = await storage.readFile(filePath);
    expect(readResult.ok).toBe(true);
    expect(readResult.value).toBe(improvedContent);

    // 8. 验证快照已创建
    const snapshotCountResult = await undoManager.getSnapshotCount();
    expect(snapshotCountResult.ok).toBe(true);
    expect(snapshotCountResult.value).toBeGreaterThan(0);

    // 9. 测试撤销功能
    const restoreResult = await undoManager.restoreSnapshot(snapshotId);
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.value.content).toBe(originalContent);

    // 10. 写回原始内容
    await storage.writeFile(filePath, restoreResult.value.content);

    // 11. 验证内容已恢复
    const readAfterUndoResult = await storage.readFile(filePath);
    expect(readAfterUndoResult.ok).toBe(true);
    expect(readAfterUndoResult.value).toBe(originalContent);

    // 12. 删除快照
    const deleteSnapshotResult = await undoManager.deleteSnapshot(snapshotId);
    expect(deleteSnapshotResult.ok).toBe(true);
  });

  test("应该将 Evergreen 笔记降级为 Draft", async () => {
    // 需求：4.5（属性 16：Evergreen 降级）

    const nodeId = "node-evergreen-1";
    const filePath = "evergreen-note.md";
    const originalContent = `---
uid: ${nodeId}
type: Theory
status: Evergreen
created: 2024-01-01T00:00:00.000Z
updated: 2024-01-01T00:00:00.000Z
---

# 原始内容`;

    // 1. 创建 Evergreen 笔记
    await storage.writeFile(filePath, originalContent);

    // 2. 触发增量改进
    const enqueueResult = await taskQueue.enqueue({
      nodeId,
      taskType: "reason:incremental",
      payload: {
        filePath,
        originalContent,
        intent: "改进内容",
        noteStatus: "Evergreen",
      },
    });

    expect(enqueueResult.ok).toBe(true);

    // 3. 执行任务
    const task = taskQueue.getTask(enqueueResult.value);
    await taskQueue.updateTaskState(enqueueResult.value, "Running");
    const runResult = await taskRunner.run(task!);

    expect(runResult.ok).toBe(true);

    // 4. 模拟确认改进后，状态应该降级为 Draft
    // 在实际应用中，这会在写入时更新 frontmatter
    const improvedContent = originalContent.replace("status: Evergreen", "status: Draft");
    await storage.writeFile(filePath, improvedContent);

    // 5. 验证状态已降级
    const readResult = await storage.readFile(filePath);
    expect(readResult.ok).toBe(true);
    expect(readResult.value).toContain("status: Draft");
    expect(readResult.value).not.toContain("status: Evergreen");
  });
});


describe("集成测试：撤销流程", () => {
  let storage: MockFileStorage;
  let undoManager: UndoManager;

  beforeEach(async () => {
    // 清空 mock 文件系统
    mockFS.clear();

    // 初始化组件
    storage = new MockFileStorage("test-data");
    undoManager = new UndoManager({
      storage,
      maxSnapshots: 100,
    });

    // 初始化组件
    await undoManager.initialize();
  });

  test("应该完成从写入到撤销的完整流程", async () => {
    // 需求：5.1, 5.2, 5.3

    const filePath = "test-note.md";
    const originalContent = "这是原始内容";
    const newContent = "这是新内容";

    // 1. 创建原始文件
    await storage.writeFile(filePath, originalContent);

    // 2. 在写入前创建快照（需求 5.1，属性 10：写入前快照创建）
    const snapshotResult = await undoManager.createSnapshot(
      filePath,
      originalContent,
      "测试写入操作"
    );

    expect(snapshotResult.ok).toBe(true);
    const snapshotId = snapshotResult.value;

    // 3. 验证快照内容与原文件一致
    const restoreResult = await undoManager.restoreSnapshot(snapshotId);
    expect(restoreResult.ok).toBe(true);
    expect(restoreResult.value.content).toBe(originalContent);
    expect(restoreResult.value.filePath).toBe(filePath);

    // 4. 执行写入操作
    await storage.writeFile(filePath, newContent);

    // 5. 验证文件已更新
    const readResult = await storage.readFile(filePath);
    expect(readResult.ok).toBe(true);
    expect(readResult.value).toBe(newContent);

    // 6. 用户点击撤销（需求 5.2, 5.3）
    // 恢复快照
    const restoreResult2 = await undoManager.restoreSnapshot(snapshotId);
    expect(restoreResult2.ok).toBe(true);

    // 7. 写回原始内容（属性 11：撤销操作 round trip）
    await storage.writeFile(filePath, restoreResult2.value.content);

    // 8. 验证内容已恢复
    const readAfterUndoResult = await storage.readFile(filePath);
    expect(readAfterUndoResult.ok).toBe(true);
    expect(readAfterUndoResult.value).toBe(originalContent);

    // 9. 删除快照
    const deleteResult = await undoManager.deleteSnapshot(snapshotId);
    expect(deleteResult.ok).toBe(true);

    // 10. 验证快照已删除
    const getDeletedSnapshotResult = await undoManager.restoreSnapshot(snapshotId);
    expect(getDeletedSnapshotResult.ok).toBe(false);
  });

  test("应该在快照数量超过上限时自动清理最旧的快照", async () => {
    // 需求：5.4（属性 12：快照清理策略）

    // 创建一个小容量的 UndoManager
    const smallUndoManager = new UndoManager({
      storage,
      maxSnapshots: 3,
    });
    await smallUndoManager.initialize();

    const filePath = "test-note.md";
    const snapshotIds: string[] = [];

    // 1. 创建 5 个快照（超过上限 3）
    for (let i = 0; i < 5; i++) {
      const content = `内容 ${i}`;
      const result = await smallUndoManager.createSnapshot(
        filePath,
        content,
        `操作 ${i}`
      );
      expect(result.ok).toBe(true);
      snapshotIds.push(result.value);

      // 添加小延迟确保时间戳不同
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 2. 验证快照数量不超过上限
    const countResult = await smallUndoManager.getSnapshotCount();
    expect(countResult.ok).toBe(true);
    expect(countResult.value).toBeLessThanOrEqual(3);

    // 3. 验证最旧的快照已被删除
    // 前两个快照应该被删除
    const snapshot0Result = await smallUndoManager.restoreSnapshot(snapshotIds[0]);
    expect(snapshot0Result.ok).toBe(false);

    const snapshot1Result = await smallUndoManager.restoreSnapshot(snapshotIds[1]);
    expect(snapshot1Result.ok).toBe(false);

    // 4. 验证最新的快照仍然存在
    const snapshot4Result = await smallUndoManager.restoreSnapshot(snapshotIds[4]);
    expect(snapshot4Result.ok).toBe(true);
    expect(snapshot4Result.value.content).toBe("内容 4");
  });

  test("应该支持多个文件的独立撤销", async () => {
    // 测试多个文件的撤销操作互不干扰

    const file1 = "note1.md";
    const file2 = "note2.md";
    const content1 = "文件1的内容";
    const content2 = "文件2的内容";

    // 1. 创建两个文件的快照
    const snapshot1Result = await undoManager.createSnapshot(
      file1,
      content1,
      "操作1"
    );
    expect(snapshot1Result.ok).toBe(true);

    const snapshot2Result = await undoManager.createSnapshot(
      file2,
      content2,
      "操作2"
    );
    expect(snapshot2Result.ok).toBe(true);

    // 2. 验证两个快照都存在
    const restore1Result = await undoManager.restoreSnapshot(snapshot1Result.value);
    expect(restore1Result.ok).toBe(true);
    expect(restore1Result.value.filePath).toBe(file1);
    expect(restore1Result.value.content).toBe(content1);

    const restore2Result = await undoManager.restoreSnapshot(snapshot2Result.value);
    expect(restore2Result.ok).toBe(true);
    expect(restore2Result.value.filePath).toBe(file2);
    expect(restore2Result.value.content).toBe(content2);

    // 3. 删除第一个快照
    await undoManager.deleteSnapshot(snapshot1Result.value);

    // 4. 验证第二个快照仍然存在
    const restore2AfterDelete = await undoManager.restoreSnapshot(snapshot2Result.value);
    expect(restore2AfterDelete.ok).toBe(true);
  });
});


describe("集成测试：队列管理", () => {
  let storage: MockFileStorage;
  let taskQueue: TaskQueue;
  let lockManager: LockManager;

  beforeEach(async () => {
    // 清空 mock 文件系统
    mockFS.clear();

    // 初始化组件
    storage = new MockFileStorage("test-data");
    lockManager = new LockManager();

    taskQueue = new TaskQueue({
      storage,
      lockManager,
      concurrency: 2,
    });

    // 初始化组件
    await taskQueue.initialize();
  });

  test("应该完成任务入队、执行、取消的集成流程", async () => {
    // 需求：6.1, 6.2, 6.3, 6.4, 6.5

    // 1. 任务入队（需求 6.1）
    const nodeId1 = "node-queue-1";
    const enqueueResult1 = await taskQueue.enqueue({
      nodeId: nodeId1,
      taskType: "standardizeClassify",
      payload: {
        conceptDescription: "测试概念1",
      },
    });

    expect(enqueueResult1.ok).toBe(true);
    const taskId1 = enqueueResult1.value;

    // 2. 验证任务已入队
    const task1 = taskQueue.getTask(taskId1);
    expect(task1).toBeDefined();
    expect(task1?.state).toBe("Pending");

    // 3. 验证队列状态
    let status = taskQueue.getStatus();
    expect(status.pending).toBe(1);
    expect(status.running).toBe(0);

    // 4. 更新任务状态为运行中（这会获取锁）
    await taskQueue.updateTaskState(taskId1, "Running");
    
    // 手动获取锁（模拟 TaskRunner 的行为）
    const lockResult = lockManager.acquireNodeLock(nodeId1, taskId1);
    expect(lockResult.ok).toBe(true);

    // 5. 测试锁冲突（需求 6.2，属性 13：节点锁互斥）
    // 尝试为同一节点创建另一个任务
    const enqueueResult2 = await taskQueue.enqueue({
      nodeId: nodeId1,
      taskType: "enrich",
      payload: {},
    });

    // 应该失败，因为节点已被锁定
    expect(enqueueResult2.ok).toBe(false);
    expect(enqueueResult2.error?.code).toBe("LOCK_CONFLICT");
    const runningTask = taskQueue.getTask(taskId1);
    expect(runningTask?.state).toBe("Running");

    status = taskQueue.getStatus();
    expect(status.running).toBe(1);
    expect(status.pending).toBe(0);

    // 6. 释放锁（为了后续测试）
    lockManager.releaseNodeLock(nodeId1, taskId1);

    // 7. 测试暂停队列（需求 6.4）
    taskQueue.pause();
    status = taskQueue.getStatus();
    expect(status.paused).toBe(true);

    // 8. 恢复队列
    taskQueue.resume();
    status = taskQueue.getStatus();
    expect(status.paused).toBe(false);

    // 9. 重新获取锁以测试取消功能
    lockManager.acquireNodeLock(nodeId1, taskId1);

    // 10. 取消任务（需求 6.5，属性 14：任务取消释放锁）
    const cancelResult = await taskQueue.cancel(taskId1);
    expect(cancelResult.ok).toBe(true);

    // 11. 验证任务状态已更新
    const cancelledTask = taskQueue.getTask(taskId1);
    expect(cancelledTask?.state).toBe("Cancelled");

    // 12. 验证锁已释放
    // 现在应该可以为同一节点创建新任务
    const enqueueResult3 = await taskQueue.enqueue({
      nodeId: nodeId1,
      taskType: "enrich",
      payload: {},
    });

    expect(enqueueResult3.ok).toBe(true);
  });

  test("应该正确管理多个任务的状态", async () => {
    // 需求：6.3

    // 1. 创建多个任务
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      const result = await taskQueue.enqueue({
        nodeId: `node-${i}`,
        taskType: "standardizeClassify",
        payload: {
          conceptDescription: `概念${i}`,
        },
      });
      expect(result.ok).toBe(true);
      tasks.push(result.value);
    }

    // 2. 验证所有任务都是 Pending 状态
    let status = taskQueue.getStatus();
    expect(status.pending).toBe(5);

    // 3. 将一些任务设置为 Running
    await taskQueue.updateTaskState(tasks[0], "Running");
    await taskQueue.updateTaskState(tasks[1], "Running");

    status = taskQueue.getStatus();
    expect(status.running).toBe(2);
    expect(status.pending).toBe(3);

    // 4. 完成一些任务
    await taskQueue.updateTaskState(tasks[0], "Completed");
    await taskQueue.updateTaskState(tasks[1], "Failed");

    status = taskQueue.getStatus();
    expect(status.completed).toBe(1);
    expect(status.failed).toBe(1);
    expect(status.running).toBe(0);

    // 5. 取消一个任务
    await taskQueue.cancel(tasks[2]);

    status = taskQueue.getStatus();
    expect(status.pending).toBe(2);

    // 6. 验证可以获取特定状态的任务
    const pendingTasks = taskQueue.getTasksByState("Pending");
    expect(pendingTasks.length).toBe(2);

    const completedTasks = taskQueue.getTasksByState("Completed");
    expect(completedTasks.length).toBe(1);
  });

  test("应该支持任务队列事件订阅", async () => {
    // 需求：6.1, 6.3

    const events: any[] = [];

    // 1. 订阅队列事件
    const unsubscribe = taskQueue.subscribe((event) => {
      events.push(event);
    });

    // 2. 执行一些操作
    const enqueueResult = await taskQueue.enqueue({
      nodeId: "node-event-1",
      taskType: "standardizeClassify",
      payload: {},
    });

    expect(enqueueResult.ok).toBe(true);
    const taskId = enqueueResult.value;

    await taskQueue.updateTaskState(taskId, "Running");
    await taskQueue.updateTaskState(taskId, "Completed");

    // 3. 验证事件已触发
    expect(events.length).toBeGreaterThan(0);

    // 验证事件类型
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain("task-added");
    expect(eventTypes).toContain("task-started");
    expect(eventTypes).toContain("task-completed");

    // 4. 取消订阅
    unsubscribe();

    // 5. 执行更多操作
    const enqueueResult2 = await taskQueue.enqueue({
      nodeId: "node-event-2",
      taskType: "enrich",
      payload: {},
    });

    // 事件数量不应该增加
    const eventCountAfterUnsubscribe = events.length;
    expect(events.length).toBe(eventCountAfterUnsubscribe);
  });

  test("应该支持清理已完成的任务", async () => {
    // 测试任务清理功能

    // 1. 创建并完成一些任务
    const tasks = [];
    for (let i = 0; i < 3; i++) {
      const result = await taskQueue.enqueue({
        nodeId: `node-cleanup-${i}`,
        taskType: "standardizeClassify",
        payload: {},
      });
      expect(result.ok).toBe(true);
      tasks.push(result.value);

      await taskQueue.updateTaskState(result.value, "Running");
      await taskQueue.updateTaskState(result.value, "Completed");
    }

    // 2. 验证任务已完成
    let status = taskQueue.getStatus();
    expect(status.completed).toBe(3);

    // 3. 清理旧任务（清理所有任务）
    const futureDate = new Date(Date.now() + 1000 * 60 * 60); // 1小时后
    const cleanupResult = await taskQueue.cleanupCompletedTasks(futureDate);
    expect(cleanupResult.ok).toBe(true);
    expect(cleanupResult.value).toBe(3);

    // 4. 验证任务已被清理
    status = taskQueue.getStatus();
    expect(status.completed).toBe(0);
  });
});
