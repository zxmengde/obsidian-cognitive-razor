/**
 * 配置系统类型定义
 *
 * ProviderConfig、TaskModelConfig、DirectoryScheme、PluginSettings
 */

import type { CRType } from "./domain";
import type { TaskType } from "./task";

// ============================================================================
// Provider 配置
// ============================================================================

/** Provider 配置 */
export interface ProviderConfig {
    apiKey: string;
    baseUrl?: string;
    defaultChatModel: string;
    defaultEmbedModel: string;
    enabled: boolean;
}

/** 任务模型配置 */
export interface TaskModelConfig {
    providerId: string;
    model: string;
    temperature?: number;
    topP?: number;
    reasoning_effort?: "low" | "medium" | "high";
    maxTokens?: number;
    embeddingDimension?: number;
}

// ============================================================================
// 目录与 UI 状态
// ============================================================================

/** 目录方案 */
export interface DirectoryScheme {
    Domain: string;
    Issue: string;
    Theory: string;
    Entity: string;
    Mechanism: string;
}

/** 工作台 UI 状态（持久化到 data.json） */
interface WorkbenchUIState {
    sectionCollapsed: Record<string, boolean>;
    sortPreferences: Record<string, { field: string; direction: 'asc' | 'desc' }>;
}

/** 默认 UI 状态 */
export const DEFAULT_UI_STATE: WorkbenchUIState = {
    sectionCollapsed: {
        createConcept: false,
        duplicates: false,
        queueStatus: true,
    },
    sortPreferences: {},
};

// ============================================================================
// 插件设置
// ============================================================================

/** 插件设置 */
export interface PluginSettings {
    version: string;
    directoryScheme: DirectoryScheme;
    similarityThreshold: number;
    concurrency: number;
    autoRetry: boolean;
    maxRetryAttempts: number;
    taskTimeoutMs: number;
    enableAutoVerify: boolean;
    providers: Record<string, ProviderConfig>;
    defaultProviderId: string;
    taskModels: Record<TaskType, TaskModelConfig>;
    logLevel: "debug" | "info" | "warn" | "error";
    embeddingDimension: number;
    providerTimeoutMs: number;
    uiState?: WorkbenchUIState;
}
