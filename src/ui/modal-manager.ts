/**
 * ModalManager — Modal 弹窗统一管理器
 *
 * 职责：
 * - 按类型追踪当前打开的 Modal，防止同类型 Modal 堆叠
 * - 提供 open / close / isOpen / closeAll 统一接口
 * - Plugin 卸载时关闭所有 Modal
 *
 * @see 需求 14.1
 */

import { Modal } from "obsidian";
import type { ILogger } from "../types";

const MODULE = "ModalManager";

// ============================================================================
// 依赖接口
// ============================================================================

export interface ModalManagerDeps {
    logger: ILogger;
}

// ============================================================================
// ModalManager 实现
// ============================================================================

export class ModalManager {
    /** 按类型追踪当前打开的 Modal */
    private readonly activeModals = new Map<string, Modal>();

    private readonly logger: ILogger;

    constructor(deps: ModalManagerDeps) {
        this.logger = deps.logger;
    }

    /**
     * 打开 Modal，若同类型已打开则返回 null
     *
     * @param modalType 类型标识（如 'confirm', 'diff', 'expand', 'merge'）
     * @param factory   创建 Modal 的工厂函数
     * @returns 创建的 Modal 实例，若同类型已打开则返回 null
     */
    open<T extends Modal>(modalType: string, factory: () => T): T | null {
        if (this.activeModals.has(modalType)) {
            this.logger.debug(MODULE, `同类型 Modal 已打开，阻止重复打开`, { modalType });
            return null;
        }

        const modal = factory();

        // 监听 Modal 关闭事件，自动从追踪表中移除
        const originalClose = modal.close.bind(modal);
        modal.close = () => {
            this.activeModals.delete(modalType);
            this.logger.debug(MODULE, `Modal 已关闭`, { modalType });
            originalClose();
        };

        this.activeModals.set(modalType, modal);
        modal.open();
        this.logger.debug(MODULE, `Modal 已打开`, { modalType });

        return modal;
    }

    /**
     * 关闭指定类型的 Modal
     */
    close(modalType: string): void {
        const modal = this.activeModals.get(modalType);
        if (modal) {
            modal.close();
            // close() 内部已通过拦截器从 activeModals 中移除
        }
    }

    /**
     * 检查某类型 Modal 是否已打开
     */
    isOpen(modalType: string): boolean {
        return this.activeModals.has(modalType);
    }

    /**
     * 关闭所有 Modal（Plugin 卸载时调用）
     */
    closeAll(): void {
        // 复制 keys 避免迭代时修改 Map
        const types = [...this.activeModals.keys()];
        for (const modalType of types) {
            this.close(modalType);
        }
        this.logger.debug(MODULE, `所有 Modal 已关闭`, { count: types.length });
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this.closeAll();
    }
}
