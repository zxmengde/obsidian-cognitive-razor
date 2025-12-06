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
import { ProviderConfigModal, ConfirmModal } from "./modals";

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
      .setDesc("配置 AI 服务提供商（支持 OpenAI 标准格式，可通过自定义端点兼容其他服务）")
      .addButton(button => {
        button
          .setButtonText("添加 Provider")
          .onClick(() => {
            this.showAddProviderModal("openai");
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
      .setDesc(`模型: ${config.defaultChatModel} | 状态: ${config.enabled ? "启用" : "禁用"}`);

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

    // 测试连接按钮
    setting.addButton(button => {
      button
        .setButtonText("测试连接")
        .onClick(async () => {
          await this.testProviderConnection(id);
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

    // 设为默认按钮
    setting.addButton(button => {
      button
        .setButtonText("设为默认")
        .onClick(async () => {
          await this.setDefaultProvider(id);
        });
    });

    // 删除按钮
    setting.addButton(button => {
      button
        .setButtonText("删除")
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
          .onChange(async (value: string) => {
            const logLevel = value as "debug" | "info" | "warn" | "error";
            await this.plugin.settingsStore.update({ logLevel });
            new Notice(`日志级别已设置为: ${logLevel}（将在下次启动时生效）`);
          });
      });

    // 清除日志按钮
    new Setting(containerEl)
      .setName("清除日志")
      .setDesc("清空所有日志文件")
      .addButton(button => {
        button
          .setButtonText("清除日志")
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
          .onClick(() => {
            this.showResetSettingsConfirm();
          });
      });
  }

  /**
   * 显示添加 Provider 模态框
   */
  private showAddProviderModal(type: ProviderType): void {
    new ProviderConfigModal(this.app, {
      mode: "add",
      providerType: type,
      onSave: async (id, config) => {
        const result = await this.plugin.settingsStore.addProvider(id, config);
        if (result.ok) {
          new Notice(`Provider ${id} 已添加`);
          this.display();
        } else {
          new Notice(`添加失败: ${result.error.message}`);
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
    new ProviderConfigModal(this.app, {
      mode: "edit",
      providerId: id,
      currentConfig: config,
      onSave: async (providerId, newConfig) => {
        const result = await this.plugin.settingsStore.updateProvider(providerId, newConfig);
        if (result.ok) {
          new Notice(`Provider ${providerId} 已更新`);
          this.display();
        } else {
          new Notice(`更新失败: ${result.error.message}`);
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
    new ConfirmModal(this.app, {
      title: "删除 Provider",
      message: `确定要删除 Provider "${id}" 吗？此操作不可撤销。`,
      confirmText: "删除",
      cancelText: "取消",
      danger: true,
      onConfirm: async () => {
        await this.plugin.settingsStore.removeProvider(id);
        new Notice(`Provider ${id} 已删除`);
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
    new ConfirmModal(this.app, {
      title: "重置设置",
      message: "确定要重置所有设置吗？此操作不可撤销。",
      confirmText: "重置",
      cancelText: "取消",
      danger: true,
      onConfirm: async () => {
        await this.plugin.settingsStore.reset();
        new Notice("配置已重置");
        this.display();
      },
      onCancel: () => {
        // 用户取消，不做任何操作
      }
    }).open();
  }

  /**
   * 测试 Provider 连接
   */
  private async testProviderConnection(id: string): Promise<void> {
    new Notice(`正在测试 Provider ${id} 的连接...`);
    
    try {
      const result = await this.plugin.getComponents().providerManager.checkAvailability(id);
      
      if (result.ok) {
        const capabilities = result.value;
        new Notice(
          `连接成功！\n` +
          `聊天: ${capabilities.chat ? "✓" : "✗"}\n` +
          `嵌入: ${capabilities.embedding ? "✓" : "✗"}\n` +
          `可用模型: ${capabilities.models.length} 个`,
          5000
        );
      } else {
        new Notice(`连接失败: ${result.error.message}`, 5000);
      }
    } catch (error) {
      new Notice(`连接测试出错: ${error instanceof Error ? error.message : String(error)}`, 5000);
    }
  }

  /**
   * 设置默认 Provider
   */
  private async setDefaultProvider(id: string): Promise<void> {
    await this.plugin.settingsStore.setDefaultProvider(id);
    new Notice(`默认 Provider 已设置为: ${id}`);
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
