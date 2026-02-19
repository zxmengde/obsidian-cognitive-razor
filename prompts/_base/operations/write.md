<context_slots>
  <metadata>
{{CTX_META}}
  </metadata>
  <sources>
{{CTX_SOURCES}}
  </sources>
</context_slots>

<task_instruction>
  根据 <system_instructions> 中定义的 <output_schema> 为此笔记生成结构化内容。

  要求：
  1. 输出必须是原始 JSON 文本。不要使用 Markdown 代码块。
  2. 自然语言字段使用 {{CTX_LANGUAGE}} 作为主要语言。
  3. 严格遵循 Schema：所有必填字段必须存在。
  4. 如果提供了 <sources>，在相关处将其作为证据/引用融入。
</task_instruction>
