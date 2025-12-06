/**
 * UndoManager 单元测试
 */

import { UndoManager, Snapshot, SnapshotMetadata } from "./undo-manager";
import { FileStorage } from "../data/file-storage";
import * as fs from "fs";
import * as path from "path";

describe("UndoManager", () => {
  let storage: FileStorage;
  let undoManager: UndoManager;
  let testDataDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDataDir = path.join(__dirname, "../../test-data", `undo-test-${Date.now()}`);
    fs.mkdirSync(testDataDir, { recursive: true });

    // 初始化 FileStorage
    storage = new FileStorage({ dataDir: testDataDir });

    // 初始化 UndoManager
    undoManager = new UndoManager({
      storage,
      maxSnapshots: 3,
    });

    await undoManager.initialize();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("initialize", () => {
    it("应该创建快照目录和索引文件", async () => {
      const snapshotsDir = path.join(testDataDir, "snapshots");
      const indexFile = path.join(snapshotsDir, "index.json");

      expect(fs.existsSync(snapshotsDir)).toBe(true);
      expect(fs.existsSync(indexFile)).toBe(true);

      const indexContent = fs.readFileSync(indexFile, "utf-8");
      expect(JSON.parse(indexContent)).toEqual([]);
    });
  });

  describe("createSnapshot", () => {
    it("应该成功创建快照", async () => {
      const filePath = "test-note.md";
      const content = "# Test Note\n\nThis is a test.";
      const operation = "test-operation";

      const result = await undoManager.createSnapshot(
        filePath,
        content,
        operation
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatch(/^snapshot-\d+-[a-z0-9]+$/);

        // 验证快照文件存在
        const snapshotPath = path.join(
          testDataDir,
          "snapshots",
          `${result.value}.json`
        );
        expect(fs.existsSync(snapshotPath)).toBe(true);

        // 验证快照内容
        const snapshotContent = JSON.parse(
          fs.readFileSync(snapshotPath, "utf-8")
        );
        expect(snapshotContent.id).toBe(result.value);
        expect(snapshotContent.filePath).toBe(filePath);
        expect(snapshotContent.content).toBe(content);
        expect(snapshotContent.operation).toBe(operation);
      }
    });

    it("应该更新索引", async () => {
      const filePath = "test-note.md";
      const content = "# Test Note";
      const operation = "test-operation";

      const result = await undoManager.createSnapshot(
        filePath,
        content,
        operation
      );

      expect(result.ok).toBe(true);

      const listResult = await undoManager.listSnapshots();
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.length).toBe(1);
        expect(listResult.value[0].filePath).toBe(filePath);
        expect(listResult.value[0].operation).toBe(operation);
      }
    });
  });

  describe("restoreSnapshot", () => {
    it("应该成功恢复快照", async () => {
      const filePath = "test-note.md";
      const content = "# Original Content";
      const operation = "test-operation";

      // 创建快照
      const createResult = await undoManager.createSnapshot(
        filePath,
        content,
        operation
      );
      expect(createResult.ok).toBe(true);

      if (createResult.ok) {
        // 恢复快照
        const restoreResult = await undoManager.restoreSnapshot(
          createResult.value
        );
        expect(restoreResult.ok).toBe(true);

        if (restoreResult.ok) {
          expect(restoreResult.value.id).toBe(createResult.value);
          expect(restoreResult.value.filePath).toBe(filePath);
          expect(restoreResult.value.content).toBe(content);
          expect(restoreResult.value.operation).toBe(operation);
        }
      }
    });

    it("应该在快照不存在时返回错误", async () => {
      const result = await undoManager.restoreSnapshot("non-existent-id");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SNAPSHOT_NOT_FOUND");
      }
    });
  });

  describe("deleteSnapshot", () => {
    it("应该成功删除快照", async () => {
      const filePath = "test-note.md";
      const content = "# Test Content";
      const operation = "test-operation";

      // 创建快照
      const createResult = await undoManager.createSnapshot(
        filePath,
        content,
        operation
      );
      expect(createResult.ok).toBe(true);

      if (createResult.ok) {
        // 删除快照
        const deleteResult = await undoManager.deleteSnapshot(
          createResult.value
        );
        expect(deleteResult.ok).toBe(true);

        // 验证快照文件已删除
        const snapshotPath = path.join(
          testDataDir,
          "snapshots",
          `${createResult.value}.json`
        );
        expect(fs.existsSync(snapshotPath)).toBe(false);

        // 验证索引已更新
        const listResult = await undoManager.listSnapshots();
        expect(listResult.ok).toBe(true);
        if (listResult.ok) {
          expect(listResult.value.length).toBe(0);
        }
      }
    });
  });

  describe("listSnapshots", () => {
    it("应该返回所有快照元数据", async () => {
      // 创建多个快照
      await undoManager.createSnapshot("note1.md", "Content 1", "op1");
      await undoManager.createSnapshot("note2.md", "Content 2", "op2");
      await undoManager.createSnapshot("note3.md", "Content 3", "op3");

      const result = await undoManager.listSnapshots();
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value.length).toBe(3);
        expect(result.value[0].filePath).toBe("note1.md");
        expect(result.value[1].filePath).toBe("note2.md");
        expect(result.value[2].filePath).toBe("note3.md");
      }
    });
  });

  describe("getSnapshotCount", () => {
    it("应该返回正确的快照数量", async () => {
      // 初始应该为 0
      let countResult = await undoManager.getSnapshotCount();
      expect(countResult.ok).toBe(true);
      if (countResult.ok) {
        expect(countResult.value).toBe(0);
      }

      // 创建快照后应该增加
      await undoManager.createSnapshot("note1.md", "Content 1", "op1");
      countResult = await undoManager.getSnapshotCount();
      expect(countResult.ok).toBe(true);
      if (countResult.ok) {
        expect(countResult.value).toBe(1);
      }
    });
  });

  describe("cleanupOldSnapshots", () => {
    it("应该在超过上限时删除最旧的快照", async () => {
      // 创建 4 个快照（超过上限 3）
      const snapshot1 = await undoManager.createSnapshot(
        "note1.md",
        "Content 1",
        "op1"
      );
      // 等待一小段时间确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 10));

      const snapshot2 = await undoManager.createSnapshot(
        "note2.md",
        "Content 2",
        "op2"
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      const snapshot3 = await undoManager.createSnapshot(
        "note3.md",
        "Content 3",
        "op3"
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      const snapshot4 = await undoManager.createSnapshot(
        "note4.md",
        "Content 4",
        "op4"
      );

      // 验证只保留了 3 个快照
      const countResult = await undoManager.getSnapshotCount();
      expect(countResult.ok).toBe(true);
      if (countResult.ok) {
        expect(countResult.value).toBe(3);
      }

      // 验证最旧的快照被删除
      const listResult = await undoManager.listSnapshots();
      expect(listResult.ok).toBe(true);
      if (listResult.ok && snapshot1.ok) {
        const ids = listResult.value.map((s) => s.id);
        expect(ids).not.toContain(snapshot1.value);
      }
    });

    it("应该保留最新的快照", async () => {
      // 创建 4 个快照
      await undoManager.createSnapshot("note1.md", "Content 1", "op1");
      await new Promise((resolve) => setTimeout(resolve, 10));
      await undoManager.createSnapshot("note2.md", "Content 2", "op2");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const snapshot3 = await undoManager.createSnapshot(
        "note3.md",
        "Content 3",
        "op3"
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const snapshot4 = await undoManager.createSnapshot(
        "note4.md",
        "Content 4",
        "op4"
      );

      // 验证最新的快照仍然存在
      const listResult = await undoManager.listSnapshots();
      expect(listResult.ok).toBe(true);
      if (listResult.ok && snapshot3.ok && snapshot4.ok) {
        const ids = listResult.value.map((s) => s.id);
        expect(ids).toContain(snapshot3.value);
        expect(ids).toContain(snapshot4.value);
      }
    });
  });
});
