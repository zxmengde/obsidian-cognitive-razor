/** SettingsStore - 管理插件配置，支持版本兼容性检查和导入导出 */

import { ok, err } from "../types";
import type { PluginSettings, ProviderConfig, Result, DirectoryScheme, TaskType, TaskModelConfig } from "../types";
import { DEFAULT_UI_STATE } from "../types";
import { Plugin } from "obsidian";

/**
 * 默认目录方案
 */
const DEFAULT_DIRECTORY_SCHEME: DirectoryScheme = {
  Domain: "1-领域",
  Issue: "2-议题",
  Theory: "3-理论",
  Entity: "4-实体",
  Mechanism: "5-机制",
};

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

/** 生成新的默认任务模型配置副本 */
function createDefaultTaskModels(): Record<TaskType, TaskModelConfig> {
  const taskModels = {} as Record<TaskType, TaskModelConfig>;
  for (const taskType of TASK_TYPES) {
    taskModels[taskType] = { ...DEFAULT_TASK_MODEL_CONFIGS[taskType] };
  }
  return taskModels;
}

/**
 * 验证错误接口
 */
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
      if (!this.validateSettings(merged)) {
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

      const validation = this.validateSettings(mergeResult.value);
      if (!validation) {
        return err(
          "E101_INVALID_INPUT",
          "设置校验失败"
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
    if (data === null || typeof data !== "object") return false;
    const obj = data as Record<string, unknown>;
    return typeof obj.version === "string"
      && typeof obj.directoryScheme === "object" && obj.directoryScheme !== null
      && typeof obj.providers === "object" && obj.providers !== null
      && typeof obj.taskModels === "object" && obj.taskModels !== null;
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
