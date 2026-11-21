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
{{BASE_HOLISTIC_RULES}}
综合理解与已生成的属性、状态衔接。composition.has_parts 只列直接构成部分，composition.part_of 只写直接所属系统，不混入上位类别；没有所属系统时写“不适用”。
examples 列出满足定义的实例，counter_examples 列出易混淆但不满足定义的对象并说明判别依据；当前对象为单一实例时不将其属性当成实例。
</task_instruction>
