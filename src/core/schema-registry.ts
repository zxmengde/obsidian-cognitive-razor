/**
 * SchemaRegistry - 知识类型 Schema 注册表
 * 
 * 遵循设计文档 5.1.2 节和 7.4.7 节：
 * - 为每种知识类型提供完整的 JSON Schema
 * - 基于亚里士多德四因说和完备性问题设计字段
 * - 提供字段描述和校验规则
 * 
 * 知识类型：Domain, Issue, Theory, Entity, Mechanism
 */

import { CRType } from "../types";

/**
 * JSON Schema 类型定义
 */
type JSONSchema = {
  $schema?: string;
  type: string;
  required?: string[];
  properties?: Record<string, JSONSchemaProperty>;
  additionalProperties?: boolean;
};

type JSONSchemaProperty = {
  type: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  enum?: string[];
};

/**
 * 字段描述接口
 */
export interface FieldDescription {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
  philosophicalBasis?: string;
}


/**
 * SchemaRegistry 接口
 */
export interface ISchemaRegistry {
  /**
   * 获取指定知识类型的 JSON Schema
   */
  getSchema(type: CRType): JSONSchema;

  /**
   * 获取 standardizeClassify 任务的输出 Schema
   */
  getStandardizeClassifySchema(): JSONSchema;
  
  /**
   * 获取指定知识类型的字段描述
   */
  getFieldDescriptions(type: CRType): FieldDescription[];
  
  /**
   * 获取指定知识类型的校验规则列表
   */
  getValidationRules(type: CRType): string[];
  
  /**
   * 获取所有知识类型
   */
  getAllTypes(): CRType[];

  /**
   * 检查是否为有效的知识类型
   */
  isValidType(type: string): type is CRType;
}

// ============================================================================
// Domain 类型定义
// 设计文档 D-TYPE-01：知识的边界划分
// ============================================================================

const DOMAIN_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "teleology",
    "methodology",
    "historical_genesis",
    "boundaries",
    "issues",
    "holistic_understanding"
  ],
  properties: {
    // 形式因：该领域研究什么对象？
    definition: {
      type: "string",
      description: "该领域研究什么对象？",
      minLength: 50
    },
    // 目的因：该领域试图回答什么问题？
    teleology: {
      type: "string",
      description: "该领域试图回答什么问题？解决什么需求？",
      minLength: 50
    },
    // 动力因：该领域如何生产和验证知识？
    methodology: {
      type: "string",
      description: "该领域如何生产和验证知识？",
      minLength: 50
    },
    // 质料因：该领域何时、为何、如何产生？
    historical_genesis: {
      type: "string",
      description: "该领域何时、为何、如何产生？",
      minLength: 50
    },
    // 否定性定义：该领域明确不研究什么？
    boundaries: {
      type: "array",
      description: "该领域明确不研究什么？与相邻领域的分界线？",
      items: { type: "string", minLength: 10 },
      minItems: 1
    },
    // 问题空间：该领域的涌现议题列表
    issues: {
      type: "array",
      description: "该领域的涌现议题列表",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "议题名称" },
          description: { type: "string", description: "议题描述" }
        }
      }
    },
    // 综合理解
    holistic_understanding: {
      type: "string",
      description: "综合上述信息，如何整体理解该领域？",
      minLength: 100
    },
    // 可选：子领域
    sub_domains: {
      type: "array",
      description: "子领域划分（仅在领域可继续划分时给出）",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "子领域名称" },
          description: { type: "string", description: "详细定义和范围" }
        }
      }
    },
    // 可选：相关领域
    related_domains: {
      type: "array",
      description: "相关领域（wikilink）",
      items: { type: "string" }
    }
  }
};


// ============================================================================
// Issue 类型定义
// 设计文档 D-TYPE-02：尚未完全解决的问题，存在核心矛盾
// ============================================================================

