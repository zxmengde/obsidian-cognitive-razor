/**
 * MigrationRunner 组件
 * 实现版本检测、迁移脚本执行和迁移失败处理
 * 验证需求：8.1
 */

import { FileStorage } from "./file-storage";
import { Logger } from "./logger";
import { SettingsStore } from "./settings-store";
import { Result, ok, err } from "../types";

/**
 * 迁移脚本接口
 */
export interface Migration {
  /** 目标版本 */
  version: string;
  /** 迁移描述 */
  description: string;
  /** 迁移函数 */
  migrate: (context: MigrationContext) => Promise<Result<void>>;
  /** 回滚函数（可选） */
  rollback?: (context: MigrationContext) => Promise<Result<void>>;
}

/**
 * 迁移上下文
 */
export interface MigrationContext {
  /** 文件存储 */
  storage: FileStorage;
  /** 日志记录器 */
  logger: Logger;
  /** 设置存储 */
  settingsStore: SettingsStore;
  /** 当前版本 */
  currentVersion: string;
  /** 目标版本 */
  targetVersion: string;
}

/**
 * 迁移记录
 */
export interface MigrationRecord {
  /** 版本号 */
  version: string;
  /** 迁移时间 */
  migratedAt: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 迁移历史
 */
export interface MigrationHistory {
  /** 当前版本 */
  currentVersion: string;
  /** 迁移记录列表 */
  migrations: MigrationRecord[];
}

/**
 * MigrationRunner 配置
 */
export interface MigrationRunnerConfig {
  /** 文件存储 */
  storage: FileStorage;
  /** 日志记录器 */
  logger: Logger;
  /** 设置存储 */
  settingsStore: SettingsStore;
  /** 迁移历史文件路径 */
  historyFilePath: string;
  /** 迁移脚本列表 */
  migrations: Migration[];
}

/**
 * MigrationRunner 组件
 */
export class MigrationRunner {
  private storage: FileStorage;
  private logger: Logger;
  private settingsStore: SettingsStore;
  private historyFilePath: string;
  private migrations: Migration[];
  private history: MigrationHistory;

  constructor(config: MigrationRunnerConfig) {
    this.storage = config.storage;
    this.logger = config.logger;
    this.settingsStore = config.settingsStore;
    this.historyFilePath = config.historyFilePath;
    this.migrations = config.migrations;
    this.history = {
      currentVersion: "0.0.0",
      migrations: [],
    };
  }

  /**
   * 初始化迁移运行器
   */
  async initialize(): Promise<Result<void>> {
    this.logger.info("初始化迁移运行器");

    // 加载迁移历史
    const loadResult = await this.loadHistory();
    if (!loadResult.ok) {
      // 如果历史文件不存在，创建新的历史
      if (loadResult.error.code === "FILE_NOT_FOUND") {
        this.logger.info("迁移历史文件不存在，创建新历史");
        this.history = {
          currentVersion: "0.0.0",
          migrations: [],
        };
        return await this.saveHistory();
      }
      return loadResult;
    }

    return ok(undefined);
  }

  /**
   * 检查是否需要迁移
   */
  async needsMigration(targetVersion: string): Promise<boolean> {
    const currentVersion = this.history.currentVersion;
    
    // 比较版本号
    const needsMigration = this.compareVersions(currentVersion, targetVersion) < 0;
    
    this.logger.info("检查迁移需求", {
      currentVersion,
      targetVersion,
      needsMigration,
    });

    return needsMigration;
  }

  /**
   * 执行迁移
   */
  async migrate(targetVersion: string): Promise<Result<void>> {
    this.logger.info("开始迁移", {
      from: this.history.currentVersion,
      to: targetVersion,
    });

    // 检查是否需要迁移
    const needsMigration = await this.needsMigration(targetVersion);
    if (!needsMigration) {
      this.logger.info("无需迁移");
      return ok(undefined);
    }

    // 获取需要执行的迁移脚本
    const pendingMigrations = this.getPendingMigrations(targetVersion);
    if (pendingMigrations.length === 0) {
      this.logger.info("没有待执行的迁移脚本");
      
      // 直接更新版本号
      this.history.currentVersion = targetVersion;
      return await this.saveHistory();
    }

    this.logger.info(`找到 ${pendingMigrations.length} 个待执行的迁移脚本`);

    // 创建备份
    const backupResult = await this.createBackup();
    if (!backupResult.ok) {
      this.logger.error("创建备份失败", { error: backupResult.error });
      return backupResult;
    }

    // 按顺序执行迁移脚本
    for (const migration of pendingMigrations) {
      const result = await this.executeMigration(migration, targetVersion);
      if (!result.ok) {
        this.logger.error("迁移失败", {
          version: migration.version,
          error: result.error,
        });

        // 记录失败的迁移
        await this.recordMigration(migration.version, false, result.error.message);

        // 尝试回滚
        if (migration.rollback) {
          this.logger.info("尝试回滚迁移", { version: migration.version });
          const rollbackResult = await this.rollbackMigration(migration, targetVersion);
          if (!rollbackResult.ok) {
            this.logger.error("回滚失败", { error: rollbackResult.error });
          }
        }

        // 保存当前状态（停留在最后一个成功的版本）
        await this.saveHistory();

        return result;
      }

      // 记录成功的迁移并更新当前版本
      await this.recordMigration(migration.version, true);
      this.history.currentVersion = migration.version;
      await this.saveHistory();
    }

    // 更新设置中的版本号（历史版本已在循环中更新）
    await this.settingsStore.update({ version: targetVersion });

    this.logger.info("迁移完成", { version: targetVersion });
    return ok(undefined);
  }

