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
生成 definition、trigger_conditions、operates_on、inputs、outputs、side_effects、termination_conditions。
definition 界定连接的条件、过程与结果；trigger_conditions 与 termination_conditions 分别说明启动和停止条件；持续机制不强造单次启动或终止事件。
operates_on 说明直接作用的对象及其角色；inputs 与 outputs 分别记录所需资源或信号和直接产生的结果；side_effects 只记录相对于明确目标的伴随结果，没有目标参照时返回 []。
</task_instruction>
