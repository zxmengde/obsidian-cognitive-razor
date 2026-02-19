/**
 * ServiceContainer — 轻量级手动 DI 容器
 *
 * 职责：
 * - 类型安全的服务注册与解析（registerInstance / resolve）
 * - 分层注册（Data → Core → UI）
 * - 逆序释放（UI → Core → Data）
 *
 * 设计决策：不引入第三方 DI 框架，减少打包体积，保持对 Obsidian 生命周期的直接控制。
 */

// ============================================================================
// 接口定义
// ============================================================================

/**
 * 可释放资源接口
 * 实现此接口的服务在 disposeAll() 时会被自动调用 dispose()
 */
interface Disposable {
    dispose(): void;
}

/** 初始化层级，决定 disposeAll 的释放顺序 */
type ServiceLayer = "data" | "core" | "ui";

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
    /** 已实例化的单例 */
    instance: T;
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
        this.registry.set(token, { instance: instance as unknown, layer });
        this.registrationOrder.push(token);
    }

    /**
     * 解析服务实例
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
        return entry.instance as T;
    }

    /**
     * 检查服务是否已注册
     */
    has(token: symbol): boolean {
        return this.registry.has(token);
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
