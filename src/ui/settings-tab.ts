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
import type { ProviderType, ProviderConfig } from "../types";

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

    // 标题
    containerEl.createEl("h1", { text: "Cognitive Razor 设置" });

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
   * 渲染 Provider 设置
   */
  private renderProviderSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "AI Provider 配置" });

    // 添加 Provider 按钮
    new Setting(containerEl)
      .setName("添加 Provider")
      .setDesc("配置 AI 服务提供商")
      .addButton(button => {
        button
          .setButtonText("添加 Google Gemini")
          .onClick(() => {
            this.showAddProviderModal("google");
          });
      })
      .addButton(button => {
        button
          .setButtonText("添加 OpenAI")
          .onClick(() => {
            this.showAddProviderModal("openai");
          });
      })
      .addButton(button => {
        button
          .setButtonText("添加 OpenRouter")
          .onClick(() => {
            this.showAddProviderModal("openrouter");
          });
      });

    // 显示已配置的 Providers
    const providers = this.plugin.settings.providers;
    if (Object.keys(providers).length === 0) {
      containerEl.createEl("p", {
        text: "尚未配置任何 Provider。请添加至少一个 Provider 以使用插件功能。",
        cls: "setting-item-description"
      });
    } else {
      Object.entries(providers).forEach(([id, config]) => {
        this.renderProviderItem(containerEl, id, config);
      });
    }

    // 默认 Provider 选择
    if (Object.keys(providers).length > 0) {
      new Setting(containerEl)
        .setName("默认 Provider")
        .setDesc("选择默认使用的 AI Provider")
        .addDropdown(dropdown => {
          Object.keys(providers).forEach(id => {
            dropdown.addOption(id, id);
          });
          dropdown
            .setValue(this.plugin.settings.defaultProviderId)
            .onChange(async (value) => {
              await this.plugin.settingsStore.setDefaultProvider(value);
              new Notice(`默认 Provider 已设置为: ${value}`);
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
    const setting = new Setting(containerEl)
      .setName(id)
      .setDesc(`类型: ${config.type} | 状态: ${config.enabled ? "启用" : "禁用"}`);

    // 启用/禁用切换
    setting.addToggle(toggle => {
      toggle
        .setValue(config.enabled)
        .onChange(async (value) => {
          await this.plugin.settingsStore.updateProvider(id, { enabled: value });
          new Notice(`Provider ${id} 已${value ? "启用" : "禁用"}`);
          this.display();
        });
    });

    // 编辑按钮
    setting.addButton(button => {
      button
        .setButtonText("编辑")
        .onClick(() => {
          this.showEditProviderModal(id, config);
        });
    });

    // 删除按钮
    setting.addButton(button => {
      button
        .setButtonText("删除")
        .setWarning()
        .onClick(async () => {
          const confirmed = confirm(`确定要删除 Provider "${id}" 吗？`);
          if (confirmed) {
            await this.plugin.settingsStore.removeProvider(id);
            new Notice(`Provider ${id} 已删除`);
            this.display();
          }
        });
    });
  }

  /**
   * 渲染插件设置
   */
  private renderPluginSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "插件设置" });

    // 相似度阈值
    new Setting(containerEl)
      .setName("相似度阈值")
      .setDesc("用于检测重复概念的相似度阈值 (0-1)")
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
      .setName("最大快照数量")
      .setDesc("用于撤销操作的最大快照数量")
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

    // 并发任务数
    new Setting(containerEl)
      .setName("并发任务数")
      .setDesc("同时执行的最大任务数")
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
      .setName("高级模式")
      .setDesc("显示高级配置选项")
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
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "高级设置" });

    // 日志级别
    new Setting(containerEl)
      .setName("日志级别")
      .setDesc("设置日志记录的详细程度")
      .addDropdown(dropdown => {
        dropdown
          .addOption("debug", "调试")
          .addOption("info", "信息")
          .addOption("warn", "警告")
          .addOption("error", "错误")
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (value: any) => {
            await this.plugin.settingsStore.update({ logLevel: value });
            new Notice(`日志级别已设置为: ${value}（将在下次启动时生效）`);
          });
      });
  }

  /**
   * 渲染导入导出
   */
  private renderImportExport(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "导入导出" });

    // 导出配置
    new Setting(containerEl)
      .setName("导出配置")
      .setDesc("导出当前配置为 JSON 文件")
      .addButton(button => {
        button
          .setButtonText("导出")
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
              new Notice("配置已导出");
            } else {
              new Notice(`导出失败: ${result.error.message}`);
            }
          });
      });

    // 导入配置
    new Setting(containerEl)
      .setName("导入配置")
      .setDesc("从 JSON 文件导入配置")
      .addButton(button => {
        button
          .setButtonText("导入")
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
                  new Notice("配置已导入");
                  this.display();
                } else {
                  new Notice(`导入失败: ${result.error.message}`);
                }
              }
            };
            input.click();
          });
      });

    // 重置配置
    new Setting(containerEl)
      .setName("重置配置")
      .setDesc("将所有设置重置为默认值")
      .addButton(button => {
        button
          .setButtonText("重置")
          .setWarning()
          .onClick(async () => {
            const confirmed = confirm("确定要重置所有设置吗？此操作不可撤销。");
            if (confirmed) {
              await this.plugin.settingsStore.reset();
              new Notice("配置已重置");
              this.display();
            }
          });
      });
  }

  /**
   * 显示添加 Provider 模态框
   */
  private showAddProviderModal(type: ProviderType): void {
    // TODO: 实现添加 Provider 的模态框
    // 这里暂时使用简单的 prompt
    const id = prompt(`请输入 Provider ID (例如: my-${type}):`);
    if (!id) return;

    const apiKey = prompt("请输入 API Key:");
    if (!apiKey) return;

    const defaultModels = this.getDefaultModels(type);

    const config: ProviderConfig = {
      type,
      apiKey,
      defaultChatModel: defaultModels.chat,
      defaultEmbedModel: defaultModels.embed,
      enabled: true,
    };

    this.plugin.settingsStore.addProvider(id, config).then(result => {
      if (result.ok) {
        new Notice(`Provider ${id} 已添加`);
        this.display();
      } else {
        new Notice(`添加失败: ${result.error.message}`);
      }
    });
  }

  /**
   * 显示编辑 Provider 模态框
   */
  private showEditProviderModal(id: string, config: ProviderConfig): void {
    // TODO: 实现编辑 Provider 的模态框
    // 这里暂时使用简单的 prompt
    const apiKey = prompt("请输入新的 API Key (留空保持不变):");
    if (apiKey) {
      this.plugin.settingsStore.updateProvider(id, { apiKey }).then(result => {
        if (result.ok) {
          new Notice(`Provider ${id} 已更新`);
          this.display();
        } else {
          new Notice(`更新失败: ${result.error.message}`);
        }
      });
    }
  }

  /**
   * 获取默认模型
   */
  private getDefaultModels(type: ProviderType): { chat: string; embed: string } {
    switch (type) {
      case "google":
        return {
          chat: "gemini-1.5-flash",
          embed: "text-embedding-004"
        };
      case "openai":
        return {
          chat: "gpt-4-turbo-preview",
          embed: "text-embedding-3-small"
        };
      case "openrouter":
        return {
          chat: "anthropic/claude-3-sonnet",
          embed: "" // OpenRouter 不支持嵌入
        };
      default:
        return { chat: "", embed: "" };
    }
  }
}