const ISSUE_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "core_tension",
    "significance",
    "epistemic_barrier",
    "counter_intuition",
    "historical_genesis",
    "sub_issues",
    "stakeholder_perspectives",
    "boundary_conditions",
    "theories",
    "holistic_understanding"
  ],
  properties: {
    // 形式定义
    definition: {
      type: "string",
      description: "形式定义（属+种差），清晰陈述问题/张力的本质",
      minLength: 50
    },
    // 矛盾律：必须表述为 "X vs Y" 格式
    core_tension: {
      type: "string",
      description: "核心张力，必须表述为 'Concept A vs Concept B' 格式",
      pattern: "^.+ vs .+$"
    },
    // 价值论：为什么这是个问题？
    significance: {
      type: "string",
      description: "详细解释为什么这个议题至关重要，理论后果或现实影响",
      minLength: 50
    },
    // 认识论障碍
    epistemic_barrier: {
      type: "string",
      description: "该议题未解决的根本原因（如：缺乏实证数据、逻辑悖论、定义模糊）",
      minLength: 50
    },
    // 反直觉性
    counter_intuition: {
      type: "string",
      description: "该议题如何挑战常识或直觉理解",
      minLength: 50
    },
    // 时间性：该议题何时被识别？
    historical_genesis: {
      type: "string",
      description: "问题的起源故事，关键事件、日期和人物",
      minLength: 50
    },
    // 子议题
    sub_issues: {
      type: "array",
      description: "子问题列表",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "子议题名称" },
          description: { type: "string", description: "子问题的详细定义" }
        }
      }
    },
    // 主体间性：不同立场的人如何看待此议题？
    stakeholder_perspectives: {
      type: "array",
      description: "不同立场的人如何看待此议题？",
      items: {
        type: "object",
        required: ["stakeholder", "perspective"],
        properties: {
          stakeholder: { type: "string", description: "群体/学派名称" },
          perspective: { type: "string", description: "该方的具体立场或解释" }
        }
      },
      minItems: 2
    },
    // 否定性定义：在什么条件下该议题不成立？
    boundary_conditions: {
      type: "array",
      description: "在什么条件下该议题不相关？范围限制",
      items: { type: "string", minLength: 10 },
      minItems: 1
    },
    // 解空间：尝试解决此议题的各种理论
    theories: {
      type: "array",
      description: "尝试解决此议题的各种理论",
      items: {
        type: "object",
        required: ["name", "status", "brief"],
        properties: {
          name: { type: "string", description: "理论名称" },
          status: { 
            type: "string", 
            enum: ["mainstream", "marginal", "falsified"],
            description: "主流/边缘/已证伪" 
          },
          brief: { type: "string", description: "该理论如何尝试解决主要议题" }
        }
      }
    },
    // 综合理解
    holistic_understanding: {
      type: "string",
      description: "哲学世界观，该议题如何重构现实/认知",
      minLength: 100
    }
  }
};


// ============================================================================
// Theory 类型定义
// 设计文档 D-TYPE-03：从公理出发的逻辑推演体系
// ============================================================================

const THEORY_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "axioms",
    "argument_chain",
    "core_predictions",
    "scope_and_applicability",
    "limitations",
    "historical_development",
    "extracted_components",
    "holistic_understanding"
  ],
  properties: {
    // 第一原理：不证自明的基础假设
    axioms: {
      type: "array",
      description: "不证自明的基础假设（至少 1 个）",
      items: {
        type: "object",
        required: ["statement", "justification"],
        properties: {
          statement: { type: "string", description: "公理陈述" },
          justification: { type: "string", description: "公理依据/正当性说明" },
          source: { type: "string", description: "来源引用" }
        }
      },
      minItems: 1
    },
    // 演绎推理：从公理到结论的完整推导
    argument_chain: {
      type: "array",
      description: "从公理到结论的完整推导",
      items: {
        type: "object",
        required: ["step", "claim", "reasoning", "premises"],
        properties: {
          step: { type: "number", description: "步骤编号" },
          claim: { type: "string", description: "论断" },
          reasoning: { type: "string", description: "推理过程" },
          premises: { 
            type: "array", 
            items: { type: "string" },
            description: "依赖的前提（公理编号或前序步骤）" 
          }
        }
      },
      minItems: 1
    },
    // 可证伪性：该理论做出的可检验预测
    core_predictions: {
      type: "array",
      description: "该理论做出的可检验预测",
      items: { type: "string", minLength: 20 },
      minItems: 1
    },
    // 边界：该理论在什么条件下有效？
    scope_and_applicability: {
      type: "string",
      description: "该理论在什么条件下有效？",
      minLength: 50
    },
    // 批判性：已知的缺陷、无法解释的现象
    limitations: {
      type: "array",
      description: "已知的缺陷、无法解释的现象",
      items: { type: "string", minLength: 20 }
    },
    // 起源：该理论的创立、演变和修正历程
    historical_development: {
      type: "string",
      description: "该理论的创立、演变和修正历程",
      minLength: 50
    },
    // 核心产出：该理论定义的实体和描述的机制
    extracted_components: {
      type: "object",
      required: ["entities", "mechanisms"],
      properties: {
        entities: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "role"],
            properties: {
              name: { type: "string", description: "组件名称（wikilink）" },
              role: { type: "string", description: "在理论中的角色" }
            }
          },
          description: "提取的实体列表"
        },
        mechanisms: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "role"],
            properties: {
              name: { type: "string", description: "组件名称（wikilink）" },
              role: { type: "string", description: "在理论中的角色" }
            }
          },
          description: "提取的机制列表"
        }
      }
    },
    // 综合理解
    holistic_understanding: {
      type: "string",
      description: "综合上述信息，如何整体理解该理论？",
      minLength: 100
    }
  }
};


