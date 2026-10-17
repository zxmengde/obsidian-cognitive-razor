<script lang="ts">
    import type { CRType, DefinePreview } from '../../../types';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    const TYPE_ORDER: CRType[] = ['domain', 'issue', 'theory', 'entity', 'mechanism'];
    let { concept, oncreate, types = TYPE_ORDER, disabled = false }: {
        concept: DefinePreview;
        oncreate?: (type: CRType) => void | Promise<void>;
        types?: readonly CRType[];
        disabled?: boolean;
    } = $props();
    const groupId = $props.id();
    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
    let selected = $state<CRType | undefined>();
    let showOther = $state(false);
    let submitting = $state(false);
    const rows = $derived(TYPE_ORDER.filter(type => types.includes(type)).map(type => ({
        type, label: t.crTypes[type],
        name: concept.candidates[type]?.name.chinese.trim() || concept.candidates[type]?.name.english.trim() || '',
        english: concept.candidates[type]?.name.english.trim() || '',
        confidence: concept.candidates[type]?.confidence ?? 0,
    })).sort((a, b) => b.confidence - a.confidence));
    const activeType = $derived(selected && rows.some(row => row.type === selected) ? selected : rows[0]?.type);
    const visibleRows = $derived(showOther ? rows : rows.slice(0, 3));
    $effect(() => { void concept; selected = undefined; showOther = false; });
    async function submit() {
        if (!activeType || disabled || submitting) return;
        submitting = true;
        try { await oncreate?.(activeType); } finally { submitting = false; }
    }
</script>

<div class="cr-type-table">
    <p class="cr-type-table__heading">{t.workbench.product.chooseType}</p>
    <div role="radiogroup" aria-label={t.workbench.createConcept.selectType} class="cr-type-table__choices">
        {#each visibleRows as row (row.type)}
            <label class="cr-type-table__row" class:cr-type-table__row--primary={row.type === activeType}>
                <input type="radio" name={groupId} value={row.type} checked={row.type === activeType} disabled={disabled || submitting} onchange={() => selected = row.type} />
                <span class="cr-type-table__top"><strong>{row.label}</strong><span>{row === rows[0] ? `${t.workbench.product.recommended} · ` : ''}{Math.round(Math.min(100, Math.max(0, row.confidence > 1 ? row.confidence : row.confidence * 100)))}%</span></span>
                <span class="cr-type-table__name">{row.name}{row.english && row.english !== row.name ? ` · ${row.english}` : ''}</span>
            </label>
        {/each}
    </div>
    {#if rows.length > 3}<button class="cr-type-table__other" type="button" aria-expanded={showOther} onclick={() => showOther = !showOther}>{t.workbench.product.otherTypes} {showOther ? '⌃' : '›'}</button>{/if}
    <p class="cr-type-table__hint">{t.workbench.product.typeHint}</p>
    <Button variant="primary" loading={submitting} disabled={disabled || !activeType} onclick={() => void submit()}>{activeType ? ctx.i18n.format('workbench.product.createType', { type: t.crTypes[activeType] }) : t.workbench.createConcept.create}</Button>
</div>

<style>
    .cr-type-table { min-width: 0; }
    .cr-type-table__heading { margin: 0 0 26px; color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
    .cr-type-table__choices { display: flex; flex-direction: column; gap: 8px; }
    .cr-type-table__row { display: flex; flex-direction: column; justify-content: center; gap: 8px; min-height: 62px; padding: 10px 13px; border: 1px solid var(--cr-border); border-radius: var(--cr-field-radius); cursor: pointer; }
    .cr-type-table__row--primary { background: var(--cr-bg-selected); border-color: var(--cr-interactive-accent); }
    .cr-type-table__row:focus-within { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
    .cr-type-table__row input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .cr-type-table__top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .cr-type-table__top strong { font-size: var(--cr-font-base); font-weight: 600; }
    .cr-type-table__top > span { font-size: var(--cr-font-fine); color: var(--cr-text-muted); }
    .cr-type-table__row--primary .cr-type-table__top > span { color: var(--cr-interactive-accent); }
    .cr-type-table__name { overflow-wrap: anywhere; font-size: var(--cr-font-xs); color: var(--cr-text-muted); line-height: 1.5; }
    .cr-type-table__other { margin-top: 14px; padding: 0; height: auto; border: 0; box-shadow: none; background: none; font-size: var(--cr-font-xs); color: var(--cr-text-muted); }
    .cr-type-table__hint { margin: 18px 0 26px; font-size: var(--cr-font-fine); color: var(--cr-text-faint); }
    .cr-type-table :global(.cr-btn-primary) { width: 100%; min-height: 38px; border-radius: var(--cr-field-radius); }
</style>
