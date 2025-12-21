import { Editor, MarkdownView, Notice, TFile, setIcon } from "obsidian";
import type { CRFrontmatter, CRType, StandardizedConcept, ImageGeneratePayload } from "../../types";
import type { WorkbenchSectionDeps } from "./workbench-section-deps";
import { SimpleInputModal } from "../simple-input-modal";
import type { ExpandPlan, HierarchicalPlan, AbstractPlan } from "../../core/expand-orchestrator";
import { ExpandModal } from "../expand-modal";
import { AbstractExpandModal } from "../abstract-expand-modal";
import { formatMessage } from "../../core/i18n";
import { VisualizationModal } from "../image-insert-modal";

export class CreateSection {
  private deps: WorkbenchSectionDeps;

  private conceptInput: HTMLInputElement | null = null;
  private standardizeBtn: HTMLButtonElement | null = null;
  private clearBtn: HTMLButtonElement | null = null;
  private typeConfidenceTableContainer: HTMLElement | null = null;
  private improveSection: HTMLElement | null = null;
  private improveBtn: HTMLButtonElement | null = null;
  private expandBtn: HTMLButtonElement | null = null;
  private insertImageBtn: HTMLButtonElement | null = null;
  private verifyBtn: HTMLButtonElement | null = null;

  private currentStandardizedData: StandardizedConcept | null = null;
  private pendingConceptInput: string | null = null;

