/**
 * Provider 系统类型定义
 *
 * Chat/Embed/Image 请求响应、Provider 能力与信息
 */

import type { CRFrontmatter } from "./domain";

// ============================================================================
// Provider 基础
// ============================================================================

/** Provider 类型（仅支持 OpenAI 标准格式） */
type ProviderType = "openai";

/** Provider 能力 */
export interface ProviderCapabilities {
    chat: boolean;
    embedding: boolean;
    image: boolean;
    maxContextLength: number;
    models: string[];
}

/** Provider 信息 */
export interface ProviderInfo {
    id: string;
    type: ProviderType;
    name: string;
    configured: boolean;
    capabilities?: ProviderCapabilities;
}

// ============================================================================
// Chat
// ============================================================================

/** 聊天请求 */
export interface ChatRequest {
    providerId: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    reasoning_effort?: "low" | "medium" | "high";
}

/** 聊天消息 */
interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/** 聊天响应 */
export interface ChatResponse {
    content: string;
    tokensUsed?: number;
    finishReason?: string;
}

// ============================================================================
// Image
// ============================================================================

/** 图片生成请求 */
export interface ImageGenerateRequest {
    providerId: string;
    model: string;
    prompt: string;
    size?: string;
    quality?: "standard" | "hd";
    style?: "vivid" | "natural";
}

/** 图片生成响应 */
export interface ImageGenerateResponse {
    imageUrl: string;
    revisedPrompt?: string;
    altText?: string;
}

/** 图片生成任务载荷 */
export interface ImageGeneratePayload {
    userPrompt: string;
    contextBefore: string;
    contextAfter: string;
    frontmatter: CRFrontmatter;
    filePath: string;
    cursorPosition: { line: number; ch: number };
    [key: string]: unknown;
}

/** 图片生成结果 */
export interface ImageGenerateResult {
    imageUrl: string;
    localPath: string;
    description: string;
    revisedPrompt?: string;
    [key: string]: unknown;
}

// ============================================================================
// Embed
// ============================================================================

/** 嵌入请求 */
export interface EmbedRequest {
    providerId: string;
    model: string;
    input: string;
    dimensions?: number;
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
    openai: "https://api.openai.com/v1"
};
