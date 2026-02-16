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

/** CruidCache 最大容量（防止内存无限增长，需求 24.3） */
const MAX_CRUID_CACHE_SIZE = 10_000;

type CruidCacheOptions = {
  /** 解析 frontmatter 失败时是否回退到读取文件内容 */
  fallbackToRead?: boolean;
};

/**
 * registerEvent 回调类型
 * 由 Plugin 层注入，确保事件监听器随插件卸载自动清理
 */
export type RegisterEventFn = (eventRef: EventRef) => void;

export class CruidCache {
  private app: App;
  private logger?: ILogger;
  private cruidToFile = new Map<string, TFile>();
  private pathToCruid = new Map<string, string>();
  private eventRefs: Array<{ target: "metadata" | "vault"; ref: EventRef }> = [];
  private deleteListeners: Array<(event: { cruid: string; path: string }) => void> = [];
  private started = false;
  private registerEventFn: RegisterEventFn | null;

  constructor(app: App, logger?: ILogger, registerEventFn?: RegisterEventFn) {
    this.app = app;
    this.logger = logger;
    this.registerEventFn = registerEventFn ?? null;
  }

  /**
   * 启动缓存：注册事件监听器并触发一次全量构建
   * 优先使用 registerEventFn（Obsidian 自动清理），否则回退到手动 offref
   */
  start(options: CruidCacheOptions = {}): void {
    if (this.started) {
      return;
    }
    this.started = true;

    // metadataCache 变更：frontmatter 修改、新文件解析完成等
    const metaRef = this.app.metadataCache.on("changed", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      void this.upsertFromFile(file, options);
    });
    this.registerOrTrackEvent("metadata", metaRef);

    // 文件删除：清理缓存
    const deleteRef = this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      this.removeByFile(file);
    });
    this.registerOrTrackEvent("vault", deleteRef);

    // 文件重命名/移动：更新 pathToCruid（同一 TFile 对象 path 会变化）
    const renameRef = this.app.vault.on("rename", (file, oldPath) => {
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
    });
    this.registerOrTrackEvent("vault", renameRef);

    // 异步构建（不阻塞插件启动）
    void this.buildCache(options);
  }

  /**
   * 注册事件：优先通过 Plugin.registerEvent() 注册（自动清理），
   * 否则回退到手动追踪 + dispose() 清理
   */
  private registerOrTrackEvent(target: "metadata" | "vault", ref: EventRef): void {
    if (this.registerEventFn) {
      this.registerEventFn(ref);
    } else {
      this.eventRefs.push({ target, ref });
    }
  }

  /**
   * 停止缓存：取消事件监听
   * 若事件通过 registerEventFn 注册，则由 Plugin 自动清理，此处仅清理手动追踪的事件
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
   * 使用分块处理，块之间让出事件循环，避免阻塞 UI
   */
  async buildCache(options: CruidCacheOptions = {}): Promise<void> {
    this.cruidToFile.clear();
    this.pathToCruid.clear();

    const files = this.app.vault.getMarkdownFiles();
    const CHUNK_SIZE = 100; // 每块处理 100 个文件

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      for (const file of chunk) {
        // eslint-disable-next-line no-await-in-loop
        await this.upsertFromFile(file, options);
      }
      // 块之间让出事件循环，避免阻塞 UI
      if (i + CHUNK_SIZE < files.length) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
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

    // 容量检查：超出上限时驱逐最早插入的条目（需求 24.3）
    if (!this.cruidToFile.has(cruid) && this.cruidToFile.size >= MAX_CRUID_CACHE_SIZE) {
      this.evictOldest();
    }

    this.cruidToFile.set(cruid, file);
    this.pathToCruid.set(file.path, cruid);
  }

  /**
   * 驱逐最早插入的缓存条目（Map 迭代顺序 = 插入顺序）
   * 当缓存超出 MAX_CRUID_CACHE_SIZE 时调用（需求 24.3）
   */
  private evictOldest(): void {
    const firstKey = this.cruidToFile.keys().next().value;
    if (firstKey === undefined) return;

    const file = this.cruidToFile.get(firstKey);
    this.cruidToFile.delete(firstKey);
    if (file) {
      this.pathToCruid.delete(file.path);
    }
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