// ============================================================================
// Entity 类型定义
// 设计文档 D-TYPE-04：静态概念，可在不引用时间/过程的前提下完成定义
// ============================================================================

const ENTITY_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "classification",
    "properties",
    "distinguishing_features",
    "examples",
    "counter_examples",
    "holistic_understanding"
  ],
  properties: {
    // 本质：该实体是什么？使用属加种差定义法
    definition: {
      type: "string",
      description: "该实体是什么？使用属加种差定义法",
      minLength: 50
    },
    // 范畴：该实体属于哪个上位类？
    classification: {
      type: "object",
      required: ["genus", "differentia"],
      properties: {
        genus: { type: "string", description: "属（上位概念）" },
        differentia: { 
          type: "array", 
          items: { type: "string" },
          description: "种差（区分特征）" 
        },
        siblings: { 
          type: "array", 
          items: { type: "string" },
          description: "同级概念（wikilink）" 
        }
      }
    },
    // 偶性：该实体的可测量/可观察特征
    properties: {
      type: "array",
      description: "该实体的可测量/可观察特征",
      items: {
        type: "object",
        required: ["name", "type", "description"],
        properties: {
          name: { type: "string", description: "属性名" },
          type: { type: "string", description: "属性类型" },
          description: { type: "string", description: "属性描述" },
          measurement: { type: "string", description: "度量方式" }
        }
      },
      minItems: 1
    },
    // 个体化原则：使该实体区别于相似概念的关键特征
    distinguishing_features: {
      type: "array",
      description: "使该实体区别于相似概念的关键特征",
      items: { type: "string", minLength: 10 },
      minItems: 1
    },
    // 外延：典型的、属于该实体的实例
    examples: {
      type: "array",
      description: "典型的、属于该实体的实例",
      items: { type: "string" },
      minItems: 1
    },
    // 否定外延：容易误认为是该实体、但实际不是的实例
    counter_examples: {
      type: "array",
      description: "容易误认为是该实体、但实际不是的实例",
      items: { type: "string" }
    },
    // 综合理解
    holistic_understanding: {
      type: "string",
      description: "综合上述信息，如何整体理解该实体？",
      minLength: 100
    },
    // 关系字段
    is_a: {
      type: "string",
      description: "上位类（wikilink）"
    },
    has_parts: {
      type: "array",
      items: { type: "string" },
      description: "组成部分（wikilink）"
    },
    related_to: {
      type: "array",
      items: { type: "string" },
      description: "其他相关但非层级关系的实体（wikilink）"
    }
  }
};


// ============================================================================
// Mechanism 类型定义
// 设计文档 D-TYPE-05：动态过程，描述状态变化或因果链
// ============================================================================