  /**
   * 执行单个迁移脚本
   */
  private async executeMigration(
    migration: Migration,
    targetVersion: string
  ): Promise<Result<void>> {
    this.logger.info("执行迁移脚本", {
      version: migration.version,
      description: migration.description,
    });

    const context: MigrationContext = {
      storage: this.storage,
      logger: this.logger,
      settingsStore: this.settingsStore,
      currentVersion: this.history.currentVersion,
      targetVersion,
    };

    try {
      const result = await migration.migrate(context);
      if (!result.ok) {
        return result;
      }

      this.logger.info("迁移脚本执行成功", { version: migration.version });
      return ok(undefined);
    } catch (error) {
      this.logger.error("迁移脚本执行异常", {
        version: migration.version,
        error,
      });
      return err(
        "MIGRATION_ERROR",
        `迁移脚本执行失败: ${migration.version}`,
        error
      );
    }
  }

  /**
   * 回滚迁移
   */
  private async rollbackMigration(
    migration: Migration,
    targetVersion: string
  ): Promise<Result<void>> {
    if (!migration.rollback) {
      return err("NO_ROLLBACK", "迁移脚本不支持回滚");
    }

    this.logger.info("回滚迁移脚本", { version: migration.version });

    const context: MigrationContext = {
      storage: this.storage,
      logger: this.logger,
      settingsStore: this.settingsStore,
      currentVersion: this.history.currentVersion,
      targetVersion,
    };

    try {
      const result = await migration.rollback(context);
      if (!result.ok) {
        return result;
      }

      this.logger.info("迁移脚本回滚成功", { version: migration.version });
      return ok(undefined);
    } catch (error) {
      this.logger.error("迁移脚本回滚异常", {
        version: migration.version,
        error,
      });
      return err(
        "ROLLBACK_ERROR",
        `迁移脚本回滚失败: ${migration.version}`,
        error
      );
    }
  }

  /**
   * 获取待执行的迁移脚本
   */
  private getPendingMigrations(targetVersion: string): Migration[] {
    const currentVersion = this.history.currentVersion;

    // 过滤出需要执行的迁移脚本
    const pending = this.migrations.filter(migration => {
      // 迁移版本必须大于当前版本且小于等于目标版本
      return (
        this.compareVersions(migration.version, currentVersion) > 0 &&
        this.compareVersions(migration.version, targetVersion) <= 0
      );
    });

    // 按版本号排序
    pending.sort((a, b) => this.compareVersions(a.version, b.version));

    return pending;
  }

  /**
   * 比较版本号
   * 返回值：-1 表示 v1 < v2，0 表示 v1 = v2，1 表示 v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }

    return 0;
  }

  /**
   * 记录迁移
   */
  private async recordMigration(
    version: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const record: MigrationRecord = {
      version,
      migratedAt: new Date().toISOString(),
      success,
      error,
    };

    this.history.migrations.push(record);
    await this.saveHistory();
  }

  /**
   * 创建备份
   */
  private async createBackup(): Promise<Result<void>> {
    this.logger.info("创建迁移备份");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = `backups/migration-${timestamp}`;

    try {
      // 创建备份目录
      const ensureDirResult = await this.storage.ensureDir(backupDir);
      if (!ensureDirResult.ok) {
        return ensureDirResult;
      }

      // 备份设置文件
      const settingsExists = await this.storage.exists("settings.json");
      if (settingsExists) {
        const copyResult = await this.storage.copyFile(
          "settings.json",
          `${backupDir}/settings.json`
        );
        if (!copyResult.ok) {
          return copyResult;
        }
      }

      // 备份迁移历史
      const historyExists = await this.storage.exists(this.historyFilePath);
      if (historyExists) {
        const copyResult = await this.storage.copyFile(
          this.historyFilePath,
          `${backupDir}/migration-history.json`
        );
        if (!copyResult.ok) {
          return copyResult;
        }
      }

      this.logger.info("备份创建成功", { backupDir });
      return ok(undefined);
    } catch (error) {
      this.logger.error("创建备份失败", { error });
      return err("BACKUP_ERROR", "创建备份失败", error);
    }
  }

  /**
   * 加载迁移历史
   */
  private async loadHistory(): Promise<Result<void>> {
    const readResult = await this.storage.readJSON<MigrationHistory>(
      this.historyFilePath
    );
    if (!readResult.ok) {
      return readResult;
    }

    this.history = readResult.value;
    return ok(undefined);
  }

  /**
   * 保存迁移历史
   */
  private async saveHistory(): Promise<Result<void>> {
    return await this.storage.writeJSON(this.historyFilePath, this.history);
  }

  /**
   * 获取迁移历史
   */
  getHistory(): MigrationHistory {
    return { ...this.history };
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): string {
    return this.history.currentVersion;
  }

  /**
   * 获取迁移记录
   */
  getMigrationRecords(): MigrationRecord[] {
    return [...this.history.migrations];
  }
}
