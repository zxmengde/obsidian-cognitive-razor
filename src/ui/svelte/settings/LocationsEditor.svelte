<script lang="ts">
    import { untrack } from 'svelte';
    import { getSettingsContext } from '../../bridge/context';
    import { CR_TYPES, type PluginSettings } from '../../../types';
    import { locationCandidate, locationChanges, locationDraft, locationFingerprint, unifiedLocationDraft, type LocationSettings } from '../../settings-locations';
    import SettingsSection from './SettingsSection.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Select from '../../components/Select.svelte';
    import Button from '../../components/Button.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';

    let { settings }: { settings: PluginSettings } = $props();
    const { i18n, settingsApplication } = getSettingsContext();
    let editing = $state(false);
    let saving = $state(false);
    let draft = $state(untrack(() => locationDraft(settings)));
    let candidate = $state<LocationSettings | undefined>();
    let baseline = $state<LocationSettings | undefined>();
    let feedback = $state('');
    let current = $derived(locationDraft(settings));
    let exampleEligible = $derived(settings.directoryScheme.mechanism.startsWith(`${settings.cardsSourceRoot}/`));
    let exampleSuffix = $derived(exampleEligible ? settings.directoryScheme.mechanism.slice(settings.cardsSourceRoot.length + 1) + '/' : '');
    const text = (key: string) => i18n.t(`settings.locations.${key}`);
    const detailsToggleLabels = { expand: i18n.t('common.details.expand'), collapse: i18n.t('common.details.collapse') };

    function openEditor() {
        if (saving) return;
        draft = locationDraft(settings); baseline = { directoryScheme: { ...settings.directoryScheme }, cardsSourceRoot: settings.cardsSourceRoot, cardsTargetRoot: settings.cardsTargetRoot };
        candidate = undefined; feedback = ''; editing = true;
    }
    function setMode(mode: string) {
        if (mode === draft.mode) return;
        draft = mode === 'unified' ? unifiedLocationDraft(draft)
            : { ...draft, mode: 'custom', directories: locationCandidate(draft)?.directoryScheme ?? { ...settings.directoryScheme } };
        candidate = undefined;
    }
    function preview() {
        candidate = locationCandidate(draft); feedback = candidate ? '' : text('invalid');
    }
    async function save() {
        if (!candidate || !baseline || saving) return;
        if (locationFingerprint(settings) !== locationFingerprint(baseline)) { feedback = text('conflict'); candidate = undefined; return; }
        saving = true;
        try {
            const result = await settingsApplication.updateSettings(candidate);
            if (result.ok) { editing = false; candidate = undefined; feedback = ''; }
            else feedback = text('saveFailed');
        } catch { feedback = text('saveFailed'); } finally { saving = false; }
    }
</script>

