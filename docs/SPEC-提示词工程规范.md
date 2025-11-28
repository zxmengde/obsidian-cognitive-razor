# Cognitive Razor - 提示词工程规范

> **文档版本**: 2.1  
> **最后更新**: 2025-11-28  
> **文档性质**: 技术规格说明书，定义所有 Prompt 的结构与内容

---

## 0. 文档结构

| 章节 | 内容 |
| :--- | :--- |
| §1 架构与约定 | Prompt 文件组织、命名规则、公共约束 |
| §2 全局系统指令 | 所有 Agent 共享的不可变规则 |
| §3 L2-Pre Prompt | 预处理层提示词（含批量模式、零类型感知） |
| §4 L3 Agent Prompts | 四个认知 Agent 的提示词 |
| §5 L2-Reflex Prompt | 校验层提示词 |
| §6 输出 Schema 参考 | 所有输出结构的完整定义 |

---

## 1. 架构与约定

### 1.1 文件组织

```
.obsidian/plugins/obsidian-cognitive-razor/prompts/
├── system_core.md              # 全局系统指令 (§2)
├── l2_pre_standardizer.md      # L2-Pre 单个模式 (§3.2)
├── l2_pre_batch.md             # L2-Pre 批量模式 (§3.3)
├── l2_pre_disambiguation.md    # L2-Pre 零类型感知补充 (§3.4)
├── l3_agent_a_domain.md        # Agent A (§4.1)
├── l3_agent_b_issue.md         # Agent B (§4.2)
├── l3_agent_c_theory.md        # Agent C (§4.3)
├── l3_agent_d_principle.md     # Agent D (§4.4)
├── l2_reflex_validate.md       # L2-Reflex (§5.1)
├── l2_reflex_fact_check.md     # L2-Reflex + Grounding (§5.2)
└── l2_reflex_error_diagnose.md # L2-Reflex 错误诊断 (§5.3)
```

### 1.2 变量注入约定

Prompt 中使用 `{{variable}}` 表示运行时注入的变量。

| 变量来源 | 前缀 | 示例 |
| :--- | :--- | :--- |
| 用户输入 | 无 | `{{user_input}}`, `{{theory_name}}` |
| 系统配置 | 无 | `{{folder_domain}}`, `{{dedup_threshold}}` |
| L1 检索结果 | 无 | `{{vault_index}}` |
| 当前上下文 | 无 | `{{output_language}}` |

### 1.3 输出格式约定

- **所有 Agent 输出必须为有效 JSON**
- **禁止在 JSON 外包裹 Markdown 代码块**
- **L3 Agent 必须包含 `_thought_trace` 字段**

### 1.4 Gemini 3 特殊约定

| 约定 | 说明 |
| :--- | :--- |
| Temperature | **必须保持 1.0**，低于此值可能导致循环 |
| Thinking Level | L3 Agent 必须设置为 `"high"` |
| 结构化输出 | 必须设置 `responseMimeType: "application/json"` |

---

## 2. 全局系统指令

**文件**: `prompts/system_core.md`  
**注入方式**: 作为所有 API 调用的 `system_instruction`

```markdown
<role>
You are the "Cognitive Razor," an axiomatic logic engine.
You compile information into strictly typed Knowledge Graph nodes.
You are NOT a creative writer. You are a logic compiler.
</role>

<language_rules>
1. Output Language: {{output_language}}
   - zh-CN: 简体中文
   - en: English

2. Term Naming: ALWAYS use `中文术语 (English Term)` format.
   Example: `纳什均衡 (Nash Equilibrium)`

3. Math Formulas: Use LaTeX `$...$` for inline.

4. No Markdown Headers inside JSON string values.
</language_rules>

<forbidden>
- Qualitative adjectives without quantification: "重要", "核心", "关键"
- Circular definitions: defining X using X or synonyms
- Metaphors without mechanism explanation
- "Emergence" without micro-mechanism detail
- Filler text: no greetings, no self-references outside _thought_trace
</forbidden>

<output_format>
Return VALID JSON ONLY.
Do not wrap in markdown code blocks.
</output_format>
```

---

## 3. L2-Pre Standardizer

