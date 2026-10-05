export const BASE_COMPONENT_MAP = Object.freeze({
  "{{BASE_KNOWLEDGE_POLICY}}": "knowledge-policy",
  "{{BASE_WRITING_STYLE}}": "writing-style",
  "{{BASE_ANTI_PATTERNS}}": "anti-patterns",
  "{{BASE_OUTPUT_FORMAT}}": "output-format",
  "{{BASE_WRITE_POLICY}}": "write-policy",
} as const);

export function injectPromptBaseComponents(
  content: string,
  components: Readonly<Record<string, string>>,
): { content: string; missingComponents: string[] } {
  let result = content;
  const missingComponents: string[] = [];
  for (const [placeholder, name] of Object.entries(BASE_COMPONENT_MAP)) {
    if (!result.includes(placeholder)) continue;
    const component = components[name];
    if (component === undefined) {
      missingComponents.push(name);
      continue;
    }
    result = result.split(placeholder).join(component);
  }
  return { content: result, missingComponents };
}

export function renderPromptTemplate(
  content: string,
  slots: Readonly<Record<string, string>>,
  optionalSlots: readonly string[] = [],
): { prompt: string; unreplacedVariables: string[] } {
  const unreplacedVariables: string[] = [];
  // Replace only the original template tokens. Inserted note text is never
  // scanned again, even if it contains the name of another template slot.
  const prompt = content.replace(/\{\{([^}]+)\}\}/g, (placeholder, key: string) => {
    if (Object.hasOwn(slots, key)) return slots[key];
    if (optionalSlots.includes(key)) return "";
    unreplacedVariables.push(placeholder);
    return placeholder;
  });
  return { prompt, unreplacedVariables };
}
