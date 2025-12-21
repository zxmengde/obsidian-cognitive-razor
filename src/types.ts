/**
 * Cognitive Razor 核心类型定义
 */

// ============================================================================
// 知识类型和状态
// ============================================================================

/**
 * 知识类型：五种核心概念类型
 */
export type CRType = "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";

/**
 * 笔记状态：从 Stub 到 Evergreen 的演进
 */
export type NoteState = "Stub" | "Draft" | "Evergreen";

// ============================================================================
// Frontmatter 数据模型
// ============================================================================

/**
 * Cognitive Razor 笔记的 Frontmatter 元数据
 */
export interface CRFrontmatter {
  /** UUID v4 唯一标识符 */
  cruid: string;
  /** 知识类型 */
  type: CRType;
  /** 笔记名称 */
  name: string;
  /** 概念核心定义（用于快速索引与预览） */
  definition?: string;
  /** 笔记状态 */
  status: NoteState;
  /** 创建时间 (yyyy-MM-DD HH:mm:ss) */
  created: string;
  /** 更新时间 (yyyy-MM-DD HH:mm:ss) */
  updated: string;
  /** 别名列表 */
  aliases?: string[];
  /** 标签列表 */
  tags?: string[];
  /** 父概念链接列表（规范形态：[[Title]]） */
  parents: string[];
  /** 来源概念 UIDs */
  sourceUids?: string[];
  /** 版本号 */
  version?: string;
}

// ============================================================================
// 任务系统
// ============================================================================

/**
 * 任务类型
 */
export type TaskType =
  | "define"   // 定义
  | "tag"      // 标记
  | "write"    // 撰写
  | "amend"    // 修订
  | "merge"    // 合并
  | "index"    // 索引
  | "verify"   // 校验
  | "image-generate"; // 图片生成

/**
 * 任务状态
 */
export type TaskState =
  | "Pending"      // 等待中
  | "Running"      // 执行中
  | "Completed"    // 已完成
  | "Failed"       // 失败
  | "Cancelled";   // 已取消

/**
 * 任务错误记录
 */
export interface TaskError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 发生时间 */
  timestamp: string;
  /** 重试次数 */
  attempt: number;
}

/**
 * 任务记录
 */
export interface TaskRecord {
  /** 任务 ID */
  id: string;
  /** 关联的节点 ID (UID) */
  nodeId: string;
  /** 任务类型 */
  taskType: TaskType;
  /** 任务状态 */
  state: TaskState;
  /** Provider 引用 */
  providerRef?: string;
  /** Prompt 引用 */
  promptRef?: string;
  /** 当前尝试次数 */
  attempt: number;
  /** 最大尝试次数 */
  maxAttempts: number;
  /** 任务载荷数据 */
  payload: Record<string, unknown>;
  /** 任务结果 */
  result?: Record<string, unknown>;
  /** 撤销指针 (快照 ID) */
  undoPointer?: string;
  /** 锁键 */
  lockKey?: string;
  /** 类型锁键 */
  typeLockKey?: string;
  /** 创建时间 */
  created: string;
  /** 更新时间 */
  updated: string;
  /** 开始时间 */
  startedAt?: string;
  /** 完成时间 */
  completedAt?: string;
  /** 错误历史 */
  errors?: TaskError[];
}

// ============================================================================
// 重复检测
// ============================================================================

/**
 * 重复对状态
 */
export type DuplicatePairStatus =
  | "pending"    // 待处理
  | "merging"    // 合并中
  | "merged"     // 已合并
  | "dismissed"; // 已忽略

/**
 * 重复对记录
 */
export interface DuplicatePair {
  /** 重复对 ID */
  id: string;
  /** 概念 A（仅存储 cruid） */
  nodeIdA: string;
  /** 概念 B（仅存储 cruid） */
  nodeIdB: string;
  /** 知识类型 */
  type: CRType;
  /** 相似度 (0-1) */
  similarity: number;
  /** 检测时间 */
  detectedAt: string;
  /** 状态 */
  status: DuplicatePairStatus;
}

// ============================================================================
// 向量索引
// ============================================================================

/**
 * 向量索引条目
 */
export interface VectorEntry {
  /** 概念 UID */
  uid: string;
  /** 知识类型 */
  type: CRType;
  /** 向量嵌入 */
  embedding: number[];
  /** 更新时间 */
  updated: string;
}

