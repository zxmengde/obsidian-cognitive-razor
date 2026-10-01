<script lang="ts">
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import type { TaskRecord, TaskState } from '../../../types';
    import { formatStandardName } from '../../../core/naming-utils';
    import { stageLabel } from '../../stage-labels';

    let {
        tasks,
        selectedIds,
        onselect,
        onretry,
        oncancel,
        onremove,
        disabled = false,
    }: {
        tasks: TaskRecord[];
        selectedIds: Set<string>;
        onselect: (taskId: string, selected: boolean) => void;
        onretry: (taskId: string) => void;
        oncancel: (taskId: string) => void;
        onremove: (taskId: string) => void;
        disabled?: boolean;
    } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;

    function getTaskDisplayName(task: TaskRecord): string {
        if (task.noteTitle?.trim()) return task.noteTitle;
        const payload = task.payload;
        if ('concept' in payload && payload.concept) return formatStandardName(payload.concept.name);
        if ('filePath' in payload && payload.filePath) {
            return (payload.filePath.split('/').pop() || payload.filePath).replace(/\.md$/, '');
        }
        return t.workbench.queueStatus.unnamedNote;
    }

    function getStateLabel(state: TaskState): string {
        return {
            interrupted: t.cards.interrupted,
            pending: t.workbench.queueStatus.pending,
            running: t.workbench.queueStatus.running,
            completed: t.workbench.queueStatus.completed,
            failed: t.workbench.queueStatus.failed,
            cancelled: t.workbench.queueStatus.cancelled,
        }[state];
    }

    function getStateIcon(state: TaskState): string {
        return {
            interrupted: 'circle-pause',
            pending: 'clock',
            running: 'loader-circle',
            completed: 'check-circle-2',
            failed: 'alert-triangle',
            cancelled: 'ban',
        }[state];
    }
</script>

<div class="cr-task-list" role="list">
    {#each tasks as task (task.id)}
        {@const displayName = getTaskDisplayName(task)}
        <div class="cr-task-item cr-task-item--{task.state}" role="listitem">
            <input
                class="cr-task-select"
                type="checkbox"
                checked={selectedIds.has(task.id)}
                onchange={(event) => onselect(task.id, event.currentTarget.checked)}
                aria-label={`${t.workbench.queueStatus.selectTask} ${displayName}`}
            />

            <span class="cr-task-name" title={task.stageId === "cards" ? `${displayName} → ${task.payload.targetPath ?? ""}` : displayName}>{displayName}</span>
            <span class="cr-task-stage" title={task.stageId}>{stageLabel(task.stageId, t)}</span>
            <span class="cr-task-state cr-task-state--{task.state}">
                <Icon name={getStateIcon(task.state)} size={16} />
                <span>{getStateLabel(task.state)}</span>
            </span>
            <span class="cr-task-actions">
                {#if task.stageId !== 'cards' && (task.state === 'failed' || task.state === 'interrupted')}
                    <Button variant="ghost" size="icon" disabled={disabled} onclick={() => onretry(task.id)} ariaLabel={t.workbench.queueStatus.retry}>
                        <Icon name="refresh-cw" size={16} />
                    </Button>
                {/if}
                {#if task.state === 'pending' || task.state === 'running'}
                    <Button variant="ghost" size="icon" disabled={disabled} onclick={() => oncancel(task.id)} ariaLabel={t.workbench.queueStatus.cancel}>
                        <Icon name="x" size={16} />
                    </Button>
                {:else}
                    <Button variant="ghost" size="icon" disabled={disabled} onclick={() => onremove(task.id)} ariaLabel={t.workbench.queueStatus.delete}>
                        <Icon name="trash-2" size={16} />
                    </Button>
                {/if}
            </span>
            {#if task.stageId === 'cards' && task.state === 'completed'}
                <span class="cr-task-detail">{ctx.i18n.format('cards.completed', { path: task.payload.targetPath ?? task.filePath ?? '' })}</span>
            {:else if task.stageId === 'cards' && (task.state === 'failed' || task.state === 'interrupted')}
                <span class="cr-task-detail">{t.cards.regenerateHint}</span>
            {/if}
        </div>
    {/each}
</div>

<style>
    .cr-task-list { display: flex; flex-direction: column; gap: 1px; }
    .cr-task-item {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) minmax(64px, auto) minmax(86px, auto) 56px;
        align-items: center;
        gap: var(--cr-space-2);
        min-height: 40px;
        padding: var(--cr-space-1) var(--cr-space-2);
        border-bottom: 1px solid var(--cr-border);
        font-size: var(--font-ui-small);
    }
    .cr-task-detail { grid-column: 2 / -1; color: var(--cr-text-muted); overflow-wrap: anywhere; }
    .cr-task-item:last-child { border-bottom: 0; }
    .cr-task-item:hover { background: var(--cr-bg-hover); }
    .cr-task-select { width: 16px; height: 16px; margin: 0; }
    .cr-task-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cr-text-normal); }
    .cr-task-stage { color: var(--cr-text-muted); font-family: var(--font-monospace); font-size: var(--font-ui-smaller); }
    .cr-task-state { display: inline-flex; align-items: center; gap: var(--cr-space-1); min-width: 86px; font-size: var(--font-ui-smaller); }
    .cr-task-state--pending { color: var(--cr-task-pending); }
    .cr-task-state--running { color: var(--cr-task-running); }
    .cr-task-state--completed { color: var(--cr-status-success); }
    .cr-task-state--interrupted { color: var(--cr-task-failed); }
    .cr-task-state--failed { color: var(--cr-task-failed); }
    .cr-task-state--cancelled { color: var(--cr-text-muted); }
    .cr-task-state--running :global(svg) { animation: cr-queue-spin 1s linear infinite; }
    .cr-task-actions { display: grid; grid-auto-flow: column; grid-auto-columns: 28px; justify-content: end; min-width: 28px; }
    @keyframes cr-queue-spin { to { transform: rotate(360deg); } }
    @media (max-width: 620px) {
        .cr-task-item { grid-template-columns: 20px minmax(0, 1fr) minmax(56px, auto) 56px; }
        .cr-task-state { grid-column: 2 / 4; grid-row: 2; }
    }
    @container cr-workbench (max-width: 620px) {
        .cr-task-item { grid-template-columns: 20px minmax(0, 1fr) minmax(56px, auto) 56px; }
        .cr-task-state { grid-column: 2 / 4; grid-row: 2; }
    }
</style>
