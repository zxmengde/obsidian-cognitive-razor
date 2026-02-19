/**
 * WorkbenchView — Svelte 5 工作台的 Obsidian ItemView 包装器
 *
 * 职责：
 * - 注册为 VIEW_TYPE_CR_WORKBENCH 视图类型
 * - 在 onOpen 时挂载 WorkbenchRoot Svelte 组件
 * - 在 onClose 时卸载组件并释放资源
 * - 通过 plugin 引用向 Svelte 组件树提供服务访问
 *
 * @see 需求 3.1, 3.2, 3.7, 3.8
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type CognitiveRazorPlugin from '../../../main';
import WorkbenchRoot from './workbench/WorkbenchRoot.svelte';
import { mountSvelteComponent } from '../bridge/mount';

/** 视图类型标识符 */
export const VIEW_TYPE_CR_WORKBENCH = 'cr-workbench';

export class WorkbenchView extends ItemView {
    private cleanup: (() => void) | null = null;
    private plugin: CognitiveRazorPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: CognitiveRazorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_CR_WORKBENCH;
    }

    getDisplayText(): string {
        return 'Cognitive Razor';
    }

    getIcon(): string {
        return 'brain';
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('cr-scope');

        // 等待插件完全初始化后再挂载 Svelte 组件
        // 避免在服务未注册时调用 getComponents() 导致崩溃
        if (!this.plugin.isFullyInitialized()) {
            container.createEl('div', {
                cls: 'cr-loading',
                text: '正在初始化...',
            });
            // 轮询等待初始化完成（最多 10 秒）
            const maxWait = 10000;
            const interval = 100;
            let waited = 0;
            const checkReady = setInterval(() => {
                waited += interval;
                if (this.plugin.isFullyInitialized()) {
                    clearInterval(checkReady);
                    container.empty();
                    this.mountComponent(container);
                } else if (waited >= maxWait) {
                    clearInterval(checkReady);
                    container.empty();
                    container.createEl('div', {
                        cls: 'cr-error',
                        text: '插件初始化超时，请重新加载插件',
                    });
                }
            }, interval);
            return;
        }

        this.mountComponent(container);
    }

    private mountComponent(container: HTMLElement): void {
        const { destroy } = mountSvelteComponent(container, WorkbenchRoot, {
            plugin: this.plugin,
        });
        this.cleanup = destroy;
    }

    async onClose(): Promise<void> {
        this.cleanup?.();
        this.cleanup = null;
    }
}
