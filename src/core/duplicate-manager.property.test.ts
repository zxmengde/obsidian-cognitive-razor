/**
 * DuplicateManager 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { DuplicateManager } from "./duplicate-manager";
import { FileStorage } from "../data/file-storage";
import { DuplicatePair, CRType } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("DuplicateManager 属性测试", () => {
  // 生成器：知识类型
  const crTypeArb = fc.constantFrom<CRType>(
    "Domain",
    "Issue",
    "Theory",
    "Entity",
    "Mechanism"
  );

  // 生成器：重复对状态
  const statusArb = fc.constantFrom("pending", "merging", "merged", "dismissed");

  // 生成器：重复对（不包含 id 和 detectedAt）
  const duplicatePairArb = fc.record({
    noteA: fc.record({
      nodeId: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      path: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    noteB: fc.record({
      nodeId: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      path: fc.string({ minLength: 1, maxLength: 100 }),
    }),
    type: crTypeArb,
    similarity: fc.float({ min: 0, max: 1, noNaN: true }),
    status: statusArb,
  });

  /**
   * **Feature: cognitive-razor, Property 6: 重复对显示完整性**
   * 
   * 对于任意记录的重复对，在 DuplicatesPanel 中显示时必须包含两个概念的名称、相似度百分比和类型信息。
   * 
   * **验证需求：2.3, 2.4**
   */
  it("属性 6: 重复对显示完整性 - 所有重复对必须包含完整的显示信息", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(duplicatePairArb, { minLength: 1, maxLength: 10 }),
        async (pairs) => {
          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `duplicate-manager-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建新的存储和管理器实例
            const testStorage = new FileStorage({ dataDir: testDir });
            const testManager = new DuplicateManager(testStorage);
            await testManager.load();

            // 添加所有重复对
            const addedIds: string[] = [];
            for (const pair of pairs) {
              const result = await testManager.addPair(pair);
              if (result.ok) {
                addedIds.push(result.value);
              }
            }

            // 验证：所有添加的重复对都能被获取
            for (const id of addedIds) {
              const getPairResult = await testManager.getPair(id);
              expect(getPairResult.ok).toBe(true);

              if (getPairResult.ok && getPairResult.value) {
                const pair = getPairResult.value;

                // 验证：必须包含 noteA 的完整信息
                expect(pair.noteA).toBeDefined();
                expect(pair.noteA.nodeId).toBeTruthy();
                expect(pair.noteA.name).toBeTruthy();
                expect(pair.noteA.path).toBeTruthy();

                // 验证：必须包含 noteB 的完整信息
                expect(pair.noteB).toBeDefined();
                expect(pair.noteB.nodeId).toBeTruthy();
                expect(pair.noteB.name).toBeTruthy();
                expect(pair.noteB.path).toBeTruthy();

                // 验证：必须包含类型信息
                expect(pair.type).toBeDefined();
                expect(["Domain", "Issue", "Theory", "Entity", "Mechanism"]).toContain(
                  pair.type
                );

                // 验证：必须包含相似度信息（0-1 范围）
                expect(pair.similarity).toBeDefined();
                expect(pair.similarity).toBeGreaterThanOrEqual(0);
                expect(pair.similarity).toBeLessThanOrEqual(1);

                // 验证：必须包含状态信息
                expect(pair.status).toBeDefined();
                expect(["pending", "merging", "merged", "dismissed"]).toContain(
                  pair.status
                );

                // 验证：必须包含检测时间
                expect(pair.detectedAt).toBeDefined();
                expect(new Date(pair.detectedAt).getTime()).toBeGreaterThan(0);

                // 验证：必须包含 ID
                expect(pair.id).toBeDefined();
                expect(pair.id).toBeTruthy();
              }
            }

            // 验证：getPendingPairs 返回的重复对也包含完整信息
            const pendingResult = await testManager.getPendingPairs();
            expect(pendingResult.ok).toBe(true);

            if (pendingResult.ok) {
              for (const pair of pendingResult.value) {
                // 验证完整性
                expect(pair.noteA.nodeId).toBeTruthy();
                expect(pair.noteA.name).toBeTruthy();
                expect(pair.noteB.nodeId).toBeTruthy();
                expect(pair.noteB.name).toBeTruthy();
                expect(pair.type).toBeTruthy();
                expect(pair.similarity).toBeGreaterThanOrEqual(0);
                expect(pair.similarity).toBeLessThanOrEqual(1);
              }
            }

            // 验证：getPairsByType 返回的重复对也包含完整信息
            const types: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
            for (const type of types) {
              const typeResult = await testManager.getPairsByType(type);
              expect(typeResult.ok).toBe(true);

              if (typeResult.ok) {
                for (const pair of typeResult.value) {
                  // 验证类型匹配
                  expect(pair.type).toBe(type);
                  
                  // 验证完整性
                  expect(pair.noteA.nodeId).toBeTruthy();
                  expect(pair.noteA.name).toBeTruthy();
                  expect(pair.noteB.nodeId).toBeTruthy();
                  expect(pair.noteB.name).toBeTruthy();
                  expect(pair.similarity).toBeGreaterThanOrEqual(0);
                  expect(pair.similarity).toBeLessThanOrEqual(1);
                }
              }
            }

            return true;
          } finally {
            // 清理测试目录
            if (fs.existsSync(testDir)) {
              fs.rmSync(testDir, { recursive: true, force: true });
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
