/**
 * MergeHandler - 合并处理器
 * 
 * 功能：
 * - 生成合并任务
 * - 监听 reason:merge 任务完成
 * - 生成合并预览
 * - 处理用户确认
 * - 执行合并写入和清理
 * 
 * 验证需求：7.1, 7.2, 7.3, 7.4, 7.5
 */

import { App, TFile, Notice } from "obsidian";
import { TaskQueue } from "./task-queue";
import { UndoManager } from "./undo-manager";
import { DuplicateManager } from "./duplicate-manager";
import { VectorIndex } from "./vector-index";
import { FileStorage } from "../data/file-storage";
import { SimpleDiffView } from "../ui/diff-view";
import { Result, ok, err, TaskRecord, DuplicatePair, CRFrontmatter } from "../types";

/**
 * 合并笔记数据结构
 */
interface MergeNoteData {
  nodeId: string;
  name: string;
  path: string;
  content: string;
}

/**
 * MergeHandler 配置
 */
export interface MergeHandlerConfig {
  /** Obsidian App 实例 */
  app: App;
  /** TaskQueue 实例 */
  taskQueue: TaskQueue;
  /** UndoManager 实例 */
  undoManager: UndoManager;
  /** DuplicateManager 实例 */
  duplicateManager: DuplicateManager;
  /** VectorIndex 实例 */
  vectorIndex: VectorIndex;
  /** FileStorage 实例 */
  storage: FileStorage;
  /** 获取语言设置的函数 */
  getLanguage: () => "zh" | "en";
}

/**
 * MergeHandler 组件
 */
export class MergeHandler {
  private app: App;
  private taskQueue: TaskQueue;
  private undoManager: UndoManager;
  private duplicateManager: DuplicateManager;
  private vectorIndex: VectorIndex;
  private storage: FileStorage;
  private getLanguage: () => "zh" | "en";

  constructor(config: MergeHandlerConfig) {
    this.app = config.app;
    this.taskQueue = config.taskQueue;
    this.undoManager = config.undoManager;
    this.duplicateManager = config.duplicateManager;
    this.vectorIndex = config.vectorIndex;
    this.storage = config.storage;
    this.getLanguage = config.getLanguage;
  }

  /**
   * 启动监听
   */
  public start(): void {
    // 订阅任务完成事件
    this.taskQueue.subscribe((event) => {
      if (event.type === "task-completed" && event.taskId) {
        this.handleTaskCompleted(event.taskId);
      }
    });
  }

  /**
   * 创建合并任务
   * 验证需求：7.1
   */
  public async createMergeTask(pair: DuplicatePair): Promise<Result<string>> {
    try {
      // 1. 验证重复对状态
      if (pair.status !== "pending") {
        return err(
          "INVALID_STATUS",
          `重复对状态必须为 pending，当前为 ${pair.status}`
        );
      }

      // 2. 读取两个笔记的内容
      const fileA = this.app.vault.getAbstractFileByPath(pair.noteA.path);
      const fileB = this.app.vault.getAbstractFileByPath(pair.noteB.path);

      if (!fileA || !(fileA instanceof TFile)) {
        return err("FILE_NOT_FOUND", `文件不存在: ${pair.noteA.path}`);
      }

      if (!fileB || !(fileB instanceof TFile)) {
        return err("FILE_NOT_FOUND", `文件不存在: ${pair.noteB.path}`);
      }

      const contentA = await this.app.vault.read(fileA);
      const contentB = await this.app.vault.read(fileB);

      // 3. 更新重复对状态为 merging
      const updateResult = await this.duplicateManager.updateStatus(
        pair.id,
        "merging"
      );

      if (!updateResult.ok) {
        return updateResult;
      }

      // 4. 创建合并任务
      const taskResult = this.taskQueue.enqueue({
        nodeId: pair.noteA.nodeId,
        taskType: "reason:merge",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        payload: {
          pairId: pair.id,
          noteA: {
            nodeId: pair.noteA.nodeId,
            name: pair.noteA.name,
            path: pair.noteA.path,
            content: contentA,
          },
          noteB: {
            nodeId: pair.noteB.nodeId,
            name: pair.noteB.name,
            path: pair.noteB.path,
            content: contentB,
          },
          type: pair.type,
          similarity: pair.similarity,
        },
      });

      if (!taskResult.ok) {
        // 恢复重复对状态
        await this.duplicateManager.updateStatus(pair.id, "pending");
        return taskResult;
      }

      new Notice(`已创建合并任务: ${pair.noteA.name} ↔ ${pair.noteB.name}`);
      return ok(taskResult.value);
    } catch (error) {
      console.error("创建合并任务失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err("CREATE_TASK_ERROR", `创建合并任务失败: ${errorMessage}`);
    }
  }

  /**
   * 处理任务完成
   */
  private async handleTaskCompleted(taskId: string): Promise<void> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) {
      return;
    }

