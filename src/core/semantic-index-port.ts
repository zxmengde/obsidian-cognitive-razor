import type { Result, VectorFileRef } from "../types";
import type {
  SemanticIndexRebuildProgress,
  SemanticIndexRebuildSummary,
  SemanticIndexStatus,
} from "./semantic-index-rebuilder";
import type { VectorCleanupSummary, VectorIndexMaintenanceReport } from "./vector-index";

/** 索引操作由业务层定义，设置页与宿主只依赖这份接口。 */
export interface SemanticIndexPort {
  rebuildSemanticIndex(
    onProgress?: (progress: SemanticIndexRebuildProgress) => void,
  ): Promise<Result<SemanticIndexRebuildSummary>>;
  rebuildDuplicatePairs(): Promise<Result<number>>;
  cancelSemanticIndexRebuild(): void;
  scanSemanticIndex(): Promise<Result<SemanticIndexStatus>>;
  embedMissingSemanticIndex(): Promise<Result<{ eligible: number; indexed: number; skipped: number; failed: number }>>;
  embedOneSemanticIndex(cruid: string): Promise<Result<{ indexed: number; failed: number }>>;
  inspectVectorFiles(): Promise<Result<VectorIndexMaintenanceReport>>;
  cleanupOrphanedVectorFiles(expected: VectorFileRef[]): Promise<Result<VectorCleanupSummary>>;
}

