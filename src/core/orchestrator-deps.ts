/**
 * 编排器依赖接口
 *
 * 每个编排器声明自己需要的最小依赖接口。
 * main.ts 构造的共享对象满足所有接口。
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

/** VerifyOrchestrator 依赖 */
export interface VerifyOrchestratorDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    taskQueue: TaskQueue;
    noteRepository: NoteRepository;
    promptManager: PromptManager;
}

/** CreateOrchestrator 依赖 */
export interface CreateOrchestratorDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    taskQueue: TaskQueue;
    noteRepository: NoteRepository;
    promptManager: PromptManager;
    contentRenderer: ContentRenderer;
    vectorIndex: VectorIndex;
    duplicateManager: DuplicateManager;
    providerManager: ProviderManager;
}

/** ExpandOrchestrator 依赖 */
export interface ExpandOrchestratorDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    app: App;
    vectorIndex: VectorIndex;
}

/** 完整依赖接口（main.ts 构造对象使用） */
export interface OrchestratorDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    taskQueue: TaskQueue;
    noteRepository: NoteRepository;
    promptManager: PromptManager;
    contentRenderer: ContentRenderer;
    vectorIndex: VectorIndex;
    duplicateManager: DuplicateManager;
    providerManager: ProviderManager;
    app: App;
    cruidCache: CruidCache;
    lockManager: SimpleLockManager;
    schemaRegistry: SchemaRegistry;
    taskRunner: TaskRunner;
}
