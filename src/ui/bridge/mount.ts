import { mount, unmount } from 'svelte';
import type { Component } from 'svelte';

/**
 * 将 Svelte 组件挂载到 Obsidian 容器
 * 返回卸载函数，在 View.onClose() 中调用
 */
export function mountSvelteComponent<T extends Record<string, unknown>>(
    target: HTMLElement,
    component: Component,
    props: T
): { destroy: () => void } {
    const instance = mount(component, { target, props });
    return {
        destroy: () => unmount(instance)
    };
}
