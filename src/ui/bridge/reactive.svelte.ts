/**
 * 响应式包装器 — Obsidian 事件 → Svelte 5 $state
 *
 * 将 Core 层的事件驱动 API 转换为 Svelte 5 响应式状态，
 * 使 Svelte 组件能以声明式方式消费队列、管线、重复对等数据。
 *
 * 每个 store 工厂函数返回 `destroy` 方法用于清理订阅，
 * 应在组件卸载时（$effect 清理或 onDestroy）调用。
 *
 */

import type { Workspace, TFile } from 'obsidian';
import type { DuplicateApplication, QueueApplication } from '@/app/workbench-application';
import type {
    QueueStatus,
    TaskRecord,
    DuplicatePair,
} from '@/types';

// ============================================================================
// 队列状态 Store
// ============================================================================

/**
 * 队列状态响应式 store
 *
 * 订阅 Queue application port 的事件，自动同步队列状态和任务列表到 $state。
 * 组件卸载时调用 destroy() 取消订阅。
 */
export function createQueueStore(taskQueue: QueueApplication) {
    const initial = taskQueue.getSnapshot();
    let status = $state<QueueStatus>(initial.status);
    let tasks = $state<TaskRecord[]>(initial.tasks);

    // 每个事件只读取一次一致快照，避免重复遍历任务集合。
    const unsubscribe = taskQueue.subscribe(() => {
        const snapshot = taskQueue.getSnapshot();
        status = snapshot.status;
        tasks = snapshot.tasks;
    });

    return {
        get status() { return status; },
        get tasks() { return tasks; },
        destroy: unsubscribe,
    };
}

// ============================================================================
// 活跃文件 Store
// ============================================================================

/**
 * 活跃文件响应式 store
 *
 * 监听 Obsidian workspace 的文件和标签页切换事件，
 * 自动同步当前活跃文件到 $state。
 */
export function createActiveFileStore(workspace: Workspace) {
    let activeFile = $state<TFile | null>(workspace.getActiveFile());

    const refresh = () => {
        activeFile = workspace.getActiveFile();
    };
    const leafRef = workspace.on('active-leaf-change', refresh);
    const fileRef = workspace.on('file-open', refresh);

    return {
        get file() { return activeFile; },
        destroy: () => { workspace.offref(leafRef); workspace.offref(fileRef); },
    };
}

// ============================================================================
// 重复对 Store
// ============================================================================

/**
 * 重复对响应式 store
 *
 * 订阅 Duplicate application port 的变化通知，自动同步待处理重复对列表。
 * application port 的 subscribe 会在订阅时立即调用一次回调。
 */
export function createDuplicatesStore(duplicateManager: DuplicateApplication) {
    let pairs = $state<DuplicatePair[]>(duplicateManager.getPendingPairs());

    const unsubscribe = duplicateManager.subscribe((updatedPairs) => {
        pairs = updatedPairs;
    });

    return {
        get pairs() { return pairs; },
        destroy: unsubscribe,
    };
}
