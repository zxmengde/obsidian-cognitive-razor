import type { CRType, TaskRecord, TaskStageId } from "../types";
import {
  getStageDefinition,
  getStageRole,
  type StageCommitPolicy,
} from "./stage-catalog";

export type StageLabelResolver = (key: string) => string;

/** UI read model derived from the stage catalog and the task's confirmed input. */
export interface StageDescriptor {
  id: TaskStageId;
  role: "tag" | "write" | "verify" | "cards";
  order: number;
  label: string;
  shortLabel: string;
  fields?: string[];
  commitPolicy: StageCommitPolicy;
}
const defaultLabelResolver: StageLabelResolver = (key) => key;

function getTaskConceptType(task: Pick<TaskRecord, "payload" | "conceptType">): CRType | undefined {
  const payload = task.payload;
  if ("concept" in payload && payload.concept) return payload.concept.type;
  if ("noteType" in payload) return payload.noteType;
  return task.conceptType;
}

export function getStageDescriptor(
  task: Pick<TaskRecord, "stageId" | "payload" | "conceptType">,
  translate: StageLabelResolver = defaultLabelResolver,
): StageDescriptor {
  const type = getTaskConceptType(task);
  const stageId = task.stageId;
  if (stageId === "cards") return { id: stageId, role: "cards", order: 0, label: translate("workbench.stages.cards"), shortLabel: translate("workbench.stages.cards"), commitPolicy: "cards" };
  const definition = getStageDefinition(type, stageId);

  if (!definition) {
    return {
      id: stageId,
      role: getStageRole(stageId),
      order: Number.MAX_SAFE_INTEGER,
      label: translate("workbench.stages.unknown"),
      shortLabel: translate("workbench.stages.unknownShort"),
      commitPolicy: "content",
    };
  }

  return {
    id: definition.id,
    role: definition.role,
    order: definition.order,
    label: translate(definition.labelKey),
    shortLabel: translate(definition.shortLabelKey),
    fields: definition.fields ? [...definition.fields] : undefined,
    commitPolicy: definition.commitPolicy,
  };
}
