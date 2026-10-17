/** 设置的默认值与纯数据转换集中在这里，使持久化不依赖转换细节。 */

import { CR_TYPES, err, ok } from "../types";
import type {
  DirectoryScheme,
  EmbeddingApiFormat,
  LogLevel,
  PluginSettings,
  ProviderApiFormat,
  ProviderConfig,
  Result,
  TaskModelConfig,
  ModelCapabilities,
  ModelParameterOverrides,
  TaskType,
} from "../types";
import { DEFAULT_MODEL_CAPABILITIES } from "../types";

const DEFAULT_DIRECTORY_SCHEME: DirectoryScheme = {
  domain: "C-知识库/1-领域",
  issue: "C-知识库/2-议题",
  theory: "C-知识库/3-理论",
  entity: "C-知识库/4-实体",
  mechanism: "C-知识库/5-机制",
};

export const DEFAULT_TASK_TIMEOUT_MS = 3 * 60 * 1000;

export const TASK_TYPES: TaskType[] = ["define", "tag", "write", "index", "verify", "merge", "cards"];

export const DEFAULT_TASK_MODEL_CONFIGS: Record<TaskType, TaskModelConfig> = {
  define: { providerId: "", model: "" },
  tag: { providerId: "", model: "" },
  write: { providerId: "", model: "" },
  index: { providerId: "", model: "" },
  verify: { providerId: "", model: "" },
  merge: { providerId: "", model: "" },
  cards: { providerId: "", model: "" },
};

export const DEFAULT_SETTINGS: PluginSettings = {
  directoryScheme: { ...DEFAULT_DIRECTORY_SCHEME },
  cardsSourceRoot: "C-知识库",
  cardsTargetRoot: "D-习题库",
  enableSemanticIndexing: true,
  enableDuplicateDetection: true,
  similarityThreshold: 0.85,
  concurrency: 1,
  taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
  logLevel: "info",
  enableAutoVerify: false,
  verifyReportPresentation: "expanded",
  queueDefaultFilter: "all",
  queuePageSize: 50,
  providers: {},
  defaultProviderId: "",
  taskModels: cloneTaskModels(DEFAULT_TASK_MODEL_CONFIGS),
  providerTimeoutMs: 60_000,
  providerMaxAttempts: 3,
  enableStreamingKeepalive: false,
  streamingTransport: "node-http",
};

const API_FORMATS = new Set<ProviderApiFormat>([
  "openai-chat-completions",
  "openai-responses",
  "gemini-generative-language",
  "disabled",
]);
const EMBEDDING_FORMATS = new Set<EmbeddingApiFormat>(["openai-embeddings", "disabled"]);

const LOG_LEVELS = new Set<LogLevel>(["silent", "debug", "info", "warn", "error"]);
const RESERVED_PROVIDER_IDS = new Set(["__proto__", "prototype", "constructor"]);

export function isValidProviderId(value: string): boolean {
  return value.length > 0 && value === value.trim() &&
    !RESERVED_PROVIDER_IDS.has(value.toLowerCase()) &&
    !Array.from(value).some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    });
}

export type SettingsUpdate = Omit<Partial<PluginSettings>, "directoryScheme" | "providers" | "taskModels"> & {
  directoryScheme?: Partial<DirectoryScheme>;
  providers?: Record<string, ProviderConfig>;
  taskModels?: Partial<Record<TaskType, TaskModelConfig>>;
};