/**
 * 相似度搜索结果
 */
export interface SearchResult {
  /** 概念 UID */
  uid: string;
  /** 相似度分数 (0-1) */
  similarity: number;
  /** 概念名称（运行时通过 CruidCache 解析） */
  name: string;
  /** 文件路径（运行时通过 CruidCache 解析） */
  path: string;
}

/**
 * 索引统计信息
 */
export interface IndexStats {
  /** 总条目数 */
  totalEntries: number;
  /** 按类型分组的条目数 */
  byType: Record<CRType, number>;
  /** 最后更新时间 */
  lastUpdated: string;
}

// ============================================================================
// Provider 系统
// ============================================================================

/**
 * Provider 类型（仅支持 OpenAI 标准格式，可通过自定义端点兼容其他服务）
 */
type ProviderType = "openai";

/**
 * Provider 能力
 */
export interface ProviderCapabilities {
  /** 支持聊天 */
  chat: boolean;
  /** 支持嵌入 */
  embedding: boolean;
  /** 支持图片生成 */
  image: boolean;
  /** 最大上下文长度 */
  maxContextLength: number;
  /** 支持的模型列表 */
  models: string[];
}

/**
 * Provider 信息
 */
export interface ProviderInfo {
  /** Provider ID */
  id: string;
  /** Provider 类型 */
  type: ProviderType;
  /** 显示名称 */
  name: string;
  /** 是否已配置 */
  configured: boolean;
  /** 能力 */
  capabilities?: ProviderCapabilities;
}

/**
 * 聊天请求
 */
export interface ChatRequest {
  /** Provider ID */
  providerId: string;
  /** 模型名称 */
  model: string;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 温度参数 (0-1) */
  temperature?: number;
  /** TopP 参数 (0-1) */
  topP?: number;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 推理强度（用于支持推理的模型，如 o1, o3） */
  reasoning_effort?: "low" | "medium" | "high";
}

/**
 * 聊天消息
 */
interface ChatMessage {
  /** 角色 */
  role: "system" | "user" | "assistant";
  /** 内容 */
  content: string;
}

/**
 * 聊天响应
 */
export interface ChatResponse {
  /** 生成的内容 */
  content: string;
  /** 使用的 token 数 */
  tokensUsed?: number;
  /** 完成原因 */
  finishReason?: string;
}

/**
 * 图片生成请求
 */
export interface ImageGenerateRequest {
  /** Provider ID */
  providerId: string;
  /** 模型名称（默认 gemini-3-pro-image-preview） */
  model: string;
  /** 图片提示词（映射到 images/generations.prompt） */
  prompt: string;
  /** 图片尺寸（如 1024x1024 / 1792x1024 / 1024x1792） */
  size?: string;
  /** 图片质量（如 standard / hd；取决于 provider 支持情况） */
  quality?: "standard" | "hd";
  /** 图片风格（如 vivid / natural；取决于 provider 支持情况） */
  style?: "vivid" | "natural";
}

/**
 * 图片生成响应
 */
export interface ImageGenerateResponse {
  /** data:image/...;base64,... 或临时 URL */
  imageUrl: string;
  /** 经过 LLM 优化后的提示词（可选） */
  revisedPrompt?: string;
  /** 用于 alt 文本的描述（可选） */
  altText?: string;
}

/**
 * 图片生成任务载荷
 */
export interface ImageGeneratePayload {
  userPrompt: string;
  contextBefore: string;
  contextAfter: string;
  frontmatter: CRFrontmatter;
  filePath: string;
  cursorPosition: { line: number; ch: number };
}

/**
 * 图片生成结果
 */
export interface ImageGenerateResult {
  imageUrl: string;
  localPath: string;
  description: string;
  revisedPrompt?: string;
}

/**
 * 嵌入请求
 */
export interface EmbedRequest {
  /** Provider ID */
  providerId: string;
  /** 模型名称 */
  model: string;
  /** 输入文本 */
  input: string;
  /** 向量维度（可选，用于支持可变维度的模型如 text-embedding-3-small） */
  dimensions?: number;
}

/**
 * 嵌入响应
 */
export interface EmbedResponse {
  /** 向量嵌入 */
  embedding: number[];
  /** 使用的 token 数 */
  tokensUsed?: number;
}

// ============================================================================
// 配置系统
// ============================================================================

