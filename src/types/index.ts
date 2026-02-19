/**
 * 类型 Barrel 文件
 *
 * 所有子模块的 re-export，保持向后兼容。
 * 现有代码的 `from "../types"` 无需修改。
 * 新代码可按需导入具体子模块（如 `from "../types/domain"`）。
 */

// 领域模型
export type { CRType, NoteState, CRFrontmatter, StandardizedConcept } from "./domain";

// Result Monad
export type { Err, Result } from "./result";
export { ok, err, CognitiveRazorError, isErrResult, toErr, safeErrorMessage } from "./result";

// 任务系统
export type {
    TaskType, TaskState, TaskError,
    DefinePayload, TagPayload, WritePayload,
    IndexPayload, VerifyPayload,
    DefineResult, TagResult, WriteResult,
    IndexResult, VerifyResult,
    TaskPayloadMap, TaskResultMap,
    AnyTaskPayload, AnyTaskResult,
    TypedTaskRecord, TaskRecordBase, TaskRecord,
} from "./task";

// Provider 系统
export type {
    ProviderCapabilities, ProviderInfo,
    ChatRequest, ChatResponse,
    EmbedRequest, EmbedResponse,
} from "./provider";
export { DEFAULT_ENDPOINTS } from "./provider";

// 配置系统
export type {
    ProviderConfig, TaskModelConfig,
    DirectoryScheme, WorkbenchUIState, PluginSettings,
} from "./settings";
export { DEFAULT_UI_STATE } from "./settings";

// 存储类型
export type {
    DuplicatePairStatus, DuplicatePair,
    VectorEntry, SearchResult, IndexStats,
    ConceptMeta, VectorIndexMeta, ConceptVector,
    DuplicatePairsStore, QueueStateFile,
} from "./storage";

// 管线系统
export type { PipelineStage, PipelineContext } from "./pipeline";

// 队列系统
export type {
    QueueStatus, QueueEvent, QueueEventListener,
    TaskResult, TaskDetails,
} from "./queue";

// UI 类型
export type {
    ValidationContext, ValidationResult, ValidationError,
} from "./ui";

// 日志接口
export type { ILogger } from "./logger";
