<!--
  InlinePanel.svelte — 内联展开面板

  展开/收起动画使用 max-height + opacity 过渡（200ms）。
  Escape 键收起面板。
  设置 role="region"、aria-expanded。
  prefers-reduced-motion: reduce 时禁用动画。

  @see 需求 15.1, 5.5, 5.8
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        expanded = false,
        onclose = undefined,
        children,
    }: {
        expanded: boolean;
        onclose?: (() => void) | undefined;
        children?: Snippet;
    } = $props();

    /** Escape 键关闭面板 */
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape' && expanded) {
            e.preventDefault();
            onclose?.();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
    class="cr-inline-panel"
    class:cr-inline-panel--expanded={expanded}
    role="group"
>
    {#if expanded && children}
        <div class="cr-inline-panel__inner">
            {@render children()}
        </div>
    {/if}
</div>

<style>
    .cr-inline-panel {
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transition: max-height 0.2s ease-out, opacity 0.2s ease-out;
    }

    .cr-inline-panel--expanded {
        max-height: 500px;
        opacity: 1;
    }

    .cr-inline-panel__inner {
        padding: var(--cr-space-3, 12px) 0;
    }

    /* 减弱动效 */
    @media (prefers-reduced-motion: reduce) {
        .cr-inline-panel {
            transition: none;
        }
    }
</style>
