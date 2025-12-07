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
        this.renderProviderItem(containerEl, id, config as ProviderConfig);
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

    // 快照保留天数 (A-FUNC-02: 可配置的快照保留策略)
    new Setting(containerEl)
      .setName("快照保留天数")
      .setDesc("超过此天数的快照将被自动清理")
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
   * 
   * 遵循设计文档 A-FUNC-08：高级模式显示模型、温度/TopP、去重阈值、并发等参数
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "高级设置" });

    // ============ 任务模型配置 ============
    containerEl.createEl("h3", { text: "任务模型配置" });
    containerEl.createEl("p", {
      text: "为不同任务类型配置使用的模型和参数",
      cls: "setting-item-description"
    });

    // 获取可用的 Provider 列表
    const providerIds = Object.keys(this.plugin.settings.providers);

    // 为每种任务类型创建配置
    const taskTypes: Array<{ key: string; name: string; desc: string }> = [
      { key: "standardizeClassify", name: "标准化分类", desc: "标准化输入并分类知识类型" },
      { key: "enrich", name: "丰富", desc: "生成别名和标签" },
      { key: "embedding", name: "嵌入", desc: "生成向量嵌入" },
      { key: "reason:new", name: "新概念生成", desc: "为新概念生成完整内容" },
      { key: "reason:incremental", name: "增量改进", desc: "增量改进现有内容" },
      { key: "reason:merge", name: "合并", desc: "合并两个重复概念" },
      { key: "ground", name: "事实核查", desc: "验证生成内容的准确性" }
    ];

    for (const taskType of taskTypes) {
      const taskConfig = this.plugin.settings.taskModels[taskType.key as keyof typeof this.plugin.settings.taskModels];
      
      new Setting(containerEl)
        .setName(`${taskType.name} 模型`)
        .setDesc(taskType.desc)
        .addDropdown(dropdown => {
          // Provider 选择
          if (providerIds.length === 0) {
            dropdown.addOption("", "请先配置 Provider");
          } else {
            dropdown.addOption("", "使用默认 Provider");
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
            .setPlaceholder("模型名称")
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
    containerEl.createEl("h3", { text: "去重参数" });

    new Setting(containerEl)
      .setName("相似度阈值")
      .setDesc("用于检测重复概念的相似度阈值 (0-1)，较高值更严格")
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
      .setName("检索数量 (TopK)")
      .setDesc("去重检测时检索的候选数量")
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

    // ============ 功能开关 ============
    containerEl.createEl("h3", { text: "功能开关" });

    new Setting(containerEl)
      .setName("启用事实核查 (Ground)")
      .setDesc("在内容生成后执行事实核查验证（会增加一次 LLM 调用）")
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.enableGrounding)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ enableGrounding: value });
            new Notice(`事实核查已${value ? "启用" : "禁用"}`);
          });
      });

    // ============ 队列参数 ============
    containerEl.createEl("h3", { text: "队列参数" });

    new Setting(containerEl)
      .setName("并发任务数")
      .setDesc("同时执行的最大任务数")
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
      .setName("自动重试")
      .setDesc("任务失败时自动重试")
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.autoRetry)
          .onChange(async (value) => {
            await this.plugin.settingsStore.update({ autoRetry: value });
          });
      });

    new Setting(containerEl)
      .setName("最大重试次数")
      .setDesc("任务失败时的最大重试次数")
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
    containerEl.createEl("h3", { text: "日志设置" });

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
   * 强制刷新缓存以获取最新状态
   */
  private async testProviderConnection(id: string): Promise<void> {
    new Notice(`正在测试 Provider ${id} 的连接...`);
    
    try {
      // 清除缓存并强制刷新
      const providerManager = this.plugin.getComponents().providerManager;
      providerManager.clearAvailabilityCache(id);
      const result = await providerManager.checkAvailability(id, true);
      
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
