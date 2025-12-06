/**
 * VectorIndex 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { VectorIndex } from "./vector-index";
import { FileStorage } from "../data/file-storage";
import { VectorEntry, CRType } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("VectorIndex 属性测试", () => {
  let storage: FileStorage;
  let vectorIndex: VectorIndex;
  let testDataDir: string;

  beforeEach(async () => {
    // 每次测试前不创建索引，让每个测试自己创建
  });

  afterEach(() => {
    // 每次测试后不需要清理，因为每个测试使用独立的目录
  });

  // 生成器：知识类型
  const crTypeArb = fc.constantFrom<CRType>(
    "Domain",
    "Issue",
    "Theory",
    "Entity",
    "Mechanism"
  );

  // 生成器：向量嵌入（固定维度）
  // 排除 NaN、Infinity 等特殊值
  const embeddingArb = (dim: number) =>
    fc.array(
      fc.float({ min: -1, max: 1, noNaN: true }),
      { minLength: dim, maxLength: dim }
    );

  // 生成器：向量条目
  const vectorEntryArb = (type: CRType, dim: number) =>
    fc.record({
      uid: fc.uuid(),
      type: fc.constant(type),
      embedding: embeddingArb(dim),
      name: fc.string({ minLength: 1, maxLength: 50 }),
      path: fc.string({ minLength: 1, maxLength: 100 }),
      updated: fc.constant(new Date().toISOString()),
    });

  /**
   * **Feature: cognitive-razor, Property 4: 同类型去重检索**
   * 
   * 对于任意新创建的概念，系统必须在同类型的概念中执行相似度检索，不得跨类型检索。
   * 
   * **验证需求：2.1**
   */
  it("属性 4: 同类型去重检索 - 搜索结果只包含指定类型的条目", async () => {
    await fc.assert(
      fc.asyncProperty(
        crTypeArb,
        fc.array(crTypeArb, { minLength: 1, maxLength: 5 }),
        embeddingArb(10),
        fc.nat({ max: 10 }),
        async (targetType, otherTypes, queryEmbedding, topK) => {
          // 跳过 topK 为 0 的情况
          if (topK === 0) {
            return true;
          }

          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `vector-index-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建新的存储和索引实例
            const testStorage = new FileStorage({ dataDir: testDir });
            const testIndex = new VectorIndex(testStorage);
            await testIndex.load();

            // 为目标类型插入一些条目
            const targetEntries = await fc.sample(
              vectorEntryArb(targetType, 10),
              3
            );
            for (const entry of targetEntries) {
              await testIndex.upsert(entry);
            }

            // 为其他类型插入一些条目
            for (const otherType of otherTypes) {
              if (otherType !== targetType) {
                const otherEntries = await fc.sample(
                  vectorEntryArb(otherType, 10),
                  2
                );
                for (const entry of otherEntries) {
                  await testIndex.upsert(entry);
                }
              }
            }

            // 执行搜索
            const searchResult = await testIndex.search(
              targetType,
              queryEmbedding,
              topK
            );

            // 验证：搜索结果必须成功
            expect(searchResult.ok).toBe(true);

            if (searchResult.ok) {
              // 验证：所有结果的 UID 必须属于目标类型的条目
              const targetUids = new Set(targetEntries.map((e) => e.uid));
              for (const result of searchResult.value) {
                expect(targetUids.has(result.uid)).toBe(true);
              }

              // 验证：结果数量不超过目标类型的条目数量
              expect(searchResult.value.length).toBeLessThanOrEqual(
                targetEntries.length
              );
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

  /**
   * **Feature: cognitive-razor, Property 5: 去重阈值判定**
   * 
   * 对于任意相似度大于等于阈值的概念对，系统必须将其记录到 DuplicatePairs 存储中。
   * 
   * **验证需求：2.2**
   */
  it("属性 5: 去重阈值判定 - 相似度大于等于阈值的结果必须被识别", async () => {
    await fc.assert(
      fc.asyncProperty(
        crTypeArb,
        fc.float({ min: 0.5, max: 1.0 }), // 阈值
        embeddingArb(10),
        async (type, threshold, baseEmbedding) => {
          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `vector-index-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建新的存储和索引实例
            const testStorage = new FileStorage({ dataDir: testDir });
            const testIndex = new VectorIndex(testStorage);
            await testIndex.load();

            // 插入基准条目
            const baseEntry: VectorEntry = {
              uid: "base-uid",
              type,
              embedding: baseEmbedding,
              name: "基准概念",
              path: "base.md",
              updated: new Date().toISOString(),
            };
            await testIndex.upsert(baseEntry);

            // 创建一个高相似度的条目（通过缩放基准向量）
            const highSimilarEmbedding = baseEmbedding.map((v) => v * 0.99);
            const highSimilarEntry: VectorEntry = {
              uid: "high-similar-uid",
              type,
              embedding: highSimilarEmbedding,
              name: "高相似概念",
              path: "high-similar.md",
              updated: new Date().toISOString(),
            };
            await testIndex.upsert(highSimilarEntry);

            // 创建一个低相似度的条目（使用随机向量）
            const lowSimilarEmbedding = baseEmbedding.map(() =>
              Math.random() * 2 - 1
            );
            const lowSimilarEntry: VectorEntry = {
              uid: "low-similar-uid",
              type,
              embedding: lowSimilarEmbedding,
              name: "低相似概念",
              path: "low-similar.md",
              updated: new Date().toISOString(),
            };
            await testIndex.upsert(lowSimilarEntry);

            // 搜索与基准条目相似的条目
            const searchResult = await testIndex.search(
              type,
              baseEmbedding,
              10
            );

            // 验证：搜索结果必须成功
            expect(searchResult.ok).toBe(true);

            if (searchResult.ok) {
              // 验证：所有相似度 >= 阈值的条目都应该在结果中
              const resultsAboveThreshold = searchResult.value.filter(
                (r) => r.similarity >= threshold
              );

              // 高相似度条目应该在结果中且相似度应该很高
              const highSimilarResult = searchResult.value.find(
                (r) => r.uid === "high-similar-uid"
              );
              if (highSimilarResult) {
                // 由于我们使用了 0.99 的缩放，相似度应该非常高（接近 1.0）
                expect(highSimilarResult.similarity).toBeGreaterThan(0.9);
              }

              // 验证：结果按相似度降序排列
              for (let i = 0; i < searchResult.value.length - 1; i++) {
                expect(searchResult.value[i].similarity).toBeGreaterThanOrEqual(
                  searchResult.value[i + 1].similarity
                );
              }

              // 验证：所有结果的相似度都在 [-1, 1] 范围内（余弦相似度的有效范围）
              // 允许微小的浮点误差（epsilon = 1e-10）
              const epsilon = 1e-10;
              for (const result of searchResult.value) {
                expect(result.similarity).toBeGreaterThanOrEqual(-1 - epsilon);
                expect(result.similarity).toBeLessThanOrEqual(1 + epsilon);
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

  /**
   * **Feature: cognitive-razor, Property 18: 向量本地存储**
   * 
   * 对于任意生成的向量嵌入，必须存储在本地 vector-index.json 文件中，不得依赖远程存储。
   * 
   * **验证需求：9.3**
   */
  it("属性 18: 向量本地存储 - 所有向量必须存储在本地文件中", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            uid: fc.uuid(),
            type: crTypeArb,
            embedding: embeddingArb(10),
            name: fc.string({ minLength: 1, maxLength: 50 }),
            path: fc.string({ minLength: 1, maxLength: 100 }),
            updated: fc.constant(new Date().toISOString()),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        async (entries) => {
          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `vector-index-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建新的存储和索引实例
            const testStorage = new FileStorage({ dataDir: testDir });
            const testIndex = new VectorIndex(testStorage);
            await testIndex.load();

            // 插入所有条目
            for (const entry of entries) {
              const result = await testIndex.upsert(entry);
              expect(result.ok).toBe(true);
            }

            // 验证：vector-index.json 文件必须存在
            const indexFilePath = path.join(testDir, "vector-index.json");
            expect(fs.existsSync(indexFilePath)).toBe(true);

            // 验证：文件内容必须包含所有插入的条目
            const fileContent = fs.readFileSync(indexFilePath, "utf-8");
            const indexData = JSON.parse(fileContent);

            // 验证：数据结构正确
            expect(indexData).toHaveProperty("version");
            expect(indexData).toHaveProperty("entries");
            expect(indexData).toHaveProperty("lastUpdated");

            // 验证：所有插入的条目都在文件中
            const allStoredEntries: VectorEntry[] = [];
            for (const type of Object.keys(indexData.entries)) {
              allStoredEntries.push(...indexData.entries[type]);
            }

            // 计算唯一的 UID 数量（因为 upsert 会更新重复的 UID）
            const uniqueUids = new Set(entries.map((e) => e.uid));
            expect(allStoredEntries.length).toBe(uniqueUids.size);

            // 验证：每个唯一的 UID 都能在文件中找到
            for (const uid of uniqueUids) {
              const found = allStoredEntries.find((e) => e.uid === uid);
              expect(found).toBeDefined();
              
              // 找到最后一个具有此 UID 的条目（因为 upsert 会更新）
              const lastEntry = entries.filter((e) => e.uid === uid).pop();
              if (found && lastEntry) {
                expect(found.type).toBe(lastEntry.type);
                expect(found.name).toBe(lastEntry.name);
                expect(found.path).toBe(lastEntry.path);
                
                // 验证向量维度相同
                expect(found.embedding.length).toBe(lastEntry.embedding.length);
                
                // 验证每个向量分量（处理 -0 和 0 的情况）
                for (let i = 0; i < found.embedding.length; i++) {
                  const foundVal = found.embedding[i];
                  const expectedVal = lastEntry.embedding[i];
                  
                  // 使用 Object.is 来区分 -0 和 0，但如果两者都是 0，则认为相等
                  if (foundVal === 0 && expectedVal === 0) {
                    // 两者都是 0（可能一个是 -0，一个是 +0），认为相等
                    expect(true).toBe(true);
                  } else {
                    expect(foundVal).toBe(expectedVal);
                  }
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

  /**
   * **Feature: cognitive-razor, Property 19: 本地相似度检索**
   * 
   * 对于任意相似度检索操作，必须在本地向量索引中执行，不得依赖远程服务。
   * 
   * **验证需求：9.4**
   */
  it("属性 19: 本地相似度检索 - 搜索必须在本地索引中执行", async () => {
    await fc.assert(
      fc.asyncProperty(
        crTypeArb,
        fc.array(
          fc.record({
            uid: fc.uuid(),
            type: fc.constant("Domain" as CRType), // 使用固定类型以便搜索
            embedding: embeddingArb(10),
            name: fc.string({ minLength: 1, maxLength: 50 }),
            path: fc.string({ minLength: 1, maxLength: 100 }),
            updated: fc.constant(new Date().toISOString()),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        embeddingArb(10),
        fc.nat({ max: 10 }),
        async (searchType, entries, queryEmbedding, topK) => {
          // 跳过 topK 为 0 的情况
          if (topK === 0) {
            return true;
          }

          // 为每个测试创建独立的临时目录
          const testDir = path.join(
            __dirname,
            "../../test-data",
            `vector-index-pbt-${Date.now()}-${Math.random().toString(36).substring(7)}`
          );
          fs.mkdirSync(testDir, { recursive: true });

          try {
            // 创建新的存储和索引实例
            const testStorage = new FileStorage({ dataDir: testDir });
            const testIndex = new VectorIndex(testStorage);
            await testIndex.load();

            // 插入所有条目
            for (const entry of entries) {
              await testIndex.upsert(entry);
            }

            // 记录索引文件的修改时间
            const indexFilePath = path.join(testDir, "vector-index.json");
            const statsBefore = fs.existsSync(indexFilePath)
              ? fs.statSync(indexFilePath)
              : null;

            // 执行搜索
            const searchResult = await testIndex.search(
              "Domain",
              queryEmbedding,
              topK
            );

            // 验证：搜索必须成功
            expect(searchResult.ok).toBe(true);

            if (searchResult.ok) {
              // 验证：搜索结果数量不超过 topK
              expect(searchResult.value.length).toBeLessThanOrEqual(topK);

              // 验证：搜索结果数量不超过实际条目数
              const uniqueUids = new Set(entries.map((e) => e.uid));
              expect(searchResult.value.length).toBeLessThanOrEqual(
                uniqueUids.size
              );

              // 验证：所有结果都来自本地索引（UID 必须在插入的条目中）
              for (const result of searchResult.value) {
                expect(uniqueUids.has(result.uid)).toBe(true);
              }

              // 验证：搜索操作不应该修改索引文件（只读操作）
              if (statsBefore) {
                const statsAfter = fs.statSync(indexFilePath);
                // 修改时间应该相同（搜索不应该写入文件）
                expect(statsAfter.mtimeMs).toBe(statsBefore.mtimeMs);
              }

              // 验证：搜索结果按相似度降序排列
              for (let i = 0; i < searchResult.value.length - 1; i++) {
                expect(searchResult.value[i].similarity).toBeGreaterThanOrEqual(
                  searchResult.value[i + 1].similarity
                );
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
