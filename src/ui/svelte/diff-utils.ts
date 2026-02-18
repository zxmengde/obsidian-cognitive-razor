/**
 * diff-utils.ts — Diff 标签页打开辅助函数
 *
 * 职责：
 * - 提供 openDiffTab() 函数，以编程方式打开 DiffTabView
 * - 同一笔记复用已有标签页，避免重复打开
 * - 供 DuplicatesSection、HistorySection 及 CommandDispatcher 调用
 *
 * @see 需求 9.12, 9.13
 */

import type { App } from 'obsidian';
import { DiffTabView, VIEW_TYPE_CR_DIFF, type DiffViewState } from './diff-view';

/**
 * 打开 Diff 标签页
 *
 * 逻辑：
 * 1. 遍历已有 leaf，查找同一 noteName 的 DiffTabView 实例
 * 2. 找到则复用（更新状态 + reveal）
 * 3. 未找到则创建新标签页
 *
 * @param app Obsidian App 实例
 * @param state Diff 视图状态
 */
export async function openDiffTab(app: App, state: DiffViewState): Promise<void> {
    // 查找已有的同名笔记 Diff 标签页
    const existing = findExistingDiffLeaf(app, state.noteName);

    if (existing) {
        // 复用已有标签页：更新状态并聚焦
        existing.setDiffState(state);
        const leaf = existing.leaf;
        app.workspace.revealLeaf(leaf);
        return;
    }

    // 创建新标签页
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({
        type: VIEW_TYPE_CR_DIFF,
        active: true,
    });

    // 获取新创建的视图实例并设置状态
    const view = leaf.view;
    if (view instanceof DiffTabView) {
        view.setDiffState(state);
    }

    app.workspace.revealLeaf(leaf);
}

/**
 * 查找已有的同名笔记 Diff 标签页
 */
function findExistingDiffLeaf(app: App, noteName: string): DiffTabView | null {
    const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_CR_DIFF);
    for (const leaf of leaves) {
        const view = leaf.view;
        if (view instanceof DiffTabView && view.getNoteName() === noteName) {
            return view;
        }
    }
    return null;
}