const NUMERIC_SETTING_RULES = [
  { key: "similarityThreshold", integer: false, min: 0, max: 1 },
  { key: "concurrency", integer: true, min: 1, max: 10 },
  { key: "taskTimeoutMs", integer: true, min: 30_000, max: 3_600_000 },
  { key: "providerTimeoutMs", integer: true, min: 10_000, max: 3_600_000 },
  { key: "providerMaxAttempts", integer: true, min: 1, max: 3, defaultValue: DEFAULT_SETTINGS.providerMaxAttempts },
] as const;
const BOOLEAN_SETTING_RULES = [
  { key: "enableAutoVerify", defaultValue: DEFAULT_SETTINGS.enableAutoVerify },
  { key: "enableSemanticIndexing", defaultValue: DEFAULT_SETTINGS.enableSemanticIndexing },
  { key: "enableDuplicateDetection", defaultValue: DEFAULT_SETTINGS.enableDuplicateDetection },
  { key: "enableStreamingKeepalive", defaultValue: DEFAULT_SETTINGS.enableStreamingKeepalive },
] as const;
const PRESENTATION_SETTING_RULES = [
  { key: "streamingTransport", values: ["node-http", "renderer-fetch"] },
  { key: "verifyReportPresentation", values: ["expanded", "collapsed"] },
  { key: "queueDefaultFilter", values: ["all", "active", "failed"] },
  { key: "queuePageSize", values: [25, 50, 100] },
] as const;
type PresentationSettingKey = typeof PRESENTATION_SETTING_RULES[number]["key"];
type NumericSettingKey = typeof NUMERIC_SETTING_RULES[number]["key"];
type BooleanSettingKey = typeof BOOLEAN_SETTING_RULES[number]["key"];
type ScalarSettings = Pick<
  PluginSettings,
  NumericSettingKey | BooleanSettingKey | PresentationSettingKey | "logLevel"
>;

export function mergeTaskOverrides<T extends object>(current: T | undefined, updates: T): T {
  const merged = { ...current, ...updates };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) Reflect.deleteProperty(merged, key);
  }
  return merged;
}

export function mergeSettings(
  current: PluginSettings,
  partial: SettingsUpdate,
): Result<PluginSettings> {
  if (partial.directoryScheme !== undefined && !isRecord(partial.directoryScheme)) {
    return err("E101_INVALID_INPUT", "directoryScheme 必须是对象");
  }
  if (partial.providers !== undefined && !isRecord(partial.providers)) {
    return err("E101_INVALID_INPUT", "providers 必须是对象");
  }
  if (partial.taskModels !== undefined && !isRecord(partial.taskModels)) {
    return err("E101_INVALID_INPUT", "taskModels 必须是对象");
  }

  const candidate = {
    ...cloneSettings(current),
    ...partial,
    directoryScheme: {
      ...current.directoryScheme,
      ...(partial.directoryScheme ?? {}),
    },
    providers: {
      ...current.providers,
      ...(partial.providers ?? {}),
    },
    taskModels: {
      ...current.taskModels,
      ...(partial.taskModels ?? {}),
    },
  };
  return normalizeSettings(candidate, true);
}

function normalizeScalarSettings(raw: Record<string, unknown>, strictPresentationSettings: boolean): Result<ScalarSettings> {
  const presentation = {} as Pick<PluginSettings, PresentationSettingKey>;
  for (const rule of PRESENTATION_SETTING_RULES) {
    const value = raw[rule.key];
    const valid = rule.values.some((allowed) => allowed === value);
    // 导入时可省略展示选项；界面中的无效编辑须整体拒绝。
    if (!valid && strictPresentationSettings) return err("E101_INVALID_INPUT", `${rule.key} 无效`);
    Object.assign(presentation, { [rule.key]: valid ? value : DEFAULT_SETTINGS[rule.key] });
  }
  const numeric = {} as Pick<PluginSettings, NumericSettingKey>;
  for (const rule of NUMERIC_SETTING_RULES) {
    const rawValue = raw[rule.key] ?? ("defaultValue" in rule ? rule.defaultValue : undefined);
    const result = rule.integer
      ? validInteger(rawValue, rule.key, rule.min, rule.max)
      : validNumber(rawValue, rule.key, rule.min, rule.max);
    if (!result.ok) return result;
    numeric[rule.key] = result.value;
  }

  const booleans = {} as Pick<PluginSettings, BooleanSettingKey>;
  for (const rule of BOOLEAN_SETTING_RULES) {
    const result = validBoolean(raw[rule.key] ?? rule.defaultValue, rule.key);
    if (!result.ok) return result;
    booleans[rule.key] = result.value;
  }

  const logLevel = raw.logLevel ?? DEFAULT_SETTINGS.logLevel;
  if (typeof logLevel !== "string" || !LOG_LEVELS.has(logLevel as LogLevel)) {
    return err("E101_INVALID_INPUT", "logLevel 必须是 silent、debug、info、warn 或 error");
  }
  return ok({
    ...numeric,
    ...booleans,
    ...presentation,
    logLevel: logLevel as LogLevel,
  });
}

