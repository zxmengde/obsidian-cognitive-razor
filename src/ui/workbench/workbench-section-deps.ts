/**
 * WorkbenchSection 依赖接口定义
 *
 * 定义各 Section 组件的依赖注入接口，替代直接依赖 Plugin 实例。
 * 遵循 UI → Core → Data 单向依赖原则，通过 ServiceContainer 注入具体服务。
 *
 * 需求: 6.1
 */

import type { App, EventRef } from "obsidian";
import type { QueueStatus, TaskRecord, DuplicatePair, SnapshotMetadata } from "../../types";
import type { CreateOrchestrator } from "../../core/create-orchestrator";
import type { AmendOrchestrator } from "../../core/amend-orchestrator";
import type { MergeOrchestrator } from "../../core/merge-orchestrator";
import type { VerifyOrchestrator } from "../../core/verify-orchestrator";
import type { ExpandOrchestrator } from "../../core/expand-orchestrator";
import type { ImageInsertOrchestrator } from "../../core/image-insert-orchestrator";
import type { TaskQueue } from "../../core/task-queue";
import type { DuplicateManager } from "../../core/duplicate-manager";
import type { UndoManager } from "../../core/undo-manager";
import type { CruidCache } from "../../core/cruid-cache";
import type { PluginSettings } from "../../types";

/**
 * SectionDeps — 所有 Section 共享的基础依赖
 *
 * 包含 UI 渲染和交互所需的通用服务引用，
 * 不包含任何业务逻辑模块的直接引用。
 */
export interface SectionDeps {
    /** Obsidian App 实例 */
    app: App;
    /** i18n 翻译函数 */
    t: (path: string) => string;
    /** 显示错误通知 */
    showErrorNotice: (message: string) => void;
    /** 记录错误日志 */
    logError: (context: string, error: unknown, extra?: Record<string, unknown>) => void;
    /** 记录警告日志 */
    logWarn: (context: string, extra?: Record<string, unknown>) => void;
    /** 通过 cruid 解析笔记名称 */
    resolveNoteName: (nodeId: string) => string;
    /** 通过 cruid 解析笔记路径 */
    resolveNotePath: (nodeId: string) => string | null;
    /** 注册事件监听器（自动清理） */
    registerEvent: (eventRef: EventRef) => void;
    /** 获取容器元素 */
    getContainerEl: () => HTMLElement;
}

/**
 * CreateSectionDeps — 创建区专用依赖
 *
 * 扩展基础依赖，注入创建、修订、拓展、可视化、核查编排器，
 * 以及插件设置（用于读取 imageGeneration 等配置）。
 */
export interface CreateSectionDeps extends SectionDeps {
    /** 创建管线编排器 */
    createOrchestrator: CreateOrchestrator;
    /** 修订管线编排器 */
    amendOrchestrator: AmendOrchestrator;
    /** 拓展管线编排器 */
    expandOrchestrator: ExpandOrchestrator;
    /** 图片插入编排器 */
    imageInsertOrchestrator: ImageInsertOrchestrator;
    /** 核查管线编排器 */
    verifyOrchestrator: VerifyOrchestrator;
    /** 获取插件设置（只读） */
    getSettings: () => PluginSettings;
    /** 获取完整翻译对象（用于传递给子 Modal） */
    getTranslations: () => Record<string, unknown>;
}

/**
 * DuplicatesSectionDeps — 重复对区专用依赖
 *
 * 扩展基础依赖，注入重复对管理器、合并编排器和 cruid 缓存。
 */
export interface DuplicatesSectionDeps extends SectionDeps {
    /** 重复对管理器 */
    duplicateManager: DuplicateManager;
    /** 合并管线编排器 */
    mergeOrchestrator: MergeOrchestrator;
    /** cruid 缓存（用于名称解析） */
    cruidCache: CruidCache;
}

/**
 * QueueSectionDeps — 队列区专用依赖
 *
 * 扩展基础依赖，注入任务队列和插件设置。
 */
export interface QueueSectionDeps extends SectionDeps {
    /** 任务队列 */
    taskQueue: TaskQueue;
    /** 获取插件设置（用于读取 namingTemplate） */
    getSettings: () => PluginSettings;
}

/**
 * RecentOpsSectionDeps — 历史区专用依赖
 *
 * 扩展基础依赖，注入撤销管理器。
 */
export interface RecentOpsSectionDeps extends SectionDeps {
    /** 撤销管理器 */
    undoManager: UndoManager;
}

/**
 * 旧版兼容接口 — 过渡期保留
 *
 * @deprecated 请使用 SectionDeps 及其子接口替代。
 * 此接口将在所有 Section 迁移完成后移除。
 */
export interface WorkbenchSectionDeps {
    app: App;
    getPlugin: () => import("../../../main").default | null;
    t: (path: string) => string;
    showErrorNotice: (message: string) => void;
    logError: (context: string, error: unknown, extra?: Record<string, unknown>) => void;
    logWarn: (context: string, extra?: Record<string, unknown>) => void;
    resolveNoteName: (nodeId: string) => string;
    resolveNotePath: (nodeId: string) => string | null;
    registerEvent: (eventRef: EventRef) => void;
    getContainerEl: () => HTMLElement;
}
