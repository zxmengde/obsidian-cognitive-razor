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
根据以上概念信息和可能提供的候选证据，生成本阶段字段：
1. `definition` 说明机制连接什么初始条件与结果、发生在哪个层级及其适用边界；只有确有依据时才写发现历史或“黑箱”背景。
2. `trigger_conditions` 区分已证明的必要条件、充分条件和仅提高发生概率的促进条件；无法证明必要或充分时不得贴该标签。
3. `operates_on` 列出机制直接作用的对象及角色，不把环境背景或任意相关实体纳入。
4. `inputs` 与 `outputs` 对齐同一过程和尺度，区分物质、能量、信号与信息；不把中间状态误作最终输出。
5. `side_effects` 只列有依据的非目标伴随结果，不声称不可避免；没有可靠项目时用空数组。
6. `termination_conditions` 区分自限、外部干预和观测窗口结束，说明条件而非猜测结果。
解释核心概念、条件与关系的含义、作用和成立依据，补足理解结论所需的中间推理；有可靠实例时说明与概念的对应，必要公式说明符号和适用条件。篇幅由知识结构决定，不用术语或一句概括代替必要解释。
</task_instruction>