function normalizeTaskProviderAssignments(
  taskModels: Record<TaskType, TaskModelConfig>,
  providers: Record<string, ProviderConfig>,
): Result<Record<TaskType, TaskModelConfig>> {
  for (const taskType of TASK_TYPES) {
    const providerId = taskModels[taskType].providerId;
    if (providerId && !providers[providerId]) {
      return err("E311_NOT_FOUND", `任务 ${taskType} 引用了不存在的 Provider: ${providerId}`);
    }
  }

  return ok(cloneTaskModels(taskModels));
}

export function normalizeSettings(raw: unknown, strictPresentationSettings = false): Result<PluginSettings> {
  if (!isRecord(raw)) {
    return err("E101_INVALID_INPUT", "设置必须是对象");
  }

  const roots: Record<string, string> = {};
  for (const key of ["cardsSourceRoot", "cardsTargetRoot"] as const) {
    const value = raw[key] ?? DEFAULT_SETTINGS[key];
    if (typeof value !== "string" || !isSafeDirectory(value.trim()) || value.includes(":") || Array.from(value).some((char) => char.charCodeAt(0) <= 31)) return err("E101_INVALID_INPUT", `${key} 必须是 Vault 内的相对目录`);
    roots[key] = value.trim();
  }
  const directoryResult = normalizeDirectoryScheme(raw.directoryScheme);
  if (!directoryResult.ok) return directoryResult;
  const providersResult = normalizeProviders(raw.providers);
  if (!providersResult.ok) return providersResult;
  const taskModelsResult = normalizeTaskModels(raw.taskModels);
  if (!taskModelsResult.ok) return taskModelsResult;
  const scalarResult = normalizeScalarSettings(raw, strictPresentationSettings);
  if (!scalarResult.ok) return scalarResult;
  if (typeof raw.defaultProviderId !== "string") {
    return err("E101_INVALID_INPUT", "defaultProviderId 必须是字符串");
  }
  if (raw.defaultProviderId && !Object.hasOwn(providersResult.value, raw.defaultProviderId)) {
    return err("E311_NOT_FOUND", `默认 Provider 不存在: ${raw.defaultProviderId}`);
  }

  // Preserve the user's explicit route even while that Provider is disabled.
  // Runtime validation will fail visibly instead of silently spending through
  // a different Provider; re-enabling restores the same route.
  const defaultProviderId = raw.defaultProviderId;

  const taskModelsResultWithProviders = normalizeTaskProviderAssignments(
    taskModelsResult.value,
    providersResult.value,
  );
  if (!taskModelsResultWithProviders.ok) return taskModelsResultWithProviders;
  const scalar = scalarResult.value;

  return ok({
    directoryScheme: directoryResult.value,
    cardsSourceRoot: roots.cardsSourceRoot!,
    cardsTargetRoot: roots.cardsTargetRoot!,
    enableSemanticIndexing: scalar.enableSemanticIndexing,
    enableDuplicateDetection: scalar.enableDuplicateDetection,
    similarityThreshold: scalar.similarityThreshold,
    concurrency: scalar.concurrency,
    taskTimeoutMs: scalar.taskTimeoutMs,
    logLevel: scalar.logLevel,
    enableAutoVerify: scalar.enableAutoVerify,
    verifyReportPresentation: scalar.verifyReportPresentation,
    queueDefaultFilter: scalar.queueDefaultFilter,
    queuePageSize: scalar.queuePageSize,
    providers: providersResult.value,
    defaultProviderId,
    taskModels: taskModelsResultWithProviders.value,
    providerTimeoutMs: scalar.providerTimeoutMs,
    providerMaxAttempts: scalar.providerMaxAttempts,
    enableStreamingKeepalive: scalar.enableStreamingKeepalive,
    streamingTransport: scalar.streamingTransport,
  });
}

