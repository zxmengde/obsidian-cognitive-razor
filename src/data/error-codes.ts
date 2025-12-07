/**
 * 错误码定义
 * 
 * 遵循设计文档 section 6.5.1 定义的错误码系统
 * 
 * 错误码范围：
 * - E001-E010: 内容错误（可重试）
 * - E100-E102: 网络错误（可重试，指数退避）
 * - E103: 认证错误（终止）
 * - E200-E201: 安全/能力错误（终止）
 * - E300-E304: 文件系统错误（终止）
 * 
 * **Validates: Requirements 6.5**
 */

// ============================================================================
// 错误码枚举
// ============================================================================

/**
 * 内容错误码 (E001-E010)
 * 这些错误可以通过重试（附加错误历史）来修复
 */
export const ContentErrorCodes = {
  /** 输出非 JSON 或解析失败 */
  E001: "E001",
  /** 不符合输出 Schema */
  E002: "E002",
  /** 必填字段缺失 */
  E003: "E003",
  /** 违反业务规则 C001-C016 */
  E004: "E004",
  /** 相似度超阈值（语义重复） */
  E005: "E005",
  /** wikilink 格式错误 */
  E006: "E006",
  /** 输出类型与预期不符 */
  E007: "E007",
  /** 内容长度不足 */
  E008: "E008",
  /** type_confidences 求和 ≠ 1 */
  E009: "E009",
  /** 字段不匹配正则 */
  E010: "E010",
} as const;

/**
 * 网络错误码 (E100-E102)
 * 这些错误可以通过指数退避重试来恢复
 */
export const NetworkErrorCodes = {
  /** Provider 返回 5xx/4xx */
  E100: "E100",
  /** 请求超时 */
  E101: "E101",
  /** 触发速率限制 (429) */
  E102: "E102",
} as const;

/**
 * 认证错误码 (E103)
 * 终止错误，不重试
 */
export const AuthErrorCodes = {
  /** 认证失败 (401/403) */
  E103: "E103",
} as const;

/**
 * 能力错误码 (E200-E201)
 * 终止错误，不重试
 */
export const CapabilityErrorCodes = {
  /** 触发安全边界 */
  E200: "E200",
  /** Provider 能力不足 */
  E201: "E201",
} as const;

/**
 * 文件系统错误码 (E300-E304)
 * 终止错误，不重试
 */
export const FileSystemErrorCodes = {
  /** 文件写入失败 */
  E300: "E300",
  /** 文件读取失败 */
  E301: "E301",
  /** 向量索引损坏 */
  E302: "E302",
  /** 快照恢复失败 */
  E303: "E303",
  /** Provider 不存在 */
  E304: "E304",
} as const;

// ============================================================================
// 错误码类型
// ============================================================================

export type ContentErrorCode = typeof ContentErrorCodes[keyof typeof ContentErrorCodes];
export type NetworkErrorCode = typeof NetworkErrorCodes[keyof typeof NetworkErrorCodes];
export type AuthErrorCode = typeof AuthErrorCodes[keyof typeof AuthErrorCodes];
export type CapabilityErrorCode = typeof CapabilityErrorCodes[keyof typeof CapabilityErrorCodes];
export type FileSystemErrorCode = typeof FileSystemErrorCodes[keyof typeof FileSystemErrorCodes];

/** 所有错误码类型 */
export type ErrorCode = 
  | ContentErrorCode 
  | NetworkErrorCode 
  | AuthErrorCode 
  | CapabilityErrorCode 
  | FileSystemErrorCode;

// ============================================================================
// 错误码信息
// ============================================================================

/**
 * 错误码详细信息
 */
export interface ErrorCodeInfo {
  /** 错误码 */
  code: ErrorCode;
  /** 错误名称 */
  name: string;
  /** 错误描述 */
  description: string;
  /** 错误类别 */
  category: "CONTENT" | "NETWORK" | "AUTH" | "CAPABILITY" | "FILE_SYSTEM";
  /** 是否可重试 */
  retryable: boolean;
  /** 修复建议 */
  fixSuggestion?: string;
}

/**
 * 错误码信息映射表
 */