const MECHANISM_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "trigger_conditions",
    "causal_chain",
    "termination_conditions",
    "inputs",
    "outputs",
    "process_description",
    "examples",
    "holistic_understanding"
  ],
  properties: {
    // 本质：该机制是什么过程？
    definition: {
      type: "string",
      description: "该机制是什么过程？",
      minLength: 50
    },
    // 动力因：什么条件下该机制启动？
    trigger_conditions: {
      type: "array",
      description: "什么条件下该机制启动？",
      items: { type: "string", minLength: 10 },
      minItems: 1
    },
    // 因果性：按步骤描述因果链（至少 2 步）
    causal_chain: {
      type: "array",
      description: "按步骤描述因果链（至少 2 步）",
      items: {
        type: "object",
        required: ["step", "description", "entities_involved", "conditions", "outcome"],
        properties: {
          step: { type: "number", description: "步骤编号" },
          description: { type: "string", description: "步骤描述" },
          entities_involved: { 
            type: "array", 
            items: { type: "string" },
            description: "涉及的实体（wikilink）" 
          },
          conditions: { 
            type: "array", 
            items: { type: "string" },
            description: "该步骤的前提条件" 
          },
          outcome: { type: "string", description: "该步骤的产出" }
        }
      },
      minItems: 2
    },
    // 边界：什么条件下该机制停止？
    termination_conditions: {
      type: "array",
      description: "什么条件下该机制停止？",
      items: { type: "string", minLength: 10 },
      minItems: 1
    },
    // 质料因：该机制需要什么前提条件/资源？
    inputs: {
      type: "array",
      description: "该机制需要什么前提条件/资源？",
      items: { type: "string" },
      minItems: 1
    },
    // 目的因：该机制产生什么结果/效果？
    outputs: {
      type: "array",
      description: "该机制产生什么结果/效果？",
      items: { type: "string" },
      minItems: 1
    },
    // 叙事：对整个过程的连贯文字描述
    process_description: {
      type: "string",
      description: "对整个过程的连贯文字描述",
      minLength: 100
    },
    // 外延：该机制的典型应用场景
    examples: {
      type: "array",
      description: "该机制的典型应用场景",
      items: { type: "string" },
      minItems: 1
    },
    // 综合理解
    holistic_understanding: {
      type: "string",
      description: "综合上述信息，如何整体理解该机制？",
      minLength: 100
    },
    // 关系字段
    operates_on: {
      type: "array",
      items: { type: "string" },
      description: "作用对象（至少 1 个，wikilink）",
      minItems: 1
    },
    produces: {
      type: "array",
      items: { type: "string" },
      description: "产出的新实体或状态（wikilink）"
    },
    requires: {
      type: "array",
      items: { type: "string" },
      description: "依赖的其他机制（wikilink）"
    },
    inhibited_by: {
      type: "array",
      items: { type: "string" },
      description: "抑制因素"
    }
  }
};


// ============================================================================
// standardizeClassify 输出 Schema
// ============================================================================

const STANDARDIZE_CLASSIFY_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["classification_result"],
  properties: {
    classification_result: {
      type: "object",
      required: ["Domain", "Issue", "Theory", "Entity", "Mechanism"],
      properties: {
        Domain: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string", minLength: 1 },
            standard_name_en: { type: "string", minLength: 1 },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Issue: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string", minLength: 1 },
            standard_name_en: { type: "string", minLength: 1 },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Theory: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string", minLength: 1 },
            standard_name_en: { type: "string", minLength: 1 },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Entity: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string", minLength: 1 },
            standard_name_en: { type: "string", minLength: 1 },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Mechanism: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string", minLength: 1 },
            standard_name_en: { type: "string", minLength: 1 },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      }
    }
  }
};

// ============================================================================
// Schema 映射表
// ============================================================================

const SCHEMAS: Record<CRType, JSONSchema> = {
  Domain: DOMAIN_SCHEMA,
  Issue: ISSUE_SCHEMA,
  Theory: THEORY_SCHEMA,
  Entity: ENTITY_SCHEMA,
  Mechanism: MECHANISM_SCHEMA
};

// ============================================================================
// 校验规则映射表
// 遵循设计文档 6.5.2 节
// ============================================================================

const VALIDATION_RULES: Record<CRType, string[]> = {
  Domain: ["C002", "C008", "C010", "C011", "C012", "C016"],
  Issue: ["C001", "C002", "C010", "C011", "C012", "C013"],
  Theory: ["C002", "C003", "C004", "C010", "C011", "C012", "C014", "C015"],
  Entity: ["C002", "C007", "C010", "C011", "C012"],
  Mechanism: ["C002", "C005", "C006", "C010", "C011", "C012"]
};


// ============================================================================
// 字段描述映射表
// ============================================================================

