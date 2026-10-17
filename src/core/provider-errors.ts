import { err } from "../types";
import type { Result } from "../types";

/** URL 脱敏：日志只保留协议、主机和路径。 */
export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

/** 文本脱敏（避免错误详情携带 API key 或 Authorization 头） */
function sanitizeSensitiveText(raw: string, apiKey?: string): string {
  let sanitized = raw;
  if (apiKey) {
    sanitized = sanitized.split(apiKey).join("[redacted-api-key]");
  }
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  sanitized = sanitized.replace(
    /\b(api[_-]?key|x[_-]?api[_-]?key|x[_-]?goog[_-]?api[_-]?key|access[_-]?token|api[_-]?token|authorization|password|secret|token)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    "$1=[redacted]",
  );
  return sanitized.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url));
}

const MAX_PROVIDER_ERROR_DETAIL_LENGTH = 500;

export function sanitizeProviderErrorDetail(raw: string, apiKey?: string): string {
  const sanitized = sanitizeSensitiveText(raw, apiKey).trim();
  if (sanitized.length <= MAX_PROVIDER_ERROR_DETAIL_LENGTH) {
    return sanitized;
  }
  return `${sanitized.slice(0, MAX_PROVIDER_ERROR_DETAIL_LENGTH - 3)}...`;
}

/** 只把有限的结构诊断写入日志，排除完整响应和请求正文。 */
export function summarizeProviderErrorDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const source = details as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["status", "kind", "phase", "timeoutMs", "providerType", "providerCode", "providerParam", "providerMessage", "eventType", "incompleteReason"]) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") summary[key] = value;
  }
  const shape = source.responseShape;
  if (shape && typeof shape === "object" && !Array.isArray(shape)) {
    const safeShape = shape as Record<string, unknown>;
    summary.responseShape = {
      status: typeof safeShape.status === "string" ? safeShape.status : undefined,
      incompleteReason: typeof safeShape.incompleteReason === "string" ? safeShape.incompleteReason : undefined,
      hasOutputText: typeof safeShape.hasOutputText === "boolean" ? safeShape.hasOutputText : undefined,
      outputItemCount: typeof safeShape.outputItemCount === "number" ? safeShape.outputItemCount : undefined,
      outputTypes: Array.isArray(safeShape.outputTypes) ? safeShape.outputTypes.slice(0, 12) : undefined,
      contentTypes: Array.isArray(safeShape.contentTypes) ? safeShape.contentTypes.slice(0, 12) : undefined,
      hasChoicesFallback: typeof safeShape.hasChoicesFallback === "boolean" ? safeShape.hasChoicesFallback : undefined,
    };
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** HTTP 错误响应 */
interface HttpErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
}

/**
 * 将 HTTP 状态码映射为错误结果
 * 用户可见消息仅包含错误码和安全描述，原始 API 响应放入 details。
 */
export function mapHttpError(status: number, responseText: string, apiKey?: string): Result<never> {
  // 解析原始响应用于日志/调试（放入 details，不暴露给用户）
  let rawDetail = responseText;
  let providerType: string | undefined;
  let providerCode: string | undefined;
  let providerParam: string | undefined;
  try {
    const errorData: HttpErrorResponse = JSON.parse(responseText);
    if (errorData.error?.message) {
      rawDetail = errorData.error.message;
    }
    providerType = errorData.error?.type;
    providerCode = errorData.error?.code;
    providerParam = errorData.error?.param;
  } catch {
    // 保持原始文本
  }
  rawDetail = sanitizeProviderErrorDetail(rawDetail, apiKey);

  // 认证错误 (401/403) → E203_INVALID_API_KEY
  if (status === 401 || status === 403) {
    return err("E203_INVALID_API_KEY", "认证失败，请检查 API Key 是否正确", { status, rawResponse: rawDetail });
  }

  // 速率限制 (429) → E202_RATE_LIMITED
  if (status === 429) {
    return err("E202_RATE_LIMITED", "请求频率超限，请稍后重试", { status, rawResponse: rawDetail });
  }

  // A 408 does not prove that a generation was never accepted upstream.
  // Keep the request in the same explicit-confirmation bucket as network
  // timeouts so an automatic retry cannot duplicate a billable operation.
  if (status === 408) {
    return err(
      "E206_PROVIDER_REQUEST_UNCERTAIN",
      "Provider 请求超时，结果未知；为避免重复计费未自动重试",
      { status, kind: "upstream-http", rawResponse: rawDetail },
    );
  }

  // 网关/代理在长请求中可能已经把请求转发给模型，再返回 502/503/504。
  // Cloudflare 524 表示上游已接收请求但响应超时，同样不能证明模型未执行。
  // 这类响应无法证明模型未执行，禁止自动重试以避免重复计费。
  if (status === 502 || status === 503 || status === 504 || status === 524) {
    return err(
      "E206_PROVIDER_REQUEST_UNCERTAIN",
      `Provider/中转上游连接中断 (${status})，结果未知；为避免重复计费未自动重试`,
      { status, kind: "upstream-http", rawResponse: rawDetail },
    );
  }

  if (status >= 500) {
    return err("E204_PROVIDER_ERROR", `Provider/中转上游错误 (${status})，请稍后重试`, { status, rawResponse: rawDetail });
  }

  // 服务端已经明确拒绝的请求不会因原样重发而恢复。
  if (status >= 400 && status < 500) {
    const schemaUnsupported = /json[_ -]?schema|response[_ -]?schema|response[_ -]?format|text\.format/i.test(`${providerParam ?? ""} ${rawDetail}`)
      && /not supported|unsupported|does not support|not available|不支持/i.test(rawDetail);
    if (schemaUnsupported) {
      return err("E205_PROVIDER_REQUEST_INVALID", "所选模型或接口不支持 JSON Schema，请更换支持该格式的模型或接口；未自动降级或重试", { status, rawResponse: rawDetail, providerMessage: rawDetail });
    }
    return err("E205_PROVIDER_REQUEST_INVALID", `API 请求无效 (${status})，请检查协议、模型和参数`, {
      status,
      rawResponse: rawDetail,
      providerMessage: rawDetail,
      ...(providerType ? { providerType } : {}),
      ...(providerCode ? { providerCode } : {}),
      ...(providerParam ? { providerParam } : {}),
    });
  }

  return err("E204_PROVIDER_ERROR", `API 返回异常状态 (${status})`, { status, rawResponse: rawDetail });
}
