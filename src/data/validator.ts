/**
 * Validator - 内容验证器
 * 
 * 功能：
 * 1. JSON 解析校验
 * 2. Schema 校验
 * 3. 业务规则校验（C001-C009）
 */

import { Result, ok, err, CRType } from "../types";

/**
 * 验证错误
 */
export interface ValidationError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 字段路径 */
  field?: string;
  /** 详细信息 */
  details?: unknown;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误列表 */
  errors: ValidationError[];
  /** 解析后的数据 */
  data?: unknown;
}

/**
 * Validator 类
 */
export class Validator {
  /**
   * 验证 JSON 字符串
   */
  validateJSON(input: string): Result<unknown> {
    try {
      const data = JSON.parse(input);
      return ok(data);
    } catch (error) {
      return err("E001", `JSON 解析失败: ${error}`, { input });
    }
  }

  /**
   * 验证标准化输出
   */
  validateStandardizeOutput(data: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof data !== "object" || data === null) {
      errors.push({
        code: "E002",
        message: "输出必须是对象",
      });
      return { valid: false, errors };
    }

    const obj = data as Record<string, unknown>;

    // 验证 standard_name
    if (!obj.standard_name || typeof obj.standard_name !== "object") {
      errors.push({
        code: "E003",
        message: "缺少必需字段: standard_name",
        field: "standard_name",
      });
    } else {
      const name = obj.standard_name as Record<string, unknown>;
      if (!name.chinese || typeof name.chinese !== "string") {
        errors.push({
          code: "E003",
          message: "缺少必需字段: standard_name.chinese",
          field: "standard_name.chinese",
        });
      }
      if (!name.english || typeof name.english !== "string") {
        errors.push({
          code: "E003",
          message: "缺少必需字段: standard_name.english",
          field: "standard_name.english",
        });
      }
    }

    // 验证 aliases
    if (!Array.isArray(obj.aliases)) {
      errors.push({
        code: "E003",
        message: "缺少必需字段: aliases",
        field: "aliases",
      });
    } else {
      if (obj.aliases.length < 3 || obj.aliases.length > 10) {
        errors.push({
          code: "E004",
          message: "aliases 数组长度必须在 3-10 之间",
          field: "aliases",
        });
      }
    }

    // 验证 type_confidences (C009)
    if (!obj.type_confidences || typeof obj.type_confidences !== "object") {
      errors.push({
        code: "E003",
        message: "缺少必需字段: type_confidences",
        field: "type_confidences",
      });
    } else {
      const confidences = obj.type_confidences as Record<string, unknown>;
      const types: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
      
      let sum = 0;
      for (const type of types) {
        if (typeof confidences[type] !== "number") {
          errors.push({
            code: "E003",
            message: `缺少必需字段: type_confidences.${type}`,
            field: `type_confidences.${type}`,
          });
        } else {
          sum += confidences[type] as number;
        }
      }

      // C009: 置信度总和必须等于 1.0
      if (Math.abs(sum - 1.0) > 0.0001) {
        errors.push({
          code: "E009",
          message: `type_confidences 总和必须等于 1.0，当前为 ${sum}`,
          field: "type_confidences",
        });
      }
    }

    // 验证 core_definition
    if (!obj.core_definition || typeof obj.core_definition !== "string") {
      errors.push({
        code: "E003",
        message: "缺少必需字段: core_definition",
        field: "core_definition",
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      data: errors.length === 0 ? data : undefined,
    };
  }

  /**
   * 验证内容生成输出
   */
  validateEnrichOutput(data: unknown, type: CRType): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof data !== "object" || data === null) {
      errors.push({
        code: "E002",
        message: "输出必须是对象",
      });
      return { valid: false, errors };
    }

    const obj = data as Record<string, unknown>;

    // 根据类型验证
    switch (type) {
      case "Issue":
        this.validateIssueContent(obj, errors);
        break;
      case "Theory":
        this.validateTheoryContent(obj, errors);
        break;
      case "Mechanism":
        this.validateMechanismContent(obj, errors);
        break;
      case "Entity":
        this.validateEntityContent(obj, errors);
        break;
      case "Domain":
        this.validateDomainContent(obj, errors);
        break;
    }

    // C002: 验证所有 wikilink
    this.validateWikilinks(obj, errors);

