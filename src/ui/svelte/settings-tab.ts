/**
 * CRSettingTab — Svelte 5 设置页的 Obsidian PluginSettingTab 包装器
 *
 * 职责：
 * - 继承 PluginSettingTab，注册为插件设置面板
 * - 在 display() 中挂载 SettingsRoot Svelte 组件
 * - 在 hide() 中卸载 Svelte 组件并释放资源
 * - 通过 plugin 引用向 Svelte 组件树提供服务访问
 *
 * @see 需求 10.1
 */

import { App, PluginSettingTab } from 'obsidian';
import type CognitiveRazorPlugin from '../../../main';
import SettingsRoot from './settings/SettingsRoot.svelte';
import { mountSvelteComponent } from '../bridge/mount';

export class CRSettingTab extends PluginSettingTab {
    private cleanup: (() => void) | null = null;
    private plugin: CognitiveRazorPlugin;

    constructor(app: App, plugin: CognitiveRazorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('cr-scope');

        // 挂载 Svelte 根组件，传入 plugin 引用供组件获取服务
        const { destroy } = mountSvelteComponent(containerEl, SettingsRoot, {
            plugin: this.plugin,
        });
        this.cleanup = destroy;
    }

    hide(): void {
        this.cleanup?.();
        this.cleanup = null;
    }
}
