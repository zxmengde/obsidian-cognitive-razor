/**
 * SetupWizard - 首次配置向导（精简版）
 * 
 * 简化的配置流程：欢迎 → 配置 → 完成
 */

import { App, Modal, Setting, Notice } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderType, ProviderConfig } from "../types";
import { validateUrl } from "../data/validators";

/**
 * 配置向导步骤
 */
enum WizardStep {
  Welcome = "welcome",
  Configure = "configure"
}

/**
 * 配置向导模态框
 */
export class SetupWizard extends Modal {
  private plugin: CognitiveRazorPlugin;
  private currentStep: WizardStep = WizardStep.Welcome;
  private providerId: string = "my-openai";
  private apiKey: string = "";
  private baseUrl: string = "";
  private chatModel: string = "gpt-4o";
  private embedModel: string = "text-embedding-3-small";

  constructor(app: App, plugin: CognitiveRazorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.modalEl.addClass("cr-setup-wizard-modal");
    this.renderStep();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * 渲染当前步骤
   */
  private renderStep(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cr-setup-wizard");

    switch (this.currentStep) {
      case WizardStep.Welcome:
        this.renderWelcome();
        break;
      case WizardStep.Configure:
        this.renderConfigure();
        break;
    }
  }

  /**
   * 渲染欢迎页面
   */
  private renderWelcome(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "欢迎使用 Cognitive Razor", cls: "cr-wizard-title" });
    
    contentEl.createEl("p", {
      text: "公理化知识管理插件，帮助您将模糊概念转化为结构化知识。",
      cls: "cr-wizard-intro"
    });

    contentEl.createEl("p", {
      text: "开始前需要配置一个 AI Provider。",
      cls: "cr-wizard-hint"
    });

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const nextBtn = buttons.createEl("button", {
      text: "开始配置",
      cls: "mod-cta"
    });
    nextBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Configure;
      this.renderStep();
    });

    const skipBtn = buttons.createEl("button", {
      text: "稍后配置",
      cls: "cr-btn-secondary"
    });
    skipBtn.addEventListener("click", () => this.close());
  }

  /**
   * 渲染配置页面
   */
  private renderConfigure(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "配置 AI Provider", cls: "cr-wizard-title" });

    // API Key 获取提示
    const hint = contentEl.createDiv({ cls: "cr-config-hint" });
    hint.innerHTML = '从 <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI</a> 或 <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a> 获取 API Key';

    // 配置表单
    new Setting(contentEl)
      .setName("API Key")
      .setDesc("您的 API Key（本地存储，不会上传）")
      .addText(text => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.apiKey)
          .onChange(value => this.apiKey = value);
        text.inputEl.type = "password";
      });

    new Setting(contentEl)
      .setName("自定义端点")
      .setDesc("留空使用 OpenAI 默认端点")
      .addText(text => {
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.baseUrl)
          .onChange(value => this.baseUrl = value);
      });

    // 高级选项折叠
    const advancedToggle = contentEl.createDiv({ cls: "cr-advanced-toggle" });
    const toggleBtn = advancedToggle.createEl("button", {
      text: "▶ 高级选项",
      cls: "cr-btn-link"
    });
    
    const advancedSection = contentEl.createDiv({ cls: "cr-advanced-section cr-hidden" });
    
    toggleBtn.addEventListener("click", () => {
      const isHidden = advancedSection.hasClass("cr-hidden");
      advancedSection.toggleClass("cr-hidden", !isHidden);
      toggleBtn.setText(isHidden ? "▼ 高级选项" : "▶ 高级选项");
    });

    new Setting(advancedSection)
      .setName("Provider ID")
      .addText(text => {
        text
          .setPlaceholder("my-openai")
          .setValue(this.providerId)
          .onChange(value => this.providerId = value);
      });

    new Setting(advancedSection)
      .setName("聊天模型")
      .addText(text => {
        text
          .setValue(this.chatModel)
          .onChange(value => this.chatModel = value);
      });

    new Setting(advancedSection)
      .setName("嵌入模型")
      .addText(text => {
        text
          .setValue(this.embedModel)
          .onChange(value => this.embedModel = value);
      });

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const backBtn = buttons.createEl("button", { 
      text: "返回",
      cls: "cr-btn-secondary"
    });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Welcome;
      this.renderStep();
    });

    const saveBtn = buttons.createEl("button", {
      text: "保存配置",
      cls: "mod-cta"
    });
    saveBtn.addEventListener("click", () => this.saveConfig(saveBtn));
  }

  /**
   * 保存配置
   */
  private async saveConfig(btn: HTMLButtonElement): Promise<void> {
    // 验证必填项
    if (!this.apiKey.trim()) {
      new Notice("请输入 API Key");
      return;
    }

    if (!this.providerId.trim()) {
      new Notice("请输入 Provider ID");
      return;
    }

    // 验证 URL（如果提供）
    if (this.baseUrl.trim()) {
      const urlError = validateUrl(this.baseUrl);
      if (urlError) {
        new Notice(`端点 URL 无效: ${urlError}`);
        return;
      }
    }

    // 显示保存中状态
    const originalText = btn.getText();
    btn.setText("保存中...");
    btn.disabled = true;

    try {
      const config: ProviderConfig = {
        type: "openai" as ProviderType,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl.trim() || undefined,
        defaultChatModel: this.chatModel,
        defaultEmbedModel: this.embedModel,
        enabled: true
      };

      const result = await this.plugin.settingsStore.addProvider(this.providerId, config);
      
      if (!result.ok) {
        new Notice(`保存失败: ${result.error.message}`);
        btn.setText(originalText);
        btn.disabled = false;
        return;
      }

      // 尝试验证连接（不阻塞）
      try {
        const checkResult = await this.plugin.getComponents().providerManager.checkAvailability(this.providerId);
        if (!checkResult.ok) {
          new Notice(`⚠️ 连接验证失败，请检查配置`, 5000);
        }
      } catch {
        // 忽略验证错误，可能是网络问题
      }

      // 配置成功，关闭向导并自动打开工作台
      new Notice("✓ 配置完成");
      this.close();
      this.app.workspace.trigger("cognitive-razor:open-workbench");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`保存出错: ${msg}`);
      btn.setText(originalText);
      btn.disabled = false;
    }
  }
}
