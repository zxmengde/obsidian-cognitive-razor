<script lang="ts">
    import { onDestroy } from 'svelte';
    import { getSettingsContext } from '../../bridge/context';
    import { taskSettingsSummary } from '../../settings-summaries';
    import type { PluginSettings, TaskType } from '../../../types';
    import TaskModelCard from './TaskModelCard.svelte';

    let { taskType, onBack }: { taskType: TaskType; onBack: () => void } = $props();
    const { i18n, settingsApplication } = getSettingsContext();
    let settings = $state<PluginSettings>(settingsApplication.getSettings());
    const unsubscribe = settingsApplication.subscribeSettings(value => settings = value);
    onDestroy(unsubscribe);
    let summary = $derived(taskSettingsSummary(settings, taskType));
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
</section>

<style>
    .cr-task-details { min-width: 0; }
    .cr-task-details__breadcrumb { display: flex; align-items: center; flex-wrap: wrap; gap: var(--cr-space-2); margin-bottom: var(--cr-space-5); color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
    .cr-task-details__back { padding: 0; height: auto; border: 0; border-radius: 0; background: transparent; box-shadow: none; color: var(--cr-interactive-accent); font: inherit; cursor: pointer; }
    .cr-task-details__back:hover { text-decoration: underline; }
</style>
