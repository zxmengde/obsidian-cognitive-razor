import { App, Modal } from "obsidian";
import type { CRType } from "../types";
import type { HierarchicalCandidate } from "../core/deepen-orchestrator";

interface DeepenModalLabels {
  titlePrefix: string;
  stats: {
    total: string;
    creatable: string;
    existing: string;
    invalid: string;
  };
  selectAll: string;
  deselectAll: string;
  confirm: string;
  cancel: string;
  existing: string;
  invalid: string;
  looseStructureHint?: string;
  empty: string;
}

interface DeepenModalOptions {
  parentTitle: string;
  parentType: CRType;
  currentType: CRType;
  candidates: HierarchicalCandidate[];
  looseStructure?: boolean;
  labels: DeepenModalLabels;
  onConfirm: (selected: HierarchicalCandidate[]) => void | Promise<void>;
  onCancel?: () => void;
}

export class DeepenModal extends Modal {
  private options: DeepenModalOptions;
  private selected: Set<string>;
  private confirmBtn: HTMLButtonElement | null = null;

  constructor(app: App, options: DeepenModalOptions) {
    super(app);
    this.options = options;
    this.selected = new Set(
      options.candidates
        .filter((c) => c.status === "creatable")
        .map((c) => this.buildKey(c))
    );
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-scope");
    contentEl.addClass("cr-deepen-modal");
    contentEl.setAttr("role", "dialog");
    contentEl.setAttr("aria-modal", "true");

    const title = this.options.labels.titlePrefix
      ? `${this.options.labels.titlePrefix}${this.options.parentTitle}`
      : `深化：${this.options.parentTitle}`;
    const titleEl = contentEl.createEl("h2", { text: title });
    titleEl.id = `cr-deepen-title-${Date.now()}`;
    contentEl.setAttr("aria-labelledby", titleEl.id);

    this.renderSummary(contentEl);
    if (this.options.looseStructure && this.options.labels.looseStructureHint) {
      const hint = contentEl.createDiv({ cls: "cr-deepen-hint" });
      hint.setText(this.options.labels.looseStructureHint);
    }

    this.renderControls(contentEl);
    this.renderList(contentEl);
    this.renderActions(contentEl);
    this.updateConfirmState();
  }

  onClose(): void {
    this.contentEl.empty();
    this.confirmBtn = null;
    this.selected.clear();
  }

  private renderSummary(container: HTMLElement): void {
    const total = this.options.candidates.length;
    const creatable = this.options.candidates.filter((c) => c.status === "creatable").length;
    const existing = this.options.candidates.filter((c) => c.status === "existing").length;
    const invalid = this.options.candidates.filter((c) => c.status === "invalid").length;

    const summary = container.createDiv({ cls: "cr-deepen-summary" });
    summary.createSpan({ text: `${this.options.labels.stats.total}: ${total}` });
    summary.createSpan({ text: `${this.options.labels.stats.creatable}: ${creatable}` });
    summary.createSpan({ text: `${this.options.labels.stats.existing}: ${existing}` });
    summary.createSpan({ text: `${this.options.labels.stats.invalid}: ${invalid}` });
  }

  private renderControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: "cr-deepen-controls" });
    const selectAll = controls.createEl("button", { text: this.options.labels.selectAll });
    const deselectAll = controls.createEl("button", { text: this.options.labels.deselectAll });

    selectAll.addEventListener("click", () => {
      this.options.candidates
        .filter((c) => c.status === "creatable")
        .forEach((c) => this.selected.add(this.buildKey(c)));
      this.updateConfirmState();
      this.renderList(container);
    });

    deselectAll.addEventListener("click", () => {
      this.selected.clear();
      this.updateConfirmState();
      this.renderList(container);
    });
  }

  private renderList(container: HTMLElement): void {
    const existingList = container.querySelector(".cr-deepen-list");
    if (existingList) existingList.remove();

    const anchor = container.querySelector(".cr-deepen-actions");
    const list = container.createDiv({ cls: "cr-deepen-list" });
    if (anchor) {
      container.insertBefore(list, anchor);
    }
    const grouped = new Map<CRType, HierarchicalCandidate[]>();
    this.options.candidates.forEach((c) => {
      const group = grouped.get(c.targetType) ?? [];
      group.push(c);
      grouped.set(c.targetType, group);
    });

    if (this.options.candidates.length === 0) {
      list.createDiv({ text: this.options.labels.empty, cls: "cr-empty-text" });
      return;
    }

    for (const [type, items] of grouped.entries()) {
      const groupEl = list.createDiv({ cls: "cr-deepen-group" });
      groupEl.createEl("h4", { text: `${type} (${items.length})` });

      items.forEach((item) => {
        const key = this.buildKey(item);
        const row = groupEl.createDiv({ cls: "cr-deepen-item" });
        row.setAttr("tabindex", "0");

        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.disabled = item.status !== "creatable";
        checkbox.checked = this.selected.has(key) && item.status === "creatable";
        checkbox.setAttr("tabindex", "-1");

        // 可访问性：将整行视为可切换项
        row.setAttr("role", "checkbox");
        row.setAttr("aria-checked", String(checkbox.checked));
        row.setAttr("aria-disabled", String(checkbox.disabled));
        row.setAttr("aria-label", `${item.targetType}: ${item.name}`);

        row.addEventListener("click", (e) => {
          if (e.target === checkbox) return;
          if (checkbox.disabled) return;
          checkbox.click();
        });

        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (!checkbox.disabled) {
              checkbox.click();
            }
            return;
          }

          // 可选：方向键在列表项之间移动焦点
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const all = Array.from(container.querySelectorAll(".cr-deepen-item[tabindex=\"0\"]")) as HTMLElement[];
            const idx = all.indexOf(row);
            if (idx < 0 || all.length === 0) return;
            const delta = e.key === "ArrowDown" ? 1 : -1;
            const next = all[(idx + delta + all.length) % all.length];
            next?.focus();
          }
        });

        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            this.selected.add(key);
          } else {
            this.selected.delete(key);
          }
          row.setAttr("aria-checked", String(checkbox.checked));
          this.updateConfirmState();
        });

        const info = row.createDiv({ cls: "cr-deepen-info" });
        info.createDiv({ text: `[[${item.name}]]`, cls: "cr-deepen-name" });
        if (item.description) {
          info.createDiv({ text: item.description, cls: "cr-deepen-desc" });
        }
        info.createDiv({ text: item.targetPath, cls: "cr-deepen-path" });

        if (item.status !== "creatable") {
          const badge = row.createDiv({ cls: "cr-deepen-badge" });
          badge.textContent = item.status === "existing" ? this.options.labels.existing : this.options.labels.invalid;
          if (item.reason) {
            badge.setAttr("title", item.reason);
          }
        }
      });
    }
  }

  private renderActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "cr-deepen-actions" });
    this.confirmBtn = actions.createEl("button", { cls: "mod-cta" });
    this.confirmBtn.addEventListener("click", async () => {
      const selected = this.options.candidates.filter((c) => this.selected.has(this.buildKey(c)));
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
    const selectedCount = this.selected.size;
    this.confirmBtn.textContent = `${this.options.labels.confirm} (${selectedCount})`;
    this.confirmBtn.disabled = selectedCount === 0;
  }

  private buildKey(item: HierarchicalCandidate): string {
    return `${item.targetType}::${item.name}`;
  }
}
