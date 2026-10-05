/**
 * 错误码定义（SSOT）
 *
 * 约定（与 docs/TECHNICAL_DESIGN_DOCUMENT.md 对齐）：
 * - E1xx: 输入/校验错误（不可重试）
 * - E2xx: Provider/AI 错误（通常可重试）
 * - E3xx: 系统/IO/运行时状态错误（视情况）
 * - E4xx: 配置错误（不可重试）
 * - E5xx: 内部错误/BUG（不可重试）
 *
 * 形式：统一使用 “E###_NAME” 作为错误码字符串，便于日志检索与排障沟通。
 */

type ErrorCategory =
  | "INPUT_VALIDATION"
  | "PROVIDER_AI"
  | "SYSTEM_IO"
  | "CONFIG"
  | "INTERNAL";

interface ErrorCodeInfo {
  code: string;
  name: string;
  description: string;
  category: ErrorCategory;
  retryable: boolean;
  fixSuggestion?: string;
}

export const ERROR_CODE_INFO = {
  // E1xx 输入/校验（不可重试）
  E101_INVALID_INPUT: {
    code: "E101_INVALID_INPUT",
    name: "INVALID_INPUT",
    description: "输入格式错误或无效",
    category: "INPUT_VALIDATION",
    retryable: false,
    fixSuggestion: "请检查输入内容或必要参数后重试。",
  },
  E102_MISSING_FIELD: {
    code: "E102_MISSING_FIELD",
    name: "MISSING_FIELD",
    description: "必需字段缺失",
    category: "INPUT_VALIDATION",
    retryable: false,
    fixSuggestion: "请补全必要字段后重试。",
  },

  E103_CARDS_SOURCE_OUTSIDE_ROOT: {
    code: "E103_CARDS_SOURCE_OUTSIDE_ROOT",
    name: "CARDS_SOURCE_OUTSIDE_ROOT",
    description: "源笔记必须位于配置的知识库目录内",
    category: "INPUT_VALIDATION",
    retryable: false,
    fixSuggestion: "请在设置 → 笔记与卡片中检查知识库根目录，或打开该目录内的笔记再生成卡片；不会自动移动笔记。",
  },

  // E2xx Provider/AI（通常可重试）
  E201_PROVIDER_TIMEOUT: {
    code: "E201_PROVIDER_TIMEOUT",
    name: "PROVIDER_TIMEOUT",
    description: "Provider 请求超时，结果未知",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请先确认 Provider 请求记录或账单，再从工作台手动重试；不要自动重复长请求。",
  },
  E202_RATE_LIMITED: {
    code: "E202_RATE_LIMITED",
    name: "RATE_LIMITED",
    description: "触发速率限制 (429)",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "请稍后重试，或降低并发/升级套餐。",
  },
  E203_INVALID_API_KEY: {
    code: "E203_INVALID_API_KEY",
    name: "INVALID_API_KEY",
    description: "API 密钥无效 (401/403)",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请前往设置页面检查并更新 API Key。",
  },
  E204_PROVIDER_ERROR: {
    code: "E204_PROVIDER_ERROR",
    name: "PROVIDER_ERROR",
    description: "Provider、中转或模型上游调用失败（非超时/非鉴权/非限流）",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "请检查网络及 Provider/中转状态后重试。",
  },
  E205_PROVIDER_REQUEST_INVALID: {
    code: "E205_PROVIDER_REQUEST_INVALID",
    name: "PROVIDER_REQUEST_INVALID",
    description: "Provider 明确拒绝了请求参数或协议",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请检查协议、模型名称、请求参数与 Provider 兼容性。",
  },
  E206_PROVIDER_REQUEST_UNCERTAIN: {
    code: "E206_PROVIDER_REQUEST_UNCERTAIN",
    name: "PROVIDER_REQUEST_UNCERTAIN",
    description: "请求超时、连接中断或网关错误后无法确认 Provider 是否已处理请求",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请先检查 Provider 账单或请求记录，再从工作台手动重试；不要让插件自动重复长请求。",
  },
  E207_PROVIDER_RESPONSE_UNSUPPORTED: {
    code: "E207_PROVIDER_RESPONSE_UNSUPPORTED",
    name: "PROVIDER_RESPONSE_UNSUPPORTED",
    description: "Provider 返回了插件无法继续处理的状态、工具调用或响应结构",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请检查所选协议与中转服务兼容性；该响应不会自动重试，以避免重复计费。",
  },
  E208_PROVIDER_STREAM_FAILED: {
    code: "E208_PROVIDER_STREAM_FAILED",
    name: "PROVIDER_STREAM_FAILED",
    description: "流式连接已建立，但 Provider 通过标准错误事件明确终止请求",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请查看上游错误代码和服务状态；确认后可从任务工作台手动重试。",
  },
  E210_MODEL_OUTPUT_PARSE_FAILED: {
    code: "E210_MODEL_OUTPUT_PARSE_FAILED",
    name: "MODEL_OUTPUT_PARSE_FAILED",
    description: "模型输出非 JSON 或解析失败",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "可从任务队列手动重试；若持续失败，请检查模型的结构化输出能力。",
  },
  E211_MODEL_SCHEMA_VIOLATION: {
    code: "E211_MODEL_SCHEMA_VIOLATION",
    name: "MODEL_SCHEMA_VIOLATION",
    description: "模型输出不符合 Schema",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "可从任务队列手动重试；若持续失败，请更换结构化输出更稳定的模型。",
  },
  E212_MODEL_CONSTRAINT_VIOLATION: {
    code: "E212_MODEL_CONSTRAINT_VIOLATION",
    name: "MODEL_CONSTRAINT_VIOLATION",
    description: "模型输出违反业务约束",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "可从任务队列手动重试；若持续失败，请检查输入是否过于含混。",
  },
  E214_MODEL_OUTPUT_TRUNCATED: {
    code: "E214_MODEL_OUTPUT_TRUNCATED",
    name: "MODEL_OUTPUT_TRUNCATED",
    description: "模型输出因长度限制被截断",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "请提高 maxTokens、缩小输入范围或更换上下文长度更充足的模型。",
  },
  E213_SAFETY_VIOLATION: {
    code: "E213_SAFETY_VIOLATION",
    name: "SAFETY_VIOLATION",
    description: "触发安全边界",
    category: "PROVIDER_AI",
    retryable: false,
    fixSuggestion: "请修改输入内容，避免触发安全限制。",
  },

  // E3xx 系统/IO/状态（视情况）
  E301_FILE_NOT_FOUND: {
    code: "E301_FILE_NOT_FOUND",
    name: "FILE_NOT_FOUND",
    description: "文件不存在",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请检查文件路径或刷新 Vault 状态后重试。",
  },
  E302_PERMISSION_DENIED: {
    code: "E302_PERMISSION_DENIED",
    name: "PERMISSION_DENIED",
    description: "没有文件操作权限",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请检查 Vault/系统权限或关闭占用文件的程序。",
  },
  E303_DISK_FULL: {
    code: "E303_DISK_FULL",
    name: "DISK_FULL",
    description: "磁盘空间不足",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请释放磁盘空间后重试。",
  },
  E305_VECTOR_MISMATCH: {
    code: "E305_VECTOR_MISMATCH",
    name: "VECTOR_MISMATCH",
    description: "向量维度不匹配",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请确认 embedding 模型与 dimensions 一致，必要时重建索引。",
  },
  E310_INVALID_STATE: {
    code: "E310_INVALID_STATE",
    name: "INVALID_STATE",
    description: "状态不正确或前置条件不满足",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请按流程操作或刷新后重试。",
  },
  E311_NOT_FOUND: {
    code: "E311_NOT_FOUND",
    name: "NOT_FOUND",
    description: "资源或对象不存在",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请检查目标是否仍存在或刷新后重试。",
  },
  E320_TASK_CONFLICT: {
    code: "E320_TASK_CONFLICT",
    name: "TASK_CONFLICT",
    description: "任务/锁冲突或并发限制",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请等待当前任务完成，或取消后再试。",
  },
  E321_NOTE_SNAPSHOT_CHANGED: {
    code: "E321_NOTE_SNAPSHOT_CHANGED",
    name: "NOTE_SNAPSHOT_CHANGED",
    description: "笔记在任务期间已修改，未覆盖当前内容",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "生成结果已保留。当前正文与任务快照不同，等待不会消除差异；请先检查并保留你的编辑。重试仅尝试保存已有结果，不会再次请求模型。",
  },

  // E4xx 配置（不可重试）
  E401_PROVIDER_NOT_CONFIGURED: {
    code: "E401_PROVIDER_NOT_CONFIGURED",
    name: "PROVIDER_NOT_CONFIGURED",
    description: "Provider 未配置",
    category: "CONFIG",
    retryable: false,
    fixSuggestion: "请在设置 → AI 与模型中选择默认服务并检查模型与连接。若已有服务，请检查任务是否仍使用旧的单独设置；可在进阶任务设置中恢复默认。",
  },
  E404_TEMPLATE_NOT_FOUND: {
    code: "E404_TEMPLATE_NOT_FOUND",
    name: "TEMPLATE_NOT_FOUND",
    description: "Prompt 模板不存在或未加载",
    category: "CONFIG",
    retryable: false,
    fixSuggestion: "请检查 prompts 目录与模板文件是否完整。",
  },
  E405_TEMPLATE_INVALID: {
    code: "E405_TEMPLATE_INVALID",
    name: "TEMPLATE_INVALID",
    description: "Prompt 模板不符合契约（区块/槽位/占位符校验失败）",
    category: "CONFIG",
    retryable: false,
    fixSuggestion: "请检查模板区块结构、槽位映射与占位符是否一致。",
  },

  // E5xx 内部错误（不可重试）
  E500_INTERNAL_ERROR: {
    code: "E500_INTERNAL_ERROR",
    name: "INTERNAL_ERROR",
    description: "内部程序错误或未预期异常",
    category: "INTERNAL",
    retryable: false,
    fixSuggestion: "请重试或重启插件，如持续出现请反馈日志。",
  },
} as const satisfies Record<string, ErrorCodeInfo>;

type ErrorCode = keyof typeof ERROR_CODE_INFO;

function isValidErrorCode(code: string): code is ErrorCode {
  return code in ERROR_CODE_INFO;
}

export function getErrorCodeInfo(code: string): ErrorCodeInfo | undefined {
  if (!isValidErrorCode(code)) {
    return undefined;
  }
  return ERROR_CODE_INFO[code];
}

export function getErrorCategory(code: string): ErrorCategory | "UNKNOWN" {
  return getErrorCodeInfo(code)?.category ?? "UNKNOWN";
}

export function isRetryableErrorCode(code: string): boolean {
  return getErrorCodeInfo(code)?.retryable ?? false;
}
