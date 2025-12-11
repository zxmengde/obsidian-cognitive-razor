/**
 * SetupWizard - 首次配置向导（完整版）
 *
 * 设计对齐：
 * - 8.3.1 Journey-Onboarding：完整/演示模式分支
 * - A-UCD-01/04：在线校验，离线时提供跳过提示
 * - 数据目录落盘：调用文件存储初始化，避免首次使用缺少 data/ 结构
 */

import { App, Modal, Notice, Setting } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderConfig } from "../types";
import { validateUrl } from "../data/validators";

/**
 * 配置向导步骤
 */
enum WizardStep {
  Configure = "configure"
}

interface ValidationState {
  status: "idle" | "checking" | "ok" | "offline" | "error";
  message?: string;
  showSkipButton?: boolean;  // 新增：是否显示跳过按钮
}

/**
 * 配置向导模态框
 */
export class SetupWizard extends Modal {
  private plugin: CognitiveRazorPlugin;
  private currentStep: WizardStep = WizardStep.Configure;
  private providerId: string = "my-openai";
  private apiKey: string = "";
  private baseUrl: string = "";
  private chatModel: string = "gpt-4o";
  private embedModel: string = "text-embedding-3-small";
  private validation: ValidationState = { status: "idle" };
  private selectedLanguage: "zh" | "en" = "zh";

  constructor(app: App, plugin: CognitiveRazorPlugin) {
    super(app);
    this.plugin = plugin;
    // 读取当前语言设置
    this.selectedLanguage = this.plugin.getComponents().settings.language;
  }

  onOpen(): void {
    this.modalEl.addClass("cr-setup-wizard-modal");
    this.modalEl.addClass("cr-scope");
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
    contentEl.addClass("cr-scope");
    contentEl.addClass("cr-setup-wizard");

    this.renderConfigure();
  }