/**
 * Provider 配置
 * 
 * 注意：系统仅支持 OpenAI 标准格式，可通过 baseUrl 兼容其他服务
 * 已移除 type 字段，因为所有 Provider 都使用 OpenAI 格式
 */
export interface ProviderConfig {
  /** API Key */
  apiKey: string;
  /** 自定义端点 URL (可选，用于支持 OpenRouter 等第三方服务) */
  baseUrl?: string;
  /** 默认聊天模型 */
  defaultChatModel: string;
  /** 默认嵌入模型 */
  defaultEmbedModel: string;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 任务模型配置
 * 允许为每种任务类型指定不同的模型和参数
 */
export interface TaskModelConfig {
  /** Provider ID（引用 providers 中的配置） */
  providerId: string;
  /** 模型名称 */
  model: string;
  /** 温度参数（0-2，默认 0.7） */
  temperature?: number;
  /** TopP 参数（0-1，默认 1） */
  topP?: number;
  /** 推理强度（用于支持推理的模型，如 o1, o3） */
  reasoning_effort?: "low" | "medium" | "high";
  /** 最大 token 数 */
  maxTokens?: number;
  /** 嵌入维度（仅对向量任务生效） */
  embeddingDimension?: number;
}

/**
 * 目录方案
 * 按知识类型组织笔记目录
 */
export interface DirectoryScheme {
  /** Domain 目录，默认 "1-领域" */
  Domain: string;
  /** Issue 目录，默认 "2-议题" */
  Issue: string;
  /** Theory 目录，默认 "3-理论" */
  Theory: string;
  /** Entity 目录，默认 "4-实体" */
  Entity: string;
  /** Mechanism 目录，默认 "5-机制" */
  Mechanism: string;
}

/**
 * 默认端点配置
 */
export const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1"
};

/**
 * 插件设置
 */
export interface PluginSettings {
  /** 插件版本 */
  version: string;
  
  /** 基础设置 */
  language: "zh" | "en";
  
  /** 命名设置 */
  namingTemplate: string;
  
  /** 存储设置 */
  directoryScheme: DirectoryScheme;
  
  /** 去重设置 */
  similarityThreshold: number;
  
  /** 队列设置 */
  concurrency: number;
  autoRetry: boolean;
  maxRetryAttempts: number;
  /** 单个任务最大执行时长（毫秒） */
  taskTimeoutMs: number;
  /** 任务历史保留上限（仅 Completed/Failed/Cancelled） */
  maxTaskHistory: number;
  
  /** 快照设置 */
  maxSnapshots: number;
  /** 快照最大保留天数（A-FUNC-02 可配置快照保留策略） */
  maxSnapshotAgeDays: number;
  
  /** 功能开关 */
  enableAutoVerify: boolean;
  
  /** Provider 配置 */
  providers: Record<string, ProviderConfig>;
  defaultProviderId: string;

  /** 任务模型配置 */
  taskModels: Record<TaskType, TaskModelConfig>;

  /** 图片生成功能配置 */
  imageGeneration: {
    enabled: boolean;
    defaultSize: "1024x1024" | "1792x1024" | "1024x1792" | string;
    defaultQuality: "standard" | "hd";
    defaultStyle: "vivid" | "natural";
    defaultAspectRatio?: string;
    defaultImageSize?: string;
    contextWindowSize: number;
  };
  
  /** 日志级别 */
  logLevel: "debug" | "info" | "warn" | "error";
  
  /** 嵌入向量维度（text-embedding-3-small 支持 512-3072，默认 1536） */
  embeddingDimension: number;
  
  /** Provider 请求超时（毫秒，默认 60000） */
  providerTimeoutMs: number;
}

/**
 * 概念元数据
 */
export interface ConceptMeta {
  /** 概念 UID */
  id: string;
  /** 知识类型 */
  type: CRType;
  /** 向量文件相对路径（仅索引内部使用，如 "Domain/xxx.json"） */
  vectorFilePath: string;
  /** 最后修改时间 */
  lastModified: number;
  /** 是否有嵌入向量 */
  hasEmbedding: boolean;
}

/**
 * 向量索引元数据
 */
