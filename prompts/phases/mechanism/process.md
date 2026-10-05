<system_instructions>
{{BASE_WRITE_POLICY}}
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
根据以上概念信息、前序草稿和可能提供的候选证据，生成 `causal_chain` 和 `modulation`：
- 因果步骤按实际时间或依赖顺序编号。每步说明输入状态、发生的相互作用和可观察输出；只有证据建立方向时才写因果，缺失环节应明确标为“待核实”，不要用常识补齐。
- 步骤数量以解释过程所需为准，不为“完整”加入无依据中间步骤，也不声称每步均不可省略。
- 调节因素只在其作用方向和路径能够确认时收录；`promotes`、`inhibits`、`regulates` 描述当前证据支持的效果，不外推到所有条件。

逐步解释转换如何发生、关键条件和中间推理；必要公式说明符号和成立条件，有可靠实例时说明对应关系。篇幅以解释过程为准，不用术语代替解释。
</task_instruction>
