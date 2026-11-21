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
生成 sub_domains 与 issues。
sub_domains 只列父领域内通行的直属研究门类或分支，分支须有稳定的研究内容与知识积累；按研究目标形成的通行领域不得仅因面向实践而排除。研究活动、研发阶段或操作流程本身不作为子领域；不得把并列学科或目标拼成新领域名，正式复合学科名称保持完整。description 说明各分支的研究内容、范围和与本领域的关系。
issues 列出直接属于本领域、可独立研究的问题；description 说明争议或求解目标，以及与本领域的直接联系。仅通过某子领域间接相关的问题不列入。
</task_instruction>
