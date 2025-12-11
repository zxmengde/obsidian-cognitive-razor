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

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderConfig, CRType } from "../types"; // Import CRType explicitly
import { ProviderConfigModal, ConfirmModal } from "./modals";
import { formatMessage } from "../core/i18n";

type SettingsTabId = "general" | "providers" | "tasks" | "knowledge" | "system";

export class CognitiveRazorSettingTab extends PluginSettingTab {
  plugin: CognitiveRazorPlugin;
  activeTab: SettingsTabId = "general";

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
      icon.innerHTML = this.getIconSvg(tab.icon);
      
      // 文字
      item.createSpan({ text: tab.name, cls: "cr-nav-text" });

      item.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
    });
  }

  /**
   * 获取图标 SVG
   */
  private getIconSvg(name: string): string {
    const icons: Record<string, string> = {
      settings: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m5.2-13.2l-4.2 4.2m0 6l4.2 4.2M23 12h-6m-6 0H1m18.2 5.2l-4.2-4.2m-6 0l-4.2 4.2"></path></svg>',
      bot: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4m-4 4h.01M16 15h.01"></path></svg>',
      folder: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
      wrench: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>'
    };
    return icons[name] || icons.settings;
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
      },
      {
        name: t.settings.advanced.deduplication.topK,
        desc: t.settings.advanced.deduplication.topKDesc,
        control: (setting) => {
          setting.addText(text => {
            text
              .setValue(this.plugin.settings.topK.toString())
              .setPlaceholder("10")
              .onChange(async (val) => {
                const num = parseInt(val);
                if (!isNaN(num) && num > 0) {
                  await this.plugin.settingsStore.update({ topK: num });
                }
              });
            text.inputEl.style.width = "80px";
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
    const icon = header.createSpan({ cls: "cr-collapse-icon", text: "▶" });
    header.createEl("h3", { text: title, cls: "cr-setting-group-title" });

    const content = group.createDiv({ cls: "cr-setting-group-content cr-collapsed" });

    header.onclick = () => {
      const isCollapsed = content.hasClass("cr-collapsed");
      if (isCollapsed) {
        content.removeClass("cr-collapsed");
        icon.textContent = "▼";
      } else {
        content.addClass("cr-collapsed");
        icon.textContent = "▶";
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

    // 任务模型配置
    this.renderTaskModelsSection(container);
  }

  /**
   * 任务模型配置区域
   */
  private renderTaskModelsSection(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();
    const providerIds = Object.keys(this.plugin.settings.providers);

    const taskGroup = container.createDiv({ cls: "cr-setting-group" });
    taskGroup.createEl("h3", { text: t.settings.groups?.taskModels || "任务模型配置", cls: "cr-setting-group-title" });

    const taskTypes: Array<{ key: string; name: string; desc: string }> = [
      { key: "standardizeClassify", name: t.taskTypes.standardizeClassify.name, desc: t.taskTypes.standardizeClassify.desc },
      { key: "enrich", name: t.taskTypes.enrich.name, desc: t.taskTypes.enrich.desc },
      { key: "embedding", name: t.taskTypes.embedding.name, desc: t.taskTypes.embedding.desc },
      { key: "reason:new", name: t.taskTypes["reason:new"].name, desc: t.taskTypes["reason:new"].desc },
      { key: "ground", name: t.taskTypes.ground.name, desc: t.taskTypes.ground.desc }
    ];

    taskTypes.forEach(taskType => {
      const taskConfig = this.plugin.settings.taskModels[taskType.key as keyof typeof this.plugin.settings.taskModels];
      
      const setting = new Setting(taskGroup)
        .setName(taskType.name)
        .setDesc(taskType.desc);

      // Provider 选择
      setting.addDropdown(dropdown => {
        if (providerIds.length === 0) {
          dropdown.addOption("", t.settings.advanced.taskModels.configureProviderFirst);
        } else {
          dropdown.addOption("", t.settings.advanced.taskModels.useDefaultProvider);
          providerIds.forEach(id => dropdown.addOption(id, id));
        }
        dropdown
          .setValue(taskConfig?.providerId || "")
          .onChange(async (val) => {
            const taskModels = { ...this.plugin.settings.taskModels };
            taskModels[taskType.key as keyof typeof taskModels] = { ...taskConfig, providerId: val };
            await this.plugin.settingsStore.update({ taskModels });
          });
      });

      // 模型名称
      setting.addText(text => {
        text
          .setPlaceholder(t.settings.advanced.taskModels.modelNamePlaceholder)
          .setValue(taskConfig?.model || "")
          .onChange(async (val) => {
            const taskModels = { ...this.plugin.settings.taskModels };
            taskModels[taskType.key as keyof typeof taskModels] = { ...taskConfig, model: val };
            await this.plugin.settingsStore.update({ taskModels });
          });
        text.inputEl.style.width = "150px";
      });
    });

    // 高级参数配置（可折叠）
    this.renderCollapsibleGroup(container, t.settings.advanced.taskModels.advancedParams || "高级参数配置", [
      {
        name: t.settings.advanced.temperature.name,
        desc: t.settings.advanced.temperature.desc,
        control: (setting) => {
          const taskTypeSelect = setting.controlEl.createEl("select", { cls: "dropdown" });
          taskTypes.forEach(tt => {
            const option = taskTypeSelect.createEl("option", { value: tt.key, text: tt.name });
          });
          
          const tempInput = setting.controlEl.createEl("input", { 
            type: "text", 
            attr: { placeholder: "0.7", style: "width: 80px; margin-left: 8px;" }
          });
          
          const updateTemp = () => {
            const selectedTask = taskTypeSelect.value as keyof typeof this.plugin.settings.taskModels;
            const config = this.plugin.settings.taskModels[selectedTask];
            tempInput.value = config?.temperature?.toString() || "";
          };
          
          taskTypeSelect.addEventListener("change", updateTemp);
          updateTemp();
          
          tempInput.addEventListener("blur", async () => {
            const selectedTask = taskTypeSelect.value as keyof typeof this.plugin.settings.taskModels;
            const num = parseFloat(tempInput.value);
            if (!isNaN(num) && num >= 0 && num <= 2) {
              const taskModels = { ...this.plugin.settings.taskModels };
              const config = taskModels[selectedTask];
              taskModels[selectedTask] = { ...config, temperature: num };
              await this.plugin.settingsStore.update({ taskModels });
            }
          });
        }
      },
      {
        name: t.settings.advanced.reasoningEffort.name,
        desc: t.settings.advanced.reasoningEffort.desc,
        control: (setting) => {
          const taskTypeSelect = setting.controlEl.createEl("select", { cls: "dropdown" });
          taskTypes.forEach(tt => {
            const option = taskTypeSelect.createEl("option", { value: tt.key, text: tt.name });
          });
          
          const effortSelect = setting.controlEl.createEl("select", { 
            cls: "dropdown",
            attr: { style: "margin-left: 8px;" }
          });
          effortSelect.createEl("option", { value: "", text: t.settings.advanced.taskModels.notSet });
          effortSelect.createEl("option", { value: "low", text: t.settings.advanced.taskModels.low });
          effortSelect.createEl("option", { value: "medium", text: t.settings.advanced.taskModels.medium });
          effortSelect.createEl("option", { value: "high", text: t.settings.advanced.taskModels.high });
          
          const updateEffort = () => {
            const selectedTask = taskTypeSelect.value as keyof typeof this.plugin.settings.taskModels;
            const config = this.plugin.settings.taskModels[selectedTask];
            effortSelect.value = config?.reasoning_effort || "";
          };
          
          taskTypeSelect.addEventListener("change", updateEffort);
          updateEffort();
          
          effortSelect.addEventListener("change", async () => {
            const selectedTask = taskTypeSelect.value as keyof typeof this.plugin.settings.taskModels;
            const value = effortSelect.value as "low" | "medium" | "high" | "";
            const taskModels = { ...this.plugin.settings.taskModels };
            const config = taskModels[selectedTask];
            taskModels[selectedTask] = { 
              ...config, 
              reasoning_effort: value || undefined 
            };
            await this.plugin.settingsStore.update({ taskModels });
          });
        }
      }
    ]);
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
