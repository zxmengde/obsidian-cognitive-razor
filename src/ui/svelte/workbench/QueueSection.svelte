<script lang="ts">
    import { untrack } from 'svelte';
    import { SvelteSet } from 'svelte/reactivity';
    import { getWorkbenchContext } from '../../bridge/context';
    import StatusDot from '../../components/StatusDot.svelte';
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

    type DotStatus = 'idle' | 'running' | 'paused' | 'error';
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

    let expanded = $state(true);
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
    const displayedTasks = $derived(primaryTasks.slice(0, visibleLimit));
    const selectableTasks = $derived([...primaryTasks, ...(historyOpen ? historyTasks : [])]);
    const selectedTasks = $derived(tasks.filter((task) => selectedIds.has(task.id)));
    const selectedActive = $derived(selectedTasks.filter((task) => task.state === 'pending' || task.state === 'running'));
    const selectedFailed = $derived(selectedTasks.filter((task) => task.stageId !== 'cards' && task.state === 'failed' && !isUncertainTask(task)));
    const selectedRemovable = $derived(selectedTasks.filter((task) => task.state !== 'running'));
    const retryableFailedCount = $derived(tasks.filter((task) => task.stageId !== 'cards' && task.state === 'failed' && !isUncertainTask(task)).length);
    const allFilteredSelected = $derived(selectableTasks.length > 0 && selectableTasks.every((task) => selectedIds.has(task.id)));
    const hasMore = $derived(displayedTasks.length < primaryTasks.length);

    const dotStatus: DotStatus = $derived.by(() => {
        if (status.failed > 0) return 'error';
        if (status.paused) return 'paused';
        if (status.running > 0) return 'running';
        return 'idle';
    });

    const statusLabel: string = $derived.by(() => {
        if (status.failed > 0) return t.workbench.queueStatus.hasFailures;
        if (status.interrupted > 0) return t.cards.hasInterrupted;
        if (status.paused) return t.workbench.queueStatus.paused;
        if (status.running > 0) return t.workbench.queueStatus.running;
        if (status.pending > 0) return t.workbench.queueStatus.pending;
        return t.workbench.queueStatus.noTasks;
    });

    const statsText = $derived(ctx.i18n.format('workbench.queueStatus.attentionSummary', {
        attention: status.failed + status.interrupted,
        active: status.pending + status.running,
    }));

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
            <button class="cr-queue-status-info" type="button" onclick={() => expanded = !expanded} aria-expanded={expanded}>
                <StatusDot status={dotStatus} />
                <span class="cr-visually-hidden">{statusLabel}</span>
                <span class="cr-queue-title">{t.workbench.queueStatus.title}</span>
                <span class="cr-queue-stats" aria-live="polite">{statsText}</span>
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} />
            </button>
            {#if status.paused || status.pending > 0 || status.running > 0}
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={actionRunning}
                    onclick={handleTogglePause}
                    ariaLabel={status.paused ? t.workbench.queueStatus.resumeQueue : t.workbench.queueStatus.pauseQueue}
                >
                    <Icon name={status.paused ? 'play' : 'pause'} size={16} />
                </Button>
            {/if}
        </div>

        {#if expanded}
            <div class="cr-queue-details">
                {#if uncertainCount > 0}
                    <p class="cr-queue-uncertain-notice" role="note">{ctx.i18n.format('workbench.queueStatus.uncertainGroup', { count: uncertainCount })}</p>
                {/if}
                <details class="cr-queue-management">
                    <summary>{t.workbench.queueStatus.manageQueue}</summary>
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
                {#if displayedTasks.length > 0}
                    <QueueTaskList
                        tasks={displayedTasks}
                        {selectedIds}
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
                    <EmptyState message={t.workbench.queueStatus.noFilteredTasks} icon="inbox" />
                {/if}
                {#if historyTasks.length > 0}
                    <details class="cr-queue-history" bind:open={historyOpen}>
                        <summary>{t.workbench.queueStatus.history} <span>{historyTasks.length}</span></summary>
                        {#if historyOpen}
                        <QueueTaskList tasks={historyTasks.slice(0, historyLimit)} {selectedIds} onselect={selectTask} onretry={handleRetry} oncancel={handleCancel} onremove={handleRemove} disabled={actionRunning} />
                        {#if historyTasks.length > historyLimit}
                            <Button variant="ghost" size="sm" onclick={() => historyLimit += pageSize}>{t.workbench.queueStatus.showMore} ({historyTasks.length - historyLimit})</Button>
                        {/if}
                        {/if}
                    </details>
                {/if}
            </div>
        {/if}
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
    .cr-queue-uncertain-notice { margin: 0; color: var(--cr-text-muted); font-size: var(--cr-font-sm); line-height: var(--cr-line-height-body); }
    .cr-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .cr-queue-management, .cr-queue-history { min-width: 0; }
    summary { cursor: pointer; color: var(--cr-text-muted); font-size: var(--cr-font-sm); padding: var(--cr-space-2) 0; line-height: var(--cr-line-height-body); }
    .cr-queue-management[open] { padding-bottom: var(--cr-space-3); border-bottom: 1px solid var(--cr-border); }
    .cr-queue-management[open] > div { margin-top: var(--cr-space-3); }
    .cr-queue-history { border-top: 1px solid var(--cr-border); }
    .cr-queue-history summary span { margin-left: var(--cr-space-2); font-variant-numeric: tabular-nums; }

    .cr-queue-section { display: flex; flex-direction: column; gap: var(--cr-space-2); }
    .cr-queue-status-bar { display: flex; align-items: flex-start; gap: var(--cr-space-2); }
    .cr-queue-status-info { display: flex; flex-wrap: wrap; align-items: center; gap: var(--cr-space-2); flex: 1; min-width: 0; height: auto; min-height: 32px; box-shadow: none; border-radius: 0; line-height: var(--cr-line-height-body); padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .cr-queue-title { font-weight: 600; color: var(--cr-text-normal); }
    .cr-queue-stats { flex-basis: 100%; order: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere; color: var(--cr-text-muted); font-size: var(--font-ui-smaller); }
    .cr-queue-details { display: flex; flex-direction: column; gap: var(--cr-space-3); margin-top: var(--cr-space-1); }
    .cr-queue-summary { display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid var(--cr-border); }
    .cr-queue-summary button { display: flex; justify-content: space-between; gap: var(--cr-space-2); padding: var(--cr-space-2); border: 0; border-right: 1px solid var(--cr-border); background: transparent; color: var(--cr-text-muted); cursor: pointer; }
    .cr-queue-summary button:last-child { border-right: 0; }
    .cr-queue-summary button:hover, .cr-queue-summary button.active { background: var(--cr-bg-hover); color: var(--cr-text-normal); }
    .cr-queue-summary strong { color: var(--cr-text-normal); }
    .cr-queue-toolbar, .cr-queue-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--cr-space-2); }
    .cr-queue-select-label { display: inline-flex; align-items: center; gap: var(--cr-space-1); color: var(--cr-text-muted); font-size: var(--font-ui-smaller); }
    .cr-queue-select-label select { min-height: 28px; max-width: 150px; }
    .cr-queue-select-all { display: inline-flex; align-items: center; gap: var(--cr-space-1); margin-left: auto; color: var(--cr-text-muted); font-size: var(--font-ui-smaller); }
    .cr-queue-actions { padding-block: var(--cr-space-1); }
    .cr-queue-actions :global(button) { display: inline-flex; align-items: center; gap: var(--cr-space-1); }
    @media (max-width: 620px) {
        .cr-queue-summary { grid-template-columns: repeat(2, 1fr); }
        .cr-queue-summary button:nth-child(2) { border-right: 0; }
        .cr-queue-summary button:nth-child(-n + 2) { border-bottom: 1px solid var(--cr-border); }
        .cr-queue-select-all { margin-left: 0; }
    }
    @container cr-workbench (max-width: 620px) {
        .cr-queue-summary { grid-template-columns: repeat(2, 1fr); }
        .cr-queue-summary button:nth-child(2) { border-right: 0; }
        .cr-queue-summary button:nth-child(-n + 2) { border-bottom: 1px solid var(--cr-border); }
        .cr-queue-select-all { margin-left: 0; }
    }
</style>
