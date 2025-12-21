import { App, Notice, setIcon } from "obsidian";
import { AbstractModal } from "./abstract-modal";

interface VisualizationModalOptions {
  t: any;
  contextBefore: string;
  contextAfter: string;
  onConfirm: (userPrompt: string) => Promise<void> | void;
}

export class VisualizationModal extends AbstractModal {
  private options: VisualizationModalOptions;
  private promptInput: HTMLTextAreaElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private contextContainer: HTMLElement | null = null;

  constructor(app: App, options: VisualizationModalOptions) {
    super(app);
    this.options = options;
  }

  protected renderContent(contentEl: HTMLElement): void {
    const t = this.options.t.imageModal || {};
    contentEl.createEl("h2", { text: t.title || "生成图片" });

    const desc = contentEl.createDiv({ cls: "cr-modal-desc" });
    desc.setText(t.promptLabel || "描述你想要的图片");

    this.promptInput = contentEl.createEl("textarea", {
      cls: "cr-textarea",
      attr: {
        placeholder: t.promptPlaceholder || "例如：一个展示量子纠缠的示意图，使用简洁的线条和颜色..."
      }
    });
    this.promptInput.rows = 4;
    this.promptInput.addEventListener("input", () => this.syncConfirmState());

    // 上下文预览（可折叠）
    this.contextContainer = contentEl.createDiv({ cls: "cr-context-preview" });
    const header = this.contextContainer.createDiv({ cls: "cr-context-header" });
    header.setText(t.contextPreview || "上下文预览");
    const toggleIcon = header.createSpan({ cls: "cr-collapse-icon", attr: { "aria-hidden": "true" } });
    setIcon(toggleIcon, "chevron-right");
    const body = this.contextContainer.createDiv({ cls: "cr-context-body cr-collapsed" });
    header.addEventListener("click", () => {
      body.classList.toggle("cr-collapsed");
      toggleIcon.classList.toggle("is-expanded");
    });
    body.createEl("p", { text: this.options.contextBefore, cls: "cr-context-block" });
    body.createEl("p", { text: this.options.contextAfter, cls: "cr-context-block" });

    const actions = contentEl.createDiv({ cls: "cr-modal-buttons" });
    this.confirmBtn = actions.createEl("button", { text: t.generate || "生成", cls: "mod-cta" });
    const cancelBtn = actions.createEl("button", { text: t.cancel || "取消" });

    this.confirmBtn.addEventListener("click", () => this.handleSubmit());
    cancelBtn.addEventListener("click", () => this.close());

    this.syncConfirmState();
  }

  onClose(): void {
    this.promptInput = null;
    this.confirmBtn = null;
    this.contextContainer = null;
    super.onClose();
  }

  private syncConfirmState(): void {
    const value = this.promptInput?.value?.trim() || "";
    if (this.confirmBtn) {
      this.confirmBtn.disabled = value.length < 5 || value.length > 1000;
    }
  }

  private async handleSubmit(): Promise<void> {
    if (!this.promptInput || !this.confirmBtn) return;
    const value = this.promptInput.value.trim();
    if (value.length < 5) {
      new Notice("请输入至少 5 个字符的描述");
      return;
    }
    this.confirmBtn.disabled = true;
    try {
      await this.options.onConfirm(value);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      this.confirmBtn.disabled = false;
    }
  }
}
