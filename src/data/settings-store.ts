/**
 * SettingsStore 组件
 * 实现配置读写、配置验证和配置导入导出
 * 验证需求：8.5, 9.5
 */

import { Plugin } from "obsidian";
import { FileStorage } from "./file-storage";
import { Logger } from "./logger";
import { Result, ok, err, CognitiveRazorSettings, ProviderConfig, ProviderType } from "../types";

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: CognitiveRazorSettings = {
  version: "1.0.0",
  providers: {},
  defaultProviderId: "",
  similarityThreshold: 0.9,
  maxSnapshots: 100,
  concurrency: 3,
  advancedMode: false,
  logLevel: "info",
};

/**
 * SettingsStore 配置
 */
export interface SettingsStoreConfig {
  /** Obsidian Plugin 实例（用于标准 data.json 存储） */
  plugin?: Plugin;
  /** 文件存储（用于自定义文件存储，可选） */
  storage?: FileStorage;
  /** 日志记录器 */
  logger: Logger;
  /** 设置文件路径（仅在使用 FileStorage 时需要） */
  settingsFilePath?: string;
}

/**
 * 配置验证错误
 */
export interface ValidationError {
  /** 字段路径 */
  field: string;
  /** 错误消息 */
  message: string;
}

/**
 * SettingsStore 组件
 */
export class SettingsStore {
  private plugin?: Plugin;
  private storage?: FileStorage;
  private logger: Logger;
  private settingsFilePath?: string;
  private settings: CognitiveRazorSettings;
  private listeners: Array<(settings: CognitiveRazorSettings) => void> = [];

