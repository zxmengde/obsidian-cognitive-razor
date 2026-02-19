/** Validator - 验证 AI 输出，包括 JSON 解析和 Schema 校验 */

import type {
  ValidationResult,
  ValidationError,
} from "../types";

/**
 * 从 AI 响应中提取 JSON（多级容错）
 *
 * 1. 优先匹配 ```json ... ```，其次匹配 ``` ... ```
 * 2. 若无代码块，尝试提取第一个完整的 JSON 对象（{ ... }）
 * 3. 最后直接尝试解析原始内容
 */
export function extractJsonFromResponse<T = Record<string, unknown>>(raw: string): T {
    const trimmed = raw.trim();

    // 阶段 1：代码块提取
    const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/)
        || trimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]) as T;
    }

    // 阶段 2：直接解析（纯 JSON 输出）
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        // 继续尝试阶段 3
    }

    // 阶段 3：提取第一个完整 JSON 对象（处理 AI 在前后加解释性文字的情况）
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1)) as T;
    }

    // 兜底：抛出解析错误
    throw new SyntaxError("无法从响应中提取 JSON");
}

/** Validator 实现类 */
export class Validator {
  /** 验证输出 */
  async validate(
    output: string,
    schema: object,
  ): Promise<ValidationResult> {
    // 阶段 1: JSON 解析校验（容错提取 markdown 代码块或前后缀文本）
    const parseResult = this.tryParseJson(output);
    if (!parseResult.ok) {
      return { valid: false, errors: [parseResult.error] };
    }
    const data = parseResult.data;

    // 阶段 2: Schema 校验
    const schemaErrors = this.validateSchema(data, schema);
    if (schemaErrors.length > 0) {
      return { valid: false, errors: schemaErrors };
    }

    // 阶段 3: 必填字段检查
    const requiredFieldErrors = this.validateRequiredFields(data, schema);
    if (requiredFieldErrors.length > 0) {
      return { valid: false, errors: requiredFieldErrors };
    }

    return {
      valid: true,
      data,
    };
  }

  /** 容错 JSON 解析（支持 markdown 代码块包裹） */
  private tryParseJson(
    output: string
  ):
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: ValidationError } {
    const trimmed = output.trim();

    const buildParseError = (): ValidationError => ({
      code: "E210_MODEL_OUTPUT_PARSE_FAILED",
      type: "ParseError",
      message: "模型输出非 JSON 或解析失败",
      rawOutput: trimmed.substring(0, 500),
      fixInstruction: "确保输出为有效 JSON，可使用代码块包裹",
    });

    try {
      // 复用 extractJsonFromResponse，统一支持代码块提取
      return { ok: true, data: extractJsonFromResponse<Record<string, unknown>>(output) };
    } catch {
      return { ok: false, error: buildParseError() };
    }
  }

  /** Schema 校验 */
  private validateSchema(
    data: Record<string, unknown>,
    schema: object
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const schemaProps = (
      schema as { properties?: Record<string, { type: string }> }
    ).properties;

    if (!schemaProps) {
      return errors;
    }

    for (const [key, propSchema] of Object.entries(schemaProps)) {
      const value = data[key];
      const expectedType = propSchema.type;

      if (value === undefined || value === null) {
        continue; // 必填字段检查在下一步
      }

      const actualType = Array.isArray(value) ? "array" : typeof value;

      if (expectedType === "array" && !Array.isArray(value)) {
        errors.push({
          code: "E211_MODEL_SCHEMA_VIOLATION",
          type: "SchemaError",
          message: `字段 "${key}" 应为数组`,
          location: key,
          fixInstruction: `请将 "${key}" 输出为数组`,
        });
      } else if (
        expectedType === "object" &&
        (typeof value !== "object" || Array.isArray(value))
      ) {
        errors.push({
          code: "E211_MODEL_SCHEMA_VIOLATION",
          type: "SchemaError",
          message: `字段 "${key}" 应为对象`,
          location: key,
          fixInstruction: `请将 "${key}" 输出为对象`,
        });
      } else if (
        expectedType !== "array" &&
        expectedType !== "object" &&
        expectedType !== actualType
      ) {
        errors.push({
          code: "E211_MODEL_SCHEMA_VIOLATION",
          type: "SchemaError",
          message: `字段 "${key}" 类型应为 "${expectedType}"，实际为 "${actualType}"`,
          location: key,
          fixInstruction: `请将 "${key}" 输出为 "${expectedType}" 类型`,
        });
      }
    }

    return errors;
  }

  /** 必填字段检查 */
  private validateRequiredFields(
    data: Record<string, unknown>,
    schema: object
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const required = (schema as { required?: string[] }).required;

    if (!required) {
      return errors;
    }

    for (const field of required) {
      const value = data[field];
      if (value === undefined || value === null) {
        errors.push({
          code: "E211_MODEL_SCHEMA_VIOLATION",
          type: "MissingField",
          message: `缺少必填字段 "${field}"`,
          location: field,
          fixInstruction: `请补全 "${field}" 字段`,
        });
      } else if (typeof value === "string" && value.trim() === "") {
        errors.push({
          code: "E211_MODEL_SCHEMA_VIOLATION",
          type: "MissingField",
          message: `必填字段 "${field}" 为空`,
          location: field,
          fixInstruction: `请为 "${field}" 提供非空值`,
        });
      }
    }

    return errors;
  }
}


/**
 * 生成 UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
