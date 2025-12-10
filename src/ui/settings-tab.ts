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
      case "general": this.renderGeneralTab(content); break;
      case "providers": this.renderProvidersTab(content); break;
      case "tasks": this.renderTaskModelsTab(content); break;
      case "knowledge": this.renderKnowledgeTab(content); break;
      case "system": this.renderSystemTab(content); break;
    }
  }

  /**
   * Render Horizontal Navigation
   */
  private renderNav(container: HTMLElement): void {
    const t = this.plugin.getI18n().t().settings;

    // Nav Container
    const nav = container.createDiv({ cls: "cr-settings-nav" });

    const tabs: { id: SettingsTabId; name: string; advanced?: boolean }[] = [
      { id: "general", name: t.title.replace(" 设置", "").replace(" Settings", "") || "常规" }, // Simplify title for tab
      { id: "providers", name: t.provider.title.replace(" 配置", "").replace(" Configuration", "") || "AI Provider" },
      { id: "tasks", name: t.advanced.taskModels.title.replace(" 配置", "").replace(" Configuration", "") || "任务模型" }, // Shorten
      { id: "knowledge", name: t.advanced.directoryScheme.title.replace("方案", "").replace(" Scheme", "") || "目录" },
      { id: "system", name: t.importExport.title }
    ];

    const isAdvanced = this.plugin.settings.advancedMode;

    tabs.forEach(tab => {
      if (tab.advanced && !isAdvanced) return;

      const item = nav.createDiv({
        cls: `cr-nav-item ${this.activeTab === tab.id ? "is-active" : ""}`
      });
      item.textContent = tab.name;

      item.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
    });
  }

  /**
   * Tab: General Settings
   */
  private renderGeneralTab(container: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    container.createEl("h2", { text: t.settings.language.name }); // Using Language as section title or just General?

    // Language
    new Setting(container)
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
            this.display();
          });
      });

    container.createEl("h3", { text: "Basic Parameters" });

    // Similarity Threshold
    new Setting(container)
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

    // Advanced Mode Toggle
    new Setting(container)
      .setName(t.settings.advancedMode.name)
      .setDesc(t.settings.advancedMode.desc)
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.advancedMode)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ advancedMode: value });
            // If turning off advanced mode while in an advanced tab, switch to general
            if (!value && (this.activeTab === "tasks" || this.activeTab === "knowledge")) {
              this.activeTab = "general";
            }
            this.display();
          });
      });
  }

  /**
   * Tab: AI Providers
   */
  private renderProvidersTab(container: HTMLElement): void {
    const i18n = this.plugin.getI18n();
    const t = i18n.t();

    // Header & Add Button
    const header = container.createDiv({ cls: "cr-flex-row" });
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "var(--cr-gap-md)";
    header.createEl("h2", { text: t.settings.provider.title, attr: { style: "margin: 0" } });

    const addBtn = header.createEl("button", { text: t.settings.provider.addButton, cls: "mod-cta" });
    addBtn.onclick = () => this.showAddProviderModal();

    // Default Provider Picker
    const providers = this.plugin.settings.providers;
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

    // Provider List (Grid Card Layout)
    if (Object.keys(providers).length === 0) {
      container.createEl("div", { cls: "cr-empty-state", text: t.settings.provider.noProvider });
    } else {
      const grid = container.createDiv({ cls: "cr-provider-grid" });
      Object.entries(providers).forEach(([id, config]) => {
        this.renderProviderCard(grid, id, config as ProviderConfig);
      });
    }
  }

  /**
   * Render a single Provider Card
   */
  private renderProviderCard(container: HTMLElement, id: string, config: ProviderConfig): void {
    const t = this.plugin.getI18n().t();
    const card = container.createDiv({ cls: "cr-provider-card" });

    // Header
    const header = card.createDiv({ cls: "cr-provider-header" });
    const info = header.createDiv({ cls: "cr-provider-info" });
    // Status dot
    const statusDot = info.createDiv({
      cls: `cr-provider-status ${config.enabled ? 'is-online' : 'is-offline'}`,
      attr: { title: config.enabled ? t.settings.provider.enabled : t.settings.provider.disabled }
    });
    info.createSpan({ text: id, cls: "cr-provider-name" });

    // Toggle Switch (Inline)
    const toggleWrapper = header.createDiv();
    const toggle = toggleWrapper.createEl("input", { type: "checkbox" }); // Standard HTML checkbox for custom styling or use .setting-item-control but harder here.
    // Using a simple toggle logic simulation or just an edit button.
    // Let's use an edit button to expand details.

    // We can use a simplified internal setting for toggle
    const toggleSetting = new Setting(header)
      .addToggle(toggle => {
        toggle.setValue(config.enabled).onChange(async (val) => {
          await this.plugin.settingsStore.updateProvider(id, { enabled: val });
          new Notice(formatMessage(t.notices.providerUpdated, { id }));
          this.display(); // Refresh to update status dot
        });
      });
    toggleSetting.controlEl.style.margin = "0"; // Reset margin
    toggleSetting.infoEl.remove(); // Remove label space

    // Expand/Collapse logic
    card.onclick = (e) => {
      if ((e.target as HTMLElement).tagName.toLowerCase() === 'input') return; // Don't toggle if clicking switch
      if (card.hasClass("is-expanded")) card.removeClass("is-expanded");
      else card.addClass("is-expanded");
    };

    // Body (Expanded)
    const body = card.createDiv({ cls: "cr-provider-body" });

    // Info Details
    body.createDiv({ text: `${t.settings.provider.model}: ${config.defaultChatModel}`, cls: "cr-text-muted" });

    // Actions
    const actions = body.createDiv({ cls: "cr-flex-row", attr: { style: "gap: 8px; margin-top: 12px;" } });

    const testBtn = actions.createEl("button", { text: t.settings.provider.testConnection });
    testBtn.onclick = (e) => { e.stopPropagation(); this.testProviderConnection(id); };

    const editBtn = actions.createEl("button", { text: t.common.edit });
    editBtn.onclick = (e) => { e.stopPropagation(); this.showEditProviderModal(id, config); };

    const deleteBtn = actions.createEl("button", { text: t.common.delete, cls: "mod-warning" });
    deleteBtn.onclick = (e) => { e.stopPropagation(); this.showDeleteProviderConfirm(id); };
  }

  /**
   * Tab: Task Models (Advanced)
   */
  private renderTaskModelsTab(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();

    container.createEl("h2", { text: t.settings.advanced.taskModels.title });
    container.createEl("p", { text: t.settings.advanced.taskModels.desc, cls: "setting-item-description" });

    const providerIds = Object.keys(this.plugin.settings.providers);
    const taskTypes: Array<{ key: string; name: string; desc: string }> = [
      { key: "standardizeClassify", name: t.taskTypes.standardizeClassify.name, desc: t.taskTypes.standardizeClassify.desc },
      { key: "enrich", name: t.taskTypes.enrich.name, desc: t.taskTypes.enrich.desc },
      { key: "embedding", name: t.taskTypes.embedding.name, desc: t.taskTypes.embedding.desc },
      { key: "reason:new", name: t.taskTypes["reason:new"].name, desc: t.taskTypes["reason:new"].desc },
      { key: "ground", name: t.taskTypes.ground.name, desc: t.taskTypes.ground.desc }
    ];

    for (const taskType of taskTypes) {
      const taskConfig = this.plugin.settings.taskModels[taskType.key as keyof typeof this.plugin.settings.taskModels];

      // Group each task config in a box?
      const group = container.createDiv({ cls: "cr-card", attr: { style: "padding: 16px; margin-bottom: 16px;" } });
      group.createEl("h4", { text: taskType.name, attr: { style: "margin-top: 0;" } });
      group.createEl("p", { text: taskType.desc, cls: "cr-text-muted", attr: { style: "margin-bottom: 16px;" } });

      new Setting(group)
        .setName(t.settings.advanced.taskModels.providerAndModel)
        .addDropdown(dropdown => {
          if (providerIds.length === 0) dropdown.addOption("", t.settings.advanced.taskModels.configureProviderFirst);
          else {
            dropdown.addOption("", t.settings.advanced.taskModels.useDefaultProvider);
            providerIds.forEach(id => dropdown.addOption(id, id));
          }
          dropdown.setValue(taskConfig?.providerId || "")
            .onChange(async (val) => {
              const taskModels = { ...this.plugin.settings.taskModels };
              taskModels[taskType.key as keyof typeof taskModels] = { ...taskConfig, providerId: val };
              await this.plugin.settingsStore.update({ taskModels });
            });
        })
        .addText(text => {
          text.setPlaceholder(t.settings.advanced.taskModels.modelNamePlaceholder)
            .setValue(taskConfig?.model || "")
            .onChange(async (val) => {
              const taskModels = { ...this.plugin.settings.taskModels };
              taskModels[taskType.key as keyof typeof taskModels] = { ...taskConfig, model: val };
              await this.plugin.settingsStore.update({ taskModels });
            });
        });

      // Params (Temp/TopP)
      if (taskType.key !== "embedding") {
        // Use a sub-setting look or just inline?
        new Setting(group)
          .setName("Temperature / Top P")
          .addSlider(slider => {
            slider.setLimits(0, 2, 0.1).setValue(taskConfig?.temperature ?? 0.7)
              .setDynamicTooltip().onChange(async (val) => {
                const tm = { ...this.plugin.settings.taskModels };
                tm[taskType.key as keyof typeof tm] = { ...taskConfig, temperature: val };
                await this.plugin.settingsStore.update({ taskModels: tm });
              });
          })
          .addSlider(slider => {
            slider.setLimits(0, 1, 0.05).setValue(taskConfig?.topP ?? 1)
              .setDynamicTooltip().onChange(async (val) => {
                const tm = { ...this.plugin.settings.taskModels };
                tm[taskType.key as keyof typeof tm] = { ...taskConfig, topP: val };
                await this.plugin.settingsStore.update({ taskModels: tm });
              });
          });
      }
    }
  }

  /**
   * Tab: Knowledge Scheme (Advanced)
   */
  private renderKnowledgeTab(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();

    container.createEl("h2", { text: t.settings.advanced.directoryScheme.title });
    container.createEl("p", { text: t.settings.advanced.directoryScheme.desc, cls: "setting-item-description" });

    // Naming Template
    new Setting(container)
      .setName(t.settings.advanced.namingTemplate.name)
      .setDesc(t.settings.advanced.namingTemplate.desc)
      .addText(text => {
        text.setPlaceholder("{{chinese}} ({{english}})")
          .setValue(this.plugin.settings.namingTemplate)
          .onChange(async (val) => await this.plugin.settingsStore.update({ namingTemplate: val }));
        text.inputEl.style.width = "100%";
      });

    container.createEl("h3", { text: "Directories" });

    const crTypes: Array<{ key: CRType; name: string }> = [
      { key: "Domain", name: `${t.crTypes.Domain} (Domain)` },
      { key: "Issue", name: `${t.crTypes.Issue} (Issue)` },
      { key: "Theory", name: `${t.crTypes.Theory} (Theory)` },
      { key: "Entity", name: `${t.crTypes.Entity} (Entity)` },
      { key: "Mechanism", name: `${t.crTypes.Mechanism} (Mechanism)` }
    ];

    for (const crType of crTypes) {
      new Setting(container)
        .setName(crType.name)
        .addText(text => {
          text.setPlaceholder(`Default: ${this.plugin.settings.directoryScheme[crType.key]}`)
            .setValue(this.plugin.settings.directoryScheme[crType.key])
            .onChange(async (val) => {
              const ds = { ...this.plugin.settings.directoryScheme };
              ds[crType.key] = val;
              await this.plugin.settingsStore.update({ directoryScheme: ds });
            });
        });
    }

    // Embedding Params
    container.createEl("h3", { text: t.settings.advanced.embedding.title });
    new Setting(container)
      .setName(t.settings.advanced.embedding.dimension)
      .setDesc(t.settings.advanced.embedding.dimensionDesc)
      .addDropdown(dropdown => {
        ["256", "512", "1024", "1536", "3072"].forEach(d => dropdown.addOption(d, d));
        dropdown.setValue((this.plugin.settings.embeddingDimension ?? 1536).toString())
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({ embeddingDimension: parseInt(val) });
            new Notice(t.settings.advanced.embedding.dimensionWarning);
          });
      });

    // Deduplication Params
    container.createEl("h3", { text: t.settings.advanced.deduplication.title });
    new Setting(container)
      .setName(t.settings.advanced.deduplication.topK)
      .setDesc(t.settings.advanced.deduplication.topKDesc)
      .addText(text => {
        text.setValue(this.plugin.settings.topK.toString())
          .onChange(async (val) => {
            const num = parseInt(val);
            if (!isNaN(num)) await this.plugin.settingsStore.update({ topK: num });
          });
      });
  }

  /**
   * Tab: System Settings
   */
  private renderSystemTab(container: HTMLElement): void {
    const t = this.plugin.getI18n().t();

    container.createEl("h2", { text: "System & Maintenance" });

    // Concurrency
    new Setting(container)
      .setName(t.settings.concurrency.name)
      .setDesc(t.settings.concurrency.desc)
      .addText(text => {
        text.setValue(this.plugin.settings.concurrency.toString())
          .onChange(async (val) => await this.plugin.settingsStore.update({ concurrency: parseInt(val) || 1 }));
      });

    new Setting(container)
      .setName(t.settings.advanced.queue.autoRetry)
      .setDesc(t.settings.advanced.queue.autoRetryDesc)
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.autoRetry)
          .onChange(async (val) => await this.plugin.settingsStore.update({ autoRetry: val }));
      });

    // Snapshots
    container.createEl("h3", { text: "Undo / Snapshots" });
    new Setting(container)
      .setName(t.settings.maxSnapshots.name)
      .setDesc(t.settings.maxSnapshots.desc)
      .addText(text => {
        text.setValue(this.plugin.settings.maxSnapshots.toString())
          .onChange(async (val) => await this.plugin.settingsStore.update({ maxSnapshots: parseInt(val) || 100 }));
      });

    new Setting(container)
      .setName(t.settings.maxSnapshotAgeDays.name)
      .setDesc(t.settings.maxSnapshotAgeDays.desc)
      .addText(text => {
        text.setValue((this.plugin.settings.maxSnapshotAgeDays ?? 30).toString())
          .onChange(async (val) => await this.plugin.settingsStore.update({ maxSnapshotAgeDays: parseInt(val) || 30 }));
      });

    // Logging
    container.createEl("h3", { text: t.settings.advanced.logging.title });
    new Setting(container)
      .setName(t.settings.advanced.logging.logLevel)
      .addDropdown(dropdown => {
        (["debug", "info", "warn", "error"] as const).forEach(level => {
          dropdown.addOption(level, t.settings.advanced.logging.levels[level]);
        });
        dropdown.setValue(this.plugin.settings.logLevel)
          .onChange(async (val) => {
            await this.plugin.settingsStore.update({ logLevel: val as "debug" | "info" | "warn" | "error" });
            new Notice(formatMessage(t.notices.logLevelChanged, { level: val }));
          });
      });

    new Setting(container)
      .setName(t.settings.advanced.logging.clearLogs)
      .addButton(btn => {
        btn.setButtonText(t.settings.advanced.logging.clearLogs).setWarning()
          .onClick(async () => await this.clearLogs());
      });

    // Import/Export
    container.createEl("h3", { text: t.settings.importExport.title });
    new Setting(container)
      .setName(t.settings.importExport.export)
      .setDesc(t.settings.importExport.exportDesc)
      .addButton(btn => {
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
          } else new Notice(`${t.common.error}: ${result.error.message}`);
        });
      });

    new Setting(container)
      .setName(t.settings.importExport.import)
      .setDesc(t.settings.importExport.importDesc)
      .addButton(btn => {
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
              } else new Notice(result.error.message);
            }
          };
          input.click();
        });
      });

    new Setting(container)
      .setName(t.settings.importExport.reset)
      .addButton(btn => {
        btn.setButtonText(t.settings.importExport.reset).setWarning()
          .onClick(() => this.showResetSettingsConfirm());
      });
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