    return {
      valid: errors.length === 0,
      errors,
      data: errors.length === 0 ? data : undefined,
    };
  }

  /**
   * 验证 Issue 类型内容
   */
  private validateIssueContent(
    obj: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    // C001: core_tension 必须匹配 "X vs Y" 格式
    if (!obj.core_tension || typeof obj.core_tension !== "string") {
      errors.push({
        code: "E003",
        message: "缺少必需字段: core_tension",
        field: "core_tension",
      });
    } else {
      const pattern = /^.+ vs .+$/;
      if (!pattern.test(obj.core_tension)) {
        errors.push({
          code: "E010",
          message: 'core_tension 必须匹配 "X vs Y" 格式',
          field: "core_tension",
        });
      }
    }

    // 验证其他必需字段
    if (!obj.description || typeof obj.description !== "string") {
      errors.push({
        code: "E003",
        message: "缺少必需字段: description",
        field: "description",
      });
    }
  }

  /**
   * 验证 Theory 类型内容
   */
  private validateTheoryContent(
    obj: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    // C003: axioms 数组长度 ≥ 1
    if (!Array.isArray(obj.axioms)) {
      errors.push({
        code: "E003",
        message: "缺少必需字段: axioms",
        field: "axioms",
      });
    } else {
      if (obj.axioms.length < 1) {
        errors.push({
          code: "E003",
          message: "axioms 数组长度必须 ≥ 1",
          field: "axioms",
        });
      }

      // C004: 每个 axiom 必须包含 justification
      for (let i = 0; i < obj.axioms.length; i++) {
        const axiom = obj.axioms[i];
        if (typeof axiom !== "object" || axiom === null) {
          errors.push({
            code: "E002",
            message: `axioms[${i}] 必须是对象`,
            field: `axioms[${i}]`,
          });
        } else {
          const axiomObj = axiom as Record<string, unknown>;
          if (!axiomObj.statement || typeof axiomObj.statement !== "string") {
            errors.push({
              code: "E003",
              message: `缺少必需字段: axioms[${i}].statement`,
              field: `axioms[${i}].statement`,
            });
          }
          if (!axiomObj.justification || typeof axiomObj.justification !== "string") {
            errors.push({
              code: "E003",
              message: `缺少必需字段: axioms[${i}].justification`,
              field: `axioms[${i}].justification`,
            });
          }
        }
      }
    }
  }

  /**
   * 验证 Mechanism 类型内容
   */
  private validateMechanismContent(
    obj: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    // C005: causal_chain 数组长度 ≥ 2
    if (!Array.isArray(obj.causal_chain)) {
      errors.push({
        code: "E003",
        message: "缺少必需字段: causal_chain",
        field: "causal_chain",
      });
    } else {
      if (obj.causal_chain.length < 2) {
        errors.push({
          code: "E003",
          message: "causal_chain 数组长度必须 ≥ 2",
          field: "causal_chain",
        });
      }
    }

    // C006: operates_on 数组长度 ≥ 1
    if (!Array.isArray(obj.operates_on)) {
      errors.push({
        code: "E003",
        message: "缺少必需字段: operates_on",
        field: "operates_on",
      });
    } else {
      if (obj.operates_on.length < 1) {
        errors.push({
          code: "E003",
          message: "operates_on 数组长度必须 ≥ 1",
          field: "operates_on",
        });
      }
    }
  }

  /**
   * 验证 Entity 类型内容
   */
  private validateEntityContent(
    obj: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    // C007: definition 必须包含属和种差
    if (!obj.definition || typeof obj.definition !== "string") {
      errors.push({
        code: "E003",
        message: "缺少必需字段: definition",
        field: "definition",
      });
    } else {
      // 简单检查：定义应该足够长，包含描述性内容
      if (obj.definition.length < 10) {
        errors.push({
          code: "E004",
          message: "definition 必须包含属和种差，内容过短",
          field: "definition",
        });
      }
    }
  }

  /**
   * 验证 Domain 类型内容
   */
  private validateDomainContent(
    obj: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    // C008: boundaries 数组长度 ≥ 1
    if (!Array.isArray(obj.boundaries)) {
      errors.push({
        code: "E003",
        message: "缺少必需字段: boundaries",
        field: "boundaries",
      });
    } else {
      if (obj.boundaries.length < 1) {
        errors.push({
          code: "E003",
          message: "boundaries 数组长度必须 ≥ 1",
          field: "boundaries",
        });
      }
    }
  }

  /**
   * 验证 wikilink 格式
   */
  private validateWikilinks(
    obj: Record<string, unknown>,
    errors: ValidationError[]
  ): void {
    // 递归检查对象中的所有字符串值
    this.checkWikilinksInValue(obj, errors);
  }

  /**
   * 递归检查值中的 wikilink
   */
  private checkWikilinksInValue(
    value: unknown,
    errors: ValidationError[]
  ): void {
    if (typeof value === "string") {
      // 只在字符串中检查 wikilink
      // 查找单括号链接（不是双括号）
      const singleBracketPattern = /\[([^\[\]]+)\]/g;
      const doubleBracketPattern = /\[\[([^\]]+)\]\]/g;
      
      // 先找出所有双括号链接的位置
      const validPositions = new Set<number>();
      let match;
      while ((match = doubleBracketPattern.exec(value)) !== null) {
        // 记录双括号链接的起始位置
        validPositions.add(match.index);
      }
      
      // 重置正则表达式
      singleBracketPattern.lastIndex = 0;
      
      // 检查单括号链接
      while ((match = singleBracketPattern.exec(value)) !== null) {
        // 如果这个位置不是双括号链接的一部分，就是错误
        if (!validPositions.has(match.index) && !validPositions.has(match.index - 1)) {
          errors.push({
            code: "E006",
            message: `wikilink 格式错误: [${match[1]}]，应该使用 [[...]] 格式`,
          });
        }
      }
    } else if (Array.isArray(value)) {
      // 递归检查数组元素
      for (const item of value) {
        this.checkWikilinksInValue(item, errors);
      }
    } else if (typeof value === "object" && value !== null) {
      // 递归检查对象属性
      for (const key in value) {
        this.checkWikilinksInValue((value as Record<string, unknown>)[key], errors);
      }
    }
  }
}
