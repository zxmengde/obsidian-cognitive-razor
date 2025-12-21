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
import { AbstractModal } from "./abstract-modal";

// ============================================================================
// ConfirmModal - 确认对话框
// ============================================================================

/**
 * 确认 Modal
 */
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

    const messageEl = contentEl.createDiv({ cls: "modal-message" });
    messageEl.textContent = this.options.message;
    messageEl.style.marginBottom = "1em";

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button", {
      text: this.options.cancelText || "取消"
    });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", {
      text: this.options.confirmText || "确认",
      cls: this.options.danger ? "mod-warning" : "mod-cta"
    });
    confirmBtn.addEventListener("click", () => {
      this.options.onConfirm();
      this.close();
    });

    setTimeout(() => confirmBtn.focus(), 10);
  }

  onClose(): void {
    super.onClose();
  }
}

// ============================================================================
// ProviderConfigModal - Provider 配置对话框
// ============================================================================

/**
 * Provider 配置 Modal
 */
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

    const modalTitle = this.options.title ?? (this.options.mode === "add" ? "添加 AI Provider" : "编辑 AI Provider");
    contentEl.createEl("h2", { text: modalTitle });

    // 说明文字
    const descEl = contentEl.createDiv({ cls: "modal-description" });
    descEl.textContent = "配置 OpenAI 兼容的 API 服务（如 Gemini、OpenAI、Azure OpenAI 等）。";
    descEl.style.marginBottom = "1.5em";
    descEl.style.color = "var(--text-muted)";

    const formEl = contentEl.createDiv({ cls: "modal-form" });

    // === 基础配置 ===
    const basicSection = formEl.createDiv({ cls: "modal-section" });
    basicSection.createEl("h3", { text: "基础配置", cls: "modal-section-title" });

    // Provider ID
    const idSetting = new Setting(basicSection)
      .setName("Provider ID")
      .setDesc("唯一标识符，建议使用英文字母和连字符，例如: my-openai");

    this.providerIdInput = idSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "my-openai",
      value: this.options.providerId || ""
    });
    this.providerIdInput.style.width = "100%";

    if (this.options.mode === "edit") {
      this.providerIdInput.disabled = true;
    }

    // API Key
    const apiKeySetting = new Setting(basicSection)
      .setName("API Key")
      .setDesc("您的 API 密钥");

    this.apiKeyInput = apiKeySetting.controlEl.createEl("input", {
      type: "password",
      placeholder: "sk-...",
      value: this.options.currentConfig?.apiKey || ""
    });
    this.apiKeyInput.style.width = "calc(100% - 80px)";

    apiKeySetting.addButton(button => {
      button
        .setButtonText("显示")
        .onClick(() => {
          if (this.apiKeyInput) {
            const isPassword = this.apiKeyInput.type === "password";
            this.apiKeyInput.type = isPassword ? "text" : "password";
            button.setButtonText(isPassword ? "隐藏" : "显示");
          }
        });
    });



    // === 端点配置 ===
    const endpointSection = formEl.createDiv({ cls: "modal-section" });
    endpointSection.createEl("h3", { text: "端点配置", cls: "modal-section-title" });

    // 自定义端点
    const baseUrlSetting = new Setting(endpointSection)
      .setName("API 端点")
      .setDesc("留空使用默认端点 (Gemini: https://generativelanguage.googleapis.com/v1beta/openai/)");

    this.baseUrlInput = baseUrlSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "https://generativelanguage.googleapis.com/v1beta/openai/",
      value: this.options.currentConfig?.baseUrl || ""
    });
    this.baseUrlInput.style.width = "100%";

    // === 模型配置 ===
    const modelSection = formEl.createDiv({ cls: "modal-section" });
    modelSection.createEl("h3", { text: "默认模型", cls: "modal-section-title" });

    // 聊天模型
    const chatModelSetting = new Setting(modelSection)
      .setName("聊天模型")
      .setDesc("用于标准化、推理等任务");

    this.chatModelInput = chatModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "gemini-3-flash-preview",
      value: this.options.currentConfig?.defaultChatModel || "gemini-3-flash-preview"
    });
    this.chatModelInput.style.width = "100%";

    // 嵌入模型
    const embedModelSetting = new Setting(modelSection)
      .setName("嵌入模型")
      .setDesc("用于向量嵌入和语义搜索");

    this.embedModelInput = embedModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "text-embedding-3-small",
      value: this.options.currentConfig?.defaultEmbedModel || "text-embedding-3-small"
    });
    this.embedModelInput.style.width = "100%";

    this.errorEl = formEl.createDiv({ cls: "modal-error" });
    this.errorEl.style.display = "none";

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    const saveBtn = buttonContainer.createEl("button", {
      text: "保存",
      cls: "mod-cta"
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
      this.showError("请输入 Provider ID");
      return;
    }

    if (!apiKey) {
      this.showError("请输入 API Key");
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
      this.showError(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private validateUrl(url: string): string | null {
    if (!/^https?:\/\/.+/.test(url)) {
      return "URL 必须以 http:// 或 https:// 开头";
    }
    try {
      new URL(url);
      return null;
    } catch {
      return "无效的 URL 格式";
    }
  }

  private showError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
      this.errorEl.style.display = "block";
      this.errorEl.style.color = "var(--text-error)";
      this.errorEl.style.marginTop = "1em";
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
}
