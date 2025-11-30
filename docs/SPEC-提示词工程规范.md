# Cognitive Razor - 提示词工程规范

> **文档定位**: 本文档定义 Cognitive Razor 插件中所有 LLM 提示词的工程规范，与 PRD 保持严格同步。
> 
> **设计理念**: 基于 Gemini 3 官方提示策略和 Manus 上下文工程经验，采用结构化标记、精确指令和 KV 缓存友好的设计原则。

## 1. 架构与约定

### 1.1 文件组织

```
.obsidian/plugins/obsidian-cognitive-razor/prompts/
├── system_core.md              # 全局系统指令
├── l2_pre_standardizer.md      # 标准化 + 类型推断 + 消歧义 (standardizeClassify)
├── l2_pre_batch.md             # 批量标准化模式
├── l3_agent_a_domain.md        # Agent A: 领域制图师
├── l3_agent_b_issue.md         # Agent B: 矛盾侦探
├── l3_agent_c_theory.md        # Agent C: 理论解构者
├── l3_agent_d_entity.md        # Agent D: 实体生成器
├── l3_agent_e_mechanism.md     # Agent E: 机制生成器
├── l3_agent_f_principle.md     # Agent F: 原理合成器
├── l2_reflex_validate.md       # 基础校验
├── l2_reflex_fact_check.md     # 事实核查 (Grounding)
└── l2_reflex_error_diagnose.md # 错误诊断
```

### 1.2 上下文工程原则

> **参考来源**: Manus 团队上下文工程经验 + Gemini 3 提示最佳实践

**核心原则**:

| 原则 | 说明 | 实施方式 |
|:--|:--|:--|
| **KV 缓存友好** | 保持提示前缀稳定，最大化缓存命中率 | 系统指令固定在最前，避免动态时间戳 |
| **只追加上下文** | 避免修改已有上下文，保持追加模式 | 新信息追加到末尾，不修改历史 |
| **遮蔽而非移除** | 动态约束 action space，但不改变工具定义 | 使用响应预填充约束输出 |
| **保留错误内容** | 失败的尝试保留在上下文中，帮助模型学习 | 不清理错误痕迹，让模型看到失败和恢复 |
| **通过复述操控注意力** | 重要目标在上下文末尾复述 | 每次调用时在末尾重申当前任务目标 |
| **避免少样本陷阱** | 适度引入结构化变化，避免过度模式匹配 | 示例使用变化的序列化模板 |

**上下文布局顺序**（Gemini 3 推荐）:
```
1. [System Instruction] 角色定义 + 行为约束 + 输出格式
2. [Context] 大量背景数据（vault_index, 父节点内容等）
3. [Task] 具体任务指令
4. [Anchor] 上下文锚定短语："根据上述信息..."
```

### 1.3 变量注入约定

Prompt 中使用 `{{variable}}` 表示运行时注入的变量。

| 变量来源 | 前缀 | 示例 |
|:--: |:--: |:--: |
| 用户输入 | 无 | `{{user_input}}`, `{{domain_name}}` |
| 笔记元数据 | 无 | `{{note_uid}}`, `{{note_type}}`, `{{note_status}}` |
| 系统配置 | 无 | `{{output_language}}`, `{{naming_template}}` |
| 向量索引上下文 | 无 | `{{vault_index}}`, `{{similar_nodes}}` |
| 算法参数 | 无 | `{{dedup_threshold}}`, `{{top_k}}` |
| 父节点上下文 | `parent_` | `{{parent_uid}}`, `{{parent_context}}` |
| 历史记录 | `history_` | `{{history_errors}}`, `{{history_attempts}}` |

**变量注入位置规则**:
- **静态变量**（如 `output_language`, `naming_template`）放在系统指令中
- **动态变量**（如 `vault_index`, `user_input`）放在上下文和任务区域
- **避免在系统指令开头放置动态内容**（影响 KV 缓存命中）

### 1.4 输出格式约定

所有 Agent 输出必须为**有效 JSON**，不使用 Markdown 代码块包裹。

```typescript
interface AgentOutput {
  _thought_trace: string;  // 思考过程（仅调试用）
  metadata: {
    name: string;          // 规范名称
    type: KnowledgeType;   // 知识类型
  };
  content: Record<string, unknown>;  // 类型特定内容
  relations?: Record<string, unknown>;  // 关联关系
}
```


### 1.5 任务模型映射

> **设计原则**: 与 PRD 4.2 节任务模型配置保持一致。

| 任务 ID | 任务名称 | 默认模型 | 用途 |
|:-- |:-- |:-- |:-- |
| `embedding` | 向量嵌入 | text-embedding-004 | 文本向量化，用于相似度检索和语义去重 |
| `standardizeClassify` | 输入标准化 + 类型推断 | gemini-2.5-flash | 将用户输入标准化并推断知识类型，同时返回类型消歧义选项（单次 API 调用）|
| `enrich` | 别名/标签生成 | gemini-2.5-flash | 生成别名和分类标签 |
| `reason` | 内容生成 | gemini-3.0-pro | Agent A/B/C/D/E/F 的核心推理 |
| `ground` | 事实核查 | gemini-2.5-pro | 基于 Google Search 验证事实准确性（可选）|

> **API 调用格式说明**：系统支持三种 API 调用格式（提供商）：
> - **Google Gemini**：使用 Google Generative AI API 调用格式（推荐）
> - **OpenAI**：使用 OpenAI API 调用格式，兼容所有 OpenAI 格式的第三方服务
> - **OpenRouter**：使用 OpenRouter API 调用格式，聚合多模型的统一接口

### 1.6 Gemini 3 模型约定

