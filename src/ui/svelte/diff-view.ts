/**
 * DiffTabView — Svelte 5 Diff 标签页的 Obsidian ItemView 包装器
 *
 * 职责：
 * - 注册为 VIEW_TYPE_CR_DIFF 视图类型
 * - 在 onOpen 时挂载 DiffRoot Svelte 组件
 * - 在 onClose 时卸载组件并释放资源
 * - 支持多实例并存，同一笔记复用已有标签页
 * - 关闭标签页等同于拒绝操作
 *
 * @see 需求 9.1, 9.12
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type CognitiveRazorPlugin from '../../../main';
import DiffRoot from './diff/DiffRoot.svelte';
import { mountSvelteComponent } from '../bridge/mount';

/** 视图类型标识符 */
export const VIEW_TYPE_CR_DIFF = 'cr-diff';

/** Diff 行类型 */
export interface DiffLine {
    type: 'add' | 'remove' | 'context';
    text: string;
}

/**
 * 逐行对比两段文本，生成 diff 行列表
 * 使用简单的 LCS（最长公共子序列）算法
 */
export function buildLineDiff(oldContent: string, newContent: string): DiffLine[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const m = oldLines.length;
    const n = newLines.length;

    // 构建 LCS 表
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = oldLines[i - 1] === newLines[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }

    // 回溯生成 diff
    const result: DiffLine[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            result.push({ type: 'context', text: oldLines[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.push({ type: 'add', text: newLines[j - 1] });
            j--;
        } else {
            result.push({ type: 'remove', text: oldLines[i - 1] });
            i--;
        }
    }
    return result.reverse();
}

/** Diff 视图状态接口 */
export interface DiffViewState {
    /** 操作模式：修订 / 合并 / 快照恢复 */
    mode: 'amend' | 'merge' | 'snapshot';
    /** 目标笔记名称 */
    noteName: string;
    /** 原始内容 */
    oldContent: string;
    /** 新内容 */
    newContent: string;
    /** 合并场景：两个笔记名称 */
    mergeNames?: { nameA: string; nameB: string };
    /** 合并场景：重复对 ID */
    mergePairId?: string;
    /** 快照场景：快照 ID */
    snapshotId?: string;
    /** 接受回调 */
    onAccept: (data?: { selectedName?: string }) => void;
    /** 拒绝回调 */
    onReject: () => void;
}

export class DiffTabView extends ItemView {
    private cleanup: (() => void) | null = null;
    private plugin: CognitiveRazorPlugin;
    private viewState: DiffViewState | null = null;
    /** 标记用户是否已做出决策（接受/拒绝） */
    private decided = false;

    constructor(leaf: WorkspaceLeaf, plugin: CognitiveRazorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_CR_DIFF;
    }

    getDisplayText(): string {
        if (this.viewState) {
            const modeLabels: Record<string, string> = {
                amend: '修订',
                merge: '合并',
                snapshot: '快照恢复',
            };
            const label = modeLabels[this.viewState.mode] ?? 'Diff';
            return `${label}: ${this.viewState.noteName}`;
        }
        return 'Diff';
    }

    getIcon(): string {
        return 'file-diff';
    }

    /** 设置 Diff 状态并挂载组件 */
    setDiffState(state: DiffViewState): void {
        this.viewState = state;
        this.decided = false;
        // 如果已经打开，重新挂载
        if (this.containerEl.children[1]) {
            this.mountComponent();
        }
    }

    /** 获取当前笔记名称（用于复用检测） */
    getNoteName(): string | null {
        return this.viewState?.noteName ?? null;
    }

    async onOpen(): Promise<void> {
        if (this.viewState) {
            this.mountComponent();
        }
    }

    private mountComponent(): void {
        // 清理旧实例
        this.cleanup?.();
        this.cleanup = null;

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('cr-scope');

        if (!this.viewState) return;

        // 包装回调，标记已决策
        const wrappedState: DiffViewState = {
            ...this.viewState,
            onAccept: (data) => {
                this.decided = true;
                this.viewState?.onAccept(data);
            },
            onReject: () => {
                this.decided = true;
                this.viewState?.onReject();
            },
        };

        const { destroy } = mountSvelteComponent(container, DiffRoot, {
            state: wrappedState,
            plugin: this.plugin,
        });
        this.cleanup = destroy;
    }

    async onClose(): Promise<void> {
        // 关闭标签页等同于拒绝（如果用户尚未做出决策）
        if (!this.decided && this.viewState) {
            this.viewState.onReject();
        }
        this.cleanup?.();
        this.cleanup = null;
        this.viewState = null;
    }
}
