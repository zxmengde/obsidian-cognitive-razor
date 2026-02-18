/**
 * SetupWizard — Svelte 5 版首次配置向导
 *
 * 使用 Obsidian Modal 作为容器，内部挂载 WizardRoot.svelte 组件。
 * 替代旧的原生 DOM 版 setup-wizard.ts。
 *
 * @see 需求 11.1-11.6
 */

import { App, Modal } from 'obsidian';
import type CognitiveRazorPlugin from '../../../main';
import WizardRoot from './wizard/WizardRoot.svelte';
import { mountSvelteComponent } from '../bridge/mount';

export class SetupWizard extends Modal {
    private plugin: CognitiveRazorPlugin;
    private cleanup: (() => void) | null = null;

    constructor(app: App, plugin: CognitiveRazorPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass('cr-scope');

        // ARIA 无障碍属性
        modalEl.setAttr('role', 'dialog');
        modalEl.setAttr('aria-modal', 'true');

        // 挂载 Svelte 组件，传入 plugin 供 WizardRoot 设置 Context
        const { destroy } = mountSvelteComponent(contentEl, WizardRoot, {
            plugin: this.plugin,
            oncomplete: () => this.close(),
        });
        this.cleanup = destroy;
    }

    onClose(): void {
        this.cleanup?.();
        this.cleanup = null;
    }
}
