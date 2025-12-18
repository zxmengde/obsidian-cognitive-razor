<context_slots>
  <metadata>
{{CTX_META}}
  </metadata>
  <sources>
{{CTX_SOURCES}}
  </sources>
</context_slots>

<task_instruction>
  Generate the structured content for this note according to the <output_schema> defined in <system_instructions>.

  Requirements:
  1. Output must be raw JSON text only. Do not use markdown code fences.
  2. Use {{CTX_LANGUAGE}} as the primary language for natural language fields.
  3. Follow the schema exactly: all required fields must be present.
  4. If <sources> is provided, incorporate it as evidence/citations when relevant.
</task_instruction>
