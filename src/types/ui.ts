/**
 * UI 组件类型定义
 */

/** JSON 解析与 Schema 校验结果。 */
export type ValidationResult =
    | { valid: true; data: Record<string, unknown>; errors?: never }
    | { valid: false; errors: ValidationError[]; data?: never };

/** 验证错误 */
export interface ValidationError {
    code: string;
    type: string;
    message: string;
    location?: string;
    rawOutput?: string;
    fixInstruction?: string;
}
