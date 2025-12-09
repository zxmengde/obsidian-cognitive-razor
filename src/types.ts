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
  uid: string;
  /** 知识类型 */
  type: CRType;
  /** 笔记状态 */
  status: NoteState;
  /** 创建时间 (ISO 8601) */
  created: string;
  /** 更新时间 (ISO 8601) */
  updated: string;
  /** 别名列表 */
  aliases?: string[];
  /** 标签列表 */
  tags?: string[];
  /** 父概念 UID */
  parentUid?: string;
  /** 父概念类型 */
  parentType?: CRType;
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
  | "embedding"              // 生成向量嵌入
  | "standardizeClassify"    // 标准化和分类
  | "enrich"                 // 内容生成
  | "reason:new"             // 新概念推理
  | "reason:incremental"     // 增量改进
  | "reason:merge"           // 合并推理
  | "ground";                // 接地验证

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
  /** 笔记 A */
  noteA: {
    nodeId: string;
    name: string;
    path: string;
  };
  /** 笔记 B */
  noteB: {
    nodeId: string;
    name: string;
    path: string;
  };
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
  /** 概念名称 */
  name: string;
  /** 文件路径 */
  path: string;
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
  /** 概念名称 */
  name: string;
  /** 文件路径 */
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
export type ProviderType = "openai";

/**
 * Provider 能力
 */
export interface ProviderCapabilities {
  /** 支持聊天 */
  chat: boolean;
  /** 支持嵌入 */
  embedding: boolean;
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
}

/**
 * 聊天消息
 */
export interface ChatMessage {
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
  advancedMode: boolean;
  
  /** 命名设置 */
  namingTemplate: string;
  
  /** 存储设置 */
  directoryScheme: DirectoryScheme;
  
  /** 去重设置 */
  similarityThreshold: number;
  topK: number;
  
  /** 队列设置 */
  concurrency: number;
  autoRetry: boolean;
  maxRetryAttempts: number;
  
  /** 快照设置 */
  maxSnapshots: number;
  /** 快照最大保留天数（A-FUNC-02 可配置快照保留策略） */
  maxSnapshotAgeDays: number;
  
  /** 功能开关 */
  enableGrounding: boolean;
  
  /** Provider 配置 */
  providers: Record<string, ProviderConfig>;
  defaultProviderId: string;
  
  /** 任务模型配置 */
  taskModels: Record<TaskType, TaskModelConfig>;
  
  /** 日志级别 */
  logLevel: "debug" | "info" | "warn" | "error";
  
  /** 嵌入向量维度（text-embedding-3-small 支持 512-3072，默认 1536） */
  embeddingDimension: number;
}

/**
 * 向量索引文件结构
 */
