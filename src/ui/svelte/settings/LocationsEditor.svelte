<!--
  保存位置子页面。查看 → 编辑草稿 → 预览全部变化 → 确认保存；未确认前不写任何设置。
  标记沿用 Obsidian 原生设置行的类名，外观与宿主一致。
-->
<script lang="ts">
    import { onDestroy, untrack } from 'svelte';
    import { getSettingsContext } from '../../bridge/context';
    import { CR_TYPES, type PluginSettings } from '../../../types';
    import { locationCandidate, locationChanges, locationDraft, unifiedLocationDraft, type LocationSettings } from '../../settings-locations';

    const { i18n, settingsApplication } = getSettingsContext();
    let settings = $state<PluginSettings>(settingsApplication.getSettings());
    onDestroy(settingsApplication.subscribeSettings(value => settings = value));

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

    function openEditor() {
        if (saving) return;
        draft = locationDraft(settings);
        baseline = { directoryScheme: { ...settings.directoryScheme }, cardsSourceRoot: settings.cardsSourceRoot, cardsTargetRoot: settings.cardsTargetRoot };
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
        saving = true;
        try {
            const result = await settingsApplication.updateSettings(candidate);
            if (result.ok) { editing = false; candidate = undefined; feedback = ''; }
            else feedback = text('saveFailed');
        } catch { feedback = text('saveFailed'); } finally { saving = false; }
    }
    const changeLabel = (key: string) => CR_TYPES.some(type => type === key)
        ? i18n.t(`crTypes.${key}`) : text(key === 'cardsSourceRoot' ? 'source' : 'destination');
</script>

<div class="cr-locations">
    {#if !editing}
        <div class="setting-item">
            <div class="setting-item-info">
                <div class="setting-item-name">{text('knowledge')}</div>
                <div class="setting-item-description">{current.mode === 'unified' ? `${settings.cardsSourceRoot} · ${text('unifiedHint')}` : `${text('custom')} · ${text('customHint')}`}</div>
            </div>
            <div class="setting-item-control"><button id="cr-locations-edit" type="button" disabled={saving} onclick={openEditor}>{text('edit')}</button></div>
        </div>
        {#each CR_TYPES as type (type)}
            <div class="setting-item cr-locations__path">
                <div class="setting-item-info">
                    <div class="setting-item-name">{i18n.t(`crTypes.${type}`)}</div>
                    <div class="setting-item-description">{settings.directoryScheme[type]}</div>
                    {#if !settings.directoryScheme[type].startsWith(`${settings.cardsSourceRoot}/`)}<div class="setting-item-description mod-warning">{text('outside')}</div>{/if}
                </div>
            </div>
        {/each}
        {#if current.mode === 'custom'}
            <div class="setting-item"><div class="setting-item-info"><div class="setting-item-name">{text('source')}</div><div class="setting-item-description">{settings.cardsSourceRoot}</div></div></div>
        {/if}
        <div class="setting-item">
            <div class="setting-item-info">
                <div class="setting-item-name">{text('destination')}</div>
                <div class="setting-item-description">{settings.cardsTargetRoot}</div>
                {#if exampleEligible}
                    <div class="setting-item-description">{text('example')}：{settings.cardsSourceRoot}/{exampleSuffix}{text('exampleNote')}.md → {settings.cardsTargetRoot}/{exampleSuffix}{text('exampleNote')}-decks.md</div>
                {:else}
                    <div class="setting-item-description mod-warning">{text('outsideExample')}</div>
                {/if}
            </div>
        </div>
        <p class="setting-item-description cr-locations__note">{text('warning')}</p>
    {:else if candidate && baseline}
        <div class="cr-locations__preview" role="region" aria-label={text('preview')}>
            <p class="setting-item-description">{text('previewHint')}</p>
            {#each locationChanges(baseline, candidate) as change (change.key)}
                <div class="setting-item">
                    <div class="setting-item-info">
                        <div class="setting-item-name">{changeLabel(change.key)}</div>
                        <div class="setting-item-description">{text('before')} · {change.before}</div>
                        <div class="setting-item-description" class:cr-locations__changed={change.before !== change.after}>{text('after')} · {change.after}</div>
                    </div>
                </div>
            {/each}
            {#if feedback}<p class="mod-warning" role="alert">{feedback}</p>{/if}
            <div class="cr-locations__actions">
                <button type="button" disabled={saving} onclick={() => editing = false}>{text('cancel')}</button>
                <button type="button" disabled={saving} onclick={() => candidate = undefined}>{i18n.t('common.edit')}</button>
                <button type="button" class="mod-cta" disabled={saving} aria-busy={saving} onclick={() => void save()}>{text('save')}</button>
            </div>
        </div>
    {:else}
        <p class="setting-item-description">{text('editHint')}</p>
        {#if feedback}<p class="mod-warning" role="alert">{feedback}</p>{/if}
        <div class="setting-item">
            <div class="setting-item-info"><label class="setting-item-name" for="cr-location-mode">{text('mode')}</label></div>
            <div class="setting-item-control">
                <select id="cr-location-mode" class="dropdown" value={draft.mode} onchange={(event) => setMode(event.currentTarget.value)}>
                    <option value="unified">{text('unified')}</option>
                    <option value="custom">{text('custom')}</option>
                </select>
            </div>
        </div>
        <div class="setting-item">
            <div class="setting-item-info"><label class="setting-item-name" for="cr-location-root">{text(draft.mode === 'unified' ? 'root' : 'source')}</label></div>
            <div class="setting-item-control"><input id="cr-location-root" type="text" spellcheck="false" value={draft.knowledgeRoot} oninput={(event) => draft.knowledgeRoot = event.currentTarget.value} /></div>
        </div>
        {#each CR_TYPES as type (type)}
            <div class="setting-item">
                <div class="setting-item-info"><label class="setting-item-name" for={`cr-location-${type}`}>{i18n.t(`crTypes.${type}`)}</label></div>
                <div class="setting-item-control"><input id={`cr-location-${type}`} type="text" spellcheck="false" value={draft.directories[type]} oninput={(event) => draft.directories[type] = event.currentTarget.value} /></div>
            </div>
        {/each}
        <div class="setting-item">
            <div class="setting-item-info"><label class="setting-item-name" for="cr-location-destination">{text('destination')}</label></div>
            <div class="setting-item-control"><input id="cr-location-destination" type="text" spellcheck="false" value={draft.destination} oninput={(event) => draft.destination = event.currentTarget.value} /></div>
        </div>
        <div class="cr-locations__actions">
            <button type="button" onclick={() => editing = false}>{text('cancel')}</button>
            <button type="button" class="mod-cta" onclick={preview}>{text('preview')}</button>
        </div>
    {/if}
</div>

<style>
    .cr-locations { min-width: 0; }
    .cr-locations .setting-item-description { overflow-wrap: anywhere; }
    .cr-locations__note { margin: var(--cr-space-4) 0 0; }
    .cr-locations__changed { color: var(--text-normal); }
    .cr-locations__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--cr-space-2); padding-top: var(--cr-space-4); }
    .cr-locations .setting-item-control input[type="text"] { min-width: 14em; }
    .mod-warning { color: var(--cr-status-warning); }
</style>
