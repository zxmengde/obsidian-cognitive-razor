# 示例提示词

以下文件是由 `npm run prompts:generate` 基于当前模板实际生成的完整示例。

## 1. Define：概念分类与标准化命名

示例输入：`量子纠缠`

[查看完整提示词](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-define.md)

结构重点：稳定的分类规则、知识真实性约束、输出 Schema 位于前缀；具体输入位于 `<context_slots>`。

```text
<system_instructions>
<role>
你是秉持严谨、学术、客观立场的本体分类与术语标准化专家。
...
</role>
...
</system_instructions>

<context_slots>
<concept_input>
量子纠缠
</concept_input>
</context_slots>

<task_instruction>
根据以上输入和可能提供的候选证据，完成分类和术语标准化。
最终只输出 API Schema 要求的 JSON，不展示分析过程。
</task_instruction>
```

## 2. Write / Domain / Core：领域核心框架

示例概念：`量子信息科学 (Quantum Information Science)`

[查看完整提示词](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-domain-core.md)

```text
<system_instructions>
<role>
你负责生成一个结构化知识图谱中的指定概念类型知识节点的核心框架，
使定义、研究目标、认识方法和边界能够相互校验。
当前阶段只处理提示词中指定的概念类型。
</role>
...
</system_instructions>

<context_slots>
<concept_type>
domain
</concept_type>
<concept_info>
{
  "standard_name_cn": "量子信息科学",
  "type": "domain",
  "standard_name_en": "Quantum Information Science"
}
</concept_info>
</context_slots>

<task_instruction>
根据以上概念信息和可能提供的候选证据，生成本阶段字段：
1. `definition`
2. `core_questions`
3. `methodology`
4. `boundaries`
</task_instruction>
```

## 3. Write / Theory / Structure：结构拆分

[查看完整提示词](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-theory-structure.md)

这个阶段展示了动态的 `concept_type`、概念信息和前序草稿如何放在稳定系统规则之后；输出任务只要求 `sub_theories`、`entities` 和 `mechanisms`。

## 4. Verify：事实核查

[查看完整提示词](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-verify.md)

Verify 示例包含当前概念元数据和待核查正文，适合检查证据约束、未知信息处理和输出格式。

## 5. API 请求形态

[查看 Domain/Core 的 API payload](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/api-payload-write-domain-core.json)

该文件同时列出 OpenAI Chat Completions、OpenAI Responses 和 Gemini 三种协议的映射。当前生成脚本使用默认能力配置，因此示例展示的是兼容路径；启用 GPT-6 explicit 缓存后，Responses 请求会把稳定系统前缀放入 developer `input_text`，并附加 `prompt_cache_breakpoint`。

## 6. 全部示例

- [Define](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-define.md)
- [Tag](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-tag.md)
- [Verify](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-verify.md)
- [Write / Domain](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-domain-core.md)
- [Write / Issue](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-issue-core.md)
- [Write / Theory](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-theory-core.md)
- [Write / Entity](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-entity-core.md)
- [Write / Mechanism](C:/CODE/obsidian/.obsidian/plugins/obsidian-cognitive-razor/scripts/output/prompt-write-mechanism-core.md)
