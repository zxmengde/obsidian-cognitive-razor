import { mount, unmount } from 'svelte';
import type { Component } from 'svelte';

/**
 * 将 Svelte 组件挂载到 Obsidian 容器
 * 返回卸载函数，在 View.onClose() 中调用。
 * 原生设置页的渲染回调没有 Svelte 父组件，context 用于把设置上下文直接交给子树。
 */
export function mountSvelteComponent<T extends Record<string, unknown>>(
    target: HTMLElement,
    component: Component<T>,
    props: T,
    context?: Map<unknown, unknown>,
): { destroy: () => Promise<void> } {
    const instance = mount(component, { target, props, ...(context ? { context } : {}) });
    let destroyed = false;
    return {
        destroy: async () => {
            if (destroyed) return;
            destroyed = true;
            await unmount(instance);
        }
    };
}