    // 只处理 reason:merge 任务
    if (task.taskType !== "reason:merge") {
      return;
    }

    // 如果任务属于 PipelineOrchestrator（包含 pipelineId），交由管线处理
    if (task.payload?.pipelineId) {
      return;
    }

    // 检查任务结果
    if (!task.result) {
      console.error("合并任务没有结果:", taskId);
      return;
    }

    try {
      await this.showMergePreviewAndConfirm(task);
    } catch (error) {
      console.error("处理合并任务失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`处理合并失败: ${errorMessage}`);

      // 恢复重复对状态
      const pairId = task.payload.pairId as string;
      if (pairId) {
        await this.duplicateManager.updateStatus(pairId, "pending");
      }
    }
  }

  /**
   * 显示合并预览并等待确认
   * 验证需求：7.2, 7.3
   */
  private async showMergePreviewAndConfirm(task: TaskRecord): Promise<void> {
    const noteA = task.payload.noteA as any;
    const noteB = task.payload.noteB as any;
    const pairId = task.payload.pairId as string;

    if (!noteA || !noteB || !pairId) {
      new Notice("任务缺少必要信息");
      return;
    }

    // 构建合并后的完整内容
    const mergedContent = this.buildMergedContent(
      task.result!,
      noteA,
      task.payload.type as string
    );

    if (!mergedContent.ok) {
      new Notice(`构建合并内容失败: ${mergedContent.error.message}`);
      return;
    }

    // 获取主笔记文件
    const mainFile = this.app.vault.getAbstractFileByPath(noteA.path);
    if (!mainFile || !(mainFile instanceof TFile)) {
      new Notice(`文件不存在: ${noteA.path}`);
      return;
    }

    // 显示差异视图
    const diffView = new SimpleDiffView(
      this.app,
      `合并预览: ${noteA.name} ← ${noteB.name}`,
      noteA.content,
      mergedContent.value,
      async () => {
        // 用户接受合并
        await this.applyMerge(
          mainFile,
          noteA,
          noteB,
          mergedContent.value,
          pairId
        );
      },
      async () => {
        // 用户放弃合并
        new Notice("已放弃合并");
        // 恢复重复对状态
        await this.duplicateManager.updateStatus(pairId, "pending");
      }
    );

    diffView.open();
  }

