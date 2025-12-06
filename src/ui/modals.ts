/**
 * 通用 Modal 组件
 * 
 * 提供替代 prompt() 和 confirm() 的 Obsidian Modal 实现
 */

import { App, Modal, Setting, Notice } from "obsidian";
import type {
  ProviderType,
  ProviderConfig,
  TextInputModalOptions,
  SelectOption,
  SelectModalOptions,
  ConfirmModalOptions,
  ProviderConfigModalOptions
} from "../types";

// ============================================================================
// TextInputModal - 文本输入对话框
// ============================================================================

/**
 * 文本输入 Modal
 */
export class TextInputModal extends Modal {
  private options: TextInputModalOptions;
  private inputEl: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, options: TextInputModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl("h2", { text: this.options.title });

    // 输入框容器
    const inputContainer = contentEl.createDiv({ cls: "modal-input-container" });

    // 输入框
    this.inputEl = inputContainer.createEl("input", {
      type: "text",
      placeholder: this.options.placeholder || "",
      value: this.options.defaultValue || "",
      cls: "modal-input"
    });

    // 错误消息容器
    this.errorEl = inputContainer.createDiv({ cls: "modal-error" });
    this.errorEl.style.display = "none";

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    // 取消按钮
    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    // 确认按钮
    const submitBtn = buttonContainer.createEl("button", {
      text: "确认",
      cls: "mod-cta"
    });
    submitBtn.addEventListener("click", () => this.handleSubmit());

