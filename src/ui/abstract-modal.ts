import { App, Modal } from "obsidian";
import type { CRType } from "../types";
import type { AbstractCandidate } from "../core/deepen-orchestrator";

interface AbstractModalLabels {
  titlePrefix: string;
  instruction: string;
  similarity: string;
  confirm: string;
  cancel: string;
  empty: string;
}

interface AbstractModalOptions {
  currentTitle: string;
  currentType: CRType;
  candidates: AbstractCandidate[];
  labels: AbstractModalLabels;
  onConfirm: (selected: AbstractCandidate[]) => void | Promise<void>;
  onCancel?: () => void;
}

export class AbstractModal extends Modal {
  private options: AbstractModalOptions;
  private selected: Set<string>;
  private confirmBtn: HTMLButtonElement | null = null;

  constructor(app: App, options: AbstractModalOptions) {
    super(app);
    this.options = options;
    this.selected = new Set();
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-scope");
    contentEl.addClass("cr-abstract-modal");

    const title = this.options.labels.titlePrefix
      ? `${this.options.labels.titlePrefix}${this.options.currentTitle}`
      : `抽象：${this.options.currentTitle}`;
    contentEl.createEl("h2", { text: title });

    contentEl.createDiv({ text: this.options.labels.instruction, cls: "cr-abstract-hint" });

    this.renderList(contentEl);
    this.renderActions(contentEl);
    this.updateConfirmState();
  }

  onClose(): void {
    this.contentEl.empty();
    this.confirmBtn = null;
    this.selected.clear();
  }

  private renderList(container: HTMLElement): void {
    const existingList = container.querySelector(".cr-abstract-list");
    if (existingList) existingList.remove();

    const anchor = container.querySelector(".cr-abstract-actions");
    const list = container.createDiv({ cls: "cr-abstract-list" });
    if (anchor) {
      container.insertBefore(list, anchor);
    }

    if (this.options.candidates.length === 0) {
      list.createDiv({ text: this.options.labels.empty, cls: "cr-empty-text" });
      return;
    }

    this.options.candidates.forEach((item) => {
      const row = list.createDiv({ cls: "cr-abstract-item" });
      const key = item.uid;

      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selected.add(key);
        } else {
          this.selected.delete(key);
        }
        this.updateConfirmState();
      });

      const info = row.createDiv({ cls: "cr-abstract-info" });
      info.createDiv({ text: item.name, cls: "cr-abstract-name" });
      info.createDiv({
        text: `${this.options.labels.similarity}: ${(item.similarity * 100).toFixed(1)}%`,
        cls: "cr-abstract-similarity"
      });
      info.createDiv({ text: item.path, cls: "cr-abstract-path" });
    });
  }

  private renderActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "cr-abstract-actions" });
    this.confirmBtn = actions.createEl("button", { cls: "mod-cta" });
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
  }

  private updateConfirmState(): void {
    if (!this.confirmBtn) return;
    const count = this.selected.size;
    this.confirmBtn.textContent = `${this.options.labels.confirm} (${count + 1})`;
    this.confirmBtn.disabled = count === 0;
  }
}
