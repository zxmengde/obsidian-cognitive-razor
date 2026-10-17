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
生成 sub_domains 与 issues。
sub_domains 只列父领域内通行的直属研究门类或分支，分支须有稳定的研究内容与知识积累；按研究目标形成的通行领域不得仅因面向实践而排除。研究活动、研发阶段或操作流程本身不作为子领域；不得把并列学科或目标拼成新领域名，正式复合学科名称保持完整。description 说明各分支的研究内容、范围和与本领域的关系。
issues 列出直接属于本领域、可独立研究的问题；description 说明争议或求解目标，以及与本领域的直接联系。仅通过某子领域间接相关的问题不列入。
</task_instruction>
