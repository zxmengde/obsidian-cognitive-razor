<script lang="ts">
    import { getSettingsContext } from '../../bridge/context';
    import type { DirectoryScheme, PluginSettings, TaskType } from '../../../types';
    import { taskSettingsSummary } from '../../settings-summaries';
    import SettingItem from './SettingItem.svelte';
    import SettingsSection from './SettingsSection.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Toggle from '../../components/Toggle.svelte';
    import Slider from '../../components/Slider.svelte';
    import Button from '../../components/Button.svelte';
    import Select from '../../components/Select.svelte';
    import { DEFAULT_SETTINGS } from '../../../data/settings-store';

    let { onConfigureTask }: { onConfigureTask: (task: TaskType) => void } = $props();
    const { i18n, settingsApplication } = getSettingsContext();
    const directoryKeys: (keyof DirectoryScheme)[] = ['domain', 'issue', 'theory', 'entity', 'mechanism'];
    let directoriesExpanded = $state(false);
    let settings = $state<PluginSettings>(settingsApplication.getSettings());
    let rebuildState = $state(settingsApplication.getSemanticIndexRebuildState());
    let saveState = $state(settingsApplication.getSaveState());
    const unsubscribe = settingsApplication.subscribeSettings(value => settings = value);
    const unsubscribeRebuild = settingsApplication.subscribeSemanticIndexRebuildState(value => rebuildState = value);
    const unsubscribeSave = settingsApplication.subscribeSaveState(value => saveState = value);
    $effect(() => () => { unsubscribe(); unsubscribeRebuild(); unsubscribeSave(); });
    let locked = $derived(rebuildState.status === 'running' || saveState.status === 'saving');
    let cards = $derived(taskSettingsSummary(settings, 'cards'));
    let index = $derived(taskSettingsSummary(settings, 'index'));
</script>

