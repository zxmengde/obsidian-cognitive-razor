/**
 * SetupWizard - 首次配置向导（完整版）
 *
 * 设计对齐：
 * - 8.3.1 Journey-Onboarding：完整/演示模式分支
 * - A-UCD-01/04：在线校验，离线时提供跳过提示
 * - 数据目录落盘：调用文件存储初始化，避免首次使用缺少 data/ 结构
 */

import { App, Modal, Notice, Setting, normalizePath } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderConfig, ProviderType } from "../types";
import { validateUrl } from "../data/validators";

/**
 * 配置向导步骤
 */
enum WizardStep {
  Mode = "mode",
  Configure = "configure",
  DemoReady = "demo-ready"
}

type SetupMode = "full" | "demo";

interface ValidationState {
  status: "idle" | "checking" | "ok" | "offline" | "error";
  message?: string;
}

/**
 * 配置向导模态框
 */
export class SetupWizard extends Modal {
  private plugin: CognitiveRazorPlugin;
  private currentStep: WizardStep = WizardStep.Mode;
  private mode: SetupMode = "full";
  private providerId: string = "my-openai";
  private apiKey: string = "";
  private baseUrl: string = "";
  private chatModel: string = "gpt-4o";
  private embedModel: string = "text-embedding-3-small";
  private validation: ValidationState = { status: "idle" };

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
      case WizardStep.Mode:
        this.renderMode();
        break;
      case WizardStep.Configure:
        this.renderConfigure();
        break;
      case WizardStep.DemoReady:
        this.renderDemoReady();
        break;
    }
  }

  /**
   * 模式选择
   */
  private renderMode(): void {
    const { contentEl } = this;

    contentEl.createEl("h1", { text: "选择启动方式", cls: "cr-wizard-title" });
    contentEl.createEl("p", {
      text: "完整模式连接自己的 API，演示模式加载示例数据（AI 调用关闭）。",
      cls: "cr-wizard-hint"
    });

    const cards = contentEl.createDiv({ cls: "cr-mode-cards" });

    const fullCard = cards.createDiv({ cls: "cr-mode-card" });
    fullCard.createEl("h3", { text: "完整模式" });
    fullCard.createEl("p", { text: "配置 OpenAI/OpenRouter/Azure 兼容服务，体验全部功能。" });
    const fullBtn = fullCard.createEl("button", { text: "继续配置", cls: "mod-cta" });
    fullBtn.addEventListener("click", () => {
      this.mode = "full";
      this.currentStep = WizardStep.Configure;
      this.renderStep();
    });

    const demoCard = cards.createDiv({ cls: "cr-mode-card" });
    demoCard.createEl("h3", { text: "演示模式" });
    demoCard.createEl("p", { text: "离线浏览示例工作台与笔记结构，稍后可切换到完整模式。" });
    const demoBtn = demoCard.createEl("button", { text: "一键进入演示", cls: "cr-btn-secondary" });
    demoBtn.addEventListener("click", () => this.enterDemoMode(demoBtn));
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

    // 校验结果提示
    const statusBox = contentEl.createDiv({ cls: "cr-validation" });
    this.renderValidation(statusBox);

    // 按钮
    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });

    const backBtn = buttons.createEl("button", {
      text: "返回",
      cls: "cr-btn-secondary"
    });
    backBtn.addEventListener("click", () => {
      this.currentStep = WizardStep.Mode;
      this.renderStep();
    });

    const saveBtn = buttons.createEl("button", {
      text: "保存并校验",
      cls: "mod-cta"
    });
    saveBtn.addEventListener("click", () => this.saveConfig(saveBtn, statusBox));
  }

  /**
   * 演示模式完成页
   */
  private renderDemoReady(): void {
    const { contentEl } = this;
    contentEl.createEl("h1", { text: "演示模式已加载", cls: "cr-wizard-title" });
    contentEl.createEl("p", {
      text: "已生成示例笔记与数据结构。随时可在设置中切换到完整模式并配置真实 API。",
      cls: "cr-wizard-hint"
    });

    const buttons = contentEl.createDiv({ cls: "cr-wizard-buttons" });
    const startBtn = buttons.createEl("button", { text: "打开工作台", cls: "mod-cta" });
    startBtn.addEventListener("click", () => {
      this.close();
      this.app.workspace.trigger("cognitive-razor:open-workbench");
    });
  }

  /**
   * 渲染校验状态
   */
  private renderValidation(container: HTMLElement): void {
    container.empty();
    const { status, message } = this.validation;
    const text = container.createDiv({ cls: `cr-validation-${status}` });

    if (status === "idle") {
      text.setText("尚未校验");
    } else if (status === "checking") {
      text.setText("正在校验连接…");
    } else if (status === "ok") {
      text.setText(message || "连接正常");
    } else if (status === "offline") {
      text.setText(message || "网络不可用，已跳过校验，可稍后重试");
    } else {
      text.setText(message || "校验失败，请检查配置后重试");
    }
  }

  /**
   * 保存配置
   */
  private async saveConfig(btn: HTMLButtonElement, statusBox: HTMLElement): Promise<void> {
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
    this.validation = { status: "checking" };
    this.renderValidation(statusBox);

    try {
      const config: ProviderConfig = {
        type: "openai" as ProviderType,
        apiKey: this.apiKey.trim(),
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
        this.validation = { status: "error", message: result.error.message };
        this.renderValidation(statusBox);
        return;
      }

      // 尝试验证连接
      try {
        const checkResult = await this.plugin.getComponents().providerManager.checkAvailability(this.providerId, true);
        if (!checkResult.ok) {
          if (checkResult.error.code === "E102") {
            this.validation = {
              status: "offline",
              message: "网络不可用，配置已保存，可稍后重试连接"
            };
            new Notice("⚠️ 网络不可用，已跳过在线校验", 4500);
          } else {
            this.validation = {
              status: "error",
              message: `校验失败：${checkResult.error.message}`
            };
            new Notice(`校验失败：${checkResult.error.message}`);
            btn.setText(originalText);
            btn.disabled = false;
            this.renderValidation(statusBox);
            return;
          }
        } else {
          this.validation = { status: "ok", message: "连接正常" };
        }
      } catch (error) {
        this.validation = {
          status: "offline",
          message: "网络错误，已保存配置，可稍后重试"
        };
        new Notice("⚠️ 网络错误，已跳过校验");
      }

      this.renderValidation(statusBox);

      // 配置成功，关闭向导并自动打开工作台
      new Notice("✓ 配置完成");
      this.close();
      this.app.workspace.trigger("cognitive-razor:open-workbench");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`保存出错: ${msg}`);
      this.validation = { status: "error", message: msg };
      this.renderValidation(statusBox);
      btn.setText(originalText);
      btn.disabled = false;
    }
  }

  /**
   * 进入演示模式：落盘 data 结构并生成示例文件
   */
  private async enterDemoMode(btn?: HTMLButtonElement): Promise<void> {
    const originalText = btn?.getText();
    if (btn) {
      btn.setText("正在加载…");
      btn.disabled = true;
    }

    try {
      // 标记演示模式
      await this.plugin.settingsStore.updateSettings({ demoMode: true });

      // 确保存储结构存在
      await this.plugin.getComponents().fileStorage?.initialize();

      // 生成示例笔记（不会覆盖已有文件）
      await this.seedDemoNotes();

      new Notice("演示模式已启用，已生成示例数据");
      this.currentStep = WizardStep.DemoReady;
      this.renderStep();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`演示模式初始化失败：${msg}`);
    } finally {
      if (btn) {
        btn.setText(originalText || "一键进入演示");
        btn.disabled = false;
      }
    }
  }

  /**
   * 写入简单的示例笔记，便于在工作台浏览
   */
  private async seedDemoNotes(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const folder = normalizePath("Cognitive Razor Demo");
    if (!(await adapter.exists(folder))) {
      await adapter.mkdir(folder);
    }

    const samples = [
      {
        path: `${folder}/认知负荷示例.md`,
        content: [
          "---",
          "uid: demo-uid-1",
          "type: Theory",
          "status: Draft",
          `created: ${new Date().toISOString()}`,
          `updated: ${new Date().toISOString()}`,
          "aliases:",
          "  - Cognitive Load",
          "---",
          "",
          "# 认知负荷（示例）",
          "",
          "**English**: Cognitive Load",
          "",
          "## 核心定义",
          "用于衡量学习任务对工作记忆的占用程度。",
          "",
          "## 详细说明",
          "演示模式下的示例笔记，您可以在完整模式下继续生成真实内容。"
        ].join("\n")
      },
      {
        path: `${folder}/工作记忆示例.md`,
        content: [
          "---",
          "uid: demo-uid-2",
          "type: Mechanism",
          "status: Draft",
          `created: ${new Date().toISOString()}`,
          `updated: ${new Date().toISOString()}`,
          "---",
          "",
          "# 工作记忆（示例）",
          "",
          "**English**: Working Memory",
          "",
          "## 详细说明",
          "演示模式仅包含静态示例，切换到完整模式后可通过管线生成和改进内容。"
        ].join("\n")
      }
    ];

    for (const sample of samples) {
      const exists = await adapter.exists(sample.path);
      if (!exists) {
        await this.app.vault.create(sample.path, sample.content);
      }
    }
  }
}
