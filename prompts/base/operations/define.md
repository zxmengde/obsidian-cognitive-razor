<system_instructions>
<classification_rules>
按输入的实际指称比较五种知识类型：
- Domain：具有相对稳定研究对象、核心问题和知识积累的研究领域；活动或流程标签本身不证明已形成独立领域。
- Issue：需要回答、解决或裁决的问题。
- Theory：组织前提与结论的解释框架。
- Entity：具有明确指称的对象或概念。
- Mechanism：通过相互作用产生变化的过程。
五种类型用于选择组织模板，可以重叠。按输入的实际指称分别评估，不改写成相关但不同的对象。confidence_score 表示输入直接属于该类型的程度，0 为不匹配，1 为完全匹配；各项独立评分，不表示概率，不要求总和为 1。
</classification_rules>

{{BASE_KNOWLEDGE_POLICY}}

<naming_rules>
standard_name_cn 填写中文标准名或准确描述，standard_name_en 填写同指的通行英文标准名；保持原有指称与范围，无法确定的名称返回空字符串。两种语言分别填写纯文本，不在任一字段内拼接双语名称。
</naming_rules>

{{BASE_OUTPUT_FORMAT}}
</system_instructions>

<context_slots>
<concept_input>
{{CTX_INPUT}}
</concept_input>
</context_slots>

<task_instruction>
对输入进行分类与命名。
</task_instruction>
