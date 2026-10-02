/**
 * 配置系统类型定义
 *
 * ProviderConfig、TaskModelConfig、DirectoryScheme、PluginSettings
 */

import type { ModelCapabilities, ModelParameters, ModelParameterOverrides } from "./model-config";
import type { TaskType } from "./task";
import type { EmbeddingApiFormat, ReasoningEffort } from "./provider";
import type { LogLevel } from "./logger";

// ============================================================================
// Provider 配置
// ============================================================================

/** Provider 聊天 API 协议。运行时只接受显式协议，不做模型名猜测。 */
export type ProviderApiFormat =
    | "openai-chat-completions"
    | "openai-responses"
    | "gemini-generative-language"
    | "disabled";

export interface ProviderConfig {
    capabilities?: Partial<ModelCapabilities>;
    parameters?: ModelParameters;
    apiKey: string;
    baseUrl?: string;
    apiFormat: ProviderApiFormat;
    /** Legacy import-only field. New settings use capabilities.nativeWebSearch. */
    enableWebSearch?: boolean;
    embeddingApiFormat: EmbeddingApiFormat;
    defaultChatModel: string;
    defaultEmbedModel: string;
    enabled: boolean;
}

/** 任务模型配置 */
export interface TaskModelConfig {
    capabilities?: Partial<ModelCapabilities>;
    parameters?: ModelParameterOverrides;
    providerId: string;
    model: string;
    temperature?: number;
    topP?: number;
    reasoning_effort?: ReasoningEffort;
    maxTokens?: number;
    embeddingDimension?: number;
}

// ============================================================================
// 目录
// ============================================================================

/** 目录方案 */
export interface DirectoryScheme {
    domain: string;
    issue: string;
    theory: string;
    entity: string;
    mechanism: string;
}

// ============================================================================
// 插件设置
// ============================================================================

/** 插件设置 */
export interface PluginSettings {
    directoryScheme: DirectoryScheme;
    enableSemanticIndexing: boolean;
    enableDuplicateDetection: boolean;
    similarityThreshold: number;
    concurrency: number;
    taskTimeoutMs: number;
    logLevel: LogLevel;
    enableAutoVerify: boolean;
    /** Applies only when creating future verification reports. */
    verifyReportPresentation: "expanded" | "collapsed";
    /** Initial queue view only; never changes task execution or stored tasks. */
    queueDefaultFilter: "all" | "active" | "failed";
    queuePageSize: 25 | 50 | 100;
    providers: Record<string, ProviderConfig>;
    defaultProviderId: string;
    cardsSourceRoot: string;
    cardsTargetRoot: string;
    taskModels: Record<TaskType, TaskModelConfig>;
    providerTimeoutMs: number;
    /** 每个 Provider 网络阶段的最大尝试次数，包含首次请求。 */
    providerMaxAttempts: number;
    /** 通过流式传输保持聊天连接，但仍等待完整响应后一次性处理。 */
    enableStreamingKeepalive: boolean;
    /** 请求发送前固定流式通道，默认保留 Node。 */
    streamingTransport: "node-http" | "renderer-fetch";
}
