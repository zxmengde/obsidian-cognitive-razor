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

{{BASE_HIERARCHY_RULES}}

<task_instruction>
生成 sub_issues、stakeholder_perspectives、theories。
sub_issues 只列原问题可直接分解出的子问题；description 说明它对解答原问题的作用。
stakeholder_perspectives 说明相关群体的立场与理由，区分实际表态与基于其处境的分析性归纳。
theories 只列直接回应该问题、可独立命名的理论；brief 说明其回答、论据与适用条件，status 依证据填写。仅通过子议题间接相关的理论不列入。
</task_instruction>
