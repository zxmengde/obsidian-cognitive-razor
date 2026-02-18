<!--
  WorkbenchRoot.svelte — 工作台根组件

  职责：
  - 设置 CRContext（注入 container, i18n, app）
  - 创建响应式 stores（queue, activeFile, duplicates, snapshots）
  - 渲染四个功能区占位（后续任务 6.2-6.11 实现具体内容）
  - 垂直单列布局，最大宽度 900px，居中对齐
  - $effect 清理 stores

  @see 需求 3.1, 3.2, 3.7, 3.8
-->
<script lang="ts">
    import type CognitiveRazorPlugin from '../../../../main';
    import { setCRContext } from '../../bridge/context';
    import {
        createQueueStore,
        createActiveFileStore,
        createDuplicatesStore,
        createSnapshotsStore,
    } from '../../bridge/reactive.svelte';
    import CreateSection from './CreateSection.svelte';
    import QueueSection from './QueueSection.svelte';
    import DuplicatesSection from './DuplicatesSection.svelte';
    import HistorySection from './HistorySection.svelte';

    let { plugin }: { plugin: CognitiveRazorPlugin } = $props();

    // 从插件获取核心服务
    const components = plugin.getComponents();

    // 设置 Context，供子组件通过 getCRContext() 获取
    setCRContext({
        container: components.container,
        i18n: components.i18n,
        app: plugin.app,
    });

    // 创建响应式 stores
    const queueStore = createQueueStore(components.taskQueue);
    const activeFileStore = createActiveFileStore(plugin.app.workspace);
    const duplicatesStore = createDuplicatesStore(components.duplicateManager);
    const snapshotsStore = createSnapshotsStore(components.undoManager);

    // 组件卸载时清理所有 store 订阅
    $effect(() => {
        return () => {
            queueStore.destroy();
            activeFileStore.destroy();
            duplicatesStore.destroy();
            snapshotsStore.destroy();
        };
    });
</script>

<div class="cr-workbench-root">
    <!-- 创建区（始终可见，不可折叠） -->
    <section class="cr-section" aria-label="创建">
        <CreateSection activeFile={activeFileStore.file} />
    </section>

    <!-- 队列区（始终可见，视觉轻量） -->
    <section class="cr-section" aria-label="队列">
        <QueueSection status={queueStore.status} tasks={queueStore.tasks} />
    </section>

    <!-- 重复对区（可折叠，默认展开） -->
    <section class="cr-section" aria-label="重复对">
        <DuplicatesSection pairs={duplicatesStore.pairs} />
    </section>

    <!-- 历史区（可折叠，默认折叠） -->
    <section class="cr-section" aria-label="历史">
        <HistorySection
            snapshots={snapshotsStore.snapshots}
            activeFile={activeFileStore.file}
            onRefresh={snapshotsStore.refresh}
        />
    </section>
</div>

<style>
    .cr-workbench-root {
        max-width: 900px;
        margin: 0 auto;
        padding: var(--cr-space-4) var(--cr-space-3);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-4);
    }

    .cr-section {
        width: 100%;
    }

    .cr-placeholder {
        padding: var(--cr-space-3);
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        text-align: center;
    }
</style>
