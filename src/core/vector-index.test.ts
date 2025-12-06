/**
 * VectorIndex 单元测试
 */

import { VectorIndex } from "./vector-index";
import { FileStorage } from "../data/file-storage";
import { VectorEntry, CRType } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("VectorIndex", () => {
  let storage: FileStorage;
  let vectorIndex: VectorIndex;
  let testDataDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDataDir = path.join(__dirname, "../../test-data", `vector-index-${Date.now()}`);
    fs.mkdirSync(testDataDir, { recursive: true });

    storage = new FileStorage({ dataDir: testDataDir });
    vectorIndex = new VectorIndex(storage);
    await vectorIndex.load();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe("upsert", () => {
    it("应该成功插入新的向量条目", async () => {
      const entry: VectorEntry = {
        uid: "test-uid-1",
        type: "Domain",
        embedding: [0.1, 0.2, 0.3],
        name: "测试概念",
        path: "test/concept.md",
        updated: new Date().toISOString(),
      };

      const result = await vectorIndex.upsert(entry);
      expect(result.ok).toBe(true);

      const stats = vectorIndex.getStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.byType.Domain).toBe(1);
    });

    it("应该成功更新现有的向量条目", async () => {
      const entry: VectorEntry = {
        uid: "test-uid-1",
        type: "Domain",
        embedding: [0.1, 0.2, 0.3],
        name: "测试概念",
        path: "test/concept.md",
        updated: new Date().toISOString(),
      };

      await vectorIndex.upsert(entry);

      // 更新条目
      const updatedEntry: VectorEntry = {
        ...entry,
        embedding: [0.4, 0.5, 0.6],
        name: "更新后的概念",
      };

      const result = await vectorIndex.upsert(updatedEntry);
      expect(result.ok).toBe(true);

      const stats = vectorIndex.getStats();
      expect(stats.totalEntries).toBe(1); // 应该还是 1 个条目
    });

    it("应该拒绝无效的向量条目", async () => {
      const invalidEntry = {
        uid: "",
        type: "Domain" as CRType,
        embedding: [],
        name: "测试",
        path: "test.md",
        updated: new Date().toISOString(),
      };

      const result = await vectorIndex.upsert(invalidEntry);
      expect(result.ok).toBe(false);
    });
  });

  describe("delete", () => {
    it("应该成功删除存在的向量条目", async () => {
      const entry: VectorEntry = {
        uid: "test-uid-1",
        type: "Domain",
        embedding: [0.1, 0.2, 0.3],
        name: "测试概念",
        path: "test/concept.md",
        updated: new Date().toISOString(),
      };

      await vectorIndex.upsert(entry);
      const result = await vectorIndex.delete("test-uid-1");
      expect(result.ok).toBe(true);

      const stats = vectorIndex.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it("应该拒绝删除不存在的向量条目", async () => {
      const result = await vectorIndex.delete("non-existent-uid");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ENTRY_NOT_FOUND");
      }
    });
  });

  describe("search", () => {
    beforeEach(async () => {
      // 插入测试数据
      const entries: VectorEntry[] = [
        {
          uid: "uid-1",
          type: "Domain",
          embedding: [1.0, 0.0, 0.0],
          name: "概念 1",
          path: "concept1.md",
          updated: new Date().toISOString(),
        },
        {
          uid: "uid-2",
          type: "Domain",
          embedding: [0.9, 0.1, 0.0],
          name: "概念 2",
          path: "concept2.md",
          updated: new Date().toISOString(),
        },
        {
          uid: "uid-3",
          type: "Domain",
          embedding: [0.0, 1.0, 0.0],
          name: "概念 3",
          path: "concept3.md",
          updated: new Date().toISOString(),
        },
        {
          uid: "uid-4",
          type: "Issue",
          embedding: [1.0, 0.0, 0.0],
          name: "议题 1",
          path: "issue1.md",
          updated: new Date().toISOString(),
        },
      ];

      for (const entry of entries) {
        await vectorIndex.upsert(entry);
      }
    });

    it("应该返回最相似的 TopK 结果", async () => {
      const queryEmbedding = [1.0, 0.0, 0.0];
      const result = await vectorIndex.search("Domain", queryEmbedding, 2);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value[0].uid).toBe("uid-1"); // 最相似
        expect(result.value[1].uid).toBe("uid-2"); // 第二相似
      }
    });

    it("应该只在同类型中搜索", async () => {
      const queryEmbedding = [1.0, 0.0, 0.0];
      const result = await vectorIndex.search("Domain", queryEmbedding, 10);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(3); // 只有 3 个 Domain 类型
        expect(result.value.every((r) => r.uid.startsWith("uid-"))).toBe(true);
        expect(result.value.every((r) => !r.uid.includes("uid-4"))).toBe(true); // 不包含 Issue 类型
      }
    });

    it("应该按相似度降序排序", async () => {
      const queryEmbedding = [1.0, 0.0, 0.0];
      const result = await vectorIndex.search("Domain", queryEmbedding, 3);

      expect(result.ok).toBe(true);
      if (result.ok) {
        for (let i = 0; i < result.value.length - 1; i++) {
          expect(result.value[i].similarity).toBeGreaterThanOrEqual(
            result.value[i + 1].similarity
          );
        }
      }
    });

    it("应该在空桶中返回空结果", async () => {
      const queryEmbedding = [1.0, 0.0, 0.0];
      const result = await vectorIndex.search("Theory", queryEmbedding, 10);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(0);
      }
    });
  });

  describe("getStats", () => {
    it("应该返回正确的统计信息", async () => {
      const entries: VectorEntry[] = [
        {
          uid: "uid-1",
          type: "Domain",
          embedding: [1.0, 0.0],
          name: "概念 1",
          path: "concept1.md",
          updated: new Date().toISOString(),
        },
        {
          uid: "uid-2",
          type: "Domain",
          embedding: [0.0, 1.0],
          name: "概念 2",
          path: "concept2.md",
          updated: new Date().toISOString(),
        },
        {
          uid: "uid-3",
          type: "Issue",
          embedding: [1.0, 0.0],
          name: "议题 1",
          path: "issue1.md",
          updated: new Date().toISOString(),
        },
      ];

      for (const entry of entries) {
        await vectorIndex.upsert(entry);
      }

      const stats = vectorIndex.getStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.byType.Domain).toBe(2);
      expect(stats.byType.Issue).toBe(1);
      expect(stats.byType.Theory).toBe(0);
    });
  });

  describe("持久化", () => {
    it("应该能够保存和加载索引", async () => {
      const entry: VectorEntry = {
        uid: "test-uid-1",
        type: "Domain",
        embedding: [0.1, 0.2, 0.3],
        name: "测试概念",
        path: "test/concept.md",
        updated: new Date().toISOString(),
      };

      await vectorIndex.upsert(entry);

      // 创建新的索引实例并加载
      const newVectorIndex = new VectorIndex(storage);
      const loadResult = await newVectorIndex.load();
      expect(loadResult.ok).toBe(true);

      const stats = newVectorIndex.getStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.byType.Domain).toBe(1);
    });
  });
});
