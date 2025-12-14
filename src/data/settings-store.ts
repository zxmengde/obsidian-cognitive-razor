/** SettingsStore - 管理插件配置，支持版本兼容性检查和导入导出 */

import { PluginSettings, ProviderConfig, Result, ok, err, DirectoryScheme, TaskType, TaskModelConfig } from "../types";
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
  "language",
  "namingTemplate",
  "directoryScheme",
  "similarityThreshold",
  "topK",
  "concurrency",
  "autoRetry",
  "maxRetryAttempts",
  "maxSnapshots",
  "maxSnapshotAgeDays",
  "enableGrounding",
  "providers",
  "defaultProviderId",
  "taskModels",
  "logLevel",
  "embeddingDimension",
  "providerTimeoutMs",
];

const DEFAULT_TASK_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_TASK_HISTORY = 300;

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
    model: "gpt-4o",
    temperature: 0.3,
    topP: 1.0,
  },
  tag: {
    providerId: "",
    model: "gpt-4o",
    temperature: 0.5,
    topP: 1.0,
  },
  write: {
    providerId: "",
    model: "gpt-4o",
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
    model: "gpt-4o",
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
  version: "0.9.3",
  
  // 基础设置
  language: "zh",
  
  // 命名设置 (G-10: 命名规范性公理)
  namingTemplate: "{{chinese}} ({{english}})",
  
  // 存储设置
  directoryScheme: DEFAULT_DIRECTORY_SCHEME,
  
  // 去重设置 (G-02: 语义唯一性公理, A-FUNC-04: 语义去重检测)
  similarityThreshold: 0.9,
  topK: 10,
  
  // 队列设置
  concurrency: 1,
  autoRetry: true,
  maxRetryAttempts: 3,
  taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
  maxTaskHistory: DEFAULT_TASK_HISTORY,
  
  // 快照设置
  maxSnapshots: 100,
  maxSnapshotAgeDays: 30, // A-FUNC-02: 可配置的快照保留天数
  
  // 功能开关
  enableGrounding: false,
  
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
      const data = await this.plugin.loadData();
      
      if (!data) {
        // 首次使用，使用默认设置
        this.settings = { ...DEFAULT_SETTINGS };
        await this.saveSettings();
        return ok(undefined);
      }

      // 检查版本兼容性
      const compatibilityResult = this.checkVersionCompatibility(data.version);
      if (!compatibilityResult.ok) {
        // 版本不兼容时重置为默认值 (O-05 开发阶段版本策略)
        this.settings = { ...DEFAULT_SETTINGS };
        await this.saveSettings();
        return ok(undefined);
      }

      // 验证设置结构
      const validationResult = this.validateSettingsDetailed(data);
      if (!validationResult.valid) {
        // 验证失败时重置为默认值
        this.settings = { ...DEFAULT_SETTINGS };
        await this.saveSettings();
        return ok(undefined);
      }

      // 合并设置（保留默认值）
      this.settings = this.mergeSettings(DEFAULT_SETTINGS, data);
      
      return ok(undefined);
    } catch (error) {
      return err(
        "E300",
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
          "E001",
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
        "E301",
        "Failed to update settings",
        error
      );
    }
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
      const data = JSON.parse(json);

      // 验证设置结构
      if (!this.validateSettings(data)) {
        return err(
          "E001",
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
        "E001",
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
        "E301",
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
      taskModels: createDefaultTaskModels()
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
        "E302",
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
      });
      return { valid: false, errors };
    }

    const settings = data as Record<string, unknown>;

    // 验证 version 字段
    if (typeof settings.version !== "string") {
      errors.push({
        field: "version",
        message: "version must be a string",
        expectedType: "string",
        actualType: typeof settings.version,
      });
    }

    // 验证 language 字段
    if (typeof settings.language !== "string") {
      errors.push({
        field: "language",
        message: "language must be a string",
        expectedType: "string",
        actualType: typeof settings.language,
      });
    } else if (settings.language !== "zh" && settings.language !== "en") {
      errors.push({
        field: "language",
        message: "language must be 'zh' or 'en'",
        expectedType: "'zh' | 'en'",
        actualType: `'${settings.language}'`,
      });
    }

    // 验证 namingTemplate 字段
    if (typeof settings.namingTemplate !== "string") {
      errors.push({
        field: "namingTemplate",
        message: "namingTemplate must be a string",
        expectedType: "string",
        actualType: typeof settings.namingTemplate,
      });
    }

    // 验证 directoryScheme 字段
    this.validateDirectoryScheme(settings.directoryScheme, errors);

    // 验证 similarityThreshold 字段
    if (typeof settings.similarityThreshold !== "number") {
      errors.push({
        field: "similarityThreshold",
        message: "similarityThreshold must be a number",
        expectedType: "number",
        actualType: typeof settings.similarityThreshold,
      });
    } else if (settings.similarityThreshold < 0 || settings.similarityThreshold > 1) {
      errors.push({
        field: "similarityThreshold",
        message: "similarityThreshold must be between 0 and 1",
        expectedType: "number (0-1)",
        actualType: String(settings.similarityThreshold),
      });
    }

    // 验证 topK 字段
    if (typeof settings.topK !== "number") {
      errors.push({
        field: "topK",
        message: "topK must be a number",
        expectedType: "number",
        actualType: typeof settings.topK,
      });
    } else if (!Number.isInteger(settings.topK) || settings.topK < 1) {
      errors.push({
        field: "topK",
        message: "topK must be a positive integer",
        expectedType: "positive integer",
        actualType: String(settings.topK),
      });
    }

    // 验证 concurrency 字段
    if (typeof settings.concurrency !== "number") {
      errors.push({
        field: "concurrency",
        message: "concurrency must be a number",
        expectedType: "number",
        actualType: typeof settings.concurrency,
      });
    } else if (!Number.isInteger(settings.concurrency) || settings.concurrency < 1) {
      errors.push({
        field: "concurrency",
        message: "concurrency must be a positive integer",
        expectedType: "positive integer",
        actualType: String(settings.concurrency),
      });
    }

    // 验证 autoRetry 字段
    if (typeof settings.autoRetry !== "boolean") {
      errors.push({
        field: "autoRetry",
        message: "autoRetry must be a boolean",
        expectedType: "boolean",
        actualType: typeof settings.autoRetry,
      });
    }

    // 验证 maxRetryAttempts 字段
    if (typeof settings.maxRetryAttempts !== "number") {
      errors.push({
        field: "maxRetryAttempts",
        message: "maxRetryAttempts must be a number",
        expectedType: "number",
        actualType: typeof settings.maxRetryAttempts,
      });
    } else if (!Number.isInteger(settings.maxRetryAttempts) || settings.maxRetryAttempts < 0) {
      errors.push({
        field: "maxRetryAttempts",
        message: "maxRetryAttempts must be a non-negative integer",
        expectedType: "non-negative integer",
        actualType: String(settings.maxRetryAttempts),
      });
    }

    // 验证 maxSnapshots 字段
    if (typeof settings.maxSnapshots !== "number") {
      errors.push({
        field: "maxSnapshots",
        message: "maxSnapshots must be a number",
        expectedType: "number",
        actualType: typeof settings.maxSnapshots,
      });
    } else if (!Number.isInteger(settings.maxSnapshots) || settings.maxSnapshots < 1) {
      errors.push({
        field: "maxSnapshots",
        message: "maxSnapshots must be a positive integer",
        expectedType: "positive integer",
        actualType: String(settings.maxSnapshots),
      });
    }

    // 验证 maxSnapshotAgeDays 字段 (A-FUNC-02)
    if (typeof settings.maxSnapshotAgeDays !== "number") {
      errors.push({
        field: "maxSnapshotAgeDays",
        message: "maxSnapshotAgeDays must be a number",
        expectedType: "number",
        actualType: typeof settings.maxSnapshotAgeDays,
      });
    } else if (!Number.isInteger(settings.maxSnapshotAgeDays) || settings.maxSnapshotAgeDays < 1) {
      errors.push({
        field: "maxSnapshotAgeDays",
        message: "maxSnapshotAgeDays must be a positive integer",
        expectedType: "positive integer",
        actualType: String(settings.maxSnapshotAgeDays),
      });
    }

    // 验证 enableGrounding 字段
    if (typeof settings.enableGrounding !== "boolean") {
      errors.push({
        field: "enableGrounding",
        message: "enableGrounding must be a boolean",
        expectedType: "boolean",
        actualType: typeof settings.enableGrounding,
      });
    }

    // 验证 providers 字段
    if (typeof settings.providers !== "object" || settings.providers === null) {
      errors.push({
        field: "providers",
        message: "providers must be an object",
        expectedType: "object",
        actualType: settings.providers === null ? "null" : typeof settings.providers,
      });
    } else {
      for (const [providerId, providerConfig] of Object.entries(settings.providers)) {
        if (typeof providerConfig !== "object" || providerConfig === null) {
          errors.push({
            field: `providers.${providerId}`,
            message: "provider config must be an object",
            expectedType: "ProviderConfig",
            actualType: providerConfig === null ? "null" : typeof providerConfig
          });
          continue;
        }
        const cfg = providerConfig as ProviderConfig;
        if (typeof cfg.apiKey !== "string") {
          errors.push({
            field: `providers.${providerId}.apiKey`,
            message: "apiKey must be a string",
            expectedType: "string",
            actualType: typeof cfg.apiKey
          });
        }
        if (cfg.baseUrl !== undefined && typeof cfg.baseUrl !== "string") {
          errors.push({
            field: `providers.${providerId}.baseUrl`,
            message: "baseUrl must be a string",
            expectedType: "string",
            actualType: typeof cfg.baseUrl
          });
        }
        if (typeof cfg.defaultChatModel !== "string") {
          errors.push({
            field: `providers.${providerId}.defaultChatModel`,
            message: "defaultChatModel must be a string",
            expectedType: "string",
            actualType: typeof cfg.defaultChatModel
          });
        }
        if (typeof cfg.defaultEmbedModel !== "string") {
          errors.push({
            field: `providers.${providerId}.defaultEmbedModel`,
            message: "defaultEmbedModel must be a string",
            expectedType: "string",
            actualType: typeof cfg.defaultEmbedModel
          });
        }
        if (typeof cfg.enabled !== "boolean") {
          errors.push({
            field: `providers.${providerId}.enabled`,
            message: "enabled must be a boolean",
            expectedType: "boolean",
            actualType: typeof cfg.enabled
          });
        }

      }
    }

    // 验证 defaultProviderId 字段
    if (typeof settings.defaultProviderId !== "string") {
      errors.push({
        field: "defaultProviderId",
        message: "defaultProviderId must be a string",
        expectedType: "string",
        actualType: typeof settings.defaultProviderId,
      });
    }

    // 验证 taskModels 字段
    this.validateTaskModels(settings.taskModels, errors);

    // 验证 logLevel 字段
    if (typeof settings.logLevel !== "string") {
      errors.push({
        field: "logLevel",
        message: "logLevel must be a string",
        expectedType: "string",
        actualType: typeof settings.logLevel,
      });
    } else if (!["debug", "info", "warn", "error"].includes(settings.logLevel)) {
      errors.push({
        field: "logLevel",
        message: "logLevel must be 'debug', 'info', 'warn', or 'error'",
        expectedType: "'debug' | 'info' | 'warn' | 'error'",
        actualType: `'${settings.logLevel}'`,
      });
    }

    // 验证 embeddingDimension 字段
    if (typeof settings.embeddingDimension !== "number") {
      errors.push({
        field: "embeddingDimension",
        message: "embeddingDimension must be a number",
        expectedType: "number",
        actualType: typeof settings.embeddingDimension,
      });
    } else if (!Number.isInteger(settings.embeddingDimension) || settings.embeddingDimension < 1) {
      errors.push({
        field: "embeddingDimension",
        message: "embeddingDimension must be a positive integer",
        expectedType: "positive integer",
        actualType: String(settings.embeddingDimension),
      });
    }

    // 验证 providerTimeoutMs 字段
    if (typeof settings.providerTimeoutMs !== "number") {
      errors.push({
        field: "providerTimeoutMs",
        message: "providerTimeoutMs must be a number",
        expectedType: "number",
        actualType: typeof settings.providerTimeoutMs,
      });
    } else if (!Number.isInteger(settings.providerTimeoutMs) || settings.providerTimeoutMs < 1000) {
      errors.push({
        field: "providerTimeoutMs",
        message: "providerTimeoutMs must be an integer >= 1000",
        expectedType: "integer (>=1000)",
        actualType: String(settings.providerTimeoutMs),
      });
    }

    // 任务超时
    if (settings.taskTimeoutMs !== undefined) {
      if (typeof settings.taskTimeoutMs !== "number") {
        errors.push({
          field: "taskTimeoutMs",
          message: "taskTimeoutMs must be a number",
          expectedType: "number",
          actualType: typeof settings.taskTimeoutMs
        });
      } else if (!Number.isInteger(settings.taskTimeoutMs) || settings.taskTimeoutMs < 1000) {
        errors.push({
          field: "taskTimeoutMs",
          message: "taskTimeoutMs must be an integer greater than 1000",
          expectedType: "integer (>=1000)",
          actualType: String(settings.taskTimeoutMs)
        });
      }
    }

    if (settings.maxTaskHistory !== undefined) {
      if (typeof settings.maxTaskHistory !== "number") {
        errors.push({
          field: "maxTaskHistory",
          message: "maxTaskHistory must be a number",
          expectedType: "number",
          actualType: typeof settings.maxTaskHistory
        });
      } else if (!Number.isInteger(settings.maxTaskHistory) || settings.maxTaskHistory < 50) {
        errors.push({
          field: "maxTaskHistory",
          message: "maxTaskHistory must be an integer greater than 50",
          expectedType: "integer (>=50)",
          actualType: String(settings.maxTaskHistory)
        });
      }
    }

    return { valid: errors.length === 0, errors };
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
        });
      }

      // 验证 model
      if (typeof modelConfig.model !== "string") {
        errors.push({
          field: `taskModels.${taskType}.model`,
          message: `taskModels.${taskType}.model must be a string`,
          expectedType: "string",
          actualType: typeof modelConfig.model,
        });
      }

      // 验证可选字段 temperature
      if (modelConfig.temperature !== undefined && typeof modelConfig.temperature !== "number") {
        errors.push({
          field: `taskModels.${taskType}.temperature`,
          message: `taskModels.${taskType}.temperature must be a number`,
          expectedType: "number",
          actualType: typeof modelConfig.temperature,
        });
      }

      // 验证可选字段 topP
      if (modelConfig.topP !== undefined && typeof modelConfig.topP !== "number") {
        errors.push({
          field: `taskModels.${taskType}.topP`,
          message: `taskModels.${taskType}.topP must be a number`,
          expectedType: "number",
          actualType: typeof modelConfig.topP,
        });
      }

      // 验证可选字段 maxTokens
      if (modelConfig.maxTokens !== undefined && typeof modelConfig.maxTokens !== "number") {
        errors.push({
          field: `taskModels.${taskType}.maxTokens`,
          message: `taskModels.${taskType}.maxTokens must be a number`,
          expectedType: "number",
          actualType: typeof modelConfig.maxTokens,
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
      taskModels: { ...this.settings.taskModels }
    };

    // 基础字段
    if (partial.language !== undefined) {
      if (partial.language !== "zh" && partial.language !== "en") {
        return err("E001", "language 必须是 zh 或 en");
      }
      next.language = partial.language;
    }

    if (partial.namingTemplate !== undefined) {
      if (typeof partial.namingTemplate !== "string") {
        return err("E001", "namingTemplate 必须是字符串");
      }
      next.namingTemplate = partial.namingTemplate;
    }

    // 目录方案
    if (partial.directoryScheme !== undefined) {
      if (!this.isPlainObject(partial.directoryScheme)) {
        return err("E001", "directoryScheme 必须是对象");
      }
      next.directoryScheme = {
        ...next.directoryScheme,
        ...partial.directoryScheme
      };
    }

    // 数值字段
    for (const key of [
      "similarityThreshold",
      "topK",
      "concurrency",
      "maxRetryAttempts",
      "maxSnapshots",
      "maxSnapshotAgeDays",
      "embeddingDimension",
      "taskTimeoutMs",
      "maxTaskHistory",
      "providerTimeoutMs"
    ] as const) {
      const result = this.applyNumberUpdate(partial, key, next);
      if (!result.ok) {
        return err(result.error.code, result.error.message, result.error.details);
      }
    }

    // 布尔字段
    for (const key of ["autoRetry", "enableGrounding"] as const) {
      const result = this.applyBooleanUpdate(partial, key, next);
      if (!result.ok) {
        return err(result.error.code, result.error.message, result.error.details);
      }
    }

    // 日志级别
    if (partial.logLevel !== undefined) {
      if (!["debug", "info", "warn", "error"].includes(partial.logLevel)) {
        return err("E001", "logLevel 不合法");
      }
      next.logLevel = partial.logLevel as PluginSettings["logLevel"];
    }

    // Provider 配置
    if (partial.providers !== undefined) {
      if (!this.isPlainObject(partial.providers)) {
        return err("E001", "providers 必须是对象");
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

    if (partial.defaultProviderId !== undefined) {
      if (typeof partial.defaultProviderId !== "string") {
        return err("E001", "defaultProviderId 必须是字符串");
      }
      next.defaultProviderId = partial.defaultProviderId;
    }

    // 任务模型
    if (partial.taskModels !== undefined) {
      if (!this.isPlainObject(partial.taskModels)) {
        return err("E001", "taskModels 必须是对象");
      }
      const mergedTaskModels: Record<TaskType, TaskModelConfig> = { ...next.taskModels };
      for (const [taskType, config] of Object.entries(partial.taskModels)) {
        const existing = mergedTaskModels[taskType as TaskType];
        if (!existing) {
          continue;
        }
        if (!this.isPlainObject(config)) {
          return err("E001", `taskModels.${taskType} 必须是对象`);
        }
        mergedTaskModels[taskType as TaskType] = {
          ...existing,
          ...(config as TaskModelConfig)
        };
      }
      next.taskModels = mergedTaskModels;
    }

    // 版本号
    if (partial.version !== undefined) {
      if (typeof partial.version !== "string") {
        return err("E001", "version 必须是字符串");
      }
      next.version = partial.version;
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

  private normalizeProviderConfig(
    existing: ProviderConfig | undefined,
    incoming: unknown
  ): Result<ProviderConfig> {
    if (!this.isPlainObject(incoming)) {
      return err("E001", "provider 配置必须是对象");
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
        return err("E001", "provider.apiKey 必须是字符串");
      }
      base.apiKey = incomingConfig.apiKey.trim();
    }

    if (incomingConfig.baseUrl !== undefined) {
      if (incomingConfig.baseUrl !== null && typeof incomingConfig.baseUrl !== "string") {
        return err("E001", "provider.baseUrl 必须是字符串");
      }
      base.baseUrl = incomingConfig.baseUrl?.trim() || undefined;
    }

    if (incomingConfig.defaultChatModel !== undefined) {
      if (typeof incomingConfig.defaultChatModel !== "string") {
        return err("E001", "provider.defaultChatModel 必须是字符串");
      }
      base.defaultChatModel = incomingConfig.defaultChatModel.trim();
    }

    if (incomingConfig.defaultEmbedModel !== undefined) {
      if (typeof incomingConfig.defaultEmbedModel !== "string") {
        return err("E001", "provider.defaultEmbedModel 必须是字符串");
      }
      base.defaultEmbedModel = incomingConfig.defaultEmbedModel.trim();
    }

    if (incomingConfig.enabled !== undefined) {
      if (typeof incomingConfig.enabled !== "boolean") {
        return err("E001", "provider.enabled 必须是布尔值");
      }
      base.enabled = incomingConfig.enabled;
    }

    return ok(base);
  }

  private applyNumberUpdate(
    partial: Partial<PluginSettings>,
    key: keyof Pick<PluginSettings, "similarityThreshold" | "topK" | "concurrency" | "maxRetryAttempts" | "maxSnapshots" | "maxSnapshotAgeDays" | "embeddingDimension" | "taskTimeoutMs" | "maxTaskHistory" | "providerTimeoutMs">,
    target: PluginSettings
  ): Result<void> {
    const value = partial[key];
    if (value !== undefined) {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return err("E001", `${String(key)} 必须是数字`);
      }
      Reflect.set(target, key, value);
    }
    return ok(undefined);
  }

  private applyBooleanUpdate(
    partial: Partial<PluginSettings>,
    key: keyof Pick<PluginSettings, "autoRetry" | "enableGrounding">,
    target: PluginSettings
  ): Result<void> {
    const value = partial[key];
    if (value !== undefined) {
      if (typeof value !== "boolean") {
        return err("E001", `${String(key)} 必须是布尔值`);
      }
      Reflect.set(target, key, value);
    }
    return ok(undefined);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // 便捷方法

  /** 更新部分设置 */
  async update(partial: Partial<PluginSettings>): Promise<Result<void>> {
    return this.updateSettings(partial);
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
      return err("E304", `Provider 不存在: ${id}`);
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

  /**
   * 导出设置（返回 Result）
   */
  async export(): Promise<Result<string>> {
    try {
      return ok(this.exportSettings());
    } catch (error) {
      return err("E301", "导出设置失败", error);
    }
  }

  /**
   * 导入设置（importSettings 的别名）
   */
  async import(json: string): Promise<Result<void>> {
    return this.importSettings(json);
  }

  /**
   * 重置设置（resetToDefaults 的别名）
   */
  async reset(): Promise<Result<void>> {
    return this.resetToDefaults();
  }
}