> **参考来源**: [Gemini 3 开发者指南](https://ai.google.dev/gemini-api/docs/gemini-3)

| 约定 | 说明 | 理由 |
|:--: |:--: |:--: |
| Temperature | **按任务类型区分**（见下表）| 不同任务对确定性/创造性的需求不同 |
| Thinking Level | `reason` 任务使用 `"high"` | 最大化推理深度，适合复杂知识生成任务 |
| 结构化输出 | `responseMimeType: "application/json"` | 确保输出为有效 JSON |
| 提示风格 | 精确、直接、结构化 | Gemini 3 最适合处理直接、清晰的指令 |

**Temperature 按任务类型配置**:

| 任务类型 | Temperature | 理由 |
|:--|:--:|:--|
| `reason` (Agent A-F) | **1.0** | 复杂推理任务，低于此值可能导致循环或性能下降 |
| `standardizeClassify` | 0.3 | 标准化任务需要高确定性，减少随机变化 |
| `enrich` | 0.5 | 别名生成需要适度创造性，但保持相关性 |
| `ground` | 0.3 | 事实核查需要高确定性和准确性 |

**Gemini 3 提示核心原则**:
1. **用词准确、直接**: 避免不必要或过于说服性的语言
2. **使用一致的结构**: XML 样式标记（`<context>`、`<task>`）或 Markdown 标题
3. **定义模糊术语**: 明确说明任何模棱两可的参数
4. **优先处理关键指令**: 将行为约束、角色定义放在系统指令或提示最开头
5. **长上下文结构**: 先提供所有上下文，将具体指令或问题放在提示末尾
6. **锚定上下文**: 使用 "根据上述信息..." 连接上下文和查询

### 1.7 知识类型约束

> **与 PRD A2 公理同步**: 知识节点必须且只能属于 6 种类型之一。

| 类型 | 英文 | 判定标准 | 可深化 | 可合成 |
|:-- |:-- |:-- |:--: |:--: |
| 领域 | Domain | 可独立存在的知识边界，可 MECE 分解 | ✓ → Issue | — |
| 议题 | Issue | 领域的问题空间，存在核心矛盾 (X vs Y) | ✓ → Theory | — |
| 理论 | Theory | 从公理出发的逻辑推演体系 | ✓ → Entity/Mechanism | — |
| 实体 | Entity | 定义时不需引用时间/过程，静态对象 | — | — |
| 机制 | Mechanism | 定义中必须包含状态变化或因果链 | — | ✓ → Principle |
| 原理 | Principle | IF-THEN 形式，从 ≥2 个机制抽象的结构不变量 | — | — |

**关键约束**:
- **Principle 仅通过合成产生**: `standardizeClassify` 任务的类型推断范围为 Domain/Issue/Theory/Entity/Mechanism（5 种），Principle 不在推断范围内。
- **终端节点**: Entity、Mechanism（无深化）、Principle（无深化无合成）为终端节点。

## 2. 全局系统指令

**文件**: `prompts/system_core.md`
**注入方式**: 作为所有 agent 调用的 `system_instruction`
**设计原则**: 遵循 PRD G2 目标（最大化信息密度）——每个笔记必须自足完备。

> **KV 缓存优化**: 本节内容作为稳定前缀，应保持不变以最大化缓存命中率。

```markdown
<role>
You are the "Cognitive Razor," an axiomatic logic engine.
You compile information into strictly typed Knowledge Graph nodes.
You are NOT a creative writer. You are a logic compiler.

Your outputs must satisfy:
- G2 (Information Density): Each note must be self-contained; readers should fully understand the concept without navigating to other notes.
- A1 (Semantic Uniqueness): Avoid generating content that duplicates existing nodes in the knowledge base.
</role>

<thinking_protocol>
Before generating output, you MUST:

1. PLAN: Silently enumerate the sub-tasks required
2. EXECUTE: Process each sub-task in order
3. VALIDATE: Check output against completeness requirements
4. SELF_CRITIQUE: Identify potential weaknesses and address them
5. FORMAT: Serialize into required JSON schema

Record your reasoning trace in _thought_trace field.
</thinking_protocol>

<knowledge_types>
You work with exactly 6 knowledge types:

| Type | Chinese | Definition | Can Deepen To | Can Synthesize To |
|:--|:--|:--|:--|:--|
| Domain | 领域 | Knowledge boundary, decomposable via MECE | Issue | — |
| Issue | 议题 | Problem space with core tension (X vs Y) | Theory | — |
| Theory | 理论 | Axiomatic system with logical derivations | Entity, Mechanism | — |
| Entity | 实体 | Static concept, defined without time/process | — | — |
| Mechanism | 机制 | Dynamic process with state change or causal chain | — | Principle |
| Principle | 原理 | IF-THEN invariant abstracted from ≥2 mechanisms | — | — |

CRITICAL: Principle can ONLY be created via synthesis from ≥2 Mechanisms.
It is NEVER inferred from user input or created directly.
</knowledge_types>

<deduplication_protocol>
When {{vault_index}} is provided:
1. SCAN: Check for semantically similar nodes (threshold: {{dedup_threshold}})
2. REUSE: Reference existing nodes via [[wikilink]] instead of regenerating
3. DIFFERENTIATE: If creating similar content, explicitly state the distinction
4. RECORD: Note deduplication decisions in _thought_trace
</deduplication_protocol>

<language_rules>
1. Output Language: {{output_language}}
    - zh-CN: 简体中文
    - en: English
2. Term Naming: Apply {{naming_template}} or default to `中文术语 (English Term)` format.
   Example: `纳什均衡 (Nash Equilibrium)`
3. Math Formulas: Use LaTeX `$...$` for inline, `$$...$$` for blocks.
4. No Markdown Headers inside JSON string values.
5. Use Obsidian wikilinks `[[Name]]` for cross-references within content fields.
</language_rules>

<forbidden>
NEVER produce:
- Qualitative adjectives without quantification: "重要", "核心", "关键"
- Circular definitions: defining X using X or synonyms
- Metaphors without mechanism explanation
- "Emergence" without micro-mechanism detail
- Filler text: no greetings, no self-references outside _thought_trace
- Creating content that semantically duplicates existing nodes in {{vault_index}}
- Incomplete JSON or malformed output
- Content outside the JSON structure
</forbidden>

<output_format>
Return VALID JSON ONLY.
Do not wrap in markdown code blocks.
All string fields must be properly escaped.
The _thought_trace field should contain your reasoning process.
</output_format>

<error_handling>
If you encounter ambiguity or insufficient context:
1. State the ambiguity explicitly in _thought_trace
2. Make a reasonable assumption and document it
3. Continue with the task rather than refusing
4. Flag uncertainty in the output metadata if schema allows
</error_handling>
```

## 3. L2-Pre 标准化器 (standardizeClassify)

**文件**: `prompts/l2_pre_standardizer.md`
**模型**: gemini-2.5-flash
**任务 ID**: `standardizeClassify`
**用途**: 将用户输入标准化为元数据，并推断知识类型，同时返回所有类型的置信度列表和消歧义选项（单次 API 调用完成）

> **与 PRD 同步**: 对应 PRD 4.5 数据流中的「标准化 + 类型推断」阶段。
>
> **设计原则**: 标准化器应始终返回完整的类型置信度分布和消歧义选项，而非仅在低置信度时才返回。这确保系统和用户始终能看到完整的类型判断依据，提高透明度和可解释性。

### 3.1 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{user_input}}` | string | 用户原始输入 |
| `{{naming_template}}` | string | 命名模板，默认 `{{chinese}} ({{english}})` |

### 3.2 Prompt 模板

```markdown
Task: Standardize input term into canonical metadata, infer knowledge type, and provide type confidence distribution with disambiguation options.

Input: "{{user_input}}"
Naming Template: {{naming_template}}

<type_inference_rules>
Infer type from [Domain, Issue, Theory, Entity, Mechanism] and provide confidence scores for ALL types.

| Type | Key Indicators |
|:--|:--|
| Domain | "学科", "领域", "方向", boundary words like "研究范围" |
| Issue | "问题", "争议", "矛盾", tension words like "X vs Y" |
| Theory | "理论", "学说", "模型", "框架", axiom/derivation indicators |
| Entity | Nouns that can be defined without time/process, static concepts |
| Mechanism | Process words: "过程", "机制", "如何", causal chain indicators |

NOTE: If the input contains words like "原理", "定律", "法则", "公理", classify it as Theory or Mechanism based on context. Principle type can ONLY be created through mechanism synthesis.
</type_inference_rules>

<disambiguation_rules>
ALWAYS generate natural language disambiguation options for the top candidate types.

For each type with confidence > 0.1, provide:
1. technical_type: The formal type name
2. natural_label: User-friendly label (e.g., "一个过程/机制" vs "一个静态概念")
3. natural_description: Plain language description helping user understand the distinction
4. examples: 3 concrete examples from similar domains

Common Ambiguity Pairs to highlight:
- Entity vs Mechanism: "Is it defined by WHAT it is, or HOW it works?"
- Issue vs Theory: "Is it a QUESTION or an ANSWER?"
- Domain vs Theory: "Is it a FIELD or a specific FRAMEWORK within a field?"
</disambiguation_rules>

<rules>
1. Standard Name: Apply naming template. Default: `中文术语 (English Term)`
2. Primary Type: Choose ONE from [Domain, Issue, Theory, Entity, Mechanism] as the recommended type
3. Confidence Distribution: Provide confidence scores (0.0-1.0) for ALL 5 types, must sum to 1.0
4. Disambiguation Options: ALWAYS include options for types with confidence > 0.1
</rules>

Output:
{
  "standard_name": "string",
  "chinese_term": "string", 
  "english_term": "string",
  "primary_type": "Domain|Issue|Theory|Entity|Mechanism",
  "reasoning": "string (brief explanation of type inference)",
  "type_confidences": [
    { "type": "Domain", "confidence": 0.0-1.0 },
    { "type": "Issue", "confidence": 0.0-1.0 },
    { "type": "Theory", "confidence": 0.0-1.0 },
    { "type": "Entity", "confidence": 0.0-1.0 },
    { "type": "Mechanism", "confidence": 0.0-1.0 }
  ],
  "disambiguation_options": [
    {
      "technical_type": "Entity",
      "confidence": 0.0-1.0,
      "natural_label": "一个静态概念/事物",
      "natural_description": "可以用'是什么'来定义，不涉及时间或变化过程",
      "examples": ["细胞", "原子", "纳什均衡点"]
    }
  ]
}
```

### 3.3 类型消歧义说明

> **设计变更**: 类型消歧义功能已完全整合到 `standardizeClassify` 任务中，不再作为独立的二次调用。
>
> **取消的设计**: 原来的 `confidence < 0.7` 触发条件已被移除。新设计始终返回完整的类型置信度分布和消歧义选项，确保：
> 1. **透明性**: 用户始终能看到系统对各类型的判断依据
> 2. **灵活性**: 前端可根据置信度分布自行决定 UI 展示策略
> 3. **一致性**: 无论推断置信度高低，返回结构保持一致

**前端 UI 策略建议**：
- 当 `primary_type` 的置信度 >= 0.8 时：仅显示推荐类型，消歧义选项折叠显示
- 当置信度在 0.5-0.8 之间时：默认展开消歧义选项，引导用户确认
- 当置信度 < 0.5 时：强制显示消歧义选项，要求用户选择

**文件**: `prompts/l2_pre_disambiguation.md` 已合并到 `l2_pre_standardizer.md`，不再作为独立文件。

### 3.4 输出 Schema

```typescript
interface StandardizeClassifyOutput {
  standard_name: string;
  chinese_term: string;
  english_term: string;
  primary_type: "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";  // Principle 不在此列
  reasoning: string;
  // 完整的类型置信度分布，始终返回所有 5 种类型的置信度
  type_confidences: Array<{
    type: "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";
    confidence: number;  // 0.0-1.0，所有类型的 confidence 之和为 1.0
  }>;
  // 消歧义选项，始终返回（至少包含 primary_type）
  disambiguation_options: Array<{
    technical_type: string;
    confidence: number;
    natural_label: string;
    natural_description: string;
    examples: string[];
  }>;
}
```

## 3.5 L2-Pre 别名/标签生成 (enrich)

**文件**: `prompts/l2_pre_enrich.md`
**模型**: gemini-2.5-flash
**任务 ID**: `enrich`
**用途**: 为已标准化的概念生成搜索友好的别名和分类标签

> **与 PRD 同步**: 对应 PRD 4.5 数据流中的「生成别名/标签」阶段，在创建 Stub 之前执行。

### 3.5.1 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{standard_name}}` | string | 标准化后的概念名称 |
| `{{chinese_term}}` | string | 中文术语 |
| `{{english_term}}` | string | 英文术语 |
| `{{type}}` | string | 推断的知识类型 |
| `{{existing_aliases}}` | JSON | vault 中已有的别名（用于避免冲突）|

### 3.5.2 Prompt 模板

```markdown
Task: Generate search-friendly aliases and classification tags for a knowledge concept.

Input Concept:
- Standard Name: "{{standard_name}}"
- Chinese Term: "{{chinese_term}}"
- English Term: "{{english_term}}"
- Type: {{type}}

Existing Aliases in Vault (avoid duplicates):
{{existing_aliases}}

<alias_generation_rules>
Generate 3-8 aliases that maximize search recall:

1. **Abbreviations**: Common acronyms or shortened forms
   - Example: "人工智能 (Artificial Intelligence)" → ["AI", "人工智能", "A.I."]

2. **Synonyms**: Alternative names with same meaning
   - Example: "机器学习 (Machine Learning)" → ["ML", "统计学习"]

3. **Transliterations**: Phonetic variants
   - Example: "博弈论 (Game Theory)" → ["赛局理论", "对策论"]

4. **Historical Names**: Older or alternative academic terms
   - Example: "计算机科学 (Computer Science)" → ["电脑科学", "计算科学"]

5. **Domain-Specific Variants**: Field-specific terminology
   - Example: "纳什均衡 (Nash Equilibrium)" → ["纳什平衡", "纳什均衡点", "NE"]

AVOID:
- Aliases that conflict with existing_aliases
- Overly generic terms that would cause false matches
- Aliases longer than the standard name
</alias_generation_rules>

<tag_generation_rules>
Generate 2-5 hierarchical classification tags:

1. **Root Domain**: Top-level academic field
   - Format: `domain/subfield` or `domain`
   - Example: "博弈论" → ["economics", "mathematics/game-theory"]

2. **Concept Category**: Type-based classification
   - Format: `cr-type/{{type}}`
   - Always include this tag

3. **Cross-References**: Related fields or applications
   - Example: "纳什均衡" → ["economics/microeconomics", "strategy"]

Tag Format: lowercase, use hyphens for multi-word, use slashes for hierarchy
</tag_generation_rules>

Output:
{
  "aliases": ["string"],
  "tags": ["string"],
  "alias_reasoning": "string (brief explanation of alias choices)",
  "tag_reasoning": "string (brief explanation of tag hierarchy)"
}
```

### 3.5.3 输出 Schema

```typescript
interface EnrichOutput {
  aliases: string[];          // 3-8 个搜索友好的别名
  tags: string[];             // 2-5 个分类标签
  alias_reasoning: string;    // 别名选择的简要说明
  tag_reasoning: string;      // 标签层级的简要说明
}
```

### 3.5.4 调用配置

```typescript
const enrichConfig: GenerateContentConfig = {
  generationConfig: {
    temperature: 0.5,  // 适度创造性
    topP: 0.9,
    maxOutputTokens: 1024,
    responseMimeType: "application/json"
  }
};
```

## 4. L3 Agent Prompts

> **设计原则**: 与 PRD 4.3 Agent 体系保持一致。所有 Agent 使用 `reason` 任务配置（默认 gemini-3.0-pro，thinking_level: "high"）。

### 4.0 Agent 体系概览

> **推理模式**: 所有 Agent 使用 Gemini 3 的 thinking 模式（thinking_level: "high"），遵循 "计划 → 执行 → 验证 → 格式化" 的工作流。

| Agent ID | 名称 | 对应知识类型 | 职责 |
|:--:|:--:|:--:|:--|
| **Agent A** | 领域制图师 (Cartographer) | Domain | 生成领域型笔记，绘制领域地图，识别子领域和核心议题 |
| **Agent B** | 矛盾侦探 (Detective) | Issue | 生成议题型笔记，分析议题结构，挖掘核心张力，列举相关理论 |
| **Agent C** | 理论解构者 (Deconstructor) | Theory | 生成理论型笔记，解构理论逻辑，提取实体和机制 |
| **Agent D** | 实体生成器 (Entity Generator) | Entity | 生成实体型笔记，定义静态概念的本质、分类和属性 |
| **Agent E** | 机制生成器 (Mechanism Generator) | Mechanism | 生成机制型笔记，描述动态过程的因果链和触发条件 |
| **Agent F** | 原理合成器 (Synthesizer) | Principle | 分析多个机制，抽象出同构的原理（仅通过合成触发）|

**Agent 调用通用参数**:
```typescript
{
  model: "gemini-3.0-pro",
  thinking: { thinkingBudget: 8192 },  // 或使用 thinking_level: "high"
  temperature: 1.0,  // CRITICAL: 必须为 1.0
  responseMimeType: "application/json"
}
```

### 4.1 Agent A: 领域制图师 (Domain Cartographer)

**文件**: `prompts/l3_agent_a_domain.md`
**模型**: gemini-3.0-pro (thinking_level: "high")
**用途**: 生成 Domain 类型笔记的完整内容

#### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{domain_name}}` | string | 领域规范名称 |
| `{{vault_index}}` | JSON | 同类型（Domain）相似节点列表 |
| `{{dedup_threshold}}` | number | 去重阈值，默认 0.9 |

#### Prompt 模板

```markdown
<context>
Target Domain: "{{domain_name}}"

Existing Domain Nodes (for deduplication and cross-referencing):
{{vault_index}}

Deduplication Threshold: {{dedup_threshold}}
</context>

<task>
Construct a holographic map of this domain.

根据上述信息，执行以下步骤:

STEP 1 - PLAN:
- Define the domain's logical boundaries
- Identify authoritative classification sources (top textbooks, academic society taxonomies)
- Determine decomposition dimensions (by object, method, application, or hybrid)

STEP 2 - EXECUTE:
- Generate content for each required field
- Extract sub-domains and core issues
- Cross-reference {{vault_index}} to use [[wikilinks]] for existing concepts

STEP 3 - VALIDATE:
- Verify no circular definitions
- Ensure issue completeness: Domain Issues = Σ(Sub-domain Issues) + Emergent Issues
- CRITICAL: The `issues` list must STRICTLY contain ONLY emergent/cross-cutting issues that cannot be covered by a single sub-domain. DO NOT list issues that belong to specific sub-domains.
- Check deduplication against existing nodes

STEP 4 - SELF_CRITIQUE:
- Are there missing sub-domains in this classification?
- Are the boundaries clearly delineated?
- Is each issue properly attributed to a sub-domain?
</task>

<completeness_requirements>
Per PRD 3.2.1, to fully understand a Domain, the following questions MUST be answered:
1. What does it study? (definition)
2. Why does it exist? (teleology)
3. How does it validate knowledge? (methodology)
4. Where did it come from? (historical_genesis)
5. What are its boundaries? (boundaries)
6. What are its core issues? (issues)
</completeness_requirements>

<sub_domain_rules>
If the domain is NOT atomic:
1. DIMENSION: Explicitly state the classification dimension(s) used
2. EXHAUSTIVENESS OVER EXCLUSIVITY: It is far worse to OMIT a sub-domain than to have overlapping ones
3. AUTHORITATIVE VALIDATION: Anchor decomposition to recognized authority (cite sources)
4. CROSS-DISCIPLINARY: Interdisciplinary fields may appear under multiple parents
</sub_domain_rules>

<output_schema>
{
  "_thought_trace": "string (reasoning process including plan, execution notes, validation results, self-critique)",
  "metadata": { 
    "name": "string", 
    "type": "Domain" 
  },
  "content": {
    "definition": "string (What does this field study?)",
    "teleology": "string (What questions does it answer? What needs does it address?)",
    "methodology": "string (How does it produce and validate knowledge?)",
    "historical_genesis": "string (When, why, how did it emerge?)",
    "boundaries": "string (What does it NOT study? Adjacent field boundaries?)",
    "holistic_understanding": "string (Free-form synthesis integrating all above)"
  },
  "issues": [
    { 
      "name": "string (use [[wikilink]] format)", 
      "core_tension": "string (X vs Y format)",
      "significance": "string"
    }
  ],
  "structure": {
    "is_atomic": boolean,
    "atomic_reason": "string | null",
    "decomposition_dimension": "string | null",
    "authoritative_source": "string | null",
    "sub_domains": [
      { 
        "name": "string (use [[wikilink]] format)", 
        "rationale": "string", 
        "brief_description": "string",
        "cross_disciplinary": boolean
      }
    ]
  },
  "related_domains": [
    { 
      "name": "string", 
      "relation_type": "PARENT|SIBLING|CHILD|INTERSECTS|APPLIES_TO", 
      "relation_description": "string" 
    }
  ]
}
</output_schema>
```

### 4.2 Agent B: 矛盾侦探 (Issue Detective)

**文件**: `prompts/l3_agent_b_issue.md`
**模型**: gemini-3.0-pro (thinking_level: "high")
**用途**: 生成 Issue 类型笔记的完整内容

#### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{issue_name}}` | string | 议题规范名称 |
| `{{parent_uid}}` | string | 父节点 UID（若通过深化产生）|
| `{{parent_context}}` | string | 父领域上下文摘要 |
| `{{vault_index}}` | JSON | 同类型（Issue）相似节点列表 |
| `{{dedup_threshold}}` | number | 去重阈值，默认 0.9 |

#### Prompt 模板

```markdown
<context>
Target Issue: "{{issue_name}}"
Parent Context: "{{parent_context}}"

Existing Issue Nodes (for deduplication and cross-referencing):
{{vault_index}}

Deduplication Threshold: {{dedup_threshold}}
</context>

<task>
Excavate the roots of this issue and map the theoretical landscape.

根据上述信息，执行以下步骤:

STEP 1 - PLAN:
- Identify what makes this a genuine issue (not just a question)
- Determine the opposing forces or perspectives
- Enumerate theories that address this issue

STEP 2 - EXECUTE:
- Formulate core contradiction in X vs Y format
- Trace the causal chain to issue recognition
- Generate content for each required field
- Cross-reference {{vault_index}} to use [[wikilinks]] for existing concepts

STEP 3 - VALIDATE:
- Verify core_tension is in X vs Y format
- Verify all listed theories actually address this issue
- Check each theory has premise, solution, and limitations

STEP 4 - SELF_CRITIQUE:
- Is the core tension truly fundamental, or a surface symptom?
- Are there missing theoretical perspectives?
- Are the stakeholder perspectives comprehensive?
</task>

<completeness_requirements>
Per PRD 3.2.2, to fully understand an Issue, the following questions MUST be answered:
1. What is the core contradiction? (core_tension)
2. Why is this a problem? (significance)
3. Who cares about this problem? (stakeholder_perspectives)
4. When is this NOT a problem? (boundary_conditions)
5. What solutions have been attempted? (theories)
</completeness_requirements>

<output_schema>
{
  "_thought_trace": "string (reasoning process including plan, execution notes, validation results, self-critique)",
  "metadata": { 
    "name": "string", 
    "type": "Issue" 
  },
  "content": {
    "core_tension": "string (MUST be X vs Y format)",
    "significance": "string (Why is this important? Impact scope?)",
    "historical_genesis": "string (When identified? What triggered it?)",
    "structural_analysis": "string (Decompose into sub-problems)",
    "stakeholder_perspectives": "string (How do different parties view this?)",
    "boundary_conditions": "string (When does this issue NOT apply?)",
    "holistic_understanding": "string (Free-form synthesis)"
  },
  "theories": [
    {
      "name": "string (use [[wikilink]] format)",
      "status": "Mainstream|Fringe|Falsified",
      "premise": "string",
      "proposed_solution": "string",
      "limitations": "string"
    }
  ],
  "related_issues": [
    { 
      "name": "string", 
      "relation_type": "CAUSES|CAUSED_BY|SIMILAR_TO|OPPOSITE_OF|SUBSUMES|SUBSUMED_BY", 
      "relation_description": "string" 
    }
  ]
}
</output_schema>
```

### 4.3 Agent C: 理论解构者 (Theory Deconstructor)

**文件**: `prompts/l3_agent_c_theory.md`
**模型**: gemini-3.0-pro (thinking_level: "high")
**用途**: 生成 Theory 类型笔记，解构理论并提取 Entity/Mechanism

#### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{theory_name}}` | string | 理论规范名称 |
| `{{parent_uid}}` | string | 父节点 UID（若通过深化产生）|
| `{{parent_context}}` | string | 父议题上下文摘要 |
| `{{vault_index}}` | JSON | 同类型（Theory）+ Entity + Mechanism 相似节点列表 |
| `{{dedup_threshold}}` | number | 去重阈值，默认 0.9 |

#### Prompt 模板

```markdown
<context>
Target Theory: "{{theory_name}}"
Parent Context: "{{parent_context}}"

Existing Nodes (for deduplication and cross-referencing):
{{vault_index}}

Deduplication Threshold: {{dedup_threshold}}
</context>

<task>
Reconstruct logic, deconstruct into components, deduplicate.

根据上述信息，执行以下步骤:

STEP 1 - PLAN:
- Parse theory into axiomatic foundations
- Identify the logical derivation structure
- Enumerate ALL entities and mechanisms to extract

STEP 2 - EXECUTE:
- Exhaustively extract ALL entities and mechanisms defined or used by this theory
- For EACH component, compare against vault_index for deduplication
- Generate content for each required field
- Cross-reference {{vault_index}} to use [[wikilinks]] for existing concepts

STEP 3 - VALIDATE:
- Verify argument chain is complete and logically valid
- Verify each component is correctly classified as Entity or Mechanism
- Check deduplication status for all components

STEP 4 - SELF_CRITIQUE:
- Are there hidden assumptions not listed as axioms?
- Are there components that could be further decomposed?
- Is the Entity vs Mechanism classification correct for each component?
</task>

<completeness_requirements>
Per PRD 3.2.3, to fully understand a Theory, the following questions MUST be answered:
1. What are its foundational assumptions? (axioms)
2. How does it derive conclusions? (argument_chain)
3. What testable predictions does it make? (core_predictions)
4. Where does it apply? (scope_and_applicability)
5. What are its known weaknesses? (limitations)
6. What entities/mechanisms does it define? (extracted_components)
</completeness_requirements>

<component_extraction_rules>
1. EXHAUSTIVENESS OVER EXCLUSIVITY: Better to over-extract than to miss components
2. Entity vs Mechanism distinction:
   - Entity: Can be defined WITHOUT referencing time/process/change
   - Mechanism: Definition MUST include state change or causal chain
3. Role clarity: Every component must explain its role in the theory
4. Deduplication: Compare each component against vault_index. If similarity >= threshold, mark as EXISTING
</component_extraction_rules>

<output_schema>
{
  "_thought_trace": "string (reasoning process including plan, execution notes, validation results, self-critique)",
  "metadata": { 
    "name": "string", 
    "type": "Theory" 
  },
  "content": {
    "axioms": [
      { "statement": "string", "justification": "string" }
    ],
    "argument_chain": "string (complete derivation with logical connectives: 因此/所以/若...则...)",
    "core_predictions": "string (testable predictions)",
    "scope_and_applicability": "string (where does it apply?)",
    "limitations": "string (known weaknesses, unexplained phenomena)",
    "historical_development": "string (origins and evolution)",
    "holistic_understanding": "string (free-form synthesis)"
  },
  "extracted_components": [
    {
      "name": "string (use [[wikilink]] format)",
      "category": "Entity|Mechanism",
      "status": "NEW|EXISTING",
      "existing_uid": "string|null (if EXISTING)",
      "match_reason": "string (if EXISTING, explain semantic equivalence)",
      "definition": "string (REQUIRED if NEW)",
      "role_in_theory": "string"
    }
  ],
  "related_theories": [
    { 
      "name": "string", 
      "relation_type": "EXTENDS|CONTRADICTS|SUBSUMES|SUBSUMED_BY|COMPLEMENTS|ALTERNATIVE_TO", 
      "relation_description": "string" 
    }
  ]
}
</output_schema>
```

#### 组件去重判定逻辑

```
对每个 extracted_component:
  IF vault_index 中存在 similarity >= dedup_threshold 的同类型节点:
    status = "EXISTING"
    existing_uid = 匹配节点的 uid
    match_reason = 解释为何语义等价
    definition = 省略（使用已有定义）
  ELSE:
    status = "NEW"
    existing_uid = null
    definition = 完整定义（必填）
```

### 4.4 Agent D: 实体生成器 (Entity Generator)

**文件**: `prompts/l3_agent_d_entity.md`
**模型**: gemini-3.0-pro (thinking_level: "high")
**用途**: 生成 Entity 类型笔记，定义静态概念

#### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{entity_name}}` | string | 实体规范名称 |
| `{{parent_uid}}` | string | 父节点 UID（若通过 Theory 深化产生）|
| `{{parent_context}}` | string | 上下文（父 Theory 摘要）|
| `{{vault_index}}` | JSON | 同类型（Entity）相似节点列表 |
| `{{dedup_threshold}}` | number | 去重阈值，默认 0.9 |

#### Prompt 模板

```markdown
<context>
Target Entity: "{{entity_name}}"
Parent Context: "{{parent_context}}"

Existing Entity Nodes (for deduplication and cross-referencing):
{{vault_index}}

Deduplication Threshold: {{dedup_threshold}}
</context>

<task>
Define this static concept (Entity).

根据上述信息，执行以下步骤:

STEP 1 - PLAN:
- Verify this is a static object/concept, NOT a process
- Identify genus (classification) and differentia (distinguishing features)
- Plan property enumeration strategy

STEP 2 - EXECUTE:
- Formulate definition using genus + differentia format
- List essential properties with measurement methods
- Generate examples and counter-examples
- Cross-reference {{vault_index}} to use [[wikilinks]] for existing concepts

STEP 3 - VALIDATE:
- Verify definition does NOT include time/process/change
- Verify properties are measurable or observable
- Check examples truly belong, counter-examples truly don't

STEP 4 - SELF_CRITIQUE:
- Is this actually an Entity, or is it a Mechanism in disguise?
- Are there missing essential properties?
- Is the genus at the right level of abstraction?
</task>

<completeness_requirements>
Per PRD 3.2.4, to fully understand an Entity, the following questions MUST be answered:
1. What is it? (definition - using genus + differentia)
2. What category does it belong to? (classification)
3. What are its attributes? (properties)
4. How is it different from similar things? (distinguishing_features)
5. What are examples and counter-examples? (examples, counter_examples)
</completeness_requirements>

<output_schema>
{
  "_thought_trace": "string (reasoning process including plan, execution notes, validation results, self-critique)",
  "metadata": { 
    "name": "string", 
    "type": "Entity" 
  },
  "content": {
    "definition": "string (genus + differentia format)",
    "classification": "string (what category? relation to siblings?)",
    "properties": [
      {
        "name": "string",
        "description": "string",
        "possible_values": "string",
        "measurement": "string"
      }
    ],
    "distinguishing_features": "string (key differences from similar concepts)",
    "examples": ["string (典型实例)"],
    "counter_examples": ["string (易混淆但不属于此实体的实例)"],
    "holistic_understanding": "string (free-form synthesis)"
  },
  "relations": {
    "is_a": ["string (上位类, use [[wikilink]])"],
    "has_parts": ["string (组成部分, use [[wikilink]])"],
    "related_to": ["string (相关概念, use [[wikilink]])"]
  }
}
</output_schema>
```

### 4.5 Agent E: 机制生成器 (Mechanism Generator)

**文件**: `prompts/l3_agent_e_mechanism.md`
**模型**: gemini-3.0-pro (thinking_level: "high")
**用途**: 生成 Mechanism 类型笔记，描述动态过程

#### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{mechanism_name}}` | string | 机制规范名称 |
| `{{parent_uid}}` | string | 父节点 UID（若通过 Theory 深化产生）|
| `{{parent_context}}` | string | 上下文（父 Theory 摘要）|
| `{{vault_index}}` | JSON | 同类型（Mechanism）+ Entity 相似节点列表 |
| `{{dedup_threshold}}` | number | 去重阈值，默认 0.9 |

#### Prompt 模板

```markdown
<context>
Target Mechanism: "{{mechanism_name}}"
Parent Context: "{{parent_context}}"

Existing Nodes (for deduplication and cross-referencing):
{{vault_index}}

Deduplication Threshold: {{dedup_threshold}}
</context>

<task>
Describe this dynamic process (Mechanism).

根据上述信息，执行以下步骤:

STEP 1 - PLAN:
- Verify this involves state change or causal chain
- Identify the key actors and resources involved
- Plan the causal chain decomposition strategy

STEP 2 - EXECUTE:
- Identify triggers and termination conditions
- Map the step-by-step causal chain (minimum 2 steps)
- Document inputs and outputs
- Cross-reference {{vault_index}} to use [[wikilinks]] for existing concepts

STEP 3 - VALIDATE:
- Verify definition includes state change or causal chain
- Verify causal_chain has at least 2 steps
- Verify operates_on has at least 1 Entity

STEP 4 - SELF_CRITIQUE:
- Is this actually a Mechanism, or is it an Entity in disguise?
- Are there missing steps in the causal chain?
- Is the granularity appropriate (not too coarse, not too fine)?
</task>

<completeness_requirements>
Per PRD 3.2.5, to fully understand a Mechanism, the following questions MUST be answered:
1. What process is this? (definition)
2. What triggers it? (trigger_conditions)
3. How does it proceed step by step? (causal_chain - minimum 2 steps)
4. When does it terminate? (termination_conditions)
5. What does it operate on? What does it produce? (inputs, outputs)
</completeness_requirements>

<output_schema>
{
  "_thought_trace": "string (reasoning process including plan, execution notes, validation results, self-critique)",
  "metadata": { 
    "name": "string", 
    "type": "Mechanism" 
  },
  "content": {
    "definition": "string (what process is this?)",
    "trigger_conditions": "string (what starts it?)",
    "causal_chain": [
      { "step": 1, "action": "string", "result": "string" },
      { "step": 2, "action": "string", "result": "string" }
    ],
    "termination_conditions": "string (when does it stop?)",
    "inputs": ["string (required resources/conditions)"],
    "outputs": ["string (produced results/effects)"],
    "process_description": "string (narrative description of entire process)",
    "examples": ["string (典型应用场景)"],
    "holistic_understanding": "string (free-form synthesis)"
  },
  "relations": {
    "operates_on": ["string (作用对象 Entity, use [[wikilink]], ≥1)"],
    "produces": ["string (产出 Entity/状态, use [[wikilink]])"],
    "requires": ["string (依赖的其他 Mechanism, use [[wikilink]])"],
    "inhibited_by": ["string (抑制因素)"]
  }
}
</output_schema>
```

> **终端性说明**: Mechanism 是终端叶节点，无深化操作。但 Mechanism 可参与**合成操作**，与其他 Mechanism 一起生成 Principle（见 Agent F）。

### 4.6 Agent F: 原理合成器 (Principle Synthesizer)

**文件**: `prompts/l3_agent_f_principle.md`
**模型**: gemini-3.0-pro (thinking_level: "high")
**用途**: 从多个 Mechanism 中合成 Principle（唯一创建 Principle 的途径）

> **关键约束**: Principle 只能通过此合成流程创建，不能通过普通创建或类型推断产生。这确保了 Principle 必然是跨机制抽象的结构不变量。

#### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{input_mechanisms}}` | JSON | 用户选中的 Mechanism 列表（≥2 个）|
| `{{vault_index}}` | JSON | 已有 Principle 节点列表（用于去重检查）|
| `{{dedup_threshold}}` | number | 去重阈值，默认 0.9 |

#### 前置校验

```typescript
// 系统在调用 Agent F 前必须校验：
if (input_mechanisms.length < 2) {
  throw new Error("合成原理需要至少 2 个不同的 Mechanism");
}

// 检查是否已存在相同来源组合的 Principle
const existingPrinciple = checkDuplicateSourceCombination(input_mechanisms);
if (existingPrinciple) {
  // 提示用户打开已有 Principle，阻止重复合成
  return { action: "OPEN_EXISTING", uid: existingPrinciple.uid };
}
```

#### Prompt 模板

```markdown
<context>
Input Mechanisms (to synthesize from):
{{input_mechanisms}}

Existing Principle Nodes (for deduplication):
{{vault_index}}

Deduplication Threshold: {{dedup_threshold}}
</context>

<task>
Distill a universal Principle from these mechanisms.

根据上述信息，执行以下步骤:

STEP 1 - PLAN:
- Identify structural patterns common to ALL input mechanisms
- Determine abstraction strategy (what becomes a variable?)
- Assess feasibility of genuine cross-domain invariant

STEP 2 - EXECUTE:
- Identify structural invariants across ALL input mechanisms
- Abstract domain-specific parameters to generic variables
- Formulate as IF-THEN statement
- Check against existing Principles to avoid duplication

STEP 3 - VALIDATE:
- Verify principle applies to ALL input mechanisms, not just some
- Verify variables are genuinely domain-independent
- Verify formal_statement is in IF-THEN format

STEP 4 - SELF_CRITIQUE:
- Is this a genuine structural invariant, or a superficial similarity?
- Could the abstraction be more general without losing meaning?
- Are there edge cases where this principle fails?

If no genuine structural invariant exists across mechanisms, output status="NO_PRINCIPLE_FOUND" with explanation.
</task>

<completeness_requirements>
Per PRD 3.2.6, to fully understand a Principle, the following questions MUST be answered:
1. What is its formal statement? (formal_statement - IF-THEN format)
2. What do the variables represent? (variables)
3. Under what conditions does it hold? (scope_and_constraints)
4. How does it manifest in different domains? (isomorphism_analysis)
5. What new phenomena can it predict? (predictive_power)
</completeness_requirements>

<synthesis_rules>
1. The principle MUST be abstractable from ALL input mechanisms
2. Variables MUST be domain-independent (e.g., "资源R" not "ATP")
3. If no genuine structural invariant exists, output status="NO_PRINCIPLE_FOUND"
4. The formal_statement MUST be in "若[条件], 则[结果]" format
</synthesis_rules>

<output_schema>
{
  "_thought_trace": "string (reasoning process including plan, execution notes, validation results, self-critique)",
  "status": "SUCCESS|NO_PRINCIPLE_FOUND",
  "no_principle_reason": "string | null (if status=NO_PRINCIPLE_FOUND)",
  "metadata": { 
    "name": "string (generated principle name)", 
    "type": "Principle" 
  },
  "content": {
    "formal_statement": "string (若[条件], 则[结果] format)",
    "mathematical_form": "string | null (LaTeX expression if applicable)",
    "variables": {
      "$X$": "string (meaning of variable X)",
      "$Y$": "string (meaning of variable Y)"
    },
    "scope_and_constraints": "string (when does this principle hold?)",
    "isomorphism_analysis": "string (how does it manifest in each source mechanism?)",
    "predictive_power": "string (what new phenomena can it predict? new application domains?)",
    "historical_precedents": "string | null (has this been recognized under other names?)",
    "holistic_understanding": "string (free-form synthesis)"
  },
  "source_mechanisms": [
    { 
      "uid": "string",
      "name": "string (use [[wikilink]] format)", 
      "domain": "string", 
      "variable_mapping": "string (how abstract vars map to this mechanism)"
    }
  ],
  "related_principles": [
    { 
      "name": "string", 
      "relation_type": "GENERALIZES|SPECIALIZES|DUAL_OF|ANALOGOUS_TO|CONTRADICTS", 
      "relation_description": "string" 
    }
  ]
}
</output_schema>
```

#### 合成流程说明

```
1. 用户在侧边栏选择 ≥2 个 Mechanism 类型笔记（仅 Draft/Evergreen 状态可选）
2. 系统校验来源组合是否已有对应 Principle
3. 系统调用 Agent F，传入选中 Mechanism 的完整内容
4. Agent F 分析同构性，生成 Principle 内容
5. 若 status="NO_PRINCIPLE_FOUND"，向用户展示原因，建议选择其他 Mechanism
6. 若 status="SUCCESS"：
   a. 系统对生成的 Principle 名称进行向量检索和精确匹配检查
   b. 若发现重复，显示警告（同创建流程）
   c. 用户确认元数据和内容后，直接以 Draft 状态创建（跳过 Stub 阶段）
   d. Frontmatter 的 sourceUids 字段自动记录所有来源 Mechanism 的 UID
```

## 4.7 增量改进 (Incremental Refinement)

> **设计原则**: 对应 PRD 5.3.5 增量模式。当用户对现有内容不满意时，AI 基于现有内容 + 用户意图进行增量修改。

**文件**: `prompts/l3_common_refinement.md` (或作为 Agent Prompt 的分支)
**触发条件**: 用户点击 [增量改进] 按钮并输入意图。

### 输入变量

| 变量 | 类型 | 说明 |
|:--: |:--: |:--: |
| `{{current_content}}` | JSON | 当前笔记的完整 JSON 内容 |
| `{{user_improvement_intent}}` | string | 用户的修改意图（如"补充更多正例"）|
| `{{vault_index}}` | JSON | 同类型相似节点（用于参考）|

### Prompt 模板 (追加模式)

在标准 Agent Prompt 的 `<task>` 部分之后，追加以下内容：

```markdown
<refinement_mode>
Current Content:
{{current_content}}

User Improvement Intent:
"{{user_improvement_intent}}"

TASK:
Refine the Current Content based on the User Improvement Intent.
1. PRESERVE: Keep existing high-quality content unless explicitly asked to change.
2. MODIFY: Apply changes only where necessary to satisfy the intent.
3. VALIDATE: Ensure the modified content still meets all completeness requirements.

Output the FULL JSON with modifications applied.
</refinement_mode>
```

**实现说明**:
- 增量模式复用对应类型的 Agent (A-F)。
- 调用时，将上述 `<refinement_mode>` 块追加到标准 Prompt 的末尾。
- 模型将输出完整的 JSON，前端负责计算 Diff 并展示。

## 5. L2-Reflex Prompts

> **设计原则**: L2-Reflex 层负责校验和增强 Agent 输出质量，与 PRD 4.4 Grounding 规格保持一致。

### 5.1 基础校验

**文件**: `prompts/l2_reflex_validate.md`
**模型**: gemini-2.5-flash
**用途**: 校验 Agent 输出的 JSON 结构和内容合规性

```markdown
Task: Validate JSON structure and content compliance.

Input: {{generated_json}}
Expected Type: {{expected_type}}

<validation_rules>
1. Schema Compliance: Match required structure for {{expected_type}}?
2. Naming Convention: All names in `中文 (English)` format (or user's naming_template)?
3. Language: Content in correct language ({{output_language}})?
4. Logic: No circular definitions?
5. Wikilinks: Cross-references use [[wikilink]] format?
6. Type-specific rules:
   - Mechanism: causal_chain.length >= 2
   - Mechanism: relations.operates_on.length >= 1
   - Principle: formal_statement contains "若/如果/当" + "则/那么/因此"
   - Issue: core_tension in "X vs Y" format
</validation_rules>

Output:
{
  "status": "PASS|FAIL|WARN",
  "issues": [
    { 
      "type": "SCHEMA_ERROR|NAMING_ERROR|LOGIC_ERROR|TYPE_ERROR", 
      "description": "string", 
      "location": "$.path", 
      "severity": "ERROR|WARNING",
      "suggestion": "string"
    }
  ],
  "corrected_json": {} | null
}
```

### 5.2 事实核查 (Grounding)

**文件**: `prompts/l2_reflex_fact_check.md`
**模型**: gemini-2.5-pro + Google Search Grounding
**任务 ID**: `ground`
**用途**: 验证 Agent 生成内容的事实准确性

> **与 PRD 同步**: 对应 PRD 4.4 Grounding 规格。Grounding 为**可选功能**，用户可在设置中关闭（`enableGrounding: boolean`）。

```markdown
Task: Fact-check generated content using web search.

Input: {{generated_json}}
Check Fields: {{fields_to_check}}
Depth: {{check_depth}}

<grounding_protocol>
1. Extract factual claims from specified fields
2. Cross-verify each claim against multiple authoritative sources
3. Mark verdicts: VERIFIED | DISPUTED | UNVERIFIED
4. Record source URLs for transparency

Depth Modes:
- QUICK: Core definitions only (default for cost control)
- STANDARD: Definitions + key relationships
- THOROUGH: All non-holistic_understanding fields

Excluded Fields (never fact-checked):
- holistic_understanding (free-form synthesis)
- _thought_trace (internal reasoning)
</grounding_protocol>

<cost_control>
Per PRD 4.4: Grounding scope is configurable to balance accuracy vs cost.
Default: Check all non-holistic_understanding fields.
Advanced: User can restrict to specific fields or types.
</cost_control>

Output:
{
  "status": "PASS|WARN|FAIL",
  "fact_checks": [
    {
      "claim": "string (the factual assertion)",
      "location": "$.path (where in JSON)",
      "verdict": "VERIFIED|DISPUTED|UNVERIFIED",
      "confidence": 0.0-1.0,
      "sources": [
        { "uri": "string", "title": "string", "relevance": "string" }
      ],
      "discrepancy": "string | null (if DISPUTED, explain conflict)"
    }
  ],
  "summary": {
    "total_claims": number,
    "verified": number,
    "disputed": number,
    "unverified": number
  },
  "corrected_json": {} | null
}
```

**事实核查结果处理**（与 PRD 4.4 同步）:
- 在用户确认界面显示核查结果
- 标记可能有误的字段（黄色警告），并附带 Google Search 来源链接
- 用户点击警告图标可查看详细来源和冲突点
- 用户可直接在确认界面的文本框中手动修正内容
- [确认写入] 按钮始终可用（允许用户 Override）

### 5.3 错误诊断

**文件**: `prompts/l2_reflex_error_diagnose.md`
**模型**: gemini-2.5-flash
**用途**: 分析 API 错误，生成用户友好的诊断建议

> **与 PRD 同步**: 对应 PRD 6.4 错误处理与恢复。

```markdown
Task: Diagnose API error and provide actionable suggestions.

Input:
- error_code: {{error_code}}
- error_message: {{error_message}}
- request_context: {{request_context}}

<known_patterns>
| Pattern | Diagnosis | Severity | Action |
|--|--|--|--|
| 401, "Invalid API key" | API 密钥无效 | NEEDS_ACTION | 跳转设置页检查密钥 |
| 429, "Rate limit" | 请求频率超限 | RECOVERABLE | 等待后自动重试 |
| timeout | 网络超时 | RECOVERABLE | 检查网络/使用代理 |
| ENOTFOUND | DNS 解析失败 | NEEDS_ACTION | 检查网络连接 |
| JSON parse error | 响应格式错误 | RECOVERABLE | 自动重试 |
| 500, "Internal server error" | 服务端错误 | RECOVERABLE | 稍后重试 |
</known_patterns>

Output:
{
  "error_type": "AUTH|RATE_LIMIT|NETWORK|PARSE|SERVER|UNKNOWN",
  "diagnosis": "string",
  "severity": "RECOVERABLE|NEEDS_ACTION|CRITICAL",
  "suggested_actions": [
    {
      "action": "string (user-friendly description)",
      "action_type": "NAVIGATE|WAIT|RETRY|MANUAL",
      "target": "string | null (e.g., 'settings:api')",
      "wait_seconds": number | null
    }
  ],
  "user_friendly_message": "string (shown to user)",
  "technical_details": "string (for debugging)",
  "can_auto_retry": boolean,
  "retry_after_seconds": number | null
}
```

## 6. 校验规则与类型约束

### 6.1 类型判定校验规则

> **设计原则**: 与 PRD A2 公理（因果层级性）保持一致。

| 类型 | 校验条件 | 违反时的错误类型 |
|:--: |:--: |:--: |
| Domain | `issues` 字段非空 | `SCHEMA_ERROR` |
| Issue | `core_tension` 包含 "vs" 或对立表述 | `SCHEMA_ERROR` |
| Theory | `axioms` 至少包含 1 条 | `SCHEMA_ERROR` |
| Entity | `definition` 不含 "过程/演化/机制/变化" | `TYPE_ERROR` |
| Mechanism | `causal_chain.length >= 2` | `SCHEMA_ERROR` |
| Mechanism | `relations.operates_on.length >= 1` | `WARNING` |
| Principle | `formal_statement` 含 "若/如果/当" + "则/那么/因此" | `SCHEMA_ERROR` |
| Principle | `source_mechanisms` 来自 ≥2 个不同 Mechanism | `SCHEMA_ERROR` |

### 6.2 向量内容定义

> **与 PRD 4.6 同步**: 概念签名 (Concept Signature) 的定义。

```typescript
/**
 * 向量内容根据笔记状态和类型动态计算
 * 用于去重检索和上下文匹配
 */
### 6.2 向量内容定义

> **与 PRD 4.6 同步**: 概念签名 (Concept Signature) 的定义。

```typescript
/**
 * 向量内容根据笔记状态和类型动态计算
 * 用于去重检索和上下文匹配
 */
function getConceptSignature(note: CRNote): string {
  const base = `${note.title} ${note.aliases.join(' ')}`;
  
  if (note.status === 'Stub') {
    return base;  // Stub Signature: Title + Aliases
  }
  
  // Full Signature: Title + Aliases + CoreDefinition
  const coreDefinition = getCoreDefinition(note);
  return `${base} ${coreDefinition}`;
}

function getCoreDefinition(note: CRNote): string {
  switch (note.type) {
    case 'Domain': return note.content.definition;
    case 'Issue': return note.content.core_tension;
    case 'Theory': return note.content.axioms.map(a => a.statement).join(' ');
    case 'Entity': return note.content.definition;
    case 'Mechanism': return note.content.definition;
    case 'Principle': return note.content.formal_statement;
  }
}
```附录 A: API 调用示例

### A.1 reason 任务调用 (Agent A-F)

```typescript
const config: GenerateContentConfig = {
  generationConfig: {
    temperature: 1.0,  // 必须为 1.0
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 16384,
    responseMimeType: "application/json"
  },
  thinkingConfig: {
    thinkingLevel: "high"  // reason 任务必须为 high
  }
};
```

### A.2 ground 任务调用 (Grounding)

```typescript
const groundingTool: Tool = { googleSearch: {} };

const config: GenerateContentConfig = {
  tools: [groundingTool],
  generationConfig: {
    temperature: 0.3,  // 事实核查需要高确定性
    responseMimeType: "application/json"
  }
};
```

### A.3 standardizeClassify 任务调用

```typescript
const config: GenerateContentConfig = {
  generationConfig: {
    temperature: 0.3,  // 标准化任务使用较低温度
    topP: 0.9,
    maxOutputTokens: 2048,
    responseMimeType: "application/json"
  }
};
```

### A.4 带错误历史的重试调用

当 Agent 输出校验失败时，重试调用应包含 `history_errors`：

```typescript
// 构建重试 prompt
function buildRetryPrompt(
  originalPrompt: string,
  errors: ValidationError[]
): string {
  const errorSection = `
<history_errors>
Previous attempt failed with the following issues:
${JSON.stringify(errors, null, 2)}

DO NOT repeat these errors. Specifically address each issue in your new output.
</history_errors>
`;
  
  // 将错误历史追加到上下文末尾（任务指令之前）
  return originalPrompt.replace(
    '<task>',
    `${errorSection}\n<task>`
  );
}

// 重试配置 (temperature 稍微提高，增加输出多样性)
const retryConfig: GenerateContentConfig = {
  generationConfig: {
    temperature: 1.0,  // 保持 1.0，不要降低
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 16384,
    responseMimeType: "application/json"
  },
  thinkingConfig: {
    thinkingLevel: "high"
  }
};
```

### A.5 Thinking 参数详解

Gemini 3 的 thinking 模式有两种配置方式：

```typescript
// 方式 1: 使用 thinkingLevel (推荐)
{
  thinkingConfig: {
    thinkingLevel: "high"  // "off" | "low" | "medium" | "high"
  }
}

// 方式 2: 使用 thinkingBudget (精细控制)
{
  thinkingConfig: {
    thinkingBudget: 8192  // token 数量，范围 1-24576
  }
}
```

| 任务类型 | 推荐设置 | 说明 |
|:--|:--|:--|
| `reason` (Agent A-F) | `thinkingLevel: "high"` | 复杂推理，需要深度思考 |
| `standardizeClassify` | `thinkingLevel: "off"` 或不设置 | 简单分类，无需深度推理 |
| `enrich` | `thinkingLevel: "low"` | 轻量推理，生成别名 |
| `ground` | `thinkingLevel: "medium"` | 中等推理，事实核查 |

## 附录 B: TypeScript 类型定义

```typescript
// 知识类型枚举
type KnowledgeType = 'Domain' | 'Issue' | 'Theory' | 'Entity' | 'Mechanism' | 'Principle';

// 可推断的类型（Principle 除外）
type InferableType = Exclude<KnowledgeType, 'Principle'>;

// 笔记状态
type NoteStatus = 'Stub' | 'Draft' | 'Evergreen';

// Agent 输出基础结构
interface AgentOutput {
  _thought_trace: string;
  metadata: {
    name: string;
    type: KnowledgeType;
  };
  content: Record<string, unknown>;
  relations?: Record<string, unknown>;
}

// 校验错误（用于 history_errors）
interface ValidationError {
  attempt: number;
  error_type: 'SCHEMA_ERROR' | 'NAMING_ERROR' | 'LOGIC_ERROR' | 'TYPE_ERROR';
  description: string;
  location: string;  // JSON path, e.g., "$.content.causal_chain"
  severity: 'ERROR' | 'WARNING';
}

// 标准化输出
interface StandardizeClassifyOutput {
  standard_name: string;
  chinese_term: string;
  english_term: string;
  primary_type: InferableType;  // 推荐的类型
  reasoning: string;
  // 完整的类型置信度分布，始终返回所有 5 种类型的置信度
  type_confidences: Array<{
    type: InferableType;
    confidence: number;  // 0.0-1.0，所有类型的 confidence 之和为 1.0
  }>;
  // 消歧义选项，始终返回（至少包含 primary_type）
  disambiguation_options: Array<{
    technical_type: string;
    confidence: number;
    natural_label: string;
    natural_description: string;
    examples: string[];
  }>;
  // 冲突检查结果（由系统填充，非 LLM 返回）
  conflict: {
    detected: boolean;
    matches: Array<{
      uid: string;
      title: string;
      type: string;
      similarity: number;
    }>;
  };
}

// 事实核查输出
interface GroundingOutput {
  status: 'PASS' | 'WARN' | 'FAIL';
  fact_checks: Array<{
    claim: string;
    location: string;
    verdict: 'VERIFIED' | 'DISPUTED' | 'UNVERIFIED';
    confidence: number;
    sources: Array<{ uri: string; title: string; relevance: string }>;
    discrepancy?: string;
  }>;
  summary: {
    total_claims: number;
    verified: number;
    disputed: number;
    unverified: number;
  };
  corrected_json?: Record<string, unknown>;
}

// 错误诊断输出
interface ErrorDiagnosis {
  error_type: 'AUTH' | 'RATE_LIMIT' | 'NETWORK' | 'PARSE' | 'SERVER' | 'UNKNOWN';
  diagnosis: string;
  severity: 'RECOVERABLE' | 'NEEDS_ACTION' | 'CRITICAL';
  suggested_actions: Array<{
    action: string;
    action_type: 'NAVIGATE' | 'WAIT' | 'RETRY' | 'MANUAL';
    target?: string;
    wait_seconds?: number;
  }>;
  user_friendly_message: string;
  technical_details: string;
  can_auto_retry: boolean;
  retry_after_seconds?: number;
}
```

## 附录 C: PRD 映射参考

| SPEC 章节 | PRD 对应章节 | 说明 |
|:-- |:-- |:-- |
| 1.2 上下文工程原则 | - | 基于 Manus 经验总结 |
| 1.5 任务模型映射 | 4.2 任务模型配置 | 任务 ID 和默认模型 |
| 1.6 Temperature 配置 | 4.2 TaskModelConfig.params | 按任务类型区分 |
| 1.7 知识类型约束 | A2 因果层级性 | 6 种类型定义 |
| 2. 全局系统指令 | 3.2 各类型详细定义 | 完备性要求 |
| 3. standardizeClassify | 4.5 数据流 | 标准化 + 类型推断 |
| 3.5 enrich | 4.5 数据流 | 别名/标签生成 |
| 4. Agent 体系 | 4.3 Agent 体系 | Agent A-F 定义 |
| 5.2 事实核查 | 4.4 Grounding 规格 | 可选功能 |
| 6.2 向量内容定义 | 4.6 向量索引存储 | 概念签名 |
| 6.3 去重阈值 | 7.1 PluginSettings | dedupThreshold, topK |

## 附录 D: 上下文工程最佳实践

> **参考来源**: [Manus 团队上下文工程经验](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

### D.1 KV 缓存优化策略

在与 Gemini API 交互时，KV 缓存命中率直接影响响应速度和成本。以下策略可最大化缓存利用：

| 策略 | 实施方式 | 效果 |
|:--|:--|:--|
| **稳定前缀** | System instruction 内容固定，不含动态元素 | 缓存前缀可复用 |
| **避免开头动态内容** | 不在 system_instruction 开头放时间戳、随机 ID | 保持 token 序列稳定 |
| **只追加上下文** | 新信息追加到 context 末尾，不修改已有部分 | 已计算 KV 不失效 |
| **批量化相似请求** | 相同类型任务集中处理 | 共享系统指令缓存 |

### D.2 上下文结构模板

所有 Agent 调用应遵循以下上下文结构：

```
┌─────────────────────────────────────────────────┐
│ [SYSTEM INSTRUCTION] - 稳定前缀                   │
│ • role 定义                                      │
│ • thinking_protocol                             │
│ • knowledge_types                               │
│ • language_rules                                │
│ • forbidden                                     │
│ • output_format                                 │
├─────────────────────────────────────────────────┤
│ [USER MESSAGE] - 动态内容                        │
│ • <context> 大量背景数据                         │
│   - vault_index                                 │
│   - parent_context                              │
│   - history_errors (如有)                        │
│ • <task> 具体任务指令                            │
│ • <anchor> "根据上述信息，执行以下步骤..."         │
│ • <completeness_requirements>                    │
│ • <output_schema>                               │
└─────────────────────────────────────────────────┘
```

### D.3 错误保留机制

> **原则**: 失败的尝试应保留在上下文中，帮助模型学习和避免重复错误。

当 Agent 输出校验失败时，应将错误信息追加到下次调用的上下文中：

```markdown
<history_errors>
Previous attempt failed with the following issues:
{{history_errors}}

DO NOT repeat these errors. Specifically address each issue in your new output.
</history_errors>
```

**变量注入示例**:
```json
{
  "history_errors": [
    {
      "attempt": 1,
      "error_type": "SCHEMA_ERROR",
      "description": "causal_chain has only 1 step, minimum 2 required",
      "location": "$.content.causal_chain"
    },
    {
      "attempt": 1,
      "error_type": "TYPE_ERROR", 
      "description": "definition contains process language, may be Mechanism not Entity",
      "location": "$.content.definition"
    }
  ]
}
```

### D.4 注意力操控技术

> **原则**: 通过复述 (Recitation) 将重要信息放在上下文末尾，引导模型注意力。

**任务目标复述**（在 `<task>` 末尾）：
```markdown
<task>
...具体任务内容...

---
REMINDER: Your current goal is to generate a complete {{expected_type}} node for "{{target_name}}".
You MUST satisfy all completeness requirements.
You MUST avoid duplicating existing nodes in vault_index.
</task>
```

### D.5 避免少样本陷阱

在需要提供示例时，使用**结构化变化**而非固定模板：

```markdown
<examples>
Note: These examples show FORMAT, not content to copy.
Your output should be original, not pattern-matched to examples.

Example 1 (Domain):
{ "metadata": { "name": "博弈论 (Game Theory)", "type": "Domain" }, ... }

Example 2 (Mechanism - different structure):
{ "metadata": { "name": "细胞凋亡 (Apoptosis)", "type": "Mechanism" }, ... }
</examples>
```

### D.6 实施检查清单

开发者在实现 Agent 调用时，应确保：

- [ ] System instruction 不含动态时间戳或随机内容
- [ ] `vault_index` 放在 `<context>` 块内
- [ ] 具体任务指令放在大量上下文之后
- [ ] 使用 "根据上述信息..." 锚定上下文
- [ ] 错误信息通过 `history_errors` 变量传递（而非清空重试）
- [ ] 任务目标在末尾复述
- [ ] Temperature 设置为 1.0（reason 任务）
- [ ] 启用 thinking 模式（thinkingLevel: "high"）

