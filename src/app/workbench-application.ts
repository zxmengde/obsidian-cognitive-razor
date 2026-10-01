import type { TFile } from "obsidian";
import { err } from "../types";
import type { Result, TaskRecord, QueueStatus, QueueEventListener, DuplicatePair, ConfirmedConcept, DefinePreview, DuplicateMergeDraft, DuplicateMergePreview, DuplicateMergeOperation, LinkRepairPlan } from "../types";
import type { TaskQueue } from "../core/task-queue";
import type { CreateOrchestrator } from "../core/create-orchestrator";
import type { VerifyOrchestrator } from "../core/verify-orchestrator";
import type {
  AbstractCandidate,
  AbstractExpandPreview,
  AbstractPlan,
  ExpandOrchestrator,
  ExpandPlan,
  HierarchicalCandidate,
  HierarchicalPlan,
} from "../core/expand-orchestrator";
import type { DuplicateManager } from "../core/duplicate-manager";
import type { WorkflowCoordinator } from "../core/workflow-coordinator";
import type { DuplicateMergeService } from "../core/duplicate-merge-service";

export interface QueueReadModel {
  status: QueueStatus;
  tasks: TaskRecord[];
}
export interface QueueApplication {
  getSnapshot(): QueueReadModel;
  subscribe(listener: QueueEventListener): () => void;
  pause(): Promise<Result<void>>;
  resume(): Promise<Result<void>>;
  retry(taskId: string): Promise<Result<boolean>>;
  retryUncertain(taskId: string): Promise<Result<boolean>>;
  cancel(taskId: string): Promise<Result<boolean>>;
  remove(taskId: string): Promise<Result<boolean>>;
  retryFailed(): Promise<Result<number>>;
  cancelAllActive(): Promise<Result<number>>;
  removeTerminal(): Promise<Result<number>>;
}

export interface CreateApplication {
  define(input: string, signal?: AbortSignal): Promise<Result<DefinePreview>>;
  confirm(concept: ConfirmedConcept, targetPathOverride?: string): Promise<Result<string>>;
}

export interface VerifyApplication {
  start(filePath: string): Promise<Result<string>>;
}

export interface ExpandApplication {
  prepare(file: TFile): Promise<Result<ExpandPlan>>;
  confirmHierarchical(plan: HierarchicalPlan, selected: HierarchicalCandidate[]): Promise<Result<{ started: number; failed: Array<{ name: string; message: string }> }>>;
  prepareAbstractPreview(plan: AbstractPlan, selected: AbstractCandidate[]): Promise<Result<AbstractExpandPreview>>;
  confirmAbstract(preview: AbstractExpandPreview, concept: ConfirmedConcept): Promise<Result<string>>;
}

export interface DuplicateApplication {
  getPendingPairs(): DuplicatePair[];
  subscribe(listener: (pairs: DuplicatePair[]) => void): () => void;
  dismiss(pairId: string): Promise<Result<void>>;
  getConceptName(cruid: string): string | null;
  getConceptPath(cruid: string): string | null;
  prepareMerge(pairId: string, canonicalNodeId: string, signal?: AbortSignal): Promise<Result<DuplicateMergePreview>>;
  confirmMerge(draft: DuplicateMergeDraft, linkRepairPlan: LinkRepairPlan): Promise<Result<DuplicateMergeOperation>>;
  getRecoveryOperations(): DuplicateMergeOperation[];
  resumeMerge(operationId: string): Promise<Result<DuplicateMergeOperation>>;
  discardRecovery(operationId: string): Promise<Result<void>>;
}

export interface WorkflowApplication {
  discardWorkflow(workflowId: string): Promise<Result<void>>;
}

export interface SemanticIndexApplication {
  rebuildCurrentNote(filePath: string): Promise<Result<{ indexed: number; failed: number }>>;
}

interface WorkbenchApplicationDeps {
  taskQueue: TaskQueue;
  createOrchestrator: CreateOrchestrator;
  verifyOrchestrator: VerifyOrchestrator;
  expandOrchestrator: ExpandOrchestrator;
  duplicateManager: DuplicateManager;
  getConceptName: (cruid: string) => string | null;
  getConceptPath: (cruid: string) => string | null;
  rebuildSemanticNote: (filePath: string) => Promise<Result<{ indexed: number; failed: number }>>;
  generateCards?: (filePath: string) => Promise<Result<string>>;
  workflowCoordinator?: WorkflowCoordinator;
  duplicateMergeService?: DuplicateMergeService;
}

