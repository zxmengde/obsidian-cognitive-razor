/**
 * 通用 Modal 组件
 * 
 * 提供替代 prompt() 和 confirm() 的 Obsidian Modal 实现
 */

import { App, Modal, Setting } from "obsidian";
import type {
  ProviderConfig,
  ConfirmModalOptions,
  ProviderConfigModalOptions
} from "../types";

// ============================================================================
// ConfirmModal - 确认对话框
// ============================================================================

/**
 * 确认 Modal
 */
export class ConfirmModal extends Modal {
  private options: ConfirmModalOptions;

  constructor(app: App, options: ConfirmModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("cr-scope");
    contentEl.addClass("cr-scope");

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
    this.contentEl.empty();
  }
}

// ============================================================================
// ProviderConfigModal - Provider 配置对话框
// ============================================================================

/**
 * Provider 配置 Modal
 */
export class ProviderConfigModal extends Modal {
  private options: ProviderConfigModalOptions;
  private providerIdInput: HTMLInputElement | null = null;
  private apiKeyInput: HTMLInputElement | null = null;
  private baseUrlInput: HTMLInputElement | null = null;
  private chatModelInput: HTMLInputElement | null = null;
  private embedModelInput: HTMLInputElement | null = null;
  private persistToggle: boolean = true;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, options: ProviderConfigModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    modalEl.addClass("cr-scope");
    contentEl.addClass("cr-scope");

    const title = this.options.mode === "add" ? "添加 AI Provider" : "编辑 AI Provider";
    contentEl.createEl("h2", { text: title });

    const formEl = contentEl.createDiv({ cls: "modal-form" });

    // Provider ID
    const idSetting = new Setting(formEl)
      .setName("Provider ID")
      .setDesc("唯一标识符，例如: my-openai");

    this.providerIdInput = idSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "my-openai",
      value: this.options.providerId || ""
    });

    if (this.options.mode === "edit") {
      this.providerIdInput.disabled = true;
    }

    // API Key
    const apiKeySetting = new Setting(formEl)
      .setName("API Key")
      .setDesc("您的 API 密钥（默认写入本地 data.json，不会上传）");

    this.apiKeyInput = apiKeySetting.controlEl.createEl("input", {
      type: "password",
      placeholder: "sk-...",
      value: this.options.currentConfig?.apiKey || ""
    });

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

    new Setting(formEl)
      .setName("仅本次会话保存")
      .setDesc("开启后不会将 API Key 写入 data.json，重启需重新输入。关闭则明文存储在本地 data.json。")
      .addToggle(toggle => {
        this.persistToggle = this.options.currentConfig?.persistApiKey ?? true;
        toggle
          .setValue(!this.persistToggle)
          .onChange(value => {
            this.persistToggle = !value;
          });
      });

    // 自定义端点
    const baseUrlSetting = new Setting(formEl)
      .setName("自定义端点 (可选)")
      .setDesc("默认: https://api.openai.com/v1");

    this.baseUrlInput = baseUrlSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "https://api.openai.com/v1",
      value: this.options.currentConfig?.baseUrl || ""
    });

    // 聊天模型
    const chatModelSetting = new Setting(formEl)
      .setName("聊天模型")
      .setDesc("用于对话的模型");

    this.chatModelInput = chatModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "gpt-4o",
      value: this.options.currentConfig?.defaultChatModel || ""
    });

    // 嵌入模型
    const embedModelSetting = new Setting(formEl)
      .setName("嵌入模型")
      .setDesc("用于向量嵌入的模型");

    this.embedModelInput = embedModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: "text-embedding-3-small",
      value: this.options.currentConfig?.defaultEmbedModel || ""
    });

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
      defaultChatModel: chatModel || "gpt-4o",
      defaultEmbedModel: embedModel || "text-embedding-3-small",
      enabled: this.options.currentConfig?.enabled ?? true,
      persistApiKey: this.persistToggle
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
    this.contentEl.empty();
  }
}