  /**
   * 渲染配置页面
   */
  private renderConfigure(): void {
    const { contentEl } = this;

    const title = this.selectedLanguage === "zh" ? "配置 AI Provider" : "Configure AI Provider";
    contentEl.createEl("h1", { text: title, cls: "cr-wizard-title" });

    // 语言选择
    new Setting(contentEl)
      .setName(this.selectedLanguage === "zh" ? "语言 / Language" : "Language / 语言")
      .setDesc(this.selectedLanguage === "zh" ? "选择界面语言" : "Select interface language")
      .addDropdown(dropdown => {
        dropdown
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(this.selectedLanguage)
          .onChange(async (value: string) => {
            const lang = value as "zh" | "en";
            this.selectedLanguage = lang;
            // 立即更新语言设置
            const settings = this.plugin.getComponents().settings;
            settings.language = lang;
            await this.plugin.settingsStore.updateSettings(settings);
            // 重新渲染界面
            this.renderStep();
          });
      });

    // API Key 获取提示
    const hint = contentEl.createDiv({ cls: "cr-config-hint" });
    const hintText = this.selectedLanguage === "zh" 
      ? '从 <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI</a> 或 <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a> 获取 API Key'
      : 'Get API Key from <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI</a> or <a href="https://openrouter.ai/keys" target="_blank">OpenRouter</a>';
    hint.innerHTML = hintText;

    // 配置表单
    new Setting(contentEl)
      .setName("API Key")
      .setDesc(this.selectedLanguage === "zh" ? "您的 API Key（默认写入本地 data.json，不会上传）" : "Your API Key (stored locally in data.json by default, never uploaded)")
      .addText(text => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.apiKey)
          .onChange(value => this.apiKey = value);
        text.inputEl.type = "password";
      });



    new Setting(contentEl)
      .setName(this.selectedLanguage === "zh" ? "自定义端点" : "Custom Endpoint")
      .setDesc(this.selectedLanguage === "zh" ? "留空使用 OpenAI 默认端点" : "Leave empty to use OpenAI default endpoint")
      .addText(text => {
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.baseUrl)
          .onChange(value => this.baseUrl = value);
      });

    // 高级选项（直接展示，不折叠）
    const advancedSection = contentEl.createDiv({ cls: "cr-advanced-section" });

    new Setting(advancedSection)
      .setName("Provider ID")
      .addText(text => {
        text
          .setPlaceholder("my-openai")
          .setValue(this.providerId)
          .onChange(value => this.providerId = value);
      });

    new Setting(advancedSection)
      .setName(this.selectedLanguage === "zh" ? "聊天模型" : "Chat Model")
      .addText(text => {
        text
          .setValue(this.chatModel)
          .onChange(value => this.chatModel = value);
      });

    new Setting(advancedSection)
      .setName(this.selectedLanguage === "zh" ? "嵌入模型" : "Embedding Model")
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

    const saveBtn = buttons.createEl("button", {
      text: this.selectedLanguage === "zh" ? "保存并校验" : "Save and Validate",
      cls: "mod-cta"
    });
    saveBtn.addEventListener("click", () => this.saveConfig(saveBtn, statusBox, buttons));
  }

  /**
   * 渲染校验状态
   */
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
      text.setText(message || (isZh ? "网络不可用，已跳过校验，可稍后重试" : "Network unavailable, validation skipped, can retry later"));
    } else {
      text.setText(message || (isZh ? "校验失败，请检查配置后重试" : "Validation failed, please check configuration and retry"));
    }
  }

  /**
   * 保存配置
   */
  private async saveConfig(btn: HTMLButtonElement, statusBox: HTMLElement, buttonsContainer: HTMLElement): Promise<void> {
    const isZh = this.selectedLanguage === "zh";

    // 验证必填项
    if (!this.apiKey.trim()) {
      new Notice(isZh ? "请输入 API Key" : "Please enter API Key");
      return;
    }

    if (!this.providerId.trim()) {
      new Notice(isZh ? "请输入 Provider ID" : "Please enter Provider ID");
      return;
    }

    // 验证 URL（如果提供）
    if (this.baseUrl.trim()) {
      const urlError = validateUrl(this.baseUrl);
      if (urlError) {
        new Notice(`${isZh ? "端点 URL 无效" : "Invalid endpoint URL"}: ${urlError}`);
        return;
      }
    }

    // 显示保存中状态
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

      const result = await this.plugin.settingsStore.addProvider(this.providerId, config);

      if (!result.ok) {
        new Notice(`${isZh ? "保存失败" : "Save failed"}: ${result.error.message}`);
        btn.setText(originalText);
        btn.disabled = false;
        this.validation = { status: "error", message: result.error.message, showSkipButton: true };
        this.renderValidation(statusBox);
        this.renderSkipButton(buttonsContainer);
        return;
      }

      // 尝试验证连接
      try {
        const checkResult = await this.plugin.getComponents().providerManager.checkAvailability(this.providerId, true);
        if (!checkResult.ok) {
          if (checkResult.error.code === "E102") {
            this.validation = {
              status: "offline",
              message: isZh ? "网络不可用，配置已保存，可稍后重试连接" : "Network unavailable, configuration saved, can retry later",
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
            this.renderSkipButton(buttonsContainer);
            return;
          }
        } else {
          this.validation = { status: "ok", message: isZh ? "连接正常" : "Connection successful" };
        }
      } catch (error) {
        this.validation = {
          status: "offline",
          message: isZh ? "网络错误，已保存配置，可稍后重试" : "Network error, configuration saved, can retry later",
          showSkipButton: true
        };
        new Notice(isZh ? "⚠️ 网络错误，已跳过校验" : "⚠️ Network error, validation skipped");
      }

      this.renderValidation(statusBox);

      // 如果需要显示跳过按钮（离线或错误状态），则显示
      if (this.validation.showSkipButton) {
        this.renderSkipButton(buttonsContainer);
        btn.setText(originalText);
        btn.disabled = false;
      } else {
        // 配置成功，关闭向导并自动打开工作台
        new Notice(isZh ? "✓ 配置完成" : "✓ Configuration complete");
        this.close();
        this.app.workspace.trigger("cognitive-razor:open-workbench");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${isZh ? "保存出错" : "Save error"}: ${msg}`);
      this.validation = { status: "error", message: msg, showSkipButton: true };
      this.renderValidation(statusBox);
      this.renderSkipButton(buttonsContainer);
      btn.setText(originalText);
      btn.disabled = false;
    }
  }

  /**
   * 渲染"跳过配置"按钮
   */
  private renderSkipButton(buttonsContainer: HTMLElement): void {
    // 检查是否已经存在跳过按钮
    const existingSkipBtn = buttonsContainer.querySelector(".cr-skip-btn");
    if (existingSkipBtn) {
      return;
    }

    const isZh = this.selectedLanguage === "zh";
    const skipBtn = buttonsContainer.createEl("button", {
      text: isZh ? "跳过配置" : "Skip Configuration",
      cls: "cr-skip-btn"
    });
    skipBtn.addEventListener("click", () => {
      new Notice(isZh ? "已跳过配置，您可以稍后在设置中配置 Provider" : "Configuration skipped, you can configure Provider later in settings");
      this.close();
      this.app.workspace.trigger("cognitive-razor:open-workbench");
    });
  }
}
