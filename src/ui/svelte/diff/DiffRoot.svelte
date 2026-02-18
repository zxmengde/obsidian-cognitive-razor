<!--
  DiffRoot.svelte — Diff 标签页根组件

  职责：
  - 标题栏（操作类型图标 + 笔记名称）
  - 键盘快捷键：Ctrl+Enter 接受、Escape 拒绝/关闭
  - 渲染 DiffContent 和 DiffToolbar
  - 合并模式下渲染 MergeNameSelect

  @see 需求 9.3, 9.9, 9.10, 9.11
-->
<script lang="ts">
    import type CognitiveRazorPlugin from '../../../../main';
    import { setCRContext } from '../../bridge/context';
    import type { DiffViewState } from '../diff-view';
    import DiffContent from './DiffContent.svelte';
    import DiffToolbar from './DiffToolbar.svelte';
    import MergeNameSelect from './MergeNameSelect.svelte';

    let {
        state,
        plugin,
    }: {
        state: DiffViewState;
        plugin: CognitiveRazorPlugin;
    } = $props();

    // 设置 Context
    const components = plugin.getComponents();
    setCRContext({
        container: components.container,
        i18n: components.i18n,
        app: plugin.app,
    });

    const t = components.i18n.t();

    /** 合并模式下选中的名称 */
    let selectedName = $state('');

    /** 操作模式标签 */
    const modeLabels: Record<string, string> = {
        amend: t.diff?.modeAmend ?? '修订',
        merge: t.diff?.modeMerge ?? '合并',
        snapshot: t.diff?.modeSnapshot ?? '快照恢复',
    };

    let modeLabel = $derived(modeLabels[state.mode] ?? 'Diff');

    /** 接受操作 */
    function handleAccept(): void {
        if (state.mode === 'merge') {
            state.onAccept({ selectedName });
        } else {
            state.onAccept();
        }
    }

    /** 拒绝操作 */
    function handleReject(): void {
        state.onReject();
    }

    /** 键盘快捷键 */
    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleAccept();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            handleReject();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="cr-diff-tab" role="document">
    <!-- 标题栏 -->
    <div class="cr-diff-header">
        <span class="cr-diff-type-label">{modeLabel}</span>
        <span class="cr-diff-note-name">{state.noteName}</span>
    </div>

    <!-- Diff 内容区 -->
    <div class="cr-diff-body">
        <DiffContent
            oldContent={state.oldContent}
            newContent={state.newContent}
        />
    </div>

    <!-- 底部操作栏 -->
    <DiffToolbar
        mode={state.mode}
        onaccept={handleAccept}
        onreject={handleReject}
    >
        {#if state.mode === 'merge' && state.mergeNames}
            <MergeNameSelect
                names={state.mergeNames}
                bind:selected={selectedName}
            />
        {/if}
    </DiffToolbar>
</div>

<style>
    .cr-diff-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .cr-diff-header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        padding: var(--cr-space-3) var(--cr-space-4);
        border-bottom: 1px solid var(--cr-border);
        flex-shrink: 0;
    }

    .cr-diff-type-label {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-muted);
        padding: 2px 8px;
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-secondary);
    }

    .cr-diff-note-name {
        font-size: var(--cr-font-base, 14px);
        color: var(--cr-text-primary);
        font-weight: 500;
    }

    .cr-diff-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }
</style>
