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
        onOpenSettings,
    }: {
        app: App;
        i18n: I18n;
        application: WorkbenchApplication;
        settingsApplication: SettingsApplication;
        onOpenSettings?: () => void;
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
    <header class="cr-workbench-heading"><h1>{t.workbench.product.title}</h1>{#if onOpenSettings}<button type="button" onclick={onOpenSettings}>{t.workbench.product.settings}</button>{/if}</header>
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
        padding: 22px 20px;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .cr-workbench-heading { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
    .cr-workbench-heading h1 { display: block; margin: 0; padding: 0; font-size: var(--cr-heading-workbench); font-weight: 600; line-height: 1.3; }
    .cr-workbench-heading button { padding: 0; height: auto; border: 0; box-shadow: none; background: none; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-section { width: 100%; min-width: 0; }
    .cr-section + .cr-section { border-top: 1px solid var(--cr-border); padding-top: 23px; margin-top: 36px; }
</style>
