/** Validator - 验证 AI 输出，包括 JSON 解析和 Schema 校验 */

import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
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
function extractJsonFromResponse<T = Record<string, unknown>>(raw: string): T {
    const trimmed = raw.trim();

    // 阶段 1：代码块提取。逐个尝试，避免第一个非 JSON 代码块遮蔽后续合法 JSON。
    const codeBlockPattern = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/g;
    let codeBlockMatch: RegExpExecArray | null;
    while ((codeBlockMatch = codeBlockPattern.exec(trimmed)) !== null) {
        try {
            return JSON.parse(codeBlockMatch[1]) as T;
        } catch {
            // 继续尝试后续代码块
        }
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
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: false,
  });
  private readonly compiledSchemas = new WeakMap<object, ValidateFunction>();

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
    let validate = this.compiledSchemas.get(schema);
    if (!validate) {
      validate = this.ajv.compile(schema);
      this.compiledSchemas.set(schema, validate);
    }
    if (validate(data)) {
      return [];
    }

    return (validate.errors ?? []).map((error) => this.toValidationError(error));
  }

  /** 必填字段检查 */
  private validateRequiredFields(
    data: Record<string, unknown>,
    schema: object
  ): ValidationError[] {
    return this.validateRequiredStringFields(data, schema, "");
  }

  private toValidationError(error: ErrorObject): ValidationError {
    const pointer = this.getErrorPointer(error);
    return {
      code: "E211_MODEL_SCHEMA_VIOLATION",
      type: error.keyword === "required" ? "MissingField" : "SchemaError",
      message: this.formatAjvError(error, pointer),
      location: pointer,
      fixInstruction: this.buildFixInstruction(error, pointer),
    };
  }

  private getErrorPointer(error: ErrorObject): string {
    if (error.keyword === "required") {
      const missingProperty = (error.params as { missingProperty?: string }).missingProperty;
      return `${error.instancePath}/${this.escapeJsonPointerToken(missingProperty ?? "")}`.replace(/^\/\//, "/");
    }
    if (error.keyword === "additionalProperties") {
      const additionalProperty = (error.params as { additionalProperty?: string }).additionalProperty;
      return `${error.instancePath}/${this.escapeJsonPointerToken(additionalProperty ?? "")}`.replace(/^\/\//, "/");
    }
    return error.instancePath || "/";
  }

  private formatAjvError(error: ErrorObject, pointer: string): string {
    if (error.keyword === "required") {
      const missingProperty = (error.params as { missingProperty?: string }).missingProperty;
      return `缺少必填字段 "${missingProperty ?? pointer}"`;
    }
    if (error.keyword === "additionalProperties") {
      const additionalProperty = (error.params as { additionalProperty?: string }).additionalProperty;
      return `字段 "${additionalProperty ?? pointer}" 不在 Schema 中`;
    }
    return `字段 "${pointer}" ${error.message ?? "不符合 Schema"}`;
  }

  private buildFixInstruction(error: ErrorObject, pointer: string): string {
    switch (error.keyword) {
      case "required":
        return `请补全 ${pointer} 字段`;
      case "additionalProperties":
        return `请移除 ${pointer} 字段`;
      case "type":
        return `请修正 ${pointer} 的数据类型`;
      case "enum":
        return `请将 ${pointer} 改为 Schema enum 允许的值`;
      case "minimum":
      case "maximum":
      case "minItems":
      case "maxItems":
        return `请调整 ${pointer} 以满足 Schema 数值或数量范围`;
      default:
        return `请修正 ${pointer} 以符合 JSON Schema`;
    }
  }

  private validateRequiredStringFields(
    data: unknown,
    schema: unknown,
    pointer: string
  ): ValidationError[] {
    if (!schema || typeof schema !== "object") return [];
    const schemaObject = schema as {
      type?: string;
      required?: string[];
      properties?: Record<string, unknown>;
      items?: unknown;
    };
    if (schemaObject.type === "object") {
      return this.validateObjectRequiredStrings(data, schemaObject, pointer);
    }
    if (schemaObject.type === "array") {
      return this.validateArrayRequiredStrings(data, schemaObject.items, pointer);
    }
    return [];
  }

  private validateObjectRequiredStrings(
    data: unknown,
    schema: { required?: string[]; properties?: Record<string, unknown> },
    pointer: string,
  ): ValidationError[] {
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const record = data as Record<string, unknown>;
    const properties = schema.properties ?? {};
    const errors: ValidationError[] = [];

    for (const field of schema.required ?? []) {
      const fieldSchema = properties[field] as { type?: string; minLength?: number } | undefined;
      const value = record[field];
      // An explicit zero permits empty strings while preserving the legacy
      // non-empty policy for schemas that do not declare that exception.
      if (fieldSchema?.minLength === 0) continue;
      if (fieldSchema?.type !== "string" || typeof value !== "string" || value.trim()) continue;
      const fieldPointer = `${pointer}/${this.escapeJsonPointerToken(field)}`;
      errors.push({
        code: "E211_MODEL_SCHEMA_VIOLATION",
        type: "MissingField",
        message: `必填字段 "${field}" 为空`,
        location: fieldPointer,
        fixInstruction: `请为 ${fieldPointer} 提供非空字符串`,
      });
    }

    for (const [field, childSchema] of Object.entries(properties)) {
      errors.push(...this.validateRequiredStringFields(
        record[field],
        childSchema,
        `${pointer}/${this.escapeJsonPointerToken(field)}`,
      ));
    }
    return errors;
  }

  private validateArrayRequiredStrings(
    data: unknown,
    itemSchema: unknown,
    pointer: string,
  ): ValidationError[] {
    if (!Array.isArray(data) || !itemSchema) return [];
    return data.flatMap((item, index) =>
      this.validateRequiredStringFields(item, itemSchema, `${pointer}/${index}`));
  }

  private escapeJsonPointerToken(token: string): string {
    return token.replace(/~/g, "~0").replace(/\//g, "~1");
  }
}


/**
 * 生成 UUID v4（使用 Web Crypto API，加密安全）
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}
