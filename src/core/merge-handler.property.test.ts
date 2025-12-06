/**
 * MergeHandler 属性测试
 * 
 * **Feature: cognitive-razor, Property 15: 合并后清理**
 * **验证需求：7.4, 7.5**
 * 
 * 属性：对于任意确认的合并操作，系统必须删除被合并的笔记、
 * 从 DuplicatePairs 中移除该重复对、更新向量索引。
 */

import * as fc from "fast-check";
import { DuplicatePair, CRType, TaskRecord } from "../types";
import { MergeHandler, MergeHandlerConfig } from "./merge-handler";
import { FileStorage } from "../data/file-storage";
import { TFile } from "obsidian";

// Mock Obsidian App
class MockApp {
  vault = {
    getAbstractFileByPath: jest.fn(),
    read: jest.fn(),
    modify: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  };
}

describe("MergeHandler Property Tests", () => {
  describe("Property 15: 合并后清理", () => {
    /**
     * **Feature: cognitive-razor, Property 15: 合并后清理**
     * 
     * 对于任意确认的合并操作，系统必须：
     * 1. 删除被合并的笔记
     * 2. 从 DuplicatePairs 中移除该重复对
     * 3. 更新向量索引（删除被合并笔记的条目）
     */
    it("should clean up after merge: delete note, remove pair, update index", async () => {
      await fc.assert(
        fc.asyncProperty(
          // 生成随机的重复对数据
          fc.record({
            pairId: fc.uuid(),
            noteA: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `${s}.md`),
              content: fc.string({ minLength: 10, maxLength: 500 }),
            }),
            noteB: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `${s}.md`),
              content: fc.string({ minLength: 10, maxLength: 500 }),
            }),
            type: fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism"),
            similarity: fc.double({ min: 0.9, max: 1.0 }),
            mergedContent: fc.string({ minLength: 10, maxLength: 1000 }),
          }),
          async (testData) => {
            // 设置 Mock
            const mockApp = new MockApp() as any;
            const mockStorage = new FileStorage("test-data");
            const mockTaskQueue = {
              subscribe: jest.fn(),
              getTask: jest.fn(),
            } as any;
            const mockUndoManager = {
              createSnapshot: jest.fn().mockResolvedValue({ ok: true, value: "snapshot-id" }),
            } as any;
            const mockDuplicateManager = {
              updateStatus: jest.fn().mockResolvedValue({ ok: true }),
              removePair: jest.fn().mockResolvedValue({ ok: true }),
            } as any;
            const mockVectorIndex = {
              delete: jest.fn().mockResolvedValue({ ok: true }),
            } as any;

            // 创建 MergeHandler
            const config: MergeHandlerConfig = {
              app: mockApp,
              taskQueue: mockTaskQueue,
              undoManager: mockUndoManager,
              duplicateManager: mockDuplicateManager,
              vectorIndex: mockVectorIndex,
              storage: mockStorage,
            };

            const handler = new MergeHandler(config);

            // 模拟文件存在
            const mockFileA = new TFile(testData.noteA.path);
            const mockFileB = new TFile(testData.noteB.path);

            mockApp.vault.getAbstractFileByPath
              .mockImplementation((path: string) => {
                if (path === testData.noteA.path) return mockFileA;
                if (path === testData.noteB.path) return mockFileB;
                return null;
              });

            mockApp.vault.read
              .mockImplementation((file: any) => {
                if (file === mockFileA) return Promise.resolve(testData.noteA.content);
                if (file === mockFileB) return Promise.resolve(testData.noteB.content);
                return Promise.resolve("");
              });

            mockApp.vault.modify.mockResolvedValue(undefined);
            mockApp.vault.delete.mockResolvedValue(undefined);

            // 通过反射访问私有方法 applyMerge
            const applyMerge = (handler as any).applyMerge.bind(handler);

            // 执行合并
            await applyMerge(
              mockFileA,
              testData.noteA,
              testData.noteB,
              testData.mergedContent,
              testData.pairId
            );

            // 验证：被合并的笔记应该被删除
            expect(mockApp.vault.delete).toHaveBeenCalledWith(mockFileB);

            // 验证：重复对应该被移除
            expect(mockDuplicateManager.removePair).toHaveBeenCalledWith(testData.pairId);

            // 验证：向量索引应该被更新（删除被合并笔记的条目）
            expect(mockVectorIndex.delete).toHaveBeenCalledWith(testData.noteB.nodeId);

            // 验证：主笔记应该被修改
            expect(mockApp.vault.modify).toHaveBeenCalledWith(
              mockFileA,
              testData.mergedContent
            );

            // 验证：应该创建快照
            expect(mockUndoManager.createSnapshot).toHaveBeenCalledWith(
              testData.noteA.path,
              testData.noteA.content,
              "merge"
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * 边缘情况：合并失败时不应该清理
     */
    it("should not clean up if merge fails", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            pairId: fc.uuid(),
            noteA: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `${s}.md`),
              content: fc.string({ minLength: 10, maxLength: 500 }),
            }),
            noteB: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `${s}.md`),
              content: fc.string({ minLength: 10, maxLength: 500 }),
            }),
            type: fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism"),
            similarity: fc.double({ min: 0.9, max: 1.0 }),
            mergedContent: fc.string({ minLength: 10, maxLength: 1000 }),
          }),
          async (testData) => {
            // 设置 Mock - 快照创建失败
            const mockApp = new MockApp() as any;
            const mockStorage = new FileStorage("test-data");
            const mockTaskQueue = {
              subscribe: jest.fn(),
              getTask: jest.fn(),
            } as any;
            const mockUndoManager = {
              createSnapshot: jest.fn().mockResolvedValue({
                ok: false,
                error: { code: "SNAPSHOT_ERROR", message: "快照创建失败" }
              }),
            } as any;
            const mockDuplicateManager = {
              updateStatus: jest.fn().mockResolvedValue({ ok: true }),
              removePair: jest.fn().mockResolvedValue({ ok: true }),
            } as any;
            const mockVectorIndex = {
              delete: jest.fn().mockResolvedValue({ ok: true }),
            } as any;

            const config: MergeHandlerConfig = {
              app: mockApp,
              taskQueue: mockTaskQueue,
              undoManager: mockUndoManager,
              duplicateManager: mockDuplicateManager,
              vectorIndex: mockVectorIndex,
              storage: mockStorage,
            };

            const handler = new MergeHandler(config);

            const mockFileA = new TFile(testData.noteA.path);
            const mockFileB = new TFile(testData.noteB.path);

            mockApp.vault.getAbstractFileByPath
              .mockImplementation((path: string) => {
                if (path === testData.noteA.path) return mockFileA;
                if (path === testData.noteB.path) return mockFileB;
                return null;
              });

            mockApp.vault.delete.mockResolvedValue(undefined);
            mockApp.vault.modify.mockResolvedValue(undefined);

            // 通过反射访问私有方法
            const applyMerge = (handler as any).applyMerge.bind(handler);

            // 执行合并（应该失败）
            await applyMerge(
              mockFileA,
              testData.noteA,
              testData.noteB,
              testData.mergedContent,
              testData.pairId
            );

            // 验证：快照创建失败时，不应该执行清理操作
            expect(mockApp.vault.delete).not.toHaveBeenCalled();
            expect(mockDuplicateManager.removePair).not.toHaveBeenCalled();
            expect(mockVectorIndex.delete).not.toHaveBeenCalled();
            expect(mockApp.vault.modify).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * 边缘情况：被合并的文件不存在时应该继续清理其他资源
     */
    it("should continue cleanup even if file B does not exist", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            pairId: fc.uuid(),
            noteA: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `${s}.md`),
              content: fc.string({ minLength: 10, maxLength: 500 }),
            }),
            noteB: fc.record({
              nodeId: fc.uuid(),
              name: fc.string({ minLength: 1, maxLength: 50 }),
              path: fc.string({ minLength: 1, maxLength: 100 }).map(s => `${s}.md`),
              content: fc.string({ minLength: 10, maxLength: 500 }),
            }),
            type: fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism"),
            similarity: fc.double({ min: 0.9, max: 1.0 }),
            mergedContent: fc.string({ minLength: 10, maxLength: 1000 }),
          }),
          async (testData) => {
            const mockApp = new MockApp() as any;
            const mockStorage = new FileStorage("test-data");
            const mockTaskQueue = { subscribe: jest.fn(), getTask: jest.fn() } as any;
            const mockUndoManager = {
              createSnapshot: jest.fn().mockResolvedValue({ ok: true, value: "snapshot-id" }),
            } as any;
            const mockDuplicateManager = {
              updateStatus: jest.fn().mockResolvedValue({ ok: true }),
              removePair: jest.fn().mockResolvedValue({ ok: true }),
            } as any;
            const mockVectorIndex = {
              delete: jest.fn().mockResolvedValue({ ok: true }),
            } as any;

            const config: MergeHandlerConfig = {
              app: mockApp,
              taskQueue: mockTaskQueue,
              undoManager: mockUndoManager,
              duplicateManager: mockDuplicateManager,
              vectorIndex: mockVectorIndex,
              storage: mockStorage,
            };

            const handler = new MergeHandler(config);

            const mockFileA = new TFile(testData.noteA.path);

            // 文件 B 不存在
            mockApp.vault.getAbstractFileByPath
              .mockImplementation((path: string) => {
                if (path === testData.noteA.path) return mockFileA;
                return null; // 文件 B 不存在
              });

            mockApp.vault.modify.mockResolvedValue(undefined);
            mockApp.vault.delete.mockResolvedValue(undefined);

            const applyMerge = (handler as any).applyMerge.bind(handler);

            await applyMerge(
              mockFileA,
              testData.noteA,
              testData.noteB,
              testData.mergedContent,
              testData.pairId
            );

            // 验证：即使文件 B 不存在，仍应该清理其他资源
            expect(mockDuplicateManager.removePair).toHaveBeenCalledWith(testData.pairId);
            expect(mockVectorIndex.delete).toHaveBeenCalledWith(testData.noteB.nodeId);
            expect(mockApp.vault.modify).toHaveBeenCalledWith(
              mockFileA,
              testData.mergedContent
            );
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
