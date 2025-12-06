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
 */
export interface ProviderConfig {
  /** Provider 类型 */
  type: ProviderType;
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
 * 默认端点配置
 */
export const DEFAULT_ENDPOINTS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1"
};

/**
 * 插件设置
 */
export interface CognitiveRazorSettings {
  /** 插件版本 */
  version: string;
  /** Provider 配置 */
  providers: Record<string, ProviderConfig>;
  /** 默认 Provider ID */
  defaultProviderId: string;
  /** 相似度阈值 (0-1) */
  similarityThreshold: number;
  /** 最大快照数量 */
  maxSnapshots: number;
  /** 并发任务数 */
  concurrency: number;
  /** 高级模式 */
  advancedMode: boolean;
  /** 日志级别 */
  logLevel: "debug" | "info" | "warn" | "error";
}

// ============================================================================
// 标准化概念
// ============================================================================

/**
 * 标准化概念结果
 */
export interface StandardizedConcept {
  /** 标准名称 */
  standardName: {
    /** 中文名 */
    chinese: string;
    /** 英文名 */
    english: string;
  };
  /** 别名列表 */
  aliases: string[];
  /** 类型置信度 */
  typeConfidences: {
    Domain: number;
    Issue: number;
    Theory: number;
    Entity: number;
    Mechanism: number;
  };
  /** 核心定义 */
  coreDefinition: string;
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
  /** Provider 类型 (添加模式) */
  providerType?: ProviderType;
  /** 当前配置 (编辑模式) */
  currentConfig?: ProviderConfig;
  /** 保存回调 */
  onSave: (id: string, config: ProviderConfig) => Promise<void>;
  /** 取消回调 */
  onCancel?: () => void;
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
