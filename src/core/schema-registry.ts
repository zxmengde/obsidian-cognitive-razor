/**
 * SchemaRegistry - 知识类型 Schema 注册表
 * 为五种知识类型提供 JSON Schema、字段描述和校验规则
 */

import type { CRType } from "../types";
import { cloneJson } from "../utils/clone";

/** JSON Schema 类型定义 */
export type JSONSchema = {
  $schema?: string;
  type: string;
  required?: readonly string[];
  properties?: Record<string, JSONSchemaProperty>;
  additionalProperties?: boolean;
  items?: JSONSchemaProperty;
};

type JSONSchemaProperty = {
  type?: string;
  anyOf?: JSONSchemaProperty[];
  minLength?: number;
  description?: string;
  additionalProperties?: boolean;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: readonly string[];
  enum?: string[];
};

const cloneJsonSchema = cloneJson;

function applyStrictAdditionalProperties(schema: JSONSchemaProperty | JSONSchema): void {
  delete (schema as { $schema?: string }).$schema;

  if ("anyOf" in schema) {
    for (const branch of schema.anyOf ?? []) applyStrictAdditionalProperties(branch);
  }

  if ("description" in schema && typeof schema.description === "string") {
    schema.description = schema.description.replace(/\.\.\./g, "等");
  }

  if (schema.type === "object") {
    schema.additionalProperties = false;
    if (schema.properties) {
      for (const prop of Object.values(schema.properties)) {
        applyStrictAdditionalProperties(prop);
      }
    }
  }

  if (schema.type === "array" && schema.items) {
    applyStrictAdditionalProperties(schema.items);
  }
}

/** 构建只包含指定字段的严格 JSON Schema。 */
export function buildPhaseJsonSchema(fullSchema: object, fields: readonly string[]): JSONSchema {
  const full = fullSchema as JSONSchema;
  const sourceProperties = full.properties ?? {};
  const phaseProperties: Record<string, JSONSchemaProperty> = {};

  for (const field of fields) {
    const property = sourceProperties[field];
    if (property) {
      phaseProperties[field] = cloneJsonSchema(property);
    }
  }

  const schema: JSONSchema = {
    type: "object",
    required: fields,
    additionalProperties: false,
    properties: phaseProperties
  };

  applyStrictAdditionalProperties(schema);
  return schema;
}

/** 构建用于最终整体验证的严格 JSON Schema。 */
export function buildStrictJsonSchema(fullSchema: object): JSONSchema {
  const schema = cloneJsonSchema(fullSchema as JSONSchema);
  applyStrictAdditionalProperties(schema);
  return schema;
}

/** 字段描述接口 */
export interface FieldDescription {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

// domain Schema

/** 单一列表与具名分类列表分别定义，使每个分支的已声明属性均为必填。 */
function classifiedNamedItem(description: string): JSONSchemaProperty {
  const properties = { name: { type: "string" }, description: { type: "string", description } };
  return { anyOf: [
    { type: "object", required: ["name", "description"], properties },
    { type: "object", required: ["classification_basis", "name", "description"], properties: {
      classification_basis: { type: "string", description: "简短分类维度名或正式分类体系名。" }, ...properties,
    } },
  ] };
}

const DOMAIN_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "definition",
    "core_questions",
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
      description: "研究对象与领域范围。"
    },
    core_questions: {
      type: "string",
      description: "核心研究问题与认知目标。"
    },
    methodology: {
      type: "string",
      description: "研究方法及其适用条件。"
    },
    boundaries: {
      type: "array",
      description: "领域适用边界。",
      items: { type: "string" }
    },
    historical_genesis: {
      type: "string",
      description: "历史形成与关键转折。自拟三级标题遵循公共标题规则，有依据的时期写在括号里。"
    },
    holistic_understanding: {
      type: "string",
      description: "对当前对象的综合理解，补足前文字段尚未解释的关系。规定维度的标题以本阶段任务为准，其后按专业主题补充。"
    },
    sub_domains: {
      type: "array",
      description: "直属研究分支。",
      items: classifiedNamedItem("研究内容与范围。")
    },
    issues: {
      type: "array",
      description: "直接相关的独立议题。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "核心问题与研究联系。" }
        }
      }
    }
  }
};

