<script lang="ts">
    import { untrack, tick, onDestroy } from 'svelte';
    import type { App } from 'obsidian';
    import type { I18n } from '../../../core/i18n';
    import type { SettingsApplication } from '../../../app/settings-application';
    import { setSettingsContext } from '../../bridge/context';
    import SettingsNav from './SettingsNav.svelte';
    import ProvidersTab from './ProvidersTab.svelte';
    import TaskDetails from './TaskDetails.svelte';
    import WorkflowTab from './WorkflowTab.svelte';
    import MaintenanceTab from './MaintenanceTab.svelte';
    import type { TaskType } from '../../../types';
    import Button from '../../components/Button.svelte';

    type SettingsTab = 'providers' | 'workflow' | 'backup';

    let {
        app,
        i18n,
        settingsApplication,
        onTabNavigate,
    }: {
        app: App;
        i18n: I18n;
        settingsApplication: SettingsApplication;
        /** The host owns the scrolling settings container. */
        onTabNavigate?: () => void;
    } = $props();

    untrack(() => setSettingsContext({
        app,
        i18n,
        settingsApplication,
    }));

    let rootElement: HTMLDivElement;
    let selectedTask = $state<TaskType | undefined>(undefined);
    let overridesOpen = $state(false);
    // Lazily keep visited editors alive for this settings session. Their local
    // invalid/pending drafts must not be discarded or moved to another task.
    let visitedTasks = $state<TaskType[]>([]);
    let navigationVersion = 0;
    let destroyed = false;
    async function finishNavigation(focusId?: string) {
        const version = ++navigationVersion;
        await tick();
        if (destroyed || version !== navigationVersion) return;
        onTabNavigate?.();
        if (destroyed || version !== navigationVersion) return;
        if (focusId) rootElement.querySelector<HTMLElement>(`#${focusId}`)?.focus();
    }
    async function navigateToTab(tab: SettingsTab) {
        if (activeTab === tab && selectedTask === undefined) {
            navigationVersion++;
            return;
        }
        activeTab = tab;
        selectedTask = undefined;
        await finishNavigation();
    }
    async function configureTask(task: TaskType) {
        if (activeTab === 'providers' && selectedTask === task) return;
        if (!visitedTasks.includes(task)) visitedTasks = [...visitedTasks, task];
        overridesOpen = true;
        selectedTask = task;
        activeTab = 'providers';
        await finishNavigation(`cr-task-detail-heading-${task}`);
    }
    async function returnToOverview(task: TaskType) {
        if (activeTab !== 'providers' || selectedTask !== task) return;
        selectedTask = undefined;
        await finishNavigation(`cr-task-trigger-${task}`);
    }

    let activeTab = $state<SettingsTab>('providers');
    let saveState = $state(untrack(() => settingsApplication.getSaveState()));
    const unsubscribeSaveState = untrack(() => settingsApplication.subscribeSaveState((state) => {
        saveState = state;
    }));

    onDestroy(() => {
        destroyed = true;
        navigationVersion++;
        unsubscribeSaveState();
    });
</script>

<div class="cr-settings-root" bind:this={rootElement}>
    <header class="cr-settings-header">
        <h1 class="cr-settings-title">Cognitive Razor</h1>
        <div class="cr-settings-save-slot" class:cr-settings-save-slot--failed={saveState.status === 'save-failed'}>
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
                        {#if saveState.retryable !== false}<Button
                            variant="ghost"
                            size="sm"
                            onclick={() => void settingsApplication.retryLastSave()}
                        >
                            {i18n.t('settings.save.retry')}
                        </Button>{:else}<span>{i18n.t('settings.save.reapply')}</span>{/if}
                    {/if}
                </div>
            {/if}
        </div>
    </header>
    <SettingsNav {activeTab} onTabChange={(tab) => void navigateToTab(tab)} {i18n} />

    <div
        class="cr-settings-content"
        role="tabpanel"
        id={`cr-settings-panel-${activeTab}`}
        aria-labelledby={`cr-settings-tab-${activeTab}`}
        aria-label={i18n.t(`settings.tabs.${activeTab}`)}
    >
        {#if activeTab === 'providers' && selectedTask === undefined}
            <ProvidersTab onConfigureTask={configureTask} {overridesOpen} onToggleOverrides={() => overridesOpen = !overridesOpen} />
        {:else if activeTab === 'workflow'}
            <WorkflowTab />
        {:else if activeTab === 'backup'}
            <MaintenanceTab />
        {/if}
        {#each visitedTasks as task (task)}
            <div class="cr-task-detail-view" hidden={activeTab !== 'providers' || selectedTask !== task}>
                <TaskDetails taskType={task} onBack={() => void returnToOverview(task)} />
            </div>
        {/each}
    </div>
</div>

<style>
    .cr-task-detail-view[hidden] { display: none; }
    .cr-settings-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--cr-space-2) var(--cr-space-4); margin-bottom: var(--cr-space-3); }
    /* Reserve the normal status slot so saving does not move the navigation. */
    .cr-settings-save-slot { min-width: 5em; justify-self: end; max-width: 100%; }
    .cr-settings-save-slot--failed { grid-column: 1 / -1; justify-self: stretch; }
    /* The host may hide generic settings h1 elements; this is our page title. */
    .cr-settings-root .cr-settings-title {
        display: block;
        font-size: var(--cr-settings-title-size);
        margin: 0;
        padding: 0;
    }

    .cr-settings-root {
        /* Keep host scaling while separating body, secondary and source text. */
        --cr-font-base: var(--font-ui-medium);
        --cr-font-sm: var(--font-ui-small);
        --cr-font-xs: var(--font-ui-smaller);
        display: flex;
        flex-direction: column;
        min-height: 0;
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
        font-size: var(--cr-font-base);
        line-height: var(--cr-line-height-body);
    }

    .cr-settings-content {
        padding: var(--cr-space-6) 0;
        flex: 1;
    }

    .cr-settings-save-state {
        align-self: stretch;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--cr-space-2);
        padding: 0;
        overflow-wrap: anywhere;
        color: var(--text-muted);
        font-size: var(--cr-font-sm);
        min-height: 1.4em;
    }

    .cr-settings-save-state--failed {
        justify-content: space-between;
        color: var(--text-error);
    }

</style>
