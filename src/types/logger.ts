/**
 * 日志接口定义
 */

/** 日志记录器接口 */
export interface ILogger {
    debug(module: string, message: string, context?: Record<string, unknown>): void;
    info(module: string, message: string, context?: Record<string, unknown>): void;
    warn(module: string, message: string, context?: Record<string, unknown>): void;
    error(module: string, message: string, error?: Error, context?: Record<string, unknown>): void;
    getLogContent(): string;
    clear(): void;
}
