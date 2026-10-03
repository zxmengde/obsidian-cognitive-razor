import { afterEach, describe, expect, it, vi } from "vitest";
import type { Vault } from "obsidian";
import { err, ok } from "../types";
import type { ConceptVector, CRType, ILogger, VectorIndexMeta } from "../types";
import { FileStorage } from "../data/file-storage";
import { VectorIndex } from "./vector-index";
import type { CruidCache } from "./cruid-cache";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { resolveVectorIndexConfig } from "./vector-config";

interface StorageControls {
  failNextMetaWrite: boolean;
  onReadVector?: (type: CRType, id: string) => Promise<void>;
  onWriteMeta?: (meta: VectorIndexMeta) => Promise<void>;
  onWriteVector?: (type: CRType, id: string) => Promise<void>;
}

interface StorageHarness {
  storage: FileStorage;
  vectors: Map<string, ConceptVector>;
  controls: StorageControls;
  getMeta(): VectorIndexMeta | undefined;
  mocks: {
    readVectorFile: ReturnType<typeof vi.fn>;
    writeVectorFile: ReturnType<typeof vi.fn>;
    deleteVectorFile: ReturnType<typeof vi.fn>;
    writeVectorIndexMeta: ReturnType<typeof vi.fn>;
    listVectorFiles: ReturnType<typeof vi.fn>;
  };
}

const indexes: VectorIndex[] = [];

afterEach(async () => {
  await Promise.all(indexes.splice(0).map((index) => index.dispose()));
});

function createLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMeta(
  concepts: VectorIndexMeta["concepts"] = {},
  model = "embed",
  dimensions = 3,
  profile = model,
): VectorIndexMeta {
  return {
    version: "5.0",
    embeddingProfile: profile,
    embeddingModel: model,
    dimensions,
    concepts,
  };
}

function createVector(
  id: string,
  type: CRType = "domain",
  embedding: number[] = [1, 0, 0],
  model = "embed",
): ConceptVector {
  return {
    id,
    type,
    embedding: [...embedding],
    metadata: {
      createdAt: 1,
      updatedAt: 2,
      embeddingModel: model,
      dimensions: embedding.length,
    },
  };
}

function cloneMeta(meta: VectorIndexMeta): VectorIndexMeta {
  return {
    ...meta,
    concepts: Object.fromEntries(
      Object.entries(meta.concepts).map(([id, concept]) => [id, { ...concept }]),
    ),
  };
}

function cloneVector(vector: ConceptVector): ConceptVector {
  return {
    ...vector,
    embedding: [...vector.embedding],
    metadata: { ...vector.metadata },
  };
}

function vectorKey(type: CRType, id: string): string {
  return `${type}/${id}`;
}

function createStorage(
  initialMeta?: VectorIndexMeta,
  initialVectors: ConceptVector[] = [],
): StorageHarness {
  let meta = initialMeta ? cloneMeta(initialMeta) : undefined;
  const vectors = new Map(
    initialVectors.map((vector) => [vectorKey(vector.type, vector.id), cloneVector(vector)]),
  );
  const controls: StorageControls = { failNextMetaWrite: false };

  const readVectorFile = vi.fn(async (type: CRType, id: string) => {
    await controls.onReadVector?.(type, id);
    const vector = vectors.get(vectorKey(type, id));
    return vector
      ? ok(cloneVector(vector))
      : err("E301_FILE_NOT_FOUND", `missing vector: ${type}/${id}`);
  });
  const writeVectorFile = vi.fn(async (type: CRType, id: string, vector: ConceptVector) => {
    await controls.onWriteVector?.(type, id);
    vectors.set(vectorKey(type, id), cloneVector(vector));
    return ok(undefined);
  });
  const deleteVectorFile = vi.fn(async (type: CRType, id: string) => {
    vectors.delete(vectorKey(type, id));
    return ok(undefined);
  });
  const writeVectorIndexMeta = vi.fn(async (next: VectorIndexMeta) => {
    await controls.onWriteMeta?.(next);
    if (controls.failNextMetaWrite) {
      controls.failNextMetaWrite = false;
      return err("E303_DISK_FULL", "metadata write failed");
    }
    meta = cloneMeta(next);
    return ok(undefined);
  });
  const listVectorFiles = vi.fn(async () => ok(
    [...vectors.keys()].map((key) => {
      const [type, id] = key.split("/") as [CRType, string];
      return { type, id, path: `data/vectors/${type}/${id}.json` };
    }).sort((first, second) => first.path.localeCompare(second.path)),
  ));

  const storage = {
    readVectorIndexMeta: vi.fn(async () => meta
      ? ok(cloneMeta(meta))
      : err("E301_FILE_NOT_FOUND", "missing metadata")),
    writeVectorIndexMeta,
    readVectorFile,
    writeVectorFile,
    deleteVectorFile,
    listVectorFiles,
  } as unknown as FileStorage;

  return {
    storage,
    vectors,
    controls,
    getMeta: () => meta ? cloneMeta(meta) : undefined,
    mocks: {
      readVectorFile,
      writeVectorFile,
      deleteVectorFile,
      writeVectorIndexMeta,
      listVectorFiles,
    },
  };
}