**文件**: `prompts/l2_pre_standardizer.md`  
**模型**: Gemini 2.5 Flash  
**用途**: 将用户输入标准化为元数据（支持单个/批量模式）

### 3.1 输入变量

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| `{{user_input}}` | string | 用户原始输入（可含逗号分隔的多个词） |
| `{{type_folder_map}}` | JSON | 类型到目录的映射 |
| `{{naming_template_*}}` | string | 各类型的命名模板 |
| `{{type_transparent_mode}}` | boolean | 是否启用零类型感知模式 |
| `{{existing_nodes}}` | JSON | L1 检索的相似节点（用于冲突检测） |
| `{{auto_reuse_threshold}}` | number | 智能默认自动复用阈值，默认 0.95 |
| `{{review_threshold}}` | number | 需人工审核的阈值下限，默认 0.9 |

### 3.2 Prompt 模板 (单个模式)

```markdown
Task: Standardize input term into canonical metadata.

Input: "{{user_input}}"

Folder Mapping: {{type_folder_map}}

Naming Templates:
- Domain: {{naming_template_domain}}
- Issue: {{naming_template_issue}}
- Theory: {{naming_template_theory}}
- Entity: {{naming_template_entity}}
- Mechanism: {{naming_template_mechanism}}
- Principle: {{naming_template_principle}}

Existing Similar Nodes (for deduplication):
{{existing_nodes}}

Smart Default Thresholds:
- Auto-reuse if similarity >= {{auto_reuse_threshold}}
- Require review if similarity in [{{review_threshold}}, {{auto_reuse_threshold}})

Rules:
1. Canonical Name: `中文术语 (English Term)` format.
2. Type: Choose ONE from [Domain, Issue, Theory, Entity, Mechanism, Principle].
3. Folder: Resolve from Folder Mapping.
4. Filename: Apply naming template.
5. Conflict Detection: Compare against existing_nodes, report matches.
6. Smart Default: If similarity >= auto_reuse_threshold, recommend AUTO_REUSE.

Output:
{
  "standard_name": "string",
  "chinese_term": "string",
  "english_term": "string",
  "type": "string",
  "folder": "string",
  "filename": "string",
  "aliases": ["string"],
  "confidence": 0.0-1.0,
  "conflict": {
    "detected": boolean,
    "existing_uid": "string | null",
    "existing_name": "string | null",
    "similarity": number | null,
    "recommendation": "AUTO_REUSE | REVIEW | CREATE_NEW"
  }
}
```

### 3.3 Prompt 模板 (批量模式)

```markdown
Task: Standardize MULTIPLE input terms into canonical metadata.

Input (comma-separated): "{{user_input}}"

Folder Mapping: {{type_folder_map}}

Naming Templates:
- Entity: {{naming_template_entity}}
- Mechanism: {{naming_template_mechanism}}
- Principle: {{naming_template_principle}}

Existing Similar Nodes:
{{existing_nodes}}

Smart Default Thresholds:
- Auto-reuse if similarity >= {{auto_reuse_threshold}}
- Require review if similarity in [{{review_threshold}}, {{auto_reuse_threshold}})

Rules:
1. Split input by comma, process each term independently.
2. For each term, apply single-mode rules.
3. Return array of results.

Output:
{
  "mode": "BATCH",
  "items": [
    {
      "input": "string",
      "standard_name": "string",
      "chinese_term": "string",
      "english_term": "string",
      "type": "string",
      "folder": "string",
      "filename": "string",
      "aliases": ["string"],
      "confidence": 0.0-1.0,
      "conflict": {
        "detected": boolean,
        "existing_uid": "string | null",
        "existing_name": "string | null",
        "similarity": number | null,
        "recommendation": "AUTO_REUSE | REVIEW | CREATE_NEW"
      }
    }
  ],
  "summary": {
    "total": number,
    "auto_reuse": number,
    "need_review": number,
    "create_new": number
  }
}
```

### 3.4 零类型感知模式 Prompt 补充

当 `{{type_transparent_mode}}` 为 true 时，追加以下指令：

