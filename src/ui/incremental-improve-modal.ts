/**
 * IncrementalImproveModal - 增量改进意图输入框
 * 
 * 功能：
 * - 输入改进意图
 * - 生成 reason:incremental 任务
 */

import { Modal, App, Notice, TFile } from "obsidian";
import { PipelineOrchestrator } from "../core/pipeline-orchestrator";
import { CRType, NoteState, Result } from "../types";

/**
 * 增量改进模态框
 */
export class IncrementalImproveModal extends Modal {
  private file: TFile;
  private pipeline: PipelineOrchestrator;
  private intentInput: HTMLTextAreaElement | null = null;

  constructor(app: App, file: TFile, pipeline: PipelineOrchestrator) {
    super(app);
    this.file = file;
    this.pipeline = pipeline;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-incremental-improve-modal");
    contentEl.addClass("cr-scope");

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
    const description = contentEl.createDiv({ cls: "cr-description" });
    description.createEl("p", {
      text: "请描述您希望如何改进这篇笔记。AI 将根据您的意图生成改进后的内容。",
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
        placeholder: "例如：\n- 添加更多实际应用示例\n- 扩展理论背景和历史发展\n- 改进语言表达，使其更易理解\n- 补充相关研究和参考链接\n- 添加图表或可视化说明\n- 增加与其他概念的关联",
        rows: "8",
        "aria-label": "改进意图输入框"
      }
    });

    // 自动聚焦
    this.intentInput.focus();

    // 提示信息
    const hints = contentEl.createDiv({ cls: "cr-hints-section" });
    
    hints.createEl("div", {
      text: "💡 提示：描述越具体，AI 生成的改进内容越符合您的期望。",
      cls: "cr-hint cr-hint-primary"
    });

    // 示例建议
    const examples = hints.createDiv({ cls: "cr-examples" });
    examples.createEl("div", {
      text: "常见改进方向：",
      cls: "cr-examples-title"
    });

    const examplesList = examples.createEl("ul", { cls: "cr-examples-list" });
    
    const exampleItems = [
      { icon: "📝", text: "内容扩展：添加更多细节、案例或数据支持" },
      { icon: "🔗", text: "关联补充：建立与其他概念的联系和引用" },
      { icon: "✨", text: "表达优化：改进语言流畅度和可读性" },
      { icon: "📊", text: "结构调整：重新组织内容层次和逻辑" },
      { icon: "🎯", text: "重点突出：强调核心观点和关键信息" },
    ];

    exampleItems.forEach(item => {
      const li = examplesList.createEl("li");
      li.createSpan({ text: item.icon, cls: "cr-example-icon" });
      li.createSpan({ text: item.text, cls: "cr-example-text" });
    });

    // 快捷键提示
    hints.createEl("div", {
      text: "⌨️ 快捷键：Ctrl/Cmd + Enter 提交",
      cls: "cr-hint cr-hint-secondary"
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
      const content = await this.app.vault.read(this.file);
      const fm = this.extractFrontmatter(content);
      if (!fm) {
        new Notice("无法从笔记中提取 UID/类型，请确保 frontmatter 完整");
        return;
      }

      const taskResult = this.createIncrementalTask(
        fm.uid,
        fm.type,
        fm.status,
        intent,
        content
      );

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

  private extractFrontmatter(content: string): { uid: string; type: CRType; status?: NoteState } | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;
    const text = match[1];
    const lines = text.split("\n");
    let uid: string | null = null;
    let type: CRType | null = null;
    let status: NoteState | undefined;

    lines.forEach((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return;
      const key = line.substring(0, idx).trim();
      const value = line.substring(idx + 1).trim();
      if (key === "uid") uid = value;
      if (key === "type") type = value as CRType;
      if (key === "status") status = value as NoteState;
    });

    if (uid && type) {
      return { uid, type, status };
    }
    return null;
  }

  /**
   * 创建增量改进任务
   */
  private createIncrementalTask(
    uid: string,
    noteType: CRType,
    status: NoteState | undefined,
    intent: string,
    currentContent: string
  ): Result<string> {
    return this.pipeline.startIncrementalPipeline({
      nodeId: uid,
      filePath: this.file.path,
      noteType,
      currentContent,
      userIntent: intent,
      currentStatus: status
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.intentInput = null;
  }
}
