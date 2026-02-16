/**
 * CreateSection — 创建区组件
 *
 * 负责概念创建入口（Define → 类型选择 → 创建管线），
 * 以及 Amend/Expand/Visualize/Verify 操作按钮。
 *
 * 通过 CreateSectionDeps 注入依赖，不直接依赖 Plugin 实例。
 *
 * 需求: 6.1, 9.1, 9.2, 9.3, 9.4, 9.5, 8.4
 */

import { Editor, MarkdownView, Notice, TFile, setIcon } from "obsidian";
import type { CRFrontmatter, CRType, StandardizedConcept, ImageGeneratePayload } from "../../types";
import { safeErrorMessage } from "../../types";
import type { CreateSectionDeps } from "./workbench-section-deps";
import { WorkbenchSection } from "./workbench-section";
import { SimpleInputModal } from "../simple-input-modal";
import type { ExpandPlan, HierarchicalPlan, AbstractPlan } from "../../core/expand-orchestrator";
import { ExpandModal } from "../expand-modal";
import { AbstractExpandModal } from "../abstract-expand-modal";
import { formatMessage } from "../../core/i18n";
import { VisualizationModal } from "../image-insert-modal";

export class CreateSection extends WorkbenchSection<CreateSectionDeps> {
  private conceptInput: HTMLInputElement | null = null;
  private standardizeBtn: HTMLButtonElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private typeConfidenceTableContainer: HTMLElement | null = null;
  private improveSection: HTMLElement | null = null;
  private openNoteHint: HTMLElement | null = null;
  private improveBtn: HTMLButtonElement | null = null;
  private expandBtn: HTMLButtonElement | null = null;
  private insertImageBtn: HTMLButtonElement | null = null;
  private verifyBtn: HTMLButtonElement | null = null;

  private currentStandardizedData: StandardizedConcept | null = null;
  private pendingConceptInput: string | null = null;

