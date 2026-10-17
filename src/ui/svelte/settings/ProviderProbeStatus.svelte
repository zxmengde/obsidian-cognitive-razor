<script lang="ts">
    import { untrack } from 'svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import Button from '../../components/Button.svelte';
    import type { ProviderCapabilityStatus, ProviderProbeReadModel } from '../../provider-probe-result';

    let {
        result,
        i18n,
        onretry = undefined,
        retrying = false,
    }: {
        result: ProviderProbeReadModel;
        i18n: { t: (key: string) => string };
        onretry?: (() => void) | undefined;
        retrying?: boolean;
    } = $props();

    const alertLevel = $derived(
        result.outcome === 'success'
            ? 'success'
            : result.outcome === 'partial'
                ? 'warning'
                : result.outcome === 'uncertain'
                    ? 'warning'
                    : 'error'
    );

    function statusLabel(status: ProviderCapabilityStatus): string {
        return i18n.t(`settings.provider.probe.status.${status}`);
    }

    const detailsToggleLabels = untrack(() => ({
        expand: i18n.t('common.details.expand'),
        collapse: i18n.t('common.details.collapse'),
    }));
</script>

<div class="cr-provider-probe-status">
    <InlineAlert
        level={alertLevel}
        message={i18n.t(result.target && result.target.scope !== 'connection' ? `settings.redesign.testOutcomes.${result.outcome}` : `settings.provider.probe.outcome.${result.outcome}`)}
        {detailsToggleLabels}
    />
    {#if result.target}
        <p class="cr-provider-probe-status__target">{i18n.t('settings.product.testedScope')} · {i18n.t(result.target.scope === 'connection' ? 'settings.product.connectionScope' : `settings.redesign.tasks.${result.target.scope}`)}{#if result.target.temporaryProvider}<span> · {i18n.t('settings.product.temporaryProvider')}</span>{/if}<br />{result.target.providerId} · {result.target.model || '—'}{#if result.target.scope === 'index'}<span>&nbsp;·&nbsp;</span>{i18n.t('settings.product.requestedDimension')}: {result.target.requestedDimensions ?? i18n.t('settings.product.automatic')}{/if}</p>
    {/if}
    {#if result.embeddingProbe && result.target?.scope === 'index' && result.embeddingProbe.actualDimensions !== undefined}
        <p class="cr-provider-probe-status__target">{i18n.t('settings.product.actualDimension')}: {result.embeddingProbe.actualDimensions}</p>
    {:else if result.embeddingProbe && result.target?.scope !== 'index'}
        <p class="cr-provider-probe-status__target">{i18n.t('settings.provider.probe.embedding')} · {result.embeddingProbe.model} · {i18n.t('settings.product.requestedDimension')}: {result.embeddingProbe.requestedDimensions ?? i18n.t('settings.product.automatic')}{#if result.embeddingProbe.actualDimensions !== undefined} · {i18n.t('settings.product.actualDimension')}: {result.embeddingProbe.actualDimensions}{/if}</p>
    {/if}
    <div class="cr-provider-probe-status__capabilities">
        <div class="cr-provider-probe-status__row">
            <span>{i18n.t('settings.provider.probe.chat')}</span>
            <span>{statusLabel(result.chat)}</span>
        </div>
        <div class="cr-provider-probe-status__row">
            <span>{i18n.t('settings.provider.probe.embedding')}</span>
            <span>{statusLabel(result.embedding)}</span>
        </div>
    </div>
    {#if result.outcome === 'uncertain'}
        <p class="cr-provider-probe-status__hint">
            {i18n.t('settings.provider.probe.uncertainHint')}
        </p>
        {#if onretry}
            <Button
                variant="secondary"
                size="sm"
                loading={retrying}
                disabled={retrying}
                onclick={onretry}
            >
                {i18n.t('settings.provider.probe.retry')}
            </Button>
        {/if}
    {/if}
</div>

<style>
    .cr-provider-probe-status__target { margin: 0; color: var(--cr-text-muted); font-size: var(--cr-font-sm); overflow-wrap: anywhere; }
    .cr-provider-probe-status {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-provider-probe-status__capabilities {
        display: grid;
        gap: var(--cr-space-1);
        padding: 0 var(--cr-space-3);
        color: var(--text-muted);
        font-size: var(--cr-font-sm);
    }

    .cr-provider-probe-status__row {
        display: flex;
        justify-content: space-between;
        gap: var(--cr-space-2);
    }

    .cr-provider-probe-status__row span:last-child {
        color: var(--text-normal);
    }

    .cr-provider-probe-status__hint {
        margin: 0;
        padding: 0 var(--cr-space-3);
        color: var(--text-warning);
        font-size: var(--cr-font-sm);
    }

    .cr-provider-probe-status :global(button) {
        align-self: flex-start;
        margin-inline-start: var(--cr-space-3);
    }
</style>
