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

export type ErrorCategory =
  | "INPUT_VALIDATION"
  | "PROVIDER_AI"
  | "SYSTEM_IO"
  | "CONFIG"
  | "INTERNAL";

export interface ErrorCodeInfo {
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

  // E2xx Provider/AI（通常可重试）
  E201_PROVIDER_TIMEOUT: {
    code: "E201_PROVIDER_TIMEOUT",
    name: "PROVIDER_TIMEOUT",
    description: "Provider 请求超时",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "可稍后重试，或在设置中提高超时时间/切换模型。",
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
    description: "Provider 调用失败（非超时/非鉴权/非限流）",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "请重试；若持续失败请检查 Provider 状态与网络。",
  },
  E210_MODEL_OUTPUT_PARSE_FAILED: {
    code: "E210_MODEL_OUTPUT_PARSE_FAILED",
    name: "MODEL_OUTPUT_PARSE_FAILED",
    description: "模型输出非 JSON 或解析失败",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "系统将自动重试并强化输出约束。",
  },
  E211_MODEL_SCHEMA_VIOLATION: {
    code: "E211_MODEL_SCHEMA_VIOLATION",
    name: "MODEL_SCHEMA_VIOLATION",
    description: "模型输出不符合 Schema",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "系统将自动重试并提示模型修正结构。",
  },
  E212_MODEL_CONSTRAINT_VIOLATION: {
    code: "E212_MODEL_CONSTRAINT_VIOLATION",
    name: "MODEL_CONSTRAINT_VIOLATION",
    description: "模型输出违反业务约束",
    category: "PROVIDER_AI",
    retryable: true,
    fixSuggestion: "系统将自动重试；若持续失败请检查输入是否过于含混。",
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
  E304_SNAPSHOT_FAILED: {
    code: "E304_SNAPSHOT_FAILED",
    name: "SNAPSHOT_FAILED",
    description: "快照创建失败",
    category: "SYSTEM_IO",
    retryable: false,
    fixSuggestion: "请检查快照目录权限与磁盘空间。",
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

  // E4xx 配置（不可重试）
  E401_PROVIDER_NOT_CONFIGURED: {
    code: "E401_PROVIDER_NOT_CONFIGURED",
    name: "PROVIDER_NOT_CONFIGURED",
    description: "Provider 未配置",
    category: "CONFIG",
    retryable: false,
    fixSuggestion: "请先在设置页配置 Provider 与 API Key。",
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

export type ErrorCode = keyof typeof ERROR_CODE_INFO;

export function isValidErrorCode(code: string): code is ErrorCode {
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

export function getFixSuggestion(code: string): string | undefined {
  return getErrorCodeInfo(code)?.fixSuggestion;
}
