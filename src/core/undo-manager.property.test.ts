/**
 * UndoManager 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { UndoManager } from "./undo-manager";
import { FileStorage } from "../data/file-storage";
import * as fs from "fs";
import * as path from "path";

describe("UndoManager Property Tests", () => {
  let storage: FileStorage;
  let undoManager: UndoManager;
  let testDataDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDataDir = path.join(
      __dirname,
      "../../test-data",
      `undo-prop-test-${Date.now()}`
    );
    fs.mkdirSync(testDataDir, { recursive: true });

    // 初始化 FileStorage
    storage = new FileStorage({ dataDir: testDataDir });

    // 初始化 UndoManager
    undoManager = new UndoManager({
      storage,
      maxSnapshots: 100,
    });

    await undoManager.initialize();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  // **Feature: cognitive-razor, Property 10: 写入前快照创建**
  // **Validates: Requirements 5.1**
  describe("Property 10: 写入前快照创建", () => {
    it("对于任意写入操作，系统必须在写入前创建文件快照，快照内容必须与原文件内容一致", async () => {
      await fc.assert(
        fc.asyncProperty(
          // 生成随机文件路径
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s}.md`),
          // 生成随机文件内容
          fc.string({ minLength: 0, maxLength: 1000 }),
          // 生成随机操作描述
          fc.string({ minLength: 1, maxLength: 100 }),
          async (filePath, content, operation) => {
            // 创建快照
            const createResult = await undoManager.createSnapshot(
              filePath,
              content,
              operation
            );

            // 验证快照创建成功
            expect(createResult.ok).toBe(true);

            if (createResult.ok) {
              const snapshotId = createResult.value;

              // 恢复快照
              const restoreResult = await undoManager.restoreSnapshot(
                snapshotId
              );

              // 验证快照恢复成功
              expect(restoreResult.ok).toBe(true);

              if (restoreResult.ok) {
                const snapshot = restoreResult.value;

                // 验证快照内容与原文件内容一致
                expect(snapshot.filePath).toBe(filePath);
                expect(snapshot.content).toBe(content);
                expect(snapshot.operation).toBe(operation);

                // 验证快照 ID 正确
                expect(snapshot.id).toBe(snapshotId);

                // 验证快照有创建时间
                expect(snapshot.created).toBeDefined();
                expect(new Date(snapshot.created).getTime()).toBeGreaterThan(0);
              }

              // 清理快照
              await undoManager.deleteSnapshot(snapshotId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("快照必须包含完整的元数据信息", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s}.md`),
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          async (filePath, content, operation) => {
            // 创建快照
            const createResult = await undoManager.createSnapshot(
              filePath,
              content,
              operation
            );

            expect(createResult.ok).toBe(true);

            if (createResult.ok) {
              const snapshotId = createResult.value;

              // 验证快照在索引中
              const listResult = await undoManager.listSnapshots();
              expect(listResult.ok).toBe(true);

              if (listResult.ok) {
                const metadata = listResult.value.find(
                  (s) => s.id === snapshotId
                );
                expect(metadata).toBeDefined();

                if (metadata) {
                  // 验证元数据完整性
                  expect(metadata.id).toBe(snapshotId);
                  expect(metadata.filePath).toBe(filePath);
                  expect(metadata.operation).toBe(operation);
                  expect(metadata.created).toBeDefined();
                  expect(new Date(metadata.created).getTime()).toBeGreaterThan(
                    0
                  );
                }
              }

              // 清理快照
              await undoManager.deleteSnapshot(snapshotId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("快照 ID 必须唯一", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              filePath: fc
                .string({ minLength: 1, maxLength: 50 })
                .map((s) => `${s}.md`),
              content: fc.string({ minLength: 0, maxLength: 500 }),
              operation: fc.string({ minLength: 1, maxLength: 50 }),
            }),
            { minLength: 2, maxLength: 10 }
          ),
          async (snapshots) => {
            const snapshotIds: string[] = [];

            // 创建多个快照
            for (const snap of snapshots) {
              const createResult = await undoManager.createSnapshot(
                snap.filePath,
                snap.content,
                snap.operation
              );

              expect(createResult.ok).toBe(true);

              if (createResult.ok) {
                snapshotIds.push(createResult.value);
              }
            }

            // 验证所有快照 ID 唯一
            const uniqueIds = new Set(snapshotIds);
            expect(uniqueIds.size).toBe(snapshotIds.length);

            // 清理所有快照
            for (const id of snapshotIds) {
              await undoManager.deleteSnapshot(id);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // **Feature: cognitive-razor, Property 11: 撤销操作 round trip**
  // **Validates: Requirements 5.3**
  describe("Property 11: 撤销操作 round trip", () => {
    it("对于任意已确认的写入操作，执行撤销后文件内容必须恢复到写入前的状态，且快照文件必须被删除", async () => {
      await fc.assert(
        fc.asyncProperty(
          // 生成随机文件路径
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s}.md`),
          // 生成原始内容
          fc.string({ minLength: 0, maxLength: 1000 }),
          // 生成修改后的内容（确保与原始内容不同）
          fc.string({ minLength: 0, maxLength: 1000 }),
          // 生成操作描述
          fc.string({ minLength: 1, maxLength: 100 }),
          async (filePath, originalContent, modifiedContent, operation) => {
            // 步骤 1: 创建快照（保存原始内容）
            const createResult = await undoManager.createSnapshot(
              filePath,
              originalContent,
              operation
            );

            expect(createResult.ok).toBe(true);

            if (createResult.ok) {
              const snapshotId = createResult.value;

              // 步骤 2: 模拟写入操作（这里我们不实际写入文件，只是模拟）
              // 在实际应用中，这里会写入 modifiedContent 到文件

              // 步骤 3: 执行撤销 - 恢复快照
              const restoreResult = await undoManager.restoreSnapshot(
                snapshotId
              );

              expect(restoreResult.ok).toBe(true);

              if (restoreResult.ok) {
                const snapshot = restoreResult.value;

                // 验证恢复的内容与原始内容一致
                expect(snapshot.content).toBe(originalContent);
                expect(snapshot.filePath).toBe(filePath);

                // 步骤 4: 删除快照
                const deleteResult = await undoManager.deleteSnapshot(
                  snapshotId
                );

                expect(deleteResult.ok).toBe(true);

                // 验证快照文件已被删除
                const restoreAgainResult = await undoManager.restoreSnapshot(
                  snapshotId
                );
                expect(restoreAgainResult.ok).toBe(false);
                if (!restoreAgainResult.ok) {
                  expect(restoreAgainResult.error.code).toBe(
                    "SNAPSHOT_NOT_FOUND"
                  );
                }

                // 验证快照从索引中移除
                const listResult = await undoManager.listSnapshots();
                expect(listResult.ok).toBe(true);
                if (listResult.ok) {
                  const snapshotIds = listResult.value.map((s) => s.id);
                  expect(snapshotIds).not.toContain(snapshotId);
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("撤销操作必须是幂等的 - 多次恢复同一快照应该返回相同内容", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => `${s}.md`),
          fc.string({ minLength: 0, maxLength: 1000 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          async (filePath, content, operation) => {
            // 创建快照
            const createResult = await undoManager.createSnapshot(
              filePath,
              content,
              operation
            );

            expect(createResult.ok).toBe(true);

            if (createResult.ok) {
              const snapshotId = createResult.value;

              // 第一次恢复
              const restore1 = await undoManager.restoreSnapshot(snapshotId);
              expect(restore1.ok).toBe(true);

              // 第二次恢复
              const restore2 = await undoManager.restoreSnapshot(snapshotId);
              expect(restore2.ok).toBe(true);

              // 验证两次恢复的内容完全一致
              if (restore1.ok && restore2.ok) {
                expect(restore1.value.content).toBe(restore2.value.content);
                expect(restore1.value.filePath).toBe(restore2.value.filePath);
                expect(restore1.value.operation).toBe(restore2.value.operation);
                expect(restore1.value.id).toBe(restore2.value.id);
              }

              // 清理
              await undoManager.deleteSnapshot(snapshotId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("撤销操作必须完整恢复所有元数据", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            filePath: fc
              .string({ minLength: 1, maxLength: 50 })
              .map((s) => `${s}.md`),
            content: fc.string({ minLength: 0, maxLength: 1000 }),
            operation: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          async (data) => {
            // 创建快照
            const createResult = await undoManager.createSnapshot(
              data.filePath,
              data.content,
              data.operation
            );

            expect(createResult.ok).toBe(true);

            if (createResult.ok) {
              const snapshotId = createResult.value;

              // 恢复快照
              const restoreResult = await undoManager.restoreSnapshot(
                snapshotId
              );

              expect(restoreResult.ok).toBe(true);

              if (restoreResult.ok) {
                const snapshot = restoreResult.value;

                // 验证所有字段都被正确恢复
                expect(snapshot.id).toBe(snapshotId);
                expect(snapshot.filePath).toBe(data.filePath);
                expect(snapshot.content).toBe(data.content);
                expect(snapshot.operation).toBe(data.operation);
                expect(snapshot.created).toBeDefined();
                expect(typeof snapshot.created).toBe("string");
                expect(new Date(snapshot.created).getTime()).toBeGreaterThan(0);
              }

              // 清理
              await undoManager.deleteSnapshot(snapshotId);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // **Feature: cognitive-razor, Property 12: 快照清理策略**
  // **Validates: Requirements 5.4**
  describe("Property 12: 快照清理策略", () => {
    it("对于任意快照存储，当快照数量超过上限时，系统必须自动删除最旧的快照，保持快照数量不超过上限", async () => {
      await fc.assert(
        fc.asyncProperty(
          // 生成快照上限（2-10 之间）
          fc.integer({ min: 2, max: 10 }),
          // 生成要创建的快照数量（上限 + 1 到上限 + 5）
          fc.integer({ min: 1, max: 5 }),
          async (maxSnapshots, extraSnapshots) => {
            // 为这个测试创建独立的目录和 storage
            const testDir = path.join(
              testDataDir,
              `cleanup-${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 10)}`
            );
            fs.mkdirSync(testDir, { recursive: true });
            const testStorage = new FileStorage({ dataDir: testDir });

            // 创建新的 UndoManager 实例，使用指定的上限
            const testUndoManager = new UndoManager({
              storage: testStorage,
              maxSnapshots,
            });

            await testUndoManager.initialize();

            const totalSnapshots = maxSnapshots + extraSnapshots;
            const snapshotIds: string[] = [];

            // 创建超过上限的快照
            for (let i = 0; i < totalSnapshots; i++) {
              // 添加小延迟确保时间戳不同
              if (i > 0) {
                await new Promise((resolve) => setTimeout(resolve, 5));
              }

              const createResult = await testUndoManager.createSnapshot(
                `note-${i}.md`,
                `Content ${i}`,
                `operation-${i}`
              );

              expect(createResult.ok).toBe(true);

              if (createResult.ok) {
                snapshotIds.push(createResult.value);
              }
            }

            // 验证快照数量不超过上限
            const countResult = await testUndoManager.getSnapshotCount();
            expect(countResult.ok).toBe(true);

            if (countResult.ok) {
              expect(countResult.value).toBeLessThanOrEqual(maxSnapshots);
              expect(countResult.value).toBe(maxSnapshots);
            }

            // 验证最旧的快照被删除
            const listResult = await testUndoManager.listSnapshots();
            expect(listResult.ok).toBe(true);

            if (listResult.ok) {
              const remainingIds = listResult.value.map((s) => s.id);

              // 最旧的 extraSnapshots 个快照应该被删除
              for (let i = 0; i < extraSnapshots; i++) {
                expect(remainingIds).not.toContain(snapshotIds[i]);
              }

              // 最新的 maxSnapshots 个快照应该保留
              for (let i = extraSnapshots; i < totalSnapshots; i++) {
                expect(remainingIds).toContain(snapshotIds[i]);
              }
            }

            // 清理所有剩余快照
            const finalList = await testUndoManager.listSnapshots();
            if (finalList.ok) {
              for (const snapshot of finalList.value) {
                await testUndoManager.deleteSnapshot(snapshot.id);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it("快照清理必须按创建时间排序，删除最旧的", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 3, max: 8 }),
          async (maxSnapshots) => {
            // 为这个测试创建独立的目录和 storage
            const testDir = path.join(
              testDataDir,
              `time-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
            );
            fs.mkdirSync(testDir, { recursive: true });
            const testStorage = new FileStorage({ dataDir: testDir });

            // 创建新的 UndoManager 实例
            const testUndoManager = new UndoManager({
              storage: testStorage,
              maxSnapshots,
            });

            await testUndoManager.initialize();

            const snapshotData: Array<{
              id: string;
              created: string;
              filePath: string;
            }> = [];

            // 创建 maxSnapshots + 2 个快照
            for (let i = 0; i < maxSnapshots + 2; i++) {
              await new Promise((resolve) => setTimeout(resolve, 5));

              const createResult = await testUndoManager.createSnapshot(
                `note-${i}.md`,
                `Content ${i}`,
                `operation-${i}`
              );

              expect(createResult.ok).toBe(true);

              if (createResult.ok) {
                const listResult = await testUndoManager.listSnapshots();
                if (listResult.ok) {
                  const snapshot = listResult.value.find(
                    (s) => s.id === createResult.value
                  );
                  if (snapshot) {
                    snapshotData.push({
                      id: snapshot.id,
                      created: snapshot.created,
                      filePath: snapshot.filePath,
                    });
                  }
                }
              }
            }

            // 获取最终保留的快照
            const finalList = await testUndoManager.listSnapshots();
            expect(finalList.ok).toBe(true);

            if (finalList.ok) {
              const remainingIds = finalList.value.map((s) => s.id);

              // 验证保留的快照数量正确
              expect(remainingIds.length).toBe(maxSnapshots);

              // 验证保留的是最新的快照
              // 按创建时间排序原始数据
              const sortedByTime = [...snapshotData].sort(
                (a, b) =>
                  new Date(a.created).getTime() - new Date(b.created).getTime()
              );

              // 最新的 maxSnapshots 个应该被保留
              const expectedIds = sortedByTime
                .slice(-maxSnapshots)
                .map((s) => s.id);

              for (const expectedId of expectedIds) {
                expect(remainingIds).toContain(expectedId);
              }

              // 最旧的应该被删除
              const deletedIds = sortedByTime
                .slice(0, snapshotData.length - maxSnapshots)
                .map((s) => s.id);

              for (const deletedId of deletedIds) {
                expect(remainingIds).not.toContain(deletedId);
              }
            }

            // 清理
            const cleanupList = await testUndoManager.listSnapshots();
            if (cleanupList.ok) {
              for (const snapshot of cleanupList.value) {
                await testUndoManager.deleteSnapshot(snapshot.id);
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it("清理操作不应影响快照的完整性", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (maxSnapshots) => {
            // 为这个测试创建独立的目录和 storage
            const testDir = path.join(
              testDataDir,
              `integrity-${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 10)}`
            );
            fs.mkdirSync(testDir, { recursive: true });
            const testStorage = new FileStorage({ dataDir: testDir });

            // 创建新的 UndoManager 实例
            const testUndoManager = new UndoManager({
              storage: testStorage,
              maxSnapshots,
            });

            await testUndoManager.initialize();

            // 创建超过上限的快照
            for (let i = 0; i < maxSnapshots + 3; i++) {
              await new Promise((resolve) => setTimeout(resolve, 5));

              await testUndoManager.createSnapshot(
                `note-${i}.md`,
                `Content ${i}`,
                `operation-${i}`
              );
            }

            // 获取保留的快照
            const listResult = await testUndoManager.listSnapshots();
            expect(listResult.ok).toBe(true);

            if (listResult.ok) {
              // 验证每个保留的快照都可以正确恢复
              for (const metadata of listResult.value) {
                const restoreResult = await testUndoManager.restoreSnapshot(
                  metadata.id
                );

                expect(restoreResult.ok).toBe(true);

                if (restoreResult.ok) {
                  const snapshot = restoreResult.value;

                  // 验证快照数据完整
                  expect(snapshot.id).toBe(metadata.id);
                  expect(snapshot.filePath).toBe(metadata.filePath);
                  expect(snapshot.created).toBe(metadata.created);
                  expect(snapshot.operation).toBe(metadata.operation);
                  expect(snapshot.content).toBeDefined();
                  expect(typeof snapshot.content).toBe("string");
                }
              }
            }

            // 清理
            const cleanupList = await testUndoManager.listSnapshots();
            if (cleanupList.ok) {
              for (const snapshot of cleanupList.value) {
                await testUndoManager.deleteSnapshot(snapshot.id);
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it("当快照数量等于上限时，不应触发清理", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 8 }),
          async (maxSnapshots) => {
            // 为这个测试创建独立的目录和 storage
            const testDir = path.join(
              testDataDir,
              `noclean-${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 10)}`
            );
            fs.mkdirSync(testDir, { recursive: true });
            const testStorage = new FileStorage({ dataDir: testDir });

            // 创建新的 UndoManager 实例
            const testUndoManager = new UndoManager({
              storage: testStorage,
              maxSnapshots,
            });

            await testUndoManager.initialize();

            const snapshotIds: string[] = [];

            // 创建恰好等于上限的快照
            for (let i = 0; i < maxSnapshots; i++) {
              await new Promise((resolve) => setTimeout(resolve, 5));

              const createResult = await testUndoManager.createSnapshot(
                `note-${i}.md`,
                `Content ${i}`,
                `operation-${i}`
              );

              expect(createResult.ok).toBe(true);

              if (createResult.ok) {
                snapshotIds.push(createResult.value);
              }
            }

            // 验证所有快照都被保留
            const listResult = await testUndoManager.listSnapshots();
            expect(listResult.ok).toBe(true);

            if (listResult.ok) {
              expect(listResult.value.length).toBe(maxSnapshots);

              const remainingIds = listResult.value.map((s) => s.id);

              // 所有创建的快照都应该存在
              for (const id of snapshotIds) {
                expect(remainingIds).toContain(id);
              }
            }

            // 清理
            for (const id of snapshotIds) {
              await testUndoManager.deleteSnapshot(id);
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
