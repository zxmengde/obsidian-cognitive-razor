/**
 * CruidCache - cruid → TFile 的单一事实来源缓存（SSOT）
 *
 * 目标：
 * - 启动时扫描所有 Markdown 文件，建立 cruid 映射
 * - 监听 metadataCache/vault 事件，增量维护缓存
 * - 运行时通过 cruid 动态解析 name/path，避免在索引中冗余存储
 */

import { App, EventRef, TFile } from "obsidian";
import type { ILogger } from "../types";
import { extractFrontmatter } from "./frontmatter-utils";

type CruidCacheOptions = {
  /** 解析 frontmatter 失败时是否回退到读取文件内容 */
  fallbackToRead?: boolean;
};

export class CruidCache {
  private app: App;
  private logger?: ILogger;
  private cruidToFile = new Map<string, TFile>();
  private pathToCruid = new Map<string, string>();
  private eventRefs: Array<{ target: "metadata" | "vault"; ref: EventRef }> = [];
  private deleteListeners: Array<(event: { cruid: string; path: string }) => void> = [];
  private started = false;

  constructor(app: App, logger?: ILogger) {
    this.app = app;
    this.logger = logger;
  }

  /**
   * 启动缓存：注册事件监听器并触发一次全量构建
   */
  start(options: CruidCacheOptions = {}): void {
    if (this.started) {
      return;
    }
    this.started = true;

    // metadataCache 变更：frontmatter 修改、新文件解析完成等
    this.eventRefs.push({
      target: "metadata",
      ref: this.app.metadataCache.on("changed", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }
        void this.upsertFromFile(file, options);
      }),
    });

    // 文件删除：清理缓存
    this.eventRefs.push({
      target: "vault",
      ref: this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }
        this.removeByFile(file);
      }),
    });

    // 文件重命名/移动：更新 pathToCruid（同一 TFile 对象 path 会变化）
    this.eventRefs.push({
      target: "vault",
      ref: this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }
        const known = this.pathToCruid.get(oldPath);
        if (known) {
          this.pathToCruid.delete(oldPath);
          this.pathToCruid.set(file.path, known);
          this.cruidToFile.set(known, file);
          return;
        }

        // 若旧路径不存在映射，尝试从 metadataCache 补全
        void this.upsertFromFile(file, options);
      }),
    });

    // 异步构建（不阻塞插件启动）
    void this.buildCache(options);
  }

  /**
   * 停止缓存：取消事件监听
   */
  dispose(): void {
    for (const item of this.eventRefs) {
      if (item.target === "metadata") {
        this.app.metadataCache.offref(item.ref);
      } else {
        this.app.vault.offref(item.ref);
      }
    }
    this.eventRefs = [];
    this.deleteListeners = [];
    this.started = false;
  }

  /**
   * 启动时扫描所有 Markdown 文件构建缓存
   */
  async buildCache(options: CruidCacheOptions = {}): Promise<void> {
    this.cruidToFile.clear();
    this.pathToCruid.clear();

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      // 顺序扫描：避免对大型 Vault 造成过高瞬时 IO 压力
      // 若需要优化，可在未来引入小并发池
      // eslint-disable-next-line no-await-in-loop
      await this.upsertFromFile(file, options);
    }

    this.logger?.info("CruidCache", "CruidCache 构建完成", {
      totalMarkdownFiles: files.length,
      cachedCruids: this.cruidToFile.size,
    });
  }

  /**
   * 通过 cruid 获取文件
   */
  getFile(cruid: string): TFile | null {
    return this.cruidToFile.get(cruid) ?? null;
  }

  /**
   * 通过 cruid 获取路径
   */
  getPath(cruid: string): string | null {
    const file = this.getFile(cruid);
    return file ? file.path : null;
  }

  /**
   * 通过 cruid 获取名称（使用文件名，确保与重命名保持一致）
   */
  getName(cruid: string): string | null {
    const file = this.getFile(cruid);
    return file ? file.basename : null;
  }

  /**
   * 通过 path 获取 cruid（用于清理/诊断）
   */
  getCruidByPath(path: string): string | null {
    return this.pathToCruid.get(path) ?? null;
  }

  has(cruid: string): boolean {
    return this.cruidToFile.has(cruid);
  }

  /**
   * 订阅删除事件（用于清理向量索引/重复对等关联数据）
   */
  onDelete(listener: (event: { cruid: string; path: string }) => void): () => void {
    this.deleteListeners.push(listener);
    return () => {
      const idx = this.deleteListeners.indexOf(listener);
      if (idx >= 0) {
        this.deleteListeners.splice(idx, 1);
      }
    };
  }

  private removeByFile(file: TFile): void {
    const cruid = this.pathToCruid.get(file.path);
    if (!cruid) {
      return;
    }

    for (const listener of this.deleteListeners) {
      try {
        listener({ cruid, path: file.path });
      } catch (error) {
        this.logger?.warn("CruidCache", "删除事件监听器执行失败", {
          cruid,
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.pathToCruid.delete(file.path);

    const existing = this.cruidToFile.get(cruid);
    if (existing && existing.path === file.path) {
      this.cruidToFile.delete(cruid);
    }

    this.logger?.info("CruidCache", "已移除已删除文件的 cruid 映射", {
      cruid,
      path: file.path,
    });
  }

  private async upsertFromFile(file: TFile, options: CruidCacheOptions): Promise<void> {
    const cruid =
      this.getCruidFromMetadata(file) ??
      (options.fallbackToRead ? await this.getCruidFromFileContent(file) : null);

    if (!cruid) {
      return;
    }

    const previousCruid = this.pathToCruid.get(file.path);
    if (previousCruid && previousCruid !== cruid) {
      const mapped = this.cruidToFile.get(previousCruid);
      if (mapped && mapped.path === file.path) {
        this.cruidToFile.delete(previousCruid);
      }
    }

    const existingFile = this.cruidToFile.get(cruid);
    if (existingFile && existingFile.path !== file.path) {
      this.logger?.warn("CruidCache", "检测到重复 cruid，已用最新文件覆盖", {
        cruid,
        previousPath: existingFile.path,
        newPath: file.path,
      });
    }

    this.cruidToFile.set(cruid, file);
    this.pathToCruid.set(file.path, cruid);
  }

  private getCruidFromMetadata(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) {
      return null;
    }

    const raw = typeof fm.cruid === "string" ? fm.cruid : typeof (fm as any).crUid === "string" ? (fm as any).crUid : null;
    if (!raw) {
      return null;
    }
    return raw.trim() || null;
  }

  private async getCruidFromFileContent(file: TFile): Promise<string | null> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const extracted = extractFrontmatter(content);
      const cruid = extracted?.frontmatter?.cruid;
      return cruid ? cruid.trim() : null;
    } catch (error) {
      this.logger?.warn("CruidCache", "读取文件内容解析 cruid 失败", {
        path: file.path,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