  constructor(config: SettingsStoreConfig) {
    this.plugin = config.plugin;
    this.storage = config.storage;
    this.logger = config.logger;
    this.settingsFilePath = config.settingsFilePath;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  /**
   * 加载设置
   */
  async load(): Promise<Result<CognitiveRazorSettings>> {
    this.logger.info("加载设置");

    try {
      let loadedData: CognitiveRazorSettings | null = null;

      // 优先使用 Obsidian Plugin API（标准 data.json）
      if (this.plugin) {
        const data = await this.plugin.loadData();
        if (data) {
          loadedData = data as CognitiveRazorSettings;
        }
      } 
      // 回退到 FileStorage
      else if (this.storage && this.settingsFilePath) {
        const exists = await this.storage.exists(this.settingsFilePath);
        if (exists) {
          const readResult = await this.storage.readJSON<CognitiveRazorSettings>(this.settingsFilePath);
          if (readResult.ok) {
            loadedData = readResult.value;
          } else {
            this.logger.error("读取设置文件失败", { error: readResult.error });
            return readResult;
          }
        }
      }

      if (!loadedData) {
        this.logger.info("设置不存在，使用默认设置");
        this.settings = { ...DEFAULT_SETTINGS };
        
        // 创建默认设置
        const saveResult = await this.save();
        if (!saveResult.ok) {
          return saveResult;
        }
        
        return ok(this.settings);
      }

      // 合并默认设置（处理新增字段）
      this.settings = this.mergeWithDefaults(loadedData);

      // 验证设置
      const validationResult = this.validate(this.settings);
      if (!validationResult.ok) {
        this.logger.error("设置验证失败", { errors: validationResult.error });
        return validationResult;
      }

      this.logger.info("设置加载成功");
      return ok(this.settings);
    } catch (error) {
      this.logger.error("加载设置异常", { error });
      return err("LOAD_ERROR", `加载设置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 保存设置
   */
  async save(): Promise<Result<void>> {
    this.logger.info("保存设置");

    // 验证设置
    const validationResult = this.validate(this.settings);
    if (!validationResult.ok) {
      this.logger.error("设置验证失败，无法保存", { errors: validationResult.error });
      return validationResult;
    }

    try {
      // 优先使用 Obsidian Plugin API（标准 data.json）
      if (this.plugin) {
        await this.plugin.saveData(this.settings);
      } 
      // 回退到 FileStorage
      else if (this.storage && this.settingsFilePath) {
        const writeResult = await this.storage.writeJSON(this.settingsFilePath, this.settings);
        if (!writeResult.ok) {
          this.logger.error("保存设置文件失败", { error: writeResult.error });
          return writeResult;
        }
      }

      this.logger.info("设置保存成功");
      
      // 通知监听器
      this.notifyListeners();
      
      return ok(undefined);
    } catch (error) {
      this.logger.error("保存设置异常", { error });
      return err("SAVE_ERROR", `保存设置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 获取当前设置
   */
  get(): CognitiveRazorSettings {
    return { ...this.settings };
  }

  /**
   * 更新设置
   */
  async update(partial: Partial<CognitiveRazorSettings>): Promise<Result<void>> {
    this.logger.info("更新设置", { fields: Object.keys(partial) });

    // 合并设置
    const newSettings = { ...this.settings, ...partial };

    // 验证新设置
    const validationResult = this.validate(newSettings);
    if (!validationResult.ok) {
      this.logger.error("设置验证失败", { errors: validationResult.error });
      return validationResult;
    }

    // 更新内存中的设置
    this.settings = newSettings;

    // 保存到文件
    return await this.save();
  }

  /**
   * 验证设置
   */
  validate(settings: CognitiveRazorSettings): Result<void> {
    const errors: ValidationError[] = [];

    // 验证版本号
    if (!settings.version || typeof settings.version !== "string") {
      errors.push({ field: "version", message: "版本号必须是非空字符串" });
    }

    // 验证相似度阈值
    if (typeof settings.similarityThreshold !== "number" ||
        settings.similarityThreshold < 0 ||
        settings.similarityThreshold > 1) {
      errors.push({ field: "similarityThreshold", message: "相似度阈值必须在 0-1 之间" });
    }

    // 验证最大快照数量
    if (typeof settings.maxSnapshots !== "number" ||
        settings.maxSnapshots < 1 ||
        !Number.isInteger(settings.maxSnapshots)) {
      errors.push({ field: "maxSnapshots", message: "最大快照数量必须是正整数" });
    }

    // 验证并发数
    if (typeof settings.concurrency !== "number" ||
        settings.concurrency < 1 ||
        !Number.isInteger(settings.concurrency)) {
      errors.push({ field: "concurrency", message: "并发数必须是正整数" });
    }

    // 验证日志级别
    const validLogLevels = ["debug", "info", "warn", "error"];
    if (!validLogLevels.includes(settings.logLevel)) {
      errors.push({ field: "logLevel", message: `日志级别必须是 ${validLogLevels.join(", ")} 之一` });
    }

    // 验证 providers
    if (typeof settings.providers !== "object" || settings.providers === null) {
      errors.push({ field: "providers", message: "providers 必须是对象" });
    } else {
      // 验证每个 provider 配置
      for (const [providerId, providerConfig] of Object.entries(settings.providers)) {
        const providerErrors = this.validateProviderConfig(providerId, providerConfig);
        errors.push(...providerErrors);
      }
    }

    // 验证默认 Provider ID
    if (settings.defaultProviderId && !settings.providers[settings.defaultProviderId]) {
      errors.push({ field: "defaultProviderId", message: "默认 Provider 不存在于 providers 中" });
    }

    if (errors.length > 0) {
      return err("VALIDATION_ERROR", "设置验证失败", errors);
    }

    return ok(undefined);
  }

  /**
   * 验证 Provider 配置
   */
  private validateProviderConfig(providerId: string, config: ProviderConfig): ValidationError[] {
    const errors: ValidationError[] = [];
    const prefix = `providers.${providerId}`;

    // 验证类型
    const validTypes: ProviderType[] = ["openai"];
    if (!validTypes.includes(config.type)) {
      errors.push({
        field: `${prefix}.type`,
        message: `Provider 类型必须是 ${validTypes.join(", ")} 之一`,
      });
    }

    // 验证 API Key
    if (!config.apiKey || typeof config.apiKey !== "string") {
      errors.push({
        field: `${prefix}.apiKey`,
        message: "API Key 必须是非空字符串",
      });
    }

    // 验证默认聊天模型
    if (!config.defaultChatModel || typeof config.defaultChatModel !== "string") {
      errors.push({
        field: `${prefix}.defaultChatModel`,
        message: "默认聊天模型必须是非空字符串",
      });
    }

    // 验证默认嵌入模型
    if (!config.defaultEmbedModel || typeof config.defaultEmbedModel !== "string") {
      errors.push({
        field: `${prefix}.defaultEmbedModel`,
        message: "默认嵌入模型必须是非空字符串",
      });
    }

    // 验证 enabled 标志
    if (typeof config.enabled !== "boolean") {
      errors.push({
        field: `${prefix}.enabled`,
        message: "enabled 必须是布尔值",
      });
    }

    // 验证 baseUrl（可选）
    if (config.baseUrl !== undefined && typeof config.baseUrl !== "string") {
      errors.push({
        field: `${prefix}.baseUrl`,
        message: "baseUrl 必须是字符串",
      });
    }

    return errors;
  }

  /**
   * 合并默认设置
   */
  private mergeWithDefaults(settings: Partial<CognitiveRazorSettings>): CognitiveRazorSettings {
    return {
      version: settings.version || DEFAULT_SETTINGS.version,
      providers: settings.providers || DEFAULT_SETTINGS.providers,
      defaultProviderId: settings.defaultProviderId || DEFAULT_SETTINGS.defaultProviderId,
      similarityThreshold: settings.similarityThreshold ?? DEFAULT_SETTINGS.similarityThreshold,
      maxSnapshots: settings.maxSnapshots ?? DEFAULT_SETTINGS.maxSnapshots,
      concurrency: settings.concurrency ?? DEFAULT_SETTINGS.concurrency,
      advancedMode: settings.advancedMode ?? DEFAULT_SETTINGS.advancedMode,
      logLevel: settings.logLevel || DEFAULT_SETTINGS.logLevel,
    };
  }

  /**
   * 导出设置
   */
  async export(): Promise<Result<string>> {
    this.logger.info("导出设置");

    try {
      const exported = JSON.stringify(this.settings, null, 2);
      return ok(exported);
    } catch (error) {
      this.logger.error("导出设置失败", { error });
      return err("EXPORT_ERROR", "导出设置失败", error);
    }
  }

  /**
   * 导入设置
   */
  async import(json: string): Promise<Result<void>> {
    this.logger.info("导入设置");

    try {
      // 解析 JSON
      const imported = JSON.parse(json) as Partial<CognitiveRazorSettings>;

      // 合并默认设置
      const newSettings = this.mergeWithDefaults(imported);

      // 验证设置
      const validationResult = this.validate(newSettings);
      if (!validationResult.ok) {
        this.logger.error("导入的设置验证失败", { errors: validationResult.error });
        return validationResult;
      }

      // 更新设置
      this.settings = newSettings;

      // 保存到文件
      const saveResult = await this.save();
      if (!saveResult.ok) {
        return saveResult;
      }

      this.logger.info("设置导入成功");
      return ok(undefined);
    } catch (error) {
      this.logger.error("导入设置失败", { error });
      return err("IMPORT_ERROR", "导入设置失败", error);
    }
  }

  /**
   * 重置为默认设置
   */
  async reset(): Promise<Result<void>> {
    this.logger.info("重置设置为默认值");

    this.settings = { ...DEFAULT_SETTINGS };
    return await this.save();
  }

  /**
   * 添加 Provider 配置
   */
  async addProvider(providerId: string, config: ProviderConfig): Promise<Result<void>> {
    this.logger.info("添加 Provider 配置", { providerId });

    // 验证 Provider 配置
    const errors = this.validateProviderConfig(providerId, config);
    if (errors.length > 0) {
      return err("VALIDATION_ERROR", "Provider 配置验证失败", errors);
    }

    // 检查是否已存在
    if (this.settings.providers[providerId]) {
      return err("PROVIDER_EXISTS", `Provider ${providerId} 已存在`);
    }

    // 添加配置
    this.settings.providers[providerId] = config;

    // 如果是第一个 Provider，设置为默认
    if (!this.settings.defaultProviderId) {
      this.settings.defaultProviderId = providerId;
    }

    // 保存设置
    return await this.save();
  }

  /**
   * 更新 Provider 配置
   */
  async updateProvider(providerId: string, config: Partial<ProviderConfig>): Promise<Result<void>> {
    this.logger.info("更新 Provider 配置", { providerId });

    // 检查 Provider 是否存在
    if (!this.settings.providers[providerId]) {
      return err("PROVIDER_NOT_FOUND", `Provider ${providerId} 不存在`);
    }

    // 合并配置
    const newConfig = { ...this.settings.providers[providerId], ...config };

    // 验证配置
    const errors = this.validateProviderConfig(providerId, newConfig);
    if (errors.length > 0) {
      return err("VALIDATION_ERROR", "Provider 配置验证失败", errors);
    }

    // 更新配置
    this.settings.providers[providerId] = newConfig;

    // 保存设置
    return await this.save();
  }

  /**
   * 删除 Provider 配置
   */
  async removeProvider(providerId: string): Promise<Result<void>> {
    this.logger.info("删除 Provider 配置", { providerId });

    // 检查 Provider 是否存在
    if (!this.settings.providers[providerId]) {
      return err("PROVIDER_NOT_FOUND", `Provider ${providerId} 不存在`);
    }

    // 删除配置
    delete this.settings.providers[providerId];

    // 如果删除的是默认 Provider，清空默认 Provider ID
    if (this.settings.defaultProviderId === providerId) {
      // 尝试设置第一个可用的 Provider 为默认
      const providerIds = Object.keys(this.settings.providers);
      this.settings.defaultProviderId = providerIds.length > 0 ? providerIds[0] : "";
    }

    // 保存设置
    return await this.save();
  }

  /**
   * 获取 Provider 配置
   */
  getProvider(providerId: string): ProviderConfig | undefined {
    return this.settings.providers[providerId];
  }

  /**
   * 获取所有 Provider 配置
   */
  getAllProviders(): Record<string, ProviderConfig> {
    return { ...this.settings.providers };
  }

  /**
   * 设置默认 Provider
   */
  async setDefaultProvider(providerId: string): Promise<Result<void>> {
    this.logger.info("设置默认 Provider", { providerId });

    // 检查 Provider 是否存在
    if (!this.settings.providers[providerId]) {
      return err("PROVIDER_NOT_FOUND", `Provider ${providerId} 不存在`);
    }

    this.settings.defaultProviderId = providerId;
    return await this.save();
  }

  /**
   * 订阅设置变更
   */
  subscribe(listener: (settings: CognitiveRazorSettings) => void): () => void {
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
   * 通知所有监听器
   */
  private notifyListeners(): void {
    const settings = this.get();
    for (const listener of this.listeners) {
      try {
        listener(settings);
      } catch (error) {
        this.logger.error("设置监听器执行失败", { error });
      }
    }
  }
}
