<script lang="ts">
    import { onDestroy } from 'svelte';
    import { getSettingsContext } from '../../bridge/context';
    import { taskSettingsSummary } from '../../settings-summaries';
    import type { PluginSettings, TaskType } from '../../../types';
    import TaskModelCard from './TaskModelCard.svelte';
    import Button from '../../components/Button.svelte';
    import ProviderProbeStatus from './ProviderProbeStatus.svelte';
    import { toProviderProbeReadModel, type ProviderProbeReadModel } from '../../provider-probe-result';

    let { taskType, onBack }: { taskType: TaskType; onBack: () => void } = $props();
    const { i18n, settingsApplication } = getSettingsContext();
    let settings = $state<PluginSettings>(settingsApplication.getSettings());
    const unsubscribe = settingsApplication.subscribeSettings(value => settings = value);
    onDestroy(unsubscribe);
    let summary = $derived(taskSettingsSummary(settings, taskType));
    let testing = $state(false);
    let testResult = $state<ProviderProbeReadModel | undefined>();
    let testedSignature = $state('');
    let controller: AbortController | undefined;
    const signature = $derived(JSON.stringify(summary.resolved));
    $effect(() => {
        if (testedSignature && testedSignature !== signature) { testResult = undefined; controller?.abort(); testedSignature = ''; }
    });
    onDestroy(() => controller?.abort());
    async function testTask(attemptReason: 'initial' | 'manual-retry' = 'initial') {
        if (testing || summary.issue || !summary.resolved.providerSnapshot) return;
        const snapshot = structuredClone(summary.resolved);
        const config = snapshot.providerSnapshot!;
        const requestSignature = JSON.stringify(snapshot);
        const abort = new AbortController(); controller = abort;
        testing = true; testResult = undefined; testedSignature = requestSignature;
        const target = { scope: taskType, providerId: snapshot.providerId, model: snapshot.model, ...(taskType === 'index' && snapshot.embeddingDimension !== undefined ? { requestedDimensions: snapshot.embeddingDimension } : {}) };
        try {
            const result = await settingsApplication.testProvider({ providerId: snapshot.providerId, configOverride: config, taskType, taskConfig: snapshot, attemptReason }, abort.signal);
            if (!abort.signal.aborted && JSON.stringify(summary.resolved) === requestSignature) testResult = toProviderProbeReadModel(result, config, target);
        } catch {
            if (!abort.signal.aborted) testResult = toProviderProbeReadModel({ ok: false, error: { code: 'E500_INTERNAL_ERROR', message: '' } }, config, target);
        } finally { if (controller === abort) { controller = undefined; testing = false; } }
    }
</script>

<section class="cr-task-details" aria-labelledby={`cr-task-detail-heading-${taskType}`}>
    <nav class="cr-task-details__breadcrumb" aria-label={i18n.t('settings.taskDetails.breadcrumb')}>
        <button class="cr-task-details__back" aria-label={i18n.t('settings.taskDetails.backToOverview')} onclick={onBack}>
            {i18n.t('settings.tabs.providers')}
        </button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{i18n.t(`settings.redesign.tasks.${taskType}`)}</span>
    </nav>
    <header class="cr-settings-page-heading">
        <h2 id={`cr-task-detail-heading-${taskType}`} tabindex="-1">{i18n.t(`settings.redesign.tasks.${taskType}`)}</h2>
        <p>{i18n.t('settings.taskDetails.taskOnly')}</p>
    </header>
    <TaskModelCard {taskType} config={settings.taskModels[taskType]}
        providers={settings.providers} defaultProviderId={settings.defaultProviderId}
        resolved={summary.resolved} isDefault={settingsApplication.isTaskModelDefault(taskType)} {i18n}
        onUpdate={(type, partial) => void settingsApplication.updateTaskModel(type, partial)}
        onReset={(type) => void settingsApplication.resetTaskModel(type)} />
    {#if taskType === 'index'}<p class="cr-settings-hint">{i18n.t('settings.redesign.indexChangeWarning')}</p>{/if}
    <div class="cr-task-details__probe">
        <Button variant="secondary" loading={testing} disabled={Boolean(summary.issue)} onclick={() => void testTask()}>{i18n.t('settings.product.taskProbe')}</Button>
        <p class="cr-settings-hint">{i18n.t('settings.product.taskProbeHint')}</p>
        {#if testResult}<ProviderProbeStatus result={testResult} {i18n} retrying={testing} onretry={() => void testTask('manual-retry')} />{/if}
    </div>
</section>

<style>
    .cr-task-details__probe { padding-top: var(--cr-space-5); border-top: 1px solid var(--cr-border); margin-top: var(--cr-space-5); }
    .cr-task-details { min-width: 0; }
    .cr-task-details__breadcrumb { display: flex; align-items: center; flex-wrap: wrap; gap: var(--cr-space-2); margin-bottom: var(--cr-space-5); color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
    .cr-task-details__back { padding: 0; height: auto; border: 0; border-radius: 0; background: transparent; box-shadow: none; color: var(--cr-interactive-accent); font: inherit; cursor: pointer; }
    .cr-task-details__back:hover { text-decoration: underline; }
</style>
