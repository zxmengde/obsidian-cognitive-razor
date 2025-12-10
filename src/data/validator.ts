/**
 * Validator 实现
 * 验证 AI 输出，包括 JSON 解析和基本 Schema 校验
 *
 * 简化版本：移除业务规则校验，只保留核心功能
 */

import {
  IValidator,
  ValidationResult,
  ValidationError,
  ValidationContext,
} from "../types";

/**
 * Validator 实现类
 *
 * 只做 JSON 解析和基本 Schema 校验
 */
export class Validator implements IValidator {
  /**
   * 验证输出
   *
   * 验证顺序：
   * 1. JSON 解析 → E001
   * 2. Schema 校验 → E002
   * 3. 必填字段检查 → E003
   */
  async validate(
    output: string,
    schema: object,
    _rules: string[],
    _context?: ValidationContext
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

  /**
   * 容错 JSON 解析：支持直接 JSON、```json ``` 代码块，以及包含前后缀文本的情况
   * 增强：尝试修复常见的 JSON 格式错误
   */
  private tryParseJson(
    output: string
  ):
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: ValidationError } {
    const trimmed = output.trim();

    const buildParseError = (): ValidationError => ({
      code: "E001",
      type: "ParseError",
      message: "Failed to parse JSON output",
      rawOutput: trimmed.substring(0, 500),
      fixInstruction:
        "确保输出为纯 JSON，避免 ```json 代码块或多余说明文字",
    });

    const attemptParse = (text: string): Record<string, unknown> | null => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    // 1) 直接解析
    const direct = attemptParse(trimmed);
    if (direct) {
      return { ok: true, data: direct };
    }

    // 2) 提取 ```json ``` 或 ``` ``` 代码块
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      const parsed = attemptParse(codeBlockMatch[1]);
      if (parsed) {
        return { ok: true, data: parsed };
      }
      // 尝试清理代码块内容后再解析
      const cleaned = this.cleanJsonString(codeBlockMatch[1]);
      const parsedCleaned = attemptParse(cleaned);
      if (parsedCleaned) {
        return { ok: true, data: parsedCleaned };
      }
    }

    // 3) 提取首尾大括号之间的内容（容忍前后缀文本）
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const sliced = trimmed.slice(firstBrace, lastBrace + 1);
      const parsed = attemptParse(sliced);
      if (parsed) {
        return { ok: true, data: parsed };
      }
      // 尝试清理后再解析
      const cleaned = this.cleanJsonString(sliced);
      const parsedCleaned = attemptParse(cleaned);
      if (parsedCleaned) {
        return { ok: true, data: parsedCleaned };
      }
    }

    return { ok: false, error: buildParseError() };
  }

  /**
   * 清理 JSON 字符串，修复常见的格式错误
   * - 移除数组元素之间的非法字符（如 },g { 中的 g）
   * - 修复尾随逗号
   */
  private cleanJsonString(json: string): string {
    let cleaned = json;
    
    // 修复数组元素之间的非法字符：},X { 或 },X{ 模式
    // 匹配 }, 后跟非空白非 { 非 ] 的字符，再跟 { 或 ]
    cleaned = cleaned.replace(/\},\s*[^{\[\]\s]+\s*\{/g, "},{");
    cleaned = cleaned.replace(/\},\s*[^{\[\]\s]+\s*\]/g, "}]");
    
    // 修复尾随逗号：,] 或 ,}
    cleaned = cleaned.replace(/,\s*\]/g, "]");
    cleaned = cleaned.replace(/,\s*\}/g, "}");
    
    return cleaned;
  }

  /**
   * Schema 校验（简化版，使用基本类型检查）
   * 返回 E002 错误
   */
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
          code: "E002",
          type: "SchemaError",
          message: `Field "${key}" should be an array`,
          location: key,
          fixInstruction: `Ensure "${key}" is an array`,
        });
      } else if (
        expectedType === "object" &&
        (typeof value !== "object" || Array.isArray(value))
      ) {
        errors.push({
          code: "E002",
          type: "SchemaError",
          message: `Field "${key}" should be an object`,
          location: key,
          fixInstruction: `Ensure "${key}" is an object`,
        });
      } else if (
        expectedType !== "array" &&
        expectedType !== "object" &&
        expectedType !== actualType
      ) {
        errors.push({
          code: "E002",
          type: "SchemaError",
          message: `Field "${key}" should be of type "${expectedType}", got "${actualType}"`,
          location: key,
          fixInstruction: `Ensure "${key}" is of type "${expectedType}"`,
        });
      }
    }

    return errors;
  }

  /**
   * 必填字段检查
   * 返回 E003 错误
   */
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
          code: "E003",
          type: "MissingField",
          message: `Required field "${field}" is missing`,
          location: field,
          fixInstruction: `Provide a value for "${field}"`,
        });
      } else if (typeof value === "string" && value.trim() === "") {
        errors.push({
          code: "E003",
          type: "MissingField",
          message: `Required field "${field}" is empty`,
          location: field,
          fixInstruction: `Provide a non-empty value for "${field}"`,
        });
      }
    }

    return errors;
  }
}
