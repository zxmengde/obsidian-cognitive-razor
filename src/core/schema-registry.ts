/**
 * SchemaRegistry - 知识类型 Schema 注册表
 * 为五种知识类型提供 JSON Schema、字段描述和校验规则
 */

import { CRType } from "../types";

/** JSON Schema 类型定义 */
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

/** 字段描述接口 */
export interface FieldDescription {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
  philosophicalBasis?: string;
}

// Domain Schema

const DOMAIN_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "teleology",
    "methodology",
    "boundaries",
    "historical_genesis",
    "holistic_understanding",
    "sub_domains",
    "issues"
  ],
  properties: {
    definition: {
      type: "string",
      description: "定义",
      minLength: 50
    },
    teleology: {
      type: "string",
      description: "目的论",
      minLength: 50
    },
    methodology: {
      type: "string",
      description: "方法论",
      minLength: 50
    },
    boundaries: {
      type: "array",
      description: "边界",
      items: { type: "string", minLength: 10 }
    },
    historical_genesis: {
      type: "string",
      description: "历史起源",
      minLength: 100
    },
    holistic_understanding: {
      type: "string",
      description: "整体理解",
      minLength: 100
    },
    sub_domains: {
      type: "array",
      description: "子领域",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "名称" },
          description: { type: "string", description: "描述" }
        }
      }
    },
    issues: {
      type: "array",
      description: "议题",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "名称" },
          description: { type: "string", description: "描述" }
        }
      }
    }
  }
};

// Issue Schema

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
    definition: {
      type: "string",
      description: "定义",
      minLength: 50
    },
    core_tension: {
      type: "string",
      description: "核心张力",
      pattern: "^.+\\s+(vs\\.?|VS\\.?|versus|与|对)\\s+.+$"
    },
    significance: {
      type: "string",
      description: "重要性",
      minLength: 50
    },
    epistemic_barrier: {
      type: "string",
      description: "认识论障碍",
      minLength: 50
    },
    counter_intuition: {
      type: "string",
      description: "反直觉性",
      minLength: 50
    },
    historical_genesis: {
      type: "string",
      description: "历史起源",
      minLength: 100
    },
    sub_issues: {
      type: "array",
      description: "子议题",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "名称" },
          description: { type: "string", description: "描述" }
        }
      }
    },
    stakeholder_perspectives: {
      type: "array",
      description: "利益相关者视角",
      items: {
        type: "object",
        required: ["stakeholder", "perspective"],
        properties: {
          stakeholder: { type: "string", description: "利益相关者" },
          perspective: { type: "string", description: "观点" }
        }
      }
    },
    boundary_conditions: {
      type: "array",
      description: "边界条件",
      items: { type: "string", minLength: 10 }
    },
    theories: {
      type: "array",
      description: "理论",
      items: {
        type: "object",
        required: ["name", "status", "brief"],
        properties: {
          name: { type: "string", description: "名称" },
          status: { 
            type: "string", 
            enum: ["mainstream", "marginal", "falsified"],
            description: "状态" 
          },
          brief: { type: "string", description: "简介" }
        }
      }
    },
    holistic_understanding: {
      type: "string",
      description: "整体理解",
      minLength: 100
    }
  }
};

// Theory Schema

const THEORY_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "axioms",
    "sub_theories",
    "logical_structure",
    "entities",
    "mechanisms",
    "core_predictions",
    "limitations",
    "historical_genesis",
    "holistic_understanding"
  ],
  properties: {
    definition: {
      type: "string",
      description: "定义",
      minLength: 50
    },
    axioms: {
      type: "array",
      description: "公理",
      items: {
        type: "object",
        required: ["statement", "justification"],
        properties: {
          statement: { type: "string", description: "陈述" },
          justification: { type: "string", description: "理由" }
        }
      }
    },
    sub_theories: {
      type: "array",
      description: "子理论",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "名称" },
          description: { type: "string", description: "描述" }
        }
      }
    },
    logical_structure: {
      type: "string",
      description: "逻辑结构",
      minLength: 100
    },
    entities: {
      type: "array",
      description: "实体",
      items: {
        type: "object",
        required: ["name", "role", "attributes"],
        properties: {
          name: { type: "string", description: "名称" },
          role: { type: "string", description: "角色" },
          attributes: { type: "string", description: "属性" }
        }
      }
    },
    mechanisms: {
      type: "array",
      description: "机制",
      items: {
        type: "object",
        required: ["name", "process", "function"],
        properties: {
          name: { type: "string", description: "名称" },
          process: { type: "string", description: "过程" },
          function: { type: "string", description: "功能" }
        }
      }
    },
    core_predictions: {
      type: "array",
      description: "核心预测",
      items: { type: "string", description: "预测" }
    },
    limitations: {
      type: "array",
      description: "局限性",
      items: { type: "string", description: "限制" }
    },
    historical_genesis: {
      type: "string",
      description: "历史起源",
      minLength: 100
    },
    holistic_understanding: {
      type: "string",
      description: "整体理解",
      minLength: 100
    }
  }
};

