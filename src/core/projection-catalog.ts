import type { CRType } from "../types";
import type { ProjectionId } from "../types/projection-id";

/** Semantic renderers for structured object arrays in Markdown projections. */
export type MarkdownArrayProjection =
  | "linked-name-description"
  | "plain-name-description"
  | "stakeholder-perspective"
  | "theory"
  | "axiom"
  | "theory-entity"
  | "theory-mechanism"
  | "entity-property"
  | "operates-on"
  | "causal-chain"
  | "modulation";

/** Only these structured fields create forward links to typed child notes. */
export const STRUCTURAL_LINK_TARGET_TYPES: Readonly<Record<string, CRType>> = {
  sub_domains: "domain", issues: "issue", sub_issues: "issue", theories: "theory",
  sub_theories: "theory", entities: "entity", mechanisms: "mechanism",
};

/** Field-to-projection mapping; schema remains the field existence authority. */
export const MARKDOWN_ARRAY_PROJECTIONS: Readonly<Record<string, MarkdownArrayProjection>> = {
  sub_domains: "linked-name-description",
  issues: "linked-name-description",
  sub_issues: "linked-name-description",
  sub_theories: "linked-name-description",
  states: "plain-name-description",
  stakeholder_perspectives: "stakeholder-perspective",
  theories: "theory",
  axioms: "axiom",
  entities: "theory-entity",
  mechanisms: "theory-mechanism",
  properties: "entity-property",
  operates_on: "operates-on",
  causal_chain: "causal-chain",
  modulation: "modulation",
};

export function getMarkdownArrayProjection(fieldName: string): MarkdownArrayProjection | undefined {
  return MARKDOWN_ARRAY_PROJECTIONS[fieldName];
}

export type { ProjectionId } from "../types/projection-id";

export interface ProjectionDefinition {
  readonly id: ProjectionId;
  /** Durable facts read by the projection; these are not workflow stages. */
  readonly inputFacts: readonly string[];
  readonly outputStore: string;
  readonly trigger: "manual" | "upstream-change";
  readonly dependsOn: readonly ProjectionId[];
}

/** Derived jobs have an explicit boundary and never become workflow stages. */
export const PROJECTION_CATALOG: readonly ProjectionDefinition[] = [
  {
    id: "index",
    inputFacts: ["vault-note-frontmatter", "vault-note-body", "embedding-config"],
    outputStore: "vector-index",
    trigger: "manual",
    dependsOn: [],
  },
  {
    id: "duplicates",
    inputFacts: ["vector-index", "duplicate-detection-setting"],
    outputStore: "duplicate-pairs",
    trigger: "upstream-change",
    dependsOn: ["index"],
  },
];
