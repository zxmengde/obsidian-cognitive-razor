import { App } from "obsidian";
import type { CRType } from "../types";
import type { AbstractCandidate } from "../core/expand-orchestrator";
import { AbstractModal } from "./abstract-modal";

interface AbstractExpandModalLabels {
  titlePrefix: string;
  instruction: string;
  similarity: string;
  confirm: string;
  cancel: string;
  empty: string;
}

interface AbstractExpandModalOptions {
  currentTitle: string;
  currentType: CRType;
  candidates: AbstractCandidate[];
  labels: AbstractExpandModalLabels;
  onConfirm: (selected: AbstractCandidate[]) => void | Promise<void>;
  onCancel?: () => void;
}

export class AbstractExpandModal extends AbstractModal {
  private options: AbstractExpandModalOptions;
  private selected: Set<string>;
  private confirmBtn: HTMLButtonElement | null = null;
  private listContainer: HTMLElement | null = null;

  constructor(app: App, options: AbstractExpandModalOptions) {
    super(app);
    this.options = options;
    this.selected = new Set(options.candidates.map((c) => c.uid));
  }

  protected renderContent(contentEl: HTMLElement): void {
    contentEl.addClass("cr-abstract-expand-modal");
    contentEl.setAttr("role", "dialog");
    contentEl.setAttr("aria-modal", "true");

    const title = this.options.labels.titlePrefix
      ? `${this.options.labels.titlePrefix}${this.options.currentTitle}`
      : `抽象拓展：${this.options.currentTitle}`;
    const titleEl = contentEl.createEl("h2", { text: title });
    titleEl.id = `cr-abstract-expand-title-${Date.now()}`;
    contentEl.setAttr("aria-labelledby", titleEl.id);

    if (this.options.labels.instruction) {
      const instruction = contentEl.createDiv({ cls: "cr-abstract-instruction" });
      instruction.setText(this.options.labels.instruction);
    }

    this.listContainer = contentEl.createDiv({ cls: "cr-abstract-expand-list" });
    this.renderList();

    const actions = contentEl.createDiv({ cls: "cr-modal-buttons" });
    this.confirmBtn = actions.createEl("button", { cls: "cr-btn-primary" });
    this.confirmBtn.addEventListener("click", async () => {
      const selected = this.options.candidates.filter((c) => this.selected.has(c.uid));
      await this.options.onConfirm(selected);
      this.close();
    });

    const cancelBtn = actions.createEl("button", { text: this.options.labels.cancel });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    this.updateConfirmState();
  }

  onClose(): void {
    this.confirmBtn = null;
    this.listContainer = null;
    this.selected.clear();
    super.onClose();
  }

  private renderList(): void {
    if (!this.listContainer) return;
    this.listContainer.empty();

    if (this.options.candidates.length === 0) {
      this.listContainer.createDiv({ text: this.options.labels.empty, cls: "cr-empty-text" });
      return;
    }

    this.options.candidates.forEach((candidate) => {
      const row = this.listContainer!.createDiv({ cls: "cr-abstract-item" });
      row.setAttr("tabindex", "0");

      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(candidate.uid);
      checkbox.setAttr("tabindex", "-1");

      row.setAttr("role", "checkbox");
      row.setAttr("aria-checked", String(checkbox.checked));
      row.setAttr("aria-label", `${candidate.name}`);

      row.addEventListener("click", (e) => {
        if (e.target === checkbox) return;
        checkbox.click();
      });

      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          checkbox.click();
        }
      });

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selected.add(candidate.uid);
        } else {
          this.selected.delete(candidate.uid);
        }
        row.setAttr("aria-checked", String(checkbox.checked));
        this.updateConfirmState();
      });

      const info = row.createDiv({ cls: "cr-abstract-info" });
      info.createDiv({ text: candidate.name, cls: "cr-abstract-name" });
      info.createDiv({ text: candidate.path, cls: "cr-abstract-path" });
      info.createDiv({
        text: `${this.options.labels.similarity}: ${(candidate.similarity * 100).toFixed(1)}%`,
        cls: "cr-abstract-similarity"
      });
    });
  }

  private updateConfirmState(): void {
    if (!this.confirmBtn) return;
    const selectedCount = this.selected.size;
    this.confirmBtn.textContent = this.options.labels.confirm;
    this.confirmBtn.disabled = selectedCount === 0;
  }
}
