/**
 * 类型 Barrel 文件
 *
 * 集中导出跨模块共享的领域、任务、Provider 与设置类型。
 */

// 领域模型
export type {
    CRType,
    NoteState,
    CRFrontmatter,
    ConceptName,
    DefineCandidate,
    DefinePreview,
    ConfirmedConceptSource,
    ConfirmedConcept,
} from "./domain";
export { CR_TYPES } from "./domain";

// Result Monad
export type { Err, Result } from "./result";
export { ok, err, CognitiveRazorError, toErr, safeErrorMessage } from "./result";

// 任务系统
export type {
    TaskType, QueueTaskType, TaskState, TaskFailureStage, TaskFailureKind, QueueTaskPayload,
    TaskError, TaskRecord, NewTaskRecord, PersistedTaskRecord, TaskModelSnapshot,
    WorkflowKind, TaskStageId, WriteTaskStageId, TaskExecutionAttemptReason, TaskExecutionContext, ConversationContinuation,
} from "./task";
export { TASK_STAGE_IDS } from "./task";

// Provider 系统
export type {
    ProviderCapabilities, EmbeddingApiFormat,
    ChatRequest, ChatResponse, ChatResponseFormat, UrlCitation,
    WebSearchPurpose, ReasoningEffort, ProviderAttemptReason,
    EmbedRequest, EmbedResponse,
} from "./provider";
export { DEFAULT_ENDPOINTS } from "./provider";

// 配置系统
export type {
    ProviderConfig, ProviderApiFormat, TaskModelConfig,
    DirectoryScheme, PluginSettings,
} from "./settings";

// 存储类型
export type {
    DuplicatePair,
    VectorEntry, SearchResult,
    VectorIndexMeta, ConceptVector,
    VectorFileRef,
    DuplicatePairsStore,
} from "./storage";
export type {
  DuplicateMergeNoteSnapshot,
  DuplicateMergeInput,
  DuplicateMergeDraft,
  LinkRepairEntry,
  LinkRepairPlan,
  DuplicateMergePreview,
  DuplicateMergePhase,
  DuplicateMergeOperation,
  DuplicateMergeOperationsStore,
} from "./duplicate-merge";

// 队列系统
export type {
    QueueStatus, QueueEvent, QueueEventListener,
} from "./queue";

// UI 类型
export type {
    ValidationResult, ValidationError,
} from "./ui";

// 日志接口
export type { ILogger, LogLevel } from "./logger";
export type {
  WorkflowArtifact,
  ConceptSnapshot,
  WorkflowConversation,
  SourcePackage,
  SourcePackageItem,
  PendingStageResult,
  WorkflowPatch,
} from "./workflow";

export type { ModelCapabilities, ModelParameters, ModelParameterOverrides, ResolvedTaskConfig } from "./model-config";
export { DEFAULT_MODEL_CAPABILITIES } from "./model-config";
