# Cognitive Razor - 提示词工程规范

> **文档目标读者**: AI 驱动的开发者（Claude/Cursor 等）
> **文档版本**: 1.0.0
> **最后更新**: 2025-12-01

---

## 1. 设计公理

> 本规范基于三组不证自明的公理构建。所有 Prompt 设计必须满足这些约束，任何违反将导致系统行为不可预测。

### 1.1 技术公理（源自 LLM 最佳实践）

| 公理 ID | 公理陈述 | 设计推论 | 验证方式 |
|:--|:--|:--|:--|
| **T1** | 精确、直接的指令优于模糊、说服性的语言 | Prompt 使用祈使句，禁用"请"、"希望"、"尝试" | 正则检测禁用词 |
| **T2** | 结构化标记（XML）提升解析可靠性 | 使用 `<tag>` 划分 Prompt 区块，禁用 Markdown 标题 | 模板校验 |
| **T3** | 长上下文中，关键指令置于末尾 | 遵循「Context → Task → Output → Reminder」顺序 | 区块顺序检查 |
| **T4** | 复杂推理任务需更高随机性 | `reason` 任务 Temperature ≥ 0.8 | 配置校验 |
| **T5** | 结构化输出需显式声明完整 Schema | 每个 Prompt 必须包含 JSON Schema 定义 | Schema 存在性检查 |
| **T6** | 输出格式约束应紧邻输出指令 | `<output_schema>` 紧跟 `<task>` 之后 | 区块邻接检查 |

### 1.2 工程公理（源自上下文工程）

| 公理 ID | 公理陈述 | 设计推论 | 验证方式 |
|:--|:--|:--|:--|
| **E1** | 上下文只追加不修改 | 变量注入位置固定，错误历史追加到专用区块 | 模板不可变性 |
| **E2** | 失败尝试必须保留用于结构化重试 | 重试时 `<error_history>` 区块包含前次错误 | 重试请求检查 |
| **E3** | 关键目标在末尾复述以操控注意力 | `<reminder>` 区块位于 Prompt 最末 | 区块位置检查 |
| **E4** | 示例应有结构化变化避免模式固化 | 同一 Prompt 的示例覆盖 ≥2 种不同类型/领域 | 示例多样性检查 |
| **E5** | 上下文按任务需求动态组装 | 不同任务包含不同的上下文槽位组合 | 槽位配置表 |

### 1.3 业务公理（源自 PRD 系统公理）

| 公理 ID | 公理陈述 | 设计推论 | 对应 PRD 公理 |
|:--|:--|:--|:--|
| **B1** | 知识节点有且仅有 6 种类型 | 类型推断范围为 5 种（Principle 仅合成产生）| A2 因果层级性 |
| **B2** | 同类型节点语义唯一 | 生成任务必须接收 `{{vault_index}}` 用于去重参考 | A1 语义唯一性 |
| **B3** | 每个笔记必须自足完备 | Agent 输出必须覆盖类型定义的所有必填字段 | G2 最大化信息密度 |
| **B4** | Prompt 仅生成内容不涉及写入 | 输出为纯 JSON，不包含文件操作指令 | A3 人机共生性 |
| **B5** | 支持中英双语命名 | 所有 Prompt 接收 `{{naming_template}}` 变量 | A4 命名规范性 |
| **B6** | wikilink 在生成时创建 | Agent 输出中的引用使用 `[[标准名称]]` 格式 | PRD 4.5 数据流 |

---

## 2. Prompt 统一模板架构

> **架构决策**: 采用「统一模板 + 变量注入」模式。所有 Prompt 共享同一骨架结构，通过变量动态填充实现差异化。

### 2.1 模板骨架结构

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{DYNAMIC_CONTEXT_BLOCKS}}
</context>

<task>
{{TASK_INSTRUCTION}}
</task>

<output_schema>
{{JSON_SCHEMA}}
</output_schema>

<error_history>
{{PREVIOUS_ERRORS}}
</error_history>

<reminder>
{{GOAL_RESTATEMENT}}
</reminder>
```

### 2.2 区块定义

| 区块名 | 必需性 | 内容说明 | 注入时机 |
|:--|:--|:--|:--|
| `<system>` | 必需 | 共享硬约束，所有任务相同 | 编译时固定 |
| `<context>` | 条件必需 | 动态上下文，按任务类型组装 | 运行时注入 |
| `<task>` | 必需 | 任务特定指令 | 编译时固定 |
| `<output_schema>` | 必需 | JSON Schema 定义 | 编译时固定 |
| `<error_history>` | 条件必需 | 仅在重试时注入 | 运行时注入 |
| `<reminder>` | 必需 | 目标复述锚点 | 编译时固定 |

### 2.3 共享硬约束 (SHARED_CONSTRAINTS)

以下约束注入所有 Prompt 的 `<system>` 区块：

```xml
<system>
<role>
You are a knowledge compiler for the Cognitive Razor system. Your task is to transform natural language concepts into structured, academically rigorous knowledge nodes.
</role>

<writing_style>
- Use precise, objective, impersonal third-person narrative
- Organize information using definitions, classifications, causal relationships, and logical structures
- Prohibit literary rhetoric not aimed at revealing structure and logic (e.g., personification, parallelism, emotional metaphors)
</writing_style>

