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
import type { UndoManager } from "./undo-manager";
import type { SimpleLockManager } from "./lock-manager";
import type { PromptManager } from "./prompt-manager";
import type { ContentRenderer } from "./content-renderer";
import type { SchemaRegistry } from "./schema-registry";
import type { SettingsStore } from "../data/settings-store";
import type { CruidCache } from "./cruid-cache";
import type { I18n } from "./i18n";
import type { ProviderManager } from "./provider-manager";
import type { PipelineStateStore } from "./pipeline-state-store";

// ─── 能力接口（按职责分组） ───

/** 基础能力：设置 + 日志 + 国际化（所有编排器共用） */
export interface CoreDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    i18n: I18n;
}

/** 队列能力：任务调度 */
export interface QueueDeps {
    taskQueue: TaskQueue;
}

/** 笔记 IO 能力：读写 + 快照撤销 */
export interface NoteDeps {
    noteRepository: NoteRepository;
    undoManager: UndoManager;
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

/** 管线状态持久化能力 */
export interface PipelineStateDeps {
    pipelineStateStore: PipelineStateStore;
}

/** Obsidian App 实例（仅 Expand 需要直接访问 vault） */
export interface AppDeps {
    app: App;
}

/** cruid 缓存能力（仅 Merge 需要） */
export interface CruidDeps {
    cruidCache: CruidCache;
}

/** 任务执行器能力（仅 Image 需要 abort） */
export interface RunnerDeps {
    taskRunner: TaskRunner;
}

// ─── 各编排器的最小依赖类型 ───

/** VerifyOrchestrator 依赖：6 个字段 */
export type VerifyOrchestratorDeps = CoreDeps & QueueDeps & NoteDeps & PromptDeps;

/** CreateOrchestrator 依赖：13 个字段 */
export type CreateOrchestratorDeps = CoreDeps & QueueDeps & NoteDeps & PromptDeps & RenderDeps & VectorDeps;

/** AmendOrchestrator 依赖：14 个字段 */
export type AmendOrchestratorDeps = CoreDeps & QueueDeps & NoteDeps & PromptDeps & RenderDeps & VectorDeps & PipelineStateDeps;

/** MergeOrchestrator 依赖：15 个字段 */
export type MergeOrchestratorDeps = CoreDeps & QueueDeps & NoteDeps & PromptDeps & RenderDeps & VectorDeps & PipelineStateDeps & CruidDeps;

/** ImageInsertOrchestrator 依赖：6 个字段 */
export type ImageOrchestratorDeps = CoreDeps & QueueDeps & RunnerDeps & Pick<NoteDeps, "noteRepository">;

/** ExpandOrchestrator 依赖：4 个字段 */
export type ExpandOrchestratorDeps = CoreDeps & AppDeps & Pick<VectorDeps, "vectorIndex">;

// ─── 向后兼容：完整依赖接口（main.ts 构造对象使用） ───

export interface OrchestratorDeps extends
    CoreDeps, QueueDeps, NoteDeps, PromptDeps, RenderDeps,
    VectorDeps, PipelineStateDeps, AppDeps, CruidDeps, RunnerDeps {
    /** 并发锁（内存级 NodeLock） */
    lockManager: SimpleLockManager;
    /** 类型 Schema 注册中心 */
    schemaRegistry: SchemaRegistry;
}