function normalizeDirectoryScheme(raw: unknown): Result<DirectoryScheme> {
  if (!isRecord(raw)) {
    return err("E101_INVALID_INPUT", "directoryScheme 必须是对象");
  }
  const result = {} as DirectoryScheme;
  for (const type of CR_TYPES) {
    if (typeof raw[type] !== "string") {
      return err("E101_INVALID_INPUT", `directoryScheme.${type} 必须是字符串`);
    }
    const directory = raw[type].trim();
    if (!isSafeDirectory(directory)) {
      return err("E101_INVALID_INPUT", `directoryScheme.${type} 必须是 Vault 内的相对目录`);
    }
    result[type] = directory;
  }
  return ok(result);
}

function isSafeDirectory(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function normalizeProviders(raw: unknown): Result<Record<string, ProviderConfig>> {
  if (!isRecord(raw)) {
    return err("E101_INVALID_INPUT", "providers 必须是对象");
  }
  const providers = Object.create(null) as Record<string, ProviderConfig>;
  for (const [id, value] of Object.entries(raw)) {
    if (!isValidProviderId(id)) {
      return err("E101_INVALID_INPUT", "Provider ID 不能为空、包含首尾空格或控制字符，且不能使用保留名称");
    }
    const provider = normalizeProvider(value, id);
    if (!provider.ok) return provider;
    providers[id] = provider.value;
  }
  return ok(providers);
}

function validateProviderBooleans(raw: Record<string, unknown>, id: string): Result<void> {
  for (const key of ["enabled"] as const) {
    if (typeof raw[key] !== "boolean") {
      return err("E101_INVALID_INPUT", `Provider ${id}.${key} 必须是布尔值`);
    }
  }
  return ok(undefined);
}

function normalizeProviderBaseUrl(value: unknown, id: string): Result<string | undefined> {
  if (value === undefined || value === "") return ok(undefined);
  if (typeof value !== "string") {
    return err("E101_INVALID_INPUT", `Provider ${id}.baseUrl 必须是字符串`);
  }
  const baseUrl = value.trim();
  if (!baseUrl) return ok(undefined);
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return err("E101_INVALID_INPUT", `Provider ${id}.baseUrl 必须使用 HTTP 或 HTTPS`);
    }
  } catch {
    return err("E101_INVALID_INPUT", `Provider ${id}.baseUrl 不是有效 URL`);
  }
  return ok(baseUrl.replace(/\/+$/, ""));
}

function normalizeProvider(raw: unknown, id: string): Result<ProviderConfig> {
  if (!isRecord(raw)) {
    return err("E101_INVALID_INPUT", `Provider ${id} 必须是对象`);
  }
  if (typeof raw.apiKey !== "string" ||
    typeof raw.defaultChatModel !== "string" ||
    typeof raw.defaultEmbedModel !== "string") {
    return err("E101_INVALID_INPUT", `Provider ${id} 的密钥和模型必须是字符串`);
  }
  if (!API_FORMATS.has(raw.apiFormat as ProviderApiFormat)) {
    return err("E101_INVALID_INPUT", `Provider ${id} 的聊天协议无效`);
  }
  if (!EMBEDDING_FORMATS.has(raw.embeddingApiFormat as EmbeddingApiFormat)) {
    return err("E101_INVALID_INPUT", `Provider ${id} 的嵌入协议无效`);
  }
  if (raw.apiFormat === "disabled" && raw.embeddingApiFormat === "disabled") {
    return err("E101_INVALID_INPUT", `Provider ${id} 必须至少启用聊天或嵌入能力`);
  }
  const booleans = validateProviderBooleans(raw, id);
  if (!booleans.ok) return booleans;
  const baseUrl = normalizeProviderBaseUrl(raw.baseUrl, id);
  if (!baseUrl.ok) return baseUrl;
  const apiFormat = raw.apiFormat as ProviderApiFormat;
  const embeddingApiFormat = raw.embeddingApiFormat as EmbeddingApiFormat;
  const capabilitiesResult = normalizeCapabilities(raw.capabilities, `providers.${id}.capabilities`);
  if (!capabilitiesResult.ok) return capabilitiesResult;
  const capabilities = capabilitiesResult.value;
  const parametersResult = normalizeProviderParameters(raw.parameters, `providers.${id}.parameters`);
  if (!parametersResult.ok) return parametersResult;
  const normalized: ProviderConfig = {
    apiKey: raw.apiKey.trim(),
    apiFormat,
    embeddingApiFormat,
    defaultChatModel: apiFormat === "disabled" ? "" : raw.defaultChatModel.trim(),
    defaultEmbedModel: embeddingApiFormat === "disabled" ? "" : raw.defaultEmbedModel.trim(),
    enabled: raw.enabled as boolean,
    capabilities,
    ...(parametersResult.value ? { parameters: parametersResult.value } : {}),
  };
  if (baseUrl.value) normalized.baseUrl = baseUrl.value;
  return ok(normalized);
}

