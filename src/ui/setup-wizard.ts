/**
 * SetupWizard - 首次配置向导
 * 
 * 功能：
 * - Provider 选择界面
 * - API Key 验证
 * - 配置保存
 */

import { App, Modal, Setting, Notice } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderType, ProviderConfig } from "../types";

/**
 * 配置向导步骤
 */
enum WizardStep {
  Welcome = "welcome",
  SelectProvider = "select-provider",
  ConfigureGoogle = "configure-google",
  ConfigureOpenAI = "configure-openai",
  ConfigureOpenRouter = "configure-openrouter",
  Verify = "verify",
  Complete = "complete"
}

/**
 * 配置向导模态框
 */
export class SetupWizard extends Modal {
  private plugin: CognitiveRazorPlugin;
  private currentStep: WizardStep = WizardStep.Welcome;
  private selectedProvider: ProviderType | null = null;
  private providerId: string = "";
  private apiKey: string = "";
  private baseUrl: string = "";
  private chatModel: string = "";
  private embedModel: string = "";

  constructor(app: App, plugin: CognitiveRazorPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.renderStep();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
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
      case WizardStep.SelectProvider:
        this.renderSelectProvider();
        break;
      case WizardStep.ConfigureGoogle:
        this.renderConfigureGoogle();
        break;
      case WizardStep.ConfigureOpenAI:
        this.renderConfigureOpenAI();
        break;
      case WizardStep.ConfigureOpenRouter:
        this.renderConfigureOpenRouter();
        break;
      case WizardStep.Verify:
        this.renderVerify();
        break;
      case WizardStep.Complete:
        this.renderComplete();
        break;
    }
  }

  /**
   * 渲染欢迎页面
   */
  private renderWelcome(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "欢迎使用 Cognitive Razor" });
    
    const intro = contentEl.createDiv({ cls: "cr-wizard-intro" });
    intro.createEl("p", {
      text: "Cognitive Razor 是一个公理化知识管理插件，帮助您将模糊的概念转化为结构化的知识节点。"
    });
    intro.createEl("p", {
      text: "在开始使用之前，我们需要配置一个 AI Provider 来提供智能功能。"
    });

    const features = contentEl.createDiv({ cls: "cr-wizard-features" });
    features.createEl("h3", { text: "主要功能：" });
    const featureList = features.createEl("ul");
    featureList.createEl("li", { text: "概念标准化和分类" });
    featureList.createEl("li", { text: "自动检测重复概念" });
    featureList.createEl("li", { text: "AI 辅助内容生成" });
    featureList.createEl("li", { text: "增量改进和合并" });
    featureList.createEl("li", { text: "可撤销的所有操作" });

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const nextBtn = buttons.createEl("button", {
      text: "开始配置",
      cls: "mod-cta"
    });
    nextBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.SelectProvider;
      this.renderStep();
    });

    const skipBtn = buttons.createEl("button", {
      text: "稍后配置"
    });
    skipBtn.addEventListener("click", () => {
      this.close();
    });
  }

  /**
   * 渲染 Provider 选择页面
   */
  private renderSelectProvider(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "选择 AI Provider" });
    
    contentEl.createEl("p", {
      text: "请选择您想要使用的 AI 服务提供商："
    });

    // Google Gemini
    const googleCard = this.createProviderCard(
      contentEl,
      "Google Gemini",
      "Google 的多模态 AI 模型，支持长上下文和快速响应",
      "google",
      [
        "免费额度充足",
        "支持长上下文 (32K tokens)",
        "响应速度快",
        "支持嵌入功能"
      ]
    );

    // OpenAI
    const openaiCard = this.createProviderCard(
      contentEl,
      "OpenAI",
      "业界领先的 GPT 系列模型，提供高质量的文本生成",
      "openai",
      [
        "模型质量高",
        "生态系统完善",
        "支持多种模型",
        "支持嵌入功能"
      ]
    );

    // OpenRouter
    const openrouterCard = this.createProviderCard(
      contentEl,
      "OpenRouter",
      "统一的 AI 模型访问平台，支持多种模型",
      "openrouter",
      [
        "支持多种模型",
        "按需付费",
        "统一接口",
        "不支持嵌入（需配合其他 Provider）"
      ]
    );

    // 返回按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const backBtn = buttons.createEl("button", { text: "返回" });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Welcome;
      this.renderStep();
    });
  }

  /**
   * 创建 Provider 卡片
   */
  private createProviderCard(
    container: HTMLElement,
    name: string,
    description: string,
    type: ProviderType,
    features: string[]
  ): HTMLElement {
    const card = container.createDiv({ cls: "cr-provider-card" });
    
    card.createEl("h3", { text: name });
    card.createEl("p", { text: description, cls: "cr-provider-desc" });
    
    const featureList = card.createEl("ul", { cls: "cr-provider-features" });
    features.forEach(feature => {
      featureList.createEl("li", { text: feature });
    });

    const selectBtn = card.createEl("button", {
      text: "选择",
      cls: "mod-cta"
    });
    selectBtn.addEventListener("click", () => {
      this.selectedProvider = type;
      this.providerId = `my-${type}`;
      
      // 设置默认模型
      this.setDefaultModels(type);
      
      // 跳转到对应的配置页面
      switch (type) {
        case "google":
          this.currentStep = WizardStep.ConfigureGoogle;
          break;
        case "openai":
          this.currentStep = WizardStep.ConfigureOpenAI;
          break;
        case "openrouter":
          this.currentStep = WizardStep.ConfigureOpenRouter;
          break;
      }
      this.renderStep();
    });

    return card;
  }

  /**
   * 设置默认模型
   */
  private setDefaultModels(type: ProviderType): void {
    switch (type) {
      case "google":
        this.chatModel = "gemini-1.5-flash";
        this.embedModel = "text-embedding-004";
        break;
      case "openai":
        this.chatModel = "gpt-4-turbo-preview";
        this.embedModel = "text-embedding-3-small";
        break;
      case "openrouter":
        this.chatModel = "anthropic/claude-3-sonnet";
        this.embedModel = "";
        break;
    }
  }

  /**
   * 渲染 Google Gemini 配置页面
   */
  private renderConfigureGoogle(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "配置 Google Gemini" });

    // 说明
    const instructions = contentEl.createDiv({ cls: "cr-wizard-instructions" });
    instructions.createEl("p", { text: "请按照以下步骤获取 API Key：" });
    const steps = instructions.createEl("ol");
    steps.createEl("li").innerHTML = '访问 <a href="https://makersuite.google.com/app/apikey" target="_blank">Google AI Studio</a>';
    steps.createEl("li", { text: "点击 \"Create API Key\" 按钮" });
    steps.createEl("li", { text: "复制生成的 API Key" });

    // 配置表单
    new Setting(contentEl)
      .setName("Provider ID")
      .setDesc("为此 Provider 设置一个唯一标识符")
      .addText(text => {
        text
          .setPlaceholder("my-google")
          .setValue(this.providerId)
          .onChange(value => {
            this.providerId = value;
          });
      });

    new Setting(contentEl)
      .setName("API Key")
      .setDesc("输入您的 Google AI API Key")
      .addText(text => {
        text
          .setPlaceholder("AIza...")
          .setValue(this.apiKey)
          .onChange(value => {
            this.apiKey = value;
          });
        text.inputEl.type = "password";
      });

    new Setting(contentEl)
      .setName("聊天模型")
      .setDesc("用于文本生成的模型")
      .addText(text => {
        text
          .setPlaceholder("gemini-1.5-flash")
          .setValue(this.chatModel)
          .onChange(value => {
            this.chatModel = value;
          });
      });

    new Setting(contentEl)
      .setName("嵌入模型")
      .setDesc("用于向量嵌入的模型")
      .addText(text => {
        text
          .setPlaceholder("text-embedding-004")
          .setValue(this.embedModel)
          .onChange(value => {
            this.embedModel = value;
          });
      });

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const backBtn = buttons.createEl("button", { text: "返回" });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.SelectProvider;
      this.renderStep();
    });

    const nextBtn = buttons.createEl("button", {
      text: "验证并保存",
      cls: "mod-cta"
    });
    nextBtn.addEventListener("click", () => {
      this.validateAndSave();
    });
  }

  /**
   * 渲染 OpenAI 配置页面
   */
  private renderConfigureOpenAI(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "配置 OpenAI" });

    // 说明
    const instructions = contentEl.createDiv({ cls: "cr-wizard-instructions" });
    instructions.createEl("p", { text: "请按照以下步骤获取 API Key：" });
    const steps = instructions.createEl("ol");
    steps.createEl("li").innerHTML = '访问 <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI API Keys</a>';
    steps.createEl("li", { text: "点击 \"Create new secret key\" 按钮" });
    steps.createEl("li", { text: "复制生成的 API Key" });

    // 配置表单
    new Setting(contentEl)
      .setName("Provider ID")
      .setDesc("为此 Provider 设置一个唯一标识符")
      .addText(text => {
        text
          .setPlaceholder("my-openai")
          .setValue(this.providerId)
          .onChange(value => {
            this.providerId = value;
          });
      });

    new Setting(contentEl)
      .setName("API Key")
      .setDesc("输入您的 OpenAI API Key")
      .addText(text => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.apiKey)
          .onChange(value => {
            this.apiKey = value;
          });
        text.inputEl.type = "password";
      });

    new Setting(contentEl)
      .setName("聊天模型")
      .setDesc("用于文本生成的模型")
      .addText(text => {
        text
          .setPlaceholder("gpt-4-turbo-preview")
          .setValue(this.chatModel)
          .onChange(value => {
            this.chatModel = value;
          });
      });

    new Setting(contentEl)
      .setName("嵌入模型")
      .setDesc("用于向量嵌入的模型")
      .addText(text => {
        text
          .setPlaceholder("text-embedding-3-small")
          .setValue(this.embedModel)
          .onChange(value => {
            this.embedModel = value;
          });
      });

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const backBtn = buttons.createEl("button", { text: "返回" });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.SelectProvider;
      this.renderStep();
    });

    const nextBtn = buttons.createEl("button", {
      text: "验证并保存",
      cls: "mod-cta"
    });
    nextBtn.addEventListener("click", () => {
      this.validateAndSave();
    });
  }

  /**
   * 渲染 OpenRouter 配置页面
   */
  private renderConfigureOpenRouter(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "配置 OpenRouter" });

    // 说明
    const instructions = contentEl.createDiv({ cls: "cr-wizard-instructions" });
    instructions.createEl("p", { text: "请按照以下步骤获取 API Key：" });
    const steps = instructions.createEl("ol");
    steps.createEl("li").innerHTML = '访问 <a href="https://openrouter.ai/keys" target="_blank">OpenRouter Keys</a>';
    steps.createEl("li", { text: "点击 \"Create Key\" 按钮" });
    steps.createEl("li", { text: "复制生成的 API Key" });

    const warning = contentEl.createDiv({ cls: "cr-wizard-warning" });
    warning.createEl("p", {
      text: "⚠️ 注意：OpenRouter 不支持嵌入功能。如需使用语义去重功能，请额外配置 Google 或 OpenAI Provider。"
    });

    // 配置表单
    new Setting(contentEl)
      .setName("Provider ID")
      .setDesc("为此 Provider 设置一个唯一标识符")
      .addText(text => {
        text
          .setPlaceholder("my-openrouter")
          .setValue(this.providerId)
          .onChange(value => {
            this.providerId = value;
          });
      });

    new Setting(contentEl)
      .setName("API Key")
      .setDesc("输入您的 OpenRouter API Key")
      .addText(text => {
        text
          .setPlaceholder("sk-or-...")
          .setValue(this.apiKey)
          .onChange(value => {
            this.apiKey = value;
          });
        text.inputEl.type = "password";
      });

    new Setting(contentEl)
      .setName("聊天模型")
      .setDesc("用于文本生成的模型")
      .addText(text => {
        text
          .setPlaceholder("anthropic/claude-3-sonnet")
          .setValue(this.chatModel)
          .onChange(value => {
            this.chatModel = value;
          });
      });

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const backBtn = buttons.createEl("button", { text: "返回" });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.SelectProvider;
      this.renderStep();
    });

    const nextBtn = buttons.createEl("button", {
      text: "验证并保存",
      cls: "mod-cta"
    });
    nextBtn.addEventListener("click", () => {
      this.validateAndSave();
    });
  }

  /**
   * 验证并保存配置
   */
  private async validateAndSave(): Promise<void> {
    // 验证输入
    if (!this.providerId.trim()) {
      new Notice("请输入 Provider ID");
      return;
    }

    if (!this.apiKey.trim()) {
      new Notice("请输入 API Key");
      return;
    }

    if (!this.chatModel.trim()) {
      new Notice("请输入聊天模型");
      return;
    }

    if (this.selectedProvider !== "openrouter" && !this.embedModel.trim()) {
      new Notice("请输入嵌入模型");
      return;
    }

    // 显示验证中状态
    this.currentStep = WizardStep.Verify;
    this.renderStep();

    // 创建配置
    const config: ProviderConfig = {
      type: this.selectedProvider!,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl || undefined,
      defaultChatModel: this.chatModel,
      defaultEmbedModel: this.embedModel,
      enabled: true
    };

    // 保存配置
    const result = await this.plugin.settingsStore.addProvider(this.providerId, config);
    
    if (!result.ok) {
      new Notice(`保存失败: ${result.error.message}`);
      // 返回配置页面
      switch (this.selectedProvider) {
        case "google":
          this.currentStep = WizardStep.ConfigureGoogle;
          break;
        case "openai":
          this.currentStep = WizardStep.ConfigureOpenAI;
          break;
        case "openrouter":
          this.currentStep = WizardStep.ConfigureOpenRouter;
          break;
      }
      this.renderStep();
      return;
    }

    // 验证 API Key（可选）
    try {
      const checkResult = await this.plugin.getComponents().providerManager.checkAvailability(this.providerId);
      if (!checkResult.ok) {
        new Notice(`API Key 验证失败: ${checkResult.error.message}`);
        // 但仍然继续，因为可能是网络问题
      }
    } catch (error) {
      console.error("API Key 验证失败:", error);
      // 继续，不阻塞用户
    }

    // 显示完成页面
    this.currentStep = WizardStep.Complete;
    this.renderStep();
  }

  /**
   * 渲染验证页面
   */
  private renderVerify(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "验证配置" });
    
    const loading = contentEl.createDiv({ cls: "cr-wizard-loading" });
    loading.createEl("p", { text: "正在验证 API Key..." });
    loading.createEl("div", { cls: "cr-spinner" });
  }

  /**
   * 渲染完成页面
   */
  private renderComplete(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "配置完成！" });
    
    const success = contentEl.createDiv({ cls: "cr-wizard-success" });
    success.createEl("p", {
      text: "✅ Provider 配置成功！您现在可以开始使用 Cognitive Razor 了。"
    });

    const nextSteps = contentEl.createDiv({ cls: "cr-wizard-next-steps" });
    nextSteps.createEl("h3", { text: "下一步：" });
    const stepsList = nextSteps.createEl("ul");
    stepsList.createEl("li", { text: "使用 Ctrl/Cmd + Shift + W 打开工作台" });
    stepsList.createEl("li", { text: "在工作台中输入概念描述，创建您的第一个概念" });
    stepsList.createEl("li", { text: "查看任务队列了解处理进度" });
    stepsList.createEl("li", { text: "在设置中调整插件参数" });

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    
    const closeBtn = buttons.createEl("button", {
      text: "开始使用",
      cls: "mod-cta"
    });
    closeBtn.addEventListener("click", () => {
      this.close();
      // 打开工作台
      this.app.workspace.trigger("cognitive-razor:open-workbench");
    });
  }
}
