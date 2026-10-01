/**
 * CruidCache - cruid → TFile 的单一事实来源缓存（SSOT）
 *
 * 目标：
 * - 启动时扫描所有 Markdown 文件，建立 cruid 映射
 * - 监听 metadataCache/vault 事件，增量维护缓存
 * - 运行时通过 cruid 动态解析 name/path，避免在索引中冗余存储
 */

import { App, TFile } from "obsidian";
import type { EventRef } from "obsidian";
import type { ILogger } from "../types";

export interface CruidCacheEntry {
  cruid: string;
  path: string;
  file: TFile;
}

export class CruidCache {
  private app: App;
  private logger?: ILogger;
  private cruidToFile = new Map<string, TFile>();
  private pathToCruid = new Map<string, string>();
  private eventRefs: Array<{ target: "metadata" | "vault"; ref: EventRef }> = [];
  private deleteListeners: Array<(event: { cruid: string; path: string }) => void> = [];
  private started = false;
  private generation = 0;
  private buildPromise: Promise<void> | undefined;

  constructor(app: App, logger?: ILogger) {
    this.app = app;
    this.logger = logger;
  }

  /**
   * 启动缓存：注册事件监听器并触发一次全量构建
   * 事件监听器由缓存自身拥有，并在 dispose() 中成对释放。
   */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const generation = ++this.generation;

    // metadataCache 变更：frontmatter 修改、新文件解析完成等
    const metaRef = this.app.metadataCache.on("changed", (file) => {
      if (generation !== this.generation) return;
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      this.queueUpsert(file, generation);
    });
    this.trackEvent("metadata", metaRef);

    // 文件删除：清理缓存
    const deleteRef = this.app.vault.on("delete", (file) => {
      if (generation !== this.generation) return;
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      this.removeByFile(file, generation);
    });
    this.trackEvent("vault", deleteRef);

    // 文件重命名/移动：更新 pathToCruid（同一 TFile 对象 path 会变化）
    const renameRef = this.app.vault.on("rename", (file, oldPath) => {
      if (generation !== this.generation) return;
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
      this.queueUpsert(file, generation);
    });
    this.trackEvent("vault", renameRef);

    // 异步构建（不阻塞插件启动）
    const build = this.buildCache(generation).catch((error: unknown) => {
      if (generation === this.generation) {
        this.logger?.warn("CruidCache", "构建 cruid 缓存失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.buildPromise = build;
  }

  /** 记录事件引用，确保缓存生命周期结束时可以精确解除监听。 */
  private trackEvent(target: "metadata" | "vault", ref: EventRef): void {
    this.eventRefs.push({ target, ref });
  }

  /** metadata 事件同步更新内存映射；异常只记录日志，不影响 Obsidian 事件循环。 */
  private queueUpsert(file: TFile, generation: number): void {
    try {
      this.upsertFromFile(file, generation);
    } catch (error) {
      if (generation === this.generation) {
        this.logger?.warn("CruidCache", "增量更新 cruid 缓存失败", {
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * 停止缓存：取消事件监听
   * 解除全部监听，并等待正在进行的初始扫描完成。
   */
  async dispose(): Promise<void> {
    if (!this.started && !this.buildPromise) {
      return;
    }
    this.started = false;
    const stopGeneration = ++this.generation;
    for (const item of this.eventRefs) {
      if (item.target === "metadata") {
        this.app.metadataCache.offref(item.ref);
      } else {
        this.app.vault.offref(item.ref);
      }
    }
    this.eventRefs = [];
    this.deleteListeners = [];
    const build = this.buildPromise;
    this.buildPromise = undefined;
    if (build) {
      await build;
    }
    // A cache can be restarted while an older scan is winding down. Only the
    // generation that requested this disposal may clear its own maps.
    if (this.generation === stopGeneration && !this.started) {
      this.cruidToFile.clear();
      this.pathToCruid.clear();
    }
  }

  /**
   * 启动时扫描所有 Markdown 文件构建缓存
   * 使用分块处理，块之间让出事件循环，避免阻塞 UI
   */
  private async buildCache(generation = this.generation): Promise<void> {
    this.cruidToFile.clear();
    this.pathToCruid.clear();

    const files = this.app.vault.getMarkdownFiles();
    const CHUNK_SIZE = 100; // 每块处理 100 个文件

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      if (generation !== this.generation) return;
      const chunk = files.slice(i, i + CHUNK_SIZE);
      for (const file of chunk) {
        if (generation !== this.generation) return;
        this.upsertFromFile(file, generation);
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

  /** 通过 cruid 获取文件。 */
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

  has(cruid: string): boolean {
    return this.cruidToFile.has(cruid);
  }

  /** 通过当前文件路径获取 cruid，供工作台动作使用。 */
  getCruidByPath(path: string): string | null {
    return this.pathToCruid.get(path) ?? null;
  }

  /** 等待当前一轮初始 metadata 扫描完成。 */
  async waitUntilReady(): Promise<void> {
    await this.buildPromise;
  }

  /** 返回当前一轮扫描完成后的稳定、按路径排序的概念文件快照。 */
  async snapshotEntries(): Promise<CruidCacheEntry[]> {
    await this.waitUntilReady();
    if (!this.started) return [];
    return [...this.cruidToFile.entries()]
      .map(([cruid, file]) => ({ cruid, path: file.path, file }))
      .sort((first, second) => first.path.localeCompare(second.path));
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

  private removeByFile(file: TFile, generation = this.generation): void {
    if (!this.started || generation !== this.generation) {
      return;
    }
    this.removeMapping(file.path, generation);
  }

  /** 删除路径对应的映射，并通知依赖方清理旧概念状态。 */
  private removeMapping(path: string, generation: number): void {
    if (generation !== this.generation) {
      return;
    }
    const cruid = this.pathToCruid.get(path);
    if (!cruid) {
      return;
    }

    for (const listener of this.deleteListeners) {
      try {
        listener({ cruid, path });
      } catch (error) {
        this.logger?.warn("CruidCache", "删除事件监听器执行失败", {
          cruid,
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.pathToCruid.delete(path);

    const existing = this.cruidToFile.get(cruid);
    if (existing && existing.path === path) {
      this.cruidToFile.delete(cruid);
    }

    this.logger?.info("CruidCache", "已移除 cruid 映射", {
      cruid,
      path,
    });
  }

  private upsertFromFile(
    file: TFile,
    generation = this.generation,
    path = file.path,
  ): void {
    if (generation !== this.generation || file.path !== path) return;
    const currentFile = this.app.vault.getAbstractFileByPath(path);
    if (currentFile !== file) return;

    const cruid = this.getCruidFromMetadata(file);
    if (!cruid) {
      this.removeMapping(path, generation);
      return;
    }

    const previousCruid = this.pathToCruid.get(path);
    if (previousCruid && previousCruid !== cruid) {
      this.removeMapping(path, generation);
    }

    const existingFile = this.cruidToFile.get(cruid);
    if (existingFile && existingFile.path !== path) {
      if (this.pathToCruid.get(existingFile.path) === cruid) {
        this.pathToCruid.delete(existingFile.path);
      }
      this.logger?.warn("CruidCache", "检测到重复 cruid，已用最新文件覆盖", {
        cruid,
        previousPath: existingFile.path,
        newPath: path,
      });
    }

    this.cruidToFile.set(cruid, file);
    this.pathToCruid.set(path, cruid);
  }

  private getCruidFromMetadata(file: TFile): string | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!fm) {
      return null;
    }

    const raw = typeof fm.cruid === "string" ? fm.cruid : null;
    if (!raw) {
      return null;
    }
    return raw.trim() || null;
  }

}
