/**
 * 迁移脚本示例
 * 展示如何定义和使用迁移脚本
 */

import { Migration, MigrationContext } from "./migration-runner";
import { ok, err } from "../types";

/**
 * 示例迁移 1：从 0.0.0 到 1.0.0
 * 添加新的配置字段
 */
export const migration_1_0_0: Migration = {
  version: "1.0.0",
  description: "添加新的配置字段",
  
  migrate: async (context: MigrationContext) => {
    context.logger.info("执行迁移 1.0.0");

    // 获取当前设置
    const settings = context.settingsStore.get();

    // 添加新字段（如果不存在）
    if (settings.advancedMode === undefined) {
      const updateResult = await context.settingsStore.update({
        advancedMode: false,
      });

      if (!updateResult.ok) {
        return updateResult;
      }
    }

    context.logger.info("迁移 1.0.0 完成");
    return ok(undefined);
  },

  rollback: async (context: MigrationContext) => {
    context.logger.info("回滚迁移 1.0.0");
    
    // 回滚操作：移除添加的字段
    // 注意：实际上我们不能真正"移除"字段，只能恢复到默认值
    
    context.logger.info("回滚 1.0.0 完成");
    return ok(undefined);
  },
};

/**
 * 示例迁移 2：从 1.0.0 到 1.1.0
 * 重命名配置文件
 */
export const migration_1_1_0: Migration = {
  version: "1.1.0",
  description: "重命名配置文件",
  
  migrate: async (context: MigrationContext) => {
    context.logger.info("执行迁移 1.1.0");

    // 检查旧文件是否存在
    const oldFilePath = "old-settings.json";
    const newFilePath = "settings.json";

    const exists = await context.storage.exists(oldFilePath);
    if (exists) {
      // 移动文件
      const moveResult = await context.storage.moveFile(oldFilePath, newFilePath);
      if (!moveResult.ok) {
        return moveResult;
      }
      
      context.logger.info("配置文件已重命名");
    }

    context.logger.info("迁移 1.1.0 完成");
    return ok(undefined);
  },

  rollback: async (context: MigrationContext) => {
    context.logger.info("回滚迁移 1.1.0");
    
    // 回滚操作：将文件名改回去
    const oldFilePath = "old-settings.json";
    const newFilePath = "settings.json";

    const exists = await context.storage.exists(newFilePath);
    if (exists) {
      const moveResult = await context.storage.moveFile(newFilePath, oldFilePath);
      if (!moveResult.ok) {
        return moveResult;
      }
    }

    context.logger.info("回滚 1.1.0 完成");
    return ok(undefined);
  },
};

/**
 * 示例迁移 3：从 1.1.0 到 2.0.0
 * 数据结构变更
 */
export const migration_2_0_0: Migration = {
  version: "2.0.0",
  description: "数据结构变更",
  
  migrate: async (context: MigrationContext) => {
    context.logger.info("执行迁移 2.0.0");

    // 读取向量索引
    const vectorIndexPath = "vector-index.json";
    const exists = await context.storage.exists(vectorIndexPath);
    
    if (exists) {
      const readResult = await context.storage.readJSON<any>(vectorIndexPath);
      if (!readResult.ok) {
        return readResult;
      }

      const oldData = readResult.value;

      // 转换数据结构
      // 假设我们要添加一个新字段到每个条目
      const newData = {
        ...oldData,
        entries: oldData.entries?.map((entry: any) => ({
          ...entry,
          version: "2.0.0", // 添加版本字段
        })) || [],
      };

      // 写回文件
      const writeResult = await context.storage.writeJSON(vectorIndexPath, newData);
      if (!writeResult.ok) {
        return writeResult;
      }

      context.logger.info("向量索引数据结构已更新");
    }

    context.logger.info("迁移 2.0.0 完成");
    return ok(undefined);
  },

  rollback: async (context: MigrationContext) => {
    context.logger.info("回滚迁移 2.0.0");
    
    // 回滚操作：移除添加的字段
    const vectorIndexPath = "vector-index.json";
    const exists = await context.storage.exists(vectorIndexPath);
    
    if (exists) {
      const readResult = await context.storage.readJSON<any>(vectorIndexPath);
      if (!readResult.ok) {
        return readResult;
      }

      const newData = readResult.value;

      // 移除版本字段
      const oldData = {
        ...newData,
        entries: newData.entries?.map((entry: any) => {
          const { version, ...rest } = entry;
          return rest;
        }) || [],
      };

      const writeResult = await context.storage.writeJSON(vectorIndexPath, oldData);
      if (!writeResult.ok) {
        return writeResult;
      }
    }

    context.logger.info("回滚 2.0.0 完成");
    return ok(undefined);
  },
};

/**
 * 所有迁移脚本列表
 * 按版本号排序
 */
export const ALL_MIGRATIONS: Migration[] = [
  migration_1_0_0,
  migration_1_1_0,
  migration_2_0_0,
];

/**
 * 使用示例
 */
export async function exampleUsage() {
  // 这是一个示例，展示如何在实际代码中使用 MigrationRunner
  
  /*
  import { MigrationRunner } from "./migration-runner";
  import { FileStorage } from "./file-storage";
  import { Logger } from "./logger";
  import { SettingsStore } from "./settings-store";
  import { ALL_MIGRATIONS } from "./migrations.example";

  // 初始化组件
  const storage = new FileStorage({ dataDir: "/path/to/data" });
  const logger = new Logger({
    storage,
    logFilePath: "app.log",
    minLevel: "info",
  });
  const settingsStore = new SettingsStore({
    storage,
    logger,
    settingsFilePath: "settings.json",
  });

  // 创建迁移运行器
  const migrationRunner = new MigrationRunner({
    storage,
    logger,
    settingsStore,
    historyFilePath: "migration-history.json",
    migrations: ALL_MIGRATIONS,
  });

  // 初始化
  await migrationRunner.initialize();

  // 检查是否需要迁移
  const targetVersion = "2.0.0";
  const needsMigration = await migrationRunner.needsMigration(targetVersion);

  if (needsMigration) {
    console.log("需要迁移，开始执行...");
    
    // 执行迁移
    const result = await migrationRunner.migrate(targetVersion);
    
    if (result.ok) {
      console.log("迁移成功完成");
    } else {
      console.error("迁移失败:", result.error);
    }
  } else {
    console.log("无需迁移");
  }

  // 查看迁移历史
  const history = migrationRunner.getHistory();
  console.log("当前版本:", history.currentVersion);
  console.log("迁移记录:", history.migrations);
  */
}
