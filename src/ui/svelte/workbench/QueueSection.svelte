<!--
  QueueSection.svelte — 工作台任务区

  职责（只做编排与渲染）：
  - 标题、暂停/继续
  - 把筛选、分组、选择的计算交给 queue-view.ts
  - 批量操作面板交给 QueueManagementPanel
  - 任务行交给 QueueTaskList
  - 确认弹窗与操作反馈留在这一层，因为它们由同一个动作队列驱动
-->
<script lang="ts">
    import { untrack } from 'svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import EmptyState from '../../components/EmptyState.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import QueueTaskList from './QueueTaskList.svelte';
    import QueueManagementPanel from './QueueManagementPanel.svelte';
    import type { QueueStatus, TaskRecord } from '../../../types';
    import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';
    import { isUncertainTask } from '../../../core/task-uncertainty';
    import {
        countAttention,
        countRetryableFailed,
        countUncertain,
        filterQueueTasks,
        groupQueueTasks,
        isEveryTaskSelected,
        toggleAllSelection,
        viewQueueSelection,
        type QueueFilter,
        type StageFilter,
    } from '../../queue-view';

    type ConfirmAction = 'clear-history' | null;

    let {
        status,
        tasks,
    }: {
        status: QueueStatus;
        tasks: TaskRecord[];
    } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
    const queue = ctx.application.queue;

    let managing = $state(false);
    let historyOpen = $state(false);
    let stateFilter = $state<QueueFilter>(untrack(() => ctx.settingsApplication.getSettings().queueDefaultFilter ?? 'all'));
    let pageSize = $state(untrack(() => ctx.settingsApplication.getSettings().queuePageSize ?? 50));
    let historyLimit = $state(untrack(() => pageSize));
    let stageFilter = $state<StageFilter>('all');
    let selectedIds = new SvelteSet<string>();
    let visibleLimit = $state(untrack(() => pageSize));
    const unsubscribeDisplaySettings = ctx.settingsApplication.subscribeSettings(settings => {
        const nextPageSize = settings.queuePageSize ?? 50;
        if (nextPageSize !== pageSize) { pageSize = nextPageSize; visibleLimit = nextPageSize; historyLimit = nextPageSize; }
    });
    $effect(() => () => unsubscribeDisplaySettings());
    let pendingConfirmation = $state<ConfirmAction>(null);
    let uncertainRetryTaskId = $state<string | null>(null);
    let feedback = $state<UiFeedback | null>(null);
    let actionRunning = $state(false);
    const detailsToggleLabels = {
        expand: t.common.details.expand,
        collapse: t.common.details.collapse,
    };

    const filteredTasks = $derived(filterQueueTasks(tasks, stateFilter, stageFilter));
    const groups = $derived(groupQueueTasks(filteredTasks, stateFilter));
    const primaryTasks = $derived(groups.primary);
    const historyTasks = $derived(groups.history);
    const uncertainCount = $derived(countUncertain(primaryTasks));
    const attentionCount = $derived(countAttention(primaryTasks));
    const displayedTasks = $derived(primaryTasks.slice(0, visibleLimit));
    const selectableTasks = $derived([...primaryTasks, ...(historyOpen ? historyTasks : [])]);
    const selection = $derived(viewQueueSelection(tasks, selectedIds));
    const retryableFailedCount = $derived(countRetryableFailed(tasks));
    const allFilteredSelected = $derived(isEveryTaskSelected(selectableTasks, selectedIds));
    const hasMore = $derived(displayedTasks.length < primaryTasks.length);

    // 任务被删除或不再匹配筛选后，残留的选择 id 必须清掉，否则批量计数会虚高。
    $effect(() => {
        const taskIds = new SvelteSet(tasks.map((task) => task.id));
        const nextSelected = new SvelteSet([...selectedIds].filter((taskId) => taskIds.has(taskId)));
        if (nextSelected.size !== selectedIds.size) {
            selectedIds.clear();
            for (const taskId of nextSelected) selectedIds.add(taskId);
        }
    });

    function handleStateFilter(filter: QueueFilter): void {
        stateFilter = filter;
        visibleLimit = pageSize;
    }

    function handleStageFilter(filter: StageFilter): void {
        stageFilter = filter;
        visibleLimit = pageSize;
    }

    function toggleSelectAll(): void {
        const next = toggleAllSelection(selectableTasks, selectedIds);
        for (const taskId of next.remove) selectedIds.delete(taskId);
        for (const taskId of next.add) selectedIds.add(taskId);
    }

    function selectTask(taskId: string, selected: boolean): void {
        if (selected) selectedIds.add(taskId);
        else selectedIds.delete(taskId);
    }

    type QueueActionOutcome = { ok: true } | { ok: false; error: unknown };

    /** One place for the busy lock, Result unwrapping and safe error feedback. */
    async function runQueueAction(action: () => Promise<QueueActionOutcome>, after?: () => void): Promise<void> {
        if (actionRunning) return;
        actionRunning = true;
        feedback = null;
        try {
            const result = await action();
            if (!result.ok) feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.unknownFailure);
        } catch (error) {
            feedback = toSafeErrorFeedback(error, t.workbench.notifications.unknownFailure);
        } finally {
            actionRunning = false;
        }
        after?.();
    }

    /** 批量操作沿用同一错误和选择清理规则，避免重试、取消和删除各维护一份。 */
    async function runSelectedAction(selected: TaskRecord[], action: (taskId: string) => Promise<QueueActionOutcome>): Promise<void> {
        await runQueueAction(async () => {
            const results = await Promise.all(selected.map((task) => action(task.id).catch((error) => ({ ok: false as const, error }))));
            return results.find((result) => !result.ok) ?? { ok: true };
        }, () => selectedIds.clear());
    }

    async function handleTogglePause(): Promise<void> {
        await runQueueAction(() => (status.paused ? queue.resume() : queue.pause()));
    }

    async function retryTask(taskId: string, confirmed = false): Promise<void> {
        await runQueueAction(() => (confirmed ? queue.retryUncertain(taskId) : queue.retry(taskId)));
    }

    function handleRetry(taskId: string): void {
        const task = tasks.find((item) => item.id === taskId);
        if (task && isUncertainTask(task)) {
            uncertainRetryTaskId = taskId;
            return;
        }
        void retryTask(taskId);
    }

    function confirmUncertainRetry(): void {
        const taskId = uncertainRetryTaskId;
        uncertainRetryTaskId = null;
        if (taskId) void retryTask(taskId, true);
    }

    async function handleCancel(taskId: string): Promise<void> {
        await runQueueAction(() => queue.cancel(taskId));
    }

    async function handleRemove(taskId: string): Promise<void> {
        await runQueueAction(() => queue.remove(taskId));
    }

    async function handleRetrySelected(): Promise<void> {
        await runSelectedAction(selection.selectedFailed, (taskId) => queue.retry(taskId));
    }

    async function handleRetryFailed(): Promise<void> {
        await runQueueAction(() => queue.retryFailed());
    }

    async function handleCancelSelected(): Promise<void> {
        await runSelectedAction(selection.selectedActive, (taskId) => queue.cancel(taskId));
    }

    async function handleRemoveSelected(): Promise<void> {
        await runSelectedAction(selection.selectedRemovable, (taskId) => queue.remove(taskId));
    }

    async function confirmBatchAction(): Promise<void> {
        pendingConfirmation = null;
        await runQueueAction(() => queue.removeTerminal());
    }
