/**
 * Validator 实现
 * 验证 AI 输出，包括 JSON 解析、Schema 校验、必填字段检查、业务规则校验和语义去重
 * 
 * 验证顺序 (Requirements 1.6):
 * 1. JSON 解析 → E001 PARSE_ERROR
 * 2. Schema 校验 → E002 SCHEMA_VIOLATION
 * 3. 必填字段检查 → E003 MISSING_REQUIRED
 * 4. 业务规则 (C001-C016) → E003/E004/E006/E009/E010
 * 5. 语义去重 → E005 SEMANTIC_DUPLICATE
 * 
 * 按顺序返回第一个错误类型
 */

import {
  IValidator,
  ValidationResult,
  ValidationError,
  ValidationContext,
  IVectorIndex,
  CRType,
} from "../types";

/**
 * 业务规则校验函数类型
 */
type RuleValidator = (data: Record<string, unknown>, context?: ValidationContext) => ValidationError | null;

/**
 * 验证阶段枚举
 */
export type ValidationPhase = 
  | "parse"           // JSON 解析
  | "schema"          // Schema 校验
  | "required"        // 必填字段检查
  | "business"        // 业务规则校验
  | "semantic";       // 语义去重

/**
 * Validator 实现类
 * 
 * 实现 Property 5: Validation Order
 * For any LLM output validated by Validator, errors SHALL be detected in order:
 * JSON parsing (E001) → Schema (E002) → Required fields (E003) → Business rules (E004-E010),
 * with the first error type taking precedence.
 */
export class Validator implements IValidator {
  private vectorIndex?: IVectorIndex;
  private ruleValidators: Map<string, RuleValidator>;

  /**
   * 构造函数
   * @param vectorIndex 向量索引实例（用于语义去重）
   */
  constructor(vectorIndex?: IVectorIndex) {
    this.vectorIndex = vectorIndex;
    this.ruleValidators = this.initializeRuleValidators();
  }

  /**
   * 验证输出
   * 
   * 验证顺序严格遵循 Requirements 1.6:
   * 1. JSON 解析 → E001
   * 2. Schema 校验 → E002
   * 3. 必填字段检查 → E003
   * 4. 业务规则 (C001-C016) → E003/E004/E006/E009/E010
   * 5. 语义去重 → E005
   * 
   * 按顺序返回第一个错误类型
   */
  async validate(
    output: string,
    schema: object,
    rules: string[],
    context?: ValidationContext
  ): Promise<ValidationResult> {
    // 阶段 1: JSON 解析校验
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(output);
    } catch {
      return {
        valid: false,
        errors: [{
          code: "E001",
          type: "ParseError",
          message: "Failed to parse JSON output",
          rawOutput: output.substring(0, 500), // 限制长度
          fixInstruction: "Ensure the output is valid JSON format",
        }],
      };
    }

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

    // 阶段 4: 业务规则校验
    const businessErrors = this.validateBusinessRules(data, rules, context);
    if (businessErrors.length > 0) {
      return { valid: false, errors: businessErrors };
    }

    // 阶段 5: 语义去重检查（如果提供了向量索引和上下文）
    if (this.vectorIndex && context?.type && context?.embedding) {
      const dedupeResult = await this.validateSemanticDuplication(data, context);
      if (dedupeResult.length > 0) {
        // 语义去重不阻断流程，但记录重复对
        return {
          valid: true,
          data,
          errors: dedupeResult,
          duplicates: dedupeResult.map(e => ({
            uid: (e as unknown as { duplicateUid?: string }).duplicateUid || "",
            similarity: (e as unknown as { similarity?: number }).similarity || 0,
            name: "",
            path: "",
          })),
        };
      }
    }

