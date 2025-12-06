/**
 * 配置迁移测试
 * 
 * 注意：由于测试环境的文件系统隔离问题，这里只测试核心逻辑
 */

import { migrationV2 } from "./migrations";
import { FileStorage } from "./file-storage";
import { Logger } from "./logger";
import { SettingsStore } from "./settings-store";
import { MigrationContext } from "./migration-runner";
import { ProviderConfig } from "../types";

describe("migrationV2", () => {
  test("应该为现有 Provider 添加默认 baseUrl", async () => {
    // 创建独立的测试环境
    const testDir = `test-data/migrations-add-baseurl-${Date.now()}`;
    const storage = new FileStorage({ dataDir: testDir });
    const logger = new Logger({
      storage,
      logFilePath: "test.log",
      minLevel: "error",
      maxSize: 1024 * 1024,
    });
    
    const settingsStore = new SettingsStore({
      storage,
      logger,
      settingsFilePath: "settings.json",
    });

    await settingsStore.load();

    // 准备：添加没有 baseUrl 的 Provider
    await settingsStore.addProvider("test-openai", {
      type: "openai",
      apiKey: "test-key",
      defaultChatModel: "gpt-4",
      defaultEmbedModel: "text-embedding-3-small",
      enabled: true,
    } as ProviderConfig);

    const context: MigrationContext = {
      storage,
      logger,
      settingsStore,
      currentVersion: "1.0.0",
      targetVersion: "2.0.0",
    };

    // 执行迁移
    const result = await migrationV2.migrate(context);

    // 验证
    expect(result.ok).toBe(true);

    const settings = settingsStore.get();
    const provider = settings.providers["test-openai"];
    
    expect(provider).toBeDefined();
    expect(provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  test("应该检测 OpenRouter 配置并返回需要用户输入的错误", async () => {
    // 创建独立的测试环境
    const testDir = `test-data/migrations-openrouter-${Date.now()}`;
    const storage = new FileStorage({ dataDir: testDir });
    const logger = new Logger({
      storage,
      logFilePath: "test.log",
      minLevel: "error",
      maxSize: 1024 * 1024,
    });
    
    const settingsStore = new SettingsStore({
      storage,
      logger,
      settingsFilePath: "settings.json",
    });

    await settingsStore.load();

    // 准备：直接修改内部状态来模拟 OpenRouter 配置
    const settings = settingsStore.get();
    (settings.providers as any)["test-openrouter"] = {
      type: "openrouter",
      apiKey: "test-key",
      defaultChatModel: "gpt-4",
      defaultEmbedModel: "text-embedding-3-small",
      enabled: true,
    };

    const context: MigrationContext = {
      storage,
      logger,
      settingsStore,
      currentVersion: "1.0.0",
      targetVersion: "2.0.0",
    };

    // 执行迁移
    const result = await migrationV2.migrate(context);

    // 验证
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("MIGRATION_REQUIRES_USER_INPUT");
    }
  });
});
