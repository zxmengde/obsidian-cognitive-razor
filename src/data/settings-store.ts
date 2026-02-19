/** SettingsStore - 管理插件配置，支持版本兼容性检查和导入导出 */

import { ok, err } from "../types";
import type { PluginSettings, ProviderConfig, Result, DirectoryScheme, TaskType, TaskModelConfig } from "../types";
import { DEFAULT_UI_STATE } from "../types";
import { Plugin } from "obsidian";

/**
 * 默认目录方案
 */
export const DEFAULT_DIRECTORY_SCHEME: DirectoryScheme = {
  Domain: "1-领域",
  Issue: "2-议题",
  Theory: "3-理论",
  Entity: "4-实体",
  Mechanism: "5-机制",
};

/**
 * PluginSettings 必填字段列表
 * 用于验证设置对象的完整性
 */
export const REQUIRED_SETTINGS_FIELDS: (keyof PluginSettings)[] = [
  "version",
  "directoryScheme",
  "similarityThreshold",
  "concurrency",
  "autoRetry",
  "maxRetryAttempts",
  "enableAutoVerify",
  "providers",
  "defaultProviderId",
  "taskModels",
  "logLevel",
  "embeddingDimension",
  "providerTimeoutMs",
];

/** 默认任务超时时间（毫秒） */
export const DEFAULT_TASK_TIMEOUT_MS = 3 * 60 * 1000;

type ScalarSettingsKey = keyof Pick<
  PluginSettings,
  | "version"
  | "similarityThreshold"
  | "concurrency"
  | "autoRetry"
  | "maxRetryAttempts"
  | "enableAutoVerify"
  | "defaultProviderId"
  | "logLevel"
  | "embeddingDimension"
  | "providerTimeoutMs"
  | "taskTimeoutMs"
>;

interface ScalarSettingsSpec {
  key: ScalarSettingsKey;
  type: "string" | "number" | "boolean";
  required: boolean;
  allowed?: readonly string[];
  integer?: boolean;
  min?: number;
  max?: number;
}

const SCALAR_SETTINGS_SPECS: ScalarSettingsSpec[] = [
  { key: "version", type: "string", required: true },
  { key: "similarityThreshold", type: "number", required: true, min: 0, max: 1 },
  { key: "concurrency", type: "number", required: true, integer: true, min: 1 },
  { key: "autoRetry", type: "boolean", required: true },
  { key: "maxRetryAttempts", type: "number", required: true, integer: true, min: 0 },
  { key: "enableAutoVerify", type: "boolean", required: true },
  { key: "defaultProviderId", type: "string", required: true },
  { key: "logLevel", type: "string", required: true, allowed: ["debug", "info", "warn", "error"] },
  { key: "embeddingDimension", type: "number", required: true, integer: true, min: 1 },
  { key: "providerTimeoutMs", type: "number", required: true, integer: true, min: 1000 },
  // 历史版本兼容：这些字段允许缺失，由 mergeSettings/ensureBackwardCompatibility 补齐默认值
  { key: "taskTimeoutMs", type: "number", required: false, integer: true, min: 1000 },
];

/**
 * DirectoryScheme 必填字段列表
 */
export const REQUIRED_DIRECTORY_SCHEME_FIELDS: (keyof DirectoryScheme)[] = [
  "Domain",
  "Issue",
  "Theory",
  "Entity",
  "Mechanism",
];

/**
 * TaskType 列表
 */
export const TASK_TYPES: TaskType[] = [
  "define",
  "tag",
  "write",
  "index",
  "verify",
];

/** 任务模型默认配置 */
export const DEFAULT_TASK_MODEL_CONFIGS: Record<TaskType, TaskModelConfig> = {
  define: {
    providerId: "",
    model: "gemini-3-flash-preview",
    temperature: 0.3,
    topP: 1.0,
  },
  tag: {
    providerId: "",
    model: "gemini-3-flash-preview",
    temperature: 0.5,
    topP: 1.0,
  },
  write: {
    providerId: "",
    model: "gemini-3-flash-preview",
    temperature: 0.7,
    topP: 1.0,
  },
  index: {
    providerId: "",
    model: "text-embedding-3-small",
    embeddingDimension: 1536,
  },
  verify: {
    providerId: "",
    model: "gemini-3-flash-preview",
    temperature: 0.3,
    topP: 1.0,
  },
};

