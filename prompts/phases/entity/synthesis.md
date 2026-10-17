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
生成 holistic_understanding、composition、examples、counter_examples。
holistic_understanding 依次使用四个固定三级标题 `### 本体论`、`### 认识论`、`### 目的与功能`、`### 实践和价值`，不加冒号副标题。本体论解释对象的构成、关系与存在条件；认识论解释知识获取途径、证据与认识限度；目的与功能区分因果作用、人的用途与对象明确具有的目标；实践和价值解释运用条件、价值判断的依据及对相关群体的影响。只分析当前对象；某维度不适用时说明理由。随后在字段末尾按专业主题用三级标题展开额外补充，只补足前文字段尚未解释、掌握本主题所必需的专业内容；争议说明分歧所在的定义、前提、证据或推理。
综合理解与已生成的属性、状态衔接。composition.has_parts 只列直接构成部分，composition.part_of 只写直接所属系统，不混入上位类别；没有所属系统时写“不适用”。
examples 列出满足定义的实例，counter_examples 列出易混淆但不满足定义的对象并说明判别依据；当前对象为单一实例时不将其属性当成实例。
</task_instruction>
