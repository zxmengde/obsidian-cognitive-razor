<!--
  DuplicateItem.svelte — 重复对列表项

  一行给出两篇笔记、类型与相似度，第二行是合并稿状态和操作。
  相似度只用数字表示：它只是候选依据，不该用红橙色暗示“危险”。
-->
<script lang="ts">
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import type { DuplicatePair } from '../../../types';

    let {
        pair,
        nameA,
        nameB,
        mergeState = undefined,
        dismissing = false,
        ondismiss,
        onmerge,
    }: {
        pair: DuplicatePair;
        nameA: string;
        nameB: string;
        mergeState?: 'generating' | 'ready';
        dismissing?: boolean;
        ondismiss: (pair: DuplicatePair) => void;
        onmerge: (pair: DuplicatePair) => void;
    } = $props();

    const ctx = getWorkbenchContext();
    const d = ctx.i18n.messages.workbench.duplicates;

    let percent = $derived(Math.round(pair.similarity * 100));
    let mergeLabel = $derived(mergeState === 'ready' ? d.reviewDraft : mergeState === 'generating' ? d.viewProgress : d.merge);
</script>

<div
    class="cr-dup-item"
    role="listitem"
    aria-label={ctx.i18n.format('workbench.duplicates.ariaLabel', { nameA, nameB, percent })}
>
    <div class="cr-dup-item__names">
        <span class="cr-dup-item__name">{nameA}</span>
        <span class="cr-dup-item__vs" aria-hidden="true">·</span>
        <span class="cr-dup-item__name">{nameB}</span>
    </div>
    <div class="cr-dup-item__row">
        <span class="cr-dup-item__meta">
            {ctx.i18n.messages.crTypes[pair.type]} · {percent}%{#if mergeState} · <span class:is-ready={mergeState === 'ready'}>{mergeState === 'ready' ? d.stateReady : d.stateGenerating}</span>{/if}
        </span>
        <div class="cr-dup-item__actions">
            <Button variant={mergeState === 'ready' ? 'primary' : 'secondary'} size="sm" ariaLabel={ctx.i18n.format('workbench.duplicates.mergeAria', { nameA, nameB })} onclick={(e: MouseEvent) => { e.stopPropagation(); onmerge(pair); }}>
                {mergeLabel}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                loading={dismissing}
                disabled={dismissing}
                ariaLabel={ctx.i18n.format('workbench.duplicates.dismissAria', { nameA, nameB })}
                onclick={(e: MouseEvent) => { e.stopPropagation(); if (!dismissing) ondismiss(pair); }}
            >
                {d.dismiss}
            </Button>
        </div>
    </div>
</div>

<style>
    .cr-dup-item {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
        padding: var(--cr-space-2) 0;
        border-bottom: 1px solid var(--cr-border);
    }

    .cr-dup-item__names {
        display: flex;
        align-items: baseline;
        gap: var(--cr-space-1);
        min-width: 0;
        font-size: var(--cr-font-sm);
        color: var(--cr-text-normal);
    }

    .cr-dup-item__name {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .cr-dup-item__vs {
        flex-shrink: 0;
        color: var(--cr-text-faint);
    }

    .cr-dup-item__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cr-space-2);
        flex-wrap: wrap;
    }

    .cr-dup-item__meta {
        font-size: var(--cr-font-xs);
        color: var(--cr-text-muted);
        font-variant-numeric: tabular-nums;
    }

    .cr-dup-item__meta .is-ready {
        color: var(--cr-text-accent);
    }

    .cr-dup-item__actions {
        display: flex;
        gap: var(--cr-space-1);
    }
</style>
