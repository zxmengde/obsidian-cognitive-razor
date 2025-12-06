/**
 * 迁移向导 Modal
 * 
 * 用于引导用户从 OpenRouter 迁移到新的配置系统
 */

import { App, Modal, Setting, Notice } from "obsidian";
import type { ProviderConfig } from "../types";

/**
 * OpenRouter 迁移选项
 */
export interface OpenRouterMigrationOptions {
  /** OpenRouter Provider ID */
  providerId: string;
  /** OpenRouter 配置 */
  config: any;
  /** 迁移完成回调 */
  onMigrate: (action: "openai" | "google" | "skip") => Promise<void>;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * OpenRouter 迁移向导 Modal
 */
export class OpenRouterMigrationModal extends Modal {
  private options: OpenRouterMigrationOptions;
  private selectedAction: "openai" | "google" | "skip" = "openai";

  constructor(app: App, options: OpenRouterMigrationOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl("h2", { text: "检测到 OpenRouter 配置" });

    // 说明
    const descEl = contentEl.createDiv({ cls: "migration-description" });
    descEl.createEl("p", {
      text: "新版本不再支持 OpenRouter Provider。您可以选择以下迁移方式："
    });

    // 选项 1: 迁移到 OpenAI + 自定义端点
    const option1 = contentEl.createDiv({ cls: "migration-option" });
    option1.createEl("h3", { text: "选项 1: 使用 OpenAI Provider + 自定义端点" });
    
    const option1Desc = option1.createDiv({ cls: "migration-option-desc" });
    option1Desc.createEl("p", {
      text: "将 OpenRouter 配置转换为 OpenAI Provider，并设置自定义端点指向 OpenRouter。"
    });
    
    const option1Details = option1Desc.createEl("ul");
    option1Details.createEl("li", { text: `Provider ID: ${this.options.providerId}` });
    option1Details.createEl("li", { text: "类型: OpenAI" });
    option1Details.createEl("li", { text: "端点: https://openrouter.ai/api/v1" });
    option1Details.createEl("li", { text: `API Key: ${this.maskApiKey(this.options.config.apiKey)}` });
    
    const option1Btn = option1.createEl("button", {
      text: "迁移到 OpenAI",
      cls: "mod-cta"
    });
    option1Btn.addEventListener("click", () => {
      this.selectedAction = "openai";
      this.handleMigrate();
    });

    // 选项 2: 配置新的 Provider
    const option2 = contentEl.createDiv({ cls: "migration-option" });
    option2.createEl("h3", { text: "选项 2: 配置新的 Provider" });
    
    const option2Desc = option2.createDiv({ cls: "migration-option-desc" });
    option2Desc.createEl("p", {
      text: "删除 OpenRouter 配置，并配置新的 OpenAI 或 Google Gemini Provider。"
    });
    
    const option2Btn = option2.createEl("button", {
      text: "配置新 Provider"
    });
    option2Btn.addEventListener("click", () => {
      this.selectedAction = "google";
      this.handleMigrate();
    });

    // 选项 3: 稍后处理
    const option3 = contentEl.createDiv({ cls: "migration-option" });
    option3.createEl("h3", { text: "选项 3: 稍后处理" });
    
    const option3Desc = option3.createDiv({ cls: "migration-option-desc" });
    option3Desc.createEl("p", {
      text: "跳过迁移，稍后在设置中手动配置。OpenRouter 配置将被删除。"
    });
    
    const option3Btn = option3.createEl("button", {
      text: "稍后"
    });
    option3Btn.addEventListener("click", () => {
      this.selectedAction = "skip";
      this.handleMigrate();
    });

    // 添加样式
    this.addStyles(contentEl);
  }

  private async handleMigrate(): Promise<void> {
    try {
      await this.options.onMigrate(this.selectedAction);
      this.close();
    } catch (error) {
      new Notice(`迁移失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 8) {
      return "••••••••";
    }
    return apiKey.substring(0, 4) + "••••" + apiKey.substring(apiKey.length - 4);
  }

  private addStyles(containerEl: HTMLElement): void {
    const style = containerEl.createEl("style");
    style.textContent = `
      .migration-description {
        margin-bottom: 1.5em;
        padding: 1em;
        background-color: var(--background-secondary);
        border-radius: 4px;
      }

      .migration-option {
        margin-bottom: 1.5em;
        padding: 1em;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
      }

      .migration-option h3 {
        margin-top: 0;
        margin-bottom: 0.5em;
        color: var(--text-normal);
      }

      .migration-option-desc {
        margin-bottom: 1em;
        color: var(--text-muted);
      }

      .migration-option-desc ul {
        margin-top: 0.5em;
        margin-bottom: 0.5em;
        padding-left: 1.5em;
      }

      .migration-option-desc li {
        margin-bottom: 0.25em;
      }

      .migration-option button {
        width: 100%;
        padding: 0.5em 1em;
      }
    `;
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 通用迁移提示 Modal
 */
export interface MigrationPromptOptions {
  /** 标题 */
  title: string;
  /** 消息 */
  message: string;
  /** 详细信息 */
  details?: string[];
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消回调 */
  onCancel?: () => void;
}

/**
 * 通用迁移提示 Modal
 */
export class MigrationPromptModal extends Modal {
  private options: MigrationPromptOptions;

  constructor(app: App, options: MigrationPromptOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // 标题
    contentEl.createEl("h2", { text: this.options.title });

    // 消息
    const messageEl = contentEl.createDiv({ cls: "migration-message" });
    messageEl.textContent = this.options.message;
    messageEl.style.marginBottom = "1em";

    // 详细信息
    if (this.options.details && this.options.details.length > 0) {
      const detailsEl = contentEl.createDiv({ cls: "migration-details" });
      detailsEl.style.marginBottom = "1em";
      detailsEl.style.padding = "1em";
      detailsEl.style.backgroundColor = "var(--background-secondary)";
      detailsEl.style.borderRadius = "4px";

      const detailsList = detailsEl.createEl("ul");
      detailsList.style.marginTop = "0";
      detailsList.style.marginBottom = "0";

      for (const detail of this.options.details) {
        detailsList.createEl("li", { text: detail });
      }
    }

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    // 取消按钮
    if (this.options.cancelText) {
      const cancelBtn = buttonContainer.createEl("button", {
        text: this.options.cancelText
      });
      cancelBtn.addEventListener("click", () => {
        this.options.onCancel?.();
        this.close();
      });
    }

    // 确认按钮
    const confirmBtn = buttonContainer.createEl("button", {
      text: this.options.confirmText || "确认",
      cls: "mod-cta"
    });
    confirmBtn.addEventListener("click", () => {
      this.options.onConfirm();
      this.close();
    });

    // 设置焦点
    setTimeout(() => confirmBtn.focus(), 10);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
