<!--
  QueueManagementPanel.svelte — 队列的筛选与批量操作面板

  职责：
  - 状态 / 阶段筛选
  - 全选、清理历史的入口
  - 批量重试、取消、删除

  数据计算在 queue-view.ts，本组件只转发事件；确认弹窗仍由 QueueSection 拥有，
  避免同一份确认状态散落到两层。
-->
<script lang="ts">
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import { getWorkbenchContext } from '../../bridge/context';
    import { TASK_STAGE_IDS } from '../../../types';
    import { stageLabel } from '../../stage-labels';
    import type { QueueFilter, StageFilter, QueueSelectionView } from '../../queue-view';

    let {
        open = $bindable(false),
        status,
        stateFilter = $bindable(),
        stageFilter = $bindable(),
        allFilteredSelected,
        selection,
        retryableFailedCount,
        actionRunning,
        onStateFilter,
        onStageFilter,
        onToggleSelectAll,
        onClearHistory,
        onRetrySelected,
        onCancelSelected,
        onRemoveSelected,
        onRetryFailed,
    }: {
        open?: boolean;
        // Only the counters this panel renders; the pause toggle and total
        // stay in the section header.
        status: { failed: number; interrupted: number; completed: number; cancelled: number };
        stateFilter: QueueFilter;
        stageFilter: StageFilter;
        allFilteredSelected: boolean;
        selection: QueueSelectionView;
        retryableFailedCount: number;
        actionRunning: boolean;
        onStateFilter: (filter: QueueFilter) => void;
        onStageFilter: (filter: StageFilter) => void;
        onToggleSelectAll: () => void;
        onClearHistory: () => void;
        onRetrySelected: () => void;
        onCancelSelected: () => void;
        onRemoveSelected: () => void;
        onRetryFailed: () => void;
    } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
</script>

<details class="cr-queue-management" bind:open>
    <summary>{open ? t.workbench.product.doneManage : t.workbench.product.manage}</summary>
    <p class="cr-queue-overall">{ctx.i18n.format('workbench.product.needsHandling', { count: status.failed + status.interrupted })}</p>
    <div class="cr-queue-toolbar">
        <label class="cr-queue-select-label">
            <span>{t.workbench.queueStatus.filterState}</span>
            <select value={stateFilter} onchange={(event) => onStateFilter((event.currentTarget as HTMLSelectElement).value as QueueFilter)}>
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
            <select value={stageFilter} onchange={(event) => onStageFilter((event.currentTarget as HTMLSelectElement).value as StageFilter)}>
                <option value="all">{t.workbench.queueStatus.all}</option>
                {#each TASK_STAGE_IDS as stageId (stageId)}
                    <option value={stageId}>{stageLabel(stageId, t)}</option>
                {/each}
            </select>
        </label>
    </div>

    <div class="cr-queue-history-tools">
        <label class="cr-queue-select-all">
            <input type="checkbox" checked={allFilteredSelected} onchange={onToggleSelectAll} />
            <span>{t.workbench.queueStatus.selectAll}</span>
        </label>
        {#if status.completed > 0 || status.failed > 0 || status.cancelled > 0 || status.interrupted > 0}
            <Button variant="ghost" size="sm" disabled={actionRunning} onclick={onClearHistory}>
                <Icon name="trash-2" size={16} />
                {t.workbench.queueStatus.clearHistory}
            </Button>
        {/if}
    </div>

    <div class="cr-queue-actions" role="toolbar" aria-label={t.workbench.queueStatus.batchActions}>
        {#if selection.selectedFailed.length > 0}
            <Button variant="secondary" size="sm" disabled={actionRunning} onclick={onRetrySelected}>
                <Icon name="refresh-cw" size={16} />
                {t.workbench.queueStatus.retrySelected} ({selection.selectedFailed.length})
            </Button>
        {/if}
        {#if selection.selectedActive.length > 0}
            <Button variant="secondary" size="sm" disabled={actionRunning} onclick={onCancelSelected}>
                <Icon name="x" size={16} />
                {t.workbench.queueStatus.cancelSelected} ({selection.selectedActive.length})
            </Button>
        {/if}
        {#if selection.selectedRemovable.length > 0}
            <Button variant="ghost" size="sm" disabled={actionRunning} onclick={onRemoveSelected}>
                <Icon name="trash-2" size={16} />
                {t.workbench.queueStatus.deleteSelected} ({selection.selectedRemovable.length})
            </Button>
        {/if}
        {#if retryableFailedCount > 0}
            <Button variant="ghost" size="sm" disabled={actionRunning} onclick={onRetryFailed}>
                <Icon name="refresh-cw" size={16} />
                {t.workbench.queueStatus.retryFailed}
            </Button>
        {/if}
    </div>
</details>

<style>
    .cr-queue-management > summary { position: absolute; right: 0; top: 1px; list-style: none; color: var(--cr-text-muted); font-size: var(--cr-font-xs); cursor: pointer; }
    .cr-queue-management > summary::-webkit-details-marker { display: none; }
    .cr-queue-management[open] { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--cr-border); }
    .cr-queue-management[open] > div { margin-top: 12px; }
    .cr-queue-overall { color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-queue-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); align-items: center; gap: 8px; min-width: 0; }
    .cr-queue-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .cr-queue-history-tools { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: 8px; min-width: 0; }
    .cr-queue-history-tools :global(button) { height: auto; min-height: 32px; box-shadow: none; }
    .cr-queue-select-label { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 4px; min-width: 0; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-queue-select-label select { width: 100%; min-width: 0; min-height: 28px; max-width: 100%; box-sizing: border-box; }
    .cr-queue-select-all { display: inline-flex; align-items: center; gap: 4px; min-width: 0; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-queue-select-all input { flex-shrink: 0; }
</style>
