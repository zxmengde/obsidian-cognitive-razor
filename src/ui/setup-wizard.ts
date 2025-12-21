/**
 * SetupWizard - 首次配置向导
 *
 * 设计对齐：
 * - 13.3 首次运行向导（4 步）
 * - Provider 在线校验，离线可跳过
 * - 目录初始化：创建 5 个分类目录
 */

import { App, Notice, Setting } from "obsidian";
import type { DataAdapter } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderConfig, CRType } from "../types";
import { validateUrl } from "../data/validators";
import { COMMAND_IDS } from "./command-utils";
import { AbstractModal } from "./abstract-modal";

/**
 * 配置向导步骤
 */
enum WizardStep {
  Welcome = "welcome",
  Provider = "provider",
  Directory = "directory",
  Complete = "complete"
}

interface ValidationState {
  status: "idle" | "checking" | "ok" | "offline" | "error";
  message?: string;
  showSkipButton?: boolean;
}

interface DirectoryInitState {
  status: "idle" | "creating" | "done" | "error";
  message?: string;
  showSkipButton?: boolean;
}

/**
 * 配置向导模态框
 */
export class SetupWizard extends AbstractModal {
  private plugin: CognitiveRazorPlugin;
  private currentStep: WizardStep = WizardStep.Welcome;
  private providerId = "gemini";
  private apiKey = "";
  private baseUrl = "";
  private chatModel = "gemini-3-flash-preview";
  private embedModel = "text-embedding-3-small";
  private validation: ValidationState = { status: "idle" };
  private directoryState: DirectoryInitState = { status: "idle" };
  private selectedLanguage: "zh" | "en" = "zh";

  constructor(app: App, plugin: CognitiveRazorPlugin) {
    super(app);
    this.plugin = plugin;
    this.selectedLanguage = this.plugin.getComponents().settings.language;
  }

  protected renderContent(_contentEl: HTMLElement): void {
    this.renderStep();
  }

  onClose(): void {
    super.onClose();
  }

  /**
   * 渲染当前步骤
   */
  private renderStep(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-setup-wizard");
    this.modalEl.addClass("cr-setup-wizard-modal");
    this.plugin.getI18n().setLanguage(this.selectedLanguage);

    switch (this.currentStep) {
      case WizardStep.Welcome:
        this.renderWelcome();
        break;
      case WizardStep.Provider:
        this.renderProvider();
        break;
      case WizardStep.Directory:
        this.renderDirectory();
        break;
      case WizardStep.Complete:
        this.renderComplete();
        break;
      default:
        this.renderWelcome();
        break;
    }
  }

