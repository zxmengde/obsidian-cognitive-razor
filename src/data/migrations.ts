/**
 * 配置迁移脚本
 * 
 * 实现从旧版本到新版本的配置迁移
 */

import { Migration, MigrationContext } from "./migration-runner";
import { ok, err, ProviderConfig, ProviderType } from "../types";
import { DEFAULT_ENDPOINTS } from "../core/provider-manager";

/**
 * 迁移到 V2：移除 OpenRouter，添加自定义端点支持
 */
export const migrationV2: Migration = {
  version: "2.0.0",
  description: "移除 OpenRouter Provider，添加自定义端点支持",

  migrate: async (context: MigrationContext) => {
    context.logger.info("执行迁移 V2：移除 OpenRouter，添加自定义端点支持");

    // 获取当前设置
    const settings = context.settingsStore.get();
    
    // 检查是否有 OpenRouter 配置
    const hasOpenRouter = Object.entries(settings.providers).some(
      ([_, config]) => (config as any).type === "openrouter"
    );

    if (hasOpenRouter) {
      context.logger.info("检测到 OpenRouter 配置，需要用户干预");
      // 返回特殊错误码，表示需要用户干预
      return err(
        "MIGRATION_REQUIRES_USER_INPUT",
        "检测到 OpenRouter 配置，需要用户选择迁移方式",
        { hasOpenRouter: true }
      );
    }

    // 为现有 Provider 添加默认 baseUrl（如果没有）
    let updated = false;
    const newProviders: Record<string, ProviderConfig> = {};

    for (const [id, config] of Object.entries(settings.providers)) {
      const providerConfig = config as ProviderConfig;
      
      // 验证 Provider 类型是否有效
      const validTypes: ProviderType[] = ["google", "openai"];
      if (!validTypes.includes(providerConfig.type)) {
        context.logger.warn(`跳过不支持的 Provider 类型: ${providerConfig.type}`, { id });
        // 跳过不支持的类型，不添加到 newProviders
        continue;
      }

      // 添加默认 baseUrl（如果没有）
      if (!providerConfig.baseUrl) {
        newProviders[id] = {
          ...providerConfig,
          baseUrl: DEFAULT_ENDPOINTS[providerConfig.type]
        };
        updated = true;
        context.logger.info(`为 Provider ${id} 添加默认端点`, {
          type: providerConfig.type,
          baseUrl: DEFAULT_ENDPOINTS[providerConfig.type]
        });
      } else {
        newProviders[id] = providerConfig;
      }
    }

    // 总是更新设置（包括 providers 和版本号）
    const updateResult = await context.settingsStore.update({
      providers: newProviders,
      version: "2.0.0"
    });

    if (!updateResult.ok) {
      context.logger.error("更新设置失败", { error: updateResult.error });
      return updateResult;
    }

    context.logger.info("设置更新成功");

    context.logger.info("迁移 V2 完成");
    return ok(undefined);
  },

  rollback: async (context: MigrationContext) => {
    context.logger.info("回滚迁移 V2");

    // 获取当前设置
    const settings = context.settingsStore.get();

    // 移除 baseUrl 字段
    const newProviders: Record<string, ProviderConfig> = {};
    for (const [id, config] of Object.entries(settings.providers)) {
      const { baseUrl, ...rest } = config;
      newProviders[id] = rest as ProviderConfig;
    }

    // 更新设置
    const updateResult = await context.settingsStore.update({
      providers: newProviders,
      version: "1.0.0"
    });

    if (!updateResult.ok) {
      context.logger.error("回滚失败", { error: updateResult.error });
      return updateResult;
    }

    context.logger.info("迁移 V2 回滚完成");
    return ok(undefined);
  }
};

/**
 * 所有迁移脚本列表
 */
export const ALL_MIGRATIONS: Migration[] = [
  migrationV2
];
