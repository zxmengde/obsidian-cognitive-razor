/**
 * 响应式包装器 — Obsidian 事件 → Svelte 5 $state
 *
 * 将 Core 层的事件驱动 API 转换为 Svelte 5 响应式状态，
 * 使 Svelte 组件能以声明式方式消费队列、管线、重复对等数据。
 *
 * 每个 store 工厂函数返回 `destroy` 方法用于清理订阅，
 * 应在组件卸载时（$effect 清理或 onDestroy）调用。
 *
 * @see 需求 2.4, 2.5
 */

import type { Workspace, TFile } from 'obsidian';
import type { TaskQueue } from '@/core/task-queue';
import type { DuplicateManager } from '@/core/duplicate-manager';
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
 * 订阅 TaskQueue 的所有事件，自动同步队列状态和任务列表到 $state。
 * 组件卸载时调用 destroy() 取消订阅。
 */
export function createQueueStore(taskQueue: TaskQueue) {
    let status = $state<QueueStatus>(taskQueue.getStatus());
    let tasks = $state<TaskRecord[]>(taskQueue.getAllTasks());

    // 订阅队列事件，任何变化都重新拉取最新状态
    const unsubscribe = taskQueue.subscribe(() => {
        status = taskQueue.getStatus();
        tasks = taskQueue.getAllTasks();
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
 * 监听 Obsidian workspace 的 active-leaf-change 事件，
 * 自动同步当前活跃文件到 $state。
 */
export function createActiveFileStore(workspace: Workspace) {
    let activeFile = $state<TFile | null>(workspace.getActiveFile());

    const ref = workspace.on('active-leaf-change', () => {
        activeFile = workspace.getActiveFile();
    });

    return {
        get file() { return activeFile; },
        destroy: () => workspace.offref(ref),
    };
}

// ============================================================================
// 重复对 Store
// ============================================================================

/**
 * 重复对响应式 store
 *
 * 订阅 DuplicateManager 的变化通知，自动同步待处理重复对列表。
 * DuplicateManager.subscribe 会在订阅时立即调用一次回调。
 */
export function createDuplicatesStore(duplicateManager: DuplicateManager) {
    let pairs = $state<DuplicatePair[]>(duplicateManager.getPendingPairs());

    const unsubscribe = duplicateManager.subscribe((updatedPairs) => {
        // DuplicateManager 回调传入的是全量 pairs（含所有状态），
        // 这里只保留 pending 状态的对
        pairs = updatedPairs.filter(p => p.status === 'pending');
    });

    return {
        get pairs() { return pairs; },
        destroy: unsubscribe,
    };
}


