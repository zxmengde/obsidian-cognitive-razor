/**
 * WorkbenchSection — 工作台区域抽象基类
 *
 * 定义所有 Section 组件的生命周期契约：
 * - render(): 首次渲染到指定容器
 * - update(): 数据变更时增量更新 UI
 * - dispose(): 释放资源（事件监听器、定时器、DOM 引用）
 *
 * 需求: 6.1
 */

import type { SectionDeps } from "./workbench-section-deps";

export abstract class WorkbenchSection<TDeps extends SectionDeps = SectionDeps> {
    protected deps: TDeps;

    constructor(deps: TDeps) {
        this.deps = deps;
    }

    /**
     * 首次渲染 Section 内容到指定容器
     * @param container 父容器元素
     */
    abstract render(container: HTMLElement): void;

    /**
     * 数据变更时增量更新 UI
     * 子类根据自身数据模型决定更新粒度
     */
    abstract update(): void;

    /**
     * 释放所有资源
     * 清理事件监听器、定时器、DOM 引用等，防止内存泄漏
     */
    abstract dispose(): void;
}
