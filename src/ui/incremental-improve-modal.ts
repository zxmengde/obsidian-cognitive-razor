/**
 * IncrementalImproveModal - 增量改进意图输入框
 * 
 * 功能：
 * - 输入改进意图
 * - 生成 reason:incremental 任务
 */

import { Modal, App, Notice, TFile } from "obsidian";
import { TaskQueue } from "../core/task-queue";
import { Result } from "../types";

/**
 * 增量改进模态框
 */
export class IncrementalImproveModal extends Modal {
  private file: TFile;
  private taskQueue: TaskQueue;
  private intentInput: HTMLTextAreaElement | null = null;

  constructor(app: App, file: TFile, taskQueue: TaskQueue) {
    super(app);
    this.file = file;
    this.taskQueue = taskQueue;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-incremental-improve-modal");

    // 标题
    contentEl.createEl("h2", { text: "增量改进笔记" });

    // 文件信息
    const fileInfo = contentEl.createDiv({ cls: "cr-file-info" });
    fileInfo.createEl("div", {
      text: `笔记: ${this.file.basename}`,
      cls: "cr-file-name"
    });
    fileInfo.createEl("div", {
      text: `路径: ${this.file.path}`,
      cls: "cr-file-path"
    });

    // 说明文本
    contentEl.createEl("p", {
      text: "请描述您希望如何改进这篇笔记。AI 将根据您的意图生成改进后的内容。",
      cls: "cr-description"
    });

    // 意图输入框
    const inputContainer = contentEl.createDiv({ cls: "cr-input-container" });
    inputContainer.createEl("label", {
      text: "改进意图:",
      attr: { for: "intent-input" }
    });

    this.intentInput = inputContainer.createEl("textarea", {
      cls: "cr-intent-input",
      attr: {
        id: "intent-input",
        placeholder: "例如：\n- 添加更多示例\n- 扩展理论部分\n- 改进语言表达\n- 补充相关链接",
        rows: "6",
        "aria-label": "改进意图输入框"
      }
    });

    // 自动聚焦
    this.intentInput.focus();

    // 提示信息
    contentEl.createEl("div", {
      text: "💡 提示：描述越具体，AI 生成的改进内容越符合您的期望。",
      cls: "cr-hint"
    });

    // 操作按钮
    const actions = contentEl.createDiv({ cls: "cr-modal-actions" });

    const submitBtn = actions.createEl("button", {
      text: "生成改进",
      cls: "mod-cta",
      attr: { "aria-label": "生成改进内容" }
    });
    submitBtn.addEventListener("click", () => {
      this.handleSubmit();
    });

    const cancelBtn = actions.createEl("button", {
      text: "取消",
      attr: { "aria-label": "取消操作" }
    });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    // 支持 Enter 键提交（Ctrl/Cmd + Enter）
    this.intentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.handleSubmit();
      }
    });
  }

  /**
   * 处理提交
   */
  private async handleSubmit(): Promise<void> {
    if (!this.intentInput) return;

    const intent = this.intentInput.value.trim();

    // 验证输入
    if (!intent) {
      new Notice("请输入改进意图");
      this.intentInput.focus();
      return;
    }

    try {
      // 读取笔记内容
      const content = await this.app.vault.read(this.file);

      // 解析 frontmatter 获取 UID
      const uid = this.extractUid(content);
      if (!uid) {
        new Notice("无法从笔记中提取 UID，请确保笔记包含有效的 frontmatter");
        return;
      }

      // 创建任务
      const taskResult = await this.createIncrementalTask(uid, intent, content);

      if (!taskResult.ok) {
        new Notice(`创建任务失败: ${taskResult.error.message}`);
        return;
      }

      new Notice("已添加增量改进任务到队列");
      this.close();
    } catch (error) {
      console.error("创建增量改进任务失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      new Notice(`创建任务失败: ${errorMessage}`);
    }
  }

  /**
   * 从内容中提取 UID
   */
  private extractUid(content: string): string | null {
    // 匹配 frontmatter 中的 uid 字段
    const uidMatch = content.match(/^---\s*\n(?:.*\n)*?uid:\s*([a-f0-9-]+)\s*\n/m);
    return uidMatch ? uidMatch[1] : null;
  }

  /**
   * 创建增量改进任务
   */
  private async createIncrementalTask(
    uid: string,
    intent: string,
    currentContent: string
  ): Promise<Result<string>> {
    // 入队任务
    return await this.taskQueue.enqueue({
      nodeId: uid,
      taskType: "reason:incremental",
      maxAttempts: 3,
      payload: {
        intent,
        currentContent,
        filePath: this.file.path,
      },
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.intentInput = null;
  }
}