const FIELD_DESCRIPTIONS: Record<CRType, FieldDescription[]> = {
  Domain: [
    { name: "definition", type: "string", required: true, description: "该领域研究什么对象？", philosophicalBasis: "形式因" },
    { name: "teleology", type: "string", required: true, description: "该领域试图回答什么问题？", philosophicalBasis: "目的因" },
    { name: "methodology", type: "string", required: true, description: "该领域如何生产和验证知识？", philosophicalBasis: "动力因" },
    { name: "historical_genesis", type: "string", required: true, description: "该领域何时、为何、如何产生？", philosophicalBasis: "质料因" },
    { name: "boundaries", type: "array", required: true, description: "该领域明确不研究什么？", philosophicalBasis: "否定性定义" },
    { name: "issues", type: "array", required: true, description: "该领域的涌现议题列表", philosophicalBasis: "问题空间" },
    { name: "holistic_understanding", type: "string", required: true, description: "如何整体理解该领域？", philosophicalBasis: "综合" },
    { name: "sub_domains", type: "array", required: false, description: "子领域划分" },
    { name: "related_domains", type: "array", required: false, description: "相关领域" }
  ],
  Issue: [
    { name: "core_tension", type: "string", required: true, description: "核心张力，格式为 'X vs Y'", philosophicalBasis: "矛盾律", example: "效率 vs 公平" },
    { name: "significance", type: "string", required: true, description: "该议题的重要性和影响范围", philosophicalBasis: "价值论" },
    { name: "historical_genesis", type: "string", required: true, description: "该议题何时被识别？", philosophicalBasis: "时间性" },
    { name: "structural_analysis", type: "string", required: true, description: "将议题拆解为子问题", philosophicalBasis: "分解" },
    { name: "stakeholder_perspectives", type: "array", required: true, description: "不同立场的人如何看待此议题？", philosophicalBasis: "主体间性" },
    { name: "boundary_conditions", type: "array", required: true, description: "在什么条件下该议题不成立？", philosophicalBasis: "否定性定义" },
    { name: "theories", type: "array", required: true, description: "尝试解决此议题的各种理论", philosophicalBasis: "解空间" },
    { name: "holistic_understanding", type: "string", required: true, description: "如何整体理解该议题？", philosophicalBasis: "综合" }
  ],
  Theory: [
    { name: "axioms", type: "array", required: true, description: "不证自明的基础假设", philosophicalBasis: "第一原理" },
    { name: "argument_chain", type: "array", required: true, description: "从公理到结论的完整推导", philosophicalBasis: "演绎推理" },
    { name: "core_predictions", type: "array", required: true, description: "该理论做出的可检验预测", philosophicalBasis: "可证伪性" },
    { name: "scope_and_applicability", type: "string", required: true, description: "该理论在什么条件下有效？", philosophicalBasis: "边界" },
    { name: "limitations", type: "array", required: true, description: "已知的缺陷、无法解释的现象", philosophicalBasis: "批判性" },
    { name: "historical_development", type: "string", required: true, description: "该理论的创立、演变和修正历程", philosophicalBasis: "起源" },
    { name: "extracted_components", type: "object", required: true, description: "该理论定义的实体和描述的机制", philosophicalBasis: "核心产出" },
    { name: "holistic_understanding", type: "string", required: true, description: "如何整体理解该理论？", philosophicalBasis: "综合" }
  ],
  Entity: [
    { name: "definition", type: "string", required: true, description: "该实体是什么？使用属加种差定义法", philosophicalBasis: "本质" },
    { name: "classification", type: "object", required: true, description: "该实体属于哪个上位类？", philosophicalBasis: "范畴" },
    { name: "properties", type: "array", required: true, description: "该实体的可测量/可观察特征", philosophicalBasis: "偶性" },
    { name: "distinguishing_features", type: "array", required: true, description: "使该实体区别于相似概念的关键特征", philosophicalBasis: "个体化原则" },
    { name: "examples", type: "array", required: true, description: "典型的、属于该实体的实例", philosophicalBasis: "外延" },
    { name: "counter_examples", type: "array", required: true, description: "容易误认为是该实体、但实际不是的实例", philosophicalBasis: "否定外延" },
    { name: "holistic_understanding", type: "string", required: true, description: "如何整体理解该实体？", philosophicalBasis: "综合" }
  ],
  Mechanism: [
    { name: "definition", type: "string", required: true, description: "该机制是什么过程？", philosophicalBasis: "本质" },
    { name: "trigger_conditions", type: "array", required: true, description: "什么条件下该机制启动？", philosophicalBasis: "动力因" },
    { name: "causal_chain", type: "array", required: true, description: "按步骤描述因果链", philosophicalBasis: "因果性" },
    { name: "termination_conditions", type: "array", required: true, description: "什么条件下该机制停止？", philosophicalBasis: "边界" },
    { name: "inputs", type: "array", required: true, description: "该机制需要什么前提条件/资源？", philosophicalBasis: "质料因" },
    { name: "outputs", type: "array", required: true, description: "该机制产生什么结果/效果？", philosophicalBasis: "目的因" },
    { name: "process_description", type: "string", required: true, description: "对整个过程的连贯文字描述", philosophicalBasis: "叙事" },
    { name: "examples", type: "array", required: true, description: "该机制的典型应用场景", philosophicalBasis: "外延" },
    { name: "holistic_understanding", type: "string", required: true, description: "如何整体理解该机制？", philosophicalBasis: "综合" }
  ]
};