  /**
   * 构建合并后的完整内容
   * 将 AI 返回的结构化数据转换为 Markdown 格式
   */
  private buildMergedContent(
    mergeResult: Record<string, unknown>,
    noteA: MergeNoteData,
    type: string
  ): Result<string> {
    try {
      // 解析原始 frontmatter
      const frontmatter = this.parseFrontmatter(noteA.content);
      if (!frontmatter) {
        return err("PARSE_ERROR", "无法解析原始笔记的 frontmatter");
      }

      // 获取合并后的名称
      const mergedName = mergeResult.merged_name as { chinese?: string; english?: string } | undefined;
      if (!mergedName || !mergedName.chinese) {
        return err("MISSING_NAME", "合并结果缺少名称信息");
      }

      // 更新 frontmatter
      const updatedFrontmatter = {
        ...frontmatter,
        updated: new Date().toISOString(),
        // 可以添加合并相关的元数据
      };

      // 构建新的 frontmatter 字符串
      const frontmatterStr = this.buildFrontmatterString(updatedFrontmatter);

      // 获取合并后的内容
      const content = mergeResult.content as Record<string, unknown>;
      if (!content) {
        return err("MISSING_CONTENT", "合并结果缺少内容信息");
      }

      // 构建 Markdown 内容
      const bodyContent = this.buildMarkdownBody(
        mergedName.chinese,
        mergedName.english ?? "",
        content,
        type,
        mergeResult
      );

      // 组合完整内容
      const fullContent = `${frontmatterStr}\n\n${bodyContent}`;

      return ok(fullContent);
    } catch (error) {
      console.error("构建合并内容失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err("BUILD_ERROR", `构建合并内容失败: ${errorMessage}`);
    }
  }

  /**
   * 构建 frontmatter 字符串
   */
  private buildFrontmatterString(frontmatter: CRFrontmatter): string {
    const lines = [
      "---",
      `uid: ${frontmatter.uid}`,
      `type: ${frontmatter.type}`,
      `status: ${frontmatter.status}`,
      `created: ${frontmatter.created}`,
      `updated: ${frontmatter.updated}`,
    ];

    if (frontmatter.aliases && frontmatter.aliases.length > 0) {
      lines.push(`aliases:`);
      frontmatter.aliases.forEach(alias => {
        lines.push(`  - ${alias}`);
      });
    }

    if (frontmatter.tags && frontmatter.tags.length > 0) {
      lines.push(`tags:`);
      frontmatter.tags.forEach(tag => {
        lines.push(`  - ${tag}`);
      });
    }

    lines.push("---");

    return lines.join("\n");
  }

  /**
   * 构建 Markdown 正文
   * 根据用户语言设置使用中文或英文标题
   * 注意：文件名已包含中英文，无需在内容中重复
   */
  private buildMarkdownBody(
    chineseName: string,
    englishName: string,
    content: Record<string, unknown>,
    type: string,
    mergeResult: Record<string, unknown>
  ): string {
    const sections: string[] = [];
    const language = this.getLanguage();

    // 根据语言设置选择标题（文件名已包含中英文，无需重复）
    if (language === "zh") {
      // 中文环境：使用中文标题
      sections.push(`# ${chineseName}`);
    } else {
      // 英文环境：使用英文标题
      sections.push(`# ${englishName}`);
    }
    sections.push("");

    // 合并说明
    const rationale = mergeResult.merge_rationale as string;
    if (rationale) {
      sections.push("## 合并说明");
      sections.push(rationale);
      sections.push("");
    }

    // 核心定义
    if (content.core_definition) {
      sections.push("## 核心定义");
      sections.push(content.core_definition as string);
      sections.push("");
    }

    // 根据类型添加特定内容
    sections.push(this.buildTypeSpecificContent(content, type));

    // 保留的见解
    const preservedA = mergeResult.preserved_from_a as string[];
    const preservedB = mergeResult.preserved_from_b as string[];
    if ((preservedA && preservedA.length > 0) || (preservedB && preservedB.length > 0)) {
      sections.push("## 整合的见解");
      if (preservedA && preservedA.length > 0) {
        sections.push("### 来自概念 A");
        preservedA.forEach(insight => {
          sections.push(`- ${insight}`);
        });
      }
      if (preservedB && preservedB.length > 0) {
        sections.push("### 来自概念 B");
        preservedB.forEach(insight => {
          sections.push(`- ${insight}`);
        });
      }
      sections.push("");
    }

    // 解决的冲突
    const conflicts = mergeResult.conflicts_resolved as string[];
    if (conflicts && conflicts.length > 0) {
      sections.push("## 解决的冲突");
      conflicts.forEach(conflict => {
        sections.push(`- ${conflict}`);
      });
      sections.push("");
    }

    return sections.join("\n");
  }

  /**
   * 构建类型特定的内容
   */
  private buildTypeSpecificContent(
    content: Record<string, unknown>,
    type: string
  ): string {
    const sections: string[] = [];

    switch (type) {
      case "Issue":
        if (content.core_tension) {
          sections.push("## 核心张力");
          sections.push(content.core_tension as string);
          sections.push("");
        }
        break;

      case "Theory":
        if (content.axioms) {
          sections.push("## 公理");
          const axioms = content.axioms as any[];
          axioms.forEach((axiom, index) => {
            sections.push(`### 公理 ${index + 1}: ${axiom.statement}`);
            sections.push(`**理由**: ${axiom.justification}`);
            sections.push("");
          });
        }
        break;

      case "Mechanism":
        if (content.causal_chain) {
          sections.push("## 因果链");
          const chain = content.causal_chain as any[];
          chain.forEach((step, index) => {
            sections.push(`${index + 1}. ${step}`);
          });
          sections.push("");
        }
        if (content.operates_on) {
          sections.push("## 作用对象");
          const operates = content.operates_on as string[];
          operates.forEach(obj => {
            sections.push(`- ${obj}`);
          });
          sections.push("");
        }
        break;

      case "Entity":
        if (content.definition) {
          sections.push("## 定义");
          sections.push(content.definition as string);
          sections.push("");
        }
        break;

      case "Domain":
        if (content.boundaries) {
          sections.push("## 边界");
          const boundaries = content.boundaries as string[];
          boundaries.forEach(boundary => {
            sections.push(`- ${boundary}`);
          });
          sections.push("");
        }
        break;
    }

    return sections.join("\n");
  }

  /**
   * 写入后更新向量索引并触发去重
   */
  private async updateIndexAndDedup(nodeId: string): Promise<void> {
    const entry = this.vectorIndex.getEntry(nodeId);
    if (!entry) {
      console.warn("MergeHandler: 向量索引缺少条目，跳过更新", { nodeId });
      return;
    }

    const updatedEntry = {
      ...entry,
      updated: new Date().toISOString()
    };

    const upsertResult = await this.vectorIndex.upsert(updatedEntry);
    if (!upsertResult.ok) {
      console.warn("MergeHandler: 更新向量索引失败", upsertResult.error);
      return;
    }

    await this.duplicateManager.detect(nodeId, entry.type, entry.embedding);
  }

  /**
   * 应用合并
   * 验证需求：7.4, 7.5
   */
  private async applyMerge(
    mainFile: TFile,
    noteA: MergeNoteData,
    noteB: MergeNoteData,
    mergedContent: string,
    pairId: string
  ): Promise<void> {
    try {
      // 1. 创建快照（主笔记）
      const snapshotResult = await this.undoManager.createSnapshot(
        mainFile.path,
        noteA.content,
        `merge-${pairId}`,
        noteA.nodeId
      );

      if (!snapshotResult.ok) {
        new Notice(`创建快照失败: ${snapshotResult.error.message}`);
        return;
      }

      // 2. 写入合并内容到主笔记（原子写入）
      await this.atomicWriteVault(mainFile.path, mergedContent);

      // 3. 为被删除笔记创建快照（确保可恢复）
      await this.undoManager.createSnapshot(
        noteB.path,
        noteB.content,
        `merge-delete-${pairId}`,
        noteB.nodeId
      );

      // 4. 删除被合并的笔记
      const fileB = this.app.vault.getAbstractFileByPath(noteB.path);
      if (fileB && fileB instanceof TFile) {
        await this.app.vault.delete(fileB);
      }

      // 5. 从向量索引中删除被合并笔记的条目
      await this.vectorIndex.delete(noteB.nodeId);

      // 6. 更新主笔记的向量索引并触发去重（使用现有 embedding）
      await this.updateIndexAndDedup(noteA.nodeId);

      // 7. 从 DuplicatePairs 中移除该重复对
      await this.duplicateManager.removePair(pairId);

      // 8. 显示成功通知
      new Notice(`合并完成: ${noteA.name} ← ${noteB.name}`, 5000);

      // 9. 显示撤销按钮
      this.showUndoNotification(
        mainFile.path,
        noteB.path,
        snapshotResult.value,
        noteB.content,
        pairId
      );
    } catch (error) {
      console.error("应用合并失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`合并失败: ${errorMessage}`);

      // 恢复重复对状态
      await this.duplicateManager.updateStatus(pairId, "pending");
    }
  }

  /**
   * Vault 原子写入
   */
  private async atomicWriteVault(path: string, content: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const temp = `${path}.tmp`;
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) {
      const exists = await adapter.exists(dir);
      if (!exists) {
        await adapter.mkdir(dir);
      }
    }
    await adapter.write(temp, content);
    const verify = await adapter.read(temp);
    if (verify !== content) {
      await adapter.remove(temp);
      throw new Error("写入校验失败");
    }
    if (await adapter.exists(path)) {
      await adapter.remove(path);
    }
    await adapter.rename(temp, path);
  }

  /**
   * 显示撤销通知
   */
  private showUndoNotification(
    mainFilePath: string,
    deletedFilePath: string,
    snapshotId: string,
    deletedContent: string,
    pairId: string
  ): void {
    // 创建一个带撤销按钮的通知
    const notice = new Notice("", 5000);
    const noticeEl = notice.noticeEl;
    noticeEl.empty();

    const message = noticeEl.createDiv({ cls: "cr-undo-notice" });
    message.createSpan({ text: "合并已完成 " });

    const undoBtn = message.createEl("button", {
      text: "撤销",
      cls: "cr-undo-btn"
    });

    undoBtn.addEventListener("click", async () => {
      notice.hide();
      await this.handleUndoMerge(
        mainFilePath,
        deletedFilePath,
        snapshotId,
        deletedContent,
        pairId
      );
    });
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string): CRFrontmatter | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      return null;
    }

