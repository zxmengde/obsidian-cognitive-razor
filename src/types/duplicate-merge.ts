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

/**
 * Read-only summary shown before any merge work starts.
 *
 * The merge preview needs a model draft, which costs a request; users must
 * first see which notes would be written and which would leave the vault.
 */
export interface DuplicateMergeImpact {
  pairId: string;
  type: CRType;
  similarity: number;
  canonical: { nodeId: string; path: string; name: string };
  redundant: { nodeId: string; path: string; name: string };
  /** Notes whose links would be rewritten to point at the canonical note. */
  linkedPaths: string[];
  linkReplacements: number;
  ambiguousLinks: string[];
}

/** Confirmed immutable inputs for one queued merge-draft request. */
export interface DuplicateMergeInput {
  pairId: string;
  type: CRType;
  similarity: number;
  canonical: DuplicateMergeNoteSnapshot;
  redundant: DuplicateMergeNoteSnapshot;
  linkRepairPlan: LinkRepairPlan;
}

export interface DuplicateMergePreview extends DuplicateMergeInput {
  draft: DuplicateMergeDraft;
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