// issue Schema

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
      description: "议题的对象与范围。"
    },
    core_tension: {
      type: "string",
      description: "问题中的冲突或未决关系。"
    },
    significance: {
      type: "string",
      description: "对认识与实践的影响。"
    },
    epistemic_barrier: {
      type: "string",
      description: "限制解答的知识或方法障碍。"
    },
    counter_intuition: {
      type: "string",
      description: "与通常直觉的差异。"
    },
    historical_genesis: {
      type: "string",
      description: "历史形成与关键转折。自拟三级标题遵循公共标题规则，有依据的时期写在括号里。"
    },
    sub_issues: {
      type: "array",
      description: "直属子问题。",
      items: classifiedNamedItem("子问题的内容与范围。")
    },
    stakeholder_perspectives: {
      type: "array",
      description: "相关群体及其立场。",
      items: {
        type: "object",
        required: ["stakeholder", "perspective"],
        properties: {
          stakeholder: { type: "string" },
          perspective: { type: "string", description: "立场的主张与依据。" }
        }
      }
    },
    boundary_conditions: {
      type: "array",
      description: "议题适用的条件。",
      items: { type: "string" }
    },
    theories: {
      type: "array",
      description: "回应当前议题的理论。",
      items: {
        type: "object",
        required: ["name", "status", "brief"],
        properties: {
          name: { type: "string" },
          status: {
            type: "string",
            enum: ["mainstream", "marginal", "unclear", "contested", "falsified"],
            description: "按当前议题判定：核心主张已被证伪用 falsified；其成立与否仍有未决学术争论用 contested；其余按接受度用 mainstream 或 marginal；无法判定用 unclear。"
          },
          brief: { type: "string", description: "理论如何回应议题。" }
        }
      }
    },
    holistic_understanding: {
      type: "string",
      description: "对当前对象的综合理解，补足前文字段尚未解释的关系。规定维度的标题以本阶段任务为准，其后按专业主题补充。"
    }
  }
};

// theory Schema

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
      description: "理论的主张与解释范围。"
    },
    axioms: {
      type: "array",
      description: "公理、假设、理想化或模型前提，逐项标明性质。",
      items: {
        type: "object",
        required: ["statement", "justification"],
        properties: {
          statement: { type: "string" },
          justification: { type: "string", description: "采用此前提的理由。" }
        }
      }
    },
    sub_theories: {
      type: "array",
      description: "直属理论子项。",
      items: classifiedNamedItem("主张与范围。")
    },
    logical_structure: {
      type: "string",
      description: "从前提到结论的论证结构。"
    },
    entities: {
      type: "array",
      description: "理论使用的实体、变量或构件。",
      items: {
        type: "object",
        required: ["name", "role", "attributes"],
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "在理论中的作用。" },
          attributes: { type: "string", description: "与理论相关的属性。" }
        }
      }
    },
    mechanisms: {
      type: "array",
      description: "理论中的机制或形式关系。",
      items: {
        type: "object",
        required: ["name", "process", "function"],
        properties: {
          name: { type: "string" },
          process: { type: "string", description: "运作过程或关系结构。" },
          function: { type: "string", description: "对理论解释或推导的作用。" }
        }
      }
    },
    core_predictions: {
      type: "array",
      description: "预测或形式推论。",
      items: { type: "string" }
    },
    limitations: {
      type: "array",
      description: "适用限制与未解释的问题。",
      items: { type: "string" }
    },
    historical_genesis: {
      type: "string",
      description: "历史形成与关键转折。自拟三级标题遵循公共标题规则，有依据的时期写在括号里。"
    },
    holistic_understanding: {
      type: "string",
      description: "对当前对象的综合理解，补足前文字段尚未解释的关系。规定维度的标题以本阶段任务为准，其后按专业主题补充。"
    }
  }
};

// entity Schema

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
      description: "实体的含义与适用范围。"
    },
    classification: {
      anyOf: [
        { type: "object", required: ["genus", "differentia"], properties: {
          genus: { type: "string", description: "最近上位类。" },
          differentia: { type: "string", description: "同属实体间的区分特征。" }
        } },
        { type: "array", items: { type: "object", required: ["classification_basis", "genus", "differentia"], properties: {
          classification_basis: { type: "string", description: "简短分类维度名或正式分类体系名。" },
          genus: { type: "string", description: "最近上位类。" },
          differentia: { type: "string", description: "同属实体间的区分特征。" }
        } } }
      ]
    },
    properties: {
      type: "array",
      description: "实体的属性。",
      items: {
        type: "object",
        required: ["name", "type", "description"],
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["intrinsic", "extrinsic"], description: "intrinsic 固有属性；extrinsic 关系属性。" },
          description: { type: "string", description: "属性的含义与条件。" }
        }
      }
    },
    states: {
      type: "array",
      description: "同一实体的状态或模式。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string", description: "状态的表现与条件。" }
        }
      }
    },
    constraints: {
      type: "array",
      description: "存在或运作的限制。",
      items: { type: "string" }
    },
    composition: {
      type: "object",
      required: ["has_parts", "part_of"],
      properties: {
        has_parts: {
          type: "array",
          items: { type: "string" },
          description: "直接构成性部分。"
        },
        part_of: { type: "string", description: "直接所属的系统。" }
      }
    },
    distinguishing_features: {
      type: "array",
      description: "与邻近概念的区分依据。",
      items: { type: "string" }
    },
    examples: {
      type: "array",
      description: "属于该实体类别的具体实例。",
      items: { type: "string" }
    },
    counter_examples: {
      type: "array",
      description: "易混淆且不满足定义的对象及区分依据。",
      items: { type: "string" }
    },
    holistic_understanding: {
      type: "string",
      description: "对当前对象的综合理解，补足前文字段尚未解释的关系。规定维度的标题以本阶段任务为准，其后按专业主题补充。"
    }
  }
};