/**
 * Application boundary for the workbench. UI code receives commands and
 * read models only; queue/workflow/store ownership remains inside runtime.
 */
export class WorkbenchApplication {
  readonly queue: QueueApplication;
  readonly create: CreateApplication;
  readonly verify: VerifyApplication;
  readonly cards: VerifyApplication;
  readonly expand: ExpandApplication;
  readonly duplicates: DuplicateApplication;
  readonly workflow: WorkflowApplication;
  readonly semanticIndex: SemanticIndexApplication;

  constructor(private readonly deps: WorkbenchApplicationDeps) {
    this.queue = {
      getSnapshot: () => this.deps.taskQueue.getSnapshot(),
      subscribe: (listener) => this.deps.taskQueue.subscribe(listener),
      pause: () => this.deps.taskQueue.pauseDurably(),
      resume: () => this.deps.taskQueue.resumeDurably(),
      retry: (taskId) => this.deps.taskQueue.retryDurably(taskId),
      retryUncertain: (taskId) => this.deps.taskQueue.retryUncertainDurably(taskId),
      cancel: (taskId) => this.deps.taskQueue.cancelDurably(taskId),
      remove: (taskId) => this.deps.taskQueue.removeDurably(taskId),
      retryFailed: () => this.deps.taskQueue.retryFailedDurably(),
      cancelAllActive: () => this.deps.taskQueue.cancelAllActiveDurably(),
      removeTerminal: () => this.deps.taskQueue.removeTerminalDurably(),
    };

    this.create = {
      define: (input, signal) => this.deps.createOrchestrator.defineDirect(input, signal),
      confirm: (concept, targetPathOverride) => this.deps.createOrchestrator.confirmCreate(
        concept,
        targetPathOverride ? { targetPathOverride } : undefined,
      ),
    };

    this.cards = { start: (path) => this.deps.generateCards?.(path) ?? Promise.resolve(err("E310_INVALID_STATE", "卡片服务尚未就绪")) };
    this.verify = {
      start: (filePath) => this.deps.verifyOrchestrator.startVerifyPipeline(filePath),
    };

    this.expand = {
      prepare: (file) => this.deps.expandOrchestrator.prepare(file),
      confirmHierarchical: (plan, selected) => this.deps.expandOrchestrator.confirmHierarchical(plan, selected),
      prepareAbstractPreview: (plan, selected) => this.deps.expandOrchestrator.prepareAbstractPreview(plan, selected),
      confirmAbstract: (preview, concept) => this.deps.expandOrchestrator.confirmAbstract(preview, concept),
    };

    this.duplicates = {
      getPendingPairs: () => this.deps.duplicateManager.getPendingPairs(),
      subscribe: (listener) => this.deps.duplicateManager.subscribe(listener),
      dismiss: (pairId) => this.deps.duplicateManager.markAsNonDuplicate(pairId),
      getConceptName: (cruid) => this.deps.getConceptName(cruid),
      getConceptPath: (cruid) => this.deps.getConceptPath(cruid),
      prepareMerge: (pairId, canonicalNodeId, signal) => this.deps.duplicateMergeService
        ? this.deps.duplicateMergeService.prepareMerge(pairId, canonicalNodeId, signal)
        : Promise.resolve(err("E310_INVALID_STATE", "合并服务尚未就绪")),
      confirmMerge: (draft, plan) => this.deps.duplicateMergeService
        ? this.deps.duplicateMergeService.confirmMerge(draft, plan)
        : Promise.resolve(err("E310_INVALID_STATE", "合并服务尚未就绪")),
      getRecoveryOperations: () => this.deps.duplicateMergeService?.getRecoveryOperations() ?? [],
      resumeMerge: (id) => this.deps.duplicateMergeService
        ? this.deps.duplicateMergeService.resumeMerge(id)
        : Promise.resolve(err("E310_INVALID_STATE", "合并服务尚未就绪")),
      discardRecovery: (id) => this.deps.duplicateMergeService
        ? this.deps.duplicateMergeService.discardRecovery(id)
        : Promise.resolve(err("E310_INVALID_STATE", "合并服务尚未就绪")),
    };

    this.workflow = {
      discardWorkflow: (workflowId) => this.deps.workflowCoordinator
        ? this.deps.workflowCoordinator.discardWorkflow(workflowId)
        : Promise.resolve(err("E310_INVALID_STATE", "工作流应用尚未就绪")),
    };

    this.semanticIndex = {
      rebuildCurrentNote: (filePath) => this.deps.rebuildSemanticNote(filePath),
    };

  }
}