export interface VectorIndexMeta {
  /** 版本 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: number;
  /** 生成 embedding 的模型（用于诊断与一致性检查） */
  embeddingModel?: string;
  /** embedding 向量维度（用于一致性检查） */
  dimensions?: number;
  /** 统计信息 */
  stats: {
    totalConcepts: number;
    byType: Record<CRType, number>;
  };
  /** 概念元数据映射 */
  concepts: Record<string, ConceptMeta>;
}

/**
 * 单个概念向量文件
 */
export interface ConceptVector {
  /** 概念 UID */
  id: string;
  /** 知识类型 */
  type: CRType;
  /** 向量嵌入 */
  embedding: number[];
  /** 元数据 */
  metadata: {
    createdAt: number;
    updatedAt: number;
    embeddingModel: string;
    dimensions: number;
  };
}

/**
 * 快照记录
 */
export interface SnapshotRecord {
  /** 快照 ID（UUID） */
  id: string;
  /** 关联的概念 UID */
  nodeId: string;
  /** 关联的任务 ID */
  taskId: string;
  /** 原文件路径 */
  path: string;
  /** 原始 Markdown 内容 */
  content: string;
  /** 创建时间 */
  created: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 内容校验和（SHA-256） */
  checksum: string;
}

/**
 * 快照索引
 */
export interface SnapshotIndex {
  /** 版本 */
  version: string;
  /** 快照列表 */
  snapshots: SnapshotRecord[];
  /** 保留策略 */
  retentionPolicy: {
    maxCount: number;
    maxAgeDays: number;
  };
}

/**
 * 快照元数据（用于列表显示）
 */
export interface SnapshotMetadata {
  /** 快照 ID */
  id: string;
  /** 关联的概念 UID */
  nodeId: string;
  /** 关联的任务 ID */
  taskId: string;
  /** 原文件路径 */
  path: string;
  /** 创建时间 */
  created: string;
  /** 文件大小（字节） */
  fileSize: number;
}

/**
 * 快照（完整内容）
 * 与 SnapshotRecord 相同，用于语义区分
 */
export type Snapshot = SnapshotRecord;

/**
 * 重复对存储
 */
export interface DuplicatePairsStore {
  /** 版本 */
  version: string;
  /** 重复对列表 */
  pairs: DuplicatePair[];
  /** 被标记为非重复的 pair ID 列表（历史记录） */
  dismissedPairs: string[];
}

/**
 * 队列状态文件
 */
export interface QueueStateFile {
  /** 队列状态版本 */
  version: "1.0.0" | "2.0.0";
  /** 待执行任务列表（v1: 最小字段；v2: 允许携带恢复所需字段） */
  pendingTasks: Array<{
    id: string;
    nodeId: string;
    taskType: TaskType;
    attempt: number;
    maxAttempts: number;
    providerRef?: string;
    promptRef?: string;
    payload?: Record<string, unknown>;
    created?: string;
    updated?: string;
    errors?: TaskError[];
  }>;
  /** 是否暂停 */
  paused: boolean;
}

// ============================================================================
// 标准化概念
// ============================================================================

/**
 * 标准化概念结果
 */
export interface StandardizedConcept {
  /** 所有类型的标准名称 */
  standardNames: {
    Domain: { chinese: string; english: string };
    Issue: { chinese: string; english: string };
    Theory: { chinese: string; english: string };
    Entity: { chinese: string; english: string };
    Mechanism: { chinese: string; english: string };
  };
  /** 类型置信度 */
  typeConfidences: Record<CRType, number>;
  /** 主要类型 */
  primaryType?: CRType;
  /** 核心定义 */
  coreDefinition?: string;
}

// ============================================================================
// 管线系统
// ============================================================================

/**
 * 管线阶段
 */
export type PipelineStage =
  | "idle"                    // 空闲
  | "defining"                // 定义中
  | "tagging"                 // 标记中
  | "indexing"                // 索引中
  | "review_draft"            // 确认草稿
  | "writing"                 // 撰写中
  | "verifying"               // 校验中
  | "review_changes"          // 确认修改
  | "saving"                  // 写入中
  | "checking_duplicates"     // 查重中
  | "completed"               // 完成
  | "failed";                 // 失败

/**
 * 管线上下文
 */
