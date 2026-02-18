/**
 * UI 组件类型定义
 */

/** 验证上下文 */
export interface ValidationContext {
    type?: import("./domain").CRType;
    embedding?: number[];
    vectorIndex?: unknown;
    similarityThreshold?: number;
}

/** 验证结果 */
export interface ValidationResult {
    valid: boolean;
    data?: Record<string, unknown>;
    errors?: ValidationError[];
    duplicates?: import("./storage").SearchResult[];
}

/** 验证错误 */
export interface ValidationError {
    code: string;
    type: string;
    message: string;
    location?: string;
    rawOutput?: string;
    fixInstruction?: string;
}
