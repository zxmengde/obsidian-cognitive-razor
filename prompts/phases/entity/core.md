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
生成 definition、classification、properties、states、constraints、distinguishing_features。
definition 保持对象的具体指称，区别类别与实例。
classification 按各套适用的通行标准给出最近上位类与种差；划分依据或归属规则不同的标准分别记录，同一依据和归属规则的异名标准合并。classification_basis 只写该套标准的简短维度名或正式名称；不同标准的名称须能区分，同一标准名称保持一致，不为增加条目自造标准。
properties 说明属性及其条件；states 说明同一对象在明确条件下可区分的状态或模式，没有可靠区分时返回 []。
constraints 说明存在或运作的限制；distinguishing_features 说明与邻近概念的判别依据。
</task_instruction>
