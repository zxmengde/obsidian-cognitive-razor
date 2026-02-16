/**
 * ServiceContainer — 轻量级手动 DI 容器
 *
 * 职责：
 * - 类型安全的服务注册与解析（registerSingleton / resolve）
 * - 分层初始化（Data → Core → UI）
 * - 逆序释放（UI → Core → Data）
 *
 * 设计决策：不引入第三方 DI 框架，减少打包体积，保持对 Obsidian 生命周期的直接控制。
 *
 * @see 需求 1.1, 1.2, 1.3
 */

import type { ILogger } from "../types";

// ============================================================================
// 接口定义
// ============================================================================

/**
 * 可释放资源接口
 * 实现此接口的服务在 disposeAll() 时会被自动调用 dispose()
 */
export interface Disposable {
    dispose(): void;
}

/** 初始化层级，决定 initializeAll / disposeAll 的执行顺序 */
export type ServiceLayer = "data" | "core" | "ui";

/** 层级优先级映射（数值越小越先初始化，越后释放） */
const LAYER_ORDER: Record<ServiceLayer, number> = {
    data: 0,
    core: 1,
    ui: 2,
};

// ============================================================================
// 内部类型
// ============================================================================

/** 服务注册条目 */
interface ServiceEntry<T = unknown> {
    /** 工厂函数（延迟实例化时使用） */
    factory: (() => T) | null;
    /** 已实例化的单例 */
    instance: T | null;
    /** 所属层级 */
    layer: ServiceLayer;
}

// ============================================================================
// ServiceContainer 实现
// ============================================================================

export class ServiceContainer {
    /** 服务注册表 */
    private readonly registry = new Map<symbol, ServiceEntry>();

    /** 按注册顺序记录的 token 列表（用于保持层内顺序） */
    private readonly registrationOrder: symbol[] = [];

    /** 容器是否已释放 */
    private disposed = false;

    /**
     * 注册单例服务（工厂函数形式，延迟实例化）
     *
     * @param token  服务标识符（symbol）
     * @param factory 工厂函数，首次 resolve 时调用
     * @param layer  所属层级
     */
    registerFactory<T>(token: symbol, factory: () => T, layer: ServiceLayer): void {
        this.ensureNotDisposed();
        if (this.registry.has(token)) {
            throw new Error(`服务已注册: ${token.toString()}`);
        }
        this.registry.set(token, { factory: factory as () => unknown, instance: null, layer });
        this.registrationOrder.push(token);
    }

    /**
     * 注册单例服务（已有实例形式）
     *
     * @param token    服务标识符（symbol）
     * @param instance 已创建的实例
     * @param layer    所属层级
     */
    registerInstance<T>(token: symbol, instance: T, layer: ServiceLayer): void {
        this.ensureNotDisposed();
        if (this.registry.has(token)) {
            throw new Error(`服务已注册: ${token.toString()}`);
        }
        this.registry.set(token, { factory: null, instance: instance as unknown, layer });
        this.registrationOrder.push(token);
    }

    /**
     * 解析服务实例
     *
     * 如果服务通过工厂注册且尚未实例化，则立即调用工厂函数创建实例。
     *
     * @param token 服务标识符
     * @returns 服务实例
     * @throws 服务未注册时抛出错误
     */
    resolve<T>(token: symbol): T {
        this.ensureNotDisposed();
        const entry = this.registry.get(token);
        if (!entry) {
            throw new Error(`服务未注册: ${token.toString()}`);
        }
        if (entry.instance === null && entry.factory !== null) {
            entry.instance = entry.factory();
        }
        return entry.instance as T;
    }

    /**
     * 检查服务是否已注册
     */
    has(token: symbol): boolean {
        return this.registry.has(token);
    }

    /**
     * 按 Data → Core → UI 顺序初始化所有服务
     *
     * 对于通过工厂注册的服务，此方法确保它们按层级顺序被实例化。
     * 如果服务实例实现了 `init()` 异步方法，将依次调用。
     *
     * @see 需求 1.2
     */
    async initializeAll(): Promise<void> {
        this.ensureNotDisposed();

        // 按层级排序，同层内保持注册顺序
        const sorted = this.getSortedTokens("asc");

        for (const token of sorted) {
            const entry = this.registry.get(token)!;

            // 确保实例已创建
            if (entry.instance === null && entry.factory !== null) {
                entry.instance = entry.factory();
            }

            // 如果实例有 init() 方法，调用它
            const instance = entry.instance as Record<string, unknown> | null;
            if (instance && typeof instance["init"] === "function") {
                await (instance["init"] as () => Promise<void>)();
            }
        }
    }

    /**
     * 按 UI → Core → Data 逆序释放所有服务资源
     *
     * 对实现了 Disposable 接口的服务调用 dispose()。
     * 释放后容器不可再使用。
     *
     * @see 需求 1.3
     */
    disposeAll(): void {
        if (this.disposed) return;

        // 按层级逆序排列，同层内逆序
        const sorted = this.getSortedTokens("desc");

        for (const token of sorted) {
            const entry = this.registry.get(token)!;
            const instance = entry.instance as (Disposable & Record<string, unknown>) | null;
            if (instance && typeof instance.dispose === "function") {
                try {
                    instance.dispose();
                } catch {
                    // 释放阶段不抛出异常，静默处理
                    // 生产环境中由 Logger 记录（如果 Logger 尚未被释放）
                }
            }
        }

        this.registry.clear();
        this.registrationOrder.length = 0;
        this.disposed = true;
    }

    // ========================================================================
    // 内部方法
    // ========================================================================

    /**
     * 按层级排序 token 列表
     * @param direction "asc" = Data→Core→UI, "desc" = UI→Core→Data
     */
    private getSortedTokens(direction: "asc" | "desc"): symbol[] {
        const tokens = [...this.registrationOrder];
        const multiplier = direction === "asc" ? 1 : -1;

        tokens.sort((a, b) => {
            const entryA = this.registry.get(a)!;
            const entryB = this.registry.get(b)!;
            const layerDiff = LAYER_ORDER[entryA.layer] - LAYER_ORDER[entryB.layer];
            if (layerDiff !== 0) return layerDiff * multiplier;
            // 同层内保持注册顺序（asc）或逆序（desc）
            const orderA = this.registrationOrder.indexOf(a);
            const orderB = this.registrationOrder.indexOf(b);
            return (orderA - orderB) * multiplier;
        });

        return tokens;
    }

    /** 确保容器未被释放 */
    private ensureNotDisposed(): void {
        if (this.disposed) {
            throw new Error("ServiceContainer 已释放，不可继续使用");
        }
    }
}
