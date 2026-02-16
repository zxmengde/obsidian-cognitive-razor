import { App, Notice, setIcon } from "obsidian";
import { AbstractModal } from "./abstract-modal";

interface VisualizationModalOptions {
  t: (path: string) => string;
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
    contentEl.createEl("h2", { text: this.text("imageModal.title", "Generate Image") });

    const desc = contentEl.createDiv({ cls: "cr-modal-desc" });
    desc.setText(this.text("imageModal.promptLabel", "Describe the image you want"));

    this.promptInput = contentEl.createEl("textarea", {
      cls: "cr-textarea",
      attr: {
        placeholder: this.text(
          "imageModal.promptPlaceholder",
          "Example: A clean line-art diagram showing quantum entanglement with concise labels."
        )
      }
    });
    this.promptInput.rows = 4;
    this.promptInput.addEventListener("input", () => this.syncConfirmState());

    this.contextContainer = contentEl.createDiv({ cls: "cr-context-preview" });
    const header = this.contextContainer.createDiv({ cls: "cr-context-header" });
    header.setText(this.text("imageModal.contextPreview", "Context preview"));
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
    this.confirmBtn = actions.createEl("button", { text: this.text("imageModal.generate", "Generate"), cls: "cr-btn-primary" });
    const cancelBtn = actions.createEl("button", { text: this.text("imageModal.cancel", "Cancel") });

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
      new Notice(this.text("imageModal.promptTooShort", "Please enter at least 5 characters."));
      return;
    }

    this.confirmBtn.disabled = true;
    try {
      await this.options.onConfirm(value);
      this.close();
    } catch (error) {
      const safeMsg = error instanceof Error && error.message.length < 100
        ? error.message
        : this.text("imageModal.genericFailure", "Operation failed, please try again later");
      new Notice(safeMsg);
      this.confirmBtn.disabled = false;
    }
  }

  private text(path: string, fallback: string): string {
    const value = this.options.t(path);
    return value === path ? fallback : value;
  }
}