/** 参数推荐范围 */
export const PARAM_RECOMMENDATIONS = {
  temperature: {
    define: { min: 0.2, max: 0.5, recommended: "0.3-0.5" },
    tag: { min: 0.3, max: 0.7, recommended: "0.5" },
    write: { min: 0.5, max: 1.0, recommended: "0.7-0.9" },
    verify: { min: 0.2, max: 0.5, recommended: "0.3" },
  },
  topP: {
    default: { min: 0.8, max: 1.0, recommended: "0.8-1.0" },
  },
  embeddingDimension: {
    recommended: "1536",
    options: [256, 512, 1024, 1536, 3072],
  },
} as const;

/** 生成新的默认任务模型配置副本 */
export function createDefaultTaskModels(): Record<TaskType, TaskModelConfig> {
  const taskModels = {} as Record<TaskType, TaskModelConfig>;
  for (const taskType of TASK_TYPES) {
    taskModels[taskType] = { ...DEFAULT_TASK_MODEL_CONFIGS[taskType] };
  }
  return taskModels;
}

/**
 * 验证错误接口
 */
export interface SettingsValidationError {
  field: string;
  message: string;
  expectedType?: string;
  actualType?: string;
  severity: 'error' | 'warning';  // 区分阻断性错误和警告
}

/**
 * 验证结果接口
 */
export interface SettingsValidationResult {
  valid: boolean;
  errors: SettingsValidationError[];
}

/** 默认设置 */
export const DEFAULT_SETTINGS: PluginSettings = {
  version: "1.0.0",
  
  // 存储设置
  directoryScheme: DEFAULT_DIRECTORY_SCHEME,
  
  // 去重设置 (G-02: 语义唯一性公理, A-FUNC-04: 语义去重检测)
  similarityThreshold: 0.85,
  
  // 队列设置
  concurrency: 1,
  autoRetry: true,
  maxRetryAttempts: 3,
  taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
  
  // 功能开关
  enableAutoVerify: false,
  
  // Provider 配置
  providers: {},
  defaultProviderId: "",
  
  // 任务模型配置
  taskModels: createDefaultTaskModels(),
  
  // 日志级别
  logLevel: "info",
  
  // 嵌入向量维度（text-embedding-3-small 支持 512-3072，默认 1536）
  embeddingDimension: 1536,
  
  // Provider 请求超时（毫秒，默认 60000 = 60秒）
  providerTimeoutMs: 60000,

  // 工作台 UI 状态
  uiState: { ...DEFAULT_UI_STATE, sectionCollapsed: { ...DEFAULT_UI_STATE.sectionCollapsed }, sortPreferences: {} },
};

/** SettingsStore 实现类 */
export class SettingsStore {
  private plugin: Plugin;
  private settings: PluginSettings;
  private listeners: Array<(settings: PluginSettings) => void> = [];