function normalizeTaskModels(raw: unknown): Result<Record<TaskType, TaskModelConfig>> {
  if (!isRecord(raw)) {
    return err("E101_INVALID_INPUT", "taskModels 必须是对象");
  }
  const result = {} as Record<TaskType, TaskModelConfig>;
  for (const taskType of TASK_TYPES) {
    const normalized = normalizeTaskModel(raw[taskType], taskType);
    if (!normalized.ok) return normalized;
    result[taskType] = normalized.value;
  }
  return ok(result);
}

function normalizeTaskModel(raw: unknown, taskType: TaskType): Result<TaskModelConfig> {
  if (!isRecord(raw) || typeof raw.providerId !== "string" || typeof raw.model !== "string") {
    return err("E101_INVALID_INPUT", `taskModels.${taskType} 必须包含字符串 providerId 和 model`);
  }

  const config: TaskModelConfig = {
    providerId: raw.providerId,
    model: raw.model.trim(),
  };
  const capabilitiesResult = normalizeCapabilities(raw.capabilities, `taskModels.${taskType}.capabilities`, true);
  if (!capabilitiesResult.ok) return capabilitiesResult;
  if (Object.keys(capabilitiesResult.value).length > 0) config.capabilities = capabilitiesResult.value;
  const overridesResult = normalizeParameterOverrides(raw.parameters, `taskModels.${taskType}.parameters`);
  if (!overridesResult.ok) return overridesResult;
  if (overridesResult.value) config.parameters = overridesResult.value;
  return ok(config);
}

function normalizeCapabilities(raw: unknown, field: string, partial = false): Result<Partial<ModelCapabilities>> {
  if (raw === undefined) return ok({});
  if (!isRecord(raw)) return err("E101_INVALID_INPUT", `${field} 必须是对象`);
  const result: Partial<ModelCapabilities> = {};
  for (const key of ["temperature", "topP", "reasoning", "nativeWebSearch", "promptCaching", "responseContinuation"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "boolean") return err("E101_INVALID_INPUT", `${field}.${key} 必须是布尔值`);
      result[key] = raw[key] as boolean;
    }
  }
  if (raw.promptCacheMode !== undefined) {
    if (raw.promptCacheMode !== "implicit" && raw.promptCacheMode !== "explicit") {
      return err("E101_INVALID_INPUT", `${field}.promptCacheMode 无效`);
    }
    result.promptCacheMode = raw.promptCacheMode;
  }
  if (raw.promptCacheTtl !== undefined) {
    if (raw.promptCacheTtl !== "30m") return err("E101_INVALID_INPUT", `${field}.promptCacheTtl 无效`);
    result.promptCacheTtl = raw.promptCacheTtl;
  }
  return ok(partial ? result : { ...DEFAULT_MODEL_CAPABILITIES, ...result });
}

