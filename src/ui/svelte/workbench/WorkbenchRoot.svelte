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
    import CurrentNoteSection from './CurrentNoteSection.svelte';

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

<!-- 视图标签已命名工作台，不再重复大标题；设置入口在第一区标题右侧。
     顺序：新建概念 → 当前笔记（操作对象明确）→ 任务 → 相似笔记。 -->
<div class="cr-workbench-root">
    <section class="cr-section" aria-label={t.workbench.product.newConcept}>
        <CreateSection {onOpenSettings} />
    </section>
    <section class="cr-section" aria-label={t.workbench.product.currentNote}>
        <CurrentNoteSection activeFile={activeFileStore.file} {onOpenSettings} />
    </section>
    <section class="cr-section" aria-label={t.workbench.product.tasks}>
        <QueueSection status={queueStore.status} tasks={queueStore.tasks} />
    </section>
    <section class="cr-section" aria-label={t.workbench.product.similarNotes}>
        <DuplicatesSection pairs={duplicatesStore.pairs} tasks={queueStore.tasks} />
    </section>
</div>

<style>
    .cr-workbench-root {
        max-width: 900px;
        margin: 0 auto;
        padding: var(--cr-space-5) var(--cr-space-4);
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .cr-section { width: 100%; min-width: 0; }
    .cr-section + .cr-section { border-top: 1px solid var(--cr-border); padding-top: var(--cr-space-5); margin-top: var(--cr-space-5); }
</style>