  render(container: HTMLElement): void {
    const heroContainer = container.createDiv({ cls: "cr-hero-container" });
    const wrapper = heroContainer.createDiv({ cls: "cr-search-wrapper" });

    this.conceptInput = wrapper.createEl("input", {
      type: "text",
      cls: "cr-hero-input",
      attr: {
        placeholder: this.deps.t("workbench.createConcept.placeholder"),
        "aria-label": this.deps.t("workbench.createConcept.title")
      }
    });

    const clearLabel = this.deps.t("workbench.createConcept.clear");
    this.clearBtn = wrapper.createEl("button", {
      cls: "cr-search-clear-btn",
      attr: {
        "aria-label": clearLabel,
        "data-tooltip-position": "top"
      }
    });
    setIcon(this.clearBtn, "x");

    this.standardizeBtn = wrapper.createEl("button", {
      cls: "cr-search-action-btn",
      attr: {
        "aria-label": this.deps.t("workbench.createConcept.startButton"),
        "data-tooltip-position": "top"
      }
    });
    setIcon(this.standardizeBtn, "corner-down-left");

    this.clearBtn.disabled = true;
    this.standardizeBtn.disabled = true;

    this.standardizeBtn.addEventListener("click", () => void this.handleStandardize());
    this.clearBtn.addEventListener("click", () => {
      this.clearConceptInput();
    });

    this.conceptInput.addEventListener("input", () => {
      this.updateInputActionState();
    });

    this.conceptInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && this.conceptInput?.value.trim()) {
        e.preventDefault();
        void this.handleStandardize();
      }
    });

    this.improveSection = container.createDiv({ cls: "cr-improve-section" });

    // 无活跃笔记时的引导提示
    this.openNoteHint = container.createDiv({ cls: "cr-open-note-hint" });
    this.openNoteHint.textContent = this.deps.t("workbench.buttons.openNoteHint");
    this.openNoteHint.style.display = "none";

    const improveLabel = this.deps.t("workbench.buttons.improveNote");
    const expandLabel = this.deps.t("workbench.buttons.expand");
    const insertImageLabel = this.deps.t("workbench.buttons.insertImage");
    const verifyLabel = this.deps.t("workbench.buttons.verify");

    this.improveBtn = this.improveSection.createEl("button", {
      text: improveLabel,
      cls: "cr-btn-secondary",
      attr: { "aria-label": improveLabel }
    });
    this.improveBtn.addEventListener("click", () => {
      void this.handleStartAmend();
    });

    this.expandBtn = this.improveSection.createEl("button", {
      text: expandLabel,
      cls: "cr-btn-secondary",
      attr: { "aria-label": expandLabel }
    });
    this.expandBtn.addEventListener("click", () => {
      void this.handleStartExpand();
    });

    this.insertImageBtn = this.improveSection.createEl("button", {
      text: insertImageLabel,
      cls: "cr-btn-secondary",
      attr: { "aria-label": insertImageLabel }
    });
    this.insertImageBtn.addEventListener("click", () => {
      void this.startImageInsert();
    });

    this.verifyBtn = this.improveSection.createEl("button", {
      text: verifyLabel,
      cls: "cr-btn-secondary",
      attr: { "aria-label": verifyLabel }
    });
    this.verifyBtn.addEventListener("click", () => {
      void this.handleStartVerify();
    });

    this.updateImproveButtonState();
    this.deps.registerEvent(this.deps.app.workspace.on("active-leaf-change", () => {
      this.updateImproveButtonState();
    }));

    this.typeConfidenceTableContainer = container.createDiv({ cls: "cr-type-confidence-table" });
    this.typeConfidenceTableContainer.style.display = "none";
    this.typeConfidenceTableContainer.setAttr("aria-live", "polite");
  }

  update(): void {
    this.updateImproveButtonState();
    this.updateInputActionState();
  }

  dispose(): void {
    this.conceptInput = null;
    this.standardizeBtn = null;
    this.clearBtn = null;
    this.typeConfidenceTableContainer = null;
    this.improveSection = null;
    this.openNoteHint = null;
    this.improveBtn = null;
    this.expandBtn = null;
    this.insertImageBtn = null;
    this.verifyBtn = null;
    this.currentStandardizedData = null;
    this.pendingConceptInput = null;
  }

  /**
   * 兼容旧接口：WorkbenchPanel.onClose() 调用
   */
  onClose(): void {
    this.dispose();
  }

  async consumePendingInput(): Promise<void> {
    if (!this.pendingConceptInput) return;
    const value = this.pendingConceptInput;
    this.pendingConceptInput = null;
    if (this.conceptInput) {
      this.conceptInput.value = value;
    }
    await this.handleStandardize(value);
  }

  async startQuickCreate(description: string): Promise<void> {
    const value = description.trim();
    if (!value) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.enterDescription"));
      return;
    }

    this.pendingConceptInput = value;

    if (this.conceptInput) {
      this.conceptInput.value = value;
      await this.handleStandardize(value);
      this.pendingConceptInput = null;
    }
  }

  async handleStartAmend(): Promise<void> {
    const activeFile = this.deps.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.openMarkdownFirst"));
      return;
    }

    const orchestrator = this.deps.amendOrchestrator;

    const modal = new SimpleInputModal(this.deps.app, {
      title: this.deps.t("workbench.amendModal.title"),
      placeholder: this.deps.t("workbench.amendModal.placeholder"),
      t: this.deps.t,
      onSubmit: async (instruction) => {
        try {
          const result = orchestrator.startAmendPipeline(activeFile.path, instruction);
          if (result.ok) {
            new Notice(this.deps.t("workbench.notifications.improveStarted"));
          } else {
            this.deps.showErrorNotice(formatMessage(this.deps.t("workbench.notifications.startFailed"), { message: result.error.message }));
          }
        } catch (error) {
          this.deps.logError("启动修订管线失败", error);
          this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.startFailed")));
        }
      }
    });

    modal.open();
  }

  async handleStartVerify(): Promise<void> {
    const activeFile = this.deps.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.openMarkdownFirst"));
      return;
    }

    const orchestrator = this.deps.verifyOrchestrator;

    const result = orchestrator.startVerifyPipeline(activeFile.path);
    if (result.ok) {
      new Notice(this.deps.t("workbench.notifications.verifyStarted"));
    } else {
      this.deps.showErrorNotice(formatMessage(this.deps.t("workbench.notifications.startFailed"), { message: result.error.message }));
    }
  }

  async handleStartExpand(file?: TFile): Promise<void> {
    try {
      const targetFile = file ?? this.deps.app.workspace.getActiveFile();
      if (!targetFile || targetFile.extension !== "md") {
        this.deps.showErrorNotice(this.deps.t("workbench.notifications.openMarkdownFirst"));
        return;
      }

      const orchestrator = this.deps.expandOrchestrator;

      const prepareResult = await orchestrator.prepare(targetFile);
      if (!prepareResult.ok) {
        this.deps.showErrorNotice(prepareResult.error.message);
        return;
      }

      const plan = prepareResult.value as ExpandPlan;
      if (plan.mode === "hierarchical") {
        this.openHierarchicalExpand(plan as HierarchicalPlan);
      } else if (plan.mode === "abstract") {
        this.openAbstractExpand(plan as AbstractPlan);
      }
    } catch (error) {
      this.deps.logError("拓展操作失败", error);
      this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.startFailed")));
    }
  }

  async startImageInsert(): Promise<void> {
    try {
      const settings = this.deps.getSettings();
      const imgSettings = settings.imageGeneration;
      if (!imgSettings?.enabled) {
        new Notice(this.deps.t("workbench.notifications.featureDisabled") || "功能已关闭");
        return;
      }

      const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== "source") {
        new Notice(this.deps.t("workbench.notifications.openMarkdownFirst"));
        return;
      }
      const file = view.file;
      if (!file) {
        new Notice(this.deps.t("workbench.notifications.fileNotFound"));
        return;
      }

      const editor = view.editor;
      const cursor = editor.getCursor();
      const contextSize = imgSettings.contextWindowSize ?? 500;
      const { before, after } = this.getContextSegments(editor, cursor, contextSize);
      const frontmatter = this.buildFrontmatter(file);

      // 获取完整翻译对象传递给 Modal
      const modal = new VisualizationModal(this.deps.app, {
        t: this.deps.t,
        contextBefore: before,
        contextAfter: after,
        onConfirm: async (userPrompt) => {
          try {
            const orchestrator = this.deps.imageInsertOrchestrator;
            const result = orchestrator.execute({
              userPrompt,
              contextBefore: before,
              contextAfter: after,
              frontmatter,
              filePath: file.path,
              cursorPosition: cursor
            } as unknown as ImageGeneratePayload);
            if (result.ok) {
              new Notice(this.deps.t("workbench.notifications.imageTaskCreated"));
            } else {
              new Notice(result.error.message || this.deps.t("workbench.notifications.imageGenerationFailed"));
            }
          } catch (error) {
            this.deps.logError("图片生成任务创建失败", error);
            this.deps.showErrorNotice(safeErrorMessage(error, "图片生成任务创建失败"));
          }
        }
      });
      modal.open();
    } catch (error) {
      this.deps.logError("图片插入操作失败", error);
      this.deps.showErrorNotice(safeErrorMessage(error, this.deps.t("workbench.notifications.startFailed")));
    }
  }

  private updateImproveButtonState(): void {
    if (!this.improveBtn) {
      return;
    }
    const activeFile = this.deps.app.workspace.getActiveFile();
    const hasMarkdown = !!activeFile && activeFile.extension === "md";
    const improveLabel = this.deps.t("workbench.buttons.improveNote");
    const needMarkdownLabel = this.deps.t("workbench.notifications.openMarkdownFirst");

    // 需求 8.4：无活跃笔记时隐藏按钮行，显示引导提示
    if (this.improveSection) {
      this.improveSection.style.display = hasMarkdown ? "" : "none";
    }
    if (this.openNoteHint) {
      this.openNoteHint.style.display = hasMarkdown ? "none" : "";
    }

    this.improveBtn.textContent = improveLabel;
    this.improveBtn.setAttr("aria-label", improveLabel);
    this.improveBtn.disabled = !hasMarkdown;
    this.improveBtn.setAttr("aria-disabled", String(!hasMarkdown));
    this.improveBtn.setAttr("data-tooltip-position", "top");

    if (this.expandBtn) {
      const label = this.deps.t("workbench.buttons.expand");
      this.expandBtn.textContent = label;
      this.expandBtn.setAttr("aria-label", label);
      this.expandBtn.disabled = !hasMarkdown;
      this.expandBtn.setAttr("aria-disabled", String(!hasMarkdown));
      this.expandBtn.setAttr("data-tooltip-position", "top");
    }

    if (this.insertImageBtn) {
      const settings = this.deps.getSettings();
      const imgEnabled = settings.imageGeneration?.enabled !== false;
      const label = this.deps.t("workbench.buttons.insertImage");
      this.insertImageBtn.textContent = label;
      this.insertImageBtn.setAttr("aria-label", label);
      this.insertImageBtn.disabled = !hasMarkdown || !imgEnabled;
      this.insertImageBtn.setAttr("aria-disabled", String(!hasMarkdown || !imgEnabled));
      this.insertImageBtn.setAttr("data-tooltip-position", "top");
    }

    if (this.verifyBtn) {
      const label = this.deps.t("workbench.buttons.verify");
      this.verifyBtn.textContent = label;
      this.verifyBtn.setAttr("aria-label", label);
      this.verifyBtn.disabled = !hasMarkdown;
      this.verifyBtn.setAttr("aria-disabled", String(!hasMarkdown));
      this.verifyBtn.setAttr("data-tooltip-position", "top");
    }
  }

  private resetStandardizeButton(): void {
    if (this.standardizeBtn) {
      this.standardizeBtn.classList.remove("is-loading");
    }
    this.updateInputActionState();
  }

  /**
   * 处理 Define 操作（标准化）
   * 需求 9.1: 加载指示器
   * 需求 9.4: 失败时错误消息和重试入口
   */
  private async handleStandardize(descriptionOverride?: string): Promise<void> {
    const description = (descriptionOverride ?? this.conceptInput?.value ?? "").trim();
    if (!description) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.enterDescription"));
      return;
    }

    if (this.conceptInput) {
      this.conceptInput.value = description;
    }

    this.updateInputActionState();

    // 需求 9.1: 加载指示器 + 防重复提交
    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = true;
      this.standardizeBtn.classList.add("is-loading");
    }
    if (this.clearBtn) {
      this.clearBtn.disabled = true;
    }

    try {
      const result = await this.deps.createOrchestrator.defineDirect(description);

      if (!result.ok) {
        // 需求 9.4: Define 失败时显示错误消息
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.standardizeFailed")}: ${result.error.message}`);
        return;
      }

      this.currentStandardizedData = result.value;
      // 需求 9.2: 类型候选列表显示（置信度 + 用户覆盖）
      this.renderTypeConfidenceTable(result.value);

      new Notice(this.deps.t("workbench.notifications.standardizeComplete"));
    } catch (error) {
      this.deps.logError("标准化失败", error);
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.standardizeFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.standardizeFailed")}: ${errorMessage}`);
    } finally {
      // 需求 9.4: 重试入口 — 重置按钮状态，用户可再次点击
      this.resetStandardizeButton();
    }
  }

  /**
   * 渲染类型置信度表格
   * 需求 9.2: 类型候选列表（置信度 + 用户覆盖选择）
   */
  private renderTypeConfidenceTable(standardizedData: StandardizedConcept): void {
    if (!this.typeConfidenceTableContainer) return;

    this.typeConfidenceTableContainer.empty();
    this.typeConfidenceTableContainer.style.display = "block";

    const header = this.typeConfidenceTableContainer.createDiv({ cls: "cr-table-header" });
    header.createEl("h4", {
      text: this.deps.t("workbench.createConcept.selectType")
    });

    const table = this.typeConfidenceTableContainer.createEl("table", { cls: "cr-confidence-table" });

    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    headerRow.createEl("th", { text: this.deps.t("workbench.typeConfidenceTable.type") });
    headerRow.createEl("th", { text: this.deps.t("workbench.typeConfidenceTable.standardName") });
    headerRow.createEl("th", { text: this.deps.t("workbench.typeConfidenceTable.confidence") });
    headerRow.createEl("th", { text: this.deps.t("workbench.typeConfidenceTable.action") });

    const tbody = table.createEl("tbody");

    const typeConfidences = Object.entries(standardizedData.typeConfidences)
      .map(([type, confidence]) => ({
        type: type as CRType,
        confidence: confidence as number
      }))
      .sort((a, b) => b.confidence - a.confidence);

    typeConfidences.forEach(({ type, confidence }, index) => {
      const row = tbody.createEl("tr", { cls: "cr-confidence-row" });

      const typeCell = row.createEl("td", { cls: "cr-type-cell" });
      const typeLabel = typeCell.createEl("span", { text: type, cls: "cr-type-name" });
      if (index === 0) {
        typeLabel.addClass("cr-type-name-primary");
      }

      const nameCell = row.createEl("td", { cls: "cr-name-cell" });
      const typeName = standardizedData.standardNames[type];
      nameCell.createEl("span", {
        text: `${typeName.chinese} (${typeName.english})`,
        cls: "cr-standard-name"
      });

      const confidenceCell = row.createEl("td", { cls: "cr-confidence-cell" });
      const confidenceBar = confidenceCell.createDiv({ cls: "cr-confidence-bar" });
      const confidenceFill = confidenceBar.createDiv({ cls: "cr-confidence-fill" });
      confidenceFill.style.width = `${confidence * 100}%`;
      const confidenceLevel =
        confidence > 0.8 ? "high" : confidence > 0.6 ? "medium" : "low";
      confidenceFill.addClass(`cr-confidence-${confidenceLevel}`);

      confidenceCell.createEl("span", {
        text: `${(confidence * 100).toFixed(0)}%`,
        cls: "cr-confidence-percentage"
      });

      const actionCell = row.createEl("td", { cls: "cr-action-cell" });
      const createBtn = actionCell.createEl("button", {
        text: this.deps.t("workbench.createConcept.create"),
        cls: index === 0 ? "cr-btn-primary cr-create-btn" : "cr-create-btn",
        attr: { "aria-label": `${this.deps.t("workbench.createConcept.create")} ${type}` }
      });

      createBtn.addEventListener("click", () => {
        void this.handleCreateConcept(type, standardizedData);
      });
    });
  }

  /**
   * 处理创建概念（用户选择类型后）
   * 需求 9.3: 创建管线步骤名称显示
   */
  private async handleCreateConcept(selectedType: CRType, standardizedData: StandardizedConcept): Promise<void> {
    try {
      const result = this.deps.createOrchestrator.startCreatePipelineWithStandardized(standardizedData, selectedType);

      if (!result.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.createFailed")}: ${result.error.message}`);
        return;
      }

      new Notice(`${this.deps.t("workbench.notifications.conceptCreated")} (${result.value})`);

      // 需求 9.5: 清空输入时重置所有中间状态
      this.clearConceptInput();
    } catch (error) {
      this.deps.logError("创建概念失败", error);
      const errorMessage = safeErrorMessage(error, this.deps.t("workbench.notifications.createFailed"));
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.createFailed")}: ${errorMessage}`);
    }
  }

  private hideTypeConfidenceTable(): void {
    if (this.typeConfidenceTableContainer) {
      this.typeConfidenceTableContainer.style.display = "none";
      this.typeConfidenceTableContainer.empty();
    }
    this.currentStandardizedData = null;
  }

  private resetConceptInput(): void {
    if (this.conceptInput) {
      this.conceptInput.value = "";
      this.conceptInput.focus();
    }
  }

  /**
   * 清空输入并重置所有中间状态
   * 需求 9.5: 清空输入时重置所有中间状态
   */
  private clearConceptInput(): void {
    this.pendingConceptInput = null;
    this.hideTypeConfidenceTable();
    this.resetConceptInput();

    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = true;
      this.standardizeBtn.classList.remove("is-loading");
    }

    if (this.clearBtn) {
      this.clearBtn.disabled = true;
    }
  }

  private updateInputActionState(): void {
    const hasValue = Boolean(this.conceptInput?.value.trim());
    if (this.standardizeBtn && !this.standardizeBtn.classList.contains("is-loading")) {
      this.standardizeBtn.disabled = !hasValue;
    }
    if (this.clearBtn) {
      this.clearBtn.disabled = !hasValue;
    }
  }

  private openHierarchicalExpand(plan: HierarchicalPlan): void {
    const orchestrator = this.deps.expandOrchestrator;

    const labels = {
      titlePrefix: this.deps.t("expand.titlePrefix"),
      stats: {
        total: this.deps.t("expand.stats.total"),
        creatable: this.deps.t("expand.stats.creatable"),
        existing: this.deps.t("expand.stats.existing"),
        invalid: this.deps.t("expand.stats.invalid")
      },
      selectAll: this.deps.t("expand.selectAll"),
      deselectAll: this.deps.t("expand.deselectAll"),
      confirm: this.deps.t("expand.confirm"),
      cancel: this.deps.t("common.cancel"),
      existing: this.deps.t("expand.status.existing"),
      invalid: this.deps.t("expand.status.invalid"),
      looseStructureHint: this.deps.t("expand.looseStructureHint"),
      empty: this.deps.t("expand.empty")
    };

    const modal = new ExpandModal(this.deps.app, {
      parentTitle: plan.parentTitle,
      candidates: plan.candidates,
      looseStructure: plan.looseStructure,
      labels,
      onConfirm: async (selected) => {
        const result = await orchestrator.createFromHierarchical(plan, selected);
        if (result.ok) {
          const failed = result.value.failed.length;
          const started = result.value.started;
          const msg = failed > 0
            ? formatMessage(this.deps.t("expand.startedWithFailures"), { started, failed })
            : formatMessage(this.deps.t("expand.started"), { count: started });
          new Notice(msg);
        } else {
          this.deps.showErrorNotice(result.error.message);
        }
      },
      onCancel: () => {
        // no-op
      }
    });

    modal.open();
  }

  private openAbstractExpand(plan: AbstractPlan): void {
    const orchestrator = this.deps.expandOrchestrator;

    const labels = {
      titlePrefix: this.deps.t("expand.abstractTitlePrefix"),
      instruction: this.deps.t("expand.abstractInstruction"),
      similarity: this.deps.t("expand.similarity"),
      confirm: this.deps.t("expand.abstractConfirm"),
      cancel: this.deps.t("common.cancel"),
      empty: this.deps.t("expand.empty")
    };

    const modal = new AbstractExpandModal(this.deps.app, {
      currentTitle: plan.currentTitle,
      currentType: plan.currentType,
      candidates: plan.candidates,
      labels,
      onConfirm: async (selected) => {
        const result = await orchestrator.createFromAbstract(plan, selected);
        if (result.ok) {
          new Notice(formatMessage(this.deps.t("expand.started"), { count: 1 }));
        } else {
          this.deps.showErrorNotice(result.error.message);
        }
      },
      onCancel: () => {
        // no-op
      }
    });

    modal.open();
  }

  private getContextSegments(editor: Editor, cursor: { line: number; ch: number }, size: number): { before: string; after: string } {
    const full = editor.getValue();
    const offset = editor.posToOffset(cursor);
    const before = full.slice(Math.max(0, offset - size), offset);
    const after = full.slice(offset, offset + size);
    return { before, after };
  }

  private buildFrontmatter(file: TFile): CRFrontmatter {
    const cache = this.deps.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter || {};
    return {
      cruid: typeof fm.cruid === "string" ? fm.cruid : file.basename,
      type: (fm.type as CRFrontmatter["type"]) ?? "Entity",
      name: typeof fm.name === "string" ? fm.name : file.basename,
      definition: typeof fm.definition === "string" ? fm.definition : undefined,
      status: (fm.status as CRFrontmatter["status"]) ?? "Draft",
      created: typeof fm.created === "string" ? fm.created : "",
      updated: typeof fm.updated === "string" ? fm.updated : "",
      aliases: Array.isArray(fm.aliases) ? fm.aliases : undefined,
      tags: Array.isArray(fm.tags) ? fm.tags : undefined,
      parents: Array.isArray(fm.parents) ? fm.parents : [],
      sourceUids: Array.isArray(fm.sourceUids) ? fm.sourceUids : undefined,
      version: typeof fm.version === "string" ? fm.version : undefined
    };
  }
}
