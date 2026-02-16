/**
 * 通用 Modal 组件
 *
 * 提供替代 prompt() 和 confirm() 的 Obsidian Modal 实现
 */

import { App, Setting } from "obsidian";
import type {
  ProviderConfig,
  ConfirmModalOptions,
  ProviderConfigModalOptions
} from "../types";
import { safeErrorMessage } from "../types";
import { AbstractModal } from "./abstract-modal";
import { validateUrl as sharedValidateUrl } from "../data/validators";

// ============================================================================
// ConfirmModal - 确认对话框
// ============================================================================

export class ConfirmModal extends AbstractModal {
  private options: ConfirmModalOptions;

  constructor(app: App, options: ConfirmModalOptions) {
    super(app);
    this.options = options;
  }

  protected renderContent(contentEl: HTMLElement): void {
    const { modalEl } = this;
    modalEl.addClass("cr-scope");

    contentEl.createEl("h2", { text: this.options.title });

    const messageEl = contentEl.createDiv({ cls: "cr-modal-message" });
    messageEl.textContent = this.options.message;

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button", {
      text: this.options.cancelText || this.text("common.cancel", "Cancel")
    });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", {
      text: this.options.confirmText || this.text("common.confirm", "Confirm"),
      cls: this.options.danger ? "cr-btn-danger" : "cr-btn-primary"
    });
    confirmBtn.addEventListener("click", async () => {
      // 禁用按钮防止重复点击，等待异步完成后再关闭
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        await this.options.onConfirm();
      } catch {
        // 异步失败时恢复按钮，不关闭 Modal
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        return;
      }
      this.close();
    });

    setTimeout(() => confirmBtn.focus(), 10);
  }

  onClose(): void {
    super.onClose();
  }

  private text(path: string, fallback: string): string {
    const translator = this.options.t;
    if (!translator) {
      return fallback;
    }
    const value = translator(path);
    return value === path ? fallback : value;
  }
}

// ============================================================================
// ProviderConfigModal - Provider 配置对话框
// ============================================================================

