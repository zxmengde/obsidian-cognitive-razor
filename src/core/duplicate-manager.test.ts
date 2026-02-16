/**
 * DuplicateManager 单元测试
 *
 * 测试重复检测核心逻辑：向量相似度计算、分页检测、状态管理
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DuplicateManager } from "./duplicate-manager";
import { ok } from "../types";
import type { ILogger, DuplicatePairsStore, ConceptVector, CRType } from "../types";
import type { VectorIndex } from "./vector-index";
import type { FileStorage } from "../data/file-storage";
import type { SettingsStore } from "../data/settings-store";
import { SimpleLockManager } from "./lock-manager";

function createLogger(): ILogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        getLogContent: () => "",
        clear: () => {},
    };
}

function createFileStorage(files: Map<string, string>): FileStorage {
    return {
        exists: vi.fn(async (path: string) => files.has(path)),
        read: vi.fn(async (path: string) => {
            const value = files.get(path);
            return value !== undefined ? ok(value) : ok("");
        }),
        write: vi.fn(async (path: string, content: string) => {
            files.set(path, content);
            return ok(undefined);
        }),
        atomicWrite: vi.fn(async (path: string, content: string) => {
            files.set(path, content);
            return ok(undefined);
        }),
    } as unknown as FileStorage;
}

function createSettingsStore(threshold = 0.85): SettingsStore {
    return {
        getSettings: () => ({
            similarityThreshold: threshold,
        }),
    } as unknown as SettingsStore;
}

function createVectorIndex(vectors: ConceptVector[]): VectorIndex {
    return {
        getVectorsByType: vi.fn(async (_type: CRType) =>
            ok(vectors)
        ),
    } as unknown as VectorIndex;
}

/** 生成单位向量 */
function unitVector(dim: number, index: number): number[] {
    const v = new Array(dim).fill(0);
    v[index % dim] = 1;
    return v;
}

/** 生成相似向量（余弦相似度接近 1） */
function similarVector(base: number[], noise = 0.01): number[] {
    return base.map((v) => v + (Math.random() - 0.5) * noise);
}

describe("DuplicateManager", () => {
    let lockManager: SimpleLockManager;
    let logger: ILogger;

    beforeEach(() => {
        lockManager = new SimpleLockManager();
        logger = createLogger();
    });

    describe("初始化", () => {
        it("空存储文件时创建新存储", async () => {
            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore();
            const vectorIndex = createVectorIndex([]);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            const result = await manager.initialize();

            expect(result.ok).toBe(true);
            expect(files.has("data/duplicate-pairs.json")).toBe(true);
        });

        it("加载已有存储", async () => {
            const store: DuplicatePairsStore = {
                version: "2.0.0",
                pairs: [{
                    id: "pair-1",
                    nodeIdA: "a",
                    nodeIdB: "b",
                    type: "Entity",
                    similarity: 0.9,
                    detectedAt: "2025-01-01 00:00:00",
                    status: "pending",
                }],
                dismissedPairs: [],
            };
            const files = new Map([
                ["data/duplicate-pairs.json", JSON.stringify(store)],
            ]);
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore();
            const vectorIndex = createVectorIndex([]);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            const result = await manager.initialize();

            expect(result.ok).toBe(true);
            expect(manager.getPendingPairs()).toHaveLength(1);
        });
    });

    describe("重复检测", () => {
        it("相似向量被检测为重复", async () => {
            const dim = 8;
            const baseVec = [1, 0, 0, 0, 0, 0, 0, 0];
            const similarVec = similarVector(baseVec, 0.001);

            const existingVectors: ConceptVector[] = [{
                id: "existing-1",
                type: "Entity",
                embedding: baseVec,
                text: "existing concept",
            }];

            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore(0.9);
            const vectorIndex = createVectorIndex(existingVectors);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            await manager.initialize();

            const result = await manager.detect("new-1", "Entity", similarVec);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBeGreaterThanOrEqual(1);
                expect(result.value[0].nodeIdA).toBe("new-1");
                expect(result.value[0].nodeIdB).toBe("existing-1");
            }
        });

        it("不相似向量不被检测为重复", async () => {
            const existingVectors: ConceptVector[] = [{
                id: "existing-1",
                type: "Entity",
                embedding: unitVector(8, 0),
                text: "concept A",
            }];

            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore(0.9);
            const vectorIndex = createVectorIndex(existingVectors);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            await manager.initialize();

            // 正交向量，余弦相似度 = 0
            const result = await manager.detect("new-1", "Entity", unitVector(8, 1));
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(0);
            }
        });

        it("排除自身向量", async () => {
            const vec = [1, 0, 0, 0];
            const existingVectors: ConceptVector[] = [{
                id: "self-1",
                type: "Entity",
                embedding: vec,
                text: "self",
            }];

            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore(0.5);
            const vectorIndex = createVectorIndex(existingVectors);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            await manager.initialize();

            const result = await manager.detect("self-1", "Entity", vec);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(0);
            }
        });

        it("类型锁冲突时返回空数组", async () => {
            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore();
            const vectorIndex = createVectorIndex([]);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            await manager.initialize();

            // 预先获取类型锁
            lockManager.tryAcquire("type:Entity");

            const result = await manager.detect("new-1", "Entity", [1, 0, 0, 0]);
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value).toHaveLength(0);
            }

            lockManager.release("type:Entity");
        });
    });

    describe("状态管理", () => {
        it("markAsNonDuplicate 将对移入 dismissed", async () => {
            const store: DuplicatePairsStore = {
                version: "2.0.0",
                pairs: [{
                    id: "pair-1",
                    nodeIdA: "a",
                    nodeIdB: "b",
                    type: "Entity",
                    similarity: 0.9,
                    detectedAt: "2025-01-01 00:00:00",
                    status: "pending",
                }],
                dismissedPairs: [],
            };
            const files = new Map([
                ["data/duplicate-pairs.json", JSON.stringify(store)],
            ]);
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore();
            const vectorIndex = createVectorIndex([]);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            await manager.initialize();

            const result = await manager.markAsNonDuplicate("pair-1");
            expect(result.ok).toBe(true);
            expect(manager.getPendingPairs()).toHaveLength(0);
            expect(manager.getDismissedPairs()).toHaveLength(1);
        });

        it("subscribe 接收状态变更通知", async () => {
            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore(0.1); // 低阈值
            const existingVectors: ConceptVector[] = [{
                id: "existing-1",
                type: "Entity",
                embedding: [1, 0, 0, 0],
                text: "concept",
            }];
            const vectorIndex = createVectorIndex(existingVectors);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            await manager.initialize();

            const notifications: number[] = [];
            manager.subscribe((pairs) => {
                notifications.push(pairs.length);
            });

            await manager.detect("new-1", "Entity", [0.99, 0.01, 0, 0]);

            // 应该收到通知
            expect(notifications.length).toBeGreaterThanOrEqual(1);
        });

        it("getPendingPairs 未初始化时返回空数组", () => {
            const files = new Map<string, string>();
            const fileStorage = createFileStorage(files);
            const settingsStore = createSettingsStore();
            const vectorIndex = createVectorIndex([]);

            const manager = new DuplicateManager(
                vectorIndex, fileStorage, logger, settingsStore, lockManager
            );
            // 不调用 initialize
            expect(manager.getPendingPairs()).toEqual([]);
        });
    });
});
