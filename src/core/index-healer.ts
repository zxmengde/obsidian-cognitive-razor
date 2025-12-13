/**
 * IndexHealer - 索引自愈组件
 * 
 * 遵循 SSOT 第 7 章：索引自愈（移动/删除/外部修改）
 * 
 * 触发源：
 * - Vault rename：文件移动/重命名
 * - Vault delete：文件删除
 * - Vault modify：内容/frontmatter 被外部改写
 * 
 * 自愈目标：
 * - cruid → notePath 映射保持正确
 * - 笔记删除后：索引条目与重复对中不得残留该 cruid
 * - 笔记移动/重命名后：更新 notePath
 * - 父笔记重命名后：自动同步其它笔记 parents[] 中对应的"标题字符串"
 */

import { App, TFile, TAbstractFile } from "obsidian";
import {
  IVectorIndex,
  IDuplicateManager,
  ILogger,
  IFileStorage,
  CRType,
  Result,
  ok,
  err
} from "../types";
import { formatCRTimestamp } from "../utils/date-utils";

/**
 * Frontmatter 解析结果
 */
interface ParsedFrontmatter {
  cruid?: string;
  type?: CRType;
  name?: string;
  parents?: string[];
}

/**
 * IndexHealer 依赖
 */
interface IndexHealerDependencies {
  app: App;
  vectorIndex: IVectorIndex;
  duplicateManager: IDuplicateManager;
  logger: ILogger;
  fileStorage: IFileStorage;
}

/**
 * IndexHealer 组件
 */
export class IndexHealer {
  private app: App;
  private vectorIndex: IVectorIndex;
  private duplicateManager: IDuplicateManager;
  private logger: ILogger;
  private fileStorage: IFileStorage;
  
  // 防抖定时器
  private modifyDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 1000;

  constructor(deps: IndexHealerDependencies) {
    this.app = deps.app;
    this.vectorIndex = deps.vectorIndex;
    this.duplicateManager = deps.duplicateManager;
    this.logger = deps.logger;
    this.fileStorage = deps.fileStorage;

    this.logger.debug("IndexHealer", "索引自愈组件初始化完成");
  }

  /**
   * 处理文件删除事件
   * 
   * 清理：VectorIndex、DuplicatePairs 中的关联条目
   */
  async handleDelete(file: TAbstractFile): Promise<void> {
    // 只处理 Markdown 文件
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    try {
      this.logger.info("IndexHealer", `检测到文件删除: ${file.path}`, {
        event: "FILE_DELETED",
        path: file.path
      });

      // 从向量索引中查找对应的 cruid
      const cruid = this.findCruidByPath(file.path);
      
      if (!cruid) {
        this.logger.debug("IndexHealer", "删除的文件不在索引中，跳过清理", {
          path: file.path
        });
        return;
      }

      // 1. 从向量索引中删除
      const deleteResult = await this.vectorIndex.delete(cruid);
      if (!deleteResult.ok) {
        this.logger.warn("IndexHealer", "从向量索引删除失败", {
          cruid,
          error: deleteResult.error
        });
      } else {
        this.logger.info("IndexHealer", "已从向量索引删除", { cruid });
      }

      // 2. 清理重复对中包含该 cruid 的记录
      await this.cleanupDuplicatePairs(cruid);

      this.logger.info("IndexHealer", `文件删除自愈完成: ${file.path}`, {
        cruid,
        event: "DELETE_HEALED"
      });

    } catch (error) {
      this.logger.error("IndexHealer", "处理文件删除失败", error as Error, {
        path: file.path
      });
    }
  }