  constructor(deps: WorkbenchSectionDeps) {
    this.deps = deps;
  }

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
        "title": clearLabel
      }
    });
    setIcon(this.clearBtn, "x");

    this.standardizeBtn = wrapper.createEl("button", {
      cls: "cr-search-action-btn",
      attr: {
        "aria-label": this.deps.t("workbench.createConcept.startButton"),
        "title": `${this.deps.t("workbench.createConcept.defining")} (Enter)`
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
  }

  onClose(): void {
    this.conceptInput = null;
    this.standardizeBtn = null;
    this.clearBtn = null;
    this.typeConfidenceTableContainer = null;
    this.improveSection = null;
    this.improveBtn = null;
    this.expandBtn = null;
    this.insertImageBtn = null;
    this.verifyBtn = null;
    this.currentStandardizedData = null;
    this.pendingConceptInput = null;
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
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const activeFile = this.deps.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.openMarkdownFirst"));
      return;
    }

    const orchestrator = plugin.getComponents().pipelineOrchestrator;
    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.orchestratorNotInitialized"));
      return;
    }

    const modal = new SimpleInputModal(this.deps.app, {
      title: "修订笔记",
      placeholder: "请输入修订指令（例如：补充更多示例、优化定义、添加相关理论）",
      onSubmit: async (instruction) => {
        const result = orchestrator.startAmendPipeline(activeFile.path, instruction);
        if (result.ok) {
          new Notice(this.deps.t("workbench.notifications.improveStarted"));
        } else {
          this.deps.showErrorNotice(`启动失败: ${result.error.message}`);
        }
      }
    });

    modal.open();
  }

  async handleStartVerify(): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const activeFile = this.deps.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== "md") {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.openMarkdownFirst"));
      return;
    }

    const orchestrator = plugin.getComponents().pipelineOrchestrator;
    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.orchestratorNotInitialized"));
      return;
    }

    const result = orchestrator.startVerifyPipeline(activeFile.path);
    if (result.ok) {
      new Notice(this.deps.t("workbench.notifications.verifyStarted"));
    } else {
      this.deps.showErrorNotice(`启动失败: ${result.error.message}`);
    }
  }

  async handleStartExpand(file?: TFile): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    const targetFile = file ?? this.deps.app.workspace.getActiveFile();
    if (!targetFile || targetFile.extension !== "md") {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.openMarkdownFirst"));
      return;
    }

    const orchestrator = plugin.getComponents().expandOrchestrator;
    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("expand.notInitialized"));
      return;
    }

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
  }

  async startImageInsert(): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) return;

    const t = plugin.getI18n().t();
    const imgSettings = plugin.settings.imageGeneration;
    if (!imgSettings?.enabled) {
      new Notice(t.workbench.notifications.featureDisabled || "功能已关闭");
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

    const modal = new VisualizationModal(this.deps.app, {
      t,
      contextBefore: before,
      contextAfter: after,
      onConfirm: async (userPrompt) => {
        const orchestrator = plugin.getComponents().imageInsertOrchestrator;
        if (!orchestrator) {
          new Notice(this.deps.t("workbench.notifications.systemNotInitialized"));
          return;
        }
        const result = orchestrator.execute({
          userPrompt,
          contextBefore: before,
          contextAfter: after,
          frontmatter,
          filePath: file.path,
          cursorPosition: cursor
        } as unknown as ImageGeneratePayload);
        if (result.ok) {
          new Notice(t.workbench.notifications.imageTaskCreated || "图片生成任务已创建");
        } else {
          new Notice(result.error.message || (t.workbench.notifications.imageGenerationFailed || "图片生成任务创建失败"));
        }
      }
    });
    modal.open();
  }

  private updateImproveButtonState(): void {
    if (!this.improveBtn) {
      return;
    }
    const activeFile = this.deps.app.workspace.getActiveFile();
    const hasMarkdown = !!activeFile && activeFile.extension === "md";
    const improveLabel = this.deps.t("workbench.buttons.improveNote");
    const needMarkdownLabel = this.deps.t("workbench.notifications.openMarkdownFirst");
    if (this.improveSection) {
      this.improveSection.style.display = hasMarkdown ? "" : "none";
    }

    this.improveBtn.textContent = improveLabel;
    this.improveBtn.setAttr("aria-label", improveLabel);
    this.improveBtn.disabled = !hasMarkdown;
    this.improveBtn.setAttr("aria-disabled", String(!hasMarkdown));
    this.improveBtn.setAttr(
      "title",
      hasMarkdown ? improveLabel : needMarkdownLabel
    );

    if (this.expandBtn) {
      const label = this.deps.t("workbench.buttons.expand");
      this.expandBtn.textContent = label;
      this.expandBtn.setAttr("aria-label", label);
      this.expandBtn.disabled = !hasMarkdown;
      this.expandBtn.setAttr("aria-disabled", String(!hasMarkdown));
      this.expandBtn.setAttr("title", hasMarkdown ? label : needMarkdownLabel);
    }

    if (this.insertImageBtn) {
      const plugin = this.deps.getPlugin();
      const imgEnabled = plugin?.settings.imageGeneration?.enabled !== false;
      const label = this.deps.t("workbench.buttons.insertImage");
      this.insertImageBtn.textContent = label;
      this.insertImageBtn.setAttr("aria-label", label);
      this.insertImageBtn.disabled = !hasMarkdown || !imgEnabled;
      this.insertImageBtn.setAttr("aria-disabled", String(!hasMarkdown || !imgEnabled));
      this.insertImageBtn.setAttr(
        "title",
        !imgEnabled ? this.deps.t("workbench.notifications.featureDisabled") : hasMarkdown ? label : needMarkdownLabel
      );
    }

    if (this.verifyBtn) {
      const label = this.deps.t("workbench.buttons.verify");
      this.verifyBtn.textContent = label;
      this.verifyBtn.setAttr("aria-label", label);
      this.verifyBtn.disabled = !hasMarkdown;
      this.verifyBtn.setAttr("aria-disabled", String(!hasMarkdown));
      this.verifyBtn.setAttr("title", hasMarkdown ? label : needMarkdownLabel);
    }
  }

  private resetStandardizeButton(): void {
    if (this.standardizeBtn) {
      this.standardizeBtn.classList.remove("is-loading");
    }
    this.updateInputActionState();
  }

  private async handleStandardize(descriptionOverride?: string): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.systemNotInitialized"));
      return;
    }

    const description = (descriptionOverride ?? this.conceptInput?.value ?? "").trim();
    if (!description) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.enterDescription"));
      return;
    }

    if (this.conceptInput) {
      this.conceptInput.value = description;
    }

    this.updateInputActionState();

    if (this.standardizeBtn) {
      this.standardizeBtn.disabled = true;
      this.standardizeBtn.classList.add("is-loading");
    }
    if (this.clearBtn) {
      this.clearBtn.disabled = true;
    }

    try {
      const po = plugin.getComponents().pipelineOrchestrator;
      const result = await po.defineDirect(description);

      if (!result.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.standardizeFailed")}: ${result.error.message}`);
        return;
      }

      this.currentStandardizedData = result.value;
      this.renderTypeConfidenceTable(result.value);

      new Notice(this.deps.t("workbench.notifications.standardizeComplete"));
    } catch (error) {
      this.deps.logError("标准化失败", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.standardizeFailed")}: ${errorMessage}`);
    } finally {
      this.resetStandardizeButton();
    }
  }

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
        typeLabel.style.fontWeight = "600";
        typeLabel.style.color = "var(--interactive-accent)";
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
        cls: index === 0 ? "mod-cta cr-create-btn" : "cr-create-btn",
        attr: { "aria-label": `${this.deps.t("workbench.createConcept.create")} ${type}` }
      });

      createBtn.addEventListener("click", () => {
        void this.handleCreateConcept(type, standardizedData);
      });
    });
  }

  private async handleCreateConcept(selectedType: CRType, standardizedData: StandardizedConcept): Promise<void> {
    const plugin = this.deps.getPlugin();
    if (!plugin) {
      this.deps.showErrorNotice(this.deps.t("workbench.notifications.pluginNotInitialized"));
      return;
    }

    try {
      const po = plugin.getComponents().pipelineOrchestrator;
      const result = po.startCreatePipelineWithStandardized(standardizedData, selectedType);

      if (!result.ok) {
        this.deps.showErrorNotice(`${this.deps.t("workbench.notifications.createFailed")}: ${result.error.message}`);
        return;
      }

      new Notice(`${this.deps.t("workbench.notifications.conceptCreated")} (${result.value})`);

      this.clearConceptInput();
    } catch (error) {
      this.deps.logError("创建概念失败", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
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
    const plugin = this.deps.getPlugin();
    if (!plugin) return;
    const orchestrator = plugin.getComponents().expandOrchestrator;
    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("expand.notInitialized"));
      return;
    }

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
    const plugin = this.deps.getPlugin();
    if (!plugin) return;
    const orchestrator = plugin.getComponents().expandOrchestrator;
    if (!orchestrator) {
      this.deps.showErrorNotice(this.deps.t("expand.notInitialized"));
      return;
    }

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
