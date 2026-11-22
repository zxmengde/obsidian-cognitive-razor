import { ButtonComponent, Modal, Setting, type App, type TextComponent } from "obsidian";
import type { I18n } from "../../core/i18n";
import type { ProviderProbeRequest } from "../../core/model-gateway";
import type { EmbeddingApiFormat, ProviderApiFormat, ProviderConfig, Result } from "../../types";
import { toSafeErrorFeedback } from "../error-feedback";
import type { ProviderProbeReadModel } from "../provider-probe-result";
import {
  buildServiceConfig,
  chatModelPlaceholder,
  endpointPlaceholder,
  initialServiceForm,
  serviceFormCapabilities,
  serviceFormSignature,
  validateServiceForm,
  type ServiceForm,
  type ServiceFormErrorKey,
  type ServiceFormErrors,
} from "./service-form";

export interface ServiceEditorOptions {
  mode: "add" | "edit";
  id: string;
  currentConfig?: ProviderConfig;
  i18n: I18n;
  test(request: ProviderProbeRequest, signal: AbortSignal): Promise<ProviderProbeReadModel | undefined>;
  save(id: string, config: ProviderConfig): Promise<Result<void>>;
  /** 把连接测试结果组件挂到 target，返回清理函数。 */
  mountProbe(target: HTMLElement, props: { result: ProviderProbeReadModel; i18n: I18n; retrying: boolean; onretry: () => void }): () => void;
}

/** 高级区里的字段；保存时这些字段有错就自动展开高级区。 */
const ADVANCED_ERRORS: ServiceFormErrorKey[] = ["chatModel", "embedModel", "embeddingDimension", "reasoning", "maxTokens", "temperature", "sampling"];

/**
 * 添加 / 编辑服务的原生对话框。字段用宿主 Setting 行渲染，外观、焦点环与主题随宿主；
 * 表单规则在 service-form.ts。只在字段显隐变化时整框重绘，文字输入不重绘，Tab 键顺序不受影响。
 */
export class ServiceEditorModal extends Modal {
  private readonly form: ServiceForm;
  private errors: ServiceFormErrors = {};
  private saving = false;
  private saveError: string | undefined;
  private showAdvanced: boolean;
  private showKey = false;
  private testController: AbortController | undefined;
  private testedSignature: string | undefined;
  private testResult: ProviderProbeReadModel | undefined;
  private probeEl: HTMLElement | undefined;
  private cleanupProbe: (() => void) | undefined;

  constructor(app: App, private readonly options: ServiceEditorOptions) {
    super(app);
    this.form = initialServiceForm(options.id, options.currentConfig);
    this.showAdvanced = options.mode === "add";
  }

  private t(key: string): string {
    return this.options.i18n.t(key);
  }

