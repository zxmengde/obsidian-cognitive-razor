/**
 * MigrationManager - 配置迁移管理器
 * 
 * 负责：
 * - 检测需要迁移的配置
 * - 显示迁移向导
 * - 执行迁移操作
 * - 处理 OpenRouter 迁移
 */

import { App, Notice } from "obsidian";
import { SettingsStore } from "../data/settings-store";
import { Logger } from "../data/logger";
import { MigrationRunner } from "../data/migration-runner";
import { FileStorage } from "../data/file-storage";
import { ALL_MIGRATIONS } from "../data/migrations";
import { OpenRouterMigrationModal, MigrationPromptModal } from "../ui/migration-wizard";
import { Result, ok, err, ProviderConfig } from "../types";
import { DEFAULT_ENDPOINTS } from "./provider-manager";

/**
 * MigrationManager 配置
 */
export interface MigrationManagerConfig {
  /** Obsidian App */
  app: App;
  /** 设置存储 */
  settingsStore: SettingsStore;
  /** 文件存储 */
  storage: FileStorage;
  /** 日志记录器 */
  logger: Logger;
}

/**
 * MigrationManager 实现
 */
export class MigrationManager {
  private app: App;
  private settingsStore: SettingsStore;
  private storage: FileStorage;
  private logger: Logger;
  private migrationRunner: MigrationRunner;

  constructor(config: MigrationManagerConfig) {
    this.app = config.app;
    this.settingsStore = config.settingsStore;
    this.storage = config.storage;
    this.logger = config.logger;

    // 创建迁移运行器
    this.migrationRunner = new MigrationRunner({
      storage: this.storage,
      logger: this.logger,
      settingsStore: this.settingsStore,
      historyFilePath: "migration-history.json",
      migrations: ALL_MIGRATIONS
    });
  }

  /**
   * 初始化迁移管理器
   */
  async initialize(): Promise<Result<void>> {
    this.logger.info("初始化迁移管理器");

    // 初始化迁移运行器
    const initResult = await this.migrationRunner.initialize();
    if (!initResult.ok) {
      this.logger.error("初始化迁移运行器失败", { error: initResult.error });
      return initResult;
    }

    return ok(undefined);
  }

  /**
   * 检查并执行必要的迁移
   */
  async checkAndMigrate(targetVersion: string): Promise<Result<void>> {
    this.logger.info("检查迁移需求", { targetVersion });

    // 检查是否需要迁移
    const needsMigration = await this.migrationRunner.needsMigration(targetVersion);
    if (!needsMigration) {
      this.logger.info("无需迁移");
      return ok(undefined);
    }

    // 检查是否有 OpenRouter 配置
    const hasOpenRouter = this.detectOpenRouter();
    if (hasOpenRouter) {
      this.logger.info("检测到 OpenRouter 配置，显示迁移向导");
      return await this.handleOpenRouterMigration();
    }

    // 执行自动迁移
    this.logger.info("执行自动迁移");
    const migrateResult = await this.migrationRunner.migrate(targetVersion);
    
    if (!migrateResult.ok) {
      this.logger.error("迁移失败", { error: migrateResult.error });
      
      // 如果是需要用户输入的错误，显示向导
      if (migrateResult.error.code === "MIGRATION_REQUIRES_USER_INPUT") {
        return await this.handleOpenRouterMigration();
      }
      
      return migrateResult;
    }

    this.logger.info("迁移完成");
    new Notice("配置已成功迁移到新版本");
    return ok(undefined);
  }

  /**
   * 检测是否有 OpenRouter 配置
   */
  private detectOpenRouter(): boolean {
    const settings = this.settingsStore.get();
    
    for (const [id, config] of Object.entries(settings.providers)) {
      if ((config as any).type === "openrouter") {
        this.logger.info("检测到 OpenRouter 配置", { providerId: id });
        return true;
      }
    }

    return false;
  }

