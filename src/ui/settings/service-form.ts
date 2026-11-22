import { isValidProviderId } from "../../data/settings-store";
import { DEFAULT_ENDPOINTS, type EmbeddingApiFormat, type ProviderApiFormat, type ProviderConfig } from "../../types";

/**
 * 服务编辑框的表单状态、校验与配置组装。与界面分离，便于单独测试；
 * 规则与旧 ProviderModal 一致：字段按协议显示，未显示的能力与参数不写入配置。
 */
export interface ServiceForm {
  id: string;
  apiKey: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  embeddingApiFormat: EmbeddingApiFormat;
  chatModel: string;
  embedModel: string;
  embeddingDimension: string;
  enableWebSearch: boolean;
  temperatureSupported: boolean;
  temperature: number;
  topPSupported: boolean;
  topP: number;
  reasoningSupported: boolean;
  reasoningEffort: string;
  thinkingLevel: string;
  thinkingBudget: string;
  promptCaching: boolean;
  promptCacheMode: "implicit" | "explicit";
  responseContinuation: boolean;
  maxTokens: string;
  enabled: boolean;
}

export type ServiceFormErrorKey =
  | "id" | "apiKey" | "chatModel" | "embedModel" | "maxTokens" | "embeddingDimension"
  | "reasoning" | "temperature" | "sampling" | "apiFormat" | "baseUrl";
export type ServiceFormErrors = Partial<Record<ServiceFormErrorKey, string>>;

const optionalNumber = (value: number | undefined) => (value === undefined ? "" : String(value));

export function initialServiceForm(id: string, config?: ProviderConfig): ServiceForm {
  return {
    id,
    apiKey: config?.apiKey ?? "",
    baseUrl: config?.baseUrl ?? "",
    apiFormat: config?.apiFormat ?? "openai-chat-completions",
    embeddingApiFormat: config?.embeddingApiFormat ?? (
      config?.apiFormat === "gemini-generative-language" || config?.apiFormat === "anthropic-messages" ? "disabled" : "openai-embeddings"
    ),
    chatModel: config?.defaultChatModel ?? "",
    embedModel: config?.defaultEmbedModel ?? "",
    embeddingDimension: optionalNumber(config?.parameters?.embeddingDimension),
    enableWebSearch: config?.capabilities?.nativeWebSearch ?? false,
    temperatureSupported: config?.capabilities?.temperature ?? false,
    temperature: config?.parameters?.temperature ?? 0.7,
    topPSupported: config?.capabilities?.topP ?? false,
    topP: config?.parameters?.topP ?? 1,
    reasoningSupported: config?.capabilities?.reasoning ?? false,
    reasoningEffort: config?.parameters?.reasoning_effort ?? "",
    thinkingLevel: config?.parameters?.thinkingLevel ?? "",
    thinkingBudget: optionalNumber(config?.parameters?.thinkingBudget),
    promptCaching: config?.capabilities?.promptCaching ?? false,
    promptCacheMode: config?.capabilities?.promptCacheMode ?? "implicit",
    responseContinuation: config?.capabilities?.responseContinuation ?? false,
    maxTokens: optionalNumber(config?.parameters?.maxTokens),
    enabled: config?.enabled ?? true,
  };
}

/** 按协议决定可显示、可写入的能力：缓存支持 Responses 与 Anthropic，续传仅支持 Responses。 */
export function serviceFormCapabilities(form: ServiceForm) {
  const format = form.apiFormat;
  return {
    responsesOnly: format === "openai-responses",
    anthropic: format === "anthropic-messages",
    gemini: format === "gemini-generative-language",
    promptCaching: format === "openai-responses" || format === "anthropic-messages",
    webSearch: format === "openai-responses" || format === "gemini-generative-language" || format === "anthropic-messages",
  };
}

export function endpointPlaceholder(form: ServiceForm): string {
  return form.apiFormat === "disabled" ? DEFAULT_ENDPOINTS["openai-chat-completions"] : DEFAULT_ENDPOINTS[form.apiFormat];
}

export function chatModelPlaceholder(form: ServiceForm): string {
  return form.apiFormat === "gemini-generative-language" ? "gemini-2.5-flash"
    : form.apiFormat === "anthropic-messages" ? "claude-sonnet-4-5" : "gpt-5-mini";
}

