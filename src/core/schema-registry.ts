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
  type: string;
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
  example?: string;
}

// domain Schema

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
      description: "形式定义：说明该领域的最近上位范围、区别于邻近领域的特征和核心研究对象。只有资料充分时才补充其形成背景。"
    },
    core_questions: {
      type: "string",
      description: "研究目标与问题：说明该领域主要试图理解、解释或解决什么。若不存在统一目标，区分主要传统及其适用范围。"
    },
    methodology: {
      type: "string",
      description: "认识论与方法：说明该领域形成、检验或论证知识的主要方法；区分经验、形式、解释性等方法，不虚构具体范式。"
    },
    boundaries: {
      type: "array",
      description: "适用边界：列出有依据的范围限制或容易混淆的邻近概念，并说明区分依据；没有可靠条目时使用空数组。",
      items: { type: "string" }
    },
    historical_genesis: {
      type: "string",
      description: "历史形成：按实际时间与因果关系概述有可靠依据的关键阶段、争论或转折，不预设固定叙事结构。人名、年份和文献无法高置信确认时省略或标为待核实。"
    },
    holistic_understanding: {
      type: "string",
      description: "综合理解：整合该领域的对象、方法、目标、实践影响、争议与边界。"
    },
    sub_domains: {
      type: "array",
      description: "当前领域直接下一层、已确立的研究分支。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "已确立的子领域名称。" },
          description: { type: "string", description: "该分支的研究范围、划分依据及其与当前领域的从属关系。" }
        }
      }
    },
    issues: {
      type: "array",
      description: "本领域具有独立问题内核的重要议题，区别于研究分支。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "通行议题名称或准确的问题标题。" },
          description: { type: "string", description: "该议题的核心问题、边界及其与当前领域的研究联系。" }
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
      description: "形式定义：说明该议题属于哪类问题、争议对象、关键限定和区别于邻近议题的特征。"
    },
    core_tension: {
      type: "string",
      description: "核心张力：准确说明冲突的主张、目标、约束或未决关系；可为二元、多方、条件性张力或悖论，不强行二分。"
    },
    significance: {
      type: "string",
      description: "重要性：说明该议题对理解、研究或实践的已知影响，并限定影响范围；没有依据时不夸大后果。"
    },
    epistemic_barrier: {
      type: "string",
      description: "认识论障碍：说明造成争议或限制解答的证据、测量、概念、计算或方法障碍；区分已知障碍与推断。"
    },
    counter_intuition: {
      type: "string",
      description: "反直觉性：说明该议题与常见直觉之间有依据的差异。"
    },
    historical_genesis: {
      type: "string",
      description: "历史形成：按实际时间与因果关系概述议题何时出现、如何演变及关键转折，不预设固定阶段。具体人名、年份和事件不确定时省略或标为待核实。"
    },
    sub_issues: {
      type: "array",
      description: "当前议题直接下一层、具有独立问题内核的子问题。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "通行子议题名称或准确的问题标题。" },
          description: { type: "string", description: "说明该子议题处理的具体问题及其与总体议题的关系。" }
        }
      }
    },
    stakeholder_perspectives: {
      type: "array",
      description: "可公开确认存在的利益相关方、学派或立场群体及其有据的公开主张。",
      items: {
        type: "object",
        required: ["stakeholder", "perspective"],
        properties: {
          stakeholder: { type: "string", description: "有明确依据的具体学派、机构或立场群体。" },
          perspective: { type: "string", description: "该立场的公开主张、依据、前提和适用语境，不推测动机。" }
        }
      }
    },
    boundary_conditions: {
      type: "array",
      description: "适用边界：议题不相关或不适用的具体条件，张力消失或变得无关紧要的具体语境等",
      items: { type: "string" }
    },
    theories: {
      type: "array",
      description: "真实存在并直接回应当前议题的理论。",
      items: {
        type: "object",
        required: ["name", "status", "brief"],
        properties: {
          name: { type: "string", description: "已确立的理论名称。" },
          status: {
            type: "string",
            enum: ["mainstream", "marginal", "unclear", "contested", "falsified"],
            description: "有依据的学术地位：mainstream 主流、marginal 边缘、contested 有争议、falsified 已证伪；无法确认用 unclear，并在 brief 说明依据不足。"
          },
          brief: { type: "string", description: "该理论如何回应议题、解释范围和边界；地位有争议时说明依据。" }
        }
      }
    },
    holistic_understanding: {
      type: "string",
      description: "综合理解：整合议题的对象、证据结构、主要立场、实践影响和适用边界。只写相关且有依据的维度。"
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
      description: "形式定义：说明该理论属于哪类解释框架、核心主张、适用对象及区别于邻近理论的特征。"
    },
    axioms: {
      type: "array",
      description: "理论明确采用的公理、经验假设或模型前提及其理由；准确标明性质，不把假设写成已证明事实。",
      items: {
        type: "object",
        required: ["statement", "justification"],
        properties: {
          statement: { type: "string", description: "前提陈述及其性质，例如公理、经验假设或模型前提。" },
          justification: { type: "string", description: "说明采用该前提的依据、用途或限制；不要声称其必然或不可替代。" }
        }
      }
    },
    sub_theories: {
      type: "array",
      description: "当前理论框架内直接下一层的子理论、特例或变体。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "已确立的子理论或变体名称。" },
          description: { type: "string", description: "该子理论或变体的主张、范围及其与当前理论的特化或变体关系。" }
        }
      }
    },
    logical_structure: {
      type: "string",
      description: "从已列前提到主要结论的推导结构。显式标出缺失前提、经验跳步和条件性关系，不把相关性改写为因果性。"
    },
    entities: {
      type: "array",
      description: "当前理论明确引入或使用的实体、变量及构件。",
      items: {
        type: "object",
        required: ["name", "role", "attributes"],
        properties: {
          name: { type: "string", description: "理论明确引用的实体、变量或构件名称。" },
          role: { type: "string", description: "该实体、变量或构件在理论中的具体作用。" },
          attributes: { type: "string", description: "与理论直接相关的关键属性，而非该实体的百科全书式描述" }
        }
      }
    },
    mechanisms: {
      type: "array",
      description: "当前理论明确提出或使用的因果机制、转换规则或形式推理；区分因果关系与形式关系。",
      items: {
        type: "object",
        required: ["name", "process", "function"],
        properties: {
          name: { type: "string", description: "理论明确提出或引用的机制或关系名称。" },
          process: { type: "string", description: "按理论说明运作过程或关系方向；若并非因果关系应明确标注。" },
          function: { type: "string", description: "该机制或关系在理论解释、推导或预测中的作用。" }
        }
      }
    },
    core_predictions: {
      type: "array",
      description: "该理论实际提出的预测、可检验推论或判别性结论。非经验理论可写形式推论或适用判据；没有可靠条目时使用空数组。",
      items: { type: "string", description: "预测或推论及其成立条件、检验方式或判别标准。" }
    },
    limitations: {
      type: "array",
      description: "理论的局限性：指出理论失效的具体条件、无法解释的现象，不能是泛泛的还需要更多研究",
      items: { type: "string", description: "具体的局限——失效的条件，无法解释的现象，理论的预测与观测不符的边界条件等" }
    },
    historical_genesis: {
      type: "string",
      description: "历史形成：按实际时间与证据概述理论提出、修订和争论的关键阶段，不预设固定叙事。人名、论文和年份不确定时省略或标为待核实。"
    },
    holistic_understanding: {
      type: "string",
      description: "综合理解：整合理论的前提、推导、解释对象、预测、证据状态、争议和适用边界。只写相关且有依据的维度。"
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
      description: "形式定义：说明该实体的最近上位类、区分特征和适用语境。只有资料充分时才补充认识或应用背景。"
    },
    classification: {
      type: "object",
      required: ["genus", "differentia"],
      properties: {
        genus: { type: "string", description: "有依据的最近上位类；无法确定时标为待核实。" },
        differentia: { type: "string", description: "将该实体与同属邻近实体区分开的关键特征，并限定适用语境。" }
      }
    },
    properties: {
      type: "array",
      description: "有依据的内在属性（intrinsic）或关系性属性（extrinsic）；说明属性内容和成立条件，不为数量补写。",
      items: {
        type: "object",
        required: ["name", "type", "description"],
        properties: {
          name: { type: "string", description: "属性名称" },
          type: { type: "string", enum: ["intrinsic", "extrinsic"], description: "intrinsic（固有）/ extrinsic（关系性）" },
          description: { type: "string", description: "说明属性的含义、条件及与实体的关系，不虚构必要性或目的。" }
        }
      }
    },
    states: {
      type: "array",
      description: "实体有依据的动态状态或模式；有已知触发条件时说明，没有时不要推测因果。",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "状态名称" },
          description: { type: "string", description: "说明状态的表现、进入或退出条件；未知的因果条件标为待核实。" }
        }
      }
    },
    constraints: {
      type: "array",
      description: "实体存在、适用或运作的已知限制；能够确认时说明来源和违反后的结果。",
      items: { type: "string", description: "具体约束、适用条件及有依据的来源或后果。" }
    },
    composition: {
      type: "object",
      required: ["has_parts", "part_of"],
      properties: {
        has_parts: {
          type: "array",
          items: { type: "string" },
          description: "向下分解——它由什么组成？列出构成性部分，而非任意关联物"
        },
        part_of: { type: "string", description: "有明确组成关系时指出最直接的上位系统；按知识类型确实不适用时写“不适用”，材料不足时写“目前依据不足”或“待核实”。" }
      }
    },
    distinguishing_features: {
      type: "array",
      description: "与确实容易混淆的邻近概念进行有依据的对比；没有可靠对象时使用空数组。",
      items: { type: "string", description: "与具体邻近概念的区分：为什么 X 不是 Y？本质差异在哪里？" }
    },
    examples: {
      type: "array",
      description: "能够高置信确认属于该实体类别或体现该概念的具体正例；不确定时不收录。",
      items: { type: "string", description: "具体正例及必要的判定依据或场景。" }
    },
    counter_examples: {
      type: "array",
      description: "具体的反例——看起来像但实际不是的东西，每条必须指向一个具体的容易混淆的邻近概念并解释区分理由",
      items: { type: "string", description: "容易混淆的邻近概念及区分理由——为什么它看起来像但实际不是？" }
    },
    holistic_understanding: {
      type: "string",
      description: "综合理解：整合实体的分类、属性、状态、组成、约束、实例和认知边界。只写相关且有依据的维度，不赋予无依据的目的或价值。"
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
      description: "形式定义：说明该机制是什么类型的过程、作用对象、输入输出及区别于邻近过程的特征。"
    },
    trigger_conditions: {
      type: "array",
      description: "有依据的启动条件或前置状态。只有证据支持时才标为必要条件或充分条件；否则说明关联或条件性。",
      items: { type: "string", description: "触发条件、适用范围及能够确认的条件性质。" }
    },
    operates_on: {
      type: "array",
      description: "机制直接作用的对象及其有依据的角色；不把仅相关的对象列为作用对象。",
      items: {
        type: "object",
        required: ["entity", "role"],
        properties: {
          entity: { type: "string", description: "作用对象名称" },
          role: { type: "string", description: "该对象在机制中的具体角色，例如主体、客体、介质或催化因素；不要虚构不可替代性。" }
        }
      }
    },
    causal_chain: {
      type: "array",
      description: "按已知顺序描述机制的关键步骤、交互和结果，缺口应明确标为待核实。",
      items: {
        type: "object",
        required: ["step", "description", "interaction"],
        properties: {
          step: { type: "number", description: "步骤序号" },
          description: { type: "string", description: "该步骤发生的变化、输入和输出；无法确认的细节标为待核实。" },
          interaction: { type: "string", description: "参与对象之间有依据的交互或关系方向；非因果关系应明确标注。" }
        }
      }
    },
    modulation: {
      type: "array",
      description: "有依据的促进、抑制或调节因素；只有能够确认时才说明具体作用途径。",
      items: {
        type: "object",
        required: ["factor", "effect", "mechanism"],
        properties: {
          factor: { type: "string", description: "调节因素名称" },
          effect: { type: "string", enum: ["promotes", "inhibits", "regulates"], description: "promotes（促进）/ inhibits（抑制）/ regulates（调节）" },
          mechanism: { type: "string", description: "具体通过什么途径产生调节效果？作用于因果链的哪个环节？" }
        }
      }
    },
    inputs: {
      type: "array",
      description: "机制已知需要的原料、信号、能量或信息，以及能够确认的用途。",
      items: { type: "string", description: "输入项、用途及能够确认的消耗或转化方式。" }
    },
    outputs: {
      type: "array",
      description: "机制直接产生的已知结果，并与因果链终点保持一致。",
      items: { type: "string", description: "输出项及能够确认的生成、转化或状态变化性质。" }
    },
    side_effects: {
      type: "array",
      description: "有证据支持的附带效应或非主要结果；不预设其不可避免，没有可靠条目时使用空数组。",
      items: { type: "string", description: "附带效应、发生条件及能够确认的产生环节或原因。" }
    },
    termination_conditions: {
      type: "array",
      description: "机制停止、失活或退出的已知条件；能够确认时区分自限、环境变化和外部干预。",
      items: { type: "string", description: "终止条件、性质及能够确认的终止后状态。" }
    },
    holistic_understanding: {
      type: "string",
      description: "综合理解：整合机制的条件、对象、过程、调节、输入输出、附带效应、终止与证据边界。只写相关且有依据的维度。"
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
      standard_name_cn: { type: "string", minLength: 0, description: "此类型的公认中文名；没有独立且可靠的术语时使用空字符串。" },
      standard_name_en: { type: "string", minLength: 0, description: "此类型能够高置信确认的公认英文名；无法确认时使用空字符串。" },
      confidence_score: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "输入直接属于该类型的置信度。",
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
      description: "五种互斥的候选分类。",
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
      description: "同一概念的已确立替代名称；没有可靠候选时使用空数组。",
      items: { type: "string" }
    },
    tags: {
      type: "array",
      description: "用于检索和筛选的少量稳定关键词；没有可靠候选时使用空数组。",
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
      domain: {
        ...commonLabels,
        core_questions: "目的论",
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

  private getExampleForField(type: CRType, fieldName: string): string | undefined {
    // 提供一些示例
    const examples: Record<string, Record<string, string>> = {
      domain: {
        definition: "量子力学是物理学的一个基础分支...",
        core_questions: "揭示宇宙物质基底的'语法规则'...",
        methodology: "利用线性代数、复数域上的希尔伯特空间..."
      },
      issue: {
        definition: "测量问题是量子力学中最核心的认识论危机...",
        core_tension: "确定性演化 vs 非确定性坍缩；观察者角色；退相干解释",
        significance: "理论本身无法解释这种从'可能性'到'确定性'的突变机制..."
      },
      theory: {
        definition: "狭义相对论是描述时空结构的理论框架...",
        logical_structure: "从光速不变原理和相对性原理出发..."
      },
      entity: {
        definition: "波函数是量子力学中描述粒子状态的数学对象...",
        genus: "数学函数",
        differentia: "定义在希尔伯特空间中，模方表示概率密度"
      },
      mechanism: {
        definition: "自然选择是生物进化的核心机制...",
        trigger_conditions: "种群内存在遗传变异，环境资源有限"
      }
    };

    return examples[type]?.[fieldName];
  }
}

export const schemaRegistry = new SchemaRegistry();