  private renderWelcome(): void {
    const { contentEl } = this;
    const isZh = this.selectedLanguage === "zh";

    contentEl.createEl("h1", {
      text: isZh ? "欢迎使用 Cognitive Razor" : "Welcome to Cognitive Razor",
      cls: "cr-wizard-title"
    });
    contentEl.createEl("p", {
      text: isZh
        ? "将想法快速转化为结构化概念，并持续演进知识图谱。"
        : "Turn ideas into structured concepts and evolve your knowledge graph.",
      cls: "cr-wizard-subtitle"
    });

    const list = contentEl.createEl("ul", { cls: "cr-wizard-list" });
    list.createEl("li", {
      text: isZh ? "定义 → 标注 → 写作：完整创建管线" : "Define → Tag → Write: full creation pipeline"
    });
    list.createEl("li", {
      text: isZh ? "合并与修订：安全的 Diff 确认" : "Merge & Amend: safe diff confirmation"
    });
    list.createEl("li", {
      text: isZh ? "向量索引：去重与相似检索" : "Vector index: deduplication & similarity search"
    });

    new Setting(contentEl)
      .setName(isZh ? "语言 / Language" : "Language / 语言")
      .setDesc(isZh ? "选择界面语言" : "Select interface language")
      .addDropdown(dropdown => {
        dropdown
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(this.selectedLanguage)
          .onChange(async (value: string) => {
            const lang = value as "zh" | "en";
            this.selectedLanguage = lang;
            const settings = this.plugin.getComponents().settings;
            settings.language = lang;
            await this.plugin.settingsStore.updateSettings(settings);
            this.plugin.getI18n().setLanguage(lang);
            this.renderStep();
          });
      });

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const nextBtn = buttons.createEl("button", {
      text: isZh ? "开始配置" : "Get started",
      cls: "mod-cta"
    });
    nextBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Provider;
      this.renderStep();
    });
  }

  private renderProvider(): void {
    const { contentEl } = this;
    const isZh = this.selectedLanguage === "zh";

    contentEl.createEl("h1", {
      text: isZh ? "配置 AI Provider" : "Configure AI Provider",
      cls: "cr-wizard-title"
    });

    const hint = contentEl.createDiv({ cls: "cr-config-hint" });
    hint.innerHTML = isZh
      ? '从 <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a> 获取 API Key'
      : 'Get API Key from <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>';

    new Setting(contentEl)
      .setName("API Key")
      .setDesc(isZh ? "本地保存，不会上传" : "Stored locally, never uploaded")
      .addText(text => {
        text
          .setPlaceholder("AIza...")
          .setValue(this.apiKey)
          .onChange(value => this.apiKey = value);
        text.inputEl.type = "password";
      });

    new Setting(contentEl)
      .setName(isZh ? "自定义端点" : "Custom Endpoint")
      .setDesc(isZh ? "留空使用 Gemini OpenAI 兼容端点" : "Leave empty to use Gemini OpenAI-compatible endpoint")
      .addText(text => {
        text
          .setPlaceholder("https://generativelanguage.googleapis.com/v1beta/openai/")
          .setValue(this.baseUrl)
          .onChange(value => this.baseUrl = value);
      });

    const advancedSection = contentEl.createDiv({ cls: "cr-advanced-section" });

    new Setting(advancedSection)
      .setName("Provider ID")
      .addText(text => {
        text
          .setPlaceholder("gemini")
          .setValue(this.providerId)
          .onChange(value => this.providerId = value);
      });

    new Setting(advancedSection)
      .setName(isZh ? "聊天模型" : "Chat Model")
      .addText(text => {
        text
          .setValue(this.chatModel)
          .onChange(value => this.chatModel = value);
      });

    new Setting(advancedSection)
      .setName(isZh ? "嵌入模型" : "Embedding Model")
      .addText(text => {
        text
          .setValue(this.embedModel)
          .onChange(value => this.embedModel = value);
      });

    const statusBox = contentEl.createDiv({ cls: "cr-validation" });
    this.renderValidation(statusBox);

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const backBtn = buttons.createEl("button", { text: isZh ? "上一步" : "Back" });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Welcome;
      this.renderStep();
    });

    const saveBtn = buttons.createEl("button", {
      text: isZh ? "保存并校验" : "Save & Validate",
      cls: "mod-cta"
    });
    saveBtn.addEventListener("click", () => this.saveConfig(saveBtn, statusBox, buttons));
  }

  private renderDirectory(): void {
    const { contentEl } = this;
    const isZh = this.selectedLanguage === "zh";

    contentEl.createEl("h1", {
      text: isZh ? "初始化目录" : "Initialize directories",
      cls: "cr-wizard-title"
    });

    contentEl.createEl("p", {
      text: isZh
        ? "将为 5 个概念类型创建目录结构。"
        : "Create directory structure for the 5 concept types.",
      cls: "cr-wizard-subtitle"
    });

    const list = contentEl.createDiv({ cls: "cr-directory-list" });
    const scheme = this.plugin.getComponents().settings.directoryScheme;
    const typeOrder: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];

    typeOrder.forEach(type => {
      const path = scheme[type];
      const item = list.createDiv({ cls: "cr-directory-item" });
      item.createDiv({ text: `${type}:`, cls: "cr-directory-label" });
      item.createDiv({ text: path || "-", cls: "cr-directory-path" });
    });

    const statusBox = contentEl.createDiv({ cls: "cr-validation" });
    this.renderDirectoryStatus(statusBox);

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const backBtn = buttons.createEl("button", { text: isZh ? "上一步" : "Back" });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Provider;
      this.renderStep();
    });

    const initBtn = buttons.createEl("button", {
      text: isZh ? "创建目录并继续" : "Create & Continue",
      cls: "mod-cta"
    });
    initBtn.addEventListener("click", () => this.handleDirectoryInit(initBtn, statusBox, buttons));
  }

  private renderComplete(): void {
    const { contentEl } = this;
    const isZh = this.selectedLanguage === "zh";

    contentEl.createEl("h1", {
      text: isZh ? "配置完成" : "Setup complete",
      cls: "cr-wizard-title"
    });
    contentEl.createEl("p", {
      text: isZh
        ? "Cognitive Razor 已准备就绪，打开工作台开始使用。"
        : "Cognitive Razor is ready. Open the Workbench to get started.",
      cls: "cr-wizard-subtitle"
    });

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const openBtn = buttons.createEl("button", {
      text: isZh ? "打开工作台" : "Open Workbench",
      cls: "mod-cta"
    });
    openBtn.addEventListener("click", () => {
      this.close();
      this.executeCommand(COMMAND_IDS.OPEN_WORKBENCH);
    });
  }

  private renderValidation(container: HTMLElement): void {
    container.empty();
    const { status, message } = this.validation;
    const text = container.createDiv({ cls: `cr-validation-${status}` });
    const isZh = this.selectedLanguage === "zh";

    if (status === "idle") {
      text.setText(isZh ? "尚未校验" : "Not validated yet");
    } else if (status === "checking") {
      text.setText(isZh ? "正在校验连接…" : "Validating connection...");
    } else if (status === "ok") {
      text.setText(message || (isZh ? "连接正常" : "Connection successful"));
    } else if (status === "offline") {
      text.setText(message || (isZh ? "网络不可用，可跳过继续" : "Network unavailable, you can continue"));
    } else {
      text.setText(message || (isZh ? "校验失败，请检查配置" : "Validation failed, please check configuration"));
    }
  }

  private renderDirectoryStatus(container: HTMLElement): void {
    container.empty();
    const { status, message } = this.directoryState;
    const text = container.createDiv({ cls: `cr-validation-${status}` });
    const isZh = this.selectedLanguage === "zh";

    if (status === "idle") {
      text.setText(isZh ? "尚未初始化目录" : "Directories not initialized");
    } else if (status === "creating") {
      text.setText(isZh ? "正在创建目录…" : "Creating directories...");
    } else if (status === "done") {
      text.setText(message || (isZh ? "目录已初始化" : "Directories initialized"));
    } else {
      text.setText(message || (isZh ? "目录初始化失败" : "Directory initialization failed"));
    }
  }

  private async saveConfig(btn: HTMLButtonElement, statusBox: HTMLElement, buttonsContainer: HTMLElement): Promise<void> {
    const isZh = this.selectedLanguage === "zh";

    if (!this.apiKey.trim()) {
      new Notice(isZh ? "请输入 API Key" : "Please enter API Key");
      return;
    }

    if (!this.providerId.trim()) {
      new Notice(isZh ? "请输入 Provider ID" : "Please enter Provider ID");
      return;
    }

    if (this.baseUrl.trim()) {
      const urlError = validateUrl(this.baseUrl);
      if (urlError) {
        new Notice(`${isZh ? "端点 URL 无效" : "Invalid endpoint URL"}: ${urlError}`);
        return;
      }
    }

    const originalText = btn.getText();
    btn.setText(isZh ? "保存中..." : "Saving...");
    btn.disabled = true;
    this.validation = { status: "checking" };
    this.renderValidation(statusBox);

    try {
      const config: ProviderConfig = {
        apiKey: this.apiKey.trim(),
        baseUrl: this.baseUrl.trim() || undefined,
        defaultChatModel: this.chatModel,
        defaultEmbedModel: this.embedModel,
        enabled: true
      };

      const providers = this.plugin.settings.providers;
      const hasProvider = !!providers[this.providerId];
      const saveResult = hasProvider
        ? await this.plugin.settingsStore.updateProvider(this.providerId, config)
        : await this.plugin.settingsStore.addProvider(this.providerId, config);

      if (!saveResult.ok) {
        new Notice(`${isZh ? "保存失败" : "Save failed"}: ${saveResult.error.message}`);
        btn.setText(originalText);
        btn.disabled = false;
        this.validation = { status: "error", message: saveResult.error.message, showSkipButton: true };
        this.renderValidation(statusBox);
        this.renderSkipButton(buttonsContainer, WizardStep.Directory);
        return;
      }

      try {
        const checkResult = await this.plugin.getComponents().providerManager.checkAvailability(this.providerId, true);
        if (!checkResult.ok) {
          const offline = checkResult.error.code === "E204_PROVIDER_ERROR" &&
            typeof checkResult.error.details === "object" &&
            (checkResult.error.details as { kind?: unknown } | null)?.kind === "network";
          if (offline) {
            this.validation = {
              status: "offline",
              message: isZh ? "网络不可用，配置已保存，可跳过继续" : "Network unavailable, config saved, you can continue",
              showSkipButton: true
            };
            new Notice(isZh ? "⚠️ 网络不可用，已跳过在线校验" : "⚠️ Network unavailable, validation skipped", 4500);
          } else {
            this.validation = {
              status: "error",
              message: `${isZh ? "校验失败" : "Validation failed"}：${checkResult.error.message}`,
              showSkipButton: true
            };
            new Notice(`${isZh ? "校验失败" : "Validation failed"}：${checkResult.error.message}`);
            btn.setText(originalText);
            btn.disabled = false;
            this.renderValidation(statusBox);
            this.renderSkipButton(buttonsContainer, WizardStep.Directory);
            return;
          }
        } else {
          this.validation = { status: "ok", message: isZh ? "连接正常" : "Connection successful" };
        }
      } catch (error) {
        this.validation = {
          status: "offline",
          message: isZh ? "网络错误，配置已保存，可跳过继续" : "Network error, config saved, you can continue",
          showSkipButton: true
        };
        new Notice(isZh ? "⚠️ 网络错误，已跳过校验" : "⚠️ Network error, validation skipped");
      }

      this.renderValidation(statusBox);

      if (this.validation.showSkipButton) {
        this.renderSkipButton(buttonsContainer, WizardStep.Directory);
        btn.setText(originalText);
        btn.disabled = false;
      } else {
        this.currentStep = WizardStep.Directory;
        this.renderStep();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${isZh ? "保存出错" : "Save error"}: ${msg}`);
      this.validation = { status: "error", message: msg, showSkipButton: true };
      this.renderValidation(statusBox);
      this.renderSkipButton(buttonsContainer, WizardStep.Directory);
      btn.setText(originalText);
      btn.disabled = false;
    }
  }

  private async handleDirectoryInit(
    btn: HTMLButtonElement,
    statusBox: HTMLElement,
    buttonsContainer: HTMLElement
  ): Promise<void> {
    const isZh = this.selectedLanguage === "zh";
    const originalText = btn.getText();
    btn.setText(isZh ? "创建中..." : "Creating...");
    btn.disabled = true;
    this.directoryState = { status: "creating" };
    this.renderDirectoryStatus(statusBox);

    try {
      await this.initializeDirectories();
      this.directoryState = { status: "done", message: isZh ? "目录已初始化" : "Directories initialized" };
      this.renderDirectoryStatus(statusBox);
      this.currentStep = WizardStep.Complete;
      this.renderStep();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.directoryState = { status: "error", message: msg, showSkipButton: true };
      this.renderDirectoryStatus(statusBox);
      this.renderSkipButton(buttonsContainer, WizardStep.Complete);
      btn.setText(originalText);
      btn.disabled = false;
    }
  }

  private async initializeDirectories(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    const scheme = this.plugin.getComponents().settings.directoryScheme;
    const directories = Object.values(scheme)
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0);

    const uniqueDirs = Array.from(new Set(directories));
    for (const dir of uniqueDirs) {
      await this.ensureDirectory(dir, adapter);
    }
  }

  private async ensureDirectory(rawPath: string, adapter: DataAdapter): Promise<void> {
    const normalized = rawPath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return;
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const exists = await adapter.exists(current);
      if (!exists) {
        await adapter.mkdir(current);
      }
    }
  }

  private renderSkipButton(buttonsContainer: HTMLElement, nextStep: WizardStep): void {
    const existingSkipBtn = buttonsContainer.querySelector(".cr-skip-btn");
    if (existingSkipBtn) {
      return;
    }

    const isZh = this.selectedLanguage === "zh";
    const skipBtn = buttonsContainer.createEl("button", {
      text: isZh ? "跳过并继续" : "Skip and continue",
      cls: "cr-skip-btn"
    });
    skipBtn.addEventListener("click", () => {
      this.currentStep = nextStep;
      this.renderStep();
    });
  }

  private executeCommand(commandId: string): void {
    const appWithCommands = this.plugin.app as unknown as {
      commands: { executeCommandById: (id: string) => boolean };
    };
    appWithCommands.commands.executeCommandById(commandId);
  }
}
