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
1. `definition` 采用最接近且稳定的上位类与区分特征；对有争议或依理论而变的实体明确采用的框架。
2. `classification` 的 `genus` 使用最近上位类，`differentia` 给出本质区分；无法建立严格属种关系时用最接近的公认分类并标明限制。
3. `properties` 区分不依赖关系的 `intrinsic` 与依赖关系的 `extrinsic`，只列有依据的代表性属性；不要把用途写成属性。
4. `states` 只列同一实体在条件变化下的状态，不把子类型或相关实体误作状态。
5. `constraints` 说明限制及其来源；`distinguishing_features` 与具体邻近概念对比，避免和 classification 重复。

解释核心概念、条件与关系的含义、作用和成立依据，补足理解结论所需的中间推理；有可靠实例时说明与概念的对应，必要公式说明符号和适用条件。篇幅由知识结构决定，不用术语或一句概括代替必要解释。
</task_instruction>