  onOpen(): void {
    const titleId = `cr-service-editor-title-${Math.random().toString(36).slice(2, 8)}`;
    this.modalEl.classList.add("cr-scope", "cr-service-editor");
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.setAttribute("aria-labelledby", titleId);
    this.titleEl.id = titleId;
    this.titleEl.textContent = this.t(this.options.mode === "add" ? "modals.addProvider.title" : "modals.editProvider.title");
    this.render();
    this.contentEl.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled])")?.focus();
  }

  onClose(): void {
    this.testController?.abort("provider modal closed");
    this.testController = undefined;
    this.cleanupProbe?.();
    this.cleanupProbe = undefined;
    this.contentEl.replaceChildren();
  }

  /** 保存进行中不允许关闭（Esc、遮罩与取消按钮都走这里）。 */
  close(): void {
    if (this.saving) return;
    super.close();
  }

  // ---- 渲染 ----

  private render(): void {
    const doc = this.contentEl.ownerDocument;
    const focusedId = (doc.activeElement as HTMLElement | null)?.id;
    this.cleanupProbe?.();
    this.cleanupProbe = undefined;
    this.contentEl.replaceChildren();
    const root = this.contentEl;
    const form = this.form;
    const caps = serviceFormCapabilities(form);
    const disabled = this.saving;

    const intro = doc.createElement("p");
    intro.className = "setting-item-description cr-service-editor__intro";
    intro.textContent = this.t("modals.providerConfig.description");
    root.appendChild(intro);

    // 服务名称：编辑时不可改，服务名是任务配置引用的键。
    this.textRow(root, {
      id: "pm-provider-id", field: "id", name: this.t("modals.providerConfig.fields.providerId"), required: true,
      desc: this.t("modals.providerConfig.fields.providerIdDesc"), placeholder: "my-openai",
      value: form.id, disabled: disabled || this.options.mode === "edit", onInput: (value) => { form.id = value; },
    });
    this.dropdownRow(root, {
      id: "pm-api-format", field: "apiFormat", name: this.t("modals.providerConfig.fields.apiFormat"),
      desc: this.t("modals.providerConfig.fields.apiFormatDesc"), value: form.apiFormat, disabled,
      options: {
        "openai-chat-completions": this.t("modals.providerConfig.apiFormats.openaiChatCompletions"),
        "openai-responses": this.t("modals.providerConfig.apiFormats.openaiResponses"),
        "gemini-generative-language": this.t("modals.providerConfig.apiFormats.geminiGenerativeLanguage"),
        "anthropic-messages": this.t("modals.providerConfig.apiFormats.anthropicMessages"),
        disabled: this.t("modals.providerConfig.apiFormats.disabled"),
      },
      onChange: (value) => {
        form.apiFormat = value as ProviderApiFormat;
        delete this.errors.apiFormat; delete this.errors.chatModel;
      },
    });
    this.textRow(root, {
      id: "pm-base-url", field: "baseUrl", name: this.t("modals.providerConfig.fields.endpoint"),
      desc: this.t("modals.providerConfig.fields.endpointDesc"), placeholder: endpointPlaceholder(form),
      value: form.baseUrl, disabled, onInput: (value) => { form.baseUrl = value; },
    });
    const keyRow = this.textRow(root, {
      id: "pm-api-key", field: "apiKey", name: this.t("modals.providerConfig.fields.apiKey"),
      desc: this.t("modals.providerConfig.fields.apiKeyDesc"), placeholder: caps.anthropic ? "sk-ant-..." : "sk-...",
      value: form.apiKey, disabled, onInput: (value) => { form.apiKey = value; },
    });
    // 密钥默认隐藏；切换按钮用 aria-pressed 表示当前是否显示。
    const keyInput = keyRow.input;
    keyInput.inputEl.type = this.showKey ? "text" : "password";
    keyInput.inputEl.autocomplete = "off";
    keyRow.setting.addExtraButton((button) => {
      const label = this.t(this.showKey ? "common.password.hide" : "common.password.show");
      button.setIcon(this.showKey ? "eye-off" : "eye").setTooltip(label).setDisabled(disabled).onClick(() => {
        this.showKey = !this.showKey;
        this.render();
      });
      button.extraSettingsEl.id = "pm-api-key-visibility";
      button.extraSettingsEl.setAttribute("aria-label", label);
      button.extraSettingsEl.setAttribute("aria-pressed", String(this.showKey));
    });

    // 高级区：默认模型、嵌入与模型默认值。添加时展开，编辑时收起。
    const disclosure = new Setting(root).setName(this.t("settings.product.sharedDefaults")).setDesc(this.t("settings.product.sharedHint"));
    disclosure.setClass("cr-service-editor__disclosure");
    disclosure.addExtraButton((button) => {
      button.setIcon(this.showAdvanced ? "chevron-down" : "chevron-right").setTooltip(this.t("settings.product.sharedDefaults")).onClick(() => {
        this.showAdvanced = !this.showAdvanced;
        this.render();
      });
      button.extraSettingsEl.id = "pm-advanced-toggle";
      button.extraSettingsEl.setAttribute("aria-expanded", String(this.showAdvanced));
      button.extraSettingsEl.setAttribute("aria-controls", "pm-advanced");
    });
    if (this.showAdvanced) this.renderAdvanced(root, disabled);

    const enabledRow = new Setting(root).setName(this.t("settings.provider.enabled"));
    enabledRow.addToggle((toggle) => {
      toggle.setValue(form.enabled).setDisabled(disabled).onChange((value) => { form.enabled = value; this.afterEdit(); });
      toggle.toggleEl.id = "pm-enabled";
      toggle.toggleEl.setAttribute("aria-label", this.t("settings.provider.enabled"));
    });

    this.probeEl = doc.createElement("div");
    this.probeEl.className = "cr-service-editor__probe";
    root.appendChild(this.probeEl);
    this.showTestResult();

    if (this.saveError) {
      const alert = doc.createElement("div");
      alert.className = "cr-setting-error cr-service-editor__save-error";
      alert.setAttribute("role", "alert");
      alert.textContent = this.saveError;
      root.appendChild(alert);
    }

    const actions = doc.createElement("div");
    actions.className = "modal-button-container";
    root.appendChild(actions);
    const test = new ButtonComponent(actions)
      .setButtonText(this.testController ? this.options.i18n.t("settings.native.testing") : this.t("settings.provider.testConnection"))
      .setDisabled(disabled || Boolean(this.testController))
      .onClick(() => void this.runTest("initial"));
    test.buttonEl.classList.add("cr-service-editor__test");
    new ButtonComponent(actions).setButtonText(this.t("common.cancel")).setDisabled(disabled).onClick(() => this.close());
    new ButtonComponent(actions)
      .setButtonText(this.saving ? this.options.i18n.t("settings.native.working") : this.t("common.save"))
      .setCta().setDisabled(disabled).onClick(() => void this.handleSave());

    if (focusedId) doc.getElementById(focusedId)?.focus();
  }

  private renderAdvanced(root: HTMLElement, disabled: boolean): void {
    const form = this.form;
    const caps = serviceFormCapabilities(form);
    const section = root.ownerDocument.createElement("div");
    section.id = "pm-advanced";
    section.className = "cr-service-editor__advanced";
    root.appendChild(section);

    if (form.apiFormat !== "disabled") {
      this.textRow(section, {
        id: "pm-chat-model", field: "chatModel", name: this.t("modals.providerConfig.fields.chatModel"),
        desc: this.t("modals.providerConfig.fields.chatModelDesc"), placeholder: chatModelPlaceholder(form),
        value: form.chatModel, disabled, onInput: (value) => { form.chatModel = value; },
      });
    }

    new Setting(section).setHeading().setName(this.t("settings.redesign.optionalEmbedding"));
    this.dropdownRow(section, {
      id: "pm-embedding-api-format", field: "apiFormat", name: this.t("modals.providerConfig.fields.embeddingApiFormat"),
      desc: this.t("modals.providerConfig.fields.embeddingApiFormatDesc"), value: form.embeddingApiFormat, disabled,
      options: {
        "openai-embeddings": this.t("modals.providerConfig.embeddingApiFormats.openaiEmbeddings"),
        disabled: this.t("modals.providerConfig.embeddingApiFormats.disabled"),
      },
      onChange: (value) => {
        form.embeddingApiFormat = value as EmbeddingApiFormat;
        delete this.errors.apiFormat; delete this.errors.embedModel;
      },
    });
    if (form.embeddingApiFormat === "openai-embeddings") {
      this.textRow(section, {
        id: "pm-embed-model", field: "embedModel", name: this.t("modals.providerConfig.fields.embedModel"),
        desc: this.t("modals.providerConfig.fields.embedModelDesc"), placeholder: "text-embedding-004",
        value: form.embedModel, disabled, onInput: (value) => { form.embedModel = value; },
      });
      this.textRow(section, {
        id: "pm-embedding-dimension", field: "embeddingDimension", name: this.t("taskModels.fields.embeddingDimension"),
        desc: this.t("taskModels.fields.embeddingDimensionDesc"), placeholder: this.t("taskModels.fields.optional"),
        value: form.embeddingDimension, disabled, onInput: (value) => { form.embeddingDimension = value; },
      });
    }

    if (form.apiFormat === "disabled") return;
    const heading = new Setting(section).setHeading().setName(this.t("settings.product.modelDefaults"));
    heading.setDesc(caps.anthropic
      ? `${this.t("settings.redesign.providerAdvancedDesc")} ${this.t("modals.providerConfig.fields.anthropicSamplingHint")}`
      : this.t("settings.redesign.providerAdvancedDesc"));
    if (caps.webSearch) {
      this.toggleRow(section, "pm-web-search", this.t("modals.providerConfig.fields.webSearch"), this.t("modals.providerConfig.fields.webSearchDesc"),
        form.enableWebSearch, disabled, (value) => { form.enableWebSearch = value; });
    }
    const temperature = this.toggleRow(section, "pm-temperature-supported", this.t("taskModels.fields.temperature"), "",
      form.temperatureSupported, disabled, (value) => { form.temperatureSupported = value; delete this.errors.temperature; delete this.errors.sampling; },
      ["temperature"]);
    if (form.temperatureSupported) {
      this.numberInput(temperature, "pm-temperature", this.t("taskModels.fields.temperature"), String(form.temperature), disabled, (value) => {
        // 越界值不写入，沿用上一次有效值（与旧编辑框一致）。
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= (caps.anthropic ? 1 : 2)) { form.temperature = parsed; delete this.errors.temperature; }
      });
    }
    const topP = this.toggleRow(section, "pm-top-p-supported", this.t("taskModels.fields.topP"), "",
      form.topPSupported, disabled, (value) => { form.topPSupported = value; delete this.errors.sampling; }, ["sampling"]);
    if (form.topPSupported) {
      this.numberInput(topP, "pm-top-p", this.t("taskModels.fields.topP"), String(form.topP), disabled, (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) form.topP = parsed;
      });
    }
    const reasoning = this.toggleRow(section, "pm-reasoning-supported", this.t("taskModels.fields.reasoningEffort"), "",
      form.reasoningSupported, disabled, (value) => { form.reasoningSupported = value; delete this.errors.reasoning; delete this.errors.sampling; },
      ["reasoning"]);
    if (caps.gemini) {
      this.inlineText(reasoning, "pm-thinking-level", this.t("taskModels.fields.thinkingLevel"), "thinking level", form.thinkingLevel, disabled,
        (value) => { form.thinkingLevel = value; });
    } else if (form.reasoningSupported) {
      this.inlineText(reasoning, "pm-reasoning-effort", this.t("taskModels.fields.reasoningEffort"), caps.anthropic ? "low / medium / high / max" : "effort",
        form.reasoningEffort, disabled, (value) => { form.reasoningEffort = value; delete this.errors.sampling; });
    }
    if (caps.anthropic && form.reasoningSupported) {
      this.textRow(section, {
        id: "pm-thinking-budget", field: "reasoning", name: this.t("taskModels.fields.thinkingBudget"),
        desc: this.t("modals.providerConfig.fields.thinkingBudgetDesc"), placeholder: "1024+",
        value: form.thinkingBudget, disabled, onInput: (value) => { form.thinkingBudget = value; delete this.errors.maxTokens; delete this.errors.sampling; },
      });
    }
    if (caps.promptCaching) {
      const caching = this.toggleRow(section, "pm-prompt-caching", this.t("taskModels.fields.promptCaching"), this.t("taskModels.fields.promptCachingDesc"),
        form.promptCaching, disabled, (value) => { form.promptCaching = value; });
      if (caps.responsesOnly && form.promptCaching) {
        caching.addDropdown((dropdown) => {
          dropdown.addOption("implicit", this.t("taskModels.fields.promptCacheImplicit")).addOption("explicit", this.t("taskModels.fields.promptCacheExplicit"))
            .setValue(form.promptCacheMode).setDisabled(disabled)
            .onChange((value) => { form.promptCacheMode = value as "implicit" | "explicit"; this.afterEdit(); });
          dropdown.selectEl.id = "pm-prompt-cache-mode";
          dropdown.selectEl.setAttribute("aria-label", this.t("taskModels.fields.promptCaching"));
        });
      }
    }
    if (caps.responsesOnly) {
      this.toggleRow(section, "pm-response-continuation", this.t("taskModels.fields.responseContinuation"), "",
        form.responseContinuation, disabled, (value) => { form.responseContinuation = value; });
    }
    this.textRow(section, {
      id: "pm-max-tokens", field: "maxTokens", name: this.t("taskModels.fields.maxTokens"), desc: "",
      placeholder: this.t("taskModels.fields.maxTokensPlaceholder"), value: form.maxTokens, disabled,
      onInput: (value) => { form.maxTokens = value; },
    });
  }

  // ---- 行构造 ----

  /** 说明与该字段的错误写进同一说明区；错误行带 id，输入框经 aria-describedby 关联。 */
  private describe(setting: Setting, desc: string, fields: ServiceFormErrorKey[], errorId: string): string | undefined {
    const doc = setting.descEl.ownerDocument;
    setting.descEl.replaceChildren();
    if (desc) {
      const line = doc.createElement("div");
      line.textContent = desc;
      setting.descEl.appendChild(line);
    }
    const messages = fields.map((field) => this.errors[field]).filter((message): message is string => Boolean(message));
    if (messages.length === 0) return undefined;
    const error = doc.createElement("div");
    error.id = errorId;
    error.className = "cr-setting-error";
    error.setAttribute("role", "alert");
    error.textContent = messages.join(" ");
    setting.descEl.appendChild(error);
    return errorId;
  }

  private textRow(parent: HTMLElement, spec: {
    id: string; field: ServiceFormErrorKey; name: string; desc: string; placeholder: string; value: string;
    disabled: boolean; required?: boolean; onInput: (value: string) => void;
  }): { setting: Setting; input: TextComponent } {
    const setting = new Setting(parent).setName(spec.name);
    if (spec.required) setting.nameEl.appendChild(Object.assign(parent.ownerDocument.createElement("span"), { className: "cr-required", textContent: " *" }));
    const errorId = this.describe(setting, spec.desc, [spec.field], `${spec.id}-error`);
    let input!: TextComponent;
    setting.addText((text) => {
      input = text;
      text.setValue(spec.value).setPlaceholder(spec.placeholder).setDisabled(spec.disabled);
      this.labelInput(text.inputEl, spec.id, spec.name, errorId);
      text.inputEl.spellcheck = false;
      // 输入时只更新表单并清掉本字段的错误，不重绘，避免打断键盘顺序。
      text.inputEl.addEventListener("input", () => {
        spec.onInput(text.inputEl.value);
        this.clearFieldError(spec.field, text.inputEl, errorId);
        this.afterEdit();
      });
    });
    return { setting, input };
  }

  private inlineText(setting: Setting, id: string, label: string, placeholder: string, value: string, disabled: boolean, onInput: (value: string) => void): void {
    setting.addText((text) => {
      text.setValue(value).setPlaceholder(placeholder).setDisabled(disabled);
      this.labelInput(text.inputEl, id, label);
      text.inputEl.addEventListener("input", () => { onInput(text.inputEl.value); this.afterEdit(); });
    });
  }

  private numberInput(setting: Setting, id: string, label: string, value: string, disabled: boolean, onChange: (value: string) => void): void {
    setting.addText((text) => {
      text.setValue(value).setDisabled(disabled);
      text.inputEl.type = "number";
      text.inputEl.step = "any";
      text.inputEl.min = "0";
      this.labelInput(text.inputEl, id, label);
      text.inputEl.addEventListener("change", () => { onChange(text.inputEl.value); this.afterEdit(); });
    });
  }

  private dropdownRow(parent: HTMLElement, spec: {
    id: string; field: ServiceFormErrorKey; name: string; desc: string; value: string; disabled: boolean;
    options: Record<string, string>; onChange: (value: string) => void;
  }): void {
    const setting = new Setting(parent).setName(spec.name);
    const errorId = spec.id === "pm-api-format" ? this.describe(setting, spec.desc, [spec.field], `${spec.id}-error`) : this.describe(setting, spec.desc, [], "");
    setting.addDropdown((dropdown) => {
      dropdown.addOptions(spec.options).setValue(spec.value).setDisabled(spec.disabled).onChange((value) => {
        spec.onChange(value);
        this.afterEdit();
        // 协议决定哪些字段出现，需要重绘。
        this.render();
      });
      this.labelInput(dropdown.selectEl, spec.id, spec.name, errorId);
    });
  }

  private toggleRow(parent: HTMLElement, id: string, name: string, desc: string, value: boolean, disabled: boolean,
    onChange: (value: boolean) => void, errorFields: ServiceFormErrorKey[] = []): Setting {
    const setting = new Setting(parent).setName(name);
    this.describe(setting, desc, errorFields, `${id}-error`);
    setting.addToggle((toggle) => {
      toggle.setValue(value).setDisabled(disabled).onChange((next) => {
        onChange(next);
        this.afterEdit();
        this.render();
      });
      toggle.toggleEl.id = id;
      toggle.toggleEl.setAttribute("aria-label", name);
    });
    return setting;
  }

  private labelInput(element: HTMLElement, id: string, label: string, describedBy?: string): void {
    element.id = id;
    element.setAttribute("aria-label", label);
    if (describedBy) {
      element.setAttribute("aria-describedby", describedBy);
      element.setAttribute("aria-invalid", "true");
    }
  }

  private clearFieldError(field: ServiceFormErrorKey, input: HTMLElement, errorId: string | undefined): void {
    if (!this.errors[field]) return;
    delete this.errors[field];
    if (errorId) input.ownerDocument.getElementById(errorId)?.remove();
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }

  // ---- 连接测试与保存 ----

  /** 表单任何变化后，已显示的连接测试结果若不再对应当前配置就作废。 */
  private afterEdit(): void {
    if (!this.testedSignature || serviceFormSignature(this.form, this.options.currentConfig) === this.testedSignature) return;
    this.invalidateTest("provider configuration changed");
  }

  private invalidateTest(reason: string): void {
    const stale = this.testController;
    this.testController = undefined;
    this.testedSignature = undefined;
    this.testResult = undefined;
    stale?.abort(reason);
    this.showTestResult();
    const testButton = this.contentEl.querySelector<HTMLButtonElement>(".cr-service-editor__test");
    if (testButton && !this.saving) {
      testButton.disabled = false;
      testButton.textContent = this.t("settings.provider.testConnection");
    }
  }

  private showTestResult(): void {
    this.cleanupProbe?.();
    this.cleanupProbe = undefined;
    if (!this.probeEl) return;
    this.probeEl.replaceChildren();
    if (!this.testResult) return;
    this.cleanupProbe = this.options.mountProbe(this.probeEl, {
      result: this.testResult, i18n: this.options.i18n, retrying: Boolean(this.testController), onretry: () => void this.runTest("manual-retry"),
    });
  }

  private async runTest(attemptReason: "initial" | "manual-retry"): Promise<void> {
    if (this.testController || this.saving) return;
    this.errors = validateServiceForm(this.form, (key) => this.t(key), false);
    if (Object.keys(this.errors).length > 0) {
      if (ADVANCED_ERRORS.some((field) => this.errors[field])) this.showAdvanced = true;
      this.render();
      return;
    }
    const controller = new AbortController();
    const config = buildServiceConfig(this.form, this.options.currentConfig, true);
    const signature = serviceFormSignature(this.form, this.options.currentConfig);
    this.testController = controller;
    this.testedSignature = signature;
    this.testResult = undefined;
    this.render();
    let result: ProviderProbeReadModel | undefined;
    try {
      result = await this.options.test({ providerId: this.form.id.trim() || "__test__", configOverride: config, attemptReason }, controller.signal);
    } catch {
      result = {
        outcome: "failed",
        chat: config.apiFormat === "disabled" ? "disabled" : "unavailable",
        embedding: config.embeddingApiFormat === "disabled" ? "disabled" : "unavailable",
      };
    }
    if (this.testController !== controller) return;
    this.testController = undefined;
    if (controller.signal.aborted || serviceFormSignature(this.form, this.options.currentConfig) !== signature) return;
    this.testResult = result;
    this.render();
  }

  private async handleSave(): Promise<void> {
    if (this.saving) return;
    this.errors = validateServiceForm(this.form, (key) => this.t(key));
    if (Object.keys(this.errors).length > 0) {
      if (ADVANCED_ERRORS.some((field) => this.errors[field])) this.showAdvanced = true;
      this.render();
      return;
    }
    this.invalidateTest("provider configuration saved");
    this.saving = true;
    this.saveError = undefined;
    this.render();
    let closeAfter = false;
    try {
      const result = await this.options.save(this.form.id.trim(), buildServiceConfig(this.form, this.options.currentConfig));
      if (result.ok) closeAfter = true;
      else this.saveError = toSafeErrorFeedback(result, this.t("modals.providerConfig.errors.saveFailed")).message;
    } catch {
      this.saveError = this.t("modals.providerConfig.errors.saveFailed");
    } finally {
      this.saving = false;
    }
    if (closeAfter) this.close();
    else this.render();
  }
}
