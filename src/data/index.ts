/**
 * 数据层组件导出
 */

export { Logger } from "./logger";
export { FileStorage } from "./file-storage";
export { SettingsStore, DEFAULT_SETTINGS } from "./settings-store";
export { Validator } from "./validator";

// 错误码系统
export {
  ContentErrorCodes,
  NetworkErrorCodes,
  AuthErrorCodes,
  CapabilityErrorCodes,
  FileSystemErrorCodes,
  ERROR_CODE_INFO,
  isValidErrorCode,
  getErrorCodeInfo,
  isRetryableErrorCode,
  getFixSuggestion,
  isContentErrorCode,
  isNetworkErrorCode,
  isAuthErrorCode,
  isCapabilityErrorCode,
  isFileSystemErrorCode,
  isTerminalErrorCode,
  getAllErrorCodes,
  getErrorCategory,
} from "./error-codes";

export type {
  ErrorCode,
  ContentErrorCode,
  NetworkErrorCode,
  AuthErrorCode,
  CapabilityErrorCode,
  FileSystemErrorCode,
  ErrorCodeInfo,
} from "./error-codes";
