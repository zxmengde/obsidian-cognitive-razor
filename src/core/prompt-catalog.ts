import type { CRType, TaskType } from "../types";
import { getWriteStageDefinition, STAGE_CATALOG } from "./stage-catalog";

const DEFINE_PROMPT_TEMPLATE_KEY = "base/operations/define";
const MERGE_PROMPT_TEMPLATE_KEY = "base/operations/merge";

export function getOperationPromptTemplateKey(taskType: TaskType): string | undefined {
  if (taskType === "cards") return "base/operations/cards";
  if (taskType === "define") return DEFINE_PROMPT_TEMPLATE_KEY;
  if (taskType === "merge") return MERGE_PROMPT_TEMPLATE_KEY;
  if (taskType !== "tag" && taskType !== "verify") return undefined;
  return STAGE_CATALOG.find((stage) => stage.role === taskType)?.promptTemplateKey;
}

export function getOperationPromptTemplateKeys(): string[] {
  return [...new Set([
    "base/operations/cards",
    DEFINE_PROMPT_TEMPLATE_KEY,
    MERGE_PROMPT_TEMPLATE_KEY,
    ...STAGE_CATALOG
      .filter((stage) => stage.role === "tag" || stage.role === "verify")
      .map((stage) => stage.promptTemplateKey),
  ])];
}

export function getWritePromptTemplateKey(type: CRType, stageId: string): string | undefined {
  return getWriteStageDefinition(type, stageId)?.promptTemplateKey;
}
