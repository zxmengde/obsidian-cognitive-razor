/**
 * 编排器依赖接口（按能力分组，遵循 ISP 接口隔离原则）
 *
 * 每个编排器仅声明自己需要的接口组合（交叉类型），
 * 避免耦合不相关的依赖。main.ts 构造的共享对象满足所有子接口。
 *
 * 使用 `import type` 避免循环依赖。
 */

import type { App } from "obsidian";
import type { ILogger } from "../types";
import type { NoteRepository } from "./note-repository";
import type { TaskQueue } from "./task-queue";
import type { TaskRunner } from "./task-runner";
import type { VectorIndex } from "./vector-index";
import type { DuplicateManager } from "./duplicate-manager";
import type { SimpleLockManager } from "./lock-manager";
import type { PromptManager } from "./prompt-manager";
import type { ContentRenderer } from "./content-renderer";
import type { SchemaRegistry } from "./schema-registry";
import type { SettingsStore } from "../data/settings-store";
import type { CruidCache } from "./cruid-cache";
import type { ProviderManager } from "./provider-manager";

// ─── 能力接口（按职责分组） ───

/** 基础能力：设置 + 日志（所有编排器共用） */
export interface CoreDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
}

/** 队列能力：任务调度 */
export interface QueueDeps {
    taskQueue: TaskQueue;
}

/** 笔记 IO 能力：读写 */
export interface NoteDeps {
    noteRepository: NoteRepository;
}

/** 提示词能力：模板构建 */
export interface PromptDeps {
    promptManager: PromptManager;
}

/** 渲染能力：JSON → Markdown */
export interface RenderDeps {
    contentRenderer: ContentRenderer;
}

/** 向量能力：索引 + 去重 + AI Provider */
export interface VectorDeps {
    vectorIndex: VectorIndex;
    duplicateManager: DuplicateManager;
    providerManager: ProviderManager;
}

/** Obsidian App 实例（仅 Expand 需要直接访问 vault） */
export interface AppDeps {
    app: App;
}

/** cruid 缓存能力（VectorIndex / main.ts 使用） */
export interface CruidDeps {
    cruidCache: CruidCache;
}

// ─── 各编排器的最小依赖类型 ───

/** VerifyOrchestrator 依赖：6 个字段 */
export type VerifyOrchestratorDeps = CoreDeps & QueueDeps & NoteDeps & PromptDeps;

/** CreateOrchestrator 依赖 */
export type CreateOrchestratorDeps = CoreDeps & QueueDeps & NoteDeps & PromptDeps & RenderDeps & VectorDeps;

/** ExpandOrchestrator 依赖：4 个字段 */
export type ExpandOrchestratorDeps = CoreDeps & AppDeps & Pick<VectorDeps, "vectorIndex">;

// ─── 向后兼容：完整依赖接口（main.ts 构造对象使用） ───

export interface OrchestratorDeps extends
    CoreDeps, QueueDeps, NoteDeps, PromptDeps, RenderDeps,
    VectorDeps, AppDeps, CruidDeps {
    /** 并发锁（内存级 NodeLock） */
    lockManager: SimpleLockManager;
    /** 类型 Schema 注册中心 */
    schemaRegistry: SchemaRegistry;
    /** 任务执行器 */
    taskRunner: TaskRunner;
}