// ============================================================================
// SchemaRegistry 实现类
// ============================================================================

class SchemaRegistryImpl implements ISchemaRegistry {
  /**
   * 检查是否为有效的知识类型
   * 遵循设计文档 G-03：知识类型属于有限有序集合 K = {Domain, Issue, Theory, Entity, Mechanism}
   */
  isValidType(type: string): type is CRType {
    return ["Domain", "Issue", "Theory", "Entity", "Mechanism"].includes(type);
  }

  /**
   * 获取指定知识类型的 JSON Schema
   */
  getSchema(type: CRType): JSONSchema {
    const schema = SCHEMAS[type];
    if (!schema) {
      throw new Error(`Unknown CRType: ${type}`);
    }
    return schema;
  }

  /**
   * 获取 standardizeClassify 任务的输出 Schema
   */
  getStandardizeClassifySchema(): JSONSchema {
    return STANDARDIZE_CLASSIFY_SCHEMA;
  }

  /**
   * 获取指定知识类型的字段描述
   */
  getFieldDescriptions(type: CRType): FieldDescription[] {
    const descriptions = FIELD_DESCRIPTIONS[type];
    if (!descriptions) {
      throw new Error(`Unknown CRType: ${type}`);
    }
    return descriptions;
  }

  /**
   * 获取指定知识类型的校验规则列表
   */
  getValidationRules(type: CRType): string[] {
    const rules = VALIDATION_RULES[type];
    if (!rules) {
      throw new Error(`Unknown CRType: ${type}`);
    }
    return rules;
  }

  /**
   * 获取所有知识类型
   */
  getAllTypes(): CRType[] {
    return ["Domain", "Issue", "Theory", "Entity", "Mechanism"];
  }

  /**
   * 获取知识类型的中文名称
   */
  getTypeName(type: CRType, locale: "zh" | "en" = "zh"): string {
    const names: Record<CRType, { zh: string; en: string }> = {
      Domain: { zh: "领域", en: "Domain" },
      Issue: { zh: "议题", en: "Issue" },
      Theory: { zh: "理论", en: "Theory" },
      Entity: { zh: "实体", en: "Entity" },
      Mechanism: { zh: "机制", en: "Mechanism" }
    };
    return names[type][locale];
  }

  /**
   * 获取知识类型的描述
   */
  getTypeDescription(type: CRType): string {
    const descriptions: Record<CRType, string> = {
      Domain: "知识的边界划分，定义'什么属于/不属于这个学科'",
      Issue: "尚未完全解决的问题，存在核心矛盾",
      Theory: "从公理出发的逻辑推演体系",
      Entity: "静态概念，可在不引用时间/过程的前提下完成定义",
      Mechanism: "动态过程，描述状态变化或因果链"
    };
    return descriptions[type];
  }

  /**
   * 获取深化路径
   * 遵循设计文档 G-04：Domain → Issue → Theory → {Entity, Mechanism}
   */
  getDeepenTargets(type: CRType): CRType[] {
    const deepenMap: Record<CRType, CRType[]> = {
      Domain: ["Issue"],
      Issue: ["Theory"],
      Theory: ["Entity", "Mechanism"],
      Entity: [],
      Mechanism: []
    };
    return deepenMap[type];
  }

  /**
   * 检查是否可以从 sourceType 深化到 targetType
   */
  canDeepen(sourceType: CRType, targetType: CRType): boolean {
    const targets = this.getDeepenTargets(sourceType);
    return targets.includes(targetType);
  }
}

// 导出单例实例
export const schemaRegistry = new SchemaRegistryImpl();
