<script lang="ts">
    import { untrack } from 'svelte';
    import type { App } from 'obsidian';
    import type { I18n } from '../../../core/i18n';
    import type { SettingsApplication } from '../../../app/settings-application';
    import { setSettingsContext } from '../../bridge/context';
    import SettingsNav from './SettingsNav.svelte';
    import ProvidersTab from './ProvidersTab.svelte';
    import WorkflowTab from './WorkflowTab.svelte';
    import BackupTab from './BackupTab.svelte';
    import Button from '../../components/Button.svelte';

    type SettingsTab = 'providers' | 'workflow' | 'backup';

    let {
        app,
        i18n,
        settingsApplication,
    }: {
        app: App;
        i18n: I18n;
        settingsApplication: SettingsApplication;
    } = $props();

    untrack(() => setSettingsContext({
        app,
        i18n,
        settingsApplication,
    }));

    let activeTab = $state<SettingsTab>('providers');
    let saveState = $state(untrack(() => settingsApplication.getSaveState()));
    const unsubscribeSaveState = untrack(() => settingsApplication.subscribeSaveState((state) => {
        saveState = state;
    }));

    $effect(() => () => unsubscribeSaveState());
</script>

<div class="cr-settings-root">
    <SettingsNav {activeTab} onTabChange={(tab) => activeTab = tab} {i18n} />

    {#if saveState.status !== 'idle'}
        <div
            class="cr-settings-save-state"
            class:cr-settings-save-state--failed={saveState.status === 'save-failed'}
            role={saveState.status === 'save-failed' ? 'alert' : 'status'}
            aria-live="polite"
        >
            {#if saveState.status === 'saving'}
                {i18n.t('settings.save.saving')}
            {:else if saveState.status === 'saved'}
                {i18n.t('settings.save.saved')}
            {:else}
                <span>{saveState.error?.message || i18n.t('settings.save.failed')}</span>
                <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => void settingsApplication.retryLastSave()}
                >
                    {i18n.t('settings.save.retry')}
                </Button>
            {/if}
        </div>
    {/if}

    <div
        class="cr-settings-content"
        role="tabpanel"
        aria-label={i18n.t(`settings.tabs.${activeTab}`)}
    >
        {#if activeTab === 'providers'}
            <ProvidersTab />
        {:else if activeTab === 'workflow'}
            <WorkflowTab />
        {:else}
            <BackupTab />
        {/if}
    </div>
</div>

<style>
    .cr-settings-root {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .cr-settings-content {
        padding: var(--cr-space-4) var(--cr-space-3);
        flex: 1;
    }

    .cr-settings-save-state {
        align-self: flex-end;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        min-height: 1.4em;
    }

    .cr-settings-save-state--failed {
        color: var(--text-error);
    }

</style>
