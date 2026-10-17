import type { TaskStageId } from "../types";

/** Minimal copy surface needed to name a task stage in the UI. */
export interface StageLabelMessages {
  workbench: {
    stages: {
      cards?: string;
      merge?: string;
      tag: string;
      verify: string;
      unknown: string;
      write: Record<string, string | undefined>;
    };
  };
}

/** Single source of truth for the stage name shown in queue UI. */
export function stageLabel(stageId: TaskStageId, t: StageLabelMessages): string {
  if (stageId === "cards") return t.workbench.stages.cards ?? "记忆卡片";
  if (stageId === "merge") return t.workbench.stages.merge ?? "合并稿";
  if (stageId === "tag") return t.workbench.stages.tag;
  if (stageId === "verify") return t.workbench.stages.verify;
  return t.workbench.stages.write[stageId] ?? t.workbench.stages.unknown;
}
