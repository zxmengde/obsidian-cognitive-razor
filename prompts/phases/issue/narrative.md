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
{{BASE_HOLISTIC_RULES}}
各回答的论证与边界分开说明，不把后出现的立场写成已解决争论。boundary_conditions 说明各回答成立或失效的条件。
</task_instruction>
