/**
 * VersionChecker - 版本兼容性检查器
 * 
 * 遵循设计文档 TA-07 版本兼容性检查：
 * - 版本不兼容时提示用户并提供迁移选项
 * - 不强制阻断加载
 * 
 * 遵循设计文档 O-05 开发阶段版本策略：
 * - 开发阶段允许破坏性更新
 * - 不兼容时直接重置为默认值
 * - 用户可通过导出功能备份重要配置
 */

import { ILogger, Result, ok, err } from "../types";

/**
 * 版本信息接口
 */
export interface VersionInfo {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/**
 * 兼容性检查结果
 */
export interface CompatibilityResult {
  compatible: boolean;
  currentVersion: VersionInfo;
  loadedVersion: VersionInfo;
  breakingChange: boolean;
  migrationAvailable: boolean;
  message: string;
}

/**
 * 迁移选项
 */
export type MigrationOption = 
  | "auto_migrate"    // 自动迁移（如果可行）
  | "export_reset"    // 导出当前数据后重置
  | "continue_risk"   // 继续使用（可能有风险）
  | "cancel";         // 取消加载

/**
 * VersionChecker 接口
 */
export interface IVersionChecker {
  /**
   * 检查版本兼容性
   * @param loadedVersion 加载的版本字符串
   * @returns 兼容性检查结果
   */
  checkCompatibility(loadedVersion: string): CompatibilityResult;

  /**
   * 获取当前版本
   */
  getCurrentVersion(): VersionInfo;

  /**
   * 解析版本字符串
   */
  parseVersion(versionString: string): VersionInfo | null;

  /**
   * 比较两个版本
   * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
   */
  compareVersions(a: VersionInfo, b: VersionInfo): number;

  /**
   * 检查是否需要迁移
   */
  needsMigration(loadedVersion: string): boolean;

  /**
   * 获取迁移建议
   */
  getMigrationSuggestion(result: CompatibilityResult): string;
}

/**
 * 当前插件版本
 * 应与 manifest.json 和 DEFAULT_SETTINGS.version 保持一致
 * 
 * 版本 0.9.3 说明：
 * - 预发布版本，尚未正式发布
 * - 实现核心功能和公理化设计
 */
export const CURRENT_VERSION = "0.9.3";

/**
 * 支持的最低版本（可以自动迁移）
 */
export const MIN_SUPPORTED_VERSION = "0.9.0";

/**
 * VersionChecker 实现类
 */
export class VersionChecker implements IVersionChecker {
  private logger?: ILogger;
  private currentVersion: VersionInfo;

  constructor(logger?: ILogger) {
    this.logger = logger;
    this.currentVersion = this.parseVersion(CURRENT_VERSION)!;
  }

  /**
   * 检查版本兼容性
   * 
   * 遵循设计文档 TA-07：
   * - 版本不兼容时提示用户并提供迁移选项
   * - 不强制阻断加载
   */
  checkCompatibility(loadedVersion: string): CompatibilityResult {
    const loaded = this.parseVersion(loadedVersion);
    
    // 无法解析版本
    if (!loaded) {
      this.logger?.warn("VersionChecker", `无法解析版本: ${loadedVersion}`);
      return {
        compatible: false,
        currentVersion: this.currentVersion,
        loadedVersion: { major: 0, minor: 0, patch: 0, raw: loadedVersion },
        breakingChange: true,
        migrationAvailable: false,
        message: `无法解析版本号: ${loadedVersion}，建议重置为默认设置`,
      };
    }

    // 版本相同
    if (this.compareVersions(loaded, this.currentVersion) === 0) {
      return {
        compatible: true,
        currentVersion: this.currentVersion,
        loadedVersion: loaded,
        breakingChange: false,
        migrationAvailable: false,
        message: "版本匹配",
      };
    }

    // 主版本号不同 - 破坏性变更
    if (loaded.major !== this.currentVersion.major) {
      this.logger?.warn("VersionChecker", `主版本号不匹配: ${loadedVersion} vs ${CURRENT_VERSION}`);
      return {
        compatible: false,
        currentVersion: this.currentVersion,
        loadedVersion: loaded,
        breakingChange: true,
        migrationAvailable: false,
        message: `主版本号不兼容 (${loaded.major} vs ${this.currentVersion.major})，需要重置设置`,
      };
    }

    // 次版本号不同 - 可能有新功能，但应该向后兼容
    if (loaded.minor !== this.currentVersion.minor) {
      const isUpgrade = loaded.minor < this.currentVersion.minor;
      
      if (isUpgrade) {
        // 升级：旧版本 -> 新版本，可能需要迁移
        this.logger?.info("VersionChecker", `检测到版本升级: ${loadedVersion} -> ${CURRENT_VERSION}`);
        return {
          compatible: true,
          currentVersion: this.currentVersion,
          loadedVersion: loaded,
          breakingChange: false,
          migrationAvailable: true,
          message: `版本升级 (${loadedVersion} -> ${CURRENT_VERSION})，将自动迁移设置`,
        };
      } else {
        // 降级：新版本 -> 旧版本，可能有兼容性问题
        this.logger?.warn("VersionChecker", `检测到版本降级: ${loadedVersion} -> ${CURRENT_VERSION}`);
        return {
          compatible: false,
          currentVersion: this.currentVersion,
          loadedVersion: loaded,
          breakingChange: false,
          migrationAvailable: false,
          message: `版本降级 (${loadedVersion} -> ${CURRENT_VERSION})，建议备份后重置`,
        };
      }
    }

    // 仅补丁版本不同 - 完全兼容
    return {
      compatible: true,
      currentVersion: this.currentVersion,
      loadedVersion: loaded,
      breakingChange: false,
      migrationAvailable: false,
      message: `补丁版本差异 (${loadedVersion} vs ${CURRENT_VERSION})，完全兼容`,
    };
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): VersionInfo {
    return { ...this.currentVersion };
  }

