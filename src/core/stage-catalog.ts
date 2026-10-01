import { CR_TYPES } from "../types/domain";
import type { CRType } from "../types/domain";
import { TASK_STAGE_IDS } from "../types/task";
import type { QueueTaskType, TaskStageId, WriteTaskStageId } from "../types/task";

/** The executor and model configuration role derived from a concrete stage. */
export type StageRole = QueueTaskType;

/** The durable side effect owned by a completed stage. */
export type StageCommitPolicy = "frontmatter" | "content" | "report" | "cards";

/** The complete product contract for one concrete workflow stage. */
export interface StageDefinition {
  readonly id: TaskStageId;
  readonly order: number;
  readonly role: StageRole;
  readonly conceptTypes: readonly CRType[];
  readonly fields: readonly string[];
  readonly labelKey: string;
  readonly shortLabelKey: string;
  /** Path relative to the prompts directory, without the .md suffix. */
  readonly promptTemplateKey: string;
  /** Stable key for the output validation contract. */
  readonly outputSchemaKey: string;
  readonly commitPolicy: StageCommitPolicy;
  readonly optional: boolean;
}

const ALL_TYPES = Object.freeze([...CR_TYPES]) as readonly CRType[];

function writeStage(
  type: CRType,
  stageId: TaskStageId,
  order: number,
  labelKey: string,
  fields: readonly string[],
): StageDefinition {
  return {
    id: stageId,
    order,
    role: "write",
    conceptTypes: Object.freeze([type]),
    fields,
    labelKey,
    shortLabelKey: `${labelKey}Short`,
    promptTemplateKey: `phases/${type}/${stageId}`,
    outputSchemaKey: `${type}:${stageId}`,
    commitPolicy: "content",
    optional: false,
  };
}

/**
 * The only stage metadata source. Queue identity, ordering, labels, prompt
 * paths, output contracts and commit policy must be declared here together.
 */
export const STAGE_CATALOG: readonly StageDefinition[] = [
  {
    id: "tag",
    order: 10,
    role: "tag",
    conceptTypes: ALL_TYPES,
    fields: [],
    labelKey: "workbench.stages.tag",
    shortLabelKey: "workbench.stages.tagShort",
    promptTemplateKey: "base/operations/tag",
    outputSchemaKey: "tag",
    commitPolicy: "frontmatter",
    optional: false,
  },
  writeStage("domain", "core", 20, "workbench.stages.write.core", ["definition", "core_questions", "methodology", "boundaries"]),
  writeStage("domain", "narrative", 30, "workbench.stages.write.narrative", ["historical_genesis", "holistic_understanding"]),
  writeStage("domain", "structure", 40, "workbench.stages.write.structure", ["sub_domains", "issues"]),
  writeStage("issue", "core", 20, "workbench.stages.write.core", ["definition", "core_tension", "significance", "epistemic_barrier", "counter_intuition"]),
  writeStage("issue", "narrative", 30, "workbench.stages.write.narrative", ["historical_genesis", "holistic_understanding", "boundary_conditions"]),
  writeStage("issue", "structure", 40, "workbench.stages.write.structure", ["sub_issues", "stakeholder_perspectives", "theories"]),
  writeStage("theory", "core", 20, "workbench.stages.write.core", ["definition", "axioms", "logical_structure", "core_predictions", "limitations"]),
  writeStage("theory", "narrative", 30, "workbench.stages.write.narrative", ["historical_genesis", "holistic_understanding"]),
  writeStage("theory", "structure", 40, "workbench.stages.write.structure", ["sub_theories", "entities", "mechanisms"]),
  writeStage("entity", "core", 20, "workbench.stages.write.core", ["definition", "classification", "properties", "states", "constraints", "distinguishing_features"]),
  writeStage("entity", "synthesis", 30, "workbench.stages.write.synthesis", ["holistic_understanding", "composition", "examples", "counter_examples"]),
  writeStage("mechanism", "core", 20, "workbench.stages.write.core", ["definition", "trigger_conditions", "operates_on", "inputs", "outputs", "side_effects", "termination_conditions"]),
  writeStage("mechanism", "process", 30, "workbench.stages.write.process", ["causal_chain", "modulation"]),
  writeStage("mechanism", "synthesis", 40, "workbench.stages.write.synthesis", ["holistic_understanding"]),
  {
    id: "verify",
    order: 100,
    role: "verify",
    conceptTypes: ALL_TYPES,
    fields: [],
    labelKey: "workbench.stages.verify",
    shortLabelKey: "workbench.stages.verifyShort",
    promptTemplateKey: "base/operations/verify",
    outputSchemaKey: "verify",
    commitPolicy: "report",
    optional: false,
  },
] as const;

const STAGE_ROLES: ReadonlyMap<TaskStageId, StageRole> = (() => {
  const roles = new Map<TaskStageId, StageRole>([["cards", "cards"]]);
  for (const stage of STAGE_CATALOG) {
    const existing = roles.get(stage.id);
    if (existing !== undefined && existing !== stage.role) {
      throw new Error(`Stage ${stage.id} has conflicting roles in STAGE_CATALOG`);
    }
    roles.set(stage.id, stage.role);
  }
  for (const stageId of TASK_STAGE_IDS) {
    if (!roles.has(stageId)) {
      throw new Error(`Stage ${stageId} is missing from STAGE_CATALOG`);
    }
  }
  return roles;
})();

function supportsType(stage: StageDefinition, type: CRType | undefined): boolean {
  return type === undefined || stage.conceptTypes.includes(type);
}

export function getStageDefinition(type: CRType | undefined, stageId: TaskStageId): StageDefinition | undefined {
  return STAGE_CATALOG.find((stage) => stage.id === stageId && supportsType(stage, type));
}

export function getWriteStageDefinitions(type: CRType): readonly StageDefinition[] {
  return STAGE_CATALOG.filter((stage) => stage.role === "write" && stage.conceptTypes.includes(type));
}

export function getWriteStageDefinition(type: CRType, stageId: string): StageDefinition | undefined {
  return getStageDefinition(type, stageId as TaskStageId);
}

export function getWriteStageIds(type: CRType): TaskStageId[] {
  return getWriteStageDefinitions(type).map((stage) => stage.id);
}

/**
 * Queue execution and model selection are a projection of the stage identity.
 * This is intentionally independent of concept type so terminal queue history
 * can still be rendered after its workflow artifact is removed.
 */
export function getStageRole(stageId: TaskStageId): StageRole {
  const role = STAGE_ROLES.get(stageId);
  if (!role) throw new Error(`Stage ${stageId} is missing from STAGE_CATALOG`);
  return role;
}

export function isWriteStage(stageId: TaskStageId): stageId is WriteTaskStageId {
  return getStageRole(stageId) === "write";
}

export function getStageIdsForType(type: CRType): TaskStageId[] {
  return STAGE_CATALOG
    .filter((stage) => supportsType(stage, type))
    .sort((left, right) => left.order - right.order)
    .map((stage) => stage.id);
}
