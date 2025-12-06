/**
 * DuplicateManager 单元测试
 */

import { DuplicateManager } from "./duplicate-manager";
import { FileStorage } from "../data/file-storage";
import { DuplicatePair } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("DuplicateManager", () => {
  let storage: FileStorage;
  let duplicateManager: DuplicateManager;
  let testDataDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDataDir = path.join(
      __dirname,
      "../../test-data",
      `duplicate-manager-${Date.now()}`
    );
    fs.mkdirSync(testDataDir, { recursive: true });

    storage = new FileStorage({ dataDir: testDataDir });
    duplicateManager = new DuplicateManager(storage);
    await duplicateManager.load();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("addPair", () => {
    it("应该成功添加新的重复对", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: {
          nodeId: "uid-1",
          name: "概念 A",
          path: "a.md",
        },
        noteB: {
          nodeId: "uid-2",
          name: "概念 B",
          path: "b.md",
        },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      const result = await duplicateManager.addPair(pair);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const id = result.value;
        expect(id).toBeTruthy();

        // 验证可以获取添加的重复对
        const getPairResult = await duplicateManager.getPair(id);
        expect(getPairResult.ok).toBe(true);
        if (getPairResult.ok && getPairResult.value) {
          expect(getPairResult.value.noteA.nodeId).toBe("uid-1");
          expect(getPairResult.value.noteB.nodeId).toBe("uid-2");
          expect(getPairResult.value.similarity).toBe(0.95);
        }
      }
    });

    it("应该拒绝添加已存在的重复对", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: {
          nodeId: "uid-1",
          name: "概念 A",
          path: "a.md",
        },
        noteB: {
          nodeId: "uid-2",
          name: "概念 B",
          path: "b.md",
        },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      await duplicateManager.addPair(pair);
      const result = await duplicateManager.addPair(pair);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PAIR_ALREADY_EXISTS");
      }
    });

    it("应该拒绝无效的相似度值", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: {
          nodeId: "uid-1",
          name: "概念 A",
          path: "a.md",
        },
        noteB: {
          nodeId: "uid-2",
          name: "概念 B",
          path: "b.md",
        },
        type: "Domain",
        similarity: 1.5, // 无效值
        status: "pending",
      };

      const result = await duplicateManager.addPair(pair);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_SIMILARITY");
      }
    });
  });

  describe("getPendingPairs", () => {
    it("应该返回所有待处理的重复对", async () => {
      const pair1: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-1", name: "A", path: "a.md" },
        noteB: { nodeId: "uid-2", name: "B", path: "b.md" },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      const pair2: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-3", name: "C", path: "c.md" },
        noteB: { nodeId: "uid-4", name: "D", path: "d.md" },
        type: "Issue",
        similarity: 0.92,
        status: "merged",
      };

      await duplicateManager.addPair(pair1);
      await duplicateManager.addPair(pair2);

      const result = await duplicateManager.getPendingPairs();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].status).toBe("pending");
      }
    });
  });

  describe("getPairsByType", () => {
    it("应该返回指定类型的重复对", async () => {
      const pair1: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-1", name: "A", path: "a.md" },
        noteB: { nodeId: "uid-2", name: "B", path: "b.md" },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      const pair2: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-3", name: "C", path: "c.md" },
        noteB: { nodeId: "uid-4", name: "D", path: "d.md" },
        type: "Issue",
        similarity: 0.92,
        status: "pending",
      };

      await duplicateManager.addPair(pair1);
      await duplicateManager.addPair(pair2);

      const result = await duplicateManager.getPairsByType("Domain");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].type).toBe("Domain");
      }
    });
  });

  describe("updateStatus", () => {
    it("应该成功更新重复对状态", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-1", name: "A", path: "a.md" },
        noteB: { nodeId: "uid-2", name: "B", path: "b.md" },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      const addResult = await duplicateManager.addPair(pair);
      expect(addResult.ok).toBe(true);

      if (addResult.ok) {
        const id = addResult.value;
        const updateResult = await duplicateManager.updateStatus(id, "merging");
        expect(updateResult.ok).toBe(true);

        const getPairResult = await duplicateManager.getPair(id);
        expect(getPairResult.ok).toBe(true);
        if (getPairResult.ok && getPairResult.value) {
          expect(getPairResult.value.status).toBe("merging");
        }
      }
    });
  });

  describe("removePair", () => {
    it("应该成功删除重复对", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-1", name: "A", path: "a.md" },
        noteB: { nodeId: "uid-2", name: "B", path: "b.md" },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      const addResult = await duplicateManager.addPair(pair);
      expect(addResult.ok).toBe(true);

      if (addResult.ok) {
        const id = addResult.value;
        const removeResult = await duplicateManager.removePair(id);
        expect(removeResult.ok).toBe(true);

        const getPairResult = await duplicateManager.getPair(id);
        expect(getPairResult.ok).toBe(true);
        if (getPairResult.ok) {
          expect(getPairResult.value).toBeNull();
        }
      }
    });
  });

  describe("hasPair", () => {
    it("应该检测到存在的重复对（不考虑顺序）", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-1", name: "A", path: "a.md" },
        noteB: { nodeId: "uid-2", name: "B", path: "b.md" },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      await duplicateManager.addPair(pair);

      // 正向检查
      const result1 = await duplicateManager.hasPair("uid-1", "uid-2");
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.value).toBe(true);
      }

      // 反向检查
      const result2 = await duplicateManager.hasPair("uid-2", "uid-1");
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value).toBe(true);
      }
    });

    it("应该检测到不存在的重复对", async () => {
      const result = await duplicateManager.hasPair("uid-1", "uid-2");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe("持久化", () => {
    it("应该能够保存和加载重复对", async () => {
      const pair: Omit<DuplicatePair, "id" | "detectedAt"> = {
        noteA: { nodeId: "uid-1", name: "A", path: "a.md" },
        noteB: { nodeId: "uid-2", name: "B", path: "b.md" },
        type: "Domain",
        similarity: 0.95,
        status: "pending",
      };

      await duplicateManager.addPair(pair);

      // 创建新的管理器实例并加载
      const newManager = new DuplicateManager(storage);
      const loadResult = await newManager.load();
      expect(loadResult.ok).toBe(true);

      const pendingResult = await newManager.getPendingPairs();
      expect(pendingResult.ok).toBe(true);
      if (pendingResult.ok) {
        expect(pendingResult.value.length).toBe(1);
        expect(pendingResult.value[0].noteA.nodeId).toBe("uid-1");
      }
    });
  });
});
