/**
 * 笔记合并相关的 Modal 组件
 * 
 * 包含：
 * - MergeNameSelectionModal: 名称选择 Modal
 * - MergeDiffModal: 合并预览 Diff Modal
 */

import { App, Modal, Notice, Setting } from "obsidian";
import { renderSideBySideDiff } from "./diff-view";
import type { DuplicatePair } from "../types";

/**
 * 名称选择 Modal
 * 
 * 用户选择合并后的笔记名称：
 * 1. 保留原名（noteA）
 * 2. 使用被合并的名（noteB）
 * 3. 输入自定义名称
 */
export class MergeNameSelectionModal extends Modal {
  private selectedValue: string;
  private customInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private pair: DuplicatePair,
    private options: {
      onConfirm: (finalFileName: string, keepNodeId: string) => Promise<void>;
      onCancel: () => void;
    }
  ) {
    super(app);
    this.selectedValue = pair.noteA.name;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-merge-modal");

    // 标题
    contentEl.createEl("h2", { text: "选择合并后的笔记名称", cls: "cr-modal-title" });

    // 信息提示
    const infoEl = contentEl.createDiv({ cls: "cr-merge-info" });
    infoEl.createEl("p", {
      text: `将合并以下两个笔记：`,
      cls: "cr-info-label"
    });
    
    const notesList = infoEl.createDiv({ cls: "cr-notes-list" });
    notesList.createDiv({ text: this.pair.noteA.name, cls: "cr-note-item" });
    notesList.createDiv({ text: this.pair.noteB.name, cls: "cr-note-item" });
    
    const similarityBadge = infoEl.createDiv({ cls: "cr-similarity-badge" });
    similarityBadge.textContent = `相似度: ${(this.pair.similarity * 100).toFixed(1)}%`;

    // 选择保留哪个笔记
    contentEl.createEl("h3", { text: "1. 选择保留哪个笔记", cls: "cr-section-title" });
    const keepNoteSection = contentEl.createDiv({ cls: "cr-radio-group" });

    let keepNodeId = this.pair.noteA.nodeId;

    const createRadioCard = (
      container: HTMLElement, 
      name: string, 
      value: string, 
      groupName: string, 
      isChecked: boolean,
      onChange: () => void
    ) => {
      const label = container.createEl("label", { cls: "cr-radio-card" });
      const radio = label.createEl("input", { type: "radio", value });
      radio.name = groupName;
      radio.checked = isChecked;
      radio.addEventListener("change", onChange);
      
      const content = label.createDiv({ cls: "cr-radio-content" });
      content.createDiv({ text: `保留 "${name}"`, cls: "cr-radio-title" });
      content.createDiv({ text: "以此笔记的内容为主体", cls: "cr-radio-desc" });
      
      return radio;
    };

    const keepNoteARadio = createRadioCard(
      keepNoteSection, 
      this.pair.noteA.name, 
      "a", 
      "keep-note", 
      true, 
      () => { keepNodeId = this.pair.noteA.nodeId; }
    );

    const keepNoteBRadio = createRadioCard(
      keepNoteSection, 
      this.pair.noteB.name, 
      "b", 
      "keep-note", 
      false, 
      () => {
        keepNodeId = this.pair.noteB.nodeId;
        // 如果选择保留 B，且未输入自定义名称，默认名称也切换到 B
        if (!this.customInput?.value.trim()) {
          this.selectedValue = this.pair.noteB.name;
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

    const createNameRadio = (
      container: HTMLElement,
      name: string,
      isChecked: boolean,
      onChange: () => void
    ) => {
      const label = container.createEl("label", { cls: "cr-radio-row" });
      const radio = label.createEl("input", { type: "radio", value: name });
      radio.name = "merge-name";
      radio.checked = isChecked;
      radio.addEventListener("change", onChange);
      
      label.createSpan({ text: name, cls: "cr-radio-label-text" });
      return radio;
    };

    // 选项 1: 保留 noteA 的名称
    const optionARadio = createNameRadio(
      nameOptionsSection,
      this.pair.noteA.name,
      true,
      () => {
        this.selectedValue = this.pair.noteA.name;
        if (this.customInput) this.customInput.value = "";
      }
    );

    // 选项 2: 使用 noteB 的名称
    const optionBRadio = createNameRadio(
      nameOptionsSection,
      this.pair.noteB.name,
      false,
      () => {
        this.selectedValue = this.pair.noteB.name;
        if (this.customInput) this.customInput.value = "";
      }
    );

    // 选项 3: 自定义名称
    const customSection = contentEl.createDiv({ cls: "cr-custom-name-section" });
    customSection.createEl("label", { text: "或输入自定义名称:", cls: "cr-input-label" });

    this.customInput = customSection.createEl("input", {
      type: "text",
      placeholder: "输入新笔记名称（不含 .md 扩展名）",
      cls: "cr-input-full"
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
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 合并预览 Diff Modal
 * 
 * 显示合并前后的内容对比，用户确认后执行写入
 */
export class MergeDiffModal extends Modal {
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

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.style.width = "90%";
    this.modalEl.style.maxWidth = "1200px";

    contentEl.createEl("h2", { text: this.options.title });

    const badge = contentEl.createDiv({ cls: "merge-diff-badge" });
    badge.createEl("span", { text: "自动快照已启用", cls: "cr-badge" });

    const infoEl = contentEl.createDiv({ cls: "merge-diff-info" });
    infoEl.createEl("p", {
      text: `合并 "${this.options.deleteNoteName}" 到 "${this.options.keepNoteName}"`,
      cls: "merge-diff-description"
    });
    infoEl.createEl("p", {
      text: "操作前会为双方创建快照，可随时恢复。",
      cls: "merge-diff-warning"
    });

    const controlRow = contentEl.createDiv({ cls: "merge-diff-controls" });
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

    this.diffContainer = contentEl.createDiv({ cls: "merge-diff-panel" });
    this.fullPreviewContainer = contentEl.createDiv({ cls: "merge-full-preview" });
    this.renderDiffPanel();
    this.renderFullPreview();
    this.syncModeVisibility();

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "10px";

    const confirmBtn = buttonContainer.createEl("button", {
      text: "✓ 确认合并",
      cls: "mod-cta"
    });
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "处理中...";
      try {
        await this.options.onConfirm();
        this.close();
      } catch (error) {
        new Notice(`合并失败: ${String(error)}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = "✓ 确认合并";
      }
    };

    const cancelBtn = buttonContainer.createEl("button", {
      text: "✕ 取消"
    });
    cancelBtn.onclick = () => {
      this.options.onCancel();
      this.close();
    };
  }

  onClose(): void {
    this.diffContainer = null;
    this.fullPreviewContainer = null;
    const { contentEl } = this;
    contentEl.empty();
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
    this.fullPreviewContainer.addClass("merge-full-preview");

    const wrapper = this.fullPreviewContainer.createDiv({ cls: "merge-full-grid" });
    const beforeBox = wrapper.createDiv({ cls: "merge-full-box" });
    beforeBox.createEl("h4", { text: `原内容 (${this.options.keepNoteName})` });
    const beforeScroll = beforeBox.createDiv({ cls: "merge-full-content" });
    beforeScroll.createEl("pre", {
      text: this.options.beforeContent,
      cls: "merge-full-pre"
    });

    const afterBox = wrapper.createDiv({ cls: "merge-full-box" });
    afterBox.createEl("h4", { text: "合并后内容" });
    const afterScroll = afterBox.createDiv({ cls: "merge-full-content" });
    afterScroll.createEl("pre", {
      text: this.options.afterContent,
      cls: "merge-full-pre"
    });
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
