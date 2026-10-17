<system_instructions>
{{BASE_KNOWLEDGE_POLICY}}

{{BASE_WRITE_POLICY}}

{{BASE_OUTPUT_FORMAT}}
</system_instructions>

<context_slots>
<concept_info>
{{CTX_META}}
</concept_info>
<previously_generated>
{{CTX_PREVIOUS}}
</previously_generated>
</context_slots>

<task_instruction>
生成 historical_genesis、holistic_understanding、boundary_conditions。
historical_genesis 解释问题如何形成、争论在何处分叉；有证据的时期写入相应三级标题的括号。
holistic_understanding 依次使用四个固定三级标题 `### 本体论`、`### 认识论`、`### 目的与功能`、`### 实践和价值`，不加冒号副标题。本体论解释对象的构成、关系与存在条件；认识论解释知识获取途径、证据与认识限度；目的与功能区分因果作用、人的用途与对象明确具有的目标；实践和价值解释运用条件、价值判断的依据及对相关群体的影响。只分析当前对象；某维度不适用时说明理由。随后在字段末尾按专业主题用三级标题展开额外补充，只补足前文字段尚未解释、掌握本主题所必需的专业内容；争议说明分歧所在的定义、前提、证据或推理。
各回答的论证与边界分开说明，不把后出现的立场写成已解决争论。boundary_conditions 说明各回答成立或失效的条件。
</task_instruction>
