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
生成 causal_chain 与 modulation。
causal_chain 按说明过程所需的顺序编号，在 description 与 interaction 中解释各步变化和对象间作用；反馈、并行路径、时滞或随机性存在时明确标出相互关系，不将编号解释为单向线性因果。
modulation 说明各调节因素在什么条件下、经何种作用途径改变过程。
</task_instruction>
