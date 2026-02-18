<!--
  DiffToolbar.svelte — Diff 底部操作栏

  职责：
  - 固定在底部不随内容滚动
  - 接受按钮（Primary）和拒绝按钮（Secondary）尺寸相同
  - 快照恢复模式：接受按钮文案改为"恢复到此版本"
  - 设置 role="toolbar"
  - 支持 slot 插入合并名称选择控件

  @see 需求 9.5, 9.6, 9.8, 14.10
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import type { Snippet } from 'svelte';

    let {
        mode,
        onaccept,
        onreject,
        children,
    }: {
        mode: 'amend' | 'merge' | 'snapshot';
        onaccept: () => void;
        onreject: () => void;
        children?: Snippet;
    } = $props();

    const ctx = getCRContext();
    const t = ctx.i18n.t();

    /** 接受按钮文案 */
    let acceptLabel = $derived(
        mode === 'snapshot'
            ? (t.diff?.restoreVersion ?? '恢复到此版本')
            : (t.diff?.accept ?? '接受')
    );

    let rejectLabel = $derived(t.diff?.reject ?? '拒绝');
</script>

<div class="cr-diff-toolbar" role="toolbar" aria-label="Diff 操作">
    <!-- slot：合并名称选择等额外控件 -->
    {#if children}
        <div class="cr-diff-toolbar__extra">
            {@render children()}
        </div>
    {/if}

    <div class="cr-diff-toolbar__actions">
        <Button variant="secondary" onclick={onreject}>
            {rejectLabel}
        </Button>
        <Button variant="primary" onclick={onaccept}>
            {acceptLabel}
        </Button>
    </div>
</div>

<style>
    .cr-diff-toolbar {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
        padding: var(--cr-space-3) var(--cr-space-4);
        border-top: 1px solid var(--cr-border);
        background: var(--cr-bg-primary);
        flex-shrink: 0;
    }

    .cr-diff-toolbar__extra {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
    }

    .cr-diff-toolbar__actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--cr-space-2);
    }
</style>
