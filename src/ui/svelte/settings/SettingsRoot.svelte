<script lang="ts">
    import { untrack, tick } from 'svelte';
    import type { App } from 'obsidian';
    import type { I18n } from '../../../core/i18n';
    import type { SettingsApplication } from '../../../app/settings-application';
    import { setSettingsContext } from '../../bridge/context';
    import SettingsNav from './SettingsNav.svelte';
    import ProvidersTab from './ProvidersTab.svelte';
    import WorkflowTab from './WorkflowTab.svelte';
    import MaintenanceTab from './MaintenanceTab.svelte';
    import type { TaskType } from '../../../types';
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

    let rootElement: HTMLDivElement;
    let expandedTask = $state<TaskType | undefined>(undefined);
    async function configureTask(task: TaskType) {
        expandedTask = task;
        activeTab = 'providers';
        await tick();
        rootElement.querySelector<HTMLElement>(`#cr-task-trigger-${task}`)?.focus();
    }

    let activeTab = $state<SettingsTab>('providers');
    let saveState = $state(untrack(() => settingsApplication.getSaveState()));
    const unsubscribeSaveState = untrack(() => settingsApplication.subscribeSaveState((state) => {
        saveState = state;
    }));

    $effect(() => () => unsubscribeSaveState());
</script>

<div class="cr-settings-root" bind:this={rootElement}>
    <h1 class="cr-settings-title">Cognitive Razor</h1>
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
                <span>{i18n.t('settings.save.failed')}{saveState.error?.message ? `：${saveState.error.message}` : ''}</span>
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
        id={`cr-settings-panel-${activeTab}`}
        aria-labelledby={`cr-settings-tab-${activeTab}`}
        aria-label={i18n.t(`settings.tabs.${activeTab}`)}
    >
        {#if activeTab === 'providers'}
            <ProvidersTab {expandedTask} />
        {:else if activeTab === 'workflow'}
            <WorkflowTab onConfigureTask={configureTask} />
        {:else}
            <MaintenanceTab />
        {/if}
    </div>
</div>

<style>
    .cr-settings-title { font-size: var(--h2-size); margin: 0 0 var(--cr-space-3); }

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
        align-self: stretch;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--cr-space-2);
        padding: var(--cr-space-2) var(--cr-space-3);
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        min-height: 1.4em;
    }

    .cr-settings-save-state--failed {
        color: var(--text-error);
    }

</style>
