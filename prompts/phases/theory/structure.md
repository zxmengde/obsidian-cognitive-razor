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

{{BASE_HIERARCHY_RULES}}

<task_instruction>
生成 sub_theories、entities、mechanisms。
sub_theories 只列与本理论有直接包含或专门化关系的子理论，description 说明专门化的前提或范围；竞争理论、历史前身和应用领域不列为子理论。
entities 只列本理论直接使用且可独立命名的对象，说明其对解释或推导的作用，不重写完整定义。通用对象可以列入；仅经某子理论间接关联的对象不列入。
mechanisms 只列本理论直接使用、由对象相互作用产生变化的过程；process 说明变化步骤，function 说明其解释作用。定律、定理和推导步骤不列为机制；没有可靠机制时返回 []。
</task_instruction>
