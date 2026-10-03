<script lang="ts">
    import { untrack } from 'svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import SectionCard from '../../components/SectionCard.svelte';
    import EmptyState from '../../components/EmptyState.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import QueueTaskList from './QueueTaskList.svelte';
    import { TASK_STAGE_IDS } from '../../../types';
    import type { QueueStatus, TaskRecord, TaskStageId, TaskState } from '../../../types';
    import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';
    import { isUncertainTask } from '../../../core/task-uncertainty';
    import { stageLabel } from '../../stage-labels';

    type QueueFilter = 'all' | 'active' | TaskState;
    type StageFilter = 'all' | TaskStageId;
    type ConfirmAction = 'cancel-active' | 'clear-history' | null;

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

    const filteredTasks = $derived.by(() => tasks.filter((task) => {
        const stateMatches = stateFilter === 'all'
            || (stateFilter === 'active' && (task.state === 'pending' || task.state === 'running'))
            || task.state === stateFilter;
        return stateMatches && (stageFilter === 'all' || task.stageId === stageFilter);
    }));
    const primaryTasks = $derived(stateFilter === 'all' ? filteredTasks.filter(task => task.state !== 'completed' && task.state !== 'cancelled') : filteredTasks);
    const historyTasks = $derived(stateFilter === 'all' ? filteredTasks.filter(task => task.state === 'completed' || task.state === 'cancelled') : []);
    const uncertainCount = $derived(primaryTasks.filter(task => (task.state === 'failed' || task.state === 'interrupted') && isUncertainTask(task)).length);
    const attentionCount = $derived(primaryTasks.filter(task => task.state === 'failed' || task.state === 'interrupted').length);
    const displayedTasks = $derived(primaryTasks.slice(0, visibleLimit));
    const selectableTasks = $derived([...primaryTasks, ...(historyOpen ? historyTasks : [])]);
    const selectedTasks = $derived(tasks.filter((task) => selectedIds.has(task.id)));
    const selectedActive = $derived(selectedTasks.filter((task) => task.state === 'pending' || task.state === 'running'));
    const selectedFailed = $derived(selectedTasks.filter((task) => task.stageId !== 'cards' && task.state === 'failed' && !isUncertainTask(task)));
    const selectedRemovable = $derived(selectedTasks.filter((task) => task.state !== 'running'));
    const retryableFailedCount = $derived(tasks.filter((task) => task.stageId !== 'cards' && task.state === 'failed' && !isUncertainTask(task)).length);
    const allFilteredSelected = $derived(selectableTasks.length > 0 && selectableTasks.every((task) => selectedIds.has(task.id)));
    const hasMore = $derived(displayedTasks.length < primaryTasks.length);

    $effect(() => {
        const taskIds = new SvelteSet(tasks.map((task) => task.id));
        const nextSelected = new SvelteSet([...selectedIds].filter((taskId) => taskIds.has(taskId)));
        if (nextSelected.size !== selectedIds.size) {
            selectedIds.clear();
            for (const taskId of nextSelected) selectedIds.add(taskId);
        }
    });

    function handleStateFilter(event: Event): void {
        stateFilter = (event.currentTarget as HTMLSelectElement).value as QueueFilter;
        visibleLimit = pageSize;
    }

    function handleStageFilter(event: Event): void {
        stageFilter = (event.currentTarget as HTMLSelectElement).value as StageFilter;
        visibleLimit = pageSize;
    }

    function toggleSelectAll(): void {
        const next = new SvelteSet(selectedIds);
        if (allFilteredSelected) {
            for (const task of selectableTasks) next.delete(task.id);
        } else {
            for (const task of selectableTasks) next.add(task.id);
        }
        selectedIds.clear();
        for (const taskId of next) selectedIds.add(taskId);
    }

    function selectTask(taskId: string, selected: boolean): void {
        const next = new SvelteSet(selectedIds);
        if (selected) next.add(taskId);
        else next.delete(taskId);
        selectedIds.clear();
        for (const taskId of next) selectedIds.add(taskId);
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

    /** First failure wins; an empty or all-successful batch reports success. */
    function firstFailure(results: QueueActionOutcome[]): QueueActionOutcome {
        return results.find((result) => !result.ok) ?? { ok: true };
    }

    async function handleTogglePause(): Promise<void> {
        await runQueueAction(() => (status.paused ? queue.resume() : queue.pause()));
    }

    async function retryTask(taskId: string, confirmed = false): Promise<void> {
        await runQueueAction(() => (confirmed ? queue.retryUncertain(taskId) : queue.retry(taskId)));
    }

    function handleRetry(taskId: string): void {
        const task = tasks.find((task) => task.id === taskId);
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
        await runQueueAction(
            async () => firstFailure(await Promise.all(selectedFailed.map((task) => queue.retry(task.id).catch((error) => ({ ok: false as const, error }))))),
            () => selectedIds.clear(),
        );
    }

    async function handleRetryFailed(): Promise<void> {
        await runQueueAction(() => queue.retryFailed());
    }

    async function handleCancelSelected(): Promise<void> {
        await runQueueAction(
            async () => firstFailure(await Promise.all(selectedActive.map((task) => queue.cancel(task.id).catch((error) => ({ ok: false as const, error }))))),
            () => selectedIds.clear(),
        );
    }

    async function handleRemoveSelected(): Promise<void> {
        await runQueueAction(
            async () => firstFailure(await Promise.all(selectedRemovable.map((task) => queue.remove(task.id).catch((error) => ({ ok: false as const, error }))))),
            () => selectedIds.clear(),
        );
    }

    async function confirmBatchAction(): Promise<void> {
        const action = pendingConfirmation;
        pendingConfirmation = null;
        await runQueueAction(() => (action === 'cancel-active' ? queue.cancelAllActive() : queue.removeTerminal()));
    }
</script>

<SectionCard>
    <div class="cr-queue-section">
        <div class="cr-queue-status-bar">
            <h2 class="cr-queue-title">{t.workbench.product.tasks}</h2>
            {#if status.paused || status.pending > 0 || status.running > 0}
                <Button variant="ghost" size="sm" disabled={actionRunning} onclick={handleTogglePause} ariaLabel={status.paused ? t.workbench.queueStatus.resumeQueue : t.workbench.queueStatus.pauseQueue}>{status.paused ? t.workbench.queueStatus.resumeQueue : t.workbench.queueStatus.pauseQueue}</Button>
            {/if}
        </div>
            <div class="cr-queue-details">
                <details class="cr-queue-management" bind:open={managing}>
                    <summary aria-label={t.workbench.queueStatus.manageQueue}>{managing ? t.workbench.product.doneManage : t.workbench.product.manage}</summary>
                <p class="cr-queue-overall">{ctx.i18n.format('workbench.product.needsHandling', {count: status.failed + status.interrupted})}</p>
                <div class="cr-queue-summary" role="toolbar" aria-label={t.workbench.queueStatus.summary}>
                    <button type="button" class:active={stateFilter === 'active'} onclick={() => stateFilter = 'active'}>
                        <span>{t.workbench.queueStatus.active}</span><strong>{status.pending + status.running}</strong>
                    </button>
                    <button type="button" class:active={stateFilter === 'failed'} onclick={() => stateFilter = 'failed'}>
                        <span>{t.workbench.queueStatus.failed}</span><strong>{status.failed}</strong>
                    </button>
                    <button type="button" class:active={stateFilter === 'completed'} onclick={() => stateFilter = 'completed'}>
                        <span>{t.workbench.queueStatus.completed}</span><strong>{status.completed}</strong>
                    </button>
                    <button type="button" class:active={stateFilter === 'cancelled'} onclick={() => stateFilter = 'cancelled'}>
                        <span>{t.workbench.queueStatus.cancelled}</span><strong>{status.cancelled}</strong>
                    </button>
                </div>

                <div class="cr-queue-toolbar">
                    <label class="cr-queue-select-label">
                        <span>{t.workbench.queueStatus.filterState}</span>
                        <select value={stateFilter} onchange={handleStateFilter}>
                            <option value="all">{t.workbench.queueStatus.all}</option>
                            <option value="active">{t.workbench.queueStatus.active}</option>
                            <option value="pending">{t.workbench.queueStatus.pending}</option>
                            <option value="running">{t.workbench.queueStatus.running}</option>
                            <option value="interrupted">{t.cards.interrupted}</option>
                            <option value="failed">{t.workbench.queueStatus.failed}</option>
                            <option value="completed">{t.workbench.queueStatus.completed}</option>
                            <option value="cancelled">{t.workbench.queueStatus.cancelled}</option>
                        </select>
                    </label>
                    <label class="cr-queue-select-label">
                        <span>{t.workbench.queueStatus.stage}</span>
                        <select value={stageFilter} onchange={handleStageFilter}>
                            <option value="all">{t.workbench.queueStatus.all}</option>
                            {#each TASK_STAGE_IDS as stageId (stageId)}
                                <option value={stageId}>{stageLabel(stageId, t)}</option>
                            {/each}
                        </select>
                    </label>
                    <label class="cr-queue-select-all">
                        <input type="checkbox" checked={allFilteredSelected} onchange={toggleSelectAll} />
                        <span>{t.workbench.queueStatus.selectAll}</span>
                    </label>
                </div>

                <div class="cr-queue-actions" role="toolbar" aria-label={t.workbench.queueStatus.batchActions}>
                    {#if selectedFailed.length > 0}
                        <Button variant="secondary" size="sm" disabled={actionRunning} onclick={handleRetrySelected}>
                            <Icon name="refresh-cw" size={16} />
                            {t.workbench.queueStatus.retrySelected} ({selectedFailed.length})
                        </Button>
                    {/if}
                    {#if selectedActive.length > 0}
                        <Button variant="secondary" size="sm" disabled={actionRunning} onclick={handleCancelSelected}>
                            <Icon name="x" size={16} />
                            {t.workbench.queueStatus.cancelSelected} ({selectedActive.length})
                        </Button>
                    {/if}
                    {#if selectedRemovable.length > 0}
                        <Button variant="ghost" size="sm" disabled={actionRunning} onclick={handleRemoveSelected}>
                            <Icon name="trash-2" size={16} />
                            {t.workbench.queueStatus.deleteSelected} ({selectedRemovable.length})
                        </Button>
                    {/if}
                    {#if retryableFailedCount > 0}
                        <Button variant="ghost" size="sm" disabled={actionRunning} onclick={handleRetryFailed}>
                            <Icon name="refresh-cw" size={16} />
                            {t.workbench.queueStatus.retryFailed}
                        </Button>
                    {/if}
                    {#if status.pending > 0 || status.running > 0}
                        <Button variant="ghost" size="sm" disabled={actionRunning} onclick={() => pendingConfirmation = 'cancel-active'}>
                            <Icon name="x-circle" size={16} />
                            {t.workbench.queueStatus.cancelAllActive}
                        </Button>
                    {/if}
                    {#if status.completed > 0 || status.failed > 0 || status.cancelled > 0 || status.interrupted > 0}
                        <Button variant="ghost" size="sm" disabled={actionRunning} onclick={() => pendingConfirmation = 'clear-history'}>
                            <Icon name="trash-2" size={16} />
                            {t.workbench.queueStatus.clearHistory}
                        </Button>
                    {/if}
                </div>

                </details>
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
</SectionCard>

{#if feedback}
    <InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />
{/if}

{#if pendingConfirmation === 'cancel-active'}
    <ConfirmModal
        title={t.workbench.queueStatus.cancelAllConfirmTitle}
        message={t.workbench.queueStatus.cancelAllConfirmMessage}
        confirmLabel={t.workbench.queueStatus.confirmCancelTasks}
        cancelLabel={t.workbench.queueStatus.keepTasks}
        danger={true}
        onconfirm={confirmBatchAction}
        oncancel={() => pendingConfirmation = null}
    />
{:else if pendingConfirmation === 'clear-history'}
    <ConfirmModal
        title={t.workbench.queueStatus.clearHistoryConfirmTitle}
        message={t.workbench.queueStatus.clearHistoryConfirmMessage}
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
    .cr-queue-status-bar { display: flex; align-items: baseline; gap: 12px; margin-bottom: 24px; padding-right: 80px; }
    .cr-queue-title { margin: 0; padding: 0; font-size: 15px; font-weight: 600; color: var(--cr-text-normal); }
    .cr-queue-status-bar :global(button) { padding: 0; font-size: var(--cr-font-xs); min-height: 0; }
    .cr-queue-management > summary { position: absolute; right: 0; top: 1px; list-style: none; color: var(--cr-text-muted); font-size: var(--cr-font-xs); cursor: pointer; }
    .cr-queue-management > summary::-webkit-details-marker { display: none; }
    .cr-queue-management[open] { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--cr-border); }
    .cr-queue-management[open] > div { margin-top: 12px; }
    .cr-queue-uncertain-notice { margin: 0 0 16px; color: var(--cr-status-warning); font-size: var(--cr-font-sm); }
    .cr-queue-overall { color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-queue-summary { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
    .cr-queue-summary button { display: flex; justify-content: space-between; gap: 8px; padding: 8px; border: 1px solid var(--cr-border); background: transparent; color: var(--cr-text-muted); height: auto; min-height: 32px; box-shadow: none; }
    .cr-queue-summary button.active { background: var(--cr-bg-selected); color: var(--cr-text-normal); }
    .cr-queue-toolbar, .cr-queue-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .cr-queue-select-label { display: inline-flex; align-items: center; gap: 4px; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-queue-select-label select { min-height: 28px; max-width: 150px; }
    .cr-queue-select-all { display: inline-flex; align-items: center; gap: 4px; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-queue-history { margin-top: 20px; border-top: 1px solid var(--cr-border); }
    .cr-queue-history > summary { display: flex; justify-content: space-between; gap: 12px; padding-top: 16px; font-size: var(--cr-font-xs); color: var(--cr-text-muted); cursor: pointer; list-style: none; }
    .cr-queue-empty p { margin: 0; color: var(--cr-text-muted); font-size: var(--cr-font-sm); line-height: 1.7; }
    .cr-queue-empty p + p { margin-top: 12px; font-size: var(--cr-font-xs); color: var(--cr-text-faint); }
    @container cr-workbench (max-width: 620px) {
        .cr-queue-toolbar { align-items: flex-start; }
    }
</style>