export class ProviderConfigModal extends AbstractModal {
  private options: ProviderConfigModalOptions;
  private providerIdInput: HTMLInputElement | null = null;
  private apiKeyInput: HTMLInputElement | null = null;
  private baseUrlInput: HTMLInputElement | null = null;
  private chatModelInput: HTMLInputElement | null = null;
  private embedModelInput: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, options: ProviderConfigModalOptions) {
    super(app);
    this.options = options;
  }

  protected renderContent(contentEl: HTMLElement): void {
    const { modalEl } = this;
    modalEl.addClass("cr-scope");
    contentEl.addClass("cr-provider-config-modal");

    const modalTitle = this.options.title ?? (
      this.options.mode === "add"
        ? this.text("modals.addProvider.title", "Add AI Provider")
        : this.text("modals.editProvider.title", "Edit AI Provider")
    );
    contentEl.createEl("h2", { text: modalTitle });

    const descEl = contentEl.createDiv({ cls: "cr-modal-description" });
    descEl.textContent = this.text(
      "modals.providerConfig.description",
      "Configure an OpenAI-compatible API service (Gemini, OpenAI, Azure OpenAI, etc.)."
    );

    const formEl = contentEl.createDiv({ cls: "modal-form" });

    const basicSection = formEl.createDiv({ cls: "modal-section" });
    basicSection.createEl("h3", {
      text: this.text("modals.providerConfig.sections.basic", "Basic Configuration"),
      cls: "modal-section-title"
    });

    const idSetting = new Setting(basicSection)
      .setName(this.text("modals.providerConfig.fields.providerId", "Provider ID"))
      .setDesc(this.text("modals.providerConfig.fields.providerIdDesc", "Unique identifier, e.g. my-openai"));

    this.providerIdInput = idSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "my-openai",
      value: this.options.providerId || ""
    });
    this.providerIdInput.style.width = "100%";

    if (this.options.mode === "edit") {
      this.providerIdInput.disabled = true;
    }

    const apiKeySetting = new Setting(basicSection)
      .setName(this.text("modals.providerConfig.fields.apiKey", "API Key"))
      .setDesc(this.text("modals.providerConfig.fields.apiKeyDesc", "Your API key"));

    this.apiKeyInput = apiKeySetting.controlEl.createEl("input", {
      type: "password",
      placeholder: "sk-...",
      value: this.options.currentConfig?.apiKey || ""
    });
    this.apiKeyInput.style.width = "calc(100% - 80px)";

    apiKeySetting.addButton(button => {
      button
        .setButtonText(this.text("modals.providerConfig.showSecret", "Show"))
        .onClick(() => {
          if (this.apiKeyInput) {
            const isPassword = this.apiKeyInput.type === "password";
            this.apiKeyInput.type = isPassword ? "text" : "password";
            button.setButtonText(
              isPassword
                ? this.text("modals.providerConfig.hideSecret", "Hide")
                : this.text("modals.providerConfig.showSecret", "Show")
            );
          }
        });
    });

    const endpointSection = formEl.createDiv({ cls: "modal-section" });
    endpointSection.createEl("h3", {
      text: this.text("modals.providerConfig.sections.endpoint", "Endpoint Configuration"),
      cls: "modal-section-title"
    });

    const baseUrlSetting = new Setting(endpointSection)
      .setName(this.text("modals.providerConfig.fields.endpoint", "API Endpoint"))
      .setDesc(this.text(
        "modals.providerConfig.fields.endpointDesc",
        "Leave empty to use the default Gemini endpoint."
      ));

    this.baseUrlInput = baseUrlSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "https://generativelanguage.googleapis.com/v1beta/openai/",
      value: this.options.currentConfig?.baseUrl || ""
    });
    this.baseUrlInput.style.width = "100%";

    const modelSection = formEl.createDiv({ cls: "modal-section" });
    modelSection.createEl("h3", {
      text: this.text("modals.providerConfig.sections.model", "Default Model"),
      cls: "modal-section-title"
    });

    const chatModelSetting = new Setting(modelSection)
      .setName(this.text("modals.providerConfig.fields.chatModel", "Chat Model"))
      .setDesc(this.text("modals.providerConfig.fields.chatModelDesc", "Used for generation tasks"));

    this.chatModelInput = chatModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "gemini-3-flash-preview",
      value: this.options.currentConfig?.defaultChatModel || "gemini-3-flash-preview"
    });
    this.chatModelInput.style.width = "100%";

    const embedModelSetting = new Setting(modelSection)
      .setName(this.text("modals.providerConfig.fields.embedModel", "Embedding Model"))
      .setDesc(this.text("modals.providerConfig.fields.embedModelDesc", "Used for vector embedding and semantic search"));

    this.embedModelInput = embedModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "text-embedding-3-small",
      value: this.options.currentConfig?.defaultEmbedModel || "text-embedding-3-small"
    });
    this.embedModelInput.style.width = "100%";

    this.errorEl = formEl.createDiv({ cls: "cr-modal-error cr-hidden" });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button", {
      text: this.text("common.cancel", "Cancel")
    });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    const saveBtn = buttonContainer.createEl("button", {
      text: this.text("common.save", "Save"),
      cls: "cr-btn-primary"
    });
    saveBtn.addEventListener("click", () => this.handleSave());

    setTimeout(() => {
      if (this.options.mode === "add") {
        this.providerIdInput?.focus();
      } else {
        this.apiKeyInput?.focus();
      }
    }, 10);
  }

  private async handleSave(): Promise<void> {
    const providerId = this.providerIdInput?.value.trim() || "";
    const apiKey = this.apiKeyInput?.value.trim() || "";
    const baseUrl = this.baseUrlInput?.value.trim() || "";
    const chatModel = this.chatModelInput?.value.trim() || "";
    const embedModel = this.embedModelInput?.value.trim() || "";

    if (!providerId) {
      this.showError(this.text("modals.providerConfig.errors.providerIdRequired", "Please enter Provider ID"));
      return;
    }

    if (!apiKey) {
      this.showError(this.text("modals.providerConfig.errors.apiKeyRequired", "Please enter API Key"));
      return;
    }

    if (baseUrl) {
      const urlError = this.validateUrl(baseUrl);
      if (urlError) {
        this.showError(urlError);
        return;
      }
    }

    const config: ProviderConfig = {
      apiKey,
      baseUrl: baseUrl || undefined,
      defaultChatModel: chatModel || "gemini-3-flash-preview",
      defaultEmbedModel: embedModel || "text-embedding-3-small",
      enabled: this.options.currentConfig?.enabled ?? true
    };

    try {
      await this.options.onSave(providerId, config);
      this.close();
    } catch (error) {
      this.showError(`${this.text("modals.providerConfig.errors.saveFailed", "Save failed")}: ${safeErrorMessage(error, this.text("modals.providerConfig.errors.saveFailed", "Save failed"))}`);
    }
  }

  /**
   * URL 校验 — 委托给 validators.ts 共享实现（DRY）
   */
  private validateUrl(url: string): string | null {
    return sharedValidateUrl(url);
  }

  private showError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
      this.errorEl.removeClass("cr-hidden");
    }
  }

  onClose(): void {
    this.providerIdInput = null;
    this.apiKeyInput = null;
    this.baseUrlInput = null;
    this.chatModelInput = null;
    this.embedModelInput = null;
    this.errorEl = null;
    super.onClose();
  }

  private text(path: string, fallback: string): string {
    const translator = this.options.t;
    if (!translator) {
      return fallback;
    }
    const value = translator(path);
    return value === path ? fallback : value;
  }
}
