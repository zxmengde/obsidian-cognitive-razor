/**
 * Svelte Context 定义与 Provider
 *
 * 通过 Svelte Context API 向组件树注入核心依赖：
 * - ServiceContainer（DI 容器）
 * - I18n（国际化）
 * - App（Obsidian 应用实例）
 *
 * 使用方式：
 * - 根组件调用 setCRContext() 注入依赖
 * - 子组件调用 getCRContext() 获取依赖
 *
 * @see 需求 2.3, 2.6
 */

import { getContext, setContext } from 'svelte';
import type { App } from 'obsidian';
import type { ServiceContainer } from '@/core/service-container';
import type { I18n } from '@/core/i18n';

/** Context 标识符（Symbol 保证唯一性，避免键冲突） */
const CONTEXT_KEY = Symbol('cr-context');

/**
 * Cognitive Razor 全局 Context 接口
 *
 * 所有 Svelte 组件通过此接口访问核心服务，
 * 避免直接依赖 Obsidian 全局对象或模块级单例。
 */
interface CRContext {
    /** DI 容器，用于解析各类服务 */
    container: ServiceContainer;
    /** 国际化实例，用于获取翻译文本 */
    i18n: I18n;
    /** Obsidian App 实例 */
    app: App;
}

/**
 * 在根组件中设置 Context
 *
 * 必须在组件初始化阶段（顶层 `<script>` 中）调用，
 * Svelte 要求 setContext 在组件初始化期间同步调用。
 */
export function setCRContext(ctx: CRContext): void {
    setContext(CONTEXT_KEY, ctx);
}

/**
 * 在子组件中获取 Context
 *
 * 必须在组件初始化阶段（顶层 `<script>` 中）调用，
 * Svelte 要求 getContext 在组件初始化期间同步调用。
 */
export function getCRContext(): CRContext {
    return getContext<CRContext>(CONTEXT_KEY);
}
