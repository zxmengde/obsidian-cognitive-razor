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
1. `definition` 说明理论解释什么、采用什么核心概念以及适用范围；只有确有依据时才写形成背景。
2. `axioms` 按理论性质记录基本前提。形式理论可称公理；经验理论应明确是原则、理想化或可修正假设，不把它们写成已证明真理。`justification` 说明该前提在理论中的作用和依据，不声称逻辑上不可或缺，除非能够证明。
3. `logical_structure` 从前提到中间关系再到结论，明确区分定义、推导和经验假设；遇到缺失环节时标明，不用文字流畅掩盖跳跃。
4. `core_predictions` 写与理论类型相适应的可检验后果或判别条件；非经验理论不要虚构实验预测。
5. `limitations` 给出已知适用条件、近似、反例或未覆盖现象。

解释核心概念、条件与关系的含义、作用和成立依据，补足理解结论所需的中间推理；有可靠实例时说明与概念的对应，必要公式说明符号和适用条件。篇幅由知识结构决定，不用术语或一句概括代替必要解释。
</task_instruction>
