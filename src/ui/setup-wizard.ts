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
import { safeErrorMessage } from "../types";
import { validateUrl } from "../data/validators";
import { COMMAND_IDS } from "./command-utils";
import { AbstractModal } from "./abstract-modal";
import { formatMessage } from "../core/i18n";

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
    contentEl.createEl("h1", {
      text: this.t("setupWizard.welcome.title", "Welcome to Cognitive Razor"),
      cls: "cr-wizard-title"
    });
    contentEl.createEl("p", {
      text: this.t("setupWizard.welcome.subtitle", "Turn ideas into structured concepts and evolve your knowledge graph."),
      cls: "cr-wizard-subtitle"
    });

    const list = contentEl.createEl("ul", { cls: "cr-wizard-list" });
    list.createEl("li", {
      text: this.t("setupWizard.welcome.featureDefineTagWrite", "Define -> Tag -> Write: full creation pipeline")
    });
    list.createEl("li", {
      text: this.t("setupWizard.welcome.featureMergeAmend", "Merge & Amend: safe diff confirmation")
    });
    list.createEl("li", {
      text: this.t("setupWizard.welcome.featureVector", "Vector index: deduplication & similarity search")
    });

    new Setting(contentEl)
      .setName(this.t("setupWizard.welcome.languageName", "Language"))
      .setDesc(this.t("setupWizard.welcome.languageDesc", "Select interface language"))
      .addDropdown(dropdown => {
        dropdown
          .addOption("zh", this.t("setupWizard.welcome.languageOptionZh", "中文"))
          .addOption("en", this.t("setupWizard.welcome.languageOptionEn", "English"))
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
      text: this.t("setupWizard.actions.getStarted", "Get started"),
      cls: "cr-btn-primary"
    });
    nextBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Provider;
      this.renderStep();
    });
  }

  private renderProvider(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", {
      text: this.t("setupWizard.provider.title", "Configure AI Provider"),
      cls: "cr-wizard-title"
    });

    const hint = contentEl.createDiv({ cls: "cr-config-hint" });
    hint.appendText(this.t("setupWizard.provider.apiKeyHintBeforeLink", "Get API Key from "));
    hint.createEl("a", { text: "Google AI Studio", href: "https://aistudio.google.com/apikey", attr: { target: "_blank" } });
    hint.appendText(this.t("setupWizard.provider.apiKeyHintAfterLink", ""));

    new Setting(contentEl)
      .setName("API Key")
      .setDesc(this.t("setupWizard.provider.apiKeyDesc", "Stored locally, never uploaded"))
      .addText(text => {
        text
          .setPlaceholder("AIza...")
          .setValue(this.apiKey)
          .onChange(value => this.apiKey = value);
        text.inputEl.type = "password";
      });

    new Setting(contentEl)
      .setName(this.t("setupWizard.provider.customEndpointName", "Custom Endpoint"))
      .setDesc(this.t("setupWizard.provider.customEndpointDesc", "Leave empty to use Gemini OpenAI-compatible endpoint"))
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
      .setName(this.t("setupWizard.provider.chatModelName", "Chat Model"))
      .addText(text => {
        text
          .setValue(this.chatModel)
          .onChange(value => this.chatModel = value);
      });

    new Setting(advancedSection)
      .setName(this.t("setupWizard.provider.embedModelName", "Embedding Model"))
      .addText(text => {
        text
          .setValue(this.embedModel)
          .onChange(value => this.embedModel = value);
      });

    const statusBox = contentEl.createDiv({ cls: "cr-validation" });
    this.renderValidation(statusBox);

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const backBtn = buttons.createEl("button", { text: this.t("setupWizard.actions.back", "Back") });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Welcome;
      this.renderStep();
    });

    const saveBtn = buttons.createEl("button", {
      text: this.t("setupWizard.actions.saveAndValidate", "Save & Validate"),
      cls: "cr-btn-primary"
    });
    saveBtn.addEventListener("click", () => this.saveConfig(saveBtn, statusBox, buttons));
  }

  private renderDirectory(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", {
      text: this.t("setupWizard.directory.title", "Initialize directories"),
      cls: "cr-wizard-title"
    });

    contentEl.createEl("p", {
      text: this.t("setupWizard.directory.subtitle", "Create directory structure for the 5 concept types."),
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
    const backBtn = buttons.createEl("button", { text: this.t("setupWizard.actions.back", "Back") });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Provider;
      this.renderStep();
    });

    const initBtn = buttons.createEl("button", {
      text: this.t("setupWizard.actions.createAndContinue", "Create & Continue"),
      cls: "cr-btn-primary"
    });
    initBtn.addEventListener("click", () => this.handleDirectoryInit(initBtn, statusBox, buttons));
  }

  private renderComplete(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", {
      text: this.t("setupWizard.complete.title", "Setup complete"),
      cls: "cr-wizard-title"
    });
    contentEl.createEl("p", {
      text: this.t("setupWizard.complete.subtitle", "Cognitive Razor is ready. Open the Workbench to get started."),
      cls: "cr-wizard-subtitle"
    });

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const openBtn = buttons.createEl("button", {
      text: this.t("setupWizard.actions.openWorkbench", "Open Workbench"),
      cls: "cr-btn-primary"
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

    if (status === "idle") {
      text.setText(this.t("setupWizard.validation.idle", "Not validated yet"));
    } else if (status === "checking") {
      text.setText(this.t("setupWizard.validation.checking", "Validating connection..."));
    } else if (status === "ok") {
      text.setText(message || this.t("setupWizard.validation.ok", "Connection successful"));
    } else if (status === "offline") {
      text.setText(message || this.t("setupWizard.validation.offline", "Network unavailable, you can continue"));
    } else {
      text.setText(message || this.t("setupWizard.validation.error", "Validation failed, please check configuration"));
    }
  }

  private renderDirectoryStatus(container: HTMLElement): void {
    container.empty();
    const { status, message } = this.directoryState;
    const text = container.createDiv({ cls: `cr-validation-${status}` });

    if (status === "idle") {
      text.setText(this.t("setupWizard.directoryStatus.idle", "Directories not initialized"));
    } else if (status === "creating") {
      text.setText(this.t("setupWizard.directoryStatus.creating", "Creating directories..."));
    } else if (status === "done") {
      text.setText(message || this.t("setupWizard.directoryStatus.done", "Directories initialized"));
    } else {
      text.setText(message || this.t("setupWizard.directoryStatus.error", "Directory initialization failed"));
    }
  }

  private async saveConfig(btn: HTMLButtonElement, statusBox: HTMLElement, buttonsContainer: HTMLElement): Promise<void> {
    if (!this.apiKey.trim()) {
      new Notice(this.t("setupWizard.notices.enterApiKey", "Please enter API Key"));
      return;
    }

    if (!this.providerId.trim()) {
      new Notice(this.t("setupWizard.notices.enterProviderId", "Please enter Provider ID"));
      return;
    }

    if (this.baseUrl.trim()) {
      const urlError = validateUrl(this.baseUrl);
      if (urlError) {
        new Notice(formatMessage(
          this.t("setupWizard.notices.invalidEndpointUrl", "Invalid endpoint URL: {message}"),
          { message: urlError }
        ));
        return;
      }
    }

    const originalText = btn.getText();
    btn.setText(this.t("setupWizard.actions.saving", "Saving..."));
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
        new Notice(formatMessage(
          this.t("setupWizard.notices.saveFailed", "Save failed: {message}"),
          { message: saveResult.error.message }
        ));
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
              message: this.t(
                "setupWizard.validation.offlineSaved",
                "Network unavailable, config saved, you can continue"
              ),
              showSkipButton: true
            };
            new Notice(this.t("setupWizard.notices.validationSkippedOffline", "Network unavailable, validation skipped"), 4500);
          } else {
            const errorMessage = formatMessage(
              this.t("setupWizard.validation.failedWithMessage", "Validation failed: {message}"),
              { message: checkResult.error.message }
            );
            this.validation = {
              status: "error",
              message: errorMessage,
              showSkipButton: true
            };
            new Notice(errorMessage);
            btn.setText(originalText);
            btn.disabled = false;
            this.renderValidation(statusBox);
            this.renderSkipButton(buttonsContainer, WizardStep.Directory);
            return;
          }
        } else {
          this.validation = { status: "ok", message: this.t("setupWizard.validation.ok", "Connection successful") };
        }
      } catch {
        this.validation = {
          status: "offline",
          message: this.t(
            "setupWizard.validation.offlineSavedByError",
            "Network error, config saved, you can continue"
          ),
          showSkipButton: true
        };
        new Notice(this.t("setupWizard.notices.validationSkippedNetworkError", "Network error, validation skipped"));
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
      const msg = safeErrorMessage(error, this.t("setupWizard.notices.saveErrorFallback", "Save error"));
      new Notice(formatMessage(
        this.t("setupWizard.notices.saveError", "Save error: {message}"),
        { message: msg }
      ));
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
    const originalText = btn.getText();
    btn.setText(this.t("setupWizard.actions.creating", "Creating..."));
    btn.disabled = true;
    this.directoryState = { status: "creating" };
    this.renderDirectoryStatus(statusBox);

    try {
      await this.initializeDirectories();
      this.directoryState = { status: "done", message: this.t("setupWizard.directoryStatus.done", "Directories initialized") };
      this.renderDirectoryStatus(statusBox);
      this.currentStep = WizardStep.Complete;
      this.renderStep();
    } catch (error) {
      const msg = safeErrorMessage(error, this.t("setupWizard.directoryStatus.createFailed", "Directory creation failed"));
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
    const skipBtn = buttonsContainer.createEl("button", {
      text: this.t("setupWizard.actions.skipAndContinue", "Skip and continue"),
      cls: "cr-skip-btn"
    });
    skipBtn.addEventListener("click", () => {
      this.currentStep = nextStep;
      this.renderStep();
    });
  }

  private t(path: string, fallback: string): string {
    const value = this.plugin.getI18n().t(path);
    return value === path ? fallback : value;
  }

  private executeCommand(commandId: string): void {
    const appWithCommands = this.plugin.app as unknown as {
      commands: { executeCommandById: (id: string) => boolean };
    };
    appWithCommands.commands.executeCommandById(commandId);
  }
}
