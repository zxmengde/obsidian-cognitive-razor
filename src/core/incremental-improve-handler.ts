/**
 * IncrementalImproveHandler - 增量改进处理器
 * 
 * 功能：
 * - 监听 reason:incremental 任务完成
 * - 生成 Diff 预览
 * - 处理用户确认
 * - 执行写入和状态降级
 * 
 * 验证需求：4.3, 4.4, 4.5
 */

import { App, TFile, Notice } from "obsidian";
import { TaskQueue } from "./task-queue";
import { UndoManager } from "./undo-manager";
import { FileStorage } from "../data/file-storage";
import { SimpleDiffView } from "../ui/diff-view";
import { Result, ok, err, TaskRecord, CRFrontmatter, NoteState, IVectorIndex, IDuplicateManager, CRType } from "../types";

/**
 * IncrementalImproveHandler 配置
 */
export interface IncrementalImproveHandlerConfig {
  /** Obsidian App 实例 */
  app: App;
  /** TaskQueue 实例 */
  taskQueue: TaskQueue;
  /** UndoManager 实例 */
  undoManager: UndoManager;
  /** FileStorage 实例 */
  storage: FileStorage;
  /** VectorIndex 实例 */
  vectorIndex: IVectorIndex;
  /** DuplicateManager 实例 */
  duplicateManager: IDuplicateManager;
}

/**
 * IncrementalImproveHandler 组件
 */
export class IncrementalImproveHandler {
  private app: App;
  private taskQueue: TaskQueue;
  private undoManager: UndoManager;
  private storage: FileStorage;
  private vectorIndex: IVectorIndex;
  private duplicateManager: IDuplicateManager;

  constructor(config: IncrementalImproveHandlerConfig) {
    this.app = config.app;
    this.taskQueue = config.taskQueue;
    this.undoManager = config.undoManager;
    this.storage = config.storage;
    this.vectorIndex = config.vectorIndex;
    this.duplicateManager = config.duplicateManager;
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
   * 处理任务完成
   */
  private async handleTaskCompleted(taskId: string): Promise<void> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) {
      return;
    }

    // 只处理 reason:incremental 任务
    if (task.taskType !== "reason:incremental") {
      return;
    }

    // 如果任务属于 PipelineOrchestrator（包含 pipelineId），交由管线处理
    if (task.payload?.pipelineId) {
      return;
    }

    // 检查任务结果
    if (!task.result) {
      console.error("增量改进任务没有结果:", taskId);
      return;
    }

    try {
      await this.showDiffAndConfirm(task);
    } catch (error) {
      console.error("处理增量改进任务失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`处理增量改进失败: ${errorMessage}`);
    }
  }

  /**
   * 显示差异并等待确认
   */
  private async showDiffAndConfirm(task: TaskRecord): Promise<void> {
    const filePath = task.payload.filePath as string;
    if (!filePath) {
      new Notice("任务缺少文件路径信息");
      return;
    }

    // 获取文件
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      new Notice(`文件不存在: ${filePath}`);
      return;
    }

    // 读取当前内容
    const currentContent = await this.app.vault.read(file);

    // 获取改进后的内容（兼容 improved_content 和 newContent 两种字段名）
    const improvedContent = (task.result!.improved_content || task.result!.newContent) as string;
    if (!improvedContent) {
      new Notice("任务结果缺少改进内容");
      return;
    }

    // 显示差异视图
    const diffView = new SimpleDiffView(
      this.app,
      "增量改进预览",
      currentContent,
      improvedContent,
      async () => {
        // 用户接受更改
        await this.applyImprovement(file, currentContent, improvedContent);
      },
      () => {
        // 用户放弃更改
        new Notice("已放弃增量改进");
      }
    );

