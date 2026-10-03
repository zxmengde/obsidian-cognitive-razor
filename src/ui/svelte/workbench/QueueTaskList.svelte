<script lang="ts">
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import type { TaskRecord, TaskState } from '../../../types';
    import { formatStandardName } from '../../../core/naming-utils';
    import { queueTaskFeedback } from '../../queue-task-feedback';
    import { stageLabel } from '../../stage-labels';

    let {
        tasks,
        selectedIds,
        onselect,
        onretry,
        oncancel,
        onremove,
        disabled = false,
        selectable = false,
    }: {
        tasks: TaskRecord[];
        selectedIds: Set<string>;
        onselect: (taskId: string, selected: boolean) => void;
        onretry: (taskId: string) => void;
        oncancel: (taskId: string) => void;
        onremove: (taskId: string) => void;
        disabled?: boolean;
        selectable?: boolean;
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


</script>

<div class="cr-task-list" role="list">
    {#each tasks as task (task.id)}
        {@const displayName = getTaskDisplayName(task)}
        {@const failure = queueTaskFeedback(task, t.workbench.notifications.unknownFailure)}
        <div class="cr-task-item cr-task-item--{task.state}" class:cr-task-item--selectable={selectable} role="listitem">
            {#if selectable}<input class="cr-task-select" type="checkbox" checked={selectedIds.has(task.id)} onchange={(event) => onselect(task.id, event.currentTarget.checked)} aria-label={`${t.workbench.queueStatus.selectTask} ${displayName}`} />{/if}
            <span class="cr-task-name" title={task.stageId === 'cards' ? `${displayName} → ${task.payload.targetPath ?? ''}` : displayName}>{displayName}</span>
            <span class="cr-task-actions">
                {#if task.state === 'pending' || task.state === 'running'}<Button variant="ghost" size="sm" disabled={disabled} onclick={() => oncancel(task.id)} ariaLabel={t.workbench.queueStatus.cancel}>{t.workbench.queueStatus.cancel}</Button>
                {:else if selectable}<Button variant="ghost" size="icon" disabled={disabled} onclick={() => onremove(task.id)} ariaLabel={t.workbench.queueStatus.delete}><Icon name="trash-2" size={16} /></Button>{/if}
            </span>
            <div class="cr-task-meta">
                <span class="cr-task-stage">{stageLabel(task.stageId, t)}</span>
                <span class="cr-task-state cr-task-state--{task.state}">{failure?.uncertain ? t.workbench.product.unknown : getStateLabel(task.state)}</span>
            </div>
            {#if task.state === 'running'}<div class="cr-task-progress" role="status" aria-label={t.workbench.queueStatus.running}><span></span></div>{/if}
            {#if failure}
                <details class="cr-task-feedback">
                    <summary>{t.workbench.queueStatus.compactDetails} ›</summary>
                    <div class="cr-task-resolution" class:cr-task-resolution--uncertain={failure.uncertain}>
                        {#if failure.uncertain}<strong>{t.workbench.product.confirmLast}</strong><p>{t.workbench.product.unknownHint}</p>{:else}<p>{failure.message}</p>{/if}
                        <details class="cr-task-technical"><summary>{t.workbench.product.technicalDetails} ›</summary>
                            {#if failure.upstreamStatus !== undefined}<p>{ctx.i18n.format('workbench.queueStatus.upstreamFailure', {status: failure.upstreamStatus})}</p>
                            {:else if failure.requestTimeoutMs !== undefined}<p>{ctx.i18n.format('workbench.queueStatus.localTimeout', {seconds: failure.requestTimeoutMs / 1000})}</p>
                            {:else}<p>{failure.message}</p>{/if}
                            {#if failure.elapsedSeconds !== undefined}<p>{ctx.i18n.format('workbench.queueStatus.elapsedRun', {seconds: failure.elapsedSeconds})}</p>{/if}
                            <p>{failure.uncertain ? t.workbench.queueStatus.uncertainNextStep : failure.details || t.workbench.queueStatus.failureNextStep}</p>
                        </details>
                        {#if task.stageId !== 'cards' && (task.state === 'failed' || task.state === 'interrupted')}<Button variant="ghost" size="sm" disabled={disabled} onclick={() => onretry(task.id)} ariaLabel={t.workbench.queueStatus.retry}>{failure.uncertain ? t.workbench.product.resend : t.workbench.queueStatus.retry}</Button>{/if}
                    </div>
                </details>
            {/if}
            {#if task.stageId === 'cards' && task.state === 'completed'}<span class="cr-task-detail">{ctx.i18n.format('cards.completed', {path: task.payload.targetPath ?? task.filePath ?? ''})}</span>
            {:else if task.stageId === 'cards' && (task.state === 'failed' || task.state === 'interrupted')}<span class="cr-task-detail">{t.cards.regenerateHint}</span>{/if}
        </div>
    {/each}
</div>
<style>
    .cr-task-list { display: flex; flex-direction: column; }
    .cr-task-item { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: baseline; gap: 10px 12px; padding: 14px 0 20px; border-bottom: 1px solid var(--cr-border); }
    .cr-task-item:first-child { padding-top: 0; }
    .cr-task-item:last-child { border-bottom: 0; }
    .cr-task-item--selectable { grid-template-columns: 20px minmax(0,1fr) auto; }
    .cr-task-select { width: 16px; height: 16px; margin: 0; }
    .cr-task-name { color: var(--cr-text-normal); font-size: var(--cr-font-base); font-weight: 600; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
    .cr-task-actions { justify-self: end; }
    .cr-task-actions :global(button) { min-height: 0; padding: 0; font-size: var(--cr-font-xs); }
    .cr-task-meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; color: var(--cr-text-muted); font-size: var(--cr-font-xs); min-width: 0; }
    .cr-task-item--selectable .cr-task-meta, .cr-task-item--selectable .cr-task-feedback, .cr-task-item--selectable .cr-task-progress { grid-column: 2 / -1; }
    .cr-task-stage::after { content: ' ·'; }
    .cr-task-state--running { color: var(--cr-interactive-accent); }
    .cr-task-feedback { grid-column: 1 / -1; min-width: 0; font-size: var(--cr-font-xs); color: var(--cr-text-muted); }
    .cr-task-feedback summary { cursor: pointer; list-style: none; padding: 0; font-size: var(--cr-font-xs); }
    .cr-task-resolution { margin-top: 12px; padding: 12px; background: var(--cr-bg-secondary); border-radius: var(--cr-field-radius); display: flex; align-items: baseline; flex-wrap: wrap; gap: 14px 12px; }
    .cr-task-resolution--uncertain { background: var(--cr-overlay-warning-10); }
    .cr-task-resolution > strong { width: 100%; font-size: var(--cr-font-sm); color: var(--cr-status-warning); }
    .cr-task-resolution > p { width: 100%; }
    .cr-task-resolution p { margin: 0; line-height: 1.75; overflow-wrap: anywhere; }
    .cr-task-resolution :global(.cr-btn-ghost) { margin-left: auto; padding: 0; min-height: 28px; color: var(--cr-interactive-accent); font-size: var(--cr-font-xs); }
    .cr-task-technical { min-width: 0; flex: 1; }
    .cr-task-technical[open] { flex-basis: 100%; }
    .cr-task-technical p { margin-top: 12px; }
    .cr-task-detail { grid-column: 1 / -1; color: var(--cr-text-muted); font-size: var(--cr-font-xs); overflow-wrap: anywhere; }
    .cr-task-progress { grid-column: 1 / -1; height: 3px; background: var(--cr-bg-selected); overflow: hidden; margin: 4px 0; }
    .cr-task-progress span { display: block; width: 24%; height: 100%; background: var(--cr-interactive-accent); animation: cr-task-progress 1.6s ease-in-out infinite alternate; }
    @keyframes cr-task-progress { to { transform: translateX(300%); } }
    @media (prefers-reduced-motion: reduce) { .cr-task-progress span { animation: none; width: 100%; opacity: 0.5; } }
    @container cr-workbench (max-width: 620px) { .cr-task-meta { white-space: normal; overflow-wrap: anywhere; } }
</style>