function createIndex(
  harness: StorageHarness,
  model = "embed",
  dimension: number | undefined = 3,
  profile = model,
  cruidCache: CruidCache | null = null,
): VectorIndex {
  const index = new VectorIndex(
    harness.storage,
    model,
    dimension,
    createLogger(),
    cruidCache,
    profile,
  );
  indexes.push(index);
  return index;
}

function createUnconfiguredIndex(
  harness: StorageHarness,
  profile = "embed",
  cruidCache: CruidCache | null = null,
): VectorIndex {
  const index = new VectorIndex(
    harness.storage,
    "embed",
    undefined,
    createLogger(),
    cruidCache,
    profile,
  );
  indexes.push(index);
  return index;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("VectorIndex 当前持久化契约", () => {
  it("rebuilds an empty index before its embedding dimension has been inferred", async () => {
    const storage = new FileStorage({ adapter: {} } as unknown as Vault);
    vi.spyOn(storage, "readVectorIndexMeta").mockResolvedValue(ok(createMeta({}, "embed", 0)));
    const write = vi.spyOn(storage, "atomicWrite").mockResolvedValue(ok(undefined));
    const index = new VectorIndex(storage, "embed");
    indexes.push(index);
    expect((await index.load()).ok).toBe(true);
    expect(await index.replaceAll([])).toEqual(ok(0));
    expect(JSON.parse(write.mock.calls[0][1])).toMatchObject({ dimensions: 0, concepts: {} });
  });

  it("缺失元数据时只创建最小 v4 索引", async () => {
    const harness = createStorage();
    const index = createIndex(harness);

    expect((await index.load()).ok).toBe(true);
    expect(harness.getMeta()).toEqual(createMeta());
    expect(harness.mocks.writeVectorIndexMeta).toHaveBeenCalledTimes(1);
  });

  it("embedding 配置变化时提交空索引并清理已登记向量", async () => {
    const oldVector = createVector("old");
    const harness = createStorage(
      createMeta({ old: { type: "domain" } }),
      [oldVector],
    );
    const index = createIndex(harness, "embed-v2", 2);

    expect((await index.load()).ok).toBe(true);

    expect(harness.getMeta()).toEqual(createMeta({}, "embed-v2", 2));
    expect(harness.mocks.deleteVectorFile).toHaveBeenCalledWith("domain", "old");
    expect(index.getEmbeddingModel()).toBe("embed-v2");
    expect(index.getEmbeddingDimension()).toBe(2);
  });

  it("未配置维度时从首个 embedding 推断并持久化维度", async () => {
    const harness = createStorage(createMeta({}, "embed", 0));
    const index = createUnconfiguredIndex(harness);

    expect((await index.load()).ok).toBe(true);
    expect(index.getEmbeddingDimension()).toBeUndefined();
    expect((await index.upsert({ uid: "first", type: "domain", embedding: [1, 0, 0, 0] })).ok).toBe(true);
    expect(index.getEmbeddingDimension()).toBe(4);
    expect(harness.getMeta()?.dimensions).toBe(4);

    const restarted = createUnconfiguredIndex(harness);
    expect((await restarted.load()).ok).toBe(true);
    expect(restarted.getEmbeddingDimension()).toBe(4);
    expect((await restarted.upsert({ uid: "second", type: "domain", embedding: [0, 1, 0] })))
      .toMatchObject({ ok: false, error: { code: "E305_VECTOR_MISMATCH" } });
  });

  it("显式清空维度时重置索引并允许重新推断", async () => {
    const vector = createVector("old");
    const harness = createStorage(createMeta({ old: { type: "domain" } }), [vector]);
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    expect((await index.reconfigure("embed", undefined, "embed")).ok).toBe(true);
    expect(index.getEmbeddingDimension()).toBeUndefined();
    expect(harness.getMeta()).toEqual(createMeta({}, "embed", 0));
    expect(harness.vectors.has(vectorKey("domain", "old"))).toBe(false);
    expect((await index.upsert({ uid: "new", type: "domain", embedding: [1, 0, 0, 0, 0] })).ok).toBe(true);
    expect(harness.getMeta()?.dimensions).toBe(5);
  });

  it("盘点缺失、无效和未被索引引用的物理向量文件", async () => {
    const harness = createStorage(
      createMeta({
        keep: { type: "domain" },
        missing: { type: "domain" },
        invalid: { type: "domain" },
      }),
      [
        createVector("keep"),
        createVector("invalid", "domain", [1, 0, 0], "old-model"),
        createVector("orphan", "domain"),
        createVector("keep", "entity"),
      ],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    await expect(index.inspectStorage()).resolves.toMatchObject({
      ok: true,
      value: {
        indexedEntries: 3,
        physicalFiles: 4,
        missingEntries: [{ uid: "missing", type: "domain", reason: "missing-file" }],
        invalidEntries: [{ uid: "invalid", type: "domain", reason: "incompatible-file" }],
        orphanFiles: expect.arrayContaining([
          expect.objectContaining({ id: "keep", type: "entity" }),
          expect.objectContaining({ id: "orphan", type: "domain" }),
        ]),
      },
    });
  });

  it("清理时只删除确认清单中的当前孤儿，重新登记的文件会被跳过", async () => {
    const harness = createStorage(
      createMeta({ keep: { type: "domain" } }),
      [createVector("keep"), createVector("orphan")],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    const report = await index.inspectStorage();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    await expect(index.upsert({ uid: "orphan", type: "domain", embedding: [1, 0, 0] }))
      .resolves.toEqual(ok(undefined));
    await expect(index.cleanupOrphanFiles(report.value.orphanFiles)).resolves.toEqual(ok({
      removed: 0,
      skipped: 1,
      failed: 0,
    }));
    expect(harness.vectors.has(vectorKey("domain", "orphan"))).toBe(true);
  });

  it("盘点并清理插件停止期间删除笔记留下的失联向量", async () => {
    const harness = createStorage(
      createMeta({ keep: { type: "domain" }, deleted: { type: "domain" } }),
      [createVector("keep"), createVector("deleted")],
    );
    const cruidCache = {
      waitUntilReady: vi.fn(async () => undefined),
      has: (uid: string) => uid === "keep",
    } as unknown as CruidCache;
    const index = createIndex(harness, "embed", 3, "embed", cruidCache);
    expect((await index.load()).ok).toBe(true);

    const report = await index.inspectStorage();
    expect(report).toMatchObject({
      ok: true,
      value: {
        staleEntries: [{ uid: "deleted", reason: "note-missing" }],
        orphanFiles: [{ id: "deleted", type: "domain" }],
      },
    });
    if (!report.ok) return;
    await expect(index.cleanupOrphanFiles(report.value.orphanFiles)).resolves.toEqual(ok({
      removed: 1,
      skipped: 0,
      failed: 0,
    }));
    expect(harness.vectors.has(vectorKey("domain", "deleted"))).toBe(false);
    expect(harness.getMeta()?.concepts.deleted).toBeUndefined();
  });

  it("Provider 或端点身份变化时即使模型和维度相同也重置索引", async () => {
    const oldVector = createVector("old");
    const harness = createStorage(
      createMeta({ old: { type: "domain" } }, "embed", 3, "provider-a"),
      [oldVector],
    );
    const index = createIndex(harness, "embed", 3, "provider-b");

    expect((await index.load()).ok).toBe(true);

    expect(harness.getMeta()).toEqual(createMeta({}, "embed", 3, "provider-b"));
    expect(harness.mocks.deleteVectorFile).toHaveBeenCalledWith("domain", "old");
    expect(index.getEmbeddingProfile()).toBe("provider-b");
  });

  it("桶加载会移除缺失向量的元数据并保留有效条目", async () => {
    const goodVector = createVector("good");
    const harness = createStorage(
      createMeta({
        missing: { type: "domain" },
        good: { type: "domain" },
      }),
      [goodVector],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    const result = await index.getVectorsByType("domain");

    expect(result).toMatchObject({ ok: true, value: [{ id: "good" }] });
    expect(harness.getMeta()?.concepts).toEqual({ good: { type: "domain" } });
    expect(harness.mocks.writeVectorIndexMeta).toHaveBeenCalledTimes(1);
    expect(harness.mocks.deleteVectorFile).toHaveBeenCalledWith("domain", "missing");
  });

  it("桶加载遇到暂时性 I/O 错误时保留元数据和向量文件", async () => {
    const vector = createVector("keep");
    const harness = createStorage(
      createMeta({ keep: { type: "domain" } }),
      [vector],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    harness.mocks.readVectorFile.mockResolvedValueOnce(
      err("E302_PERMISSION_DENIED", "temporarily unreadable"),
    );

    const result = await index.getVectorsByType("domain");

    expect(result).toMatchObject({ ok: false, error: { code: "E302_PERMISSION_DENIED" } });
    expect(harness.getMeta()?.concepts).toEqual({ keep: { type: "domain" } });
    expect(harness.mocks.writeVectorIndexMeta).not.toHaveBeenCalled();
    expect(harness.mocks.deleteVectorFile).not.toHaveBeenCalled();
  });

  it("search 拒绝无效 topK 和无效向量，并返回稳定的 topK 排序", async () => {
    const harness = createStorage(
      createMeta({ first: { type: "domain" }, second: { type: "domain" } }),
      [
        createVector("first", "domain", [1, 0, 0]),
        createVector("second", "domain", [0.8, 0.6, 0]),
      ],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    for (const topK of [0, -1, 1.5]) {
      expect(await index.search("domain", [1, 0, 0], topK))
        .toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
    }
    expect(await index.search("domain", [0, 0, 0], 1))
      .toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
    expect(await index.search("domain", [1, 0, 0], 1))
      .toMatchObject({ ok: true, value: [{ uid: "first" }] });
  });

  it("upsert 元数据保存失败时恢复原向量和内存视图", async () => {
    const original = createVector("same", "domain", [1, 0, 0]);
    const harness = createStorage(
      createMeta({ same: { type: "domain" } }),
      [original],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    harness.controls.failNextMetaWrite = true;

    const result = await index.upsert({
      uid: "same",
      type: "domain",
      embedding: [0, 1, 0],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(harness.vectors.get(vectorKey("domain", "same"))?.embedding)
      .toEqual(original.embedding);
    expect(harness.getMeta()?.concepts).toEqual({ same: { type: "domain" } });
    expect(await index.search("domain", [1, 0, 0], 1))
      .toMatchObject({ ok: true, value: [{ uid: "same", similarity: 1 }] });
  });

  it("upsert 无法读取旧向量时不覆盖不可回滚的数据", async () => {
    const original = createVector("same", "domain", [1, 0, 0]);
    const harness = createStorage(
      createMeta({ same: { type: "domain" } }),
      [original],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    harness.mocks.readVectorFile.mockResolvedValueOnce(
      err("E302_PERMISSION_DENIED", "temporarily unreadable"),
    );

    const result = await index.upsert({
      uid: "same",
      type: "domain",
      embedding: [0, 1, 0],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "E302_PERMISSION_DENIED" } });
    expect(harness.mocks.writeVectorFile).not.toHaveBeenCalled();
    expect(harness.vectors.get(vectorKey("domain", "same"))?.embedding).toEqual([1, 0, 0]);
  });

  it("桶读取跨过失败写入时重试，不暴露未提交向量", async () => {
    const original = createVector("same", "domain", [1, 0, 0]);
    const harness = createStorage(
      createMeta({ same: { type: "domain" } }),
      [original],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    const readStarted = deferred();
    const releaseFirstRead = deferred();
    let readCount = 0;
    harness.controls.onReadVector = async () => {
      readCount++;
      if (readCount === 1) {
        readStarted.resolve();
        await releaseFirstRead.promise;
      }
    };
    const metaWriteStarted = deferred();
    const releaseMetaWrite = deferred();
    harness.controls.onWriteMeta = async () => {
      metaWriteStarted.resolve();
      await releaseMetaWrite.promise;
    };
    harness.controls.failNextMetaWrite = true;

    const reading = index.getVectorsByType("domain");
    await readStarted.promise;
    const upsert = index.upsert({
      uid: "same",
      type: "domain",
      embedding: [0, 1, 0],
    });
    await metaWriteStarted.promise;
    releaseFirstRead.resolve();
    await Promise.resolve();
    releaseMetaWrite.resolve();

    expect(await upsert).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(await reading).toMatchObject({
      ok: true,
      value: [{ id: "same", embedding: [1, 0, 0] }],
    });
    expect(readCount).toBe(3);
  });

  it("delete 元数据保存失败时不删除向量文件", async () => {
    const vector = createVector("keep");
    const harness = createStorage(
      createMeta({ keep: { type: "domain" } }),
      [vector],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    harness.controls.failNextMetaWrite = true;

    const result = await index.delete("keep");

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(harness.vectors.has(vectorKey("domain", "keep"))).toBe(true);
    expect(harness.mocks.deleteVectorFile).not.toHaveBeenCalled();
  });

  it("delete 成功时同时移除索引元数据和对应向量文件", async () => {
    const harness = createStorage(
      createMeta({ remove: { type: "domain" } }),
      [createVector("remove")],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    await expect(index.delete("remove")).resolves.toEqual(ok(undefined));

    expect(harness.getMeta()?.concepts).toEqual({});
    expect(harness.vectors.has(vectorKey("domain", "remove"))).toBe(false);
    expect(harness.mocks.deleteVectorFile).toHaveBeenCalledWith("domain", "remove");
  });

  it("并发修改严格串行，不争用同一个元数据提交", async () => {
    const harness = createStorage(createMeta());
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const order: string[] = [];
    harness.controls.onWriteVector = async (_type, id) => {
      order.push(`start:${id}`);
      if (id === "first") {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      order.push(`end:${id}`);
    };

    const first = index.upsert({ uid: "first", type: "domain", embedding: [1, 0, 0] });
    await firstStarted.promise;
    const second = index.upsert({ uid: "second", type: "domain", embedding: [0, 1, 0] });
    await Promise.resolve();
    expect(harness.mocks.writeVectorFile).toHaveBeenCalledTimes(1);

    releaseFirst.resolve();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
    expect(Object.keys(harness.getMeta()?.concepts ?? {})).toEqual(["first", "second"]);
  });

  it("replaceAll 输入非法时保留现有索引和向量", async () => {
    const original = createVector("keep");
    const harness = createStorage(
      createMeta({ keep: { type: "domain" } }),
      [original],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    const result = await index.replaceAll([
      { uid: "duplicate", type: "domain", embedding: [1, 0, 0] },
      { uid: "duplicate", type: "issue", embedding: [0, 1, 0] },
    ]);

    expect(result).toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
    expect(harness.getMeta()).toEqual(createMeta({ keep: { type: "domain" } }));
    expect(harness.vectors.get(vectorKey("domain", "keep"))?.embedding)
      .toEqual(original.embedding);
    expect(harness.mocks.deleteVectorFile).not.toHaveBeenCalled();
  });

  it("replaceAll 只提交一次元数据并移除不再存在的旧向量", async () => {
    const harness = createStorage(
      createMeta({ keep: { type: "domain" }, remove: { type: "issue" } }),
      [createVector("keep"), createVector("remove", "issue")],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);

    const result = await index.replaceAll([
      { uid: "keep", type: "domain", embedding: [0, 1, 0] },
      { uid: "new", type: "theory", embedding: [0, 0, 1] },
    ]);

    expect(result).toEqual(ok(2));
    expect(harness.mocks.writeVectorIndexMeta).toHaveBeenCalledTimes(1);
    expect(harness.getMeta()?.concepts).toEqual({
      keep: { type: "domain" },
      new: { type: "theory" },
    });
    expect(harness.vectors.has(vectorKey("issue", "remove"))).toBe(false);
    expect(harness.vectors.get(vectorKey("domain", "keep"))?.embedding).toEqual([0, 1, 0]);
  });

  it("replaceAll 元数据提交失败时恢复被覆盖向量并保留旧索引", async () => {
    const original = createVector("keep", "domain", [1, 0, 0]);
    const harness = createStorage(
      createMeta({ keep: { type: "domain" } }),
      [original],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    harness.controls.failNextMetaWrite = true;

    const result = await index.replaceAll([
      { uid: "keep", type: "domain", embedding: [0, 1, 0] },
      { uid: "new", type: "theory", embedding: [0, 0, 1] },
    ]);

    expect(result).toMatchObject({ ok: false, error: { code: "E303_DISK_FULL" } });
    expect(harness.getMeta()).toEqual(createMeta({ keep: { type: "domain" } }));
    expect(harness.vectors.get(vectorKey("domain", "keep"))?.embedding)
      .toEqual(original.embedding);
    expect(harness.vectors.has(vectorKey("theory", "new"))).toBe(false);
  });

  it("dispose 等待已开始的写入并拒绝后续工作", async () => {
    const harness = createStorage(createMeta());
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    const writeStarted = deferred();
    const releaseWrite = deferred();
    harness.controls.onWriteVector = async () => {
      writeStarted.resolve();
      await releaseWrite.promise;
    };

    const upsert = index.upsert({ uid: "pending", type: "domain", embedding: [1, 0, 0] });
    await writeStarted.promise;
    let disposed = false;
    const disposal = index.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    releaseWrite.resolve();
    expect((await upsert).ok).toBe(true);
    await disposal;
    expect(await index.search("domain", [1, 0, 0], 1))
      .toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
  });

  it("dispose 等待已开始的桶读取", async () => {
    const harness = createStorage(
      createMeta({ pending: { type: "domain" } }),
      [createVector("pending")],
    );
    const index = createIndex(harness);
    expect((await index.load()).ok).toBe(true);
    const readStarted = deferred();
    const releaseRead = deferred();
    harness.controls.onReadVector = async () => {
      readStarted.resolve();
      await releaseRead.promise;
    };

    const reading = index.getVectorsByType("domain");
    await readStarted.promise;
    let disposed = false;
    const disposal = index.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    releaseRead.resolve();
    expect(await reading).toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
    await disposal;
  });
});

describe("FileStorage 向量边界", () => {
  it("在访问 adapter 前拒绝可能逃逸目录的 concept ID", async () => {
    const storage = new FileStorage({ adapter: {} } as unknown as Vault);

    const result = await storage.writeVectorFile(
      "domain",
      "../escape",
      createVector("../escape"),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
  });

  it("拒绝旧版本或结构不完整的索引元数据", async () => {
    const storage = new FileStorage({
      adapter: {
        read: vi.fn(async () => JSON.stringify({ version: "1.0.0", concepts: {} })),
      },
    } as unknown as Vault);

    const result = await storage.readVectorIndexMeta();

    expect(result).toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
  });
});

// Exercise the effective configuration through the real mutation boundary,
// not only the profile comparator, using synthetic metadata/vector storage.
describe("effective endpoint configuration transitions", () => {
  function config(baseUrl: string, apiKey = "test-only") {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.embedding = {
      apiKey, baseUrl, enabled: true, apiFormat: "disabled",
      embeddingApiFormat: "openai-embeddings", defaultChatModel: "",
      defaultEmbedModel: "embed", parameters: { embeddingDimension: 3 },
    };
    settings.defaultProviderId = "embedding";
    return resolveVectorIndexConfig(settings);
  }

  it("retains registered and physical vectors for equivalent origin and /v1 URLs", async () => {
    const before = config("https://relay.example");
    const after = config("https://relay.example/v1/");
    const storage = createStorage();
    const index = createIndex(storage, before.model, before.dimension, before.profile);
    expect((await index.load()).ok).toBe(true);
    expect((await index.upsert({ uid: "node", type: "domain", embedding: [1, 0, 0] })).ok).toBe(true);
    expect((await index.reconfigure(after.model, after.dimension, after.profile)).ok).toBe(true);
    expect(index.has("node")).toBe(true);
    expect(storage.vectors.has("domain/node")).toBe(true);
  });

  it("clears incompatible registered and physical vectors after a deployment query change", async () => {
    const before = config("https://relay.example/v1?deployment=alpha");
    const after = config("https://relay.example/v1?deployment=beta");
    const storage = createStorage();
    const index = createIndex(storage, before.model, before.dimension, before.profile);
    expect((await index.load()).ok).toBe(true);
    expect((await index.upsert({ uid: "node", type: "domain", embedding: [1, 0, 0] })).ok).toBe(true);
    expect((await index.reconfigure(after.model, after.dimension, after.profile)).ok).toBe(true);
    expect(index.has("node")).toBe(false);
    expect(storage.vectors.has("domain/node")).toBe(false);
  });

  it("retains vectors when recognized query or header credentials rotate", async () => {
    const before = config("https://relay.example/v1?deployment=alpha&api_key=old", "old-header");
    const after = config("https://relay.example/v1?API_KEY=new&deployment=alpha", "new-header");
    const storage = createStorage();
    const index = createIndex(storage, before.model, before.dimension, before.profile);
    expect((await index.load()).ok).toBe(true);
    expect((await index.upsert({ uid: "node", type: "domain", embedding: [1, 0, 0] })).ok).toBe(true);
    expect((await index.reconfigure(after.model, after.dimension, after.profile)).ok).toBe(true);
    expect(index.has("node")).toBe(true);
    expect(storage.vectors.has("domain/node")).toBe(true);
  });

  it("corrects an old bare-origin identity once, then keeps equivalent canonical URLs stable", async () => {
    const oldBareProfile = JSON.stringify({ providerId: "embedding", endpoint: "https://relay.example", apiFormat: "openai-embeddings", model: "embed" });
    const canonical = config("https://relay.example");
    const storage = createStorage(createMeta({ node: { type: "domain" } }, "embed", 3, oldBareProfile), [createVector("node")]);
    const index = createIndex(storage, canonical.model, canonical.dimension, canonical.profile);
    expect((await index.load()).ok).toBe(true);
    expect(index.has("node")).toBe(false);
    const writesAfterCorrection = storage.mocks.writeVectorIndexMeta.mock.calls.length;
    const equivalent = config("https://relay.example/v1");
    expect((await index.reconfigure(equivalent.model, equivalent.dimension, equivalent.profile)).ok).toBe(true);
    expect(storage.mocks.writeVectorIndexMeta.mock.calls.length).toBe(writesAfterCorrection);
  });
});

describe("offline note deletion", () => {
  it('search must exclude a note deleted while the plugin was stopped', async () => {
    const h=createStorage(createMeta({deleted:{type:'domain'},live:{type:'domain'}}), [createVector('deleted','domain',[1,0,0]),createVector('live','domain',[0.8,0.6,0])]);
    const cache={waitUntilReady:async()=>{},has:(id:string)=>id==='live',getName:(id:string)=>id==='live'?'Live':null,getPath:(id:string)=>id==='live'?'notes/live.md':null} as unknown as CruidCache;
    const index=createIndex(h,'embed',3,'embed',cache); await index.load();
    const result=await index.search('domain',[1,0,0],1);
    expect(result).toMatchObject({ok:true,value:[{uid:'live',path:'notes/live.md'}]});
  });
});