    diffView.open();
  }

  /**
   * 应用改进
   */
  private async applyImprovement(
    file: TFile,
    originalContent: string,
    improvedContent: string
  ): Promise<void> {
    try {
      // 1. 创建快照
      // 修复：使用 frontmatter 中的 uid 作为 nodeId（遵循 G-01 UID 稳定性）
      const frontmatter = this.parseFrontmatter(originalContent);
      const nodeId = frontmatter?.uid || file.basename.replace(/\.md$/, '');
      const snapshotResult = await this.undoManager.createSnapshot(
        file.path,
        originalContent,
        `incremental-improve-${Date.now()}`,
        nodeId
      );

      if (!snapshotResult.ok) {
        new Notice(`创建快照失败: ${snapshotResult.error.message}`);
        return;
      }

      // 2. 检查是否需要状态降级
      const needsDowngrade = await this.checkNeedsStatusDowngrade(originalContent);

      // 3. 如果需要降级，更新 frontmatter
      let finalContent = improvedContent;
      if (needsDowngrade) {
        const downgradeResult = this.downgradeStatus(improvedContent);
        if (downgradeResult.ok) {
          finalContent = downgradeResult.value;
        }
      }

      // 4. 写入文件（原子写入）
      await this.atomicWriteVault(file.path, finalContent);

      // 5. 显示成功通知
      const message = needsDowngrade
        ? "增量改进已应用，笔记状态已降级为 Draft"
        : "增量改进已应用";
      
      new Notice(message, 5000);

      // 6. 更新向量索引并触发去重（若有可用向量）
      await this.updateIndexAndDedup(nodeId, frontmatter?.type);

      // 6. 显示撤销按钮（通过通知）
      this.showUndoNotification(file.path, snapshotResult.value);
    } catch (error) {
      console.error("应用增量改进失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`应用改进失败: ${errorMessage}`);
    }
  }

  /**
   * 检查是否需要状态降级
   */
  private async checkNeedsStatusDowngrade(content: string): Promise<boolean> {
    const frontmatter = this.parseFrontmatter(content);
    if (!frontmatter) {
      return false;
    }

    // 只有 Evergreen 状态需要降级
    return frontmatter.status === "Evergreen";
  }

  /**
   * 降级笔记状态
   */
  private downgradeStatus(content: string): Result<string> {
    const frontmatter = this.parseFrontmatter(content);
    if (!frontmatter) {
      return err("PARSE_ERROR", "无法解析 frontmatter");
    }

    // 如果不是 Evergreen，不需要降级
    if (frontmatter.status !== "Evergreen") {
      return ok(content);
    }

    // 替换状态为 Draft
    const updatedContent = content.replace(
      /^(---\s*\n(?:.*\n)*?)status:\s*Evergreen\s*\n/m,
      "$1status: Draft\n"
    );

    // 更新 updated 时间
    const timestamp = new Date().toISOString();
    const finalContent = updatedContent.replace(
      /^(---\s*\n(?:.*\n)*?)updated:\s*[^\n]+\s*\n/m,
      `$1updated: ${timestamp}\n`
    );

    return ok(finalContent);
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
          frontmatter.status = value as NoteState;
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
   * 原子写入到 Vault（临时文件 + 校验 + 重命名）
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
   * 写入后更新向量索引并触发去重
   */
  private async updateIndexAndDedup(nodeId: string, type?: CRType): Promise<void> {
    if (!type) return;

    const entry = this.vectorIndex.getEntry(nodeId);
    if (!entry) {
      console.warn("IncrementalImproveHandler: 向量索引缺少条目，跳过更新", { nodeId });
      return;
    }

    const updatedEntry = {
      ...entry,
      updated: new Date().toISOString()
    };

    const upsertResult = await this.vectorIndex.upsert(updatedEntry);
    if (!upsertResult.ok) {
      console.warn("IncrementalImproveHandler: 更新向量索引失败", upsertResult.error);
      return;
    }

    // 触发去重检测
    await this.duplicateManager.detect(nodeId, entry.type, entry.embedding);
  }

  /**
   * 显示撤销通知
   */
  private showUndoNotification(filePath: string, snapshotId: string): void {
    // 创建一个带撤销按钮的通知
    const notice = new Notice("", 5000);
    const noticeEl = notice.noticeEl;
    noticeEl.empty();

    const message = noticeEl.createDiv({ cls: "cr-undo-notice" });
    message.createSpan({ text: "增量改进已应用 " });

    const undoBtn = message.createEl("button", {
      text: "撤销",
      cls: "cr-undo-btn"
    });

    undoBtn.addEventListener("click", async () => {
      notice.hide();
      await this.handleUndo(filePath, snapshotId);
    });
  }

  /**
   * 处理撤销
   */
  private async handleUndo(filePath: string, snapshotId: string): Promise<void> {
    try {
      const restoreResult = await this.undoManager.restoreSnapshot(snapshotId);

      if (!restoreResult.ok) {
        new Notice(`撤销失败: ${restoreResult.error.message}`);
        return;
      }

      // 读取恢复的内容
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!file || !(file instanceof TFile)) {
        new Notice(`文件不存在: ${filePath}`);
        return;
      }

      // 写入文件
      await this.app.vault.modify(file, restoreResult.value.content);

      new Notice("已撤销增量改进");
    } catch (error) {
      console.error("撤销失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`撤销失败: ${errorMessage}`);
    }
  }
}
