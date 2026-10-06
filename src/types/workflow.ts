import type { ConceptName, CRType } from "./domain";
import type { TaskStageId, WorkflowKind } from "./task";

/**
 * Durable Create workflows retain only the fields needed after confirmation.
 * Type and parent links are workflow facts, so they remain at the artifact
 * root instead of being copied into every queued payload.
 */
export interface ConceptSnapshot {
  name: ConceptName;
  coreDefinition: string;
}

export interface WorkflowArtifact {
  version: "7.0.0";
  workflowId: string;
  kind: WorkflowKind;
  state: "active" | "failed" | "completed" | "cancelled";
  nodeId: string;
  type: CRType;
  filePath: string;
  noteTitle: string;
  parents: string[];
  /** Frozen at Create confirmation. Absent on older artifacts: keep legacy bare links on replay. */
  directoryScheme?: import("./settings").DirectoryScheme;
  /** Create workflow fact; Verify workflows do not need a concept. */
  concept?: ConceptSnapshot;
  /** Whether a Create workflow captured automatic Verify at confirmation time. */
  autoVerify: boolean;
  tagResult?: { aliases: string[]; tags: string[] };
  accumulated: Record<string, unknown>;
  /** Server-side Responses continuation and stable cache routing. */
  conversation?: WorkflowConversation;
  /** Compact citation fallback; never stores page/search bodies. */
  sources?: SourcePackage;
  /** Validated result whose Vault side effect has not been confirmed yet. */
  pendingStageResult?: PendingStageResult;
  contentSnapshot?: string;
  noteCreated: boolean;
  /** 已成功更新 frontmatter / 正文 / Verify 报告的阶段，用于崩溃后幂等重放。 */
  appliedStageIds: TaskStageId[];
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowConversation {
  providerId: string;
  model: string;
  apiFormat?: import("./settings").ProviderApiFormat;
  endpoint?: string;
  promptVersion: string;
  promptCacheKey?: string;
  promptCacheMode?: "implicit" | "explicit";
  responseContinuationEnabled?: boolean;
  promptCachingEnabled?: boolean;
  systemPrompt?: string;
  responseId?: string;
    invalidReason?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    /** One native output list per verified U+A pair; bounded and disposable. */
    responsesOutputHistory?: import("./provider").ResponsesReplayItem[][];
}

export interface SourcePackageItem {
  url: string;
  title?: string;
}

export interface SourcePackage {
  items: SourcePackageItem[];
}

export interface PendingStageResult {
  stageId: TaskStageId;
  /** Stable workflow-local idempotency key for this Vault side effect. */
  commitId: string;
  /**
   * Durable time this commit was recorded. Replays reuse it so a rendered
   * note keeps byte-identical content while its frontmatter `updated` still
   * reflects the stage that wrote it.
   */
  committedAt?: number;
  result: Record<string, unknown>;
}

export type WorkflowPatch = Partial<Omit<WorkflowArtifact, "version" | "workflowId" | "createdAt">>;