function normalizeProviderParameters(raw: unknown, field: string): Result<ProviderConfig["parameters"]> {
  if (raw === undefined) return ok(undefined);
  if (!isRecord(raw)) return err("E101_INVALID_INPUT", `${field} 必须是对象`);
  const result: NonNullable<ProviderConfig["parameters"]> = {};
  for (const key of ["temperature", "topP", "maxTokens", "embeddingDimension", "thinkingBudget"] as const) {
    if (raw[key] === undefined) continue;
    if (key === "temperature" && !validNumber(raw[key], `${field}.${key}`, 0, 2).ok) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    if (key === "topP" && !validNumber(raw[key], `${field}.${key}`, 0, 1).ok) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    if (["maxTokens", "embeddingDimension", "thinkingBudget"].includes(key) && !validInteger(raw[key], `${field}.${key}`, 1).ok) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    (result as Record<string, unknown>)[key] = raw[key];
  }
  if (raw.reasoning_effort !== undefined) {
    if (typeof raw.reasoning_effort !== "string" || !raw.reasoning_effort.trim()) return err("E101_INVALID_INPUT", `${field}.reasoning_effort 无效`);
    result.reasoning_effort = raw.reasoning_effort.trim();
  }
  if (raw.thinkingLevel !== undefined) {
    if (typeof raw.thinkingLevel !== "string" || !raw.thinkingLevel.trim()) return err("E101_INVALID_INPUT", `${field}.thinkingLevel 无效`);
    result.thinkingLevel = raw.thinkingLevel.trim();
  }
  return ok(result);
}

function normalizeParameterOverrides(raw: unknown, field: string): Result<ModelParameterOverrides | undefined> {
  if (raw === undefined) return ok(undefined);
  if (!isRecord(raw)) return err("E101_INVALID_INPUT", `${field} 必须是对象`);
  const result: ModelParameterOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!["temperature", "topP", "reasoning_effort", "thinkingLevel", "thinkingBudget", "maxTokens", "embeddingDimension"].includes(key)) return err("E101_INVALID_INPUT", `${field}.${key} 不支持`);
    if (value === undefined) continue;
    if (value === null) { (result as Record<string, unknown>)[key] = null; continue; }
    if (key === "temperature" && !validNumber(value, `${field}.${key}`, 0, 2).ok) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    if (key === "topP" && !validNumber(value, `${field}.${key}`, 0, 1).ok) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    if (["maxTokens", "embeddingDimension", "thinkingBudget"].includes(key) && !validInteger(value, `${field}.${key}`, 1).ok) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    if (["reasoning_effort", "thinkingLevel"].includes(key) && (typeof value !== "string" || !value.trim())) return err("E101_INVALID_INPUT", `${field}.${key} 无效`);
    (result as Record<string, unknown>)[key] = typeof value === "string" ? value.trim() : value;
  }
  return ok(Object.keys(result).length ? result : undefined);
}

function validBoolean(value: unknown, field: string): Result<boolean> {
  return typeof value === "boolean"
    ? ok(value)
    : err("E101_INVALID_INPUT", `${field} 必须是布尔值`);
}

function validNumber(value: unknown, field: string, min: number, max = Number.POSITIVE_INFINITY): Result<number> {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? ok(value)
    : err("E101_INVALID_INPUT", `${field} 必须是 ${min} 到 ${max} 之间的数字`);
}

function validInteger(value: unknown, field: string, min: number, max = Number.POSITIVE_INFINITY): Result<number> {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
    ? ok(Number(value))
    : err("E101_INVALID_INPUT", `${field} 必须是 ${min} 到 ${max} 之间的整数`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneTaskModels(models: Record<TaskType, TaskModelConfig>): Record<TaskType, TaskModelConfig> {
  const result = {} as Record<TaskType, TaskModelConfig>;
  for (const taskType of TASK_TYPES) {
    result[taskType] = JSON.parse(JSON.stringify(models[taskType]));
  }
  return result;
}

export function cloneSettings(settings: PluginSettings): PluginSettings {
  return {
    ...settings,
    directoryScheme: { ...settings.directoryScheme },
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([id, provider]) => [id, JSON.parse(JSON.stringify(provider))]),
    ),
    taskModels: cloneTaskModels(settings.taskModels),
  };
}

export function settingsEqual(a: PluginSettings, b: PluginSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
