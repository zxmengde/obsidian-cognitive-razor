import { CognitiveRazorError } from "../types";
import type { ChatRequest } from "../types";

type ChatMessage = ChatRequest["messages"][number];

/** Convert the rendered prompt into the single system message plus user input
 * consumed by every protocol adapter. Keep this rule in one place so exports
 * and runtime requests cannot silently diverge. */
export function splitPromptIntoMessages(prompt: string): ChatMessage[] {
  const sysMatch = prompt.match(/<system_instructions>([\s\S]*?)<\/system_instructions>/);
  if (!sysMatch || !sysMatch[1].trim()) {
    throw new CognitiveRazorError(
      "E101_INVALID_INPUT",
      "提示词缺少有效的 <system_instructions> 区块",
    );
  }

  const systemContent = sysMatch[1].trim();
  const userContent = prompt.replace(/<system_instructions>[\s\S]*?<\/system_instructions>/, "").trim();
  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}