</script>

<div class="cr-queue-section">
    <div class="cr-queue-status-bar">
        <h2 class="cr-section-title cr-queue-title">{t.workbench.product.tasks}</h2>
        {#if status.paused || status.pending > 0 || status.running > 0}
            <Button variant="ghost" size="sm" disabled={actionRunning} onclick={handleTogglePause} ariaLabel={status.paused ? t.workbench.queueStatus.resumeQueue : t.workbench.queueStatus.pauseQueue}>{status.paused ? t.workbench.queueStatus.resumeQueue : t.workbench.queueStatus.pauseQueue}</Button>
        {/if}
    </div>
    <div class="cr-queue-details">
        <QueueManagementPanel
            bind:open={managing}
            {status}
            bind:stateFilter
            bind:stageFilter
            {allFilteredSelected}
            {selection}
            {retryableFailedCount}
            {actionRunning}
            onStateFilter={handleStateFilter}
            onStageFilter={handleStageFilter}
            onToggleSelectAll={toggleSelectAll}
            onClearHistory={() => pendingConfirmation = 'clear-history'}
            onRetrySelected={handleRetrySelected}
            onCancelSelected={handleCancelSelected}
            onRemoveSelected={handleRemoveSelected}
            onRetryFailed={handleRetryFailed}
        />
        {#if attentionCount > 0}<p class="cr-queue-uncertain-notice" role="status">{ctx.i18n.format(uncertainCount === attentionCount ? 'workbench.product.needsAttention' : 'workbench.product.needsHandling', {count: attentionCount})}</p>{/if}
        {#if displayedTasks.length > 0}
            <QueueTaskList
                tasks={displayedTasks}
                {selectedIds}
                selectable={managing}
                onselect={selectTask}
                onretry={handleRetry}
                oncancel={handleCancel}
                onremove={handleRemove}
                disabled={actionRunning}
            />
            {#if hasMore}
                <Button variant="ghost" size="sm" onclick={() => visibleLimit += pageSize}>
                    {t.workbench.queueStatus.showMore} ({primaryTasks.length - displayedTasks.length})
                </Button>
            {/if}
        {:else}
            {#if tasks.length === 0}<div class="cr-queue-empty"><p>{t.workbench.product.noTasks}</p><p>{t.workbench.product.noTasksHint}</p></div>{:else if stateFilter !== 'all'}<EmptyState message={t.workbench.queueStatus.noFilteredTasks} icon="inbox" />{/if}
        {/if}
        {#if historyTasks.length > 0}
            <details class="cr-queue-history" bind:open={historyOpen}>
                <summary><span>{ctx.i18n.format('workbench.product.historySummary', {completed: status.completed, cancelled: status.cancelled})}</span><span>{t.workbench.product.viewHistory} ›</span></summary>
                {#if historyOpen}
                <QueueTaskList tasks={historyTasks.slice(0, historyLimit)} {selectedIds} selectable={managing} onselect={selectTask} onretry={handleRetry} oncancel={handleCancel} onremove={handleRemove} disabled={actionRunning} />
                {#if historyTasks.length > historyLimit}
                    <Button variant="ghost" size="sm" onclick={() => historyLimit += pageSize}>{t.workbench.queueStatus.showMore} ({historyTasks.length - historyLimit})</Button>
                {/if}
                {/if}
            </details>
        {/if}
    </div>
</div>

{#if feedback}
    <InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />
{/if}

{#if pendingConfirmation === 'clear-history'}
    <ConfirmModal
        title={t.workbench.queueStatus.clearHistoryConfirmTitle}
        message={t.workbench.queueStatus.clearHistoryConfirmMessage + (status.interrupted > 0 ? ` ${t.workbench.queueStatus.clearHistoryKeepsUncertain}` : '')}
        confirmLabel={t.workbench.queueStatus.clearHistory}
        cancelLabel={t.common.cancel}
        danger={true}
        onconfirm={confirmBatchAction}
        oncancel={() => pendingConfirmation = null}
    />
{/if}

{#if uncertainRetryTaskId}
    <ConfirmModal
        title={t.workbench.queueStatus.uncertainRetryConfirmTitle}
        message={t.workbench.queueStatus.uncertainRetryConfirmMessage}
        confirmLabel={t.workbench.queueStatus.retry}
        cancelLabel={t.common.cancel}
        danger={true}
        onconfirm={confirmUncertainRetry}
        oncancel={() => uncertainRetryTaskId = null}
    />
{/if}

<style>
    .cr-queue-section { position: relative; min-width: 0; }
    .cr-queue-status-bar { display: flex; align-items: baseline; gap: var(--cr-space-3); margin-bottom: var(--cr-space-3); padding-right: 80px; }
    .cr-queue-status-bar :global(button) { padding: 0; font-size: var(--cr-font-xs); min-height: 0; }
    .cr-queue-uncertain-notice { margin: 0 0 var(--cr-space-4); color: var(--cr-status-warning); font-size: var(--cr-font-sm); }
    .cr-queue-history { margin-top: var(--cr-space-4); border-top: 1px solid var(--cr-border); }
    .cr-queue-history > summary { display: flex; justify-content: space-between; gap: var(--cr-space-3); padding-top: var(--cr-space-3); font-size: var(--cr-font-xs); color: var(--cr-text-muted); cursor: pointer; list-style: none; }
    .cr-queue-empty p { margin: 0; color: var(--cr-text-muted); font-size: var(--cr-font-sm); line-height: var(--cr-line-height-body); }
    .cr-queue-empty p + p { margin-top: var(--cr-space-1); font-size: var(--cr-font-xs); color: var(--cr-text-faint); }
</style>