/** 校验整张表单；连接测试不要求服务名（requireId 为 false）。 */
export function validateServiceForm(form: ServiceForm, t: (key: string) => string, requireId = true): ServiceFormErrors {
  const errors: ServiceFormErrors = {};
  const caps = serviceFormCapabilities(form);
  if (requireId) {
    const id = form.id.trim();
    if (!id) errors.id = t("modals.providerConfig.errors.providerIdRequired");
    else if (!isValidProviderId(id)) errors.id = t("modals.providerConfig.errors.providerIdInvalid");
  }
  if (!form.apiKey.trim() && !form.baseUrl.trim()) errors.apiKey = t("modals.providerConfig.errors.apiKeyRequired");
  if (form.apiFormat !== "disabled" && !form.chatModel.trim()) errors.chatModel = t("modals.providerConfig.errors.chatModelRequired");
  if (form.embeddingApiFormat === "openai-embeddings" && !form.embedModel.trim()) errors.embedModel = t("modals.providerConfig.errors.embedModelRequired");
  for (const [value, field] of [[form.maxTokens, "maxTokens"], [form.embeddingDimension, "embeddingDimension"]] as const) {
    if (value.trim()) {
      const parsed = Number(value.trim());
      if (!Number.isSafeInteger(parsed) || parsed <= 0) errors[field] = t("taskModels.fields.positiveIntegerError");
    }
  }
  if (caps.anthropic) {
    const budgetText = form.thinkingBudget.trim();
    const parsedBudget = form.reasoningSupported && budgetText ? Number(budgetText) : undefined;
    if (form.reasoningSupported && budgetText && (!Number.isSafeInteger(parsedBudget) || (parsedBudget as number) < 1024)) {
      errors.reasoning = t("modals.providerConfig.errors.anthropicBudgetMin");
    }
    if (parsedBudget !== undefined && Number.isSafeInteger(parsedBudget) && parsedBudget >= 1024 && form.maxTokens.trim() && !errors.maxTokens) {
      if (Number(form.maxTokens.trim()) <= parsedBudget) errors.maxTokens = t("modals.providerConfig.errors.anthropicMaxTokensTooSmall");
    }
    const effort = form.reasoningEffort.trim();
    const thinkingActive = form.reasoningSupported && (parsedBudget !== undefined || (effort !== "" && effort !== "none"));
    if (form.temperatureSupported && (form.temperature < 0 || form.temperature > 1)) {
      errors.temperature = t("modals.providerConfig.errors.anthropicTemperatureRange");
    }
    if (!thinkingActive && form.temperatureSupported && form.topPSupported) {
      errors.sampling = t("modals.providerConfig.errors.anthropicSamplingConflict");
    }
  }
  if (form.apiFormat === "disabled" && form.embeddingApiFormat === "disabled") errors.apiFormat = t("modals.providerConfig.errors.capabilityRequired");
  if (form.baseUrl.trim()) {
    try {
      const url = new URL(form.baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) errors.baseUrl = t("modals.providerConfig.errors.invalidUrlProtocol");
    } catch {
      errors.baseUrl = t("modals.providerConfig.errors.invalidUrl");
    }
  }
  return errors;
}

/** 组装要保存的配置。currentConfig 用于保留 Gemini 下界面不编辑的 thinkingBudget。 */
export function buildServiceConfig(form: ServiceForm, currentConfig: ProviderConfig | undefined, enabled = form.enabled): ProviderConfig {
  const caps = serviceFormCapabilities(form);
  return {
    apiKey: form.apiKey.trim(),
    baseUrl: form.baseUrl.trim() || undefined,
    apiFormat: form.apiFormat,
    capabilities: {
      nativeWebSearch: caps.webSearch && form.enableWebSearch,
      temperature: form.temperatureSupported,
      topP: form.topPSupported,
      reasoning: form.reasoningSupported,
      promptCaching: caps.promptCaching && form.promptCaching,
      ...(caps.responsesOnly && form.promptCaching ? { promptCacheMode: form.promptCacheMode } : {}),
      ...(caps.responsesOnly && form.promptCaching && form.promptCacheMode === "explicit" ? { promptCacheTtl: "30m" as const } : {}),
      responseContinuation: caps.responsesOnly && form.responseContinuation,
    },
    parameters: {
      ...(form.temperatureSupported ? { temperature: form.temperature } : {}),
      ...(form.topPSupported ? { topP: form.topP } : {}),
      ...(caps.gemini && form.thinkingLevel.trim() ? { thinkingLevel: form.thinkingLevel.trim() } : {}),
      ...(caps.gemini && currentConfig?.parameters?.thinkingBudget !== undefined ? { thinkingBudget: currentConfig.parameters.thinkingBudget } : {}),
      ...(caps.anthropic && form.reasoningSupported && form.thinkingBudget.trim() ? { thinkingBudget: Number(form.thinkingBudget.trim()) } : {}),
      ...(form.reasoningSupported && !caps.gemini && form.reasoningEffort.trim() ? { reasoning_effort: form.reasoningEffort.trim() } : {}),
      ...(form.maxTokens.trim() ? { maxTokens: Number(form.maxTokens.trim()) } : {}),
      ...(form.embeddingDimension.trim() ? { embeddingDimension: Number(form.embeddingDimension.trim()) } : {}),
    },
    embeddingApiFormat: form.embeddingApiFormat,
    defaultChatModel: form.apiFormat === "disabled" ? "" : form.chatModel.trim(),
    defaultEmbedModel: form.embeddingApiFormat === "disabled" ? "" : form.embedModel.trim(),
    enabled,
  };
}

/** 连接测试结果对应的配置签名；表单变化后旧结果作废。 */
export function serviceFormSignature(form: ServiceForm, currentConfig: ProviderConfig | undefined): string {
  return JSON.stringify({ id: form.id.trim(), config: buildServiceConfig(form, currentConfig, true) });
}