```markdown
<type_transparent_mode>
User is in Type-Transparent Mode. They do NOT understand technical type names.

If confidence < 0.7, include a natural language disambiguation:
{
  ...
  "needs_disambiguation": true,
  "disambiguation_options": [
    {
      "technical_type": "Mechanism",
      "natural_label": "一个过程或机制",
      "natural_description": "描述"如何发生"、有步骤、有因果关系",
      "examples": ["消化", "光合作用", "市场调节"]
    },
    {
      "technical_type": "Entity", 
      "natural_label": "一个静态概念",
      "natural_description": "描述"是什么"、可定义、不涉及变化",
      "examples": ["细胞", "原子", "纳什均衡"]
    }
  ]
}

If confidence >= 0.7, set "needs_disambiguation": false.
</type_transparent_mode>
```

### 3.5 输出 Schema

```typescript
// 单个模式输出
interface L2PreOutput {
  standard_name: string;
  chinese_term: string;
  english_term: string;
  type: "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism" | "Principle";
  folder: string;
  filename: string;
  aliases: string[];
  confidence: number;
  conflict: {
    detected: boolean;
    existing_uid: string | null;
    existing_name: string | null;
    similarity: number | null;
    recommendation: "AUTO_REUSE" | "REVIEW" | "CREATE_NEW";
  };
  // 零类型感知模式附加
  needs_disambiguation?: boolean;
  disambiguation_options?: Array<{
    technical_type: string;
    natural_label: string;
    natural_description: string;
    examples: string[];
  }>;
}

// 批量模式输出
interface L2PreBatchOutput {
  mode: "BATCH";
  items: L2PreOutput[];
  summary: {
    total: number;
    auto_reuse: number;
    need_review: number;
    create_new: number;
  };
}
```

---

## 4. L3 Agent Prompts

### 4.1 Agent A: Domain Mapper

**文件**: `prompts/l3_agent_a_domain.md`  
**模型**: Gemini 3.0 Pro (thinking_level: "high")  
**用途**: MECE 分解领域，生成子领域和议题

#### 输入变量

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| `{{domain_name}}` | string | 领域规范名称 |

#### Prompt 模板

```markdown
<context>
Target Domain: "{{domain_name}}"
</context>

<task>
Construct a holographic map of this domain.

Before answering:
1. Define the domain's logical boundaries
2. Identify MECE decomposition criteria
3. Verify no circular definitions
</task>

<requirements>
1. definition: What does this field study? (≥200 chars)
2. teleology: What questions does it answer? (≥150 chars)
3. methodology: How does it validate knowledge? (≥200 chars)
4. historical_genesis: When and why did it emerge? (≥150 chars)
5. boundaries: What does it NOT study? (≥150 chars)
6. holistic_understanding: Free-form synthesis. (≥300 chars)
7. sub_domains: MECE decomposition (if not atomic)
8. emergent_issues: Macro-issues from micro-interactions
</requirements>

<output_schema>
{
  "_thought_trace": "string",
  "metadata": { "name": "string", "type": "Domain" },
  "content": {
    "definition": "string",
    "teleology": "string",
    "methodology": "string",
    "historical_genesis": "string",
    "boundaries": "string",
    "holistic_understanding": "string"
  },
  "structure": {
    "is_atomic": boolean,
    "atomic_reason": "string | null",
    "sub_domains": [
      { "name": "string", "rationale": "string", "brief_description": "string" }
    ],
    "emergent_issues": [
      { "name": "string", "mechanism": "string", "significance": "string" }
    ]
  },
  "related_domains": [
    { "name": "string", "relation_type": "PARENT|SIBLING|CHILD|INTERSECTS|APPLIES_TO", "relation_description": "string" }
  ]
}
</output_schema>
```

#### 输出字段说明

| 字段 | 说明 | 写入笔记位置 |
| :--- | :--- | :--- |
| `content.definition` | 领域定义 | `## 定义` |
| `content.teleology` | 目的论 | `## 目的` |
| `content.methodology` | 方法论 | `## 方法论` |
| `structure.sub_domains` | 子领域 | `## 子领域` + `[[双链]]` |
| `structure.emergent_issues` | 涌现议题 | `## 核心议题` + `[[双链]]` |

---

### 4.2 Agent B: Issue Probe

**文件**: `prompts/l3_agent_b_issue.md`  
**模型**: Gemini 3.0 Pro (thinking_level: "high")  
**用途**: 挖掘议题根源，列举理论解空间

