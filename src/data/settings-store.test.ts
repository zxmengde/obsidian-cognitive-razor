/**
 * SettingsStore 单元测试
 */

import { SettingsStore, DEFAULT_SETTINGS } from "./settings-store";
import { FileStorage } from "./file-storage";
import { Logger } from "./logger";
import { CognitiveRazorSettings, ProviderConfig } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("SettingsStore", () => {
  let storage: FileStorage;
  let logger: Logger;
  let settingsStore: SettingsStore;
  let testDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = path.join(__dirname, "../../test-data", `settings-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // 初始化组件
    storage = new FileStorage({ dataDir: testDir });
    logger = new Logger({
      storage,
      logFilePath: "test.log",
      minLevel: "error",
    });

    settingsStore = new SettingsStore({
      storage,
      logger,
      settingsFilePath: "settings.json",
    });
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("load", () => {
    it("应该在文件不存在时创建默认设置", async () => {
      const result = await settingsStore.load();
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(DEFAULT_SETTINGS);
      }

      // 验证文件已创建
      const exists = await storage.exists("settings.json");
      expect(exists).toBe(true);
    });

    it("应该成功加载现有设置", async () => {
      // 创建设置文件
      const testSettings: CognitiveRazorSettings = {
        ...DEFAULT_SETTINGS,
        similarityThreshold: 0.85,
        maxSnapshots: 50,
      };
      await storage.writeJSON("settings.json", testSettings);

      const result = await settingsStore.load();
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.similarityThreshold).toBe(0.85);
        expect(result.value.maxSnapshots).toBe(50);
      }
    });

    it("应该合并默认设置处理新增字段", async () => {
      // 创建不完整的设置文件
      const partialSettings = {
        version: "1.0.0",
        providers: {},
        defaultProviderId: "",
      };
      await storage.writeJSON("settings.json", partialSettings);

      const result = await settingsStore.load();
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.similarityThreshold).toBe(DEFAULT_SETTINGS.similarityThreshold);
        expect(result.value.maxSnapshots).toBe(DEFAULT_SETTINGS.maxSnapshots);
      }
    });
  });

  describe("save", () => {
    it("应该成功保存设置", async () => {
      await settingsStore.load();
      
      const result = await settingsStore.save();
      expect(result.ok).toBe(true);

      // 验证文件内容
      const readResult = await storage.readJSON<CognitiveRazorSettings>("settings.json");
      expect(readResult.ok).toBe(true);
    });
  });

  describe("update", () => {
    it("应该成功更新设置", async () => {
      await settingsStore.load();

      const result = await settingsStore.update({
        similarityThreshold: 0.95,
        maxSnapshots: 200,
      });

      expect(result.ok).toBe(true);

      const settings = settingsStore.get();
      expect(settings.similarityThreshold).toBe(0.95);
      expect(settings.maxSnapshots).toBe(200);
    });

    it("应该拒绝无效的更新", async () => {
      await settingsStore.load();

      const result = await settingsStore.update({
        similarityThreshold: 1.5, // 无效值
      });

      expect(result.ok).toBe(false);
    });
  });

  describe("validate", () => {
    it("应该验证有效的设置", () => {
      const result = settingsStore.validate(DEFAULT_SETTINGS);
      expect(result.ok).toBe(true);
    });

    it("应该拒绝无效的相似度阈值", () => {
      const invalidSettings = {
        ...DEFAULT_SETTINGS,
        similarityThreshold: 1.5,
      };

      const result = settingsStore.validate(invalidSettings);
      expect(result.ok).toBe(false);
    });

    it("应该拒绝无效的最大快照数量", () => {
      const invalidSettings = {
        ...DEFAULT_SETTINGS,
        maxSnapshots: -1,
      };

      const result = settingsStore.validate(invalidSettings);
      expect(result.ok).toBe(false);
    });

    it("应该拒绝无效的并发数", () => {
      const invalidSettings = {
        ...DEFAULT_SETTINGS,
        concurrency: 0,
      };

      const result = settingsStore.validate(invalidSettings);
      expect(result.ok).toBe(false);
    });

    it("应该拒绝无效的日志级别", () => {
      const invalidSettings = {
        ...DEFAULT_SETTINGS,
        logLevel: "invalid" as any,
      };

      const result = settingsStore.validate(invalidSettings);
      expect(result.ok).toBe(false);
    });

    it("应该拒绝不存在的默认 Provider", () => {
      const invalidSettings = {
        ...DEFAULT_SETTINGS,
        defaultProviderId: "nonexistent",
      };

      const result = settingsStore.validate(invalidSettings);
      expect(result.ok).toBe(false);
    });
  });

  describe("export/import", () => {
    it("应该成功导出设置", async () => {
      await settingsStore.load();

      const result = await settingsStore.export();
      expect(result.ok).toBe(true);
      
      if (result.ok) {
        const exported = JSON.parse(result.value);
        expect(exported.version).toBe(DEFAULT_SETTINGS.version);
      }
    });

    it("应该成功导入设置", async () => {
      await settingsStore.load();

      const testSettings: CognitiveRazorSettings = {
        ...DEFAULT_SETTINGS,
        similarityThreshold: 0.88,
      };

      const json = JSON.stringify(testSettings);
      const result = await settingsStore.import(json);
      
      expect(result.ok).toBe(true);

      const settings = settingsStore.get();
      expect(settings.similarityThreshold).toBe(0.88);
    });

    it("应该拒绝无效的导入数据", async () => {
      await settingsStore.load();

      // 使用真正无效的数据（验证会失败）
      const invalidSettings = {
        ...DEFAULT_SETTINGS,
        similarityThreshold: 2.0, // 无效值
      };
      const invalidJson = JSON.stringify(invalidSettings);
      const result = await settingsStore.import(invalidJson);
      
      expect(result.ok).toBe(false);
    });
  });

  describe("reset", () => {
    it("应该重置为默认设置", async () => {
      await settingsStore.load();
      
      // 修改设置
      await settingsStore.update({ similarityThreshold: 0.5 });
      
      // 重置
      const result = await settingsStore.reset();
      expect(result.ok).toBe(true);

      const settings = settingsStore.get();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe("Provider 管理", () => {
    const testProviderConfig: ProviderConfig = {
      type: "openai",
      apiKey: "test-key",
      defaultChatModel: "gpt-4",
      defaultEmbedModel: "text-embedding-3-small",
      enabled: true,
    };

    it("应该成功添加 Provider", async () => {
      await settingsStore.load();

      const result = await settingsStore.addProvider("test-provider", testProviderConfig);
      expect(result.ok).toBe(true);

      const provider = settingsStore.getProvider("test-provider");
      expect(provider).toEqual(testProviderConfig);
    });

    it("应该拒绝添加重复的 Provider", async () => {
      await settingsStore.load();

      await settingsStore.addProvider("test-provider", testProviderConfig);
      const result = await settingsStore.addProvider("test-provider", testProviderConfig);
      
      expect(result.ok).toBe(false);
    });

    it("应该成功更新 Provider", async () => {
      await settingsStore.load();

      await settingsStore.addProvider("test-provider", testProviderConfig);
      
      const result = await settingsStore.updateProvider("test-provider", {
        apiKey: "new-key",
      });
      
      expect(result.ok).toBe(true);

      const provider = settingsStore.getProvider("test-provider");
      expect(provider?.apiKey).toBe("new-key");
    });

    it("应该成功删除 Provider", async () => {
      await settingsStore.load();

      await settingsStore.addProvider("test-provider", testProviderConfig);
      
      const result = await settingsStore.removeProvider("test-provider");
      expect(result.ok).toBe(true);

      const provider = settingsStore.getProvider("test-provider");
      expect(provider).toBeUndefined();
    });

    it("应该在添加第一个 Provider 时自动设置为默认", async () => {
      await settingsStore.load();

      await settingsStore.addProvider("test-provider", testProviderConfig);
      
      const settings = settingsStore.get();
      expect(settings.defaultProviderId).toBe("test-provider");
    });

    it("应该成功设置默认 Provider", async () => {
      await settingsStore.load();

      await settingsStore.addProvider("provider1", testProviderConfig);
      await settingsStore.addProvider("provider2", testProviderConfig);
      
      const result = await settingsStore.setDefaultProvider("provider2");
      expect(result.ok).toBe(true);

      const settings = settingsStore.get();
      expect(settings.defaultProviderId).toBe("provider2");
    });
  });

  describe("subscribe", () => {
    it("应该在设置变更时通知监听器", async () => {
      await settingsStore.load();

      let notified = false;
      const unsubscribe = settingsStore.subscribe(() => {
        notified = true;
      });

      await settingsStore.update({ similarityThreshold: 0.95 });
      
      expect(notified).toBe(true);

      unsubscribe();
    });

    it("应该支持取消订阅", async () => {
      await settingsStore.load();

      let callCount = 0;
      
      // 在订阅之后再更新
      const unsubscribe = settingsStore.subscribe(() => {
        callCount++;
      });

      await settingsStore.update({ similarityThreshold: 0.95 });
      expect(callCount).toBe(1);

      unsubscribe();

      await settingsStore.update({ similarityThreshold: 0.85 });
      expect(callCount).toBe(1); // 不应该再增加
    });
  });
});