// Entity Schema

const ENTITY_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "classification",
    "properties",
    "states",
    "constraints",
    "composition",
    "distinguishing_features",
    "examples",
    "counter_examples",
    "holistic_understanding"
  ],
  properties: {
    definition: {
      type: "string",
      description: "定义",
      minLength: 50
    },
    classification: {
      type: "object",
      required: ["genus", "differentia"],
      properties: {
        genus: { type: "string", description: "属" },
        differentia: { type: "string", description: "种差" }
      }
    },
    properties: {
      type: "array",
      description: "属性",
      items: {
        type: "object",
        required: ["name", "type", "description"],
        properties: {
          name: { type: "string", description: "名称" },
          type: { type: "string", enum: ["intrinsic", "extrinsic"], description: "类型" },
          description: { type: "string", description: "描述" }
        }
      }
    },
    states: {
      type: "array",
      description: "状态",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "名称" },
          description: { type: "string", description: "描述" }
        }
      }
    },
    constraints: {
      type: "array",
      description: "约束",
      items: { type: "string", description: "约束" }
    },
    composition: {
      type: "object",
      required: ["has_parts", "part_of"],
      properties: {
        has_parts: { 
          type: "array", 
          items: { type: "string" },
          description: "组成部分" 
        },
        part_of: { type: "string", description: "所属系统" }
      }
    },
    distinguishing_features: {
      type: "array",
      description: "区别特征",
      items: { type: "string", description: "特征" }
    },
    examples: {
      type: "array",
      description: "示例",
      items: { type: "string", description: "示例" }
    },
    counter_examples: {
      type: "array",
      description: "反例",
      items: { type: "string", description: "反例" }
    },
    holistic_understanding: {
      type: "string",
      description: "整体理解",
      minLength: 100
    }
  }
};

// Mechanism Schema

const MECHANISM_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "trigger_conditions",
    "operates_on",
    "causal_chain",
    "modulation",
    "inputs",
    "outputs",
    "side_effects",
    "termination_conditions",
    "holistic_understanding"
  ],
  properties: {
    definition: {
      type: "string",
      description: "定义",
      minLength: 50
    },
    trigger_conditions: {
      type: "array",
      description: "触发条件",
      items: { type: "string", description: "条件" }
    },
    operates_on: {
      type: "array",
      description: "作用对象",
      items: {
        type: "object",
        required: ["entity", "role"],
        properties: {
          entity: { type: "string", description: "实体" },
          role: { type: "string", description: "角色" }
        }
      }
    },
    causal_chain: {
      type: "array",
      description: "因果链",
      items: {
        type: "object",
        required: ["step", "description", "interaction"],
        properties: {
          step: { type: "number", description: "步骤" },
          description: { type: "string", description: "描述" },
          interaction: { type: "string", description: "交互" }
        }
      }
    },
    modulation: {
      type: "array",
      description: "调节",
      items: {
        type: "object",
        required: ["factor", "effect", "mechanism"],
        properties: {
          factor: { type: "string", description: "因素" },
          effect: { type: "string", enum: ["promotes", "inhibits", "regulates"], description: "效果" },
          mechanism: { type: "string", description: "机制" }
        }
      }
    },
    inputs: {
      type: "array",
      description: "输入",
      items: { type: "string", description: "输入" }
    },
    outputs: {
      type: "array",
      description: "输出",
      items: { type: "string", description: "输出" }
    },
    side_effects: {
      type: "array",
      description: "副作用",
      items: { type: "string", description: "副作用" }
    },
    termination_conditions: {
      type: "array",
      description: "终止条件",
      items: { type: "string", description: "条件" }
    },
    holistic_understanding: {
      type: "string",
      description: "整体理解",
      minLength: 100
    }
  }
};

// Define 任务 Schema（原 StandardizeClassify）

const DEFINE_TASK_SCHEMA: JSONSchema = {
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
            standard_name_cn: { type: "string" },
            standard_name_en: { type: "string" },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Issue: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string" },
            standard_name_en: { type: "string" },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Theory: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string" },
            standard_name_en: { type: "string" },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Entity: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string" },
            standard_name_en: { type: "string" },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        Mechanism: {
          type: "object",
          required: ["standard_name_cn", "standard_name_en", "confidence_score"],
          properties: {
            standard_name_cn: { type: "string" },
            standard_name_en: { type: "string" },
            confidence_score: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      }
    }
  }
};

// SchemaRegistry 实现

export class SchemaRegistry {
  private schemas: Map<CRType, JSONSchema>;
  
  constructor() {
    this.schemas = new Map([
      ["Domain", DOMAIN_SCHEMA],
      ["Issue", ISSUE_SCHEMA],
      ["Theory", THEORY_SCHEMA],
      ["Entity", ENTITY_SCHEMA],
      ["Mechanism", MECHANISM_SCHEMA]
    ]);
  }