<div class="cr-workflow-tab">
    <header class="cr-settings-page-heading"><h2>{i18n.t('settings.tabs.workflow')}</h2><p>{i18n.t('settings.redesign.notesDesc')}</p></header>
    <SettingsSection title={i18n.t('settings.redesign.createNotes')}>
        <details class="cr-settings-disclosure" bind:open={directoriesExpanded}>
            <summary>{i18n.t('settings.redesign.editDirectories')}</summary>
            <p class="cr-settings-hint">{i18n.t('settings.advanced.directoryScheme.desc')}</p>
            {#each directoryKeys as key (key)}
                <SettingItem name={i18n.t(`crTypes.${key}`)} description={i18n.t(`crTypeDirectories.${key}`)}>
                    <TextInput value={settings.directoryScheme[key]} placeholder={key} ariaLabel={i18n.t(`crTypes.${key}`)} onchange={(value) => void settingsApplication.updateSettings({ directoryScheme: { [key]: value } })} />
                </SettingItem>
            {/each}
        </details>
        {#if !directoriesExpanded}
            <div class="cr-directory-summary">
                {#each directoryKeys as key (key)}<p><span>{i18n.t(`crTypes.${key}`)}</span><span>{settings.directoryScheme[key] || '/'}</span></p>{/each}
            </div>
        {/if}
        <SettingItem inlineControl name={i18n.t('settings.advanced.features.enableAutoVerify')} description={i18n.t('settings.redesign.autoVerifyCost')}>
            <Toggle checked={settings.enableAutoVerify} ariaLabel={i18n.t('settings.advanced.features.enableAutoVerify')} onchange={(value) => void settingsApplication.updateSettings({ enableAutoVerify: value })} />
        </SettingItem>
    </SettingsSection>
    <SettingsSection title={i18n.t('settings.redesign.memoryCards')} description={i18n.t('cards.directoriesDesc')}>
        <SettingItem name={i18n.t('cards.sourceRoot')}><TextInput value={settings.cardsSourceRoot} ariaLabel={i18n.t('cards.sourceRoot')} onchange={(value) => void settingsApplication.updateSettings({ cardsSourceRoot: value })} /></SettingItem>
        <SettingItem name={i18n.t('cards.targetRoot')}><TextInput value={settings.cardsTargetRoot} ariaLabel={i18n.t('cards.targetRoot')} onchange={(value) => void settingsApplication.updateSettings({ cardsTargetRoot: value })} /></SettingItem>
        <p class="cr-settings-hint">{settings.cardsSourceRoot}/子目录/笔记.md → {settings.cardsTargetRoot}/子目录/笔记-decks.md</p>
        <SettingItem name={i18n.t('settings.redesign.cardsModel')} description={`${cards.resolved.providerId || '—'} · ${cards.resolved.model || '—'}${cards.issue ? ' · ' + i18n.t(`settings.redesign.${cards.issue}`) : ''}`}>
            <Button variant="ghost" onclick={() => onConfigureTask('cards')}>{i18n.t('settings.redesign.adjust')}</Button>
        </SettingItem>
        <p class="cr-settings-hint">{i18n.t('settings.redesign.cardsIndependent')}</p>
    </SettingsSection>
    <SettingsSection title={i18n.t('settings.redesign.semanticSearch')}>
        <SettingItem inlineControl name={i18n.t('settings.advanced.semanticIndexing.enabled')} description={i18n.t('settings.advanced.semanticIndexing.enabledDesc')}>
            <Toggle checked={settings.enableSemanticIndexing} disabled={locked} ariaLabel={i18n.t('settings.advanced.semanticIndexing.enabled')} onchange={(value) => void settingsApplication.updateSettings({ enableSemanticIndexing: value })} />
        </SettingItem>
        <SettingItem inlineControl name={i18n.t('settings.advanced.semanticIndexing.duplicates')} description={i18n.t('settings.advanced.semanticIndexing.duplicatesDesc')}>
            <Toggle checked={settings.enableDuplicateDetection} disabled={!settings.enableSemanticIndexing || locked} ariaLabel={i18n.t('settings.advanced.semanticIndexing.duplicates')} onchange={(value) => void settingsApplication.updateSettings({ enableDuplicateDetection: value })} />
        </SettingItem>
        {#if settings.enableSemanticIndexing && settings.enableDuplicateDetection}
            <SettingItem name={i18n.t('settings.similarityThreshold.name')} description={i18n.t('settings.similarityThreshold.desc')}>
                <Slider value={settings.similarityThreshold} min={0} max={1} step={0.01} disabled={locked} ariaLabel={i18n.t('settings.similarityThreshold.name')} onchange={(value) => void settingsApplication.updateSettings({ similarityThreshold: value })} />
            </SettingItem>
        {/if}
        <SettingItem name={i18n.t('settings.redesign.indexModel')} description={`${index.resolved.providerId || '—'} · ${index.resolved.model || '—'}${index.issue ? ' · ' + i18n.t(`settings.redesign.${index.issue}`) : ''}`}>
            <Button variant="ghost" onclick={() => onConfigureTask('index')}>{i18n.t('settings.redesign.adjust')}</Button>
        </SettingItem>
        <p class="cr-settings-hint">{i18n.t('settings.redesign.indexChangeWarning')}</p>
    </SettingsSection>
    <details class="cr-settings-disclosure">
        <summary>{i18n.t('settings.displayPreferences.title')}</summary>
        <SettingItem name={i18n.t('settings.displayPreferences.report')} description={i18n.t('settings.displayPreferences.reportDesc')}>
            <Select value={settings.verifyReportPresentation} ariaLabel={i18n.t('settings.displayPreferences.report')} options={[{value: 'expanded', label: i18n.t('settings.displayPreferences.expanded')}, {value: 'collapsed', label: i18n.t('settings.displayPreferences.collapsed')}]} onchange={(value) => void settingsApplication.updateSettings({ verifyReportPresentation: value as PluginSettings['verifyReportPresentation'] })} />
        </SettingItem>
        <SettingItem name={i18n.t('settings.displayPreferences.filter')} description={i18n.t('settings.displayPreferences.filterDesc')}>
            <Select value={settings.queueDefaultFilter} ariaLabel={i18n.t('settings.displayPreferences.filter')} options={['all', 'active', 'failed'].map(value => ({value, label: i18n.t(`settings.displayPreferences.filters.${value}`)}))} onchange={(value) => void settingsApplication.updateSettings({ queueDefaultFilter: value as PluginSettings['queueDefaultFilter'] })} />
        </SettingItem>
        <SettingItem name={i18n.t('settings.displayPreferences.pageSize')} description={i18n.t('settings.displayPreferences.pageSizeDesc')}>
            <Select value={String(settings.queuePageSize)} ariaLabel={i18n.t('settings.displayPreferences.pageSize')} options={[25, 50, 100].map(value => ({value: String(value), label: String(value)}))} onchange={(value) => void settingsApplication.updateSettings({ queuePageSize: Number(value) as PluginSettings['queuePageSize'] })} />
        </SettingItem>
        <Button variant="ghost" onclick={() => void settingsApplication.updateSettings({ verifyReportPresentation: DEFAULT_SETTINGS.verifyReportPresentation, queueDefaultFilter: DEFAULT_SETTINGS.queueDefaultFilter, queuePageSize: DEFAULT_SETTINGS.queuePageSize })}>{i18n.t('settings.displayPreferences.reset')}</Button>
    </details>
</div>

<style>
    .cr-directory-summary { margin: var(--cr-space-2) 0; }
    .cr-directory-summary p { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: var(--cr-space-2); margin: var(--cr-space-1) 0; color: var(--cr-text-muted); font-size: var(--cr-font-sm); overflow-wrap: anywhere; }
</style>