    return {
      valid: true,
      data,
    };
  }

  /**
   * 获取验证阶段
   * 根据错误码判断验证阶段
   */
  getValidationPhase(errorCode: string): ValidationPhase {
    if (errorCode === "E001") return "parse";
    if (errorCode === "E002") return "schema";
    if (errorCode === "E003") return "required";
    if (errorCode === "E005") return "semantic";
    // E004, E006, E007, E008, E009, E010 都是业务规则错误
    return "business";
  }

  /**
   * Schema 校验（简化版，使用基本类型检查）
   * 返回 E002 错误
   */
  private validateSchema(data: Record<string, unknown>, schema: object): ValidationError[] {
    const errors: ValidationError[] = [];
    const schemaProps = (schema as { properties?: Record<string, { type: string }> }).properties;

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
      } else if (expectedType === "object" && (typeof value !== "object" || Array.isArray(value))) {
        errors.push({
          code: "E002",
          type: "SchemaError",
          message: `Field "${key}" should be an object`,
          location: key,
          fixInstruction: `Ensure "${key}" is an object`,
        });
      } else if (expectedType !== "array" && expectedType !== "object" && expectedType !== actualType) {
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
  private validateRequiredFields(data: Record<string, unknown>, schema: object): ValidationError[] {
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

  /**
   * 业务规则校验
   * 按规则顺序执行，返回第一个错误
   */
  private validateBusinessRules(
    data: Record<string, unknown>,
    rules: string[],
    context?: ValidationContext
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const validator = this.ruleValidators.get(rule);
      if (validator) {
        const error = validator(data, context);
        if (error) {
          errors.push(error);
          // 返回第一个业务规则错误
          return errors;
        }
      }
    }

    return errors;
  }

  /**
   * 语义去重检查
   * 返回 E005 错误（不阻断流程）
   */
  private async validateSemanticDuplication(
    _data: Record<string, unknown>,
    _context: ValidationContext
  ): Promise<ValidationError[]> {
    // 语义去重检查在 DuplicateManager 中实现
    // 这里返回空数组，因为去重检查通常在任务完成后单独进行
    return [];
  }

  /**
   * 初始化业务规则校验器
   * 实现 C001-C016 校验规则
   */
  private initializeRuleValidators(): Map<string, RuleValidator> {
    const validators = new Map<string, RuleValidator>();

    // C001: Issue 类型的 core_tension 必须匹配 "X vs Y" 格式
    // Property 28: Issue Core Tension Pattern
    validators.set("C001", (data) => {
      const coreTension = data.core_tension as string;
      if (coreTension === undefined || coreTension === null) {
        return null; // 由必填字段检查处理
      }
      if (!/^.+ vs .+$/.test(coreTension)) {
        return {
          code: "E010",
          type: "InvalidPattern",
          message: 'Field "core_tension" must match pattern "X vs Y"',
          location: "core_tension",
          rawOutput: JSON.stringify({ core_tension: coreTension }),
          fixInstruction: 'Ensure "core_tension" follows the format "X vs Y", e.g., "效率 vs 公平"',
        };
      }
      return null;
    });

    // C002: wikilink 必须使用 [[...]] 格式
    validators.set("C002", (data) => {
      const checkWikilinks = (value: unknown, path: string): ValidationError | null => {
        if (typeof value === "string") {
          // 检查是否有不完整的 wikilink 格式
          const invalidWikilink = /\[\[[^\]]*$|^[^\[]*\]\]/.test(value);
          if (invalidWikilink) {
            return {
              code: "E006",
              type: "InvalidWikilink",
              message: `Invalid wikilink format at "${path}"`,
              location: path,
              fixInstruction: 'Ensure all wikilinks use the format "[[...]]"',
            };
          }
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const error = checkWikilinks(value[i], `${path}[${i}]`);
            if (error) return error;
          }
        } else if (typeof value === "object" && value !== null) {
          for (const [key, val] of Object.entries(value)) {
            const error = checkWikilinks(val, `${path}.${key}`);
            if (error) return error;
          }
        }
        return null;
      };
      return checkWikilinks(data, "$");
    });

    // C003: Theory 类型的 axioms 数组长度必须 >= 1
    validators.set("C003", (data) => {
      const axioms = data.axioms as unknown[];
      if (axioms === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!Array.isArray(axioms) || axioms.length < 1) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "axioms" must have at least 1 element',
          location: "axioms",
          fixInstruction: 'Ensure "axioms" array has at least one element',
        };
      }
      return null;
    });

    // C004: Theory 类型的 axioms 每个元素必须有 statement 和 justification
    validators.set("C004", (data) => {
      const axioms = data.axioms as Array<Record<string, unknown>>;
      if (!Array.isArray(axioms)) {
        return null; // 由 C003 处理
      }

      for (let i = 0; i < axioms.length; i++) {
        const axiom = axioms[i];
        if (!axiom || typeof axiom !== "object") {
          return {
            code: "E003",
            type: "MissingField",
            message: `Axiom at index ${i} must be an object`,
            location: `axioms[${i}]`,
            fixInstruction: 'Ensure each axiom is an object with "statement" and "justification" fields',
          };
        }
        if (!axiom.statement || !axiom.justification) {
          return {
            code: "E003",
            type: "MissingField",
            message: `Axiom at index ${i} must have "statement" and "justification"`,
            location: `axioms[${i}]`,
            fixInstruction: 'Ensure each axiom has "statement" and "justification" fields',
          };
        }
      }
      return null;
    });

    // C005: Mechanism 类型的 causal_chain 数组长度必须 >= 2
    validators.set("C005", (data) => {
      const causalChain = data.causal_chain as unknown[];
      if (causalChain === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!Array.isArray(causalChain) || causalChain.length < 2) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "causal_chain" must have at least 2 elements',
          location: "causal_chain",
          fixInstruction: 'Ensure "causal_chain" array has at least two elements',
        };
      }
      return null;
    });

    // C006: Mechanism 类型的 operates_on 数组长度必须 >= 1
    validators.set("C006", (data) => {
      const operatesOn = data.operates_on as unknown[];
      if (operatesOn === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!Array.isArray(operatesOn) || operatesOn.length < 1) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "operates_on" must have at least 1 element',
          location: "operates_on",
          fixInstruction: 'Ensure "operates_on" array has at least one element',
        };
      }
      return null;
    });

    // C007: Entity 类型的 classification 必须包含 genus 和 differentia
    validators.set("C007", (data) => {
      const classification = data.classification as Record<string, unknown>;
      if (classification === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!classification || typeof classification !== "object") {
        return {
          code: "E004",
          type: "ConstraintViolation",
          message: 'Field "classification" must be an object',
          location: "classification",
          fixInstruction: 'Ensure "classification" is an object with "genus" and "differentia" fields',
        };
      }
      if (!classification.genus || !classification.differentia) {
        return {
          code: "E004",
          type: "ConstraintViolation",
          message: 'Field "classification" must have "genus" and "differentia"',
          location: "classification",
          fixInstruction: 'Ensure "classification" has both "genus" and "differentia" fields',
        };
      }
      return null;
    });

    // C008: Domain 类型的 boundaries 数组长度必须 >= 1
    validators.set("C008", (data) => {
      const boundaries = data.boundaries as unknown[];
      if (boundaries === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!Array.isArray(boundaries) || boundaries.length < 1) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "boundaries" must have at least 1 element',
          location: "boundaries",
          fixInstruction: 'Ensure "boundaries" array has at least one element',
        };
      }
      return null;
    });

    // C009: standardizeClassify 输出的 type_confidences 五值求和 = 1.0
    validators.set("C009", (data) => {
      const typeConfidences = data.type_confidences as Record<string, number>;
      if (typeConfidences === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!typeConfidences || typeof typeConfidences !== "object") {
        return {
          code: "E009",
          type: "SumNotOne",
          message: 'Field "type_confidences" must be an object',
          location: "type_confidences",
          fixInstruction: 'Ensure "type_confidences" is an object with five type values',
        };
      }
      const types: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
      let sum = 0;
      for (const type of types) {
        const value = typeConfidences[type];
        if (typeof value !== "number") {
          return {
            code: "E009",
            type: "SumNotOne",
            message: `type_confidences.${type} must be a number`,
            location: `type_confidences.${type}`,
            fixInstruction: `Ensure "type_confidences.${type}" is a number`,
          };
        }
        sum += value;
      }
      // 允许浮点数精度误差
      if (Math.abs(sum - 1.0) > 0.001) {
        return {
          code: "E009",
          type: "SumNotOne",
          message: `type_confidences sum is ${sum.toFixed(4)}, should be 1.0`,
          location: "type_confidences",
          rawOutput: JSON.stringify({ type_confidences: typeConfidences }),
          fixInstruction: "Adjust type_confidences values to sum exactly to 1.0",
        };
      }
      return null;
    });

    // C010: 必填字符串字段长度 > 0 (由 validateRequiredFields 处理)
    validators.set("C010", () => null);

    // C011: 数组字段不得包含空字符串
    validators.set("C011", (data) => {
      const checkEmptyStrings = (value: unknown, path: string): ValidationError | null => {
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (typeof item === "string" && item.trim() === "") {
              return {
                code: "E004",
                type: "ConstraintViolation",
                message: `Array "${path}" contains empty string at index ${i}`,
                location: `${path}[${i}]`,
                fixInstruction: `Remove empty strings from "${path}" array`,
              };
            }
            if (typeof item === "object" && item !== null) {
              const error = checkEmptyStrings(item, `${path}[${i}]`);
              if (error) return error;
            }
          }
        } else if (typeof value === "object" && value !== null) {
          for (const [key, val] of Object.entries(value)) {
            const error = checkEmptyStrings(val, `${path}.${key}`);
            if (error) return error;
          }
        }
        return null;
      };
      return checkEmptyStrings(data, "$");
    });

    // C012: 所有类型的 holistic_understanding 必须存在且非空
    validators.set("C012", (data) => {
      const holisticUnderstanding = data.holistic_understanding;
      if (holisticUnderstanding === undefined || holisticUnderstanding === null) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "holistic_understanding" is required',
          location: "holistic_understanding",
          fixInstruction: 'Provide a non-empty value for "holistic_understanding"',
        };
      }
      if (typeof holisticUnderstanding !== "string" || holisticUnderstanding.trim() === "") {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "holistic_understanding" must be a non-empty string',
          location: "holistic_understanding",
          fixInstruction: 'Provide a non-empty value for "holistic_understanding"',
        };
      }
      return null;
    });

    // C013: Issue 类型的 theories 数组中每项必须包含 name 和 status
    validators.set("C013", (data) => {
      const theories = data.theories as Array<Record<string, unknown>>;
      if (theories === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!Array.isArray(theories)) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "theories" must be an array',
          location: "theories",
          fixInstruction: 'Ensure "theories" is an array',
        };
      }
      for (let i = 0; i < theories.length; i++) {
        const theory = theories[i];
        if (!theory || typeof theory !== "object") {
          return {
            code: "E003",
            type: "MissingField",
            message: `Theory at index ${i} must be an object`,
            location: `theories[${i}]`,
            fixInstruction: 'Ensure each theory is an object with "name" and "status" fields',
          };
        }
        if (!theory.name || !theory.status) {
          return {
            code: "E003",
            type: "MissingField",
            message: `Theory at index ${i} must have "name" and "status"`,
            location: `theories[${i}]`,
            fixInstruction: 'Ensure each theory has "name" and "status" fields',
          };
        }
      }
      return null;
    });

    // C014: Theory 类型的 argument_chain 数组长度 >= 1
    validators.set("C014", (data) => {
      const argumentChain = data.argument_chain as unknown[];
      if (argumentChain === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!Array.isArray(argumentChain) || argumentChain.length < 1) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "argument_chain" must have at least 1 element',
          location: "argument_chain",
          fixInstruction: 'Ensure "argument_chain" array has at least one element',
        };
      }
      return null;
    });

    // C015: Theory 类型的 extracted_components 必须包含 entities 和 mechanisms 数组
    validators.set("C015", (data) => {
      const extractedComponents = data.extracted_components as Record<string, unknown>;
      if (extractedComponents === undefined) {
        return null; // 由必填字段检查处理
      }
      if (!extractedComponents || typeof extractedComponents !== "object") {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "extracted_components" must be an object',
          location: "extracted_components",
          fixInstruction: 'Ensure "extracted_components" is an object with "entities" and "mechanisms" arrays',
        };
      }
      if (!Array.isArray(extractedComponents.entities)) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "extracted_components.entities" must be an array',
          location: "extracted_components.entities",
          fixInstruction: 'Ensure "extracted_components.entities" is an array',
        };
      }
      if (!Array.isArray(extractedComponents.mechanisms)) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "extracted_components.mechanisms" must be an array',
          location: "extracted_components.mechanisms",
          fixInstruction: 'Ensure "extracted_components.mechanisms" is an array',
        };
      }
      return null;
    });

    // C016: Domain 类型的 sub_domains（若存在）每项必须包含 name 和 dimension
    validators.set("C016", (data) => {
      const subDomains = data.sub_domains as Array<Record<string, unknown>>;
      if (subDomains === undefined) {
        return null; // sub_domains 是可选字段
      }
      if (!Array.isArray(subDomains)) {
        return {
          code: "E003",
          type: "MissingField",
          message: 'Field "sub_domains" must be an array',
          location: "sub_domains",
          fixInstruction: 'Ensure "sub_domains" is an array',
        };
      }
      for (let i = 0; i < subDomains.length; i++) {
        const subDomain = subDomains[i];
        if (!subDomain || typeof subDomain !== "object") {
          return {
            code: "E003",
            type: "MissingField",
            message: `SubDomain at index ${i} must be an object`,
            location: `sub_domains[${i}]`,
            fixInstruction: 'Ensure each sub_domain is an object with "name" and "dimension" fields',
          };
        }
        if (!subDomain.name || !subDomain.dimension) {
          return {
            code: "E003",
            type: "MissingField",
            message: `SubDomain at index ${i} must have "name" and "dimension"`,
            location: `sub_domains[${i}]`,
            fixInstruction: 'Ensure each sub_domain has "name" and "dimension" fields',
          };
        }
      }
      return null;
    });

    return validators;
  }

  /**
   * 获取适用于特定类型的校验规则
   * @param type 知识类型
   * @returns 适用的规则列表
   */
  static getRulesForType(type: CRType): string[] {
    const commonRules = ["C002", "C010", "C011", "C012"];
    
    switch (type) {
      case "Domain":
        return [...commonRules, "C008", "C016"];
      case "Issue":
        return [...commonRules, "C001", "C013"];
      case "Theory":
        return [...commonRules, "C003", "C004", "C014", "C015"];
      case "Entity":
        return [...commonRules, "C007"];
      case "Mechanism":
        return [...commonRules, "C005", "C006"];
      default:
        return commonRules;
    }
  }

  /**
   * 获取 standardizeClassify 任务的校验规则
   */
  static getStandardizeClassifyRules(): string[] {
    return ["C009"];
  }
}