#### 输入变量

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| `{{issue_name}}` | string | 议题规范名称 |
| `{{parent_context}}` | string | 父领域上下文 |

#### Prompt 模板

```markdown
<context>
Target Issue: "{{issue_name}}"
Parent Context: "{{parent_context}}"
</context>

<task>
Excavate the roots of this issue and map the theoretical landscape.

Before answering:
1. Identify core contradiction (X vs. Y)
2. Trace causal chain to issue recognition
3. Verify all listed theories address this issue
</task>

<requirements>
1. historical_genesis: When was this identified?
2. core_tension: Fundamental X vs. Y contradiction
3. structural_analysis: Decompose into sub-problems
4. stakeholder_perspectives: Who is affected?
5. boundary_conditions: When does issue NOT arise?
6. holistic_understanding: Free-form synthesis
7. theories: List approaches (Mainstream/Fringe/Falsified)
</requirements>

<output_schema>
{
  "_thought_trace": "string",
  "metadata": { "name": "string", "type": "Issue" },
  "content": {
    "historical_genesis": "string",
    "core_tension": "string",
    "structural_analysis": "string",
    "stakeholder_perspectives": "string",
    "boundary_conditions": "string",
    "holistic_understanding": "string"
  },
  "theories": [
    {
      "name": "string",
      "status": "Mainstream|Fringe|Falsified",
      "premise": "string",
      "proposed_solution": "string",
      "limitations": "string"
    }
  ],
  "related_issues": [
    { "name": "string", "relation_type": "CAUSES|CAUSED_BY|SIMILAR_TO|OPPOSITE_OF|SUBSUMES|SUBSUMED_BY", "relation_description": "string" }
  ]
}
</output_schema>
```

---

### 4.3 Agent C: Theory Deconstructor (核心)

**文件**: `prompts/l3_agent_c_theory.md`  
**模型**: Gemini 3.0 Pro (thinking_level: "high")  
**用途**: 解构理论，提取并去重实体/机制

#### 输入变量

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| `{{theory_name}}` | string | 理论规范名称 |
| `{{vault_index}}` | JSON | L1 检索的相似节点列表 |
| `{{dedup_threshold}}` | number | 去重阈值 (默认 0.9) |
| `{{context_retrieval_count}}` | number | 检索数量 (默认 50) |

#### Prompt 模板

```markdown
<context>
# Existing Knowledge Base (Top-{{context_retrieval_count}} by similarity)
Deduplication Rule: If similarity ≥ {{dedup_threshold}}, mark as EXISTING.

{{vault_index}}
</context>

<task>
Target Theory: "{{theory_name}}"

Reconstruct logic, deconstruct into components, deduplicate.

Before answering:
1. Parse theory into axiomatic foundations
2. For EACH component, compare against Context
3. Verify argument chain is complete
</task>

<requirements>
1. axioms: Foundational assumptions
2. argument_chain: Complete derivation with logical connectives
3. core_predictions: Testable predictions
4. scope_and_applicability: Where does it apply?
5. limitations: Known weaknesses
6. historical_development: Origins and evolution
7. holistic_understanding: Free-form synthesis
8. extracted_components: Entity/Mechanism with NEW/EXISTING status
</requirements>

<output_schema>
{
  "_thought_trace": "string",
  "metadata": { "name": "string", "type": "Theory" },
  "content": {
    "axioms": [{ "statement": "string", "justification": "string" }],
    "argument_chain": "string",
    "core_predictions": "string",
    "scope_and_applicability": "string",
    "limitations": "string",
    "historical_development": "string",
    "holistic_understanding": "string"
  },
  "extracted_components": [
    {
      "name": "string",
      "category": "Entity|Mechanism",
      "status": "NEW|EXISTING",
      "uid": "string|null",
      "match_reason": "string",
      "definition": "string (only if NEW)",
      "role_in_theory": "string",
      "attributes": {}
    }
  ],
  "related_theories": [
    { "name": "string", "relation_type": "EXTENDS|CONTRADICTS|SUBSUMES|SUBSUMED_BY|COMPLEMENTS|ALTERNATIVE_TO", "relation_description": "string" }
  ]
}
</output_schema>
```

#### 去重判定逻辑

