import type { CRFrontmatter, CRType } from "./domain";

export interface DuplicateMergeNoteSnapshot {
  nodeId: string;
  path: string;
  content: string;
  contentHash: string;
  frontmatter: CRFrontmatter;
}

/** Editable model proposal. It deliberately excludes CRUID and other identity fields. */
export interface DuplicateMergeDraft {
  pairId: string;
  canonicalNodeId: string;
  redundantNodeId: string;
  canonicalContentHash: string;
  redundantContentHash: string;
  body: string;
  name: string;
  aliases: string[];
  tags: string[];
  parents: string[];
  sourceUids: string[];
  conflicts: string[];
}

export interface LinkRepairEntry {
  path: string;
  expectedContent: string;
  replacementContent: string;
  replacements: number;
}

export interface LinkRepairPlan {
  entries: LinkRepairEntry[];
  replacementCount: number;
  skipped: string[];
}

export interface DuplicateMergePreview {
  pairId: string;
  type: CRType;
  similarity: number;
  canonical: DuplicateMergeNoteSnapshot;
  redundant: DuplicateMergeNoteSnapshot;
  draft: DuplicateMergeDraft;
  linkRepairPlan: LinkRepairPlan;
}

export type DuplicateMergePhase =
  | "prepared"
  | "canonical-written"
  | "links-repaired"
  | "canonical-indexed"
  | "redundant-trash-pending"
  | "redundant-trashed"
  | "completed"
  | "failed";

export interface DuplicateMergeOperation {
  id: string;
  version: "1.0.0";
  phase: DuplicateMergePhase;
  preview: DuplicateMergePreview;
  canonicalTargetContent: string;
  completedPaths: string[];
  error?: { code: string; message: string };
  updatedAt: number;
}

export interface DuplicateMergeOperationsStore {
  version: "1.0.0";
  operations: DuplicateMergeOperation[];
}
