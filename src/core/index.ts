/**
 * 应用层组件导出
 * 
 * 遵循设计文档 7.3 模块职责定义
 */

export { VectorIndex } from "./vector-index";
export { LockManager } from "./lock-manager";
export { UndoManager } from "./undo-manager";
export { ProviderManager } from "./provider-manager";
export { PromptManager } from "./prompt-manager";
export { DuplicateManager } from "./duplicate-manager";
export { TaskQueue } from "./task-queue";
export { TaskRunner } from "./task-runner";
export { SchemaRegistryImpl as SchemaRegistry, schemaRegistry } from "./schema-registry";
export type { ISchemaRegistry, FieldDescription, JSONSchema } from "./schema-registry";
export { VersionChecker, versionChecker, CURRENT_VERSION } from "./version-checker";
export type { IVersionChecker, VersionInfo, CompatibilityResult, MigrationOption } from "./version-checker";
export { RetryHandler, CONTENT_ERROR_CONFIG, NETWORK_ERROR_CONFIG } from "./retry-handler";
export type { IRetryHandler, RetryConfig, ErrorCategory, RetryStrategy, ErrorClassification } from "./retry-handler";
export { PipelineOrchestrator } from "./pipeline-orchestrator";
export type { 
  IPipelineOrchestrator, 
  PipelineStage, 
  PipelineContext, 
  PipelineEvent, 
  PipelineEventType,
  PipelineEventListener,
  PipelineOrchestratorDependencies 
} from "./pipeline-orchestrator";
export {
  renderNamingTemplate,
  generateSignatureText,
  createConceptSignature,
  validateNamingTemplate,
  getDefaultNamingTemplate,
  sanitizeFileName,
  generateFilePath
} from "./naming-utils";
export type { ConceptSignature, NamingTemplateContext } from "./naming-utils";