<SettingsSection title={text('title')}>
    {#snippet actions()}<button id="cr-locations-edit" class="cr-location-edit" type="button" disabled={saving} onclick={openEditor}>{text('edit')} ›</button>{/snippet}
    {#if !editing}
        <div class="cr-location-heading"><strong>{text('knowledge')}</strong><span>{current.mode === 'unified' ? settings.cardsSourceRoot : text('custom')}</span></div>
        <p class="cr-settings-hint">{text(current.mode === 'unified' ? 'unifiedHint' : 'customHint')}</p>
        <dl class="cr-location-paths">{#each CR_TYPES as type (type)}<dt>{i18n.t(`crTypes.${type}`)}</dt><dd>{settings.directoryScheme[type]}{#if !settings.directoryScheme[type].startsWith(`${settings.cardsSourceRoot}/`)}<span class="cr-location-outside">{text('outside')}</span>{/if}</dd>{/each}</dl>
        {#if current.mode === 'custom'}<div class="cr-location-source"><strong>{text('source')}</strong><span>{settings.cardsSourceRoot}</span></div>{/if}
        <div class="cr-location-destination"><strong>{text('destination')}</strong><p>{settings.cardsTargetRoot}</p></div>
        {#if exampleEligible}<div class="cr-location-example"><strong>{text('example')}</strong><p>{settings.cardsSourceRoot}/{exampleSuffix}{text('exampleNote')}.md → {settings.cardsTargetRoot}/{exampleSuffix}{text('exampleNote')}-decks.md</p></div>{:else}<p class="cr-location-outside">{text('outsideExample')}</p>{/if}
        <p class="cr-settings-hint">{text('warning')}</p>
    {:else}
        <div class="cr-location-editor">
            <p class="cr-settings-hint">{text('editHint')}</p>
            {#if feedback}<InlineAlert level="error" message={feedback} {detailsToggleLabels} />{/if}
            {#if candidate && baseline}
                <div class="cr-location-preview" role="region" aria-label={text('preview')}>
                    <p>{text('previewHint')}</p>
                    {#each locationChanges(baseline, candidate) as change (change.key)}
                        <div class="cr-location-change"><strong>{CR_TYPES.some(type => type === change.key) ? i18n.t(`crTypes.${change.key}`) : text(change.key === 'cardsSourceRoot' ? 'source' : 'destination')}</strong><span>{text('before')} · {change.before}</span><span>{text('after')} · {change.after}</span></div>
                    {/each}
                </div>
                <div class="cr-location-actions"><Button variant="secondary" disabled={saving} onclick={() => candidate = undefined}>{i18n.t('common.edit')}</Button><Button loading={saving} onclick={() => void save()}>{text('save')}</Button><Button variant="ghost" disabled={saving} onclick={() => editing = false}>{text('cancel')}</Button></div>
            {:else}
                <label>{text('mode')}<Select value={draft.mode} options={[{value:'unified',label:text('unified')},{value:'custom',label:text('custom')}]} onchange={setMode} /></label>
                <label>{text(draft.mode === 'unified' ? 'root' : 'source')}<TextInput value={draft.knowledgeRoot} ariaLabel={text(draft.mode === 'unified' ? 'root' : 'source')} onchange={value => draft.knowledgeRoot = value} /></label>
                {#each CR_TYPES as type (type)}<label>{i18n.t(`crTypes.${type}`)}<TextInput value={draft.directories[type]} ariaLabel={i18n.t(`crTypes.${type}`)} onchange={value => draft.directories[type] = value} /></label>{/each}
                <label>{text('destination')}<TextInput value={draft.destination} ariaLabel={text('destination')} onchange={value => draft.destination = value} /></label>
                <div class="cr-location-actions"><Button onclick={preview}>{text('preview')}</Button><Button variant="ghost" onclick={() => editing = false}>{text('cancel')}</Button></div>
            {/if}
        </div>
    {/if}
</SettingsSection>

<style>
    .cr-location-outside { display: block; color: var(--cr-status-warning); font-size: var(--cr-font-xs); margin-top: var(--cr-space-1); }
    .cr-location-edit { height: auto; padding: 0; border: 0; box-shadow: none; background: transparent; color: var(--cr-interactive-accent); font: inherit; font-size: var(--cr-font-xs); }
    .cr-location-heading, .cr-location-source { display: flex; justify-content: space-between; gap: var(--cr-space-3); flex-wrap: wrap; }
    .cr-location-heading span { color: var(--cr-interactive-accent); }
    .cr-location-paths { display: grid; grid-template-columns: minmax(70px, 1fr) minmax(0, 5fr); gap: var(--cr-space-2) var(--cr-space-4); color: var(--cr-text-muted); font-size: var(--cr-font-sm); margin: var(--cr-space-4) 0; }
    .cr-location-paths dd { margin: 0; overflow-wrap: anywhere; }
    .cr-location-destination { border-top: 1px solid var(--cr-border); padding-top: var(--cr-space-5); margin-top: var(--cr-space-4); }
    .cr-location-destination p { color: var(--cr-text-muted); }
    .cr-location-example { background: var(--cr-bg-secondary); padding: var(--cr-space-3); border-radius: var(--cr-field-radius); margin: var(--cr-space-4) 0; }
    .cr-location-example strong { color: var(--cr-interactive-accent); font-weight: 500; }
    .cr-location-example p { color: var(--cr-text-muted); font-size: var(--cr-font-sm); overflow-wrap: anywhere; margin-bottom: 0; }
    .cr-location-editor label { display: flex; flex-direction: column; gap: var(--cr-space-2); margin: var(--cr-space-3) 0; color: var(--cr-text-muted); }
    .cr-location-actions { display: flex; flex-wrap: wrap; gap: var(--cr-space-2); margin-top: var(--cr-space-4); }
    .cr-location-change { display: flex; flex-direction: column; gap: var(--cr-space-1); padding: var(--cr-space-3) 0; border-bottom: 1px solid var(--cr-border); overflow-wrap: anywhere; }
    .cr-location-change span { color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
</style>