export const ERROR_CODE_INFO: Record<ErrorCode, ErrorCodeInfo> = {
  // 内容错误 (E001-E010)
  E001: {
    code: "E001",
    name: "PARSE_ERROR",
    description: "输出非 JSON 或解析失败",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出格式不正确，系统将自动重试并提供更明确的指示。",
  },
  E002: {
    code: "E002",
    name: "SCHEMA_VIOLATION",
    description: "不符合输出 Schema",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出不符合预期格式，系统将自动重试。",
  },
  E003: {
    code: "E003",
    name: "MISSING_REQUIRED",
    description: "必填字段缺失",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出缺少必填字段，系统将自动重试。",
  },
  E004: {
    code: "E004",
    name: "CONSTRAINT_VIOLATION",
    description: "违反业务规则 C001-C016",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出违反业务规则，系统将自动重试。",
  },
  E005: {
    code: "E005",
    name: "SEMANTIC_DUPLICATE",
    description: "相似度超阈值（语义重复）",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "检测到语义重复，请检查重复面板。",
  },
  E006: {
    code: "E006",
    name: "INVALID_WIKILINK",
    description: "wikilink 格式错误",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出的 wikilink 格式不正确，系统将自动重试。",
  },
  E007: {
    code: "E007",
    name: "TYPE_MISMATCH",
    description: "输出类型与预期不符",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出类型不匹配，系统将自动重试。",
  },
  E008: {
    code: "E008",
    name: "CONTENT_TOO_SHORT",
    description: "内容长度不足",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出内容过短，系统将自动重试。",
  },
  E009: {
    code: "E009",
    name: "SUM_NOT_ONE",
    description: "type_confidences 求和 ≠ 1",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出的置信度求和不为 1，系统将自动重试。",
  },
  E010: {
    code: "E010",
    name: "INVALID_PATTERN",
    description: "字段不匹配正则",
    category: "CONTENT",
    retryable: true,
    fixSuggestion: "AI 输出字段格式不正确，系统将自动重试。",
  },

  // 网络错误 (E100-E102)
  E100: {
    code: "E100",
    name: "API_ERROR",
    description: "Provider 返回 5xx/4xx",
    category: "NETWORK",
    retryable: true,
    fixSuggestion: "API 调用失败，系统将自动重试。",
  },
  E101: {
    code: "E101",
    name: "TIMEOUT",
    description: "请求超时",
    category: "NETWORK",
    retryable: true,
    fixSuggestion: "请求超时，系统将自动重试。",
  },
  E102: {
    code: "E102",
    name: "RATE_LIMIT",
    description: "触发速率限制 (429)",
    category: "NETWORK",
    retryable: true,
    fixSuggestion: "请稍后再试，或考虑升级 API 套餐以获得更高的速率限制。",
  },

  // 认证错误 (E103)
  E103: {
    code: "E103",
    name: "AUTH_ERROR",
    description: "认证失败 (401/403)",
    category: "AUTH",
    retryable: false,
    fixSuggestion: "请前往设置页面检查并更新 API Key。",
  },

  // 能力错误 (E200-E201)
  E200: {
    code: "E200",
    name: "SAFETY_VIOLATION",
    description: "触发安全边界",
    category: "CAPABILITY",
    retryable: false,
    fixSuggestion: "请修改输入内容，避免触发安全限制。",
  },
  E201: {
    code: "E201",
    name: "CAPABILITY_MISMATCH",
    description: "Provider 能力不足",
    category: "CAPABILITY",
    retryable: false,
    fixSuggestion: "请选择支持此功能的 Provider 或检查配置。",
  },

  // 文件系统错误 (E300-E304)
  E300: {
    code: "E300",
    name: "FILE_WRITE_ERROR",
    description: "文件写入失败",
    category: "FILE_SYSTEM",
    retryable: false,
    fixSuggestion: "请检查文件写入权限和磁盘空间。",
  },
  E301: {
    code: "E301",
    name: "FILE_READ_ERROR",
    description: "文件读取失败",
    category: "FILE_SYSTEM",
    retryable: false,
    fixSuggestion: "请检查文件是否存在和读取权限。",
  },
  E302: {
    code: "E302",
    name: "INDEX_CORRUPTED",
    description: "向量索引损坏",
    category: "FILE_SYSTEM",
    retryable: false,
    fixSuggestion: "向量索引可能已损坏，请尝试重建索引。",
  },
  E303: {
    code: "E303",
    name: "SNAPSHOT_RESTORE_FAILED",
    description: "快照恢复失败",
    category: "FILE_SYSTEM",
    retryable: false,
    fixSuggestion: "快照恢复失败，请检查快照文件是否完整。",
  },
  E304: {
    code: "E304",
    name: "PROVIDER_NOT_FOUND",
    description: "Provider 不存在",
    category: "FILE_SYSTEM",
    retryable: false,
    fixSuggestion: "请检查 Provider 配置是否正确。",
  },
};

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查是否为有效的错误码
 */
export function isValidErrorCode(code: string): code is ErrorCode {
  return code in ERROR_CODE_INFO;
}

/**
 * 获取错误码信息
 */
export function getErrorCodeInfo(code: string): ErrorCodeInfo | undefined {
  if (isValidErrorCode(code)) {
    return ERROR_CODE_INFO[code];
  }
  return undefined;
}

/**
 * 检查错误码是否可重试
 */
export function isRetryableErrorCode(code: string): boolean {
  const info = getErrorCodeInfo(code);
  return info?.retryable ?? false;
}

/**
 * 获取错误码的修复建议
 */
export function getFixSuggestion(code: string): string | undefined {
  const info = getErrorCodeInfo(code);
  return info?.fixSuggestion;
}

/**
 * 检查是否为内容错误 (E001-E010)
 */
export function isContentErrorCode(code: string): boolean {
  return code in ContentErrorCodes || /^E00[1-9]$|^E010$/.test(code);
}

/**
 * 检查是否为网络错误 (E100-E102)
 */
export function isNetworkErrorCode(code: string): boolean {
  return code in NetworkErrorCodes || /^E10[0-2]$/.test(code);
}

/**
 * 检查是否为认证错误 (E103)
 */
export function isAuthErrorCode(code: string): boolean {
  return code === "E103";
}

/**
 * 检查是否为能力错误 (E200-E201)
 */
export function isCapabilityErrorCode(code: string): boolean {
  return code in CapabilityErrorCodes || /^E20[0-1]$/.test(code);
}

/**
 * 检查是否为文件系统错误 (E300-E304)
 */
export function isFileSystemErrorCode(code: string): boolean {
  return code in FileSystemErrorCodes || /^E30[0-4]$/.test(code);
}

/**
 * 检查是否为终止错误（不可重试）
 */
export function isTerminalErrorCode(code: string): boolean {
  return isAuthErrorCode(code) || isCapabilityErrorCode(code) || isFileSystemErrorCode(code);
}

/**
 * 获取所有错误码列表
 */
export function getAllErrorCodes(): ErrorCode[] {
  return Object.keys(ERROR_CODE_INFO) as ErrorCode[];
}

/**
 * 获取错误码的类别
 */
export function getErrorCategory(code: string): ErrorCodeInfo["category"] | undefined {
  const info = getErrorCodeInfo(code);
  return info?.category;
}