  /**
   * 处理 OpenRouter 迁移
   */
  private async handleOpenRouterMigration(): Promise<Result<void>> {
    return new Promise((resolve) => {
      const settings = this.settingsStore.get();
      
      // 找到第一个 OpenRouter 配置
      let openRouterProviderId: string | null = null;
      let openRouterConfig: any = null;

      for (const [id, config] of Object.entries(settings.providers)) {
        if ((config as any).type === "openrouter") {
          openRouterProviderId = id;
          openRouterConfig = config;
          break;
        }
      }

      if (!openRouterProviderId || !openRouterConfig) {
        // 没有找到 OpenRouter 配置，执行普通迁移
        this.migrationRunner.migrate("2.0.0").then(resolve);
        return;
      }

      // 显示迁移向导
      const modal = new OpenRouterMigrationModal(this.app, {
        providerId: openRouterProviderId,
        config: openRouterConfig,
        onMigrate: async (action) => {
          const result = await this.executeOpenRouterMigration(
            openRouterProviderId!,
            openRouterConfig,
            action
          );
          resolve(result);
        },
        onCancel: () => {
          resolve(err("MIGRATION_CANCELLED", "用户取消了迁移"));
        }
      });

      modal.open();
    });
  }

  /**
   * 执行 OpenRouter 迁移
   */
  private async executeOpenRouterMigration(
    providerId: string,
    oldConfig: any,
    action: "openai" | "google" | "skip"
  ): Promise<Result<void>> {
    this.logger.info("执行 OpenRouter 迁移", { providerId, action });

    const settings = this.settingsStore.get();
    const newProviders: Record<string, ProviderConfig> = {};

    // 复制所有非 OpenRouter 的 Provider
    for (const [id, config] of Object.entries(settings.providers)) {
      if ((config as any).type !== "openrouter") {
        // 为现有 Provider 添加默认 baseUrl（如果没有）
        const providerConfig = config as ProviderConfig;
        if (!providerConfig.baseUrl) {
          newProviders[id] = {
            ...providerConfig,
            baseUrl: DEFAULT_ENDPOINTS[providerConfig.type]
          };
        } else {
          newProviders[id] = providerConfig;
        }
      }
    }

    // 根据用户选择处理 OpenRouter 配置
    if (action === "openai") {
      // 转换为 OpenAI Provider + OpenRouter 端点
      newProviders[providerId] = {
        type: "openai",
        apiKey: oldConfig.apiKey,
        baseUrl: "https://openrouter.ai/api/v1",
        defaultChatModel: oldConfig.defaultChatModel || "gpt-4-turbo-preview",
        defaultEmbedModel: oldConfig.defaultEmbedModel || "text-embedding-3-small",
        enabled: oldConfig.enabled ?? true
      };

      this.logger.info("OpenRouter 配置已转换为 OpenAI Provider", { providerId });
      new Notice(`已将 ${providerId} 迁移为 OpenAI Provider（使用 OpenRouter 端点）`);
    } else if (action === "google") {
      // 删除 OpenRouter，用户需要手动配置新 Provider
      this.logger.info("OpenRouter 配置已删除，用户需要配置新 Provider", { providerId });
      new Notice("OpenRouter 配置已删除，请在设置中配置新的 Provider");
    } else {
      // 跳过，只删除 OpenRouter
      this.logger.info("OpenRouter 配置已删除", { providerId });
      new Notice("OpenRouter 配置已删除");
    }

    // 更新设置
    const updateResult = await this.settingsStore.update({
      providers: newProviders,
      version: "2.0.0"
    });

    if (!updateResult.ok) {
      this.logger.error("更新设置失败", { error: updateResult.error });
      return updateResult;
    }

    // 如果删除的是默认 Provider，更新默认 Provider
    if (settings.defaultProviderId === providerId && action !== "openai") {
      const providerIds = Object.keys(newProviders);
      const newDefaultProviderId = providerIds.length > 0 ? providerIds[0] : "";
      
      await this.settingsStore.update({
        defaultProviderId: newDefaultProviderId
      });
    }

    this.logger.info("OpenRouter 迁移完成");
    return ok(undefined);
  }

  /**
   * 显示迁移提示
   */
  showMigrationPrompt(
    title: string,
    message: string,
    details?: string[]
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new MigrationPromptModal(this.app, {
        title,
        message,
        details,
        confirmText: "继续",
        cancelText: "取消",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });

      modal.open();
    });
  }

  /**
   * 获取迁移历史
   */
  getMigrationHistory() {
    return this.migrationRunner.getHistory();
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): string {
    return this.migrationRunner.getCurrentVersion();
  }
}
