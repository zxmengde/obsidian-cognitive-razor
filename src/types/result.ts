/**
 * Result Monad 类型定义
 *
 * 统一的错误处理：Ok/Err、CognitiveRazorError、工具函数
 */

// ============================================================================
// Result 类型
// ============================================================================

/** 成功结果 */
interface Ok<T> {
    ok: true;
    value: T;
}

/** 失败结果 */
export interface Err {
    ok: false;
    error: {
        code: string;
        message: string;
        details?: unknown;
    };
}

/** Result 类型：表示可能成功或失败的操作 */
export type Result<T> = Ok<T> | Err;

// ============================================================================
// 工具函数
// ============================================================================

/** 创建成功结果 */
export function ok<T>(value: T): Ok<T> {
    return { ok: true, value };
}

/** 创建失败结果 */
export function err(code: string, message: string, details?: unknown): Err {
    return { ok: false, error: { code, message, details } };
}

// ============================================================================
// 同步错误
// ============================================================================

/**
 * Cognitive Razor 运行时错误
 *
 * 用途：在同步流程中直接抛出，避免层层返回 Result。
 * 在异步边界（I/O / 网络 / UI 事件）捕获后可转换为 Err。
 */
export class CognitiveRazorError extends Error {
    readonly code: string;
    readonly details?: unknown;

    constructor(code: string, message: string, details?: unknown) {
        super(message);
        this.name = "CognitiveRazorError";
        this.code = code;
        this.details = details;
    }
}

/** 类型守卫：判断是否为 Err 结果 */
export function isErrResult(value: unknown): value is Err {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    if (candidate.ok !== false) return false;
    const errObj = candidate.error as Record<string, unknown> | undefined;
    return !!errObj && typeof errObj.code === "string" && typeof errObj.message === "string";
}

/**
 * 将未知错误转换为 Err（用于 async 边界的统一兜底）
 */
export function toErr(
    error: unknown,
    fallbackCode: string = "E500_INTERNAL_ERROR",
    fallbackMessage: string = "发生未知错误"
): Err {
    if (isErrResult(error)) {
        return error;
    }
    if (error instanceof CognitiveRazorError) {
        return err(error.code, error.message, error.details);
    }
    if (error instanceof Error) {
        return err(fallbackCode, error.message || fallbackMessage, { stack: error.stack });
    }
    return err(fallbackCode, fallbackMessage, error);
}

/**
 * 从未知错误中提取安全的用户可见消息
 * 需求 23.4：不暴露堆栈信息或 API 响应原文
 */
export function safeErrorMessage(error: unknown, fallback = "操作失败，请稍后重试"): string {
    if (isErrResult(error)) {
        return `[${error.error.code}] ${error.error.message}`;
    }
    if (error instanceof CognitiveRazorError) {
        return `[${error.code}] ${error.message}`;
    }
    return fallback;
}
