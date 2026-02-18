/**
 * ModalManager — Modal 弹窗统一管理器（Svelte 版）
 *
 * 职责：
 * - 仅管理 ConfirmModal 和 ProviderModal 两种 Svelte Modal
 * - 防止同类型 Modal 堆叠（同类型只允许一个实例）
 * - 提供 showConfirm / showProvider / close / closeAll 接口
 * - Plugin 卸载时关闭所有 Modal 并清理 DOM
 *
 * @see 需求 12.8
 */

import type { Component } from "svelte";
import type { ILogger } from "../types";
import { mountSvelteComponent } from "./bridge/mount";

const MODULE = "ModalManager";

// ============================================================================
// Modal 类型常量
// ============================================================================

/** 支持的 Modal 类型 */
export type ModalType = "confirm" | "provider";

// ============================================================================
// 依赖接口
// ============================================================================

export interface ModalManagerDeps {
    logger: ILogger;
}

// ============================================================================
// 活跃 Modal 记录
// ============================================================================

interface ActiveModal {
    /** Modal 类型 */
    type: ModalType;
    /** DOM 容器 */
    container: HTMLElement;
    /** Svelte 组件卸载函数 */
    destroy: () => void;
}

// ============================================================================
// ModalManager 实现
// ============================================================================

export class ModalManager {
    /** 按类型追踪当前打开的 Modal（同类型最多一个） */
    private readonly activeModals = new Map<ModalType, ActiveModal>();

    private readonly logger: ILogger;

    constructor(deps: ModalManagerDeps) {
        this.logger = deps.logger;
    }

    /**
     * 显示 Svelte Modal
     *
     * 通用方法：将 Svelte 组件挂载到 document.body 的临时容器中。
     * 若同类型 Modal 已打开，返回 false 并阻止重复打开。
     *
     * @param type Modal 类型标识
     * @param component Svelte 组件
     * @param props 组件 props
     * @returns 是否成功打开
     */
    show<T extends Record<string, unknown>>(
        type: ModalType,
        component: Component,
        props: T
    ): boolean {
        if (this.activeModals.has(type)) {
            this.logger.debug(MODULE, `同类型 Modal 已打开，阻止重复打开`, { type });
            return false;
        }

        // 创建临时 DOM 容器
        const container = document.createElement("div");
        container.classList.add("cr-modal-container", `cr-modal-container--${type}`);
        document.body.appendChild(container);

        // 挂载 Svelte 组件
        const { destroy } = mountSvelteComponent(container, component, props);

        this.activeModals.set(type, { type, container, destroy });
        this.logger.debug(MODULE, `Modal 已打开`, { type });

        return true;
    }

    /**
     * 关闭指定类型的 Modal
     */
    close(type: ModalType): void {
        const active = this.activeModals.get(type);
        if (!active) return;

        // 卸载 Svelte 组件
        active.destroy();
        // 移除 DOM 容器
        active.container.remove();
        this.activeModals.delete(type);

        this.logger.debug(MODULE, `Modal 已关闭`, { type });
    }

    /**
     * 检查某类型 Modal 是否已打开
     */
    isOpen(type: ModalType): boolean {
        return this.activeModals.has(type);
    }

    /**
     * 关闭所有 Modal（Plugin 卸载时调用）
     */
    closeAll(): void {
        const types = [...this.activeModals.keys()];
        for (const type of types) {
            this.close(type);
        }
        if (types.length > 0) {
            this.logger.debug(MODULE, `所有 Modal 已关闭`, { count: types.length });
        }
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this.closeAll();
    }
}
