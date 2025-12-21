/**
 * 笔记合并相关的 Modal 组件
 * 
 * 包含：
 * - MergeNameSelectionModal: 名称选择 Modal
 * - MergeDiffModal: 合并预览 Diff Modal
 */

import { App, Notice, Setting, setIcon } from "obsidian";
import { renderSideBySideDiff } from "./diff-view";
import type { DuplicatePair } from "../types";
import { AbstractModal } from "./abstract-modal";

/**
 * 名称选择 Modal
 * 
 * 用户选择合并后的笔记名称：
 * 1. 保留原名（noteA）
 * 2. 使用被合并的名（noteB）
 * 3. 输入自定义名称
 */
export class MergeNameSelectionModal extends AbstractModal {
  private selectedValue: string;
  private customInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private pair: DuplicatePair,
    private options: {
      onConfirm: (finalFileName: string, keepNodeId: string) => Promise<void>;
      onCancel: () => void;
      resolveName?: (nodeId: string) => string;
    }
  ) {
    super(app);
    this.selectedValue = this.resolveName(pair.nodeIdA);
  }

  protected renderContent(contentEl: HTMLElement): void {
    contentEl.addClass("cr-merge-modal");
    contentEl.setAttr("role", "dialog");
    contentEl.setAttr("aria-modal", "true");

    // 标题
    const titleEl = contentEl.createEl("h2", { text: "选择合并后的笔记名称", cls: "cr-modal-title" });
    titleEl.id = `cr-merge-title-${this.pair.id}`;
    contentEl.setAttr("aria-labelledby", titleEl.id);

    // 信息提示
    const infoEl = contentEl.createDiv({ cls: "cr-merge-info" });
    infoEl.createEl("p", {
      text: `将合并以下两个笔记：`,
      cls: "cr-info-label"
    });
    
    const notesList = infoEl.createDiv({ cls: "cr-notes-list" });
    const nameA = this.resolveName(this.pair.nodeIdA);
    const nameB = this.resolveName(this.pair.nodeIdB);
    notesList.createDiv({ text: nameA, cls: "cr-note-item" });
    notesList.createDiv({ text: nameB, cls: "cr-note-item" });
    
    const similarityBadge = infoEl.createDiv({ cls: "cr-similarity-badge" });
    similarityBadge.textContent = `相似度: ${(this.pair.similarity * 100).toFixed(1)}%`;

    // 选择保留哪个笔记
    contentEl.createEl("h3", { text: "1. 选择保留哪个笔记", cls: "cr-section-title" });
    const keepNoteSection = contentEl.createDiv({ cls: "cr-radio-group" });
    keepNoteSection.setAttr("role", "radiogroup");
    keepNoteSection.setAttr("aria-label", "选择保留哪个笔记");

    let keepNodeId = this.pair.nodeIdA;

    const updateRadioCardAria = (container: HTMLElement, groupName: string): void => {
      const cards = Array.from(container.querySelectorAll("label.cr-radio-card"));
      for (const card of cards) {
        const input = card.querySelector(`input[type="radio"][name="${groupName}"]`) as HTMLInputElement | null;
        if (!input) continue;
        card.setAttr("aria-checked", String(input.checked));
      }
    };

    const createRadioCard = (
      container: HTMLElement, 
      name: string, 
      value: string, 
      groupName: string, 
      isChecked: boolean,
      onChange: () => void
    ) => {
      const label = container.createEl("label", { cls: "cr-radio-card" });
      label.setAttr("tabindex", "0");
      label.setAttr("role", "radio");
      label.setAttr("aria-checked", String(isChecked));
      label.setAttr("aria-label", `保留“${name}”作为主体`);

      const radio = label.createEl("input", { type: "radio", value });
      radio.name = groupName;
      radio.checked = isChecked;
      radio.setAttr("tabindex", "-1");
      radio.setAttr("aria-label", `保留“${name}”`);
      radio.addEventListener("change", () => {
        onChange();
        updateRadioCardAria(container, groupName);
      });

      label.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          radio.click();
          return;
        }

        // 可选：方向键在卡片间移动并切换选择
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const cards = Array.from(container.querySelectorAll("label.cr-radio-card")) as HTMLElement[];
          const idx = cards.indexOf(label);
          if (idx < 0) return;
          const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
          const next = cards[(idx + delta + cards.length) % cards.length];
          next?.focus();
          const nextInput = next?.querySelector(`input[type=\"radio\"][name=\"${groupName}\"]`) as HTMLInputElement | null;
          nextInput?.click();
        }
      });
      
      const content = label.createDiv({ cls: "cr-radio-content" });
      content.createDiv({ text: `保留 "${name}"`, cls: "cr-radio-title" });
      content.createDiv({ text: "以此笔记的内容为主体", cls: "cr-radio-desc" });
      
      return radio;
    };

    const keepNoteARadio = createRadioCard(
      keepNoteSection, 
      nameA, 
      "a", 
      "keep-note", 
      true, 
      () => { keepNodeId = this.pair.nodeIdA; }
    );

    const keepNoteBRadio = createRadioCard(
      keepNoteSection, 
      nameB, 
      "b", 
      "keep-note", 
      false, 
      () => {
        keepNodeId = this.pair.nodeIdB;
        // 如果选择保留 B，且未输入自定义名称，默认名称也切换到 B
        if (!this.customInput?.value.trim()) {
          this.selectedValue = nameB;
          // 更新名称选择部分的选中状态 (需要重新渲染或手动更新 DOM，这里简化处理，假设用户会手动确认)
          // 更好的做法是让名称选择部分响应状态变化，但为了保持简单，这里暂不自动切换 UI 选中状态，只切换值
          // 或者我们可以触发名称选择部分的 radio 点击
          const nameRadios = document.getElementsByName("merge-name");
          if (nameRadios.length > 1) (nameRadios[1] as HTMLInputElement).click();
        }
      }
    );

    // 选择名称
    contentEl.createEl("h3", { text: "2. 选择合并后的名称", cls: "cr-section-title" });
    const nameOptionsSection = contentEl.createDiv({ cls: "cr-radio-group-vertical" });
    nameOptionsSection.setAttr("role", "radiogroup");
    nameOptionsSection.setAttr("aria-label", "选择合并后的名称");

    const createNameRadio = (
      container: HTMLElement,
      name: string,
      isChecked: boolean,
      onChange: () => void
    ) => {
      const label = container.createEl("label", { cls: "cr-radio-row" });
      label.setAttr("tabindex", "0");
      label.setAttr("role", "radio");
      label.setAttr("aria-checked", String(isChecked));
      label.setAttr("aria-label", `使用名称：${name}`);
      const radio = label.createEl("input", { type: "radio", value: name });
      radio.name = "merge-name";
      radio.checked = isChecked;
      radio.setAttr("tabindex", "-1");
      radio.setAttr("aria-label", `名称：${name}`);
      radio.addEventListener("change", () => {
        onChange();
        const rows = Array.from(container.querySelectorAll("label.cr-radio-row"));
        for (const row of rows) {
          const input = row.querySelector('input[type="radio"][name="merge-name"]') as HTMLInputElement | null;
          if (!input) continue;
          row.setAttr("aria-checked", String(input.checked));
        }
      });

      label.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          radio.click();
          return;
        }

        // 可选：方向键在选项间移动并切换选择
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const rows = Array.from(container.querySelectorAll("label.cr-radio-row")) as HTMLElement[];
          const idx = rows.indexOf(label);
          if (idx < 0) return;
          const delta = e.key === "ArrowDown" ? 1 : -1;
          const next = rows[(idx + delta + rows.length) % rows.length];
          next?.focus();
          const nextInput = next?.querySelector('input[type="radio"][name="merge-name"]') as HTMLInputElement | null;
          nextInput?.click();
        }
      });
      
      label.createSpan({ text: name, cls: "cr-radio-label-text" });
      return radio;
    };

    // 选项 1: 保留 noteA 的名称
    const optionARadio = createNameRadio(
      nameOptionsSection,
      nameA,
      true,
      () => {
        this.selectedValue = nameA;
        if (this.customInput) this.customInput.value = "";
      }
    );

    // 选项 2: 使用 noteB 的名称
    const optionBRadio = createNameRadio(
      nameOptionsSection,
      nameB,
      false,
      () => {
        this.selectedValue = nameB;
        if (this.customInput) this.customInput.value = "";
      }
    );

    // 选项 3: 自定义名称
    const customSection = contentEl.createDiv({ cls: "cr-custom-name-section" });
    customSection.createEl("label", { text: "或输入自定义名称:", cls: "cr-input-label" });

    this.customInput = customSection.createEl("input", {
      type: "text",
      placeholder: "输入新笔记名称（不含 .md 扩展名）",
      cls: "cr-input-full",
      attr: { "aria-label": "输入自定义笔记名称" }
    });

    this.customInput.oninput = () => {
      if (this.customInput && this.customInput.value.trim()) {
        this.selectedValue = this.customInput.value.trim();
        // 取消选中单选按钮
        optionARadio.checked = false;
        optionBRadio.checked = false;
      }
    };

    // 操作按钮
    const buttonContainer = contentEl.createDiv({ cls: "cr-modal-buttons" });

    const confirmBtn = buttonContainer.createEl("button", {
      text: "确认合并",
      cls: "mod-cta"
    });
    confirmBtn.onclick = async () => {
      const finalName = this.selectedValue.trim();
      if (!finalName) {
        new Notice("请选择或输入笔记名称");
        return;
      }

      // 验证文件名（不能包含非法字符）
      const invalidChars = /[\\/:*?"<>|]/;
      if (invalidChars.test(finalName)) {
        new Notice("文件名不能包含以下字符: \\ / : * ? \" < > |");
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = "处理中...";

      try {
        await this.options.onConfirm(finalName, keepNodeId);
        this.close();
      } catch (error) {
        new Notice(`启动合并失败: ${String(error)}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = "确认合并";
      }
    };

    const cancelBtn = buttonContainer.createEl("button", {
      text: "取消"
    });
    cancelBtn.onclick = () => {
      this.options.onCancel();
      this.close();
    };
  }

  onClose(): void {
    this.customInput = null;
    super.onClose();
  }

  private resolveName(nodeId: string): string {
    try {
      return this.options.resolveName ? this.options.resolveName(nodeId) : nodeId;
    } catch {
      return nodeId;
    }
  }
}

/**
 * 合并预览 Diff Modal
 * 
 * 显示合并前后的内容对比，用户确认后执行写入
 */
export class MergeDiffModal extends AbstractModal {
  private diffContainer: HTMLElement | null = null;
  private fullPreviewContainer: HTMLElement | null = null;
  private isDiffMode = true;
  private directionSwapped = false;

  constructor(
    app: App,
    private options: {
      title: string;
      keepNoteName: string;
      deleteNoteName: string;
      beforeContent: string;
      afterContent: string;
      onConfirm: () => Promise<void>;
      onCancel: () => void;
    }
  ) {
    super(app);
  }

  protected renderContent(contentEl: HTMLElement): void {
    contentEl.addClass("cr-merge-diff-modal");
    this.modalEl.addClass("cr-merge-diff-modal");
    contentEl.setAttr("role", "dialog");
    contentEl.setAttr("aria-modal", "true");

    contentEl.createEl("h2", { text: this.options.title });

    const badge = contentEl.createDiv({ cls: "cr-merge-diff-badge" });
    badge.createEl("span", { text: "自动快照已启用", cls: "cr-badge" });

    const infoEl = contentEl.createDiv({ cls: "cr-merge-diff-info" });
    infoEl.createEl("p", {
      text: `合并 "${this.options.deleteNoteName}" 到 "${this.options.keepNoteName}"`,
      cls: "cr-merge-diff-description"
    });
    infoEl.createEl("p", {
      text: "操作前会为双方创建快照，可随时恢复。",
      cls: "cr-merge-diff-warning"
    });

    const controlRow = contentEl.createDiv({ cls: "cr-merge-diff-controls" });
    const diffBtn = controlRow.createEl("button", {
      text: "差异视图",
      cls: "cr-toggle-btn cr-toggle-active"
    });
    const fullBtn = controlRow.createEl("button", {
      text: "完整视图",
      cls: "cr-toggle-btn"
    });
    const swapBtn = controlRow.createEl("button", {
      text: "交换方向",
      cls: "cr-toggle-btn"
    });

    diffBtn.addEventListener("click", () => {
      this.isDiffMode = true;
      diffBtn.addClass("cr-toggle-active");
      fullBtn.removeClass("cr-toggle-active");
      this.syncModeVisibility();
    });

    fullBtn.addEventListener("click", () => {
      this.isDiffMode = false;
      fullBtn.addClass("cr-toggle-active");
      diffBtn.removeClass("cr-toggle-active");
      this.syncModeVisibility();
    });

    swapBtn.addEventListener("click", () => {
      this.directionSwapped = !this.directionSwapped;
      this.renderDiffPanel();
    });

    this.diffContainer = contentEl.createDiv({ cls: "cr-merge-diff-panel" });
    this.fullPreviewContainer = contentEl.createDiv({ cls: "cr-merge-full-preview" });
    this.renderDiffPanel();
    this.renderFullPreview();
    this.syncModeVisibility();

    const buttonContainer = contentEl.createDiv({ cls: "cr-modal-button-container" });

    const confirmBtn = buttonContainer.createEl("button", {
      cls: "mod-cta"
    });
    const confirmIcon = confirmBtn.createSpan({ cls: "cr-btn-icon", attr: { "aria-hidden": "true" } });
    setIcon(confirmIcon, "check");
    const confirmLabel = confirmBtn.createSpan({ text: "确认合并" });
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmLabel.textContent = "处理中...";
      try {
        await this.options.onConfirm();
        this.close();
      } catch (error) {
        new Notice(`合并失败: ${String(error)}`);
        confirmBtn.disabled = false;
        confirmLabel.textContent = "确认合并";
      }
    };

    const cancelBtn = buttonContainer.createEl("button");
    const cancelIcon = cancelBtn.createSpan({ cls: "cr-btn-icon", attr: { "aria-hidden": "true" } });
    setIcon(cancelIcon, "x");
    cancelBtn.createSpan({ text: "取消" });
    cancelBtn.onclick = () => {
      this.options.onCancel();
      this.close();
    };
  }

  onClose(): void {
    this.diffContainer = null;
    this.fullPreviewContainer = null;
    super.onClose();
  }

  private renderDiffPanel(): void {
    if (!this.diffContainer) return;
    this.diffContainer.empty();
    const leftContent = this.directionSwapped ? this.options.afterContent : this.options.beforeContent;
    const rightContent = this.directionSwapped ? this.options.beforeContent : this.options.afterContent;
    const leftHeader = this.directionSwapped ? "合并后内容" : `原内容 (${this.options.keepNoteName})`;
    const rightHeader = this.directionSwapped ? `原内容 (${this.options.keepNoteName})` : "合并后内容";
    renderSideBySideDiff(
      this.diffContainer,
      leftContent,
      rightContent,
      leftHeader,
      rightHeader
    );
  }

  private renderFullPreview(): void {
    if (!this.fullPreviewContainer) return;
    this.fullPreviewContainer.empty();
    this.fullPreviewContainer.addClass("cr-merge-full-preview");

    const wrapper = this.fullPreviewContainer.createDiv({ cls: "cr-merge-full-grid" });
    const beforeBox = wrapper.createDiv({ cls: "cr-merge-full-box" });
    beforeBox.createEl("h4", { text: `原内容 (${this.options.keepNoteName})` });
    const beforeScroll = beforeBox.createDiv({ cls: "cr-merge-full-content" });
    beforeScroll.createEl("pre", {
      text: this.options.beforeContent,
      cls: "cr-merge-full-pre"
    });

    const afterBox = wrapper.createDiv({ cls: "cr-merge-full-box" });
    afterBox.createEl("h4", { text: "合并后内容" });
    const afterScroll = afterBox.createDiv({ cls: "cr-merge-full-content" });
    afterScroll.createEl("pre", {
      text: this.options.afterContent,
      cls: "cr-merge-full-pre"
    });

    this.bindSyncedScroll(beforeScroll, afterScroll);
  }

  /**
   * 同步两个滚动容器的滚动位置（用于左右内容对齐预览）
   * 使用 requestAnimationFrame 防止循环触发
   */
  private bindSyncedScroll(a: HTMLElement, b: HTMLElement): void {
    let syncing = false;
    let raf: number | null = null;

    const sync = (from: HTMLElement, to: HTMLElement) => {
      if (syncing) return;
      syncing = true;
      if (raf !== null) {
        cancelAnimationFrame(raf);
      }
      raf = requestAnimationFrame(() => {
        to.scrollTop = from.scrollTop;
        to.scrollLeft = from.scrollLeft;
        syncing = false;
        raf = null;
      });
    };

    a.addEventListener("scroll", () => sync(a, b), { passive: true });
    b.addEventListener("scroll", () => sync(b, a), { passive: true });
  }

  private syncModeVisibility(): void {
    if (this.diffContainer) {
      this.diffContainer.style.display = this.isDiffMode ? "block" : "none";
    }
    if (this.fullPreviewContainer) {
      this.fullPreviewContainer.style.display = this.isDiffMode ? "none" : "block";
    }
  }
}
