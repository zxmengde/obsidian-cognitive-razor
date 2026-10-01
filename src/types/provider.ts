/**
 * Provider 系统类型定义
 *
 * Chat/Embed 请求响应与 Provider 能力
 */

// ============================================================================
// Provider 基础
// ============================================================================

/** Provider 请求协议 */
type ProviderType =
    | "openai-chat-completions"
    | "openai-responses"
    | "gemini-generative-language";

/** Embedding 能力协议。聊天协议不自动等价于 embedding 能力。 */
export type EmbeddingApiFormat = "openai-embeddings" | "disabled";

/** Provider 能力 */
export interface ProviderCapabilities {
    chat: boolean;
    chatError?: { code: string; message: string };
    embedding: boolean;
    embeddingError?: { code: string; message: string };
}

// ============================================================================
// Chat
// ============================================================================

/** 聊天请求 */
export type ChatResponseFormat =
    | { type: "json_object" }
    | {
        type: "json_schema";
        json_schema: {
            name: string;
            description?: string;
            schema: Record<string, unknown>;
            strict?: boolean;
        };
    };

export type WebSearchPurpose = "write" | "verify";

/** 跨协议统一的思考强度值。具体协议/模型能力由 Provider 返回错误决定。 */
export type ReasoningEffort = string;

/** Why this external attempt is being made; network retries are tracked separately. */
export type ProviderAttemptReason = "initial" | "automatic-retry" | "manual-retry";

/** Native search is declared only by Write and Verify task requests. */
type WebSearchOptions = { purpose: WebSearchPurpose };

export interface ChatRequest {
    providerId: string;
    providerSnapshot?: import("./settings").ProviderConfig;
    model: string;
    /** 仅用于本地日志和故障定位，不会发送给 Provider。 */
    requestLabel?: string;
    attemptReason?: ProviderAttemptReason;
    messages: ChatMessage[];
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    reasoning_effort?: ReasoningEffort;
    thinkingLevel?: string;
    thinkingBudget?: number;
    response_format?: ChatResponseFormat;
    webSearch?: WebSearchOptions;
    previousResponseId?: string;
    promptCacheKey?: string;
    promptCacheMode?: "implicit" | "explicit";
    promptCacheTtl?: "30m";
    /** Effective task capabilities captured at attempt start. */
    capabilities?: import("./model-config").ModelCapabilities;
}

/** 聊天消息 */
interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/** 聊天响应 */
export interface UrlCitation {
    url: string;
    title?: string;
    /** Optional character range in the returned visible text. */
    startIndex?: number;
    endIndex?: number;
}

export interface ChatResponse {
    content: string;
    responseId?: string;
    tokensUsed?: number;
    /** 提供商报告的输入 token。 */
    inputTokens?: number;
    outputTokens?: number;
    /** 本次从提供商提示词缓存读取的输入 token。 */
    cacheReadTokens?: number;
    /** 本次写入提供商提示词缓存的输入 token。 */
    cacheWriteTokens?: number;
    finishReason?: string;
    citations?: UrlCitation[];
    webSearchUsed?: boolean;
}

// ============================================================================
// Embed
// ============================================================================

/** 嵌入请求 */
export interface EmbedRequest {
    providerId: string;
    providerSnapshot?: import("./settings").ProviderConfig;
    model: string;
    input: string;
    dimensions?: number;
    attemptReason?: ProviderAttemptReason;
}

/** 嵌入响应 */
export interface EmbedResponse {
    embedding: number[];
    tokensUsed?: number;
}

// ============================================================================
// 默认端点
// ============================================================================

/** 默认端点配置 */
export const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
    "openai-chat-completions": "https://api.openai.com/v1",
    "openai-responses": "https://api.openai.com/v1",
    "gemini-generative-language": "https://generativelanguage.googleapis.com/v1beta"
};
