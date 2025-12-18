/**
 * CognitiveRazorSettingTab - 插件设置面板
 * 
 * Refactored to use Sidebar + Card Layout
 * 
 * Tabs:
 * - General: Basic settings, Language
 * - AI Providers: Provider management
 * - Task Models: Model assignment (Advanced)
 * - Knowledge Scheme: Directory & Naming (Advanced)
 * - System: Logging, Backup, Import/Export
 */

import { App, PluginSettingTab, Setting, Notice, setIcon } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderConfig, CRType, TaskType, TaskModelConfig } from "../types"; // Import CRType explicitly
import { ProviderConfigModal, ConfirmModal } from "./modals";
import { formatMessage } from "../core/i18n";
import { DEFAULT_TASK_MODEL_CONFIGS, PARAM_RECOMMENDATIONS } from "../data/settings-store";

type SettingsTabId = "general" | "providers" | "tasks" | "knowledge" | "system";

export class CognitiveRazorSettingTab extends PluginSettingTab {
  plugin: CognitiveRazorPlugin;
  activeTab: SettingsTabId = "general";
  private taskAccordionState: Record<string, boolean> = {};

  constructor(app: App, plugin: CognitiveRazorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("cr-settings-container");
    containerEl.addClass("cr-scope");

    // Horizontal Navigation
    this.renderNav(containerEl);

    // Content Config Area
    const content = containerEl.createDiv({ cls: "cr-settings-content" });

    switch (this.activeTab) {
      case "general": 
        this.renderGeneralTab(content); 
        break;
      case "providers": 
        this.renderProvidersTab(content); 
        break;
      case "knowledge": 
        this.renderKnowledgeTab(content); 
        break;
      case "system": 
        this.renderSystemTab(content); 
        break;
      case "tasks":
        // 任务模型配置已合并到知识库标签页
        this.renderKnowledgeTab(content);
        break;
    }
  }

  /**
   * 渲染导航栏 - 简化版
   */
  private renderNav(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();
    const nav = container.createDiv({ cls: "cr-settings-nav" });
    
    const tabs: { id: SettingsTabId; name: string; icon: string }[] = [
      { id: "general", name: t.settings.tabs?.general || "通用", icon: "settings" },
      { id: "providers", name: t.settings.tabs?.providers || "AI Providers", icon: "bot" },
      { id: "knowledge", name: t.settings.tabs?.knowledge || "知识库", icon: "folder" },
      { id: "system", name: t.settings.tabs?.system || "系统", icon: "wrench" }
    ];

    tabs.forEach(tab => {
      const item = nav.createDiv({
        cls: `cr-nav-item ${this.activeTab === tab.id ? "is-active" : ""}`
      });
      
      // 图标
      const icon = item.createSpan({ cls: "cr-nav-icon" });
      setIcon(icon, tab.icon);
      
      // 文字
      item.createSpan({ text: tab.name, cls: "cr-nav-text" });

      item.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
    });
  }