export interface VectorIndexFile {
  /** 索引版本 */
  version: string;
  /** 嵌入模型标识 */
  model: string;
  /** 向量维度 */
  dimension: number;
  /** 按类型分桶 */
  buckets: Record<CRType, VectorEntry[]>;
  /** 元数据 */
  metadata: {
    totalCount: number;
    lastUpdated: string;
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
  /** 内容校验和（MD5） */
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
  version: string;
  /** 任务列表 */
  tasks: TaskRecord[];
  /** 当前并发数 */
  concurrency: number;
  /** 是否暂停 */
  paused: boolean;
  /** 统计信息 */
  stats: {
    totalProcessed: number;
    totalFailed: number;
    totalCancelled: number;
    lastProcessedAt?: string;
  };
  /** 锁状态 */
  locks: LockRecord[];
}

/**
 * 锁记录
 */
export interface LockRecord {
  /** 锁键（nodeId 或 type） */
  key: string;
  /** 锁类型 */
  type: "node" | "type";
  /** 持有锁的任务 ID */
  taskId: string;
  /** 获取时间 */
  acquiredAt: string;
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
 */
export interface TaskDetails extends TaskRecord {
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
export type QueueEventType =
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
export interface Ok<T> {
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
 * 文本输入 Modal 选项
 */
export interface TextInputModalOptions {
  /** 标题 */
  title: string;
  /** 占位符 */
  placeholder?: string;
  /** 默认值 */
  defaultValue?: string;
  /** 验证函数 - 返回错误消息或 null */
  validator?: (value: string) => string | null;
  /** 提交回调 */
  onSubmit: (value: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * 选择选项
 */
export interface SelectOption {
  /** 值 */
  value: string;
  /** 标签 */
  label: string;
  /** 描述 */
  description?: string;
}

/**
 * 选择 Modal 选项
 */
export interface SelectModalOptions {
  /** 标题 */
  title: string;
  /** 选项列表 */
  options: SelectOption[];
  /** 选择回调 */
  onSelect: (value: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
}

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
// 核心接口定义
// ============================================================================

/**
 * 任务队列接口
 */
export interface ITaskQueue {
  /**
   * 将任务加入队列
   * @param task 任务记录（不含 id、created、updated）
   * @returns 任务 ID 或错误
   */
  enqueue(task: Omit<TaskRecord, 'id' | 'created' | 'updated'>): Result<string>;
  
  /**
   * 取消任务
   * @param taskId 任务 ID
   * @returns 是否成功取消
   */
  cancel(taskId: string): Result<boolean>;
  
  /**
   * 暂停队列
   */
  pause(): void;
  
  /**
   * 恢复队列
   */
  resume(): void;
  
  /**
   * 获取队列状态
   */
  getStatus(): QueueStatus;
  
  /**
   * 订阅队列事件
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: QueueEventListener): () => void;
  
  /**
   * 获取任务
   * @param taskId 任务 ID
   * @returns 任务记录或 undefined
   */
  getTask(taskId: string): TaskRecord | undefined;
}

/**
 * 任务执行器接口
 */
export interface ITaskRunner {
  /**
   * 执行任务
   * @param task 任务记录
   * @returns 任务结果
   */
  run(task: TaskRecord): Promise<Result<TaskResult>>;
  
  /**
   * 中断任务执行
   * @param taskId 任务 ID
   */
  abort(taskId: string): void;
}

/**
 * 锁管理器接口
 */
export interface ILockManager {
  /**
   * 获取锁
   * @param key 锁键（nodeId 或 type）
   * @param type 锁类型
   * @param taskId 任务 ID
   * @returns 锁 ID 或错误
   */
  acquire(key: string, type: 'node' | 'type', taskId: string): Result<string>;
  
  /**
   * 释放锁
   * @param lockId 锁 ID
   */
  release(lockId: string): void;
  
  /**
   * 检查是否被锁定
   * @param key 锁键
   */
  isLocked(key: string): boolean;
  
  /**
   * 获取所有活跃锁
   */
  getActiveLocks(): LockRecord[];

  /**
   * 按任务释放锁（用于恢复/清理）
   */
  releaseByTaskId(taskId: string): void;

  /**
   * 从持久化记录恢复锁状态
   */
  restoreLocks(locks: LockRecord[]): void;

  /**
   * 清空所有锁
   */
  clear(): void;
}

/**
 * Provider 管理器接口
 */
export interface IProviderManager {
  /**
   * 调用聊天 API
   * @param request 聊天请求
   * @returns 聊天响应
   */
  chat(request: ChatRequest): Promise<Result<ChatResponse>>;
  
  /**
   * 调用嵌入 API
   * @param request 嵌入请求
   * @returns 嵌入响应
   */
  embed(request: EmbedRequest): Promise<Result<EmbedResponse>>;
  
  /**
   * 检查 Provider 可用性
   * @param providerId Provider ID
   * @param forceRefresh 是否强制刷新缓存
   * @returns Provider 能力
   */
  checkAvailability(providerId: string, forceRefresh?: boolean): Promise<Result<ProviderCapabilities>>;
  
  /**
   * 清除可用性缓存
   * @param providerId 可选，指定 Provider ID；不指定则清除所有
   */
  clearAvailabilityCache(providerId?: string): void;
  
  /**
   * 获取已配置的 Provider 列表
   */
  getConfiguredProviders(): ProviderInfo[];
  
  /**
   * 设置 Provider 配置
   * @param id Provider ID
   * @param config Provider 配置
   */
  setProvider(id: string, config: ProviderConfig): void;
  
  /**
   * 移除 Provider
   * @param id Provider ID
   */
  removeProvider(id: string): void;
}

/**
 * 向量索引接口
 */
export interface IVectorIndex {
  /**
   * 添加或更新向量条目
   * @param entry 向量条目
   */
  upsert(entry: VectorEntry): Promise<Result<void>>;
  
  /**
   * 删除向量条目
   * @param uid 概念 UID
   */
  delete(uid: string): Promise<Result<void>>;
  
  /**
   * 搜索相似概念
   * @param type 知识类型
   * @param embedding 向量嵌入
   * @param topK 返回数量
   * @returns 搜索结果列表
   */
  search(type: CRType, embedding: number[], topK: number): Promise<Result<SearchResult[]>>;
  
  /**
   * 获取索引统计信息
   */
  getStats(): IndexStats;

  /**
   * 根据 UID 获取条目（用于增量/合并写入后更新索引）
   */
  getEntry(uid: string): VectorEntry | undefined;
}

/**
 * 撤销管理器接口
 */
export interface IUndoManager {
  /**
   * 初始化撤销管理器
   */
  initialize(): Promise<Result<void>>;
  
  /**
   * 创建快照
   * 遵循 Requirements 2.7：快照包含 id, nodeId, taskId, path, content, created, fileSize, checksum
   * 
   * @param filePath 文件路径
   * @param content 文件内容
   * @param taskId 关联的任务 ID
   * @param nodeId 可选的节点 ID，如果不提供则从文件路径提取
   * @returns 快照 ID
   */
  createSnapshot(filePath: string, content: string, taskId: string, nodeId?: string): Promise<Result<string>>;
  
  /**
   * 恢复快照（仅读取快照内容，不写入文件）
   * @param snapshotId 快照 ID
   * @returns 快照内容
   */
  restoreSnapshot(snapshotId: string): Promise<Result<Snapshot>>;
  
  /**
   * 恢复快照到文件
   * 遵循 Requirements 2.8：使用原子写入（temp file + rename）确保数据完整性
   * @param snapshotId 快照 ID
   * @returns 恢复的快照内容
   */
  restoreSnapshotToFile(snapshotId: string): Promise<Result<Snapshot>>;
  
  /**
   * 删除快照
   * @param snapshotId 快照 ID
   */
  deleteSnapshot(snapshotId: string): Promise<Result<void>>;
  
  /**
   * 列出所有快照
   * @returns 快照元数据列表
   */
  listSnapshots(): Promise<Result<SnapshotMetadata[]>>;
  
  /**
   * 清理过期快照
   * @param maxAgeMs 最大保留时间（毫秒）
   * @returns 清理的快照数量
   */
  cleanupExpiredSnapshots(maxAgeMs: number): Promise<Result<number>>;
}

/**
 * 重复管理器接口
 */
export interface IDuplicateManager {
  /**
   * 检测重复概念
   * @param nodeId 概念 UID
   * @param type 知识类型
   * @param embedding 向量嵌入
   * @returns 重复对列表
   */
  detect(nodeId: string, type: CRType, embedding: number[]): Promise<Result<DuplicatePair[]>>;
  
  /**
   * 获取待处理的重复对
   */
  getPendingPairs(): DuplicatePair[];

  /**
   * 更新重复对状态
   */
  updateStatus(pairId: string, status: DuplicatePairStatus): Promise<Result<void>>;
  
  /**
   * 移除重复对
   */
  removePair(pairId: string): Promise<Result<void>>;
  
  /**
   * 标记为非重复
   * @param pairId 重复对 ID
   */
  markAsNonDuplicate(pairId: string): Promise<Result<void>>;
  
  /**
   * 开始合并
   * @param pairId 重复对 ID
   * @returns 合并任务 ID
   */
  startMerge(pairId: string): Promise<Result<string>>;
  
  /**
   * 完成合并
   * @param pairId 重复对 ID
   * @param keepNodeId 保留的概念 UID
   */
  completeMerge(pairId: string, keepNodeId: string): Promise<Result<void>>;
  
  /**
   * 订阅重复对变更
   * @param listener 监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: (pairs: DuplicatePair[]) => void): () => void;
}

/**
 * 提示词管理器接口
 */
export interface IPromptManager {
  /**
   * 构建 prompt
   * @param taskType 任务类型
   * @param slots 上下文槽位
   * @param conceptType 知识类型（可选，用于 reason:new 任务选择正确的模板）
   * @returns 完整的 prompt
   */
  build(taskType: TaskType, slots: Record<string, string>, conceptType?: string): Result<string>;
  
  /**
   * 验证模板
   * @param templateId 模板 ID
   * @returns 是否有效
   */
  validateTemplate(templateId: string): Result<boolean>;
  
  /**
   * 获取必需槽位
   * @param taskType 任务类型
   * @returns 必需槽位列表
   */
  getRequiredSlots(taskType: TaskType): string[];
  
  /**
   * 获取可选槽位
   * @param taskType 任务类型
   * @returns 可选槽位列表
   */
  getOptionalSlots(taskType: TaskType): string[];

  /**
   * 解析模板 ID
   * 遵循 A-FUNC-03：用于入队前硬校验
   * @param taskType 任务类型
   * @param conceptType 知识类型（可选）
   * @returns 模板 ID
   */
  resolveTemplateId(taskType: TaskType, conceptType?: string): string;

  /**
   * 检查模板是否已加载
   * 遵循 A-FUNC-03：用于入队前硬校验
   * @param templateId 模板 ID
   * @returns 是否已加载
   */
  hasTemplate(templateId: string): boolean;
}

/**
 * 验证器接口
 */
export interface IValidator {
  /**
   * 验证输出
   * @param output 输出字符串
   * @param schema JSON Schema
   * @param rules 业务规则列表
   * @param context 验证上下文
   * @returns 验证结果
   */
  validate(
    output: string,
    schema: object,
    rules: string[],
    context?: ValidationContext
  ): Promise<ValidationResult>;
}

/**
 * 设置存储接口
 */
export interface ISettingsStore {
  /**
   * 获取设置
   */
  getSettings(): PluginSettings;
  
  /**
   * 更新设置
   * @param partial 部分设置
   */
  updateSettings(partial: Partial<PluginSettings>): Promise<Result<void>>;
  
  /**
   * 导出设置
   * @returns JSON 字符串
   */
  exportSettings(): string;
  
  /**
   * 导入设置
   * @param json JSON 字符串
   */
  importSettings(json: string): Promise<Result<void>>;
  
  /**
   * 重置为默认值
   */
  resetToDefaults(): Promise<Result<void>>;
  
  /**
   * 订阅设置变更
   * @param listener 监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: (settings: PluginSettings) => void): () => void;
}

/**
 * 文件存储接口
 */
export interface IFileStorage {
  /**
   * 初始化目录结构
   * 创建 data/, data/snapshots/ 目录
   * 初始化 queue-state.json, vector-index.json, duplicate-pairs.json, snapshots/index.json
   * @returns 初始化结果
   */
  initialize(): Promise<Result<void>>;
  
  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean;
  
  /**
   * 读取文件
   * @param path 文件路径
   * @returns 文件内容
   */
  read(path: string): Promise<Result<string>>;
  
  /**
   * 写入文件（普通写入）
   * @param path 文件路径
   * @param content 文件内容
   */
  write(path: string, content: string): Promise<Result<void>>;
  
  /**
   * 原子写入文件
   * 写入临时文件 .tmp → 校验完整性 → 重命名为目标文件
   * 用于关键数据写入（如快照恢复），确保数据完整性
   * @param path 文件路径
   * @param content 文件内容
   */
  atomicWrite(path: string, content: string): Promise<Result<void>>;
  
  /**
   * 删除文件
   * @param path 文件路径
   */
  delete(path: string): Promise<Result<void>>;
  
  /**
   * 检查文件是否存在
   * @param path 文件路径
   */
  exists(path: string): Promise<boolean>;
  
  /**
   * 确保目录存在
   * @param path 目录路径
   */
  ensureDir(path: string): Promise<Result<void>>;
}

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
}
