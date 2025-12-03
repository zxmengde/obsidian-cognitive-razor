# Cognitive Razor (CR) - 提示词设计文档

## 0. 引用
- `docs/System-Formalism.md`: 定义 PromptTemplate 原语与 AX-5 约束。
- `docs/PRD-产品需求文档.md`: 描述任务类型、节点 Schema 与业务目标。
- `docs/UCD-用户使用设计文档.md`: 给出交互触发点与输出呈现方式。

## 1. 设计公理

### 1.1 技术公理

| 公理 ID | 公理陈述 | 产品映射 |
|:--:|:--|:--|
| **A1** | 模型仅执行明确字面指令，不推断潜在意图。 | 模板显式标注步骤与禁止假设的提醒。 |
| **A2** | Instruction 与 Data 必须物理隔离。 | 统一使用 XML 风格标签 `<INSTRUCTION>`, `<CONTEXT>`, `<SCHEMA>` 等。 |
| **A3** | Few-shot 示例优于抽象规则。 | 每个任务模板提供至少一条少样本示例。 |
| **A4** | 输出真实性受限于上下文。 | 模板列出允许引用的上下文字段。 |
| **A5** | 显式推理提升复杂任务准确率。 | 推理型任务开启 `<REASONING>` 段并要求链式推理。 |
| **A6** | 结构化输出需声明完整 Schema，并紧邻输出指示。 | `<SCHEMA>` 段包含 JSON/YAML Schema，紧接 `<INSTRUCTION>`。 |

### 1.2 上下文工程公理

| 公理 ID | 公理陈述 | 实现 |
|:--:|:--|:--|
| **B1** | 上下文只追加不修改。 | 历史输出写入 `<HISTORY>`，新增内容附加在末尾。 |
| **B2** | 关键目标需在末尾复述。 | `<REMINDER>` 段强调目标与约束。 |
| **B3** | 上下文按任务需求动态组装。 | Prompt 构建器为不同任务加载最小必要上下文。 |

### 1.3 业务公理

| 公理 ID | 公理陈述 | 对应 PRD 约束 |
|:--:|:--|:--|
| **C1** | 节点类型固定为 5 种。 | PRD §3.1 类型分类。 |
| **C2** | 节点必须覆盖所有必填字段。 | PRD §3.2 Schema 要求。 |
| **C3** | 命名遵循用户模板。 | PRD §6 命名模板配置。 |

## 2. PromptTemplate 架构
- 模板存放于 `data/prompts/`，文件命名 `taskName.vMajor.vMinor.json`。
- 统一结构：
    ```json
    {
        "id": "content_synthesis.v1",
        "version": "1.0.0",
        "capability": "text_generation",
        "providerHints": {"preferred_formats": ["json"], "min_output_tokens": 2048},
        "segments": [
            {"tag": "INSTRUCTION", "content": "..."},
            {"tag": "CONTEXT", "content": "..."},
            {"tag": "SCHEMA", "content": "..."},
            {"tag": "EXAMPLES", "content": "..."},
            {"tag": "HISTORY", "content": "..."},
            {"tag": "REMINDER", "content": "..."}
        ]
    }
    ```
- Prompt 构建器负责注入变量 `{{namingTemplate}}`, `{{schema_fields}}`, `{{previous_output}}`, `{{provider_capabilities}}` 等。
- `{{schema_fields}}`、`schemaHash` 等字段统一从 `docs/schemas/node_schemas.json` 中读取，模板不得内嵌手写版本，以避免与 AX-1 冲突。
- 所有模板满足以下验证：
    1. 标签集合必须包含 `INSTRUCTION`, `SCHEMA`, `REMINDER`。
    2. `<SCHEMA>` 段必须是合法 JSON Schema/YAML 片段。
    3. `<EXAMPLES>` 至少含一条示例；当任务区分模式（如 `create` vs `revise`）时需覆盖两种情况。

### 2.1 语言范围约束
- 插件仅支持中文（`zh-CN`）与英文（`en-US`）两种输出；Prompt 构建器以 `target_language` 参数驱动模板选择，默认回退到英文。
- `<EXAMPLES>` 与 `<REMINDER>` 段需覆盖目标语言示例，禁止在同一段落混用两种语言。
- `providerHints.supported_languages` 字段必须声明 `{"primary": "zh-CN", "fallback": "en-US"}`，Prompt 校验器在运行前验证 Provider 能力声明。

## 3. 任务模板说明

### 3.1 Normalization
- **输入上下文**: 原始用户输入、命名模板、命名缓存命中、当前 Vault 中同类型节点引用摘要。
- **输出 Schema**:
    ```json
    {
        "type": "object",
        "required": ["canonical_name", "type_candidates", "suggested_tags", "reasoning"],
        "properties": {
            "canonical_name": {"type": "string"},
            "type_candidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["type", "confidence"],
                    "properties": {
                        "type": {"enum": ["Domain", "Issue", "Theory", "Entity", "Mechanism"]},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                    }
                }
            },
            "suggested_tags": {"type": "array", "items": {"type": "string"}},
            "reasoning": {"type": "string"}
        }
    }
    ```
