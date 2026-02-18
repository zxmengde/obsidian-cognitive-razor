/**
 * 响应式包装器 — Obsidian 事件 → Svelte 5 $state
 *
 * 将 Core 层的事件驱动 API 转换为 Svelte 5 响应式状态，
 * 使 Svelte 组件能以声明式方式消费队列、管线、重复对、快照等数据。
 *
 * 每个 store 工厂函数返回 `destroy` 方法用于清理订阅，
 * 应在组件卸载时（$effect 清理或 onDestroy）调用。
 *
 * @see 需求 2.4, 2.5
 */

import type { Workspace, TFile } from 'obsidian';
import type { TaskQueue } from '@/core/task-queue';
import type { DuplicateManager } from '@/core/duplicate-manager';
import type { UndoManager } from '@/core/undo-manager';
import type { CreateOrchestrator } from '@/core/create-orchestrator';
import type { AmendOrchestrator } from '@/core/amend-orchestrator';
import type { MergeOrchestrator } from '@/core/merge-orchestrator';
import type {
    QueueStatus,
    TaskRecord,
    DuplicatePair,
    SnapshotMetadata,
    PipelineContext,
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
// 管线事件 Store
// ============================================================================

/** 管线 store 依赖的 Orchestrator 集合 */
export interface PipelineOrchestrators {
    create: CreateOrchestrator;
    amend: AmendOrchestrator;
    merge: MergeOrchestrator;
}

/**
 * 管线事件响应式 store
 *
 * 订阅 Create/Amend/Merge 三个 Orchestrator 的管线事件，
 * 跟踪当前活跃管线的上下文。管线完成或失败时清除。
 */
export function createPipelineStore(orchestrators: PipelineOrchestrators) {
    let activePipeline = $state<PipelineContext | null>(null);

    const unsubCreate = orchestrators.create.subscribe((event) => {
        if (event.type === 'pipeline_completed' || event.type === 'pipeline_failed') {
            // 仅清除对应管线
            if (activePipeline?.pipelineId === event.pipelineId) {
                activePipeline = null;
            }
        } else {
            activePipeline = event.context;
        }
    });

    const unsubAmend = orchestrators.amend.subscribe((event) => {
        if (event.type === 'pipeline_completed' || event.type === 'pipeline_failed') {
            if (activePipeline?.pipelineId === event.pipelineId) {
                activePipeline = null;
            }
        } else {
            activePipeline = event.context;
        }
    });

    const unsubMerge = orchestrators.merge.subscribe((event) => {
        if (event.type === 'pipeline_completed' || event.type === 'pipeline_failed') {
            if (activePipeline?.pipelineId === event.pipelineId) {
                activePipeline = null;
            }
        } else {
            activePipeline = event.context;
        }
    });

    return {
        get pipeline() { return activePipeline; },
        destroy: () => {
            unsubCreate();
            unsubAmend();
            unsubMerge();
        },
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

// ============================================================================
// 快照 Store
// ============================================================================

/**
 * 快照列表响应式 store
 *
 * UndoManager 没有事件订阅机制，提供手动刷新方法。
 * 组件在需要时（如操作完成后）调用 refresh() 更新列表。
 */
export function createSnapshotsStore(undoManager: UndoManager) {
    let snapshots = $state<SnapshotMetadata[]>([]);
    let loading = $state(false);

    /** 从 UndoManager 拉取最新快照列表 */
    async function refresh(): Promise<void> {
        loading = true;
        const result = await undoManager.listSnapshots();
        if (result.ok) {
            snapshots = result.value;
        }
        loading = false;
    }

    // 初始加载
    void refresh();

    return {
        get snapshots() { return snapshots; },
        get loading() { return loading; },
        refresh,
        destroy: () => { /* 无订阅需清理，占位保持接口一致 */ },
    };
}
