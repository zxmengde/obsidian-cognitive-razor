<script lang="ts">
    import { untrack } from 'svelte';
    import type { App } from 'obsidian';
    import type { I18n } from '../../../core/i18n';
    import type { SettingsApplication } from '../../../app/settings-application';
    import type { WorkbenchApplication } from '../../../app/workbench-application';
    import { setWorkbenchContext } from '../../bridge/context';
    import {
        createQueueStore,
        createActiveFileStore,
        createDuplicatesStore,
    } from '../../bridge/reactive.svelte';
    import CreateSection from './CreateSection.svelte';
    import QueueSection from './QueueSection.svelte';
    import DuplicatesSection from './DuplicatesSection.svelte';

    let {
        app,
        i18n,
        application,
        settingsApplication,
    }: {
        app: App;
        i18n: I18n;
        application: WorkbenchApplication;
        settingsApplication: SettingsApplication;
    } = $props();

    const t = untrack(() => i18n.messages);

    untrack(() => setWorkbenchContext({
        app,
        i18n,
        application,
        settingsApplication,
    }));

    const queueStore = untrack(() => createQueueStore(application.queue));
    const activeFileStore = untrack(() => createActiveFileStore(app.workspace));
    const duplicatesStore = untrack(() => createDuplicatesStore(application.duplicates));
    $effect(() => () => {
        queueStore.destroy();
        activeFileStore.destroy();
        duplicatesStore.destroy();
    });
</script>

<div class="cr-workbench-root">
    <section class="cr-section" aria-label={t.workbench.sections.create}>
        <CreateSection activeFile={activeFileStore.file} />
    </section>
    <section class="cr-section" aria-label={t.workbench.sections.queue}>
        <QueueSection status={queueStore.status} tasks={queueStore.tasks} />
    </section>
    <section class="cr-section" aria-label={t.workbench.sections.duplicates}>
        <DuplicatesSection pairs={duplicatesStore.pairs} />
    </section>
</div>

<style>
    .cr-workbench-root {
        max-width: 900px;
        margin: 0 auto;
        padding: var(--cr-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-5);
    }

    .cr-section { width: 100%; min-width: 0; }
    .cr-section + .cr-section { border-top: 1px solid var(--cr-border); padding-top: var(--cr-space-5); }
</style>