  getSchema(type: CRType): JSONSchema {
    const schema = this.schemas.get(type);
    if (!schema) {
      throw new Error(`Unknown type: ${type}`);
    }
    return schema;
  }

  getDefineSchema(): JSONSchema {
    return DEFINE_TASK_SCHEMA;
  }

  getFieldDescriptions(type: CRType): FieldDescription[] {
    const schema = this.getSchema(type);
    const descriptions: FieldDescription[] = [];
    
    // 使用更详细的中文字段描述映射
    const fieldLabels = this.getFieldLabels(type);
    
    if (schema.properties) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        descriptions.push({
          name,
          type: prop.type,
          required: schema.required?.includes(name) ?? false,
          description: fieldLabels[name] || prop.description || name,
          example: this.getExampleForField(type, name)
        });
      }
    }
    
    return descriptions;
  }

  /** 获取字段的中文标签映射 */
  private getFieldLabels(type: CRType): Record<string, string> {
    const commonLabels: Record<string, string> = {
      definition: "定义",
      holistic_understanding: "整体理解",
      historical_genesis: "历史起源"
    };

    const typeSpecificLabels: Record<CRType, Record<string, string>> = {
      Domain: {
        ...commonLabels,
        teleology: "目的论",
        methodology: "方法论",
        boundaries: "边界",
        sub_domains: "子领域",
        issues: "核心议题"
      },
      Issue: {
        ...commonLabels,
        core_tension: "核心张力",
        significance: "重要性",
        epistemic_barrier: "认识论障碍",
        counter_intuition: "反直觉性",
        sub_issues: "子议题",
        stakeholder_perspectives: "利益相关者视角",
        boundary_conditions: "边界条件",
        theories: "相关理论"
      },
      Theory: {
        ...commonLabels,
        axioms: "公理",
        sub_theories: "子理论",
        logical_structure: "逻辑结构",
        entities: "核心实体",
        mechanisms: "核心机制",
        core_predictions: "核心预测",
        limitations: "局限性"
      },
      Entity: {
        ...commonLabels,
        classification: "分类",
        properties: "属性",
        states: "状态",
        constraints: "约束",
        composition: "组成结构",
        distinguishing_features: "区别特征",
        examples: "示例",
        counter_examples: "反例"
      },
      Mechanism: {
        ...commonLabels,
        trigger_conditions: "触发条件",
        operates_on: "作用对象",
        causal_chain: "因果链",
        modulation: "调节因素",
        inputs: "输入",
        outputs: "输出",
        side_effects: "副作用",
        termination_conditions: "终止条件"
      }
    };

    return typeSpecificLabels[type] || commonLabels;
  }

  getValidationRules(type: CRType): string[] {
    const schema = this.getSchema(type);
    const rules: string[] = [];
    
    if (schema.required) {
      rules.push(`必填字段: ${schema.required.join(", ")}`);
    }
    
    if (schema.properties) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (prop.minLength) {
          rules.push(`${name}: 最小长度 ${prop.minLength} 字符`);
        }
        if (prop.minItems) {
          rules.push(`${name}: 最少 ${prop.minItems} 项`);
        }
        if (prop.pattern) {
          rules.push(`${name}: 必须匹配格式 ${prop.pattern}`);
        }
      }
    }
    
    return rules;
  }

  getAllTypes(): CRType[] {
    return Array.from(this.schemas.keys());
  }

  isValidType(type: string): type is CRType {
    return this.schemas.has(type as CRType);
  }

  private getExampleForField(type: CRType, fieldName: string): string | undefined {
    // 提供一些示例
    const examples: Record<string, Record<string, string>> = {
      Domain: {
        definition: "量子力学是物理学的一个基础分支...",
        teleology: "揭示宇宙物质基底的'语法规则'...",
        methodology: "利用线性代数、复数域上的希尔伯特空间..."
      },
      Issue: {
        definition: "测量问题是量子力学中最核心的认识论危机...",
        core_tension: "确定性演化 vs 非确定性坍缩",
        significance: "理论本身无法解释这种从'可能性'到'确定性'的突变机制..."
      },
      Theory: {
        definition: "狭义相对论是描述时空结构的理论框架...",
        logical_structure: "从光速不变原理和相对性原理出发..."
      },
      Entity: {
        definition: "波函数是量子力学中描述粒子状态的数学对象...",
        genus: "数学函数",
        differentia: "定义在希尔伯特空间中，模方表示概率密度"
      },
      Mechanism: {
        definition: "自然选择是生物进化的核心机制...",
        trigger_conditions: "种群内存在遗传变异，环境资源有限"
      }
    };
    
    return examples[type]?.[fieldName];
  }
}

export const schemaRegistry = new SchemaRegistry();