```
对每个 extracted_component:
  IF vault_index 中存在 similarity >= dedup_threshold 的节点:
    status = "EXISTING"
    uid = 匹配节点的 uid
    match_reason = 解释为何语义等价
  ELSE:
    status = "NEW"
    uid = null
    definition = 完整定义 (必填)
```

---

### 4.4 Agent D: Principle Synthesizer

**文件**: `prompts/l3_agent_d_principle.md`  
**模型**: Gemini 3.0 Pro (thinking_level: "high")  
**用途**: 从多个 Mechanism 中提取跨域原理

#### 输入变量

| 变量 | 类型 | 说明 |
| :--- | :--- | :--- |
| `{{input_mechanisms}}` | JSON | 机制列表 |
| `{{insight_threshold}}` | number | 推荐阈值 (默认 0.85) |

#### Prompt 模板

```markdown
<context>
Input Mechanisms:
{{input_mechanisms}}
</context>

<task>
Distill a universal Principle from these mechanisms.

Before answering:
1. Identify structural invariants across ALL mechanisms
2. Abstract domain-specific parameters to generic variables
3. Verify principle is genuinely domain-independent
</task>

<requirements>
1. formal_statement: IF [conditions] THEN [consequence]
2. mathematical_form: LaTeX expression
3. variables: Define each abstract variable
4. scope_and_constraints: When does principle hold?
5. isomorphism_analysis: Map each mechanism to abstract structure
6. predictive_power: Novel predictions and new domains
7. historical_precedents: Prior recognition under other names
8. holistic_understanding: Free-form synthesis
</requirements>

<output_schema>
{
  "_thought_trace": "string",
  "metadata": { "name": "string", "type": "Principle" },
  "content": {
    "formal_statement": "string",
    "mathematical_form": "string",
    "variables": { "$X$": "string" },
    "scope_and_constraints": "string",
    "isomorphism_analysis": "string",
    "predictive_power": "string",
    "historical_precedents": "string",
    "holistic_understanding": "string"
  },
  "source_mechanisms": [
    { "name": "string", "domain": "string", "mapping": "string" }
  ],
  "related_principles": [
    { "name": "string", "relation_type": "GENERALIZES|SPECIALIZES|DUAL_OF|ANALOGOUS_TO|CONTRADICTS", "relation_description": "string" }
  ]
}
</output_schema>
```

---

## 5. L2-Reflex Prompts

### 5.1 基础校验

**文件**: `prompts/l2_reflex_validate.md`  
**模型**: Gemini 2.5 Flash

```markdown
Task: Validate JSON structure and content.

Input: {{generated_json}}

Checks:
1. Schema Compliance: Match required structure?
2. Naming Convention: All names in `中文 (English)` format?
3. Language: Content in correct language?
4. Logic: No circular definitions?

Output:
{
  "status": "PASS|FAIL|WARN",
  "issues": [
    { "type": "SCHEMA_ERROR|NAMING_ERROR|LOGIC_ERROR", "description": "string", "location": "$.path", "severity": "ERROR|WARNING" }
  ],
  "corrected_json": {} | null
}
```

### 5.2 事实核查 (with Google Search)

**文件**: `prompts/l2_reflex_fact_check.md`  
**模型**: Gemini 2.5 Flash + Google Search Grounding  
**前置条件**: API 调用时启用 `googleSearch` 工具

```markdown
Task: Fact-check generated content.

Input: {{generated_json}}
Depth: {{check_depth}}

Protocol:
1. Extract factual claims
2. Search authoritative sources
3. Mark verdicts: VERIFIED | DISPUTED | UNVERIFIED
4. Record sources

Depth Modes:
- QUICK: Core definitions only
- STANDARD: Definitions + key relationships
- THOROUGH: All factual assertions

Output:
{
  "status": "PASS|WARN|FAIL",
  "schema_issues": [...],
  "fact_checks": [
    {
      "claim": "string",
      "location": "$.path",
      "verdict": "VERIFIED|DISPUTED|UNVERIFIED",
      "confidence": 0.0-1.0,
      "sources": [{ "uri": "string", "title": "string" }],
      "discrepancy": "string (if DISPUTED)"
    }
  ],
  "corrected_json": {} | null
}
```