<output_rules>
1. Follow the provided JSON schema exactly
2. Use hierarchical bullet lists for complex information
3. NEVER use markdown headers (#) in content fields
4. Use LaTeX ($...$) for mathematical formulas
5. Use backticks for inline code
6. Mark key terms with **bold**
7. Mark the most summarizing sentence in a paragraph (>3 sentences) with *italic*
8. Accuracy is paramount - unverified information damages knowledge base integrity
9. Output ONLY the JSON structure, no preamble, no postscript, no self-evaluation
</output_rules>

<forbidden>
NEVER produce:
- Qualitative adjectives without quantification: "重要", "核心", "关键", "significant"
- Circular definitions: defining X using X or synonyms
- Metaphors without mechanism explanation
- "Emergence" without micro-mechanism detail
- Filler text: no greetings, no self-references outside _thought_trace
- Content that semantically duplicates existing nodes in vault_index
- Incomplete JSON or malformed output
- Content outside the JSON structure
- Markdown headers in any content field
</forbidden>

<wikilink_format>
When referencing other concepts, use Obsidian wikilink format following the user's naming template.
The naming template is provided via {{naming_template}} variable (default: "{{chinese}} ({{english}})").
Generate wikilinks during content creation, not as a post-processing step.
Example: If naming_template is "{{english}}", use [[Nash Equilibrium]] instead of [[纳什均衡 (Nash Equilibrium)]].
</wikilink_format>
</system>
```

---

## 3. 动态上下文组装

> **架构决策**: 采用「动态上下文组装」模式。根据任务类型决定包含哪些上下文槽位，最小化 Token 消耗。

### 3.1 上下文槽位定义

| 槽位 ID | 槽位名称 | 内容描述 | Token 估算 |
|:--|:--|:--|:--|
| `CTX_INPUT` | 用户原始输入 | 用户输入的概念文本 | 10-50 |
| `CTX_META` | 笔记元数据 | 标准名称、类型、别名、标签 | 50-200 |
| `CTX_VAULT` | 知识库索引 | 同类型节点的标题+摘要列表 | 500-2000 |
| `CTX_PARENT` | 父节点上下文 | 深化操作时的父节点信息 | 200-500 |
| `CTX_SOURCES` | 来源节点 | 合成操作时的源 Mechanism 完整内容 | 1000-3000 |
| `CTX_CURRENT` | 当前笔记内容 | 增量改进时的现有笔记全文 | 500-2000 |
| `CTX_INTENT` | 用户改进意图 | 增量改进时的用户指令 | 20-100 |
| `CTX_SCHEMA` | 类型字段定义 | 目标类型的完整字段说明 | 300-800 |

### 3.2 任务-槽位映射表

| 任务 ID | CTX_INPUT | CTX_META | CTX_VAULT | CTX_PARENT | CTX_SOURCES | CTX_CURRENT | CTX_INTENT | CTX_SCHEMA |
|:--|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `standardizeClassify` | ✓ | - | - | - | - | - | - | - |
| `enrich` | - | ✓ | - | - | - | - | - | - |
| `reason` (新建) | - | ✓ | ✓ | ○ | - | - | - | ✓ |
| `reason` (增量) | - | ✓ | ✓ | - | - | ✓ | ✓ | ✓ |
| `reason` (合成) | - | - | ✓ | - | ✓ | - | - | ✓ |
| `ground` | - | ✓ | - | - | - | ✓ | - | - |

> 图例: ✓ = 必需, ○ = 条件必需, - = 不包含

### 3.3 槽位注入格式

```xml
<context>
<!-- CTX_INPUT -->
<user_input>
{{raw_user_input}}
</user_input>

<!-- CTX_META -->
<note_metadata>
<standard_name>{{standard_name}}</standard_name>
<type>{{knowledge_type}}</type>
<aliases>{{aliases_json_array}}</aliases>
<tags>{{tags_json_array}}</tags>
</note_metadata>

<!-- CTX_VAULT -->
<vault_index type="{{knowledge_type}}" count="{{index_count}}">
{{#each similar_nodes}}
<node uid="{{uid}}" similarity="{{similarity}}">
<title>{{title}}</title>
<core_definition>{{core_definition}}</core_definition>
</node>
{{/each}}
</vault_index>

<!-- CTX_PARENT (条件注入) -->
<parent_node type="{{parent_type}}">
<title>{{parent_title}}</title>
<content>{{parent_content_excerpt}}</content>
</parent_node>

<!-- CTX_SOURCES (条件注入，用于 Principle 合成) -->
<source_mechanisms count="{{source_count}}">
{{#each source_mechanisms}}
<mechanism uid="{{uid}}">
<title>{{title}}</title>
<full_content>{{full_markdown_content}}</full_content>
</mechanism>
{{/each}}
</source_mechanisms>

<!-- CTX_CURRENT (条件注入，用于增量改进) -->
<current_content>
{{current_note_full_text}}
</current_content>

<!-- CTX_INTENT (条件注入，用于增量改进) -->
<improvement_intent>
{{user_improvement_instruction}}
</improvement_intent>

<!-- CTX_SCHEMA -->
<type_schema type="{{knowledge_type}}">
{{type_field_definitions}}
</type_schema>
</context>
```

---

## 4. 原子任务定义

> 系统包含 5 个原子任务，每个任务有独立的 Prompt 模板和输出 Schema。

### 4.1 任务总览

| 任务 ID | 任务名称 | 输入 | 输出 | 默认模型 |
|:--|:--|:--|:--|:--|
| `embedding` | 向量嵌入 | 文本字符串 | 浮点数组 | text-embedding-004 |
| `standardizeClassify` | 标准化+类型推断 | 用户原始输入 | 标准名称+类型+置信度 | gemini-2.5-flash |
| `enrich` | 元数据生成 | 标准名称+类型 | 别名+标签 | gemini-2.5-flash |
| `reason` | 内容生成 | 元数据+上下文 | 结构化内容 JSON | gemini-3.0-pro |
| `ground` | 事实核查 | 生成内容 | 核查结果 | gemini-2.5-pro |

### 4.2 Task: standardizeClassify

**功能**: 将用户原始输入标准化为「中文术语 (English Term)」格式，并推断知识类型。

**上下文槽位**: `CTX_INPUT`

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
<user_input>
{{raw_user_input}}
</user_input>
</context>

<task>
Perform two operations on the user input:

1. STANDARDIZE: Convert the input to the canonical format "中文术语 (English Term)"
   - If input is Chinese: find the authoritative English translation
   - If input is English: find the authoritative Chinese translation
   - If input is ambiguous: provide multiple interpretations in type_confidences

2. CLASSIFY: Determine the knowledge type from these 5 options:
   - Domain: A field of study with clear boundaries
   - Issue: A problem/question with core tension (X vs Y)
   - Theory: A logical system with axioms and conclusions
   - Entity: A static concept definable without time/process
   - Mechanism: A dynamic process with causal chains

   NOTE: Principle is NOT a valid classification - it can only be created through synthesis.

ALWAYS provide:
- Confidence scores for ALL 5 types (must sum to 1.0)
- For EACH type with confidence > 0.1, provide natural_description to help user understand
</task>

<output_schema>
{
  "standard_name": "string // format: 中文术语 (English Term)",
  "chinese_term": "string",
  "english_term": "string",
  "primary_type": "Domain | Issue | Theory | Entity | Mechanism",
  "reasoning": "string // explain why this type was chosen",
  "type_confidences": [
    {
      "type": "string // Domain | Issue | Theory | Entity | Mechanism",
      "confidence": "number // 0.0-1.0",
      "natural_label": "string // e.g., '一个静态概念/事物'",
      "natural_description": "string // plain language explanation of why it might be this type",
      "examples": ["string // similar concepts of this type"]
    }
  ]
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
OUTPUT REQUIREMENTS:
1. Output valid JSON only, no other text
2. type_confidences must include ALL 5 types and sum to 1.0
3. Each type entry must include natural_label, natural_description, and examples
4. Principle is NEVER a valid primary_type
</reminder>
```

**输出 JSON Schema (TypeScript)**:

```typescript
interface StandardizeClassifyOutput {
  standard_name: string;      // "中文术语 (English Term)"
  chinese_term: string;
  english_term: string;
  primary_type: "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";
  reasoning: string;
  type_confidences: Array<{
    type: "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";
    confidence: number;       // 0.0 - 1.0, all must sum to 1.0
    natural_label: string;    // e.g., '一个静态概念/事物'
    natural_description: string;  // plain language explanation
    examples: string[];       // similar concepts of this type
  }>;
}
```

### 4.3 Task: enrich

**功能**: 为标准化后的概念生成别名和标签。

**上下文槽位**: `CTX_META`

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
<note_metadata>
<standard_name>{{standard_name}}</standard_name>
<type>{{knowledge_type}}</type>
</note_metadata>
</context>

<task>
Generate aliases and tags for the given concept.

ALIASES:
- Include common synonyms in both Chinese and English
- Include abbreviations (e.g., "NE" for Nash Equilibrium)
- Include alternative translations
- Include historical or variant names
- Order by relevance (most common first)

TAGS:
- Use hierarchical format: "category/subcategory"
- Always include "cr-type/{{type_lowercase}}"
- Include relevant domain tags (e.g., "economics/game-theory")
- Include methodology tags if applicable
</task>

<output_schema>
{
  "aliases": ["string"],
  "tags": ["string"]
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
Output valid JSON with aliases and tags arrays only.
</reminder>
```

**输出 JSON Schema (TypeScript)**:

```typescript
interface EnrichOutput {
  aliases: string[];
  tags: string[];
}
```

### 4.4 Task: reason

**功能**: 核心内容生成任务，由 6 个 Agent 共用，根据知识类型生成结构化内容。

**上下文槽位**: 
- 新建模式: `CTX_META` + `CTX_VAULT` + `CTX_SCHEMA` + `CTX_PARENT`(可选)
- 增量模式: `CTX_META` + `CTX_VAULT` + `CTX_SCHEMA` + `CTX_CURRENT` + `CTX_INTENT`
- 合成模式: `CTX_VAULT` + `CTX_SCHEMA` + `CTX_SOURCES`

**模型参数**: Temperature ≥ 0.8 (公理 T4)

> **注意**: reason 任务的具体 Prompt 模板由各 Agent 定义，见第 5 节。此处定义通用的输出结构框架。

**通用输出结构框架**:

```typescript
interface ReasonOutputBase {
  _thought_trace: string;     // 思考过程记录（用于调试）
  metadata: {
    name: string;             // 标准名称
    type: KnowledgeType;      // 知识类型
  };
  content: Record<string, unknown>;  // 类型特定的内容字段
  relations?: Record<string, string[]>;  // 关系字段（wikilinks）
}
```

### 4.5 Task: ground

**功能**: 对 Agent 生成的内容进行事实核查。

**上下文槽位**: `CTX_META` + `CTX_CURRENT`

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
<note_metadata>
<standard_name>{{standard_name}}</standard_name>
<type>{{knowledge_type}}</type>
</note_metadata>

<content_to_verify>
{{generated_content_json}}
</content_to_verify>
</context>

<task>
Perform fact-checking on the generated content.

For each factual claim in the content:
1. IDENTIFY: Extract the specific claim
2. LOCATE: Note the JSON path where the claim appears
3. VERIFY: Cross-reference with authoritative sources
4. CLASSIFY: Assign a verdict (VERIFIED | DISPUTED | UNVERIFIABLE)
5. EXPLAIN: If disputed, describe the discrepancy

SCOPE:
- Check all fields EXCEPT "holistic_understanding" (which is interpretive)
- Focus on: dates, names, quantities, causal claims, definitions
- Skip: subjective assessments, predictions, interpretations

OUTPUT:
- overall_status: PASS (all verified) | WARN (some disputed) | FAIL (critical errors)
- fact_checks: array of individual check results
</task>

<output_schema>
{
  "overall_status": "PASS | WARN | FAIL",
  "summary": "string // brief summary of findings",
  "fact_checks": [
    {
      "claim": "string // the factual claim being checked",
      "location": "string // JSON path, e.g., $.content.definition",
      "verdict": "VERIFIED | DISPUTED | UNVERIFIABLE",
      "confidence": "number // 0.0-1.0",
      "sources": [
        {
          "uri": "string // URL of source",
          "title": "string // source title",
          "relevance": "string // how this source relates to the claim"
        }
      ],
      "discrepancy": "string | null // if disputed, explain the discrepancy"
    }
  ],
  "critical_errors": ["string // list of errors that should block publication"]
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
OUTPUT REQUIREMENTS:
1. Output valid JSON only
2. Check ALL factual claims except holistic_understanding
3. Provide source URLs for verification
4. Mark disputed claims clearly with discrepancy explanation
</reminder>
```

**输出 JSON Schema (TypeScript)**:

```typescript
interface GroundOutput {
  overall_status: "PASS" | "WARN" | "FAIL";
  summary: string;
  fact_checks: Array<{
    claim: string;
    location: string;           // JSON path
    verdict: "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";
    confidence: number;
    sources: Array<{
      uri: string;
      title: string;
      relevance: string;
    }>;
    discrepancy: string | null;
  }>;
  critical_errors: string[];
}
```

---

## 5. Agent 规格定义

> 系统包含 6 个 Agent，每个 Agent 对应一种知识类型。所有 Agent 共用 `reason` 任务的模型配置，但有独立的 Prompt 模板和输出 Schema。

### 5.1 Agent 总览

| Agent ID | Agent 名称 | 对应类型 | 触发条件 |
|:--|:--|:--|:--|
| `agent_a` | 领域制图师 (Cartographer) | Domain | Stub 状态 + type=Domain |
| `agent_b` | 矛盾侦探 (Detective) | Issue | Stub 状态 + type=Issue |
| `agent_c` | 理论解构者 (Deconstructor) | Theory | Stub 状态 + type=Theory |
| `agent_d` | 实体生成器 (Entity Generator) | Entity | Stub 状态 + type=Entity |
| `agent_e` | 机制生成器 (Mechanism Generator) | Mechanism | Stub 状态 + type=Mechanism |
| `agent_f` | 原理合成器 (Synthesizer) | Principle | 合成操作 + ≥2 Mechanisms |

### 5.2 类型字段定义 (CTX_SCHEMA)

> **引用**: 各知识类型的完整字段定义见 **PRD 3.2 节**。此处仅说明如何将 PRD 定义转换为 Prompt 注入格式。

**转换规则**:
- PRD 中的"必要字段"表格 → `<required_fields>` 区块
- PRD 中的"可选结构字段"表格 → `<optional_fields>` 区块
- PRD 中的"关系字段"表格 → `<relation_fields>` 区块
- 字段的"哲学依据"和"说明"列 → `<field>` 标签的内容

**示例：Domain 类型的 CTX_SCHEMA 生成**:

```xml
<type_schema type="Domain">
<required_fields>
  <!-- 来自 PRD 3.2.1 Domain 必要字段表 -->
  <field name="definition" label="定义">
    该领域研究什么对象？使用属加种差定义法。
  </field>
  <field name="teleology" label="目的论">
    该领域试图回答什么问题？解决什么需求？
  </field>
  <!-- ... 其他字段按 PRD 3.2.1 表格生成 ... -->
  <field name="holistic_understanding" label="整体理解">
    自由形式的深度综述，将上述要素融会贯通。
  </field>
</required_fields>
<optional_fields>
  <field name="sub_domains" label="子领域">
    若非原子领域，按清晰的分类维度进行划分。
  </field>
</optional_fields>
</type_schema>
```

**完整字段定义参考**:
- **Domain**: PRD 3.2.1
- **Issue**: PRD 3.2.2
- **Theory**: PRD 3.2.3
- **Entity**: PRD 3.2.4
- **Mechanism**: PRD 3.2.5
- **Principle**: PRD 3.2.6

开发者应在运行时根据 PRD 定义动态生成 `<type_schema>` 区块，确保 Prompt 与 PRD 字段定义保持同步。

### 5.3 Agent A: 领域制图师 (Domain Cartographer)

**触发条件**: Stub 状态 + type=Domain

**字段定义**: 见 PRD 3.2.1

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{CTX_META}}
{{CTX_VAULT}}
{{CTX_SCHEMA:Domain}}
{{CTX_PARENT?}}
</context>

<task>
Generate a comprehensive Domain knowledge node for: {{standard_name}}

You are mapping the boundaries and structure of a field of knowledge.
Your goal is to create a self-contained description that allows the reader
to fully understand what this domain is, what it studies, and how it relates
to other fields - WITHOUT needing to read any other notes.

CRITICAL REQUIREMENTS:
1. The "issues" field MUST contain wikilinks to the domain's core issues
2. Each issue must include its core_tension in "X vs Y" format
3. Use the vault_index to avoid creating content that duplicates existing nodes
4. If parent_node is provided, ensure coherence with parent context

ISSUE COMPLETENESS FORMULA:
Domain Issues = Σ(Sub-domain Issues) + Emergent Issues (not belonging to any sub-domain)
The "issues" field should list ONLY the emergent issues of this domain.
Sub-domain issues should be documented in their respective sub-domain notes.

HOLISTIC_UNDERSTANDING GUIDELINES:
The "holistic_understanding" field must SYNTHESIZE all previous fields into a coherent narrative (not merely repeat them), POSITION the concept within the larger knowledge ecosystem, and ILLUMINATE deep insights. AVOID superficial summaries or generic statements.
</task>

<output_schema>
{
  "_thought_trace": "string // your reasoning process",
  "metadata": {
    "name": "string // {{standard_name}}",
    "type": "Domain"
  },
  "content": {
    "definition": "string // what does this domain study?",
    "teleology": "string // what questions does it try to answer?",
    "methodology": "string // how does it produce and validate knowledge?",
    "historical_genesis": "string // when, why, how did it emerge?",
    "boundaries": "string // what does it NOT study? boundaries with adjacent fields",
    "issues": [
      {
        "name": "string // [[中文术语 (English Term)]] format",
        "core_tension": "string // X vs Y format",
        "significance": "string // why this issue matters"
      }
    ],
    "sub_domains": [
      {
        "name": "string // [[中文术语 (English Term)]] format",
        "classification_dimension": "string // dimension used for division",
        "brief_description": "string"
      }
    ],
    "holistic_understanding": "string // comprehensive synthesis"
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
CRITICAL CHECKLIST:
□ All issues use [[wikilink]] format
□ Each issue has core_tension in "X vs Y" format
□ Definition uses genus-differentia method
□ Boundaries clearly state what is NOT included
□ No semantic overlap with existing nodes in vault_index
□ Output is valid JSON only
</reminder>
```

### 5.4 Agent B: 矛盾侦探 (Issue Detective)

**触发条件**: Stub 状态 + type=Issue

**字段定义**: 见 PRD 3.2.2

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{CTX_META}}
{{CTX_VAULT}}
{{CTX_SCHEMA:Issue}}
{{CTX_PARENT?}}
</context>

<task>
Generate a comprehensive Issue knowledge node for: {{standard_name}}

You are investigating a fundamental problem or question in a field.
Your goal is to reveal the core tension, analyze its structure,
and map the theoretical landscape of proposed solutions.

CRITICAL REQUIREMENTS:
1. The "core_tension" MUST be in "X vs Y" format - this is non-negotiable
2. The "theories" field MUST contain wikilinks to theories addressing this issue
3. Theories should be categorized as: mainstream / marginal / falsified
4. Use the vault_index to avoid creating content that duplicates existing nodes

THEORY COMPLETENESS:
List all significant theories that have attempted to resolve this issue.
Prefer over-inclusion to omission - missing a theory is worse than redundancy.

HOLISTIC_UNDERSTANDING GUIDELINES:
The "holistic_understanding" field must SYNTHESIZE all previous fields into a coherent narrative (not merely repeat them), POSITION the concept within the larger knowledge ecosystem, and ILLUMINATE deep insights. AVOID superficial summaries or generic statements.
</task>

<output_schema>
{
  "_thought_trace": "string // your reasoning process",
  "metadata": {
    "name": "string // {{standard_name}}",
    "type": "Issue"
  },
  "content": {
    "core_tension": "string // MUST be in 'X vs Y' format",
    "significance": "string // why is this a problem worth solving?",
    "historical_genesis": "string // when was this issue identified?",
    "structural_analysis": "string // break down into sub-problems",
    "stakeholder_perspectives": "string // how different parties view this",
    "boundary_conditions": "string // when does this issue NOT apply?",
    "theories": {
      "mainstream": [
        {
          "name": "string // [[中文术语 (English Term)]] format",
          "core_stance": "string // how it addresses the tension"
        }
      ],
      "marginal": [
        {
          "name": "string // [[wikilink]] format",
          "core_stance": "string"
        }
      ],
      "falsified": [
        {
          "name": "string // [[wikilink]] format",
          "reason_falsified": "string"
        }
      ]
    },
    "holistic_understanding": "string // comprehensive synthesis"
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
CRITICAL CHECKLIST:
□ core_tension is EXACTLY in "X vs Y" format (e.g., "个体理性 vs 集体理性")
□ All theories use [[wikilink]] format
□ Theories are categorized into mainstream/marginal/falsified
□ No semantic overlap with existing nodes in vault_index
□ Output is valid JSON only
</reminder>
```

### 5.5 Agent C: 理论解构者 (Theory Deconstructor)

**触发条件**: Stub 状态 + type=Theory

**字段定义**: 见 PRD 3.2.3

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{CTX_META}}
{{CTX_VAULT}}
{{CTX_SCHEMA:Theory}}
{{CTX_PARENT?}}
</context>

<task>
Generate a comprehensive Theory knowledge node for: {{standard_name}}

You are deconstructing a theoretical framework to reveal its logical structure.
Your goal is to expose the axioms, trace the argument chain, and extract
the entities and mechanisms that constitute the theory.

CRITICAL REQUIREMENTS:
1. "axioms" must list the foundational assumptions with justifications
2. "argument_chain" must show logical derivation with connectors (因此, 所以, 若...则...)
3. "extracted_components" MUST contain wikilinks to:
   - Entities defined by this theory
   - Mechanisms described by this theory
4. Use the vault_index to avoid creating content that duplicates existing nodes

COMPONENT EXTRACTION:
Prefer over-extraction to omission. Every concept that could stand alone
as an Entity or Mechanism should be listed.

HOLISTIC_UNDERSTANDING GUIDELINES:
The "holistic_understanding" field must SYNTHESIZE all previous fields into a coherent narrative (not merely repeat them), POSITION the concept within the larger knowledge ecosystem, and ILLUMINATE deep insights. AVOID superficial summaries or generic statements.
</task>

<output_schema>
{
  "_thought_trace": "string // your reasoning process",
  "metadata": {
    "name": "string // {{standard_name}}",
    "type": "Theory"
  },
  "content": {
    "axioms": [
      {
        "statement": "string // the axiom",
        "justification": "string // why this is accepted as given"
      }
    ],
    "argument_chain": "string // logical derivation with connectors",
    "core_predictions": [
      {
        "prediction": "string // testable prediction",
        "verification_method": "string // how to test"
      }
    ],
    "scope_and_applicability": "string // when is this theory valid?",
    "limitations": "string // known deficiencies",
    "historical_development": "string // evolution of the theory",
    "extracted_components": {
      "entities": [
        {
          "name": "string // [[中文术语 (English Term)]] format",
          "role_in_theory": "string // how this entity functions in the theory"
        }
      ],
      "mechanisms": [
        {
          "name": "string // [[中文术语 (English Term)]] format",
          "role_in_theory": "string // how this mechanism operates in the theory"
        }
      ]
    },
    "holistic_understanding": "string // comprehensive synthesis"
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
CRITICAL CHECKLIST:
□ Each axiom has a justification
□ Argument chain uses logical connectors (因此, 所以, 若...则...)
□ All extracted components use [[wikilink]] format
□ Components are correctly categorized as Entity or Mechanism
□ No semantic overlap with existing nodes in vault_index
□ Output is valid JSON only
</reminder>
```

### 5.6 Agent D: 实体生成器 (Entity Generator)

**触发条件**: Stub 状态 + type=Entity

**字段定义**: 见 PRD 3.2.4

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{CTX_META}}
{{CTX_VAULT}}
{{CTX_SCHEMA:Entity}}
{{CTX_PARENT?}}
</context>

<task>
Generate a comprehensive Entity knowledge node for: {{standard_name}}

You are defining a static concept - something that can be fully characterized
without reference to time or process. Your goal is to create a rigorous
definition that distinguishes this entity from all similar concepts.

CRITICAL REQUIREMENTS:
1. "definition" MUST use genus-differentia method (属+种差)
2. "distinguishing_features" must clearly separate this from similar entities
3. "examples" and "counter_examples" must be concrete and illustrative
4. Relation fields (is_a, has_parts, related_to) use [[wikilink]] format
5. Use the vault_index to avoid creating content that duplicates existing nodes

DEFINITION QUALITY CHECK:
- Is the genus (上位类) correctly identified?
- Are the differentia (种差) necessary and sufficient?
- Can someone unfamiliar with the concept understand it from the definition alone?

HOLISTIC_UNDERSTANDING GUIDELINES:
The "holistic_understanding" field must SYNTHESIZE all previous fields into a coherent narrative (not merely repeat them), POSITION the concept within the larger knowledge ecosystem, and ILLUMINATE deep insights. AVOID superficial summaries or generic statements.
</task>

<output_schema>
{
  "_thought_trace": "string // your reasoning process",
  "metadata": {
    "name": "string // {{standard_name}}",
    "type": "Entity"
  },
  "content": {
    "definition": "string // genus-differentia definition",
    "classification": "string // taxonomic position",
    "properties": [
      {
        "name": "string // property name",
        "description": "string // what this property means",
        "possible_values": "string // range or enumeration",
        "measurement": "string // how to measure/observe"
      }
    ],
    "distinguishing_features": "string // what makes this unique",
    "examples": ["string // concrete positive examples"],
    "counter_examples": ["string // things often confused with this but aren't"],
    "holistic_understanding": "string // comprehensive synthesis"
  },
  "relations": {
    "is_a": ["string // [[wikilink]] to superclass"],
    "has_parts": ["string // [[wikilink]] to components"],
    "related_to": ["string // [[wikilink]] to related concepts"]
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
CRITICAL CHECKLIST:
□ Definition follows genus-differentia pattern
□ At least 2 examples and 2 counter-examples provided
□ All relations use [[wikilink]] format
□ Properties include measurement methods
□ No semantic overlap with existing nodes in vault_index
□ Output is valid JSON only
</reminder>
```

### 5.7 Agent E: 机制生成器 (Mechanism Generator)

**触发条件**: Stub 状态 + type=Mechanism

**字段定义**: 见 PRD 3.2.5

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{CTX_META}}
{{CTX_VAULT}}
{{CTX_SCHEMA:Mechanism}}
{{CTX_PARENT?}}
</context>

<task>
Generate a comprehensive Mechanism knowledge node for: {{standard_name}}

You are analyzing a dynamic process - something that involves change,
causation, or transformation over time. Your goal is to fully characterize
the trigger, steps, and outcomes of this mechanism.

CRITICAL REQUIREMENTS:
1. "causal_chain" MUST have at least 2 steps with clear input→output
2. "trigger_conditions" and "termination_conditions" must be specific
3. Relation fields use [[wikilink]] format
4. "operates_on" must list at least 1 entity
5. Use the vault_index to avoid creating content that duplicates existing nodes

MECHANISM COMPLETENESS:
- Can someone replicate or identify this mechanism from your description?
- Are all necessary preconditions specified?
- Is the causal chain complete (no missing steps)?

HOLISTIC_UNDERSTANDING GUIDELINES:
The "holistic_understanding" field must SYNTHESIZE all previous fields into a coherent narrative (not merely repeat them), POSITION the concept within the larger knowledge ecosystem, and ILLUMINATE deep insights. AVOID superficial summaries or generic statements.
</task>

<output_schema>
{
  "_thought_trace": "string // your reasoning process",
  "metadata": {
    "name": "string // {{standard_name}}",
    "type": "Mechanism"
  },
  "content": {
    "definition": "string // what process is this?",
    "trigger_conditions": "string // what initiates this mechanism?",
    "causal_chain": [
      {
        "step": "number // step sequence",
        "action": "string // what happens",
        "input": "string // what goes in",
        "output": "string // what comes out"
      }
    ],
    "termination_conditions": "string // what stops this mechanism?",
    "inputs": ["string // required preconditions/resources"],
    "outputs": ["string // results/effects produced"],
    "process_description": "string // coherent narrative of the process",
    "examples": ["string // typical application scenarios"],
    "holistic_understanding": "string // comprehensive synthesis"
  },
  "relations": {
    "operates_on": ["string // [[wikilink]] to entities, ≥1 required"],
    "produces": ["string // [[wikilink]] to new entities/states"],
    "requires": ["string // [[wikilink]] to prerequisite mechanisms"],
    "inhibited_by": ["string // factors that prevent/weaken this"]
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
CRITICAL CHECKLIST:
□ causal_chain has at least 2 steps
□ Each step has clear input and output
□ operates_on contains at least 1 [[wikilink]]
□ trigger and termination conditions are specific
□ No semantic overlap with existing nodes in vault_index
□ Output is valid JSON only
</reminder>
```

### 5.8 Agent F: 原理合成器 (Principle Synthesizer)

**触发条件**: 合成操作 + ≥2 个 Mechanism 被选中

**字段定义**: 见 PRD 3.2.6

**特殊说明**: 此 Agent 仅通过合成操作触发，不走常规 Stub→Draft 流程。输出直接创建 Draft 状态笔记。

**Prompt 模板**:

```xml
<system>
{{SHARED_CONSTRAINTS}}
</system>

<context>
{{CTX_VAULT}}
{{CTX_SOURCES}}
{{CTX_SCHEMA:Principle}}
</context>

<task>
Synthesize a Principle from the provided source mechanisms.

You are performing cross-domain abstraction - identifying structural invariants
that appear across multiple mechanisms from different fields. A valid Principle
must capture a pattern that transcends the specific details of any single mechanism.

SOURCE MECHANISMS:
{{#each source_mechanisms}}
- {{title}} (from {{domain}})
{{/each}}

CRITICAL REQUIREMENTS:
1. Analyze EACH source mechanism's causal chain structure
2. Identify the isomorphic pattern that appears in ALL sources
3. "formal_statement" MUST be in "若[条件]，则[结果]" format
4. "variables" must map abstract symbols to concrete meanings
5. "isomorphism_analysis" must show how each source mechanism maps to the principle
6. Use the vault_index to ensure no duplicate Principle exists

SYNTHESIS VALIDITY CHECK:
- Does the pattern truly appear in ALL source mechanisms?
- Are the variables abstract enough to apply across domains?
- Can this principle predict new instances in untested domains?

IF NO VALID PRINCIPLE CAN BE FOUND:
Return a special structure with status: "NO_PRINCIPLE_FOUND" and explain why.

HOLISTIC_UNDERSTANDING GUIDELINES:
The "holistic_understanding" field must SYNTHESIZE all previous fields into a coherent narrative (not merely repeat them), POSITION the concept within the larger knowledge ecosystem, and ILLUMINATE deep insights. AVOID superficial summaries or generic statements.
</task>

<output_schema>
{
  "_thought_trace": "string // detailed analysis of each mechanism's structure",
  "status": "SUCCESS | NO_PRINCIPLE_FOUND",
  "no_principle_reason": "string | null // only if status is NO_PRINCIPLE_FOUND",
  "metadata": {
    "name": "string // [[中文术语 (English Term)]] format",
    "type": "Principle"
  },
  "content": {
    "formal_statement": "string // 若[条件]，则[结果] format",
    "mathematical_form": "string | null // LaTeX if applicable",
    "variables": {
      "variable_symbol": "string // meaning of each abstract variable"
    },
    "scope_and_constraints": "string // when does this principle hold?",
    "isomorphism_analysis": [
      {
        "source_mechanism": "string // [[wikilink]] to source",
        "domain": "string // field of the source mechanism",
        "variable_mapping": {
          "abstract_var": "string // concrete instantiation in this mechanism"
        }
      }
    ],
    "predictive_power": "string // what new phenomena can this predict?",
    "historical_precedents": "string | null // other names for similar patterns",
    "holistic_understanding": "string // comprehensive synthesis"
  },
  "relations": {
    "source_mechanisms": ["string // [[wikilink]] to each source mechanism"]
  }
}
</output_schema>

<error_history>
{{previous_errors}}
</error_history>

<reminder>
CRITICAL CHECKLIST:
□ formal_statement is in "若...则..." format
□ All source mechanisms are mapped in isomorphism_analysis
□ Variables are abstract enough to apply across domains
□ source_mechanisms relation contains all [[wikilinks]]
□ If no valid principle found, use NO_PRINCIPLE_FOUND status
□ Output is valid JSON only
</reminder>
```

---

## 6. 结构化重试机制

> **架构决策**: 采用「结构化重试」策略。当 LLM 返回不符合预期的输出时，将错误信息追加到上下文中进行重试，最多 3 次。

### 6.1 错误分类

| 错误类型 | 错误码 | 描述 | 重试策略 |
|:--|:--|:--|:--|
| `PARSE_ERROR` | E001 | JSON 解析失败 | 结构化重试 |
| `SCHEMA_VIOLATION` | E002 | 输出不符合 Schema | 结构化重试 |
| `MISSING_REQUIRED` | E003 | 必填字段缺失 | 结构化重试 |
| `CONSTRAINT_VIOLATION` | E004 | 违反业务约束（如缺少 wikilink） | 结构化重试 |
| `SEMANTIC_DUPLICATE` | E005 | 内容与已有节点重复 | 提示用户确认 |
| `API_ERROR` | E100 | API 调用失败 | 指数退避重试 |
| `TIMEOUT` | E101 | 请求超时 | 指数退避重试 |

### 6.2 结构化重试流程

```
┌─────────────────────────────────────────────────────────────┐
│                    结构化重试流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Request #1                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ <context>...</context>                              │   │
│  │ <task>...</task>                                    │   │
│  │ <output_schema>...</output_schema>                  │   │
│  │ <error_history></error_history>  ← 空              │   │
│  │ <reminder>...</reminder>                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│                    [LLM Response]                           │
│                          ↓                                  │
│                   [Validation]                              │
│                    ↓        ↓                               │
│               [PASS]    [FAIL]                              │
│                 ↓          ↓                                │
│            [Return]   Request #2 (Retry)                    │
│                       ┌─────────────────────────────────┐   │
│                       │ <error_history>                 │   │
│                       │   <error attempt="1">           │   │
│                       │     <code>E002</code>           │   │
│                       │     <message>...</message>      │   │
│                       │     <raw_output>...</raw_output>│   │
│                       │   </error>                      │   │
│                       │ </error_history>                │   │
│                       └─────────────────────────────────┘   │
│                          ↓                                  │
│                    [LLM Response]                           │
│                          ↓                                  │
│                   [Validation]                              │
│                    ↓        ↓                               │
│               [PASS]    [FAIL → Retry #3 → FAIL]            │
│                 ↓                    ↓                      │
│            [Return]           [Return Error]                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 错误历史注入格式

```xml
<error_history>
  <error attempt="1" timestamp="2025-12-01T10:30:00Z">
    <code>E002</code>
    <type>SCHEMA_VIOLATION</type>
    <message>
      Field 'content.core_tension' does not match required format.
      Expected: "X vs Y" format
      Received: "理性与有限理性的矛盾"
    </message>
    <location>$.content.core_tension</location>
    <raw_output>
      {"content": {"core_tension": "理性与有限理性的矛盾", ...}}
    </raw_output>
    <fix_instruction>
      Reformat core_tension to exactly "X vs Y" pattern.
      Example: "完全理性 vs 有限理性"
    </fix_instruction>
  </error>
  
  <error attempt="2" timestamp="2025-12-01T10:30:15Z">
    <code>E003</code>
    <type>MISSING_REQUIRED</type>
    <message>
      Required field 'content.theories.mainstream' is empty array.
      At least one mainstream theory must be provided.
    </message>
    <location>$.content.theories.mainstream</location>
    <raw_output>
      {"content": {"theories": {"mainstream": [], ...}}}
    </raw_output>
    <fix_instruction>
      Add at least one mainstream theory with name and core_stance.
    </fix_instruction>
  </error>
</error_history>
```

### 6.4 验证器实现规格

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  code: string;           // E001-E005
  type: ErrorType;
  message: string;
  location: string;       // JSON path
  rawValue?: unknown;
  expectedFormat?: string;
  fixInstruction: string;
}

type ErrorType = 
  | "PARSE_ERROR"
  | "SCHEMA_VIOLATION" 
  | "MISSING_REQUIRED"
  | "CONSTRAINT_VIOLATION"
  | "SEMANTIC_DUPLICATE";

// 验证器执行顺序
const VALIDATION_PIPELINE = [
  "validateJSON",           // 1. JSON 可解析性
  "validateSchema",         // 2. Schema 符合性
  "validateRequiredFields", // 3. 必填字段存在性
  "validateConstraints",    // 4. 业务约束（如 wikilink 格式）
  "validateSemantics"       // 5. 语义去重检查
];
```

### 6.5 业务约束验证规则

| 约束 ID | 适用类型 | 验证规则 | 错误消息模板 |
|:--|:--|:--|:--|
| C001 | Issue | `core_tension` 匹配 `/^.+ vs .+$/` | "core_tension must be in 'X vs Y' format" |
| C002 | All | wikilink 匹配 `/\[\[.+\]\]/` | "Field {field} must use [[wikilink]] format" |
| C003 | Theory | `axioms` 数组长度 ≥ 1 | "At least one axiom required" |
| C004 | Theory | 每个 axiom 有 `justification` | "Each axiom must have justification" |
| C005 | Mechanism | `causal_chain` 步骤数 ≥ 2 | "Causal chain must have at least 2 steps" |
| C006 | Mechanism | `operates_on` 数组长度 ≥ 1 | "operates_on must contain at least 1 entity" |
| C007 | Principle | `formal_statement` 包含 "若" 和 "则" | "formal_statement must be in '若...则...' format" |
| C008 | Principle | `source_mechanisms` 数组长度 ≥ 2 | "Principle must be synthesized from ≥2 mechanisms" |
| C009 | All | `type_confidences` 求和 = 1.0 | "type_confidences must sum to 1.0" |

### 6.6 重试配置

```typescript
interface RetryConfig {
  maxAttempts: number;        // 默认 3
  backoffStrategy: "none" | "exponential";  // 结构化重试用 none
  backoffBase: number;        // API 错误用 1000ms
  backoffMax: number;         // API 错误最大 16000ms
  includeRawOutput: boolean;  // 是否在 error_history 中包含原始输出
  truncateRawOutput: number;  // 原始输出最大字符数，默认 500
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffStrategy: "none",
  backoffBase: 1000,
  backoffMax: 16000,
  includeRawOutput: true,
  truncateRawOutput: 500
};
```

---

## 7. 增量改进模式

> **触发条件**: 用户对 Draft/Evergreen 状态的笔记点击 [增量改进] 按钮。

### 7.1 增量模式上下文组装

增量改进模式需要额外的上下文槽位：

```xml
<context>
{{CTX_META}}
{{CTX_VAULT}}
{{CTX_SCHEMA}}

<!-- 增量模式专用 -->
<current_content>
{{current_note_full_text}}
</current_content>

<improvement_intent>
{{user_improvement_instruction}}
</improvement_intent>
</context>
```

### 7.2 增量模式任务指令

在标准 Agent Prompt 的 `<task>` 区块后追加：

```xml
<incremental_mode>
You are improving an EXISTING note, not creating a new one.

CURRENT CONTENT:
The note already exists with the content provided in <current_content>.

USER INTENT:
The user wants you to: {{user_improvement_instruction}}

IMPROVEMENT RULES:
1. Preserve all content NOT related to the improvement intent
2. Make targeted changes only where relevant
3. Maintain consistency with existing wikilinks and structure
4. Mark any significantly changed fields in _thought_trace

OUTPUT:
Return the COMPLETE updated JSON structure (not just the changes).
The system will compute the diff automatically.
</incremental_mode>
```

### 7.3 Diff 计算规格

```typescript
interface DiffResult {
  hasChanges: boolean;
  changedFields: string[];  // JSON paths of modified fields
  additions: DiffItem[];
  deletions: DiffItem[];
  modifications: DiffItem[];
}

interface DiffItem {
  path: string;           // JSON path
  fieldLabel: string;     // 中文字段名
  before: string | null;  // 原值（截断显示）
  after: string | null;   // 新值（截断显示）
}
```

---

## 附录 A: 变量注入速查表

| 变量名 | 说明 | 来源 |
|:--|:--|:--|
| `{{SHARED_CONSTRAINTS}}` | 共享硬约束 | 编译时固定（2.3 节） |
| `{{raw_user_input}}` | 用户原始输入 | 运行时注入 |
| `{{standard_name}}` | 标准化名称 | standardizeClassify 输出 |
| `{{knowledge_type}}` | 知识类型 | standardizeClassify 输出 |
| `{{aliases_json_array}}` | 别名数组 JSON | enrich 输出 |
| `{{tags_json_array}}` | 标签数组 JSON | enrich 输出 |
| `{{similar_nodes}}` | 相似节点列表 | VectorIndex 检索结果 |
| `{{parent_title}}` | 父节点标题 | 深化操作时的父节点 |
| `{{parent_content_excerpt}}` | 父节点内容摘要 | 深化操作时的父节点 |
| `{{source_mechanisms}}` | 来源机制列表 | 合成操作时选中的机制 |
| `{{current_note_full_text}}` | 当前笔记全文 | 增量改进时的现有内容 |
| `{{user_improvement_instruction}}` | 用户改进意图 | 增量改进时的用户输入 |
| `{{type_field_definitions}}` | 类型字段定义 | 5.2 节的 Schema |
| `{{previous_errors}}` | 错误历史 | 结构化重试时的累积错误 |
| `{{naming_template}}` | 命名模板 | 用户配置 |

---

## 附录 B: JSON Schema 类型定义汇总

```typescript
// ============ 知识类型枚举 ============
type KnowledgeType = "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism" | "Principle";

// ============ 任务输出类型 ============

// Task: standardizeClassify
interface StandardizeClassifyOutput {
  standard_name: string;
  chinese_term: string;
  english_term: string;
  primary_type: Exclude<KnowledgeType, "Principle">;  // Principle 不可推断
  reasoning: string;
  type_confidences: Array<{
    type: Exclude<KnowledgeType, "Principle">;
    confidence: number;       // 0.0 - 1.0, all must sum to 1.0
    natural_label: string;    // e.g., '一个静态概念/事物'
    natural_description: string;  // plain language explanation
    examples: string[];       // similar concepts of this type
  }>;
}

// Task: enrich
interface EnrichOutput {
  aliases: string[];
  tags: string[];
}

// Task: ground
interface GroundOutput {
  overall_status: "PASS" | "WARN" | "FAIL";
  summary: string;
  fact_checks: Array<{
    claim: string;
    location: string;
    verdict: "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";
    confidence: number;
    sources: Array<{
      uri: string;
      title: string;
      relevance: string;
    }>;
    discrepancy: string | null;
  }>;
  critical_errors: string[];
}

// ============ Agent 输出基类 ============
interface AgentOutputBase {
  _thought_trace: string;
  metadata: {
    name: string;
    type: KnowledgeType;
  };
  content: Record<string, unknown>;
  relations?: Record<string, string[]>;
}

// ============ Domain Agent 输出 ============
interface DomainAgentOutput extends AgentOutputBase {
  metadata: { name: string; type: "Domain" };
  content: {
    definition: string;
    teleology: string;
    methodology: string;
    historical_genesis: string;
    boundaries: string;
    issues: Array<{
      name: string;  // wikilink format
      core_tension: string;
      significance: string;
    }>;
    sub_domains?: Array<{
      name: string;
      classification_dimension: string;
      brief_description: string;
    }>;
    holistic_understanding: string;
  };
}

// ============ Issue Agent 输出 ============
interface IssueAgentOutput extends AgentOutputBase {
  metadata: { name: string; type: "Issue" };
  content: {
    core_tension: string;  // MUST be "X vs Y" format
    significance: string;
    historical_genesis: string;
    structural_analysis: string;
    stakeholder_perspectives: string;
    boundary_conditions: string;
    theories: {
      mainstream: Array<{ name: string; core_stance: string }>;
      marginal: Array<{ name: string; core_stance: string }>;
      falsified: Array<{ name: string; reason_falsified: string }>;
    };
    holistic_understanding: string;
  };
}

// ============ Theory Agent 输出 ============
interface TheoryAgentOutput extends AgentOutputBase {
  metadata: { name: string; type: "Theory" };
  content: {
    axioms: Array<{ statement: string; justification: string }>;
    argument_chain: string;
    core_predictions: Array<{ prediction: string; verification_method: string }>;
    scope_and_applicability: string;
    limitations: string;
    historical_development: string;
    extracted_components: {
      entities: Array<{ name: string; role_in_theory: string }>;
      mechanisms: Array<{ name: string; role_in_theory: string }>;
    };
    holistic_understanding: string;
  };
}

// ============ Entity Agent 输出 ============
interface EntityAgentOutput extends AgentOutputBase {
  metadata: { name: string; type: "Entity" };
  content: {
    definition: string;
    classification: string;
    properties: Array<{
      name: string;
      description: string;
      possible_values: string;
      measurement: string;
    }>;
    distinguishing_features: string;
    examples: string[];
    counter_examples: string[];
    holistic_understanding: string;
  };
  relations: {
    is_a: string[];
    has_parts: string[];
    related_to: string[];
  };
}

// ============ Mechanism Agent 输出 ============
interface MechanismAgentOutput extends AgentOutputBase {
  metadata: { name: string; type: "Mechanism" };
  content: {
    definition: string;
    trigger_conditions: string;
    causal_chain: Array<{
      step: number;
      action: string;
      input: string;
      output: string;
    }>;
    termination_conditions: string;
    inputs: string[];
    outputs: string[];
    process_description: string;
    examples: string[];
    holistic_understanding: string;
  };
  relations: {
    operates_on: string[];    // ≥1 required
    produces: string[];
    requires: string[];
    inhibited_by: string[];
  };
}

// ============ Principle Agent 输出 ============
interface PrincipleAgentOutput extends AgentOutputBase {
  status: "SUCCESS" | "NO_PRINCIPLE_FOUND";
  no_principle_reason: string | null;
  metadata: { name: string; type: "Principle" };
  content: {
    formal_statement: string;  // MUST be "若...则..." format
    mathematical_form: string | null;
    variables: Record<string, string>;
    scope_and_constraints: string;
    isomorphism_analysis: Array<{
      source_mechanism: string;
      domain: string;
      variable_mapping: Record<string, string>;
    }>;
    predictive_power: string;
    historical_precedents: string | null;
    holistic_understanding: string;
  };
  relations: {
    source_mechanisms: string[];  // ≥2 required
  };
}
```