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

<hierarchy_rules>
父子层级与关联列表按各自关系组织；包含、组成、实例与用途不得混为同一父子关系。以下覆盖规则只约束 sub_domains、sub_issues、sub_theories，不约束关联清单。
1. 保持输入的父项范围，只列直属下一层，子项须符合字段规定关系；每套分类以子项范围的并集等于父项范围为覆盖目标。依据不足时只列有据项，在 description 说明已知覆盖范围，禁止为覆盖编造项目，也不得自造合并项或兜底项补齐。
2. 逐一检查适用于父项的通行分类标准；划分依据或归属规则不同的适用标准分别呈现，不因已有一套分类而省略其余。同一划分依据和归属规则的异名标准合并，不为增加组数自造标准。
3. 每套分类单独分组，classification_basis 只写该套标准的简短维度名或正式名称，不写说明句；不同标准的名称须能区分，同一标准名称保持一致。同组使用同一分类依据、直接关系和相当粒度，不混合不同体系或分类维度。各组仍须满足该字段的关系并保持父项范围，不截取或改写范围不符的体系；分类标准本身不生成概念节点。
4. 合并同组内同义和实质重复项；跨组交叉不因此删除条目，交叉归属在 description 说明，不为消除交叉而改写对象范围或拼造名称。
</hierarchy_rules>

<task_instruction>
生成 sub_theories、entities、mechanisms。
sub_theories 只列与本理论有直接包含或专门化关系的子理论，description 说明专门化的前提或范围；竞争理论、历史前身和应用领域不列为子理论。
entities 只列本理论直接使用且可独立命名的对象，说明其对解释或推导的作用，不重写完整定义。通用对象可以列入；仅经某子理论间接关联的对象不列入。
mechanisms 只列本理论直接使用、由对象相互作用产生变化的过程；process 说明变化步骤，function 说明其解释作用。定律、定理和推导步骤不列为机制；没有可靠机制时返回 []。
</task_instruction>