### 5.3 智能错误诊断

**文件**: `prompts/l2_reflex_error_diagnose.md`  
**模型**: Gemini 2.5 Flash  
**用途**: 分析 API 错误，生成用户友好的诊断建议

```markdown
Task: Diagnose API error and provide actionable suggestions.

Input:
- error_code: {{error_code}}
- error_message: {{error_message}}
- request_context: {{request_context}}

Known Error Patterns:
| Pattern | Diagnosis | Suggested Action |
|---------|-----------|------------------|
| 401, "Invalid API key" | API 密钥无效 | 跳转设置页检查密钥 |
| 429, "Rate limit" | 请求频率超限 | 等待后重试 |
| timeout | 网络超时 | 检查网络/使用代理 |
| ENOTFOUND | DNS 解析失败 | 检查网络连接 |
| JSON parse error | 响应格式错误 | 自动重试/报告问题 |
| 500, "Internal server error" | 服务端错误 | 稍后重试 |

Output:
{
  "error_type": "AUTH|RATE_LIMIT|NETWORK|PARSE|SERVER|UNKNOWN",
  "diagnosis": "string",
  "severity": "RECOVERABLE|NEEDS_ACTION|CRITICAL",
  "suggested_actions": [
    {
      "action": "string",
      "action_type": "NAVIGATE|WAIT|RETRY|MANUAL",
      "target": "string | null",
      "wait_seconds": number | null
    }
  ],
  "user_friendly_message": "string",
  "technical_details": "string",
  "can_auto_retry": boolean,
  "retry_after_seconds": number | null
}
```

**错误类型定义**:

```typescript
interface ErrorDiagnosis {
  error_type: "AUTH" | "RATE_LIMIT" | "NETWORK" | "PARSE" | "SERVER" | "UNKNOWN";
  diagnosis: string;
  severity: "RECOVERABLE" | "NEEDS_ACTION" | "CRITICAL";
  suggested_actions: Array<{
    action: string;
    action_type: "NAVIGATE" | "WAIT" | "RETRY" | "MANUAL";
    target?: string;      // 如 "settings:api" 表示跳转到设置页 API 分区
    wait_seconds?: number;
  }>;
  user_friendly_message: string;
  technical_details: string;
  can_auto_retry: boolean;
  retry_after_seconds?: number;
}
```

---

## 6. 输出 Schema 参考

### 6.1 Entity (实体)

```typescript
interface EntityOutput {
  metadata: { name: string; type: "Entity" };
  content: {
    definition: string;
    classification: string;
    properties: Record<string, { description: string; possible_values: string; measurement: string }>;
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
```

### 6.2 Mechanism (机制)

```typescript
interface MechanismOutput {
  metadata: { name: string; type: "Mechanism" };
  content: {
    definition: string;
    trigger_conditions: string;
    process_description: string;
    causal_chain: Array<{ step: number; action: string; result: string }>;
    termination_conditions: string;
    inputs: string[];
    outputs: string[];
    examples: string[];
    holistic_understanding: string;
  };
  relations: {
    operates_on: string[];
    produces: string[];
    requires: string[];
    inhibited_by: string[];
  };
}
```

### 6.3 类型判定校验规则 (供 L2-Reflex 使用)

| 类型 | 校验条件 | 违反时的错误类型 |
| :--- | :--- | :--- |
| Entity | `definition` 不含 "过程/演化/机制" | `TYPE_ERROR` |
| Mechanism | `causal_chain.length >= 2` | `SCHEMA_ERROR` |
| Mechanism | `relations.operates_on.length >= 1` | `WARNING` |
| Principle | `formal_statement` 含 "若/如果/当" + "则/那么/因此" | `SCHEMA_ERROR` |
| Principle | `source_mechanisms` 来自 ≥2 个 Domain | `WARNING` |

---

## 附录: API 调用示例

### L3 Agent 调用

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
    thinkingLevel: "high"  // L3 必须为 high
  }
};
```

### L2-Reflex + Grounding 调用

```typescript
const groundingTool: Tool = { googleSearch: {} };

const config: GenerateContentConfig = {
  tools: [groundingTool],
  generationConfig: {
    temperature: 1.0,
    responseMimeType: "application/json"
  }
};
```