  /**
   * 基础设置标签页 - 重新组织
   */
  private renderGeneralTab(container: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    // 界面设置组
    this.renderSettingGroup(container, t.settings.groups?.interface || "界面", [
      {
        name: t.settings.language.name,
        desc: t.settings.language.desc,
        control: (setting) => {
          setting.addDropdown(dropdown => {
            dropdown
              .addOption("zh", t.settings.language.zh)
              .addOption("en", t.settings.language.en)
              .setValue(this.plugin.settings.language)
              .onChange(async (value) => {
                const lang = value as "zh" | "en";
                await this.plugin.settingsStore.update({ language: lang });
                i18n.setLanguage(lang);
                new Notice(formatMessage(t.notices.languageChanged, {
                  language: lang === "zh" ? t.settings.language.zh : t.settings.language.en
                }));
                this.display();
              });
          });
        }
      }
    ]);

    // 去重设置组
    this.renderSettingGroup(container, t.settings.groups?.deduplication || "去重", [
      {
        name: t.settings.similarityThreshold.name,
        desc: t.settings.similarityThreshold.desc,
        control: (setting) => {
          const valueDisplay = setting.controlEl.createDiv({ cls: "cr-slider-value" });
          valueDisplay.textContent = this.plugin.settings.similarityThreshold.toFixed(2);
          
          setting.addSlider(slider => {
            slider
              .setLimits(0.5, 1.0, 0.05)
              .setValue(this.plugin.settings.similarityThreshold)
              .setDynamicTooltip()
              .onChange(async (value) => {
                await this.plugin.settingsStore.update({ similarityThreshold: value });
                valueDisplay.textContent = value.toFixed(2);
              });
          });
        }
      }
    ]);

    // 功能开关
    this.renderSettingGroup(container, t.settings.advanced.features.title, [
      {
        name: t.settings.advanced.features.enableAutoVerify,
        desc: t.settings.advanced.features.enableAutoVerifyDesc,
        control: (setting) => {
          setting.addToggle(toggle => {
            toggle
              .setValue(this.plugin.settings.enableAutoVerify)
              .onChange(async (val) => {
                await this.plugin.settingsStore.update({ enableAutoVerify: val });
              });
          });
        }
      }
    ]);

    // 性能设置组
    this.renderSettingGroup(container, t.settings.groups?.performance || "性能", [
      {
        name: t.settings.concurrency.name,
        desc: t.settings.concurrency.desc,
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue(this.plugin.settings.concurrency.toString())
              .setPlaceholder("3")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num > 0) {
                  await this.plugin.settingsStore.update({ concurrency: num });
                }
              });
            text.inputEl.style.width = "80px";
          });
        }
      },
      {
        name: t.settings.advanced.queue.autoRetry,
        desc: t.settings.advanced.queue.autoRetryDesc,
        control: (setting) => {
          setting.addToggle(toggle => {
            toggle
              .setValue(this.plugin.settings.autoRetry)
              .onChange(async (val) => {
                await this.plugin.settingsStore.update({ autoRetry: val });
              });
          });
        }
      },
      {
        name: t.settings.advanced.queue.maxRetryAttempts,
        desc: t.settings.advanced.queue.maxRetryAttemptsDesc,
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue(this.plugin.settings.maxRetryAttempts.toString())
              .setPlaceholder("3")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num >= 0) {
                  await this.plugin.settingsStore.update({ maxRetryAttempts: num });
                }
              });
            text.inputEl.style.width = "80px";
          });
        }
      },
      {
        name: t.settings.advanced.queue.taskTimeout || "任务超时时间",
        desc: t.settings.advanced.queue.taskTimeoutDesc || "单个任务的最大执行时长（毫秒，默认 1800000 = 30分钟）",
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue((this.plugin.settings.taskTimeoutMs || 1800000).toString())
              .setPlaceholder("1800000")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num >= 1000) {
                  await this.plugin.settingsStore.update({ taskTimeoutMs: num });
                }
              });
            text.inputEl.style.width = "120px";
          });
        }
      },
      {
        name: t.settings.advanced.queue.maxTaskHistory || "任务历史上限",
        desc: t.settings.advanced.queue.maxTaskHistoryDesc || "保留的已完成/失败/取消任务数量上限（默认 300）",
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue((this.plugin.settings.maxTaskHistory || 300).toString())
              .setPlaceholder("300")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num >= 50) {
                  await this.plugin.settingsStore.update({ maxTaskHistory: num });
                }
              });
            text.inputEl.style.width = "80px";
          });
        }
      },
      {
        name: t.settings.advanced.queue.providerTimeout || "Provider 请求超时",
        desc: t.settings.advanced.queue.providerTimeoutDesc || "API 请求的超时时间（毫秒，默认 60000 = 60秒）",
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue((this.plugin.settings.providerTimeoutMs || 60000).toString())
              .setPlaceholder("60000")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num >= 1000) {
                  await this.plugin.settingsStore.update({ providerTimeoutMs: num });
                }
              });
            text.inputEl.style.width = "120px";
          });
        }
      }
    ]);
  }

  /**
   * 渲染设置组
   */
  private renderSettingGroup(
    container: HTMLElement,
    title: string,
    settings: Array<{
      name: string;
      desc: string;
      control: (setting: Setting) => void;
    }>
  ): void {
    const group = container.createDiv({ cls: "cr-setting-group" });
    group.createEl("h3", { text: title, cls: "cr-setting-group-title" });

    settings.forEach(({ name, desc, control }) => {
      const setting = new Setting(group).setName(name).setDesc(desc);
      control(setting);
    });
  }

  /**
   * 渲染可折叠设置组
   */
  private renderCollapsibleGroup(
    container: HTMLElement,
    title: string,
    settings: Array<{
      name: string;
      desc: string;
      control: (setting: Setting) => void;
    }>
  ): void {
    const group = container.createDiv({ cls: "cr-setting-group cr-collapsible-group" });
    
    const header = group.createDiv({ cls: "cr-setting-group-header" });
    const icon = header.createEl("span", { 
      cls: "cr-collapse-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(icon, "chevron-right");
    header.createEl("h3", { text: title, cls: "cr-setting-group-title" });

    const content = group.createDiv({ cls: "cr-setting-group-content cr-collapsed" });

    header.onclick = () => {
      const isCollapsed = content.hasClass("cr-collapsed");
      if (isCollapsed) {
        content.removeClass("cr-collapsed");
        icon.classList.add("is-expanded");
      } else {
        content.addClass("cr-collapsed");
        icon.classList.remove("is-expanded");
      }
    };

    settings.forEach(({ name, desc, control }) => {
      const setting = new Setting(content).setName(name).setDesc(desc);
      control(setting);
    });
  }

  /**
   * Tab: AI Providers - 列表形式
   */
  private renderProvidersTab(container: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    // Header with Add Button
    const header = container.createDiv({ cls: "cr-flex-row" });
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "var(--size-4-4)";
    header.createEl("h2", { text: t.settings.provider.title, attr: { style: "margin: 0" } });

    const addBtn = header.createEl("button", { text: t.settings.provider.addButton, cls: "mod-cta" });
    addBtn.onclick = () => this.showAddProviderModal();

    const providers = this.plugin.settings.providers;

    // Default Provider Selection
    if (Object.keys(providers).length > 0) {
      new Setting(container)
        .setName(t.settings.provider.defaultProvider)
        .setDesc(t.settings.provider.defaultProviderDesc)
        .addDropdown(dropdown => {
          Object.keys(providers).forEach(id => {
            dropdown.addOption(id, id);
          });
          dropdown
            .setValue(this.plugin.settings.defaultProviderId)
            .onChange(async (value) => {
              await this.plugin.settingsStore.setDefaultProvider(value);
              new Notice(formatMessage(t.notices.providerSetDefault, { id: value }));
            });
        });
    }

    // Provider List
    if (Object.keys(providers).length === 0) {
      const emptyState = container.createDiv({ cls: "cr-empty-state" });
      emptyState.createEl("p", { text: t.settings.provider.noProvider });
      emptyState.createEl("p", { 
        text: t.settings.provider.addFirstProvider || "点击上方按钮添加您的第一个 AI Provider",
        cls: "cr-text-muted"
      });
    } else {
      Object.entries(providers).forEach(([id, config]) => {
        this.renderProviderItem(container, id, config as ProviderConfig);
      });
    }
  }

  /**
   * 渲染单个 Provider 项（列表形式）
   */
  private renderProviderItem(container: HTMLElement, id: string, config: ProviderConfig): void {
    const t = this.plugin.getI18n().t();
    
    // Provider 名称和启用状态
    const nameSetting = new Setting(container)
      .setName(id)
      .setDesc(`${t.settings.provider.model}: ${config.defaultChatModel}`)
      .addToggle(toggle => {
        toggle
          .setValue(config.enabled)
          .onChange(async (val) => {
            await this.plugin.settingsStore.updateProvider(id, { enabled: val });
            new Notice(formatMessage(t.notices.providerUpdated, { id }));
          });
      });

    // 操作按钮
    nameSetting.addButton(btn => {
      btn
        .setButtonText(t.settings.provider.testConnection)
        .onClick(() => this.testProviderConnection(id));
    });

    nameSetting.addButton(btn => {
      btn
        .setButtonText(t.common.edit)
        .onClick(() => this.showEditProviderModal(id, config));
    });

    nameSetting.addButton(btn => {
      btn
        .setButtonText(t.common.delete)
        .setWarning()
        .onClick(() => this.showDeleteProviderConfirm(id));
    });
  }

  /**
   * 知识库标签页 - 合并目录和任务模型配置
   */
  private renderKnowledgeTab(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();

    // 目录结构设置
    const dirGroup = container.createDiv({ cls: "cr-setting-group" });
    dirGroup.createEl("h3", { text: t.settings.groups?.directory || "目录结构", cls: "cr-setting-group-title" });

    // 命名模板
    new Setting(dirGroup)
      .setName(t.settings.advanced.namingTemplate.name)
      .setDesc(t.settings.advanced.namingTemplate.desc)
      .addText(text => {
        text
          .setPlaceholder("{{chinese}} ({{english}})")
          .setValue(this.plugin.settings.namingTemplate)
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({ namingTemplate: val });
          });
        text.inputEl.style.width = "300px";
      });

    // 类型目录映射
    const typeGroup = container.createDiv({ cls: "cr-setting-group" });
    typeGroup.createEl("h3", { text: t.settings.groups?.typeDirectories || "类型目录", cls: "cr-setting-group-title" });

    const crTypes: Array<{ key: CRType; name: string; desc: string }> = [
      { 
        key: "Domain", 
        name: `${t.crTypes.Domain} (Domain)`, 
        desc: t.crTypeDirectories.Domain
      },
      { 
        key: "Issue", 
        name: `${t.crTypes.Issue} (Issue)`, 
        desc: t.crTypeDirectories.Issue
      },
      { 
        key: "Theory", 
        name: `${t.crTypes.Theory} (Theory)`, 
        desc: t.crTypeDirectories.Theory
      },
      { 
        key: "Entity", 
        name: `${t.crTypes.Entity} (Entity)`, 
        desc: t.crTypeDirectories.Entity
      },
      { 
        key: "Mechanism", 
        name: `${t.crTypes.Mechanism} (Mechanism)`, 
        desc: t.crTypeDirectories.Mechanism
      }
    ];

    crTypes.forEach(crType => {
      new Setting(typeGroup)
        .setName(crType.name)
        .setDesc(crType.desc)
        .addText(text => {
          text
            .setPlaceholder(this.plugin.settings.directoryScheme[crType.key])
            .setValue(this.plugin.settings.directoryScheme[crType.key])
            .onChange(async (val) => {
              const ds = { ...this.plugin.settings.directoryScheme };
              ds[crType.key] = val;
              await this.plugin.settingsStore.update({ directoryScheme: ds });
            });
          text.inputEl.style.width = "200px";
        });
    });

    // 向量嵌入设置
    this.renderSettingGroup(container, t.settings.groups?.vectorEmbedding || "向量嵌入", [
      {
        name: t.settings.advanced.embedding.dimension,
        desc: t.settings.advanced.embedding.dimensionDesc,
        control: (setting) => {
          setting.addDropdown(dropdown => {
            ["256", "512", "1024", "1536", "3072"].forEach(d => dropdown.addOption(d, d));
            dropdown
              .setValue((this.plugin.settings.embeddingDimension ?? 1536).toString())
              .onChange(async (val) => {
                await this.plugin.settingsStore.update({ embeddingDimension: parseInt(val) });
                new Notice(t.settings.advanced.embedding.dimensionWarning);
              });
          });
        }
      }
    ]);

    // 任务模型配置（手风琴）
    this.renderTaskModelsSection(container);

    // 图片生成设置
    this.renderImageGenerationSettings(container);
  }

  /**
   * 任务模型配置区域（手风琴布局）
   */
  private renderTaskModelsSection(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();
    const providerIds = Object.keys(this.plugin.settings.providers);
    const containerEl = container.createDiv({ cls: "cr-task-models-container" });

    // Header
    const header = containerEl.createDiv({ cls: "cr-task-model-header" });
    header.createEl("h3", { text: t.taskModels?.title || "任务模型配置" });

    const resetAllBtn = header.createEl("button", {
      text: t.taskModels?.resetAll || "重置全部",
      cls: "cr-task-model-reset-all"
    });
    resetAllBtn.addEventListener("click", () => {
      new ConfirmModal(this.app, {
        title: t.taskModels?.resetAll || "重置全部",
        message: t.taskModels?.resetAllConfirm || "确定要将所有任务配置重置为默认值吗？此操作不可撤销。",
        onConfirm: async () => {
          const result = await this.plugin.settingsStore.resetAllTaskModels();
          if (!result.ok) {
            new Notice(result.error.message);
            return;
          }
          this.plugin.settings = this.plugin.settingsStore.getSettings();
          this.display();
        }
      }).open();
    });

    const tasks: Array<{ key: TaskType; name: string; desc: string }> = [
      { key: "define", name: t.taskModels?.tasks?.define?.name || t.taskTypes.define.name, desc: t.taskModels?.tasks?.define?.desc || t.taskTypes.define.desc },
      { key: "tag", name: t.taskModels?.tasks?.tag?.name || t.taskTypes.tag.name, desc: t.taskModels?.tasks?.tag?.desc || t.taskTypes.tag.desc },
      { key: "write", name: t.taskModels?.tasks?.write?.name || t.taskTypes.write.name, desc: t.taskModels?.tasks?.write?.desc || t.taskTypes.write.desc },
      { key: "index", name: t.taskModels?.tasks?.index?.name || t.taskTypes.index.name, desc: t.taskModels?.tasks?.index?.desc || t.taskTypes.index.desc },
      { key: "verify", name: t.taskModels?.tasks?.verify?.name || t.taskTypes.verify.name, desc: t.taskModels?.tasks?.verify?.desc || t.taskTypes.verify.desc },
    ];

    tasks.forEach((task) => {
      this.renderTaskModelCard(containerEl, task, providerIds);
    });
  }

  /**
   * 渲染单个任务模型卡片
   */
  private renderTaskModelCard(root: HTMLElement, task: { key: TaskType; name: string; desc: string }, providerIds: string[]): void {
    const t = this.plugin.getI18n().t();
    const taskConfig = this.plugin.settings.taskModels[task.key] || DEFAULT_TASK_MODEL_CONFIGS[task.key];
    const isIndexTask = task.key === "index";
    const card = root.createDiv({ cls: "cr-task-model-card" });

    const header = card.createDiv({ cls: "cr-task-model-card-header" });
    const titleWrapper = header.createDiv({ cls: "cr-task-model-card-title" });
    const chevron = titleWrapper.createSpan({ cls: "collapse-icon", attr: { "aria-hidden": "true" } });
    setIcon(chevron, "chevron-right");
    const expanded = this.taskAccordionState[task.key] ?? false;
    if (expanded) chevron.addClass("is-expanded");
    const title = titleWrapper.createDiv();
    title.createEl("div", { text: task.name, cls: "cr-task-model-name" });
    title.createEl("div", { text: task.desc, cls: "cr-task-model-desc" });

    const actions = header.createDiv({ cls: "cr-task-model-card-actions" });

    const status = actions.createDiv({ cls: "cr-task-model-status" });
    const statusDot = status.createDiv({ cls: "cr-task-model-status-dot" });
    const statusText = status.createSpan();

    const applyStatus = (): void => {
      const isDefault = this.plugin.settingsStore.isTaskModelDefault(task.key);
      statusDot.className = "cr-task-model-status-dot " + (isDefault ? "is-default" : "is-custom");
      statusText.setText(
        isDefault ? (t.taskModels?.isDefault || "默认值") : (t.taskModels?.isCustom || "自定义")
      );
    };
    applyStatus();

    const resetBtn = actions.createEl("button", { text: t.taskModels?.reset || "重置", cls: "cr-task-model-reset-btn" });
    resetBtn.addEventListener("click", () => {
      new ConfirmModal(this.app, {
        title: t.taskModels?.reset || "重置",
        message: t.taskModels?.resetConfirm || "确定要将此任务配置重置为默认值吗？",
        onConfirm: async () => {
          const result = await this.plugin.settingsStore.resetTaskModel(task.key);
          if (!result.ok) {
            new Notice(result.error.message);
            return;
          }
          this.plugin.settings = this.plugin.settingsStore.getSettings();
          this.taskAccordionState[task.key] = true;
          this.display();
        }
      }).open();
    });

    const contentWrapper = card.createDiv({ cls: "cr-task-model-card-content" });
    if (expanded) contentWrapper.addClass("is-expanded");
    const body = contentWrapper.createDiv({ cls: "cr-task-model-card-body" });

    const toggle = (): void => {
      const next = !contentWrapper.hasClass("is-expanded");
      this.taskAccordionState[task.key] = next;
      contentWrapper.toggleClass("is-expanded", next);
      chevron.toggleClass("is-expanded", next);
    };
    header.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      toggle();
    });

    const disabledInputs = providerIds.length === 0;
    const providerHint = disabledInputs ? (t.taskModels?.fields?.providerDesc || "选择 AI Provider（留空则使用默认 Provider）") : "";

    // Provider
    this.renderFieldRow(body, t.taskModels?.fields?.provider || "Provider", providerHint, (control) => {
      const dropdown = control.createEl("select", { cls: "dropdown" });
      const defaultOption = dropdown.createEl("option", { value: "", text: t.taskModels?.fields?.useDefaultProvider || "使用默认 Provider" });
      defaultOption.value = "";
      providerIds.forEach((id) => dropdown.createEl("option", { value: id, text: id }));
      dropdown.value = taskConfig?.providerId || "";
      if (disabledInputs) {
        dropdown.disabled = true;
      } else {
        dropdown.onchange = async () => {
          await this.persistTaskModel(task.key, { providerId: dropdown.value });
          applyStatus();
        };
      }
    });

    // 模型
    this.renderFieldRow(body, t.taskModels?.fields?.model || "模型名称", t.taskModels?.fields?.modelDesc || "", (control) => {
      const input = control.createEl("input", { type: "text", cls: "model-input" });
      input.placeholder = t.taskModels?.fields?.modelDesc || "gpt-4o";
      input.value = taskConfig?.model || "";
      input.disabled = disabledInputs;
      input.addEventListener("change", async () => {
        await this.persistTaskModel(task.key, { model: input.value });
        applyStatus();
      });
    });

    if (!isIndexTask) {
      // Temperature
      this.renderFieldRow(
        body,
        t.taskModels?.fields?.temperature || "Temperature",
        `${t.taskModels?.recommended || "推荐"}: ${this.getTemperatureRecommendation(task.key)}`,
        (control) => {
          const input = control.createEl("input", { type: "number", cls: "numeric-input", attr: { min: "0", max: "2", step: "0.1" } });
          input.value = taskConfig?.temperature?.toString() || "";
          input.disabled = disabledInputs;
          input.addEventListener("blur", async () => {
            const parsed = parseFloat(input.value);
            if (Number.isNaN(parsed) || parsed < 0 || parsed > 2) {
              new Notice(t.taskModels?.validation?.temperature || "Temperature 需在 0-2 之间");
              input.value = taskConfig?.temperature?.toString() || "";
              return;
            }
            await this.persistTaskModel(task.key, { temperature: parsed });
            applyStatus();
          });
        }
      );

      // TopP
      this.renderFieldRow(
        body,
        t.taskModels?.fields?.topP || "Top P",
        `${t.taskModels?.recommended || "推荐"}: ${PARAM_RECOMMENDATIONS.topP.default.recommended}`,
        (control) => {
          const input = control.createEl("input", { type: "number", cls: "numeric-input", attr: { min: "0", max: "1", step: "0.01" } });
          input.value = taskConfig?.topP?.toString() || "";
          input.disabled = disabledInputs;
          input.addEventListener("blur", async () => {
            const parsed = parseFloat(input.value);
            if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
              new Notice(t.taskModels?.validation?.topP || "Top P 需在 0-1 之间");
              input.value = taskConfig?.topP?.toString() || "";
              return;
            }
            await this.persistTaskModel(task.key, { topP: parsed });
            applyStatus();
          });
        }
      );

      // Reasoning effort
      this.renderFieldRow(
        body,
        t.taskModels?.fields?.reasoningEffort || "推理强度",
        t.taskModels?.fields?.reasoningEffortDesc || "",
        (control) => {
          const select = control.createEl("select", { cls: "dropdown" });
          select.createEl("option", { value: "", text: t.taskModels?.reasoningEffortOptions?.notSet || "不设置" });
          select.createEl("option", { value: "low", text: t.taskModels?.reasoningEffortOptions?.low || "低" });
          select.createEl("option", { value: "medium", text: t.taskModels?.reasoningEffortOptions?.medium || "中" });
          select.createEl("option", { value: "high", text: t.taskModels?.reasoningEffortOptions?.high || "高" });
          select.value = taskConfig?.reasoning_effort || "";
          select.disabled = disabledInputs;
          select.addEventListener("change", async () => {
            await this.persistTaskModel(task.key, { reasoning_effort: select.value as TaskModelConfig["reasoning_effort"] });
            applyStatus();
          });
        }
      );
    } else {
      // Embedding dimension
      this.renderFieldRow(
        body,
        t.taskModels?.fields?.embeddingDimension || "嵌入维度",
        `${t.taskModels?.recommended || "推荐"}: ${PARAM_RECOMMENDATIONS.embeddingDimension.recommended}`,
        (control) => {
          const select = control.createEl("select", { cls: "dropdown" });
          PARAM_RECOMMENDATIONS.embeddingDimension.options.forEach((opt) => {
            select.createEl("option", { value: opt.toString(), text: opt.toString() });
          });
          select.value = (taskConfig?.embeddingDimension || PARAM_RECOMMENDATIONS.embeddingDimension.options[3]).toString();
          select.disabled = disabledInputs;
          select.addEventListener("change", async () => {
            await this.persistTaskModel(task.key, { embeddingDimension: parseInt(select.value, 10) });
            applyStatus();
          });
        }
      );
    }
  }

  private renderFieldRow(
    container: HTMLElement,
    label: string,
    hint: string,
    renderControl: (control: HTMLElement) => void
  ): void {
    const row = container.createDiv({ cls: "cr-task-model-field" });
    row.createDiv({ cls: "cr-task-model-field-label", text: label });
    const control = row.createDiv({ cls: "cr-task-model-field-control" });
    renderControl(control);
    if (hint) {
      row.createDiv({ cls: "cr-task-model-field-hint", text: hint });
    }
  }

  private async persistTaskModel(taskType: TaskType, partial: Partial<TaskModelConfig>): Promise<void> {
    const taskModels = { ...this.plugin.settings.taskModels };
    taskModels[taskType] = {
      ...DEFAULT_TASK_MODEL_CONFIGS[taskType],
      ...taskModels[taskType],
      ...partial
    };
    const result = await this.plugin.settingsStore.update({ taskModels });
    if (result.ok) {
      this.plugin.settings = this.plugin.settingsStore.getSettings();
    } else {
      new Notice(result.error.message);
    }
  }

  private getTemperatureRecommendation(taskType: TaskType): string {
    const temp = PARAM_RECOMMENDATIONS.temperature as Record<string, { recommended: string }>;
    return temp[taskType]?.recommended || temp.define.recommended;
  }

  /**
   * 图片生成设置
   */
  private renderImageGenerationSettings(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();
    const group = container.createDiv({ cls: "cr-setting-group" });
    group.createEl("h3", { text: t.imageGeneration?.title || "图片生成设置", cls: "cr-setting-group-title" });

    new Setting(group)
      .setName(t.imageGeneration?.enabled?.name || "启用图片生成")
      .setDesc(t.imageGeneration?.enabled?.desc || "允许在笔记中插入 AI 生成的图片")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.imageGeneration.enabled)
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({
              imageGeneration: { ...this.plugin.settings.imageGeneration, enabled: val }
            });
          })
      );

    new Setting(group)
      .setName(t.imageGeneration?.defaultSize?.name || "默认图片尺寸")
      .setDesc(t.imageGeneration?.defaultSize?.desc || "选择生成图片的默认尺寸")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("1024x1024", t.imageGeneration?.defaultSize?.square || "正方形 (1024×1024)")
          .addOption("1792x1024", t.imageGeneration?.defaultSize?.landscape || "横向 (1792×1024)")
          .addOption("1024x1792", t.imageGeneration?.defaultSize?.portrait || "纵向 (1024×1792)")
          .setValue(this.plugin.settings.imageGeneration.defaultSize)
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({
              imageGeneration: { ...this.plugin.settings.imageGeneration, defaultSize: val }
            });
          });
      });

    new Setting(group)
      .setName(t.imageGeneration?.defaultQuality?.name || "图片质量")
      .setDesc(t.imageGeneration?.defaultQuality?.desc || "standard: 标准质量，hd: 高清质量")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("standard", t.imageGeneration?.defaultQuality?.standard || "标准")
          .addOption("hd", t.imageGeneration?.defaultQuality?.hd || "高清")
          .setValue(this.plugin.settings.imageGeneration.defaultQuality)
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({
              imageGeneration: { ...this.plugin.settings.imageGeneration, defaultQuality: val as "standard" | "hd" }
            });
          });
      });

    new Setting(group)
      .setName(t.imageGeneration?.defaultStyle?.name || "图片风格")
      .setDesc(t.imageGeneration?.defaultStyle?.desc || "选择图片风格")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("vivid", t.imageGeneration?.defaultStyle?.vivid || "鲜艳")
          .addOption("natural", t.imageGeneration?.defaultStyle?.natural || "自然")
          .setValue(this.plugin.settings.imageGeneration.defaultStyle)
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({
              imageGeneration: { ...this.plugin.settings.imageGeneration, defaultStyle: val as "vivid" | "natural" }
            });
          });
      });

    new Setting(group)
      .setName(t.imageGeneration?.contextWindowSize?.name || "上下文窗口大小")
      .setDesc(t.imageGeneration?.contextWindowSize?.desc || "读取光标前后用于提示词的字符数")
      .addSlider((slider) => {
        slider
          .setLimits(100, 1000, 50)
          .setValue(this.plugin.settings.imageGeneration.contextWindowSize)
          .setDynamicTooltip()
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({
              imageGeneration: { ...this.plugin.settings.imageGeneration, contextWindowSize: val }
            });
          });
      });
  }



  /**
   * 系统标签页 - 重新组织
   */
  private renderSystemTab(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();

    // 快照管理
    this.renderSettingGroup(container, t.settings.groups?.snapshots || "快照与撤销", [
      {
        name: t.settings.maxSnapshots.name,
        desc: t.settings.maxSnapshots.desc,
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue(this.plugin.settings.maxSnapshots.toString())
              .setPlaceholder("100")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num > 0) {
                  await this.plugin.settingsStore.update({ maxSnapshots: num });
                }
              });
            text.inputEl.style.width = "80px";
          });
        }
      },
      {
        name: t.settings.maxSnapshotAgeDays.name,
        desc: t.settings.maxSnapshotAgeDays.desc,
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue((this.plugin.settings.maxSnapshotAgeDays ?? 30).toString())
              .setPlaceholder("30")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num > 0) {
                  await this.plugin.settingsStore.update({ maxSnapshotAgeDays: num });
                }
              });
            text.inputEl.style.width = "80px";
          });
        }
      }
    ]);

    // 日志管理
    this.renderSettingGroup(container, t.settings.groups?.logging || "日志", [
      {
        name: t.settings.advanced.logging.logLevel,
        desc: t.settings.advanced.logging.logLevelDesc,
        control: (setting) => {
          setting.addDropdown(dropdown => {
            (["debug", "info", "warn", "error"] as const).forEach(level => {
              dropdown.addOption(level, t.settings.advanced.logging.levels[level]);
            });
            dropdown
              .setValue(this.plugin.settings.logLevel)
              .onChange(async (val) => {
                await this.plugin.settingsStore.update({ logLevel: val as "debug" | "info" | "warn" | "error" });
                new Notice(formatMessage(t.notices.logLevelChanged, { level: val }));
              });
          });
        }
      },
      {
        name: t.settings.advanced.logging.clearLogs,
        desc: t.settings.advanced.logging.clearLogsDesc,
        control: (setting) => {
          setting.addButton(btn => {
            btn
              .setButtonText(t.settings.advanced.logging.clearLogs)
              .setWarning()
              .onClick(async () => await this.clearLogs());
          });
        }
      }
    ]);

    // 数据管理
    this.renderSettingGroup(container, t.settings.groups?.dataManagement || "数据管理", [
      {
        name: t.settings.importExport.export,
        desc: t.settings.importExport.exportDesc,
        control: (setting) => {
          setting.addButton(btn => {
            btn.setButtonText(t.settings.importExport.export).onClick(async () => {
              const result = await this.plugin.settingsStore.export();
              if (result.ok) {
                const blob = new Blob([result.value], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "cognitive-razor-settings.json";
                a.click();
                URL.revokeObjectURL(url);
                new Notice(t.notices.settingsExported);
              } else {
                new Notice(`${t.common.error}: ${result.error.message}`);
              }
            });
          });
        }
      },
      {
        name: t.settings.importExport.import,
        desc: t.settings.importExport.importDesc,
        control: (setting) => {
          setting.addButton(btn => {
            btn.setButtonText(t.settings.importExport.import).onClick(() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json";
              input.onchange = async (e: Event) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  const text = await file.text();
                  const result = await this.plugin.settingsStore.import(text);
                  if (result.ok) {
                    new Notice(t.notices.settingsImported);
                    this.display();
                  } else {
                    new Notice(result.error.message);
                  }
                }
              };
              input.click();
            });
          });
        }
      },
      {
        name: t.settings.importExport.reset,
        desc: t.settings.importExport.resetDesc,
        control: (setting) => {
          setting.addButton(btn => {
            btn
              .setButtonText(t.settings.importExport.reset)
              .setWarning()
              .onClick(() => this.showResetSettingsConfirm());
          });
        }
      }
    ]);
  }

  /* ================= Helpers ================= */

  private showAddProviderModal(): void {
    const t = this.plugin.getI18n().t();
    new ProviderConfigModal(this.app, {
      mode: "add",
      title: t.modals.addProvider.title,
      onSave: async (id, config) => {
        const result = await this.plugin.settingsStore.addProvider(id, config);
        if (result.ok) {
          new Notice(formatMessage(t.notices.providerAdded, { id }));
          this.display();
        } else {
          new Notice(result.error.message);
          throw new Error(result.error.message);
        }
      },
      onCancel: () => { }
    }).open();
  }

  private showEditProviderModal(id: string, config: ProviderConfig): void {
    const t = this.plugin.getI18n().t();
    new ProviderConfigModal(this.app, {
      mode: "edit",
      title: t.modals.editProvider.title,
      providerId: id,
      currentConfig: config,
      onSave: async (pid, newConfig) => {
        const result = await this.plugin.settingsStore.updateProvider(pid, newConfig);
        if (result.ok) {
          new Notice(formatMessage(t.notices.providerUpdated, { id: pid }));
          this.display();
        } else throw new Error(result.error.message);
      },
      onCancel: () => { }
    }).open();
  }

  private showDeleteProviderConfirm(id: string): void {
    const t = this.plugin.getI18n().t();
    new ConfirmModal(this.app, {
      title: t.confirmDialogs.deleteProvider.title,
      message: formatMessage(t.confirmDialogs.deleteProvider.message, { id }),
      danger: true,
      confirmText: t.common.delete, // Add this if ConfirmModal supports it, checking modals.ts... Yes it does (confirmText)
      onConfirm: async () => {
        const components = this.plugin.getComponents();
        components.providerManager.removeProvider(id);
        new Notice(formatMessage(t.notices.providerDeleted, { id }));
        this.display();
      }
    }).open();
  }

  private showResetSettingsConfirm(): void {
    const t = this.plugin.getI18n().t();
    new ConfirmModal(this.app, {
      title: t.confirmDialogs.resetSettings.title,
      message: t.confirmDialogs.resetSettings.message,
      danger: true,
      onConfirm: async () => {
        await this.plugin.settingsStore.reset();
        new Notice(t.notices.settingsReset);
        this.display();
      }
    }).open();
  }

  private async testProviderConnection(id: string): Promise<void> {
    const t = this.plugin.getI18n().t();
    const components = this.plugin.getComponents();

    new Notice(t.common.loading || "Testing...");

    const result = await components.providerManager.checkAvailability(id, true);

    if (result.ok) {
      const caps = result.value;
      const msg = formatMessage(t.notices.connectionSuccess, {
        chat: caps.chat ? "OK" : "X",
        embedding: caps.embedding ? "OK" : "X",
        models: caps.models.length
      });
      new Notice(msg);
    } else {
      new Notice(formatMessage(t.notices.connectionFailed, { error: result.error.message }));
    }
  }

  private async clearLogs(): Promise<void> {
    const t = this.plugin.getI18n().t();
    // Implementation depends on LogManager availability.
    // this.plugin.getComponents().logManager.clear();
    // Placeholder
    new Notice(t.notices.logsCleared);
  }
}