  /**
   * 构造函数
   * @param plugin Obsidian Plugin 实例
   */
  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.settings = this.createDefaultSettingsSnapshot();
  }

  /** 加载设置 */
  async loadSettings(): Promise<Result<void>> {
    try {
      const raw = await this.plugin.loadData();
      
      if (!raw) {
        // 首次使用，使用默认设置
        this.settings = { ...DEFAULT_SETTINGS };
        await this.saveSettings();
        return ok(undefined);
      }

      const data = this.normalizeLegacySettings(raw as unknown);

      // 检查版本兼容性
      const compatibilityResult = this.checkVersionCompatibility(data.version);
      if (!compatibilityResult.ok) {
        // 版本不兼容时重置为默认值 (O-05 开发阶段版本策略)
        this.settings = { ...DEFAULT_SETTINGS };
        await this.saveSettings();
        return ok(undefined);
      }

      // 先 merge（保留用户数据），再验证合并后的结果
      // 避免旧版本缺少新字段时整包重置用户配置
      const merged = this.mergeSettings(DEFAULT_SETTINGS, data);
      const validationResult = this.validateSettingsDetailed(merged);
      if (!validationResult.valid) {
        // 合并后仍有阻断性错误，记录警告并回退默认值
        this.settings = { ...DEFAULT_SETTINGS };
        await this.saveSettings();
        return ok(undefined);
      }

      this.settings = merged;
      this.ensureBackwardCompatibility();
      
      return ok(undefined);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to load settings",
        error
      );
    }
  }

  /**
   * 获取设置
   */
  getSettings(): PluginSettings {
    return { ...this.settings };
  }

  /**
   * 更新设置
   */
  async updateSettings(partial: Partial<PluginSettings>): Promise<Result<void>> {
    try {
      const mergeResult = this.mergePartialSettings(partial);
      if (!mergeResult.ok) {
        return mergeResult;
      }

      const validation = this.validateSettingsDetailed(mergeResult.value);
      if (!validation.valid) {
        return err(
          "E101_INVALID_INPUT",
          "设置校验失败",
          { errors: validation.errors }
        );
      }

      this.settings = mergeResult.value;

      // 保存到磁盘
      await this.saveSettings();

      // 通知监听器
      this.notifyListeners();

      return ok(undefined);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to update settings",
        error
      );
    }
  }

  /**
   * 更新工作台区块折叠状态（避免深层 Partial 类型问题）
   */
  async updateSectionCollapsed(key: string, value: boolean): Promise<Result<void>> {
    const current = this.settings.uiState ?? { ...DEFAULT_UI_STATE };
    const updated: PluginSettings = {
      ...this.settings,
      uiState: {
        ...current,
        sectionCollapsed: {
          ...current.sectionCollapsed,
          [key]: value,
        },
      },
    };
    this.settings = updated;
    await this.saveSettings();
    this.notifyListeners();
    return ok(undefined);
  }

  /**
   * 导出设置
   */
  exportSettings(): string {
    return JSON.stringify(this.serializeSettings(true), null, 2);
  }

  /**
   * 导入设置
   */
  async importSettings(json: string): Promise<Result<void>> {
    try {
      const raw = JSON.parse(json) as unknown;
      const data = this.normalizeLegacySettings(raw);

      // 验证设置结构
      if (!this.validateSettings(data)) {
        return err(
          "E101_INVALID_INPUT",
          "Invalid settings format",
          { json }
        );
      }

      // 检查版本兼容性
      const compatibilityResult = this.checkVersionCompatibility(data.version);
      if (!compatibilityResult.ok) {
        return compatibilityResult;
      }

      // 合并设置
      this.settings = this.mergeSettings(DEFAULT_SETTINGS, data);

      // 保存到磁盘
      await this.saveSettings();

      // 通知监听器
      this.notifyListeners();

      return ok(undefined);
    } catch (error) {
      return err(
        "E101_INVALID_INPUT",
        "Failed to parse settings JSON",
        error
      );
    }
  }

  /**
   * 重置为默认值
   */
  async resetToDefaults(): Promise<Result<void>> {
    try {
      this.settings = { ...DEFAULT_SETTINGS };

      // 保存到磁盘
      await this.saveSettings();

      // 通知监听器
      this.notifyListeners();

      return ok(undefined);
    } catch (error) {
      return err(
        "E500_INTERNAL_ERROR",
        "Failed to reset settings",
        error
      );
    }
  }

  /**
   * 订阅设置变更
   */
  subscribe(listener: (settings: PluginSettings) => void): () => void {
    this.listeners.push(listener);

    // 返回取消订阅函数
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 保存设置到磁盘
   */
  private async saveSettings(): Promise<void> {
    await this.plugin.saveData(this.serializeSettings());
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    const settingsCopy = { ...this.settings };
    for (const listener of this.listeners) {
      listener(settingsCopy);
    }
  }

  /** 创建默认设置快照，避免引用共享 */
  private createDefaultSettingsSnapshot(): PluginSettings {
    return {
      ...DEFAULT_SETTINGS,
      directoryScheme: { ...DEFAULT_SETTINGS.directoryScheme },
      providers: { ...DEFAULT_SETTINGS.providers },
      taskModels: createDefaultTaskModels(),
      uiState: { ...DEFAULT_UI_STATE, sectionCollapsed: { ...DEFAULT_UI_STATE.sectionCollapsed }, sortPreferences: {} },
    };
  }

  /**
   * 序列化设置
   */
  private serializeSettings(redactAllApiKeys = false): PluginSettings {
    const providers: Record<string, ProviderConfig> = {};
    for (const [id, config] of Object.entries(this.settings.providers)) {
      providers[id] = {
        ...config,
        apiKey: redactAllApiKeys ? "" : config.apiKey
      };
    }

    return {
      ...this.settings,
      providers
    };
  }

  /**
   * 检查版本兼容性
   */
  private checkVersionCompatibility(version: string): Result<void> {
    // 简单的版本检查：主版本号必须匹配
    const currentMajor = DEFAULT_SETTINGS.version.split(".")[0];
    const loadedMajor = version.split(".")[0];

    if (currentMajor !== loadedMajor) {
      return err(
        "E101_INVALID_INPUT",
        `Incompatible settings version: ${version} (current: ${DEFAULT_SETTINGS.version})`,
        { version, currentVersion: DEFAULT_SETTINGS.version }
      );
    }

    return ok(undefined);
  }

  /**
   * 验证设置结构（简单布尔返回）
   * @param data 待验证的数据
   * @returns 是否为有效的 PluginSettings
   */
  private validateSettings(data: unknown): data is PluginSettings {
    const result = this.validateSettingsDetailed(data);
    return result.valid;
  }

  /** 详细验证设置结构 */
  validateSettingsDetailed(data: unknown): SettingsValidationResult {
    const errors: SettingsValidationError[] = [];

    // 基础类型检查
    if (typeof data !== "object" || data === null) {
      errors.push({
        field: "root",
        message: "Settings must be a non-null object",
        expectedType: "object",
        actualType: data === null ? "null" : typeof data,
        severity: 'error',
      });
      return { valid: false, errors };
    }

    const settings = data as Record<string, unknown>;

    this.validateScalarSettings(settings, errors);

    // 验证 directoryScheme 字段
    this.validateDirectoryScheme(settings.directoryScheme, errors);

    // 验证 providers 字段
    if (typeof settings.providers !== "object" || settings.providers === null) {
      errors.push({
        field: "providers",
        message: "providers must be an object",
        expectedType: "object",
        actualType: settings.providers === null ? "null" : typeof settings.providers,
        severity: 'error',
      });
    } else {
      for (const [providerId, providerConfig] of Object.entries(settings.providers)) {
        if (typeof providerConfig !== "object" || providerConfig === null) {
          errors.push({
            field: `providers.${providerId}`,
            message: "provider config must be an object",
            expectedType: "ProviderConfig",
            actualType: providerConfig === null ? "null" : typeof providerConfig,
            severity: 'error',
          });
          continue;
        }
        const cfg = providerConfig as ProviderConfig;
        if (typeof cfg.apiKey !== "string") {
          errors.push({
            field: `providers.${providerId}.apiKey`,
            message: "apiKey must be a string",
            expectedType: "string",
            actualType: typeof cfg.apiKey,
            severity: 'error',
          });
        }
        if (cfg.baseUrl !== undefined && typeof cfg.baseUrl !== "string") {
          errors.push({
            field: `providers.${providerId}.baseUrl`,
            message: "baseUrl must be a string",
            expectedType: "string",
            actualType: typeof cfg.baseUrl,
            severity: 'error',
          });
        }
        // baseUrl 格式校验（需求 21.2）
        if (cfg.baseUrl !== undefined && typeof cfg.baseUrl === "string" && cfg.baseUrl !== "") {
          try { new URL(cfg.baseUrl); } catch {
            errors.push({
              field: `providers.${providerId}.baseUrl`,
              message: "baseUrl 格式无效",
              severity: 'error',
            });
          }
        }
        if (typeof cfg.defaultChatModel !== "string") {
          errors.push({
            field: `providers.${providerId}.defaultChatModel`,
            message: "defaultChatModel must be a string",
            expectedType: "string",
            actualType: typeof cfg.defaultChatModel,
            severity: 'error',
          });
        }
        if (typeof cfg.defaultEmbedModel !== "string") {
          errors.push({
            field: `providers.${providerId}.defaultEmbedModel`,
            message: "defaultEmbedModel must be a string",
            expectedType: "string",
            actualType: typeof cfg.defaultEmbedModel,
            severity: 'error',
          });
        }
        if (typeof cfg.enabled !== "boolean") {
          errors.push({
            field: `providers.${providerId}.enabled`,
            message: "enabled must be a boolean",
            expectedType: "boolean",
            actualType: typeof cfg.enabled,
            severity: 'error',
          });
        }

      }
    }

    // 验证 taskModels 字段
    this.validateTaskModels(settings.taskModels, errors);

    // TaskModel → Provider 引用交叉校验（需求 21.3）
    this.validateTaskModelProviderRefs(settings.taskModels, settings.providers, errors);

    return { valid: errors.filter(e => e.severity === 'error').length === 0, errors };
  }

  private validateScalarSettings(settings: Record<string, unknown>, errors: SettingsValidationError[]): void {
    for (const spec of SCALAR_SETTINGS_SPECS) {
      const value = settings[spec.key];

      if (value === undefined) {
        if (spec.required) {
          errors.push({
            field: spec.key,
            message: `${spec.key} is required`,
            expectedType: spec.type,
            actualType: "undefined",
            severity: 'error',
          });
        }
        continue;
      }

      if (spec.type === "string") {
        if (typeof value !== "string") {
          errors.push({
            field: spec.key,
            message: `${spec.key} must be a string`,
            expectedType: "string",
            actualType: value === null ? "null" : typeof value,
            severity: 'error',
          });
          continue;
        }

        if (spec.allowed && !spec.allowed.includes(value)) {
          errors.push({
            field: spec.key,
            message: `${spec.key} must be one of: ${spec.allowed.join(", ")}`,
            expectedType: spec.allowed.join(" | "),
            actualType: `'${value}'`,
            severity: 'error',
          });
        }
        continue;
      }

      if (spec.type === "boolean") {
        if (typeof value !== "boolean") {
          errors.push({
            field: spec.key,
            message: `${spec.key} must be a boolean`,
            expectedType: "boolean",
            actualType: value === null ? "null" : typeof value,
            severity: 'error',
          });
        }
        continue;
      }

      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push({
          field: spec.key,
          message: `${spec.key} must be a number`,
          expectedType: "number",
          actualType: value === null ? "null" : typeof value,
          severity: 'error',
        });
        continue;
      }

      if (spec.integer && !Number.isInteger(value)) {
        errors.push({
          field: spec.key,
          message: `${spec.key} must be an integer`,
          expectedType: "integer",
          actualType: String(value),
          severity: 'error',
        });
        continue;
      }

      if (spec.min !== undefined && value < spec.min) {
        errors.push({
          field: spec.key,
          message: `${spec.key} must be >= ${spec.min}`,
          expectedType: `number (>=${spec.min})`,
          actualType: String(value),
          severity: 'error',
        });
      }

      if (spec.max !== undefined && value > spec.max) {
        errors.push({
          field: spec.key,
          message: `${spec.key} must be <= ${spec.max}`,
          expectedType: `number (<=${spec.max})`,
          actualType: String(value),
          severity: 'error',
        });
      }
    }
  }

  private applyScalarUpdates(partial: Partial<PluginSettings>, target: PluginSettings): Result<void> {
    for (const spec of SCALAR_SETTINGS_SPECS) {
      const value = partial[spec.key] as unknown;
      if (value === undefined) {
        continue;
      }

      if (spec.type === "string") {
        if (typeof value !== "string") {
          return err("E101_INVALID_INPUT", `${spec.key} 必须是字符串`);
        }
        if (spec.allowed && !spec.allowed.includes(value)) {
          return err("E101_INVALID_INPUT", `${spec.key} 不合法`);
        }
        Reflect.set(target, spec.key, value);
        continue;
      }

      if (spec.type === "boolean") {
        if (typeof value !== "boolean") {
          return err("E101_INVALID_INPUT", `${spec.key} 必须是布尔值`);
        }
        Reflect.set(target, spec.key, value);
        continue;
      }

      if (typeof value !== "number" || Number.isNaN(value)) {
        return err("E101_INVALID_INPUT", `${spec.key} 必须是数字`);
      }

      if (spec.integer && !Number.isInteger(value)) {
        return err("E101_INVALID_INPUT", `${spec.key} 必须是整数`);
      }

      if (spec.min !== undefined && value < spec.min) {
        return err("E101_INVALID_INPUT", `${spec.key} 必须 >= ${spec.min}`);
      }

      if (spec.max !== undefined && value > spec.max) {
        return err("E101_INVALID_INPUT", `${spec.key} 必须 <= ${spec.max}`);
      }

      Reflect.set(target, spec.key, value);
    }

    return ok(undefined);
  }

  /** 验证 DirectoryScheme 结构 */
  private validateDirectoryScheme(
    directoryScheme: unknown,
    errors: SettingsValidationError[]
  ): void {
    if (typeof directoryScheme !== "object" || directoryScheme === null) {
      errors.push({
        field: "directoryScheme",
        message: "directoryScheme must be an object",
        expectedType: "object",
        actualType: directoryScheme === null ? "null" : typeof directoryScheme,
        severity: 'error',
      });
      return;
    }

    const scheme = directoryScheme as Record<string, unknown>;

    for (const field of REQUIRED_DIRECTORY_SCHEME_FIELDS) {
      if (typeof scheme[field] !== "string") {
        errors.push({
          field: `directoryScheme.${field}`,
          message: `directoryScheme.${field} must be a string`,
          expectedType: "string",
          actualType: typeof scheme[field],
          severity: 'error',
        });
      }
    }
  }

  /** 验证 TaskModels 结构 */
  private validateTaskModels(
    taskModels: unknown,
    errors: SettingsValidationError[]
  ): void {
    if (typeof taskModels !== "object" || taskModels === null) {
      errors.push({
        field: "taskModels",
        message: "taskModels must be an object",
        expectedType: "object",
        actualType: taskModels === null ? "null" : typeof taskModels,
        severity: 'error',
      });
      return;
    }

    const models = taskModels as Record<string, unknown>;

    for (const taskType of TASK_TYPES) {
      const model = models[taskType];
      if (typeof model !== "object" || model === null) {
        errors.push({
          field: `taskModels.${taskType}`,
          message: `taskModels.${taskType} must be an object`,
          expectedType: "TaskModelConfig",
          actualType: model === null ? "null" : typeof model,
          severity: 'error',
        });
        continue;
      }

      const modelConfig = model as Record<string, unknown>;

      // 验证 providerId
      if (typeof modelConfig.providerId !== "string") {
        errors.push({
          field: `taskModels.${taskType}.providerId`,
          message: `taskModels.${taskType}.providerId must be a string`,
          expectedType: "string",
          actualType: typeof modelConfig.providerId,
          severity: 'error',
        });
      }

      // 验证 model
      if (typeof modelConfig.model !== "string") {
        errors.push({
          field: `taskModels.${taskType}.model`,
          message: `taskModels.${taskType}.model must be a string`,
          expectedType: "string",
          actualType: typeof modelConfig.model,
          severity: 'error',
        });
      }

      // 验证可选字段 temperature
      if (modelConfig.temperature !== undefined && typeof modelConfig.temperature !== "number") {
        errors.push({
          field: `taskModels.${taskType}.temperature`,
          message: `taskModels.${taskType}.temperature must be a number`,
          expectedType: "number",
          actualType: typeof modelConfig.temperature,
          severity: 'error',
        });
      }

      // 验证可选字段 topP
      if (modelConfig.topP !== undefined && typeof modelConfig.topP !== "number") {
        errors.push({
          field: `taskModels.${taskType}.topP`,
          message: `taskModels.${taskType}.topP must be a number`,
          expectedType: "number",
          actualType: typeof modelConfig.topP,
          severity: 'error',
        });
      }

      // 验证可选字段 maxTokens
      if (modelConfig.maxTokens !== undefined && typeof modelConfig.maxTokens !== "number") {
        errors.push({
          field: `taskModels.${taskType}.maxTokens`,
          message: `taskModels.${taskType}.maxTokens must be a number`,
          expectedType: "number",
          actualType: typeof modelConfig.maxTokens,
          severity: 'error',
        });
      }
    }
  }

  /** TaskModel → Provider 引用交叉校验（需求 21.3） */
  private validateTaskModelProviderRefs(
    taskModels: unknown,
    providers: unknown,
    errors: SettingsValidationError[]
  ): void {
    // 仅在两者都是有效对象时才做交叉校验
    if (typeof taskModels !== "object" || taskModels === null) return;
    if (typeof providers !== "object" || providers === null) return;

    const models = taskModels as Record<string, Record<string, unknown>>;
    const providerMap = providers as Record<string, unknown>;

    for (const taskType of TASK_TYPES) {
      const model = models[taskType];
      if (typeof model !== "object" || model === null) continue;
      const providerId = model.providerId;
      if (typeof providerId !== "string" || providerId === "") continue;
      if (!providerMap[providerId]) {
        errors.push({
          field: `taskModels.${taskType}.providerId`,
          message: `引用的 Provider "${providerId}" 不存在，将回退到默认 Provider`,
          severity: 'warning',
        });
      }
    }
  }

  /** 合并部分设置并进行类型检查 */
  private mergePartialSettings(partial: Partial<PluginSettings>): Result<PluginSettings> {
    const next: PluginSettings = {
      ...this.settings,
      directoryScheme: { ...this.settings.directoryScheme },
      providers: { ...this.settings.providers },
      taskModels: { ...this.settings.taskModels },
    };

    const scalarResult = this.applyScalarUpdates(partial, next);
    if (!scalarResult.ok) {
      return scalarResult;
    }

    // 目录方案
    if (partial.directoryScheme !== undefined) {
      if (!this.isPlainObject(partial.directoryScheme)) {
        return err("E101_INVALID_INPUT", "directoryScheme 必须是对象");
      }
      next.directoryScheme = {
        ...next.directoryScheme,
        ...partial.directoryScheme
      };
    }

    // Provider 配置
    if (partial.providers !== undefined) {
      if (!this.isPlainObject(partial.providers)) {
        return err("E101_INVALID_INPUT", "providers 必须是对象");
      }
      const mergedProviders: Record<string, ProviderConfig> = { ...next.providers };
      for (const [providerId, providerConfig] of Object.entries(partial.providers)) {
        const existing = mergedProviders[providerId];
        const normalized = this.normalizeProviderConfig(existing, providerConfig);
        if (!normalized.ok) {
          return normalized;
        }
        mergedProviders[providerId] = normalized.value;
      }
      next.providers = mergedProviders;
    }

    // 任务模型
    if (partial.taskModels !== undefined) {
      if (!this.isPlainObject(partial.taskModels)) {
        return err("E101_INVALID_INPUT", "taskModels 必须是对象");
      }
      const mergedTaskModels: Record<TaskType, TaskModelConfig> = { ...next.taskModels };
      for (const [taskType, config] of Object.entries(partial.taskModels)) {
        const existing = mergedTaskModels[taskType as TaskType];
        if (!existing) {
          continue;
        }
        if (!this.isPlainObject(config)) {
          return err("E101_INVALID_INPUT", `taskModels.${taskType} 必须是对象`);
        }
        mergedTaskModels[taskType as TaskType] = {
          ...existing,
          ...(config as TaskModelConfig)
        };
      }
      next.taskModels = mergedTaskModels;
    }

    // UI 状态（折叠/排序偏好）
    if (partial.uiState !== undefined) {
      if (!this.isPlainObject(partial.uiState)) {
        return err("E101_INVALID_INPUT", "uiState 必须是对象");
      }
      const currentUI = next.uiState ?? { ...DEFAULT_UI_STATE };
      next.uiState = {
        ...currentUI,
        ...(partial.uiState as PluginSettings["uiState"]),
        sectionCollapsed: {
          ...(currentUI.sectionCollapsed ?? {}),
          ...((partial.uiState as PluginSettings["uiState"])?.sectionCollapsed ?? {}),
        },
        sortPreferences: {
          ...(currentUI.sortPreferences ?? {}),
          ...((partial.uiState as PluginSettings["uiState"])?.sortPreferences ?? {}),
        },
      };
    }

    return ok(next);
  }

  /**
   * 合并设置（深度合并）
   */
  private mergeSettings(defaults: PluginSettings, loaded: Partial<PluginSettings>): PluginSettings {
    const merged = { ...defaults };

    // 合并顶层字段
    for (const key in loaded) {
      if (Object.prototype.hasOwnProperty.call(loaded, key)) {
        const value = loaded[key as keyof PluginSettings];
        const defaultValue = defaults[key as keyof PluginSettings];
        
        if (value !== undefined) {
          if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof defaultValue === "object") {
            // 深度合并对象
            Object.assign(merged, {
              [key]: {
                ...defaultValue as object,
                ...value as object,
              }
            });
          } else {
            // 直接赋值
            Object.assign(merged, { [key]: value });
          }
        }
      }
    }

    return merged;
  }

  /**
   * 兼容旧版设置字段：enableGrounding → enableAutoVerify
   *
   * 说明：
   * - 文档 SSOT 以 enableAutoVerify 为准
   * - 旧字段仍可能存在于用户的 data.json / 导入文件中
   */
  private normalizeLegacySettings(raw: unknown): Record<string, any> {
    if (!this.isPlainObject(raw)) {
      return raw as Record<string, any>;
    }

    const normalized: Record<string, any> = { ...raw };

    if (!Object.prototype.hasOwnProperty.call(normalized, "enableAutoVerify") &&
        typeof normalized.enableGrounding === "boolean") {
      normalized.enableAutoVerify = normalized.enableGrounding;
    }

    if (Object.prototype.hasOwnProperty.call(normalized, "enableGrounding")) {
      delete normalized.enableGrounding;
    }

    // 兼容旧版去重参数：topK 已从设置中移除（按阈值全量过滤）
    if (Object.prototype.hasOwnProperty.call(normalized, "topK")) {
      delete normalized.topK;
    }

    return normalized;
  }

  /** 向后兼容：填充新字段缺省值，修复缺失的任务模型配置 */
  private ensureBackwardCompatibility(): void {
    // 确保 taskModels 包含新增的任务类型
    const taskModels: Record<TaskType, TaskModelConfig> = {
      ...createDefaultTaskModels(),
      ...this.settings.taskModels
    };
    for (const taskType of TASK_TYPES) {
      if (!taskModels[taskType]) {
        taskModels[taskType] = { ...DEFAULT_TASK_MODEL_CONFIGS[taskType] };
      } else {
        taskModels[taskType] = {
          ...DEFAULT_TASK_MODEL_CONFIGS[taskType],
          ...taskModels[taskType]
        };
      }
    }
    this.settings.taskModels = taskModels;
  }

  private normalizeProviderConfig(
    existing: ProviderConfig | undefined,
    incoming: unknown
  ): Result<ProviderConfig> {
    if (!this.isPlainObject(incoming)) {
      return err("E101_INVALID_INPUT", "provider 配置必须是对象");
    }
    const incomingConfig = incoming as Partial<ProviderConfig>;
    const base: ProviderConfig = existing
      ? { ...existing }
      : {
          apiKey: "",
          baseUrl: undefined,
          defaultChatModel: "gpt-4o",
          defaultEmbedModel: "text-embedding-3-small",
          enabled: true
        };

    if (incomingConfig.apiKey !== undefined) {
      if (typeof incomingConfig.apiKey !== "string") {
        return err("E101_INVALID_INPUT", "provider.apiKey 必须是字符串");
      }
      base.apiKey = incomingConfig.apiKey.trim();
    }

    if (incomingConfig.baseUrl !== undefined) {
      if (incomingConfig.baseUrl !== null && typeof incomingConfig.baseUrl !== "string") {
        return err("E101_INVALID_INPUT", "provider.baseUrl 必须是字符串");
      }
      base.baseUrl = incomingConfig.baseUrl?.trim() || undefined;
    }

    if (incomingConfig.defaultChatModel !== undefined) {
      if (typeof incomingConfig.defaultChatModel !== "string") {
        return err("E101_INVALID_INPUT", "provider.defaultChatModel 必须是字符串");
      }
      base.defaultChatModel = incomingConfig.defaultChatModel.trim();
    }

    if (incomingConfig.defaultEmbedModel !== undefined) {
      if (typeof incomingConfig.defaultEmbedModel !== "string") {
        return err("E101_INVALID_INPUT", "provider.defaultEmbedModel 必须是字符串");
      }
      base.defaultEmbedModel = incomingConfig.defaultEmbedModel.trim();
    }

    if (incomingConfig.enabled !== undefined) {
      if (typeof incomingConfig.enabled !== "boolean") {
        return err("E101_INVALID_INPUT", "provider.enabled 必须是布尔值");
      }
      base.enabled = incomingConfig.enabled;
    }

    return ok(base);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * 重置指定任务模型配置到默认值
   */
  async resetTaskModel(taskType: TaskType): Promise<Result<void>> {
    if (!DEFAULT_TASK_MODEL_CONFIGS[taskType]) {
      return err("E101_INVALID_INPUT", `未知的任务类型: ${taskType}`);
    }
    const taskModels = {
      ...this.settings.taskModels,
      [taskType]: { ...DEFAULT_TASK_MODEL_CONFIGS[taskType] }
    };
    return this.updateSettings({ taskModels });
  }

  /**
   * 重置所有任务模型配置到默认值
   */
  async resetAllTaskModels(): Promise<Result<void>> {
    const taskModels = createDefaultTaskModels();
    return this.updateSettings({ taskModels });
  }

  /**
   * 判断任务模型配置是否为默认值
   */
  isTaskModelDefault(taskType: TaskType): boolean {
    const current = this.settings.taskModels[taskType];
    const defaults = DEFAULT_TASK_MODEL_CONFIGS[taskType];
    if (!current || !defaults) return false;

    return (
      current.providerId === defaults.providerId &&
      current.model === defaults.model &&
      current.temperature === defaults.temperature &&
      current.topP === defaults.topP &&
      current.reasoning_effort === defaults.reasoning_effort &&
      current.maxTokens === defaults.maxTokens &&
      current.embeddingDimension === defaults.embeddingDimension
    );
  }

  /**
   * 设置默认 Provider
   */
  async setDefaultProvider(providerId: string): Promise<Result<void>> {
    return this.updateSettings({ defaultProviderId: providerId });
  }

  /**
   * 添加 Provider
   */
  async addProvider(id: string, config: ProviderConfig): Promise<Result<void>> {
    const providers = { ...this.settings.providers, [id]: config };
    const updates: Partial<PluginSettings> = { providers };
    
    // 如果是第一个 Provider，设为默认并更新所有任务配置
    if (Object.keys(this.settings.providers).length === 0) {
      updates.defaultProviderId = id;
      
      // 更新所有任务的 providerId 为新添加的 Provider
      const taskModels = { ...this.settings.taskModels };
      for (const taskType of TASK_TYPES) {
        if (taskModels[taskType] && !taskModels[taskType].providerId) {
          taskModels[taskType] = {
            ...taskModels[taskType],
            providerId: id
          };
        }
      }
      updates.taskModels = taskModels;
    }
    
    return this.updateSettings(updates);
  }

  /**
   * 更新 Provider
   */
  async updateProvider(id: string, updates: Partial<ProviderConfig>): Promise<Result<void>> {
    const currentConfig = this.settings.providers[id];
    if (!currentConfig) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider 不存在: ${id}`);
    }
    
    const providers = {
      ...this.settings.providers,
      [id]: { ...currentConfig, ...updates }
    };
    
    return this.updateSettings({ providers });
  }

  /**
   * 移除 Provider
   */
  async removeProvider(id: string): Promise<Result<void>> {
    const providers = { ...this.settings.providers };
    delete providers[id];
    
    const updates: Partial<PluginSettings> = { providers };
    
    // 如果删除的是默认 Provider，重新选择一个
    if (this.settings.defaultProviderId === id) {
      const remainingIds = Object.keys(providers);
      updates.defaultProviderId = remainingIds.length > 0 ? remainingIds[0] : "";
    }
    
    return this.updateSettings(updates);
  }
}
