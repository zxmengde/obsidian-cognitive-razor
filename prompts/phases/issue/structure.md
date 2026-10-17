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
生成 sub_issues、stakeholder_perspectives、theories。
sub_issues 只列原问题可直接分解出的子问题；description 说明它对解答原问题的作用。
stakeholder_perspectives 说明相关群体的立场与理由，区分实际表态与基于其处境的分析性归纳。
theories 只列直接回应该问题、可独立命名的理论；brief 说明其回答、论据与适用条件，status 依证据填写。仅通过子议题间接相关的理论不列入。
</task_instruction>