export interface PipelineContext {
  /** 管线类型：创建 / 修订（Amend） / 合并 / 校验 */
  kind: "create" | "amend" | "merge" | "verify";
  /** 管线 ID */
  pipelineId: string;
  /** 节点 ID */
  nodeId: string;
  /** 知识类型 */
  type: CRType;
  /** 当前阶段 */
  stage: PipelineStage;
  /** 用户输入 */
  userInput: string;
  /** 标准化结果 */
  standardizedData?: StandardizedConcept;
  /** 丰富结果（别名和标签） */
  enrichedData?: {
    aliases: string[];
    tags: string[];
  };
  /** 嵌入向量 */
  embedding?: number[];
  /** 生成的内容 */
  generatedContent?: unknown;
  /** 父级标题（用于 Expand/抽象来源写入） */
  parents?: string[];
  /** 供 write 使用的来源上下文（抽象深化） */
  sources?: string;
  /** 目标路径覆盖（Expand 预设路径） */
  targetPathOverride?: string;
  /** 写入前的原始内容（修订/合并预览使用） */
  previousContent?: string;
  /** 待写入的新内容（修订/合并预览使用） */
  newContent?: string;
  /** 文件路径 */
  filePath?: string;
  /** Verify 结果（用于 UI 展示；落盘的报告由 PipelineOrchestrator 追加到笔记末尾） */
  verificationResult?: Record<string, unknown>;
  /** 修订/合并特有字段 */
  mergePairId?: string;
  deleteFilePath?: string;
  deleteNoteName?: string;
  deleteNodeId?: string;
  deleteContent?: string;
  currentStatus?: string;
  /** 快照 ID */
  snapshotId?: string;
  /** 错误信息 */
  error?: { code: string; message: string };
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ============================================================================
// 任务结果
// ============================================================================

/**
 * 任务结果
 */
export interface TaskResult {
  /** 任务 ID */
  taskId: string;
  /** 任务状态 */
  state: TaskState;
  /** 结果数据 */
  data?: Record<string, unknown>;
  /** 错误信息 */
  error?: TaskError;
}

// ============================================================================
// 任务详情（扩展）
// ============================================================================

/**
 * 任务详情（用于 UI 显示）
 * 内部使用，不导出
 */
interface TaskDetails extends TaskRecord {
  /** Provider 名称 */
  providerName?: string;
  /** 已用时间（毫秒） */
  elapsedTime?: number;
  /** 预计时间（毫秒） */
  estimatedTime?: number;
}

// ============================================================================
// 队列系统
// ============================================================================

/**
 * 队列状态
 */
export interface QueueStatus {
  /** 是否暂停 */
  paused: boolean;
  /** 待处理任务数 */
  pending: number;
  /** 运行中任务数 */
  running: number;
  /** 已完成任务数 */
  completed: number;
  /** 失败任务数 */
  failed: number;
}

/**
 * 队列事件类型
 */
type QueueEventType =
  | "task-added"
  | "task-started"
  | "task-completed"
  | "task-failed"
  | "task-cancelled"
  | "queue-paused"
  | "queue-resumed";

/**
 * 队列事件
 */
export interface QueueEvent {
  /** 事件类型 */
  type: QueueEventType;
  /** 任务 ID */
  taskId?: string;
  /** 时间戳 */
  timestamp: string;
}

/**
 * 队列事件监听器
 */
export type QueueEventListener = (event: QueueEvent) => void;

// ============================================================================
// 结果类型 (Result Monad)
// ============================================================================

/**
 * 成功结果
 */
interface Ok<T> {
  ok: true;
  value: T;
}

/**
 * 失败结果
 */
export interface Err {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Result 类型：表示可能成功或失败的操作
 */
export type Result<T> = Ok<T> | Err;

// ============================================================================
// Modal 组件类型
// ============================================================================

/**
 * 确认 Modal 选项
 */
export interface ConfirmModalOptions {
  /** 标题 */
  title: string;
  /** 消息 */
  message: string;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否为危险操作 */
  danger?: boolean;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * Provider 配置 Modal 选项
 */
export interface ProviderConfigModalOptions {
  /** 模式：添加或编辑 */
  mode: "add" | "edit";
  /** 模态框标题 */
  title: string;
  /** Provider ID (编辑模式) */
  providerId?: string;
  /** 当前配置 (编辑模式) */
  currentConfig?: ProviderConfig;
  /** 保存回调 */
  onSave: (id: string, config: ProviderConfig) => Promise<void>;
  /** 取消回调 */
  onCancel?: () => void;
}

// ============================================================================
// 验证系统
// ============================================================================

/**
 * 验证上下文
 */
export interface ValidationContext {
  /** 知识类型 */
  type?: CRType;
  /** 向量嵌入（用于语义去重） */
  embedding?: number[];
  /** 向量索引（用于语义去重） */
  vectorIndex?: unknown;
  /** 相似度阈值 */
  similarityThreshold?: number;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否通过验证 */
  valid: boolean;
  /** 解析后的数据（验证通过时） */
  data?: Record<string, unknown>;
  /** 错误列表 */
  errors?: ValidationError[];
  /** 检测到的重复对（语义去重阶段） */
  duplicates?: SearchResult[];
}

/**
 * 验证错误
 */
export interface ValidationError {
  /** 错误码 */
  code: string;
  /** 错误类型 */
  type: string;
  /** 错误消息 */
  message: string;
  /** 错误位置（字段路径） */
  location?: string;
  /** 原始输出（用于调试） */
  rawOutput?: string;
  /** 修复建议 */
  fixInstruction?: string;
}

// ============================================================================
// 工具函数类型
// ============================================================================

/**
 * 创建成功结果
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * 创建失败结果
 */
export function err(code: string, message: string, details?: unknown): Err {
  return { ok: false, error: { code, message, details } };
}

// ============================================================================
// 同步错误（用于 Phase 4：减少同步 Result 使用）
// ============================================================================

/**
 * Cognitive Razor 运行时错误
 *
 * 用途：在同步流程中直接抛出，避免层层返回 Result。
 * 在异步边界（I/O / 网络 / UI 事件）捕获后可转换为 Err。
 */
export class CognitiveRazorError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CognitiveRazorError";
    this.code = code;
    this.details = details;
  }
}

export function isErrResult(value: unknown): value is Err {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok !== false) return false;
  const errObj = candidate.error as Record<string, unknown> | undefined;
  return !!errObj && typeof errObj.code === "string" && typeof errObj.message === "string";
}