    // Enter 键提交
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.handleSubmit();
      }
    });

    // 设置焦点
    setTimeout(() => {
      this.inputEl?.focus();
      this.inputEl?.select();
    }, 10);
  }

  private handleSubmit(): void {
    const value = this.inputEl?.value.trim() || "";

    // 验证
    if (this.options.validator) {
      const error = this.options.validator(value);
      if (error) {
        this.showError(error);
        return;
      }
    }

    // 提交
    this.options.onSubmit(value);
    this.close();
  }

  private showError(message: string): void {
    if (this.errorEl) {
      this.errorEl.textContent = message;
      this.errorEl.style.display = "block";
      this.errorEl.style.color = "var(--text-error)";
      this.errorEl.style.marginTop = "0.5em";
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// ============================================================================
// SelectModal - 选择对话框
// ============================================================================

/**
 * 选择 Modal
 */
export class SelectModal extends Modal {
  private options: SelectModalOptions;

  constructor(app: App, options: SelectModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl("h2", { text: this.options.title });

    // 选项列表
    const optionsList = contentEl.createDiv({ cls: "modal-options-list" });

    this.options.options.forEach((option, index) => {
      const optionEl = optionsList.createDiv({ cls: "modal-option-item" });

      // 选项按钮
      const button = optionEl.createEl("button", {
        text: option.label,
        cls: "modal-option-button"
      });

      if (option.description) {
        const desc = optionEl.createDiv({
          text: option.description,
          cls: "modal-option-description"
        });
        desc.style.fontSize = "0.9em";
        desc.style.color = "var(--text-muted)";
        desc.style.marginTop = "0.25em";
      }

      button.addEventListener("click", () => {
        this.options.onSelect(option.value);
        this.close();
      });

      // 第一个选项自动获得焦点
      if (index === 0) {
        setTimeout(() => button.focus(), 10);
      }
    });

    // 取消按钮
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

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
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl("h2", { text: this.options.title });

    // 消息
    const messageEl = contentEl.createDiv({ cls: "modal-message" });
    messageEl.textContent = this.options.message;
    messageEl.style.marginBottom = "1em";

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    // 取消按钮
    const cancelBtn = buttonContainer.createEl("button", {
      text: this.options.cancelText || "取消"
    });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    // 确认按钮
    const confirmBtn = buttonContainer.createEl("button", {
      text: this.options.confirmText || "确认",
      cls: this.options.danger ? "mod-warning" : "mod-cta"
    });
    confirmBtn.addEventListener("click", () => {
      this.options.onConfirm();
      this.close();
    });

    // 设置焦点到确认按钮
    setTimeout(() => confirmBtn.focus(), 10);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
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
  private errorEl: HTMLElement | null = null;

  constructor(app: App, options: ProviderConfigModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    const title = this.options.mode === "add" ? "添加 AI Provider" : "编辑 AI Provider";
    contentEl.createEl("h2", { text: title });

    // 表单容器
    const formEl = contentEl.createDiv({ cls: "modal-form" });

    // Provider ID
    const idSetting = new Setting(formEl)
      .setName("Provider ID")
      .setDesc("唯一标识符，例如: my-openai");

    this.providerIdInput = idSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: `my-${this.options.providerType || "provider"}`,
      value: this.options.providerId || ""
    });

    if (this.options.mode === "edit") {
      this.providerIdInput.disabled = true;
    }

    // API Key
    const apiKeySetting = new Setting(formEl)
      .setName("API Key")
      .setDesc("您的 API 密钥");

    this.apiKeyInput = apiKeySetting.controlEl.createEl("input", {
      type: "password",
      placeholder: "sk-...",
      value: this.options.currentConfig?.apiKey || ""
    });

    // 显示/隐藏 API Key 按钮
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

    // 自定义端点
    const baseUrlSetting = new Setting(formEl)
      .setName("自定义端点 (可选)")
      .setDesc(this.getDefaultEndpoint(this.options.providerType || this.options.currentConfig?.type!));

    this.baseUrlInput = baseUrlSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: this.getDefaultEndpoint(this.options.providerType || this.options.currentConfig?.type!),
      value: this.options.currentConfig?.baseUrl || ""
    });

    // 聊天模型
    const chatModelSetting = new Setting(formEl)
      .setName("聊天模型")
      .setDesc("用于对话的模型");

    this.chatModelInput = chatModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: this.getDefaultChatModel(this.options.providerType || this.options.currentConfig?.type!),
      value: this.options.currentConfig?.defaultChatModel || ""
    });

    // 嵌入模型
    const embedModelSetting = new Setting(formEl)
      .setName("嵌入模型")
      .setDesc("用于向量嵌入的模型");

    this.embedModelInput = embedModelSetting.controlEl.createEl("input", {
      type: "text",
      placeholder: this.getDefaultEmbedModel(this.options.providerType || this.options.currentConfig?.type!),
      value: this.options.currentConfig?.defaultEmbedModel || ""
    });

    // 错误消息容器
    this.errorEl = formEl.createDiv({ cls: "modal-error" });
    this.errorEl.style.display = "none";

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    // 取消按钮
    const cancelBtn = buttonContainer.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => {
      this.options.onCancel?.();
      this.close();
    });

    // 保存按钮
    const saveBtn = buttonContainer.createEl("button", {
      text: "保存",
      cls: "mod-cta"
    });
    saveBtn.addEventListener("click", () => this.handleSave());

    // 设置焦点
    setTimeout(() => {
      if (this.options.mode === "add") {
        this.providerIdInput?.focus();
      } else {
        this.apiKeyInput?.focus();
      }
    }, 10);
  }

  private async handleSave(): Promise<void> {
    // 获取表单值
    const providerId = this.providerIdInput?.value.trim() || "";
    const apiKey = this.apiKeyInput?.value.trim() || "";
    const baseUrl = this.baseUrlInput?.value.trim() || "";
    const chatModel = this.chatModelInput?.value.trim() || "";
    const embedModel = this.embedModelInput?.value.trim() || "";

    // 验证
    if (!providerId) {
      this.showError("请输入 Provider ID");
      return;
    }

    if (!apiKey) {
      this.showError("请输入 API Key");
      return;
    }

    // 验证自定义端点 URL
    if (baseUrl) {
      const urlError = this.validateUrl(baseUrl);
      if (urlError) {
        this.showError(urlError);
        return;
      }
    }

    // 构建配置
    const providerType = this.options.providerType || this.options.currentConfig?.type!;
    const config: ProviderConfig = {
      type: providerType,
      apiKey,
      baseUrl: baseUrl || undefined,
      defaultChatModel: chatModel || this.getDefaultChatModel(providerType),
      defaultEmbedModel: embedModel || this.getDefaultEmbedModel(providerType),
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
    // 必须以 http:// 或 https:// 开头
    if (!/^https?:\/\/.+/.test(url)) {
      return "URL 必须以 http:// 或 https:// 开头";
    }

    // 尝试解析 URL
    try {
      new URL(url);
      return null; // 有效
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

  private getDefaultEndpoint(type: ProviderType): string {
    return "https://api.openai.com/v1";
  }

  private getDefaultChatModel(type: ProviderType): string {
    return "gpt-4-turbo-preview";
  }

  private getDefaultEmbedModel(type: ProviderType): string {
    return "text-embedding-3-small";
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
