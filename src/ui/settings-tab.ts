/**
 * CognitiveRazorSettingTab - 插件设置面板
 * 
 * 功能：
 * - Provider 配置
 * - 插件参数设置
 * - 导入导出配置
 */

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type CognitiveRazorPlugin from "../../main";
import type { ProviderConfig, CRType, DirectoryScheme } from "../types";
import { ProviderConfigModal, ConfirmModal } from "./modals";
import { formatMessage } from "../core/i18n";

/**
 * 设置面板
 */
export class CognitiveRazorSettingTab extends PluginSettingTab {
  plugin: CognitiveRazorPlugin;

  constructor(app: App, plugin: CognitiveRazorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    // 标题
    containerEl.createEl("h1", { text: t.settings.title });

    // 基础设置（语言选择）
    this.renderBasicSettings(containerEl);

    // Provider 配置区域
    this.renderProviderSettings(containerEl);

    // 插件参数设置
    this.renderPluginSettings(containerEl);

    // 高级设置
    if (this.plugin.settings.advancedMode) {
      this.renderAdvancedSettings(containerEl);
    }

    // 导入导出
    this.renderImportExport(containerEl);
  }

  /**
   * 渲染基础设置
   */
  private renderBasicSettings(containerEl: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    containerEl.createEl("h2", { text: t.settings.language.name });

    // 语言选择
    new Setting(containerEl)
      .setName(t.settings.language.name)
      .setDesc(t.settings.language.desc)
      .addDropdown(dropdown => {
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
            // 刷新设置面板以应用新语言
            this.display();
          });
      });
  }

  /**
   * 渲染 Provider 设置
   */
  private renderProviderSettings(containerEl: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    containerEl.createEl("h2", { text: t.settings.provider.title });

    // 添加 Provider 按钮
    new Setting(containerEl)
      .setName(t.settings.provider.addButton)
      .setDesc(t.settings.provider.addDesc)
      .addButton(button => {
        button
          .setButtonText(t.settings.provider.addButton)
          .onClick(() => {
            this.showAddProviderModal();
          });
      });

    // 显示已配置的 Providers
    const providers = this.plugin.settings.providers;
    if (Object.keys(providers).length === 0) {
      containerEl.createEl("p", {
        text: t.settings.provider.noProvider,
        cls: "setting-item-description"
      });
    } else {
      Object.entries(providers).forEach(([id, config]) => {
        this.renderProviderItem(containerEl, id, config as ProviderConfig);
      });
    }

    // 默认 Provider 选择
    if (Object.keys(providers).length > 0) {
      new Setting(containerEl)
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
  }

  /**
   * 渲染单个 Provider 项
   */
  private renderProviderItem(
    containerEl: HTMLElement,
    id: string,
    config: ProviderConfig
  ): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    const statusText = config.enabled ? t.settings.provider.enabled : t.settings.provider.disabled;
    const setting = new Setting(containerEl)
      .setName(id)
      .setDesc(`${t.settings.provider.model}: ${config.defaultChatModel} | ${t.settings.provider.status}: ${statusText}`);

    // 启用/禁用切换
    setting.addToggle(toggle => {
      toggle
        .setValue(config.enabled)
        .onChange(async (value) => {
          await this.plugin.settingsStore.updateProvider(id, { enabled: value });
          new Notice(formatMessage(t.notices.providerUpdated, { id }));
          this.display();
        });
    });

    // 测试连接按钮
    setting.addButton(button => {
      button
        .setButtonText(t.settings.provider.testConnection)
        .onClick(async () => {
          await this.testProviderConnection(id);
        });
    });

    // 编辑按钮
    setting.addButton(button => {
      button
        .setButtonText(t.common.edit)
        .onClick(() => {
          this.showEditProviderModal(id, config);
        });
    });

    // 设为默认按钮
    setting.addButton(button => {
      button
        .setButtonText(t.settings.provider.setDefault)
        .onClick(async () => {
          await this.setDefaultProvider(id);
        });
    });

    // 删除按钮
    setting.addButton(button => {
      button
        .setButtonText(t.common.delete)
        .setWarning()
        .onClick(() => {
          this.showDeleteProviderConfirm(id);
        });
    });
  }

  /**
   * 渲染插件设置
   */
  private renderPluginSettings(containerEl: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    containerEl.createEl("h2", { text: t.settings.title });

    // 相似度阈值
    new Setting(containerEl)
      .setName(t.settings.similarityThreshold.name)
      .setDesc(t.settings.similarityThreshold.desc)
      .addSlider(slider => {
        slider
          .setLimits(0.5, 1.0, 0.05)
          .setValue(this.plugin.settings.similarityThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ similarityThreshold: value });
          });
      });

    // 最大快照数量
    new Setting(containerEl)
      .setName(t.settings.maxSnapshots.name)
      .setDesc(t.settings.maxSnapshots.desc)
      .addText(text => {
        text
          .setPlaceholder("100")
          .setValue(this.plugin.settings.maxSnapshots.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              await this.plugin.settingsStore.update({ maxSnapshots: num });
            }
          });
      });

    // 快照保留天数 (A-FUNC-02: 可配置的快照保留策略)
    new Setting(containerEl)
      .setName(t.settings.maxSnapshotAgeDays.name)
      .setDesc(t.settings.maxSnapshotAgeDays.desc)
      .addText(text => {
        text
          .setPlaceholder("30")
          .setValue((this.plugin.settings.maxSnapshotAgeDays ?? 30).toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              await this.plugin.settingsStore.update({ maxSnapshotAgeDays: num });
            }
          });
      });

    // 并发任务数
    new Setting(containerEl)
      .setName(t.settings.concurrency.name)
      .setDesc(t.settings.concurrency.desc)
      .addText(text => {
        text
          .setPlaceholder("3")
          .setValue(this.plugin.settings.concurrency.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0 && num <= 10) {
              await this.plugin.settingsStore.update({ concurrency: num });
            }
          });
      });

    // 高级模式
    new Setting(containerEl)
      .setName(t.settings.advancedMode.name)
      .setDesc(t.settings.advancedMode.desc)
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.advancedMode)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ advancedMode: value });
            this.display();
          });
      });
  }

  /**
   * 渲染高级设置
   * 
   * 遵循设计文档 A-FUNC-08：高级模式显示模型、温度/TopP、去重阈值、并发等参数
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();
    
    containerEl.createEl("h2", { text: t.settings.advanced.title });

    // ============ 命名和目录配置 ============
    containerEl.createEl("h3", { text: t.settings.advanced.namingTemplate.name });

    // 命名模板
    new Setting(containerEl)
      .setName(t.settings.advanced.namingTemplate.name)
      .setDesc(t.settings.advanced.namingTemplate.desc)
      .addText(text => {
        text
          .setPlaceholder("{{chinese}} ({{english}})")
          .setValue(this.plugin.settings.namingTemplate)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ namingTemplate: value });
          });
        text.inputEl.style.width = "100%";
      });

    // 目录方案配置
    containerEl.createEl("h4", { text: t.settings.advanced.directoryScheme.title });
    containerEl.createEl("p", {
      text: t.settings.advanced.directoryScheme.desc,
      cls: "setting-item-description"
    });

    const crTypes: Array<{ key: CRType; name: string }> = [
      { key: "Domain", name: `${t.crTypes.Domain} (Domain)` },
      { key: "Issue", name: `${t.crTypes.Issue} (Issue)` },
      { key: "Theory", name: `${t.crTypes.Theory} (Theory)` },
      { key: "Entity", name: `${t.crTypes.Entity} (Entity)` },
      { key: "Mechanism", name: `${t.crTypes.Mechanism} (Mechanism)` }
    ];

    const plugin = this.plugin;
    for (const crType of crTypes) {
      new Setting(containerEl)
        .setName(crType.name)
        .addText(text => {
          text
            .setPlaceholder(`默认: ${plugin.settings.directoryScheme[crType.key]}`)
            .setValue(plugin.settings.directoryScheme[crType.key])
            .onChange(async (value) => {
              const directoryScheme = { ...plugin.settings.directoryScheme };
              directoryScheme[crType.key] = value;
              await plugin.settingsStore.update({ directoryScheme });
            });
          text.inputEl.style.width = "100%";
        });
    }

    // ============ 任务模型配置 ============
    containerEl.createEl("h3", { text: t.settings.advanced.taskModels.title });
    containerEl.createEl("p", {
      text: t.settings.advanced.taskModels.desc,
      cls: "setting-item-description"
    });

    // 获取可用的 Provider 列表
    const providerIds = Object.keys(this.plugin.settings.providers);

    // 为每种任务类型创建配置
    const taskTypes: Array<{ key: string; name: string; desc: string }> = [
      { key: "standardizeClassify", name: t.taskTypes.standardizeClassify.name, desc: t.taskTypes.standardizeClassify.desc },
      { key: "enrich", name: t.taskTypes.enrich.name, desc: t.taskTypes.enrich.desc },
      { key: "embedding", name: t.taskTypes.embedding.name, desc: t.taskTypes.embedding.desc },
      { key: "reason:new", name: t.taskTypes["reason:new"].name, desc: t.taskTypes["reason:new"].desc },
      { key: "reason:incremental", name: t.taskTypes["reason:incremental"].name, desc: t.taskTypes["reason:incremental"].desc },
      { key: "reason:merge", name: t.taskTypes["reason:merge"].name, desc: t.taskTypes["reason:merge"].desc },
      { key: "ground", name: t.taskTypes.ground.name, desc: t.taskTypes.ground.desc }
    ];

    for (const taskType of taskTypes) {
      const taskConfig = this.plugin.settings.taskModels[taskType.key as keyof typeof this.plugin.settings.taskModels];
      
      // 任务类型标题
      containerEl.createEl("h4", { text: taskType.name });
      containerEl.createEl("p", {
        text: taskType.desc,
        cls: "setting-item-description"
      });
      
      // Provider 和模型选择
      new Setting(containerEl)
        .setName(t.settings.advanced.taskModels.providerAndModel)
        .addDropdown(dropdown => {
          // Provider 选择
          if (providerIds.length === 0) {
            dropdown.addOption("", t.settings.advanced.taskModels.configureProviderFirst);
          } else {
            dropdown.addOption("", t.settings.advanced.taskModels.useDefaultProvider);
            providerIds.forEach(id => dropdown.addOption(id, id));
          }
          dropdown
            .setValue(taskConfig?.providerId || "")
            .onChange(async (value) => {
              const taskModels = { ...this.plugin.settings.taskModels };
              taskModels[taskType.key as keyof typeof taskModels] = {
                ...taskConfig,
                providerId: value
              };
              await this.plugin.settingsStore.update({ taskModels });
            });
        })
        .addText(text => {
          // 模型名称
          text
            .setPlaceholder(t.settings.advanced.taskModels.modelNamePlaceholder)
            .setValue(taskConfig?.model || "")
            .onChange(async (value) => {
              const taskModels = { ...this.plugin.settings.taskModels };
              taskModels[taskType.key as keyof typeof taskModels] = {
                ...taskConfig,
                model: value
              };
              await this.plugin.settingsStore.update({ taskModels });
            });
        });
      
      // Temperature 参数（仅对非 embedding 任务显示）
      if (taskType.key !== "embedding") {
        new Setting(containerEl)
          .setName(t.settings.advanced.temperature.name)
          .setDesc(t.settings.advanced.temperature.desc)
          .addSlider(slider => {
            slider
              .setLimits(0, 2, 0.1)
              .setValue(taskConfig?.temperature ?? 0.7)
              .setDynamicTooltip()
              .onChange(async (value) => {
                const taskModels = { ...this.plugin.settings.taskModels };
                taskModels[taskType.key as keyof typeof taskModels] = {
                  ...taskConfig,
                  temperature: value
                };
                await this.plugin.settingsStore.update({ taskModels });
              });
          });
      }
      
      // TopP 参数（仅对非 embedding 任务显示）
      if (taskType.key !== "embedding") {
        new Setting(containerEl)
          .setName(t.settings.advanced.topP.name)
          .setDesc(t.settings.advanced.topP.desc)
          .addSlider(slider => {
            slider
              .setLimits(0, 1, 0.05)
              .setValue(taskConfig?.topP ?? 1)
              .setDynamicTooltip()
              .onChange(async (value) => {
                const taskModels = { ...this.plugin.settings.taskModels };
                taskModels[taskType.key as keyof typeof taskModels] = {
                  ...taskConfig,
                  topP: value
                };
                await this.plugin.settingsStore.update({ taskModels });
              });
          });
      }
      
      // Reasoning Effort 参数（仅对非 embedding 任务显示）
      if (taskType.key !== "embedding") {
        new Setting(containerEl)
          .setName(t.settings.advanced.reasoningEffort.name)
          .setDesc(t.settings.advanced.reasoningEffort.desc)
          .addDropdown(dropdown => {
            dropdown
              .addOption("", t.settings.advanced.taskModels.notSet)
              .addOption("low", t.settings.advanced.taskModels.low)
              .addOption("medium", t.settings.advanced.taskModels.medium)
              .addOption("high", t.settings.advanced.taskModels.high)
              .setValue(taskConfig?.reasoning_effort || "")
              .onChange(async (value) => {
                const taskModels = { ...this.plugin.settings.taskModels };
                taskModels[taskType.key as keyof typeof taskModels] = {
                  ...taskConfig,
                  reasoning_effort: value ? (value as "low" | "medium" | "high") : undefined
                };
                await this.plugin.settingsStore.update({ taskModels });
              });
          });
      }
    }

    // ============ 温度参数 ============
    containerEl.createEl("h3", { text: "生成参数" });

    new Setting(containerEl)
      .setName("默认温度 (Temperature)")
      .setDesc("控制生成内容的随机性 (0-1)，较低值更确定，较高值更创意")
      .addSlider(slider => {
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.taskModels["reason:new"]?.temperature || 0.7)
          .setDynamicTooltip()
          .onChange(async (value) => {
            // 更新所有 reason 任务的温度
            const taskModels = { ...this.plugin.settings.taskModels };
            ["reason:new", "reason:incremental", "reason:merge"].forEach(key => {
              const k = key as keyof typeof taskModels;
              taskModels[k] = { ...taskModels[k], temperature: value };
            });
            await this.plugin.settingsStore.update({ taskModels });
          });
      });

    // ============ 去重参数 ============
    containerEl.createEl("h3", { text: t.settings.advanced.deduplication.title });

    new Setting(containerEl)
      .setName(t.settings.similarityThreshold.name)
      .setDesc(t.settings.similarityThreshold.desc)
      .addSlider(slider => {
        slider
          .setLimits(0.5, 1.0, 0.05)
          .setValue(this.plugin.settings.similarityThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ similarityThreshold: value });
          });
      });

    new Setting(containerEl)
      .setName(t.settings.advanced.deduplication.topK)
      .setDesc(t.settings.advanced.deduplication.topKDesc)
      .addText(text => {
        text
          .setPlaceholder("10")
          .setValue(this.plugin.settings.topK.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0 && num <= 100) {
              await this.plugin.settingsStore.update({ topK: num });
            }
          });
      });

    // ============ 嵌入参数 ============
    containerEl.createEl("h3", { text: t.settings.advanced.embedding.title });

    new Setting(containerEl)
      .setName(t.settings.advanced.embedding.dimension)
      .setDesc(t.settings.advanced.embedding.dimensionDesc)
      .addDropdown(dropdown => {
        // text-embedding-3-small 支持的维度选项
        dropdown
          .addOption("256", "256")
          .addOption("512", "512")
          .addOption("1024", "1024")
          .addOption("1536", "1536 (默认)")
          .addOption("3072", "3072")
          .setValue((this.plugin.settings.embeddingDimension ?? 1536).toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              await this.plugin.settingsStore.update({ embeddingDimension: num });
              new Notice(t.settings.advanced.embedding.dimensionWarning);
            }
          });
      });

    // ============ 功能开关 ============
    containerEl.createEl("h3", { text: t.settings.advanced.features.title });

    new Setting(containerEl)
      .setName(t.settings.advanced.features.enableGrounding)
      .setDesc(t.settings.advanced.features.enableGroundingDesc)
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.enableGrounding)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ enableGrounding: value });
            new Notice(`事实核查已${value ? "启用" : "禁用"}`);
          });
      });

    // ============ 队列参数 ============
    containerEl.createEl("h3", { text: t.settings.advanced.queue.title });

    new Setting(containerEl)
      .setName(t.settings.concurrency.name)
      .setDesc(t.settings.concurrency.desc)
      .addText(text => {
        text
          .setPlaceholder("1")
          .setValue(this.plugin.settings.concurrency.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0 && num <= 10) {
              await this.plugin.settingsStore.update({ concurrency: num });
            }
          });
      });

    new Setting(containerEl)
      .setName(t.settings.advanced.queue.autoRetry)
      .setDesc(t.settings.advanced.queue.autoRetryDesc)
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.autoRetry)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ autoRetry: value });
          });
      });

    new Setting(containerEl)
      .setName(t.settings.advanced.queue.maxRetryAttempts)
      .setDesc(t.settings.advanced.queue.maxRetryAttemptsDesc)
      .addText(text => {
        text
          .setPlaceholder("3")
          .setValue(this.plugin.settings.maxRetryAttempts.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 0 && num <= 10) {
              await this.plugin.settingsStore.update({ maxRetryAttempts: num });
            }
          });
      });

    // ============ 日志设置 ============
    containerEl.createEl("h3", { text: t.settings.advanced.logging.title });

    new Setting(containerEl)
      .setName(t.settings.advanced.logging.logLevel)
      .setDesc(t.settings.advanced.logging.logLevelDesc)
      .addDropdown(dropdown => {
        dropdown
          .addOption("debug", t.settings.advanced.logging.levels.debug)
          .addOption("info", t.settings.advanced.logging.levels.info)
          .addOption("warn", t.settings.advanced.logging.levels.warn)
          .addOption("error", t.settings.advanced.logging.levels.error)
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (value: string) => {
            const logLevel = value as "debug" | "info" | "warn" | "error";
            await this.plugin.settingsStore.update({ logLevel });
            new Notice(formatMessage(t.notices.logLevelChanged, { level: logLevel }));
          });
      });

    new Setting(containerEl)
      .setName(t.settings.advanced.logging.clearLogs)
      .setDesc(t.settings.advanced.logging.clearLogsDesc)
      .addButton(button => {
        button
          .setButtonText(t.settings.advanced.logging.clearLogs)
          .setWarning()
          .onClick(async () => {
            await this.clearLogs();
          });
      });
  }

  /**
   * 渲染导入导出
   */
  private renderImportExport(containerEl: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();
    
    containerEl.createEl("h2", { text: t.settings.importExport.title });

    // 导出配置
    new Setting(containerEl)
      .setName(t.settings.importExport.export)
      .setDesc(t.settings.importExport.exportDesc)
      .addButton(button => {
        button
          .setButtonText(t.settings.importExport.export)
          .onClick(async () => {
            const result = await this.plugin.settingsStore.export();
            if (result.ok) {
              // 创建下载链接
              const blob = new Blob([result.value], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "cognitive-razor-settings.json";
              a.click();
              URL.revokeObjectURL(url);
              new Notice(t.notices.settingsExported);
            } else {
              new Notice(`${t.settings.importExport.export} ${t.common.error}: ${result.error.message}`);
            }
          });
      });

    // 导入配置
    new Setting(containerEl)
      .setName(t.settings.importExport.import)
      .setDesc(t.settings.importExport.importDesc)
      .addButton(button => {
        button
          .setButtonText(t.settings.importExport.import)
          .onClick(() => {
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
                  new Notice(`${t.settings.importExport.import} ${t.common.error}: ${result.error.message}`);
                }
              }
            };
            input.click();
          });
      });

    // 重置配置
    new Setting(containerEl)
      .setName(t.settings.importExport.reset)
      .setDesc(t.settings.importExport.resetDesc)
      .addButton(button => {
        button
          .setButtonText(t.settings.importExport.reset)
          .setWarning()
          .onClick(() => {
            this.showResetSettingsConfirm();
          });
      });
  }

  /**
   * 显示添加 Provider 模态框
   */
  private showAddProviderModal(): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    new ProviderConfigModal(this.app, {
      mode: "add",
      onSave: async (id, config) => {
        const result = await this.plugin.settingsStore.addProvider(id, config);
        if (result.ok) {
          new Notice(formatMessage(t.notices.providerAdded, { id }));
          this.display();
        } else {
          new Notice(`${t.common.error}: ${result.error.message}`);
          throw new Error(result.error.message);
        }
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    }).open();
  }

  /**
   * 显示编辑 Provider 模态框
   */
  private showEditProviderModal(id: string, config: ProviderConfig): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    new ProviderConfigModal(this.app, {
      mode: "edit",
      providerId: id,
      currentConfig: config,
      onSave: async (providerId, newConfig) => {
        const result = await this.plugin.settingsStore.updateProvider(providerId, newConfig);
        if (result.ok) {
          new Notice(formatMessage(t.notices.providerUpdated, { id: providerId }));
          this.display();
        } else {
          new Notice(`${t.common.error}: ${result.error.message}`);
          throw new Error(result.error.message);
        }
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    }).open();
  }

  /**
   * 显示删除 Provider 确认对话框
   */
  private showDeleteProviderConfirm(id: string): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    new ConfirmModal(this.app, {
      title: t.confirmDialogs.deleteProvider.title,
      message: formatMessage(t.confirmDialogs.deleteProvider.message, { id }),
      confirmText: t.common.delete,
      cancelText: t.common.cancel,
      danger: true,
      onConfirm: async () => {
        await this.plugin.settingsStore.removeProvider(id);
        new Notice(formatMessage(t.notices.providerDeleted, { id }));
        this.display();
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    }).open();
  }

  /**
   * 显示重置设置确认对话框
   */
  private showResetSettingsConfirm(): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    new ConfirmModal(this.app, {
      title: t.confirmDialogs.resetSettings.title,
      message: t.confirmDialogs.resetSettings.message,
      confirmText: t.settings.importExport.reset,
      cancelText: t.common.cancel,
      danger: true,
      onConfirm: async () => {
        await this.plugin.settingsStore.reset();
        new Notice(t.notices.settingsReset);
        this.display();
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    }).open();
  }

  /**
   * 测试 Provider 连接
   * 强制刷新缓存以获取最新状态
   */
  private async testProviderConnection(id: string): Promise<void> {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    new Notice(`${t.common.loading} ${id}...`);
    
    try {
      // 清除缓存并强制刷新
      const providerManager = this.plugin.getComponents().providerManager;
      providerManager.clearAvailabilityCache(id);
      const result = await providerManager.checkAvailability(id, true);
      
      if (result.ok) {
        const capabilities = result.value;
        const message = formatMessage(t.notices.connectionSuccess, {
          chat: capabilities.chat ? "✓" : "✗",
          embedding: capabilities.embedding ? "✓" : "✗",
          models: capabilities.models.length.toString()
        });
        new Notice(message, 5000);
      } else {
        new Notice(formatMessage(t.notices.connectionFailed, { error: result.error.message }), 5000);
      }
    } catch (error) {
      new Notice(formatMessage(t.notices.connectionFailed, { 
        error: error instanceof Error ? error.message : String(error) 
      }), 5000);
    }
  }

  /**
   * 设置默认 Provider
   */
  private async setDefaultProvider(id: string): Promise<void> {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    await this.plugin.settingsStore.setDefaultProvider(id);
    new Notice(formatMessage(t.notices.providerSetDefault, { id }));
    this.display();
  }

  /**
   * 清除日志
   */
  private async clearLogs(): Promise<void> {
    try {
      // 获取日志文件路径
      const logPath = `${this.plugin.manifest.dir}/logs`;
      
      // 检查日志目录是否存在
      const adapter = this.app.vault.adapter;
      const exists = await adapter.exists(logPath);
      
      if (exists) {
        // 删除日志目录
        await adapter.rmdir(logPath, true);
        new Notice("日志已清除");
      } else {
        new Notice("没有日志文件需要清除");
      }
    } catch (error) {
      new Notice(`清除日志失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}