  /**
   * 处理文件重命名/移动事件
   * 
   * 更新：VectorIndex 中的 notePath
   * 同步：其他笔记 parents[] 中的标题字符串
   */
  async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    // 只处理 Markdown 文件
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    try {
      this.logger.info("IndexHealer", `检测到文件重命名: ${oldPath} → ${file.path}`, {
        event: "FILE_RENAMED",
        oldPath,
        newPath: file.path
      });

      // 从向量索引中查找对应的 cruid（使用旧路径）
      const cruid = this.findCruidByPath(oldPath);
      
      if (!cruid) {
        this.logger.debug("IndexHealer", "重命名的文件不在索引中，跳过更新", {
          oldPath,
          newPath: file.path
        });
        return;
      }

      // 1. 更新向量索引中的 notePath
      const entry = this.vectorIndex.getEntry(cruid);
      if (entry) {
        const updateResult = await this.vectorIndex.upsert({
          ...entry,
          path: file.path,
        updated: formatCRTimestamp()
        });

        if (!updateResult.ok) {
          this.logger.warn("IndexHealer", "更新向量索引路径失败", {
            cruid,
            error: updateResult.error
          });
        } else {
          this.logger.info("IndexHealer", "已更新向量索引路径", {
            cruid,
            oldPath,
            newPath: file.path
          });
        }
      }

      // 2. 提取旧文件名和新文件名（不含扩展名）
      const oldName = this.extractFileName(oldPath);
      const newName = this.extractFileName(file.path);

      // 3. 如果文件名变化，同步其他笔记的 parents[]
      if (oldName !== newName) {
        await this.syncParentsReferences(oldName, newName);
      }

      this.logger.info("IndexHealer", `文件重命名自愈完成: ${file.path}`, {
        cruid,
        event: "RENAME_HEALED"
      });

    } catch (error) {
      this.logger.error("IndexHealer", "处理文件重命名失败", error as Error, {
        oldPath,
        newPath: file.path
      });
    }
  }

  /**
   * 处理文件修改事件（带防抖）
   * 
   * 识别：frontmatter/cruid/type 的破坏性变更
   * 执行：最小修复/重建
   */
  handleModify(file: TAbstractFile): void {
    // 只处理 Markdown 文件
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    // 防抖处理
    const existingTimer = this.modifyDebounceTimers.get(file.path);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.modifyDebounceTimers.delete(file.path);
      void this.processModify(file);
    }, this.DEBOUNCE_MS);

    this.modifyDebounceTimers.set(file.path, timer);
  }

  /**
   * 实际处理文件修改
   */
  private async processModify(file: TFile): Promise<void> {
    try {
      this.logger.debug("IndexHealer", `检测到文件修改: ${file.path}`, {
        event: "FILE_MODIFIED",
        path: file.path
      });

      // 读取文件内容
      const content = await this.app.vault.read(file);
      const frontmatter = this.parseFrontmatter(content);

      if (!frontmatter.cruid) {
        // 不是 CR 管理的笔记，跳过
        return;
      }

      // 检查索引中是否存在该 cruid
      const entry = this.vectorIndex.getEntry(frontmatter.cruid);

      if (!entry) {
        // 索引中不存在，可能是新创建的或外部添加的 cruid
        this.logger.info("IndexHealer", "检测到新的 CR 笔记，需要重建索引", {
          cruid: frontmatter.cruid,
          path: file.path,
          event: "NEW_CR_NOTE_DETECTED"
        });
        // 这里不自动重建，因为需要生成 embedding，留给用户手动触发
        return;
      }

      // 检查路径是否一致
      if (entry.path !== file.path) {
        this.logger.warn("IndexHealer", "检测到路径不一致，更新索引", {
          cruid: frontmatter.cruid,
          indexPath: entry.path,
          actualPath: file.path
        });

        await this.vectorIndex.upsert({
          ...entry,
          path: file.path,
        updated: formatCRTimestamp()
        });
      }

      // 检查类型是否变化
      if (frontmatter.type && entry.type !== frontmatter.type) {
        this.logger.warn("IndexHealer", "检测到类型变化，需要重建索引", {
          cruid: frontmatter.cruid,
          oldType: entry.type,
          newType: frontmatter.type,
          event: "TYPE_CHANGED"
        });
        // 类型变化需要重新生成 embedding 并移动到新的类型桶
        // 这里标记为需要重建，留给用户手动触发
      }

    } catch (error) {
      this.logger.error("IndexHealer", "处理文件修改失败", error as Error, {
        path: file.path
      });
    }
  }

  /**
   * 根据路径查找 cruid
   * 使用 VectorIndex.findUidByPath 方法
   */
  private findCruidByPath(path: string): string | undefined {
    return this.vectorIndex.findUidByPath(path);
  }

  /**
   * 清理重复对中包含指定 cruid 的记录
   */
  private async cleanupDuplicatePairs(cruid: string): Promise<void> {
    const pendingPairs = this.duplicateManager.getPendingPairs();
    
    for (const pair of pendingPairs) {
      if (pair.noteA.nodeId === cruid || pair.noteB.nodeId === cruid) {
        const removeResult = await this.duplicateManager.removePair(pair.id);
        if (!removeResult.ok) {
          this.logger.warn("IndexHealer", "移除重复对失败", {
            pairId: pair.id,
            error: removeResult.error
          });
        } else {
          this.logger.info("IndexHealer", "已移除包含已删除笔记的重复对", {
            pairId: pair.id,
            deletedCruid: cruid
          });
        }
      }
    }
  }

  /**
   * 同步其他笔记 parents[] 中的标题引用
   */
  private async syncParentsReferences(oldName: string, newName: string): Promise<void> {
    this.logger.info("IndexHealer", `开始同步 parents 引用: ${oldName} → ${newName}`, {
      event: "SYNC_PARENTS_START"
    });

    // 获取所有 Markdown 文件
    const files = this.app.vault.getMarkdownFiles();
    let updatedCount = 0;

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const frontmatter = this.parseFrontmatter(content);

        // 检查 parents 是否包含旧名称
        if (frontmatter.parents && frontmatter.parents.includes(oldName)) {
          // 替换旧名称为新名称
          const newParents = frontmatter.parents.map(p => 
            p === oldName ? newName : p
          );

          // 更新文件内容
          const newContent = this.updateFrontmatterParents(content, newParents);
          await this.app.vault.modify(file, newContent);

          updatedCount++;
          this.logger.debug("IndexHealer", `已更新 parents 引用: ${file.path}`, {
            oldParents: frontmatter.parents,
            newParents
          });
        }
      } catch (error) {
        this.logger.warn("IndexHealer", `更新 parents 引用失败: ${file.path}`, {
          error
        });
      }
    }

    this.logger.info("IndexHealer", `parents 引用同步完成`, {
      oldName,
      newName,
      updatedCount,
      event: "SYNC_PARENTS_COMPLETE"
    });
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string): ParsedFrontmatter {
    const result: ParsedFrontmatter = {};

    // 匹配 YAML frontmatter
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      return result;
    }

    const yaml = match[1];
    const lines = yaml.split(/\r?\n/);

    for (const line of lines) {
      // 解析 cruid（支持 cruid 和 crUid）
      const cruidMatch = line.match(/^cr[Uu]id:\s*["']?([^"'\s]+)["']?/);
      if (cruidMatch) {
        result.cruid = cruidMatch[1];
      }

      // 解析 type
      const typeMatch = line.match(/^type:\s*["']?(\w+)["']?/);
      if (typeMatch) {
        result.type = typeMatch[1] as CRType;
      }

      // 解析 name
      const nameMatch = line.match(/^name:\s*["']?(.+?)["']?\s*$/);
      if (nameMatch) {
        result.name = nameMatch[1];
      }

      // 解析 parents（简化处理，只支持 YAML 数组格式）
      if (line.startsWith("parents:")) {
        result.parents = [];
      } else if (result.parents !== undefined && line.match(/^\s*-\s*/)) {
        const parentMatch = line.match(/^\s*-\s*["']?(.+?)["']?\s*$/);
        if (parentMatch) {
          result.parents.push(parentMatch[1]);
        }
      }
    }

    return result;
  }

  /**
   * 更新 frontmatter 中的 parents 字段
   */
  private updateFrontmatterParents(content: string, newParents: string[]): string {
    // 匹配 YAML frontmatter
    const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
    if (!match) {
      return content;
    }

    const [fullMatch, start, yaml, end] = match;
    const lines = yaml.split(/\r?\n/);
    const newLines: string[] = [];
    let inParents = false;
    let parentsWritten = false;

    for (const line of lines) {
      if (line.startsWith("parents:")) {
        inParents = true;
        // 写入新的 parents
        if (newParents.length === 0) {
          newLines.push("parents: []");
        } else {
          newLines.push("parents:");
          for (const parent of newParents) {
            newLines.push(`  - "${parent}"`);
          }
        }
        parentsWritten = true;
      } else if (inParents && line.match(/^\s*-\s*/)) {
        // 跳过旧的 parents 项
        continue;
      } else {
        inParents = false;
        newLines.push(line);
      }
    }

    // 如果原来没有 parents 字段，添加它
    if (!parentsWritten && newParents.length > 0) {
      newLines.push("parents:");
      for (const parent of newParents) {
        newLines.push(`  - "${parent}"`);
      }
    }

    const newYaml = newLines.join("\n");
    return content.replace(fullMatch, `${start}${newYaml}${end}`);
  }

  /**
   * 从路径提取文件名（不含扩展名）
   */
  private extractFileName(path: string): string {
    const parts = path.split("/");
    const fileName = parts[parts.length - 1];
    return fileName.replace(/\.md$/, "");
  }

  /**
   * 清理资源
   */
  dispose(): void {
    // 清理所有防抖定时器
    for (const timer of this.modifyDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.modifyDebounceTimers.clear();

    this.logger.debug("IndexHealer", "索引自愈组件已清理");
  }
}
