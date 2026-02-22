<!--
  SectionCard.svelte — 统一区块卡片容器

  为工作台各功能区提供一致的视觉包裹：
  背景 + 边框 + 圆角 + 内边距。

  @see UI/UX 优化计划 §7.1
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        children,
    }: {
        children?: Snippet;
    } = $props();
</script>

<div class="cr-section-card">
    {#if children}
        {@render children()}
    {/if}
</div>

<style>
    .cr-section-card {
        background: var(--cr-bg-secondary);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md, 8px);
        padding: var(--cr-space-3, 12px);
    }
</style>
