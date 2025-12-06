/**
 * MigrationRunner 单元测试
 */

import { MigrationRunner, Migration, MigrationContext } from "./migration-runner";
import { FileStorage } from "./file-storage";
import { Logger } from "./logger";
import { SettingsStore } from "./settings-store";
import { ok, err } from "../types";
import * as fs from "fs";
import * as path from "path";

describe("MigrationRunner", () => {
  let storage: FileStorage;
  let logger: Logger;
  let settingsStore: SettingsStore;
  let migrationRunner: MigrationRunner;
  let testDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = path.join(__dirname, "../../test-data", `migration-test-${Date.now()}`);
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

    await settingsStore.load();
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("initialize", () => {
    it("应该成功初始化并创建历史文件", async () => {
      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [],
      });

      const result = await migrationRunner.initialize();
      expect(result.ok).toBe(true);

      // 验证历史文件已创建
      const exists = await storage.exists("migration-history.json");
      expect(exists).toBe(true);
    });

    it("应该加载现有的历史文件", async () => {
      // 创建历史文件
      const history = {
        currentVersion: "1.0.0",
        migrations: [],
      };
      await storage.writeJSON("migration-history.json", history);

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [],
      });

      const result = await migrationRunner.initialize();
      expect(result.ok).toBe(true);

      const currentVersion = migrationRunner.getCurrentVersion();
      expect(currentVersion).toBe("1.0.0");
    });
  });

  describe("needsMigration", () => {
    beforeEach(async () => {
      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [],
      });
      await migrationRunner.initialize();
    });

    it("应该检测到需要迁移", async () => {
      const needsMigration = await migrationRunner.needsMigration("1.0.0");
      expect(needsMigration).toBe(true);
    });

    it("应该检测到不需要迁移", async () => {
      // 先迁移到 1.0.0
      await migrationRunner.migrate("1.0.0");

      const needsMigration = await migrationRunner.needsMigration("1.0.0");
      expect(needsMigration).toBe(false);
    });
  });

  describe("migrate", () => {
    it("应该成功执行迁移脚本", async () => {
      let migrationExecuted = false;

      const testMigration: Migration = {
        version: "1.0.0",
        description: "测试迁移",
        migrate: async (context: MigrationContext) => {
          migrationExecuted = true;
          return ok(undefined);
        },
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [testMigration],
      });

      await migrationRunner.initialize();

      const result = await migrationRunner.migrate("1.0.0");
      expect(result.ok).toBe(true);
      expect(migrationExecuted).toBe(true);

      const currentVersion = migrationRunner.getCurrentVersion();
      expect(currentVersion).toBe("1.0.0");
    });

    it("应该按顺序执行多个迁移脚本", async () => {
      const executionOrder: string[] = [];

      const migration1: Migration = {
        version: "1.0.0",
        description: "迁移 1",
        migrate: async () => {
          executionOrder.push("1.0.0");
          return ok(undefined);
        },
      };

      const migration2: Migration = {
        version: "1.1.0",
        description: "迁移 2",
        migrate: async () => {
          executionOrder.push("1.1.0");
          return ok(undefined);
        },
      };

      const migration3: Migration = {
        version: "2.0.0",
        description: "迁移 3",
        migrate: async () => {
          executionOrder.push("2.0.0");
          return ok(undefined);
        },
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [migration3, migration1, migration2], // 乱序
      });

      await migrationRunner.initialize();

      const result = await migrationRunner.migrate("2.0.0");
      expect(result.ok).toBe(true);
      expect(executionOrder).toEqual(["1.0.0", "1.1.0", "2.0.0"]);
    });

    it("应该跳过已执行的迁移脚本", async () => {
      const executionOrder: string[] = [];

      const migration1: Migration = {
        version: "1.0.0",
        description: "迁移 1",
        migrate: async () => {
          executionOrder.push("1.0.0");
          return ok(undefined);
        },
      };

      const migration2: Migration = {
        version: "2.0.0",
        description: "迁移 2",
        migrate: async () => {
          executionOrder.push("2.0.0");
          return ok(undefined);
        },
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [migration1, migration2],
      });

      await migrationRunner.initialize();

      // 先迁移到 1.0.0
      await migrationRunner.migrate("1.0.0");
      expect(executionOrder).toEqual(["1.0.0"]);

      // 再迁移到 2.0.0，应该只执行 migration2
      await migrationRunner.migrate("2.0.0");
      expect(executionOrder).toEqual(["1.0.0", "2.0.0"]);
    });

    it("应该在迁移失败时停止", async () => {
      const executionOrder: string[] = [];

      const migration1: Migration = {
        version: "1.0.0",
        description: "迁移 1",
        migrate: async () => {
          executionOrder.push("1.0.0");
          return ok(undefined);
        },
      };

      const migration2: Migration = {
        version: "2.0.0",
        description: "迁移 2（失败）",
        migrate: async () => {
          executionOrder.push("2.0.0");
          return err("TEST_ERROR", "测试错误");
        },
      };

      const migration3: Migration = {
        version: "3.0.0",
        description: "迁移 3",
        migrate: async () => {
          executionOrder.push("3.0.0");
          return ok(undefined);
        },
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [migration1, migration2, migration3],
      });

      await migrationRunner.initialize();

      const result = await migrationRunner.migrate("3.0.0");
      expect(result.ok).toBe(false);
      
      // 应该只执行到 migration2
      expect(executionOrder).toEqual(["1.0.0", "2.0.0"]);

      // 当前版本应该停留在 1.0.0
      const currentVersion = migrationRunner.getCurrentVersion();
      expect(currentVersion).toBe("1.0.0");
    });

    it("应该在迁移失败时尝试回滚", async () => {
      let rollbackExecuted = false;

      const testMigration: Migration = {
        version: "1.0.0",
        description: "测试迁移（失败）",
        migrate: async () => {
          return err("TEST_ERROR", "测试错误");
        },
        rollback: async () => {
          rollbackExecuted = true;
          return ok(undefined);
        },
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [testMigration],
      });

      await migrationRunner.initialize();

      const result = await migrationRunner.migrate("1.0.0");
      expect(result.ok).toBe(false);
      expect(rollbackExecuted).toBe(true);
    });

    it("应该创建备份", async () => {
      const testMigration: Migration = {
        version: "1.0.0",
        description: "测试迁移",
        migrate: async () => ok(undefined),
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [testMigration],
      });

      await migrationRunner.initialize();

      const result = await migrationRunner.migrate("1.0.0");
      expect(result.ok).toBe(true);

      // 验证备份目录已创建
      const listResult = await storage.listFiles("backups");
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.length).toBeGreaterThan(0);
      }
    });

    it("应该更新设置中的版本号", async () => {
      const testMigration: Migration = {
        version: "1.0.0",
        description: "测试迁移",
        migrate: async () => ok(undefined),
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [testMigration],
      });

      await migrationRunner.initialize();

      await migrationRunner.migrate("1.0.0");

      const settings = settingsStore.get();
      expect(settings.version).toBe("1.0.0");
    });
  });

  describe("getHistory", () => {
    it("应该返回迁移历史", async () => {
      const testMigration: Migration = {
        version: "1.0.0",
        description: "测试迁移",
        migrate: async () => ok(undefined),
      };

      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [testMigration],
      });

      await migrationRunner.initialize();
      await migrationRunner.migrate("1.0.0");

      const history = migrationRunner.getHistory();
      expect(history.currentVersion).toBe("1.0.0");
      expect(history.migrations.length).toBe(1);
      expect(history.migrations[0].version).toBe("1.0.0");
      expect(history.migrations[0].success).toBe(true);
    });
  });

  describe("版本比较", () => {
    it("应该正确比较版本号", async () => {
      migrationRunner = new MigrationRunner({
        storage,
        logger,
        settingsStore,
        historyFilePath: "migration-history.json",
        migrations: [],
      });

      await migrationRunner.initialize();

      // 测试不同的版本号
      expect(await migrationRunner.needsMigration("0.0.1")).toBe(true);
      expect(await migrationRunner.needsMigration("0.1.0")).toBe(true);
      expect(await migrationRunner.needsMigration("1.0.0")).toBe(true);

      // 迁移到 1.0.0
      await migrationRunner.migrate("1.0.0");

      expect(await migrationRunner.needsMigration("1.0.0")).toBe(false);
      expect(await migrationRunner.needsMigration("1.0.1")).toBe(true);
      expect(await migrationRunner.needsMigration("1.1.0")).toBe(true);
      expect(await migrationRunner.needsMigration("2.0.0")).toBe(true);
    });
  });
});
