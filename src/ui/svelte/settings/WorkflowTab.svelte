<script lang="ts">
    import { getSettingsContext } from '../../bridge/context';
    import type { PluginSettings } from '../../../types';
    import SettingItem from './SettingItem.svelte';
    import SettingsSection from './SettingsSection.svelte';
    import Toggle from '../../components/Toggle.svelte';
    import Slider from '../../components/Slider.svelte';
    import Button from '../../components/Button.svelte';
    import Select from '../../components/Select.svelte';
    import LocationsEditor from './LocationsEditor.svelte';
    import { DEFAULT_SETTINGS } from '../../../data/settings-store';

    const { i18n, settingsApplication } = getSettingsContext();
    let settings = $state<PluginSettings>(settingsApplication.getSettings());
    let rebuildState = $state(settingsApplication.getSemanticIndexRebuildState());
    let saveState = $state(settingsApplication.getSaveState());
    const unsubscribe = settingsApplication.subscribeSettings(value => settings = value);
    const unsubscribeRebuild = settingsApplication.subscribeSemanticIndexRebuildState(value => rebuildState = value);
    const unsubscribeSave = settingsApplication.subscribeSaveState(value => saveState = value);
    $effect(() => () => { unsubscribe(); unsubscribeRebuild(); unsubscribeSave(); });
    let locked = $derived(rebuildState.status === 'running' || saveState.status === 'saving');
</script>

<div class="cr-workflow-tab">
    <header class="cr-settings-page-heading"><h2>{i18n.t('settings.tabs.workflow')}</h2><p>{i18n.t('settings.product.notesDesc')}</p></header>
    <LocationsEditor {settings} />
    <SettingsSection title={i18n.t('settings.product.generation')}>
        <SettingItem inlineControl name={i18n.t('settings.product.autoVerify')}>
            <span class="cr-feature-status" class:cr-feature-status--enabled={settings.enableAutoVerify}>{i18n.t(`settings.product.${settings.enableAutoVerify ? 'enabled' : 'disabled'}`)}</span>
            <span class="cr-feature-toggle" title={i18n.t('settings.redesign.autoVerifyCost')}>
                <Toggle checked={settings.enableAutoVerify} ariaLabel={`${i18n.t('settings.product.autoVerify')}；${i18n.t('settings.redesign.autoVerifyCost')}`} onchange={(value) => void settingsApplication.updateSettings({ enableAutoVerify: value })} />
            </span>
        </SettingItem>
        <SettingItem inlineControl name={i18n.t('settings.product.semanticIndex')}>
            <span class="cr-feature-status" class:cr-feature-status--enabled={settings.enableSemanticIndexing}>{i18n.t(`settings.product.${settings.enableSemanticIndexing ? 'enabled' : 'disabled'}`)}</span>
            <span class="cr-feature-toggle" title={i18n.t('settings.advanced.semanticIndexing.enabledDesc')}>
                <Toggle checked={settings.enableSemanticIndexing} disabled={locked} ariaLabel={`${i18n.t('settings.product.semanticIndex')}；${i18n.t('settings.advanced.semanticIndexing.enabledDesc')}`} onchange={(value) => void settingsApplication.updateSettings({ enableSemanticIndexing: value })} />
            </span>
        </SettingItem>
        <SettingItem inlineControl name={i18n.t('settings.product.relatedNotes')}>
            <span class="cr-feature-status" class:cr-feature-status--enabled={settings.enableSemanticIndexing && settings.enableDuplicateDetection}>{i18n.t(`settings.product.${!settings.enableSemanticIndexing ? 'requiresIndex' : settings.enableDuplicateDetection ? 'enabled' : 'disabled'}`)}</span>
            <span class="cr-feature-toggle" title={i18n.t('settings.advanced.semanticIndexing.duplicatesDesc')}>
                <Toggle checked={settings.enableDuplicateDetection} disabled={!settings.enableSemanticIndexing || locked} ariaLabel={i18n.t('settings.product.relatedNotes')} onchange={(value) => void settingsApplication.updateSettings({ enableDuplicateDetection: value })} />
            </span>
        </SettingItem>
    </SettingsSection>
    <details class="cr-settings-disclosure">
        <summary>{i18n.t('settings.displayPreferences.title')}</summary>
        <SettingsSection title={i18n.t('settings.product.retrievalOptions')}>
            <div class="cr-feature-explanations">
                <p><strong>{i18n.t('settings.product.autoVerify')}</strong>：{i18n.t('settings.redesign.autoVerifyCost')}</p>
                <p><strong>{i18n.t('settings.product.semanticIndex')}</strong>：{i18n.t('settings.advanced.semanticIndexing.enabledDesc')}</p>
                <p><strong>{i18n.t('settings.product.relatedNotes')}</strong>：{i18n.t('settings.advanced.semanticIndexing.duplicatesDesc')}</p>
            </div>
            {#if settings.enableSemanticIndexing && settings.enableDuplicateDetection}
                <SettingItem name={i18n.t('settings.similarityThreshold.name')} description={i18n.t('settings.similarityThreshold.desc')}>
                    <Slider value={settings.similarityThreshold} min={0} max={1} step={0.01} disabled={locked} ariaLabel={i18n.t('settings.similarityThreshold.name')} onchange={(value) => void settingsApplication.updateSettings({ similarityThreshold: value })} />
                </SettingItem>
            {/if}
        </SettingsSection>
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
    .cr-workflow-tab { min-width: 0; }
    .cr-feature-status { color: var(--cr-text-muted); white-space: nowrap; font-size: var(--cr-font-sm); }
    .cr-feature-status--enabled { color: var(--cr-interactive-accent); }
    .cr-feature-toggle { display: inline-flex; }
    .cr-feature-explanations { color: var(--cr-text-muted); font-size: var(--cr-font-sm); line-height: var(--cr-line-height-body); }
    .cr-feature-explanations p { margin: var(--cr-space-2) 0; }
</style>
