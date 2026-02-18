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

        // 挂载 Svelte 根组件，传入 plugin 引用供组件获取服务
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