- **示例**: 至少两条（领域、机制各一）。
- **提醒**: `<REMINDER>` 重申不可输出多个 canonical name，置信度不足需说明。

### 3.2 MetadataSynthesis
- **输入上下文**: 用户确认的 `nodeType`, `canonicalName`, Schema 定义、父子关系建议。
- **输出格式**: YAML，含 `nodeId`, `nodeType`, `nodeState: Stub`, `aliases`, `tags`, `links`。
- **失败路径**: 若无法填充所有必填字段，输出 `missing_fields` JSON 数组并设置 `status=failed`。

### 3.3 ContentSynthesis
- **模式**: `create`（Stub → Draft）、`revise`（Draft/Evergreen 修改）。
- **输入上下文**: YAML frontmatter、既有正文、Schema 说明、相关节点摘要、用户修订指令（当模式为 `revise`）。
- **输出 Schema**:
    ```json
    {
        "type": "object",
        "required": ["markdown", "field_completeness", "change_log", "reasoning"],
        "properties": {
            "markdown": {"type": "string"},
            "field_completeness": {"type": "object", "additionalProperties": {"type": "boolean"}},
            "change_log": {"type": "string"},
            "reasoning": {"type": "string"}
        }
    }
    ```
- **示例**: 一个 Theory `create` 示例展示完整字段；一个 Entity `revise` 示例展示增量更新。
- **提醒**: 输出必须保留 Markdown 中的字段层级标题；若字段缺失，需在 `field_completeness` 标记并说明原因。

### 3.4 DedupResolution
- **输入上下文**: 集群成员 YAML、正文、相似度、引用统计、最近修改时间。
- **输出 Schema**:
    ```json
    {
        "type": "object",
        "required": ["decision", "survivor_node_id", "audit_report", "reasoning"],
        "properties": {
            "decision": {"enum": ["merge", "retain"]},
            "survivor_node_id": {"type": "string"},
            "merged_yaml": {"type": "string"},
            "merged_markdown": {"type": "string"},
            "redirect_mapping": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["from", "to"],
                    "properties": {
                        "from": {"type": "string"},
                        "to": {"type": "string"}
                    }
                }
            },
            "audit_report": {"type": "string"},
            "reasoning": {"type": "string"}
        }
    }
    ```
- **条件约束**:
    - 当 `decision=merge` 时，必须提供 `merged_yaml`, `merged_markdown`, `redirect_mapping`。
    - 当 `decision=retain` 时，`redirect_mapping` 可选，但需列出被忽略节点及理由。

### 3.5 FactVerification
- **输入上下文**: 节点正文片段、待核主张、Provider Grounding 能力说明。
- **输出 Schema**:
    ```json
    {
        "type": "object",
        "required": ["entries"],
        "properties": {
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["timestamp", "claim", "sources", "verdict", "reasoning"],
                    "properties": {
                        "timestamp": {"type": "string", "format": "date-time"},
                        "claim": {"type": "string"},
                        "sources": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["url", "title", "confidence"],
                                "properties": {
                                    "url": {"type": "string", "format": "uri"},
                                    "title": {"type": "string"},
                                    "confidence": {"type": "number", "minimum": 0, "maximum": 1}
                                }
                            }
                        },
                        "verdict": {"enum": ["supported", "refuted", "unknown"]},
                        "reasoning": {"type": "string"}
                    }
                }
            }
        }
    }
    ```
- **提醒**: 不得虚构来源；若无法验证则 `verdict=unknown` 并解释限制。

### 3.6 UndoExecution
- **任务定位**：UndoExecution 为系统级确定性流程，不调用任何 LLM。插件直接读取 `ChangeSnapshot`，按顺序写回文件，并执行校验哈希。
- **输入**：`undoPointer`、目标节点快照、原任务元数据（供审计展示）。
- **执行步骤**：
    1. 校验快照文件是否存在且校验和匹配。
    2. 替换磁盘文件内容并恢复 YAML `nodeState`。
    3. 将原任务标记为 `Reverted`，记录恢复时间。
- **失败策略**：若快照缺失或文件校验失败，系统直接将 `UndoExecution` 标记为 `Failed`，并提示用户手动介入；无模型补救步骤。