    const frontmatterText = match[1];
    const lines = frontmatterText.split("\n");
    const frontmatter: Partial<CRFrontmatter> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      switch (key) {
        case "uid":
          frontmatter.uid = value;
          break;
        case "type":
          frontmatter.type = value as any;
          break;
        case "status":
          frontmatter.status = value as any;
          break;
        case "created":
          frontmatter.created = value;
          break;
        case "updated":
          frontmatter.updated = value;
          break;
      }
    }

    return frontmatter.uid && frontmatter.type && frontmatter.status
      ? (frontmatter as CRFrontmatter)
      : null;
  }

  /**
   * 处理撤销合并
   */
  private async handleUndoMerge(
    mainFilePath: string,
    deletedFilePath: string,
    snapshotId: string,
    deletedContent: string,
    pairId: string
  ): Promise<void> {
    try {
      // 1. 恢复主笔记
      const restoreResult = await this.undoManager.restoreSnapshot(snapshotId);

      if (!restoreResult.ok) {
        new Notice(`恢复主笔记失败: ${restoreResult.error.message}`);
        return;
      }

      // 读取恢复的内容
      const mainFile = this.app.vault.getAbstractFileByPath(mainFilePath);
      if (!mainFile || !(mainFile instanceof TFile)) {
        new Notice(`文件不存在: ${mainFilePath}`);
        return;
      }

      // 写入主文件
      await this.app.vault.modify(mainFile, restoreResult.value.content);

      // 2. 恢复被删除的笔记
      await this.app.vault.create(deletedFilePath, deletedContent);

      // 3. 恢复向量索引（需要重新生成 embedding）
      // 注意：这里简化处理，实际可能需要创建 embedding 任务

      // 4. 恢复重复对（需要重新添加）
      // 注意：这里简化处理，实际需要从原始数据恢复

      new Notice("已撤销合并");
    } catch (error) {
      console.error("撤销合并失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`撤销合并失败: ${errorMessage}`);
    }
  }
}