/**
 * 将未知错误转换为 Err（用于 async 边界的统一兜底）
 */
export function toErr(
  error: unknown,
  fallbackCode: string = "E500_INTERNAL_ERROR",
  fallbackMessage: string = "发生未知错误"
): Err {
  if (isErrResult(error)) {
    return error;
  }
  if (error instanceof CognitiveRazorError) {
    return err(error.code, error.message, error.details);
  }
  if (error instanceof Error) {
    return err(fallbackCode, error.message || fallbackMessage, { stack: error.stack });
  }
  return err(fallbackCode, fallbackMessage, error);
}

// ============================================================================
// 日志接口定义
// ============================================================================

/**
 * 日志记录器接口
 */
export interface ILogger {
  /**
   * 调试日志
   * @param module 模块名称
   * @param message 消息
   * @param context 上下文数据
   */
  debug(module: string, message: string, context?: Record<string, unknown>): void;
  
  /**
   * 信息日志
   * @param module 模块名称
   * @param message 消息
   * @param context 上下文数据
   */
  info(module: string, message: string, context?: Record<string, unknown>): void;
  
  /**
   * 警告日志
   * @param module 模块名称
   * @param message 消息
   * @param context 上下文数据
   */
  warn(module: string, message: string, context?: Record<string, unknown>): void;
  
  /**
   * 错误日志
   * @param module 模块名称
   * @param message 消息
   * @param error 错误对象
   * @param context 上下文数据
   */
  error(module: string, message: string, error?: Error, context?: Record<string, unknown>): void;
  
  /**
   * 获取日志内容
   * @returns 日志内容
   */
  getLogContent(): string;
  
  /**
   * 清空日志
   */
  clear(): void;

  /**
   * 设置追踪 ID（可选，用于关联同一操作的多条日志）
   * @param traceId 追踪 ID，传 null 清除
   */
  setTraceId?(traceId: string | null): void;

  /**
   * 获取当前追踪 ID（可选）
   * @returns 当前追踪 ID 或 null
   */
  getTraceId?(): string | null;

  /**
   * 开始一个带追踪 ID 的操作（可选）
   * @param operation 操作名称
   * @returns 生成的追踪 ID
   */
  startTrace?(operation: string): string;

  /**
   * 结束当前追踪（可选）
   * @param operation 操作名称
   */
  endTrace?(operation: string): void;
}