## 4. Prompt 构建流水线
1. 队列任务请求 Prompt 时，从 `providers.json` 获取 `ProviderProfile` 并验证能力；针对 Gemini 使用 `@google/genai`、OpenRouter 使用 `@openrouter/sdk`、OpenAI 使用官方 REST 客户端，均需声明是否支持 JSON Schema、流式输出与多轮对话。
2. 根据 `target_language` 与 Provider 能力筛选模板；若 Provider 不支持 `zh-CN`，自动切换到英文模板并记录警告日志。
3. 加载对应模板、插入动态变量、裁剪上下文长度（保留最近历史）。
4. 附加 `<REMINDER>`：重申 AX-1、AX-2、AX-6 并提示输出格式及目标语言标签。
5. 生成的 Prompt 通过静态检查器校验标签、Schema、示例完整性，并验证 `providerHints.supported_languages` 与实际构建语言一致。
6. 调用模型；若响应未通过 JSON Schema 校验，自动重试一次，仍失败则将任务标记 `Failed` 并提示用户补充信息。

## 5. 输出风格控制
- 模板默认要求模型输出 JSON；如 Provider 不支持 JSON Mode，则在 `<INSTRUCTION>` 中要求使用 fenced code block。
- `reasoning` 字段使用编号列表，并鼓励使用 `$` 符号提供必要公式或条件。
- 允许 `markdown` 字段包含层级标题、表格、数学公式；需遵守 Schema 规定的顺序。

## 6. 模板维护流程

- Schema 变更流程：
    1. 更新 `docs/schemas/node_schemas.json`、System Formalism 与 PRD 中的字段定义。
	2. 调整对应模板 `<SCHEMA>` 并提升次版本号。
	3. 使用 Mock Provider 跑通回归测试并验证 JSON 校验。
- Provider 变更流程：新增 Provider 时更新 `providerHints`，验证其能力满足任务需求。
- 回滚策略：保留最近三个版本的模板，允许在设置页选择指定版本用于问题定位。

## 7. 写作风格约束（供 Prompt 引导）
- 使用精确、客观的第三人称叙述。
- 使用定义、分类、因果关系和逻辑结构组织信息。
- 禁止不解释微观机制细节就使用“涌现”。
- 避免非量化形容词（如“核心”“关键”“重要”）。
- 对复杂信息使用层次化列表；必要时使用 LaTeX 表达公式。
- 对内联代码使用反引号；对 **关键术语** 采用粗体。
- 若段落超过三句，需以 *斜体* 句子概括主旨。
- 输出为 JSON 结构，无额外前后缀或自我评估。

## 8. Provider 参考信息
- **Gemini 模型概览**: 推荐 `gemini-3-pro` 用于多模态高推理任务，`gemini-2.5-pro` 处理长上下文与复杂代码推理，`gemini-2.5-flash` 适配低延迟批量场景，`gemini-2.5-flash-lite` 优化吞吐，`gemini-2.0-flash` 支持 100 万词元输入；命名遵循稳定、预览、最新、实验四类别名策略。
- **@google/genai SDK**: 需要 Node.js ≥20，使用 `npm install @google/genai`；可通过 `new GoogleGenAI({apiKey})` 或设置 `GOOGLE_API_KEY` 初始化，Vertex AI 模式需 `GOOGLE_GENAI_USE_VERTEXAI`、`GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`；核心子模块 `ai.models`、`ai.chats`、`ai.caches`、`ai.files`、`ai.live` 分别提供生成、对话、上下文缓存、文件上传与实时交互，`generateContentStream` 支持流式输出，错误统一抛出 `ApiError`。
- **OpenRouter REST API**: 基础端点 `https://openrouter.ai/api/v1/chat/completions`，使用 `Authorization: Bearer <OPENROUTER_API_KEY>` 并可附加 `HTTP-Referer`/`X-Title` 标识应用；请求体遵循 OpenAI Chat Schema，支持 `response_format` 强制 JSON、`tools`/`tool_choice`、`transforms`、`models`/`route` 自定义路由、`stream: true` 开启 SSE 流；响应 `choices` 队列与 `usage` 统计与 OpenAI 兼容。
- **OpenRouter TypeScript SDK**: `npm install @openrouter/sdk` 后通过 `new OpenRouter({apiKey})` 实例化；提供类型安全的 `client.chat.send`，自动感知新模型与参数变更，编译期校验消息结构与模型约束，`stream: true` 返回可迭代异步生成器。
- **OpenAI API**: 标准基址 `https://api.openai.com/v1`，请求头需 `Authorization: Bearer <OPENAI_API_KEY>` 与 `Content-Type: application/json`；`/chat/completions` 接口支持 `response_format` JSON 指令、函数调用工具、`seed`、`response_metadata`，与本插件 JSON Schema 校验链路兼容。
- **Obsidian 插件环境**: 插件需保持 `manifest.json` 中英文名称与描述，遵守官方开发者政策；运行期可通过 `app.vault.getConfig('locale')` 读取用户语言，在 Prompt 构建阶段映射到 `zh-CN` 或 `en-US` 模板，所有界面字符串需提供双语文案并默认英文回退。
