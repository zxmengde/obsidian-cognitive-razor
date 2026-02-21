/**
 * SchemaRegistry - 知识类型 Schema 注册表
 * 为五种知识类型提供 JSON Schema、字段描述和校验规则
 */

import type { CRType } from "../types";

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
      description: "形式定义：严格遵循'属+种差'逻辑，必须包含加粗的核心术语。结构：形式定义 → 智识危机（在此领域确立前，什么知识散落在哪些学科边缘？什么问题因缺乏统一框架而无法被系统性提出？）→ 核心特征"
    },
    teleology: {
      type: "string",
      description: "目的论：基于'智识危机驱动'原则，深刻剖析它诞生前试图填补什么悬而未决的认知缺口，或解决了什么不可调和的矛盾——不是泛泛的'需要研究'，而是具体的'什么问题无法被回答'"
    },
    methodology: {
      type: "string",
      description: "认识论基础：这个领域如何验证真理？必须锚定具体的理论、实验范式或逻辑推演方法，而非笼统的'科学方法'"
    },
    boundaries: {
      type: "array",
      description: "适用边界：每一条必须指向一个具体的'容易越界的方向'或'容易混淆的邻近概念'，并论证为什么那里是边界",
      items: { type: "string" }
    },
    historical_genesis: {
      type: "string",
      description: "按辩证法结构（正题→反题→合题）追溯其起源、危机、范式转换和关键人物，必须锚定具体的人名和年份"
    },
    holistic_understanding: {
      type: "string",
      description: "完整的认知地图，必须使用##二级标题严格划分为六个维度：本体论、认识论、目的论、实践论、价值论、额外补充。前五个维度各自聚焦一个哲学视角，额外补充由模型自由发挥，重点补充那些应该被说明但未被前五个维度覆盖的内容"
    },
    sub_domains: {
      type: "array",
      description: "子领域（严格遵循 MECE 原则——相互独立，完全穷尽），每一项都是重建领域认知版图的最小充分集的一个元素",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "子领域名称（严格遵循 naming_morphology）" },
          description: { type: "string", description: "严格遵循 core_principles，深刻剖析该子领域在整体认知版图中的功能角色——它填补了什么认知缺口？去掉它，领域的哪一块理解会坍塌？" }
        }
      }
    },
    issues: {
      type: "array",
      description: "核心议题（仅限涌现性议题——由子领域交互或整体结构产生的问题，不包括子领域自身内部的议题）",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "议题名称（严格遵循 naming_morphology）" },
          description: { type: "string", description: "严格遵循 core_principles，深刻剖析该涌现性议题的矛盾根源——它为什么不能被还原为某个子领域的内部问题？" }
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
      description: "形式定义：严格遵循'属+种差'逻辑，必须包含加粗的核心术语。结构：形式定义 → 智识危机（这个议题为什么必须被提出？忽视它会导致什么认知盲区？）→ 核心特征"
    },
    core_tension: {
      type: "string",
      description: "核心张力：必须表达为'二元对立'（A vs B）、'多极博弈'（分号分隔）或'悖论'，严禁写成简单的 How-to 问题"
    },
    significance: {
      type: "string",
      description: "不可回避性：如果不解决这个议题会怎样？它对整个领域的认知推进构成什么具体阻碍？"
    },
    epistemic_barrier: {
      type: "string",
      description: "认识论障碍：为什么至今未解决？必须剖析根本层面的障碍——是概念框架不足、测量手段缺失、还是价值立场不可调和？"
    },
    counter_intuition: {
      type: "string",
      description: "反直觉性：大众直觉与学术共识之间的裂缝在哪里？它如何挑战常识？"
    },
    historical_genesis: {
      type: "string",
      description: "按辩证法结构（正题→反题→合题）追溯矛盾何时变得明显，什么具体事件或发现触发了它，必须锚定具体的人名和年份"
    },
    sub_issues: {
      type: "array",
      description: "子议题（严格遵循 MECE 原则），每一项都是重建议题张力的最小充分集的一个元素",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "子议题名称（严格遵循 naming_morphology）" },
          description: { type: "string", description: "严格遵循 core_principles，深刻剖析该子议题在整体张力中的功能角色——它聚焦的是核心矛盾的哪个具体维度？去掉它，对整体张力的理解会丧失什么？" }
        }
      }
    },
    stakeholder_perspectives: {
      type: "array",
      description: "各利益相关方的立场，每个立场必须剖析其认识论基础和价值预设",
      items: {
        type: "object",
        required: ["stakeholder", "perspective"],
        properties: {
          stakeholder: { type: "string", description: "利益相关者（具体的学派、机构或立场群体，严格遵循 naming_morphology）" },
          perspective: { type: "string", description: "该立场的核心主张、认识论基础和价值预设——他们为什么这样看？推理链条建立在什么前提之上？" }
        }
      }
    },
    boundary_conditions: {
      type: "array",
      description: "适用边界：在什么条件下这个议题不相关或不适用？指出张力消失或变得无关紧要的具体语境",
      items: { type: "string" }
    },
    theories: {
      type: "array",
      description: "试图解决该议题的理论，每个理论必须标注学术地位并说明其解释力的边界",
      items: {
        type: "object",
        required: ["name", "status", "brief"],
        properties: {
          name: { type: "string", description: "理论名称（严格遵循 naming_morphology）" },
          status: {
            type: "string",
            enum: ["mainstream", "marginal", "falsified"],
            description: "学术地位：mainstream（主流）/ marginal（边缘）/ falsified（已证伪）"
          },
          brief: { type: "string", description: "该理论如何回应核心张力？它解决了什么，又留下了什么？解释力的边界在哪里？" }
        }
      }
    },
    holistic_understanding: {
      type: "string",
      description: "完整的认知地图，必须使用##二级标题严格划分为六个维度：本体论、认识论、目的论、实践论、价值论、额外补充。前五个维度各自聚焦一个哲学视角，额外补充由模型自由发挥，重点补充那些应该被说明但未被前五个维度覆盖的内容"
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
      description: "形式定义：严格遵循'属+种差'逻辑，必须包含加粗的核心术语。结构：形式定义 → 智识危机（旧范式在解释什么现象时遭遇了什么困境或失败？什么问题悬而未决？）→ 核心特征"
    },
    axioms: {
      type: "array",
      description: "基本公理及其理由：每条公理必须论证其不可或缺性——去掉它理论会如何崩塌？",
      items: {
        type: "object",
        required: ["statement", "justification"],
        properties: {
          statement: { type: "string", description: "公理陈述——必须是不可再分解的基本假设" },
          justification: { type: "string", description: "为什么这个公理是必要的？去掉它理论的哪一段推理链会断裂？" }
        }
      }
    },
    sub_theories: {
      type: "array",
      description: "子理论（严格遵循 MECE 原则），每一项都是重建理论逻辑的最小充分集的一个元素",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "子理论名称（严格遵循 naming_morphology）" },
          description: { type: "string", description: "严格遵循 core_principles，深刻剖析该子理论在整体逻辑中的功能角色——它负责解释什么？去掉它，母理论的哪一段推理链会断裂？" }
        }
      }
    },
    logical_structure: {
      type: "string",
      description: "从公理到结论的完整推理链：公理 A + 公理 B → 中间引理 → 机制激活 → 最终结论/预测。关键术语必须加粗，不得有逻辑跳跃"
    },
    entities: {
      type: "array",
      description: "构成性实体：理论成立所需的最小充分集，每个实体必须是理论成立的必要且充分的组成部分",
      items: {
        type: "object",
        required: ["name", "role", "attributes"],
        properties: {
          name: { type: "string", description: "实体名称（严格遵循 naming_morphology）" },
          role: { type: "string", description: "该实体在理论中扮演的不可替代的功能角色——去掉它，理论无法解释什么？" },
          attributes: { type: "string", description: "与理论直接相关的关键属性，而非该实体的百科全书式描述" }
        }
      }
    },
    mechanisms: {
      type: "array",
      description: "因果机制：每个机制必须作用于具体实体，解释实体间如何通过因果律产生联系",
      items: {
        type: "object",
        required: ["name", "process", "function"],
        properties: {
          name: { type: "string", description: "机制名称（严格遵循 naming_morphology）" },
          process: { type: "string", description: "机制的运作过程——什么作用于什么，产生什么变化？必须有明确的因果方向" },
          function: { type: "string", description: "该机制在理论中的功能——它解释了什么现象或连接了哪些实体？去掉它，理论的哪一段因果链会断裂？" }
        }
      }
    },
    core_predictions: {
      type: "array",
      description: "可检验的核心预测：每条预测必须是可证伪的——指出什么实验结果会推翻这个理论",
      items: { type: "string", description: "可证伪的预测——必须指出什么具体的实验结果或观测数据会推翻这个理论" }
    },
    limitations: {
      type: "array",
      description: "理论的局限性：具体指出在什么条件下理论失效、什么现象它无法解释——不是泛泛的'还需要更多研究'",
      items: { type: "string", description: "具体的局限——在什么条件下失效？什么现象无法解释？什么边界条件下理论的预测与观测不符？" }
    },
    historical_genesis: {
      type: "string",
      description: "按辩证法结构（正题/前范式→反题/反常→合题/火花与战斗）重建理论的诞生过程，必须锚定具体的人名、论文和年份"
    },
    holistic_understanding: {
      type: "string",
      description: "完整的认知地图，必须使用##二级标题严格划分为六个维度：本体论、认识论、目的论、实践论、价值论、额外补充。前五个维度各自聚焦一个哲学视角，额外补充由模型自由发挥，重点补充那些应该被说明但未被前五个维度覆盖的内容"
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
      description: "形式定义：严格遵循'属+种差'逻辑，必须包含加粗的核心术语。结构：形式定义 → 智识危机（如果没有对这个实体的认识，什么现象无法被解释？什么技术无法被实现？）→ 核心特征"
    },
    classification: {
      type: "object",
      required: ["genus", "differentia"],
      properties: {
        genus: { type: "string", description: "直接父类别——这个实体属于什么更大的范畴？必须是最近的上位概念" },
        differentia: { type: "string", description: "区分特征——是什么使它区别于同属的其他实体？必须指向本质差异而非表面特征" }
      }
    },
    properties: {
      type: "array",
      description: "属性：内在属性（intrinsic，不依赖外部关系的固有属性）和外在属性（extrinsic，依赖于与其他实体关系的属性），每个属性必须论证其在整体中的功能角色",
      items: {
        type: "object",
        required: ["name", "type", "description"],
        properties: {
          name: { type: "string", description: "属性名称" },
          type: { type: "string", enum: ["intrinsic", "extrinsic"], description: "intrinsic（固有）/ extrinsic（关系性）" },
          description: { type: "string", description: "严格遵循 core_principles，深刻剖析该属性在整体架构中的功能角色——论证其存在的必要性" }
        }
      }
    },
    states: {
      type: "array",
      description: "动态可变的模式或状态，每个状态必须说明触发条件和表现特征——properties 是'它是什么'，states 是'它可以变成什么'",
      items: {
        type: "object",
        required: ["name", "description"],
        properties: {
          name: { type: "string", description: "状态名称" },
          description: { type: "string", description: "触发条件（什么导致进入此状态）和表现特征（此状态下实体的行为有何不同）" }
        }
      }
    },
    constraints: {
      type: "array",
      description: "约束条件——这个实体的存在或运作受到什么限制？每条约束必须说明其来源（物理定律、逻辑必然、经验规律）",
      items: { type: "string", description: "具体的约束条件、其来源及违反时的后果" }
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
        part_of: { type: "string", description: "向上归属——它属于什么更大的系统？指出最直接的上位系统" }
      }
    },
    distinguishing_features: {
      type: "array",
      description: "与相似概念的严格对比——每条必须指向一个具体的'容易混淆的邻近概念'，并论证本质差异",
      items: { type: "string", description: "与具体邻近概念的区分：为什么 X 不是 Y？本质差异在哪里？" }
    },
    examples: {
      type: "array",
      description: "具体的正例，必须是可验证的实例（有名字、有出处），不是泛泛的类别",
      items: { type: "string", description: "可验证的具体实例——必须锚定到具体的名称、场景或数据" }
    },
    counter_examples: {
      type: "array",
      description: "具体的反例——看起来像但实际不是的东西，每条必须指向一个具体的'容易混淆的邻近概念'并解释区分理由",
      items: { type: "string", description: "容易混淆的邻近概念及区分理由——为什么它看起来像但实际不是？" }
    },
    holistic_understanding: {
      type: "string",
      description: "完整的认知地图，必须使用##二级标题严格划分为六个维度：本体论、认识论、目的论、实践论、价值论、额外补充。前五个维度各自聚焦一个哲学视角，额外补充由模型自由发挥，重点补充那些应该被说明但未被前五个维度覆盖的内容"
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
      description: "形式定义：必须包含加粗的核心术语。结构：形式定义 → 智识危机（在这个机制被揭示之前，什么因果关系无法被解释？什么过程被视为黑箱？）→ 核心特征"
    },
    trigger_conditions: {
      type: "array",
      description: "什么条件下这个机制被激活？必须区分必要条件（没有它机制不会启动）和充分条件（有了它机制必然启动）",
      items: { type: "string", description: "触发条件及其必要/充分性质——明确标注是必要条件还是充分条件" }
    },
    operates_on: {
      type: "array",
      description: "作用对象及其角色——每个对象必须说明它在机制中扮演的具体角色（主体/客体/介质/催化剂等）",
      items: {
        type: "object",
        required: ["entity", "role"],
        properties: {
          entity: { type: "string", description: "作用对象名称" },
          role: { type: "string", description: "在机制中扮演的具体角色（主体/客体/介质/催化剂等）——它为什么不可或缺？" }
        }
      }
    },
    causal_chain: {
      type: "array",
      description: "离散的原子步骤（触发→步骤1→...→结果），必须具备时间线上的连续性，不得有逻辑跳跃——每个步骤都是因果链的一个不可省略的环节",
      items: {
        type: "object",
        required: ["step", "description", "interaction"],
        properties: {
          step: { type: "number", description: "步骤序号" },
          description: { type: "string", description: "该步骤的具体操作和因果逻辑——不能只写一句话概括，必须说明输入什么、发生什么、输出什么" },
          interaction: { type: "string", description: "什么与什么发生了什么类型的相互作用？必须有明确的因果方向" }
        }
      }
    },
    modulation: {
      type: "array",
      description: "调节因素——什么加速/减速/调节这个机制？每个因素必须说明具体的调节途径",
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
      description: "机制运作所需的输入——原料、信号、能量或信息，每项必须说明其在机制中的具体用途",
      items: { type: "string", description: "输入项及其在机制中的具体用途——它被消耗还是被转化？" }
    },
    outputs: {
      type: "array",
      description: "机制产生的直接结果——必须与因果链的终点逻辑一致",
      items: { type: "string", description: "输出项及其性质——它是新生成的还是转化而来的？" }
    },
    side_effects: {
      type: "array",
      description: "非预期的附带效应——机制运作时不可避免但非目标的产物，必须说明产生原因",
      items: { type: "string", description: "副作用及其产生原因——它在因果链的哪个环节产生？为什么不可避免？" }
    },
    termination_conditions: {
      type: "array",
      description: "什么条件下机制停止运作？必须区分自限性（机制自身耗尽条件）和外部干预（需要外力终止）",
      items: { type: "string", description: "终止条件及其性质——是自限性的还是需要外部干预？终止后系统处于什么状态？" }
    },
    holistic_understanding: {
      type: "string",
      description: "完整的认知地图，必须使用##二级标题严格划分为六个维度：本体论、认识论、目的论、实践论、价值论、额外补充。前五个维度各自聚焦一个哲学视角，额外补充由模型自由发挥，重点补充那些应该被说明但未被前五个维度覆盖的内容"
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
        core_tension: "确定性演化 vs 非确定性坍缩；观察者角色；退相干解释",
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

// ============================================================================
// 分阶段写入配置（模块级导出）
// ============================================================================

/**
 * 分阶段写入配置
 *
 * 每种知识类型的字段被分为多个阶段（phase），每个阶段聚焦少量字段。
 * 后续阶段可以引用前面阶段已生成的内容作为上下文，避免注意力稀释。
 *
 * 设计原则：
 * - 叙事性字段（historical_genesis, holistic_understanding）单独一个阶段
 * - 结构化列表字段归为一组
 * - 框架性字段归为一组
 */
export interface WritePhase {
  /** 阶段 ID */
  id: string;
  /** 本阶段要生成的字段名列表 */
  fields: string[];
}

/** 各知识类型的分阶段配置（阶段和字段分组固定，prompt 内容从文件加载） */
export const WRITE_PHASES: Record<CRType, WritePhase[]> = {
  Domain: [
    { id: "core", fields: ["definition", "teleology", "methodology", "boundaries"] },
    { id: "narrative", fields: ["historical_genesis", "holistic_understanding"] },
    { id: "structure", fields: ["sub_domains", "issues"] },
  ],
  Issue: [
    { id: "core", fields: ["definition", "core_tension", "significance", "epistemic_barrier", "counter_intuition"] },
    { id: "narrative", fields: ["historical_genesis", "holistic_understanding", "boundary_conditions"] },
    { id: "structure", fields: ["sub_issues", "stakeholder_perspectives", "theories"] },
  ],
  Theory: [
    { id: "core", fields: ["definition", "axioms", "logical_structure", "core_predictions", "limitations"] },
    { id: "narrative", fields: ["historical_genesis", "holistic_understanding"] },
    { id: "structure", fields: ["sub_theories", "entities", "mechanisms"] },
  ],
  Entity: [
    { id: "core", fields: ["definition", "classification", "properties", "states", "constraints", "distinguishing_features"] },
    { id: "synthesis", fields: ["holistic_understanding", "composition", "examples", "counter_examples"] },
  ],
  Mechanism: [
    { id: "core", fields: ["definition", "trigger_conditions", "operates_on", "inputs", "outputs", "side_effects", "termination_conditions"] },
    { id: "process", fields: ["causal_chain", "modulation"] },
    { id: "synthesis", fields: ["holistic_understanding"] },
  ],
};
