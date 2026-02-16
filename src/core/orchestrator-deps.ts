/**
 * OrchestratorDeps：所有 Orchestrator 共享的依赖接口
 *
 * 用于 Create / Amend / Merge / Verify / Expand / Image 六个独立编排器，
 * 替代原 PipelineOrchestratorDependencies 接口，通过 ServiceContainer 注入。
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

export interface OrchestratorDeps {
    /** Obsidian App 实例 */
    app: App;
    /** Vault 读写抽象层 */
    noteRepository: NoteRepository;
    /** 任务队列（调度 + 防抖批量写入） */
    taskQueue: TaskQueue;
    /** 原子任务执行器 */
    taskRunner: TaskRunner;
    /** 向量索引（按需加载 + TTL 驱逐） */
    vectorIndex: VectorIndex;
    /** 重复对管理器 */
    duplicateManager: DuplicateManager;
    /** 快照/撤销管理器 */
    undoManager: UndoManager;
    /** 并发锁（内存级 NodeLock） */
    lockManager: SimpleLockManager;
    /** 提示词模板管理器 */
    promptManager: PromptManager;
    /** JSON → Markdown 渲染器 */
    contentRenderer: ContentRenderer;
    /** 类型 Schema 注册中心 */
    schemaRegistry: SchemaRegistry;
    /** 设置存储 */
    settingsStore: SettingsStore;
    /** cruid ↔ TFile 映射缓存 */
    cruidCache: CruidCache;
    /** 日志 */
    logger: ILogger;
    /** 国际化 */
    i18n: I18n;
    /** 管线状态持久化（Diff 确认阶段恢复） */
    pipelineStateStore: PipelineStateStore;
    /** AI Provider 管理器（直调 API 使用） */
    providerManager: ProviderManager;
}
