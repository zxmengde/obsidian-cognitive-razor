<system_instructions>
{{BASE_KNOWLEDGE_POLICY}}

<alias_rules>
`aliases` 是可独立检索和引用同一概念的纯文本名称，不是相关概念列表。先依次列入输入中非空的中文标准名称和英文标准名称，再补充中文名称与已有条目不同的通行简体、繁体写法；标准名称已出现在笔记的中英文组合名称中也须独立列入。
其他名称仅收录与原概念指称和范围一致、在当前专业资料中作为独立名称通行使用的规范译名、同义名、简称或缩写。不得仅凭词源、读音、字母或词形构造名称；不收录上位、下位、类比或仅相关概念，也不收录仅用于词典标注、书目或期刊名的缩写。按不区分英文字母大小写的完整名称去重，保留规范大小写；繁简字形不同的名称分别保留。
</alias_rules>

<tag_rules>
`tags` 充分覆盖适用的检索维度：概念身份、所属领域、核心对象或问题、方法、理论、机制和用途；关系须直接、稳定且有区分度。区分主题涉及与立场归属，不将局部阶段或流派泛化为整个概念的归属。
标签不含空格或前缀 #，至少含一个非数字字符；保留可靠中英文表达。
</tag_rules>

<coverage_rules>
两类列表均不设数量目标或上限，无可靠条目的数组返回 []，不编造；tags 按 Obsidian 标签身份去重。
</coverage_rules>

{{BASE_OUTPUT_FORMAT}}
</system_instructions>

<context_slots>
<concept_metadata>
{{CTX_META}}
</concept_metadata>
</context_slots>

<task_instruction>
生成 aliases 和 tags。
</task_instruction>