  /**
   * 解析版本字符串
   * 支持格式：x.y.z, x.y, x
   */
  parseVersion(versionString: string): VersionInfo | null {
    if (!versionString || typeof versionString !== "string") {
      return null;
    }

    // 移除可能的 'v' 前缀
    const cleaned = versionString.replace(/^v/i, "").trim();
    
    // 匹配版本号
    const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    
    if (!match) {
      return null;
    }

    return {
      major: parseInt(match[1], 10),
      minor: match[2] ? parseInt(match[2], 10) : 0,
      patch: match[3] ? parseInt(match[3], 10) : 0,
      raw: versionString,
    };
  }

  /**
   * 比较两个版本
   * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
   */
  compareVersions(a: VersionInfo, b: VersionInfo): number {
    // 比较主版本号
    if (a.major !== b.major) {
      return a.major - b.major;
    }
    
    // 比较次版本号
    if (a.minor !== b.minor) {
      return a.minor - b.minor;
    }
    
    // 比较补丁版本号
    return a.patch - b.patch;
  }

  /**
   * 检查是否需要迁移
   */
  needsMigration(loadedVersion: string): boolean {
    const result = this.checkCompatibility(loadedVersion);
    return result.migrationAvailable || result.breakingChange;
  }

  /**
   * 获取迁移建议
   */
  getMigrationSuggestion(result: CompatibilityResult): string {
    if (result.compatible && !result.migrationAvailable) {
      return "无需迁移，版本兼容";
    }

    if (result.breakingChange) {
      return `检测到破坏性变更。建议：
1. 导出当前设置作为备份
2. 重置为默认设置
3. 手动恢复需要的配置项`;
    }

    if (result.migrationAvailable) {
      return `检测到版本升级。系统将自动迁移设置，新功能将使用默认值。`;
    }

    return "建议备份当前设置后重置为默认值";
  }

  /**
   * 获取用户友好的版本描述
   */
  getVersionDescription(version: VersionInfo): string {
    return `v${version.major}.${version.minor}.${version.patch}`;
  }

  /**
   * 检查是否为开发版本
   */
  isDevelopmentVersion(version: VersionInfo): boolean {
    return version.major === 0;
  }

  /**
   * 生成版本变更日志摘要
   */
  getChangelogSummary(fromVersion: VersionInfo, toVersion: VersionInfo): string {
    const comparison = this.compareVersions(fromVersion, toVersion);
    
    if (comparison === 0) {
      return "版本相同，无变更";
    }

    if (comparison < 0) {
      // 升级
      if (fromVersion.major !== toVersion.major) {
        return `主版本升级 (${this.getVersionDescription(fromVersion)} -> ${this.getVersionDescription(toVersion)})：可能包含破坏性变更`;
      }
      if (fromVersion.minor !== toVersion.minor) {
        return `功能升级 (${this.getVersionDescription(fromVersion)} -> ${this.getVersionDescription(toVersion)})：新增功能，向后兼容`;
      }
      return `补丁升级 (${this.getVersionDescription(fromVersion)} -> ${this.getVersionDescription(toVersion)})：Bug 修复`;
    }

    // 降级
    return `版本降级 (${this.getVersionDescription(fromVersion)} -> ${this.getVersionDescription(toVersion)})：可能存在兼容性问题`;
  }
}

/**
 * 导出单例实例
 */
export const versionChecker = new VersionChecker();