// mechanism Schema

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
      description: "机制连接的条件、过程与结果。"
    },
    trigger_conditions: {
      type: "array",
      description: "启动条件或前置状态。",
      items: { type: "string" }
    },
    operates_on: {
      type: "array",
      description: "直接作用的对象。",
      items: {
        type: "object",
        required: ["entity", "role"],
        properties: {
          entity: { type: "string" },
          role: { type: "string", description: "对象在机制中的作用。" }
        }
      }
    },
    causal_chain: {
      type: "array",
      description: "有序的因果步骤。",
      items: {
        type: "object",
        required: ["step", "description", "interaction"],
        properties: {
          step: { type: "number", description: "从 1 开始的步骤序号。" },
          description: { type: "string", description: "该步发生的变化。" },
          interaction: { type: "string", description: "参与对象的相互作用。" }
        }
      }
    },
    modulation: {
      type: "array",
      description: "促进、抑制或调节因素。",
      items: {
        type: "object",
        required: ["factor", "effect", "mechanism"],
        properties: {
          factor: { type: "string" },
          effect: { type: "string", enum: ["promotes", "inhibits", "regulates"], description: "promotes 促进；inhibits 抑制；regulates 调节。" },
          mechanism: { type: "string", description: "调节的作用途径。" }
        }
      }
    },
    inputs: {
      type: "array",
      description: "所需资源或信号。",
      items: { type: "string" }
    },
    outputs: {
      type: "array",
      description: "直接产生的结果。",
      items: { type: "string" }
    },
    side_effects: {
      type: "array",
      description: "伴随产生的非目标结果。",
      items: { type: "string" }
    },
    termination_conditions: {
      type: "array",
      description: "机制停止的条件。",
      items: { type: "string" }
    },
    holistic_understanding: {
      type: "string",
      description: "对当前对象的综合理解，补足前文字段尚未解释的关系。规定维度的标题以本阶段任务为准，其后按专业主题补充。"
    }
  }
};

// Define 任务 Schema（原 StandardizeClassify）

const DEFINE_CLASSIFICATION_TYPES: CRType[] = ["domain", "issue", "theory", "entity", "mechanism"];

function createDefineCandidateSchema(): JSONSchemaProperty {
  return {
    type: "object",
    required: ["standard_name_cn", "standard_name_en", "confidence_score"],
    properties: {
      standard_name_cn: { type: "string", minLength: 0 },
      standard_name_en: { type: "string", minLength: 0 },
      confidence_score: {
        type: "number",
        minimum: 0,
        maximum: 1,

      },
    },
  };
}

const DEFINE_TASK_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["classification_result"],
  properties: {
    classification_result: {
      type: "object",
      description: "各类型的规范中英文名称与匹配度；无可靠名称用空字符串，匹配度表示输入直接属于该类型的程度。",
      required: [...DEFINE_CLASSIFICATION_TYPES],
      properties: Object.fromEntries(
        DEFINE_CLASSIFICATION_TYPES.map((type) => [type, createDefineCandidateSchema()]),
      ),
    },
  },
};

const TAG_TASK_SCHEMA: JSONSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["aliases", "tags"],
  additionalProperties: false,
  properties: {
    aliases: {
      type: "array",

      items: { type: "string" }
    },
    tags: {
      type: "array",

      items: { type: "string" }
    }
  }
};

// SchemaRegistry 实现

export class SchemaRegistry {
  private schemas: Map<CRType, JSONSchema>;

  constructor() {
    this.schemas = new Map([
      ["domain", DOMAIN_SCHEMA],
      ["issue", ISSUE_SCHEMA],
      ["theory", THEORY_SCHEMA],
      ["entity", ENTITY_SCHEMA],
      ["mechanism", MECHANISM_SCHEMA]
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

  getTagSchema(): JSONSchema {
    return TAG_TASK_SCHEMA;
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
          type: prop.type ?? "object",
          required: schema.required?.includes(name) ?? false,
          description: fieldLabels[name] || prop.description || name,
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
      historical_genesis: "历史发展"
    };

    const typeSpecificLabels: Record<CRType, Record<string, string>> = {
      domain: {
        ...commonLabels,
        core_questions: "核心问题",
        methodology: "方法论",
        boundaries: "边界",
        sub_domains: "子领域",
        issues: "核心议题"
      },
      issue: {
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
      theory: {
        ...commonLabels,
        axioms: "公理",
        sub_theories: "子理论",
        logical_structure: "逻辑结构",
        entities: "核心实体",
        mechanisms: "核心机制",
        core_predictions: "核心预测",
        limitations: "局限性"
      },
      entity: {
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
      mechanism: {
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

}

export const schemaRegistry = new SchemaRegistry();
