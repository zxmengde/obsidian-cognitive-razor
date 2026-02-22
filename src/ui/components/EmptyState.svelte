<!--
  EmptyState.svelte — 空状态引导组件

  居中显示 Lucide SVG 图标 + 淡色引导文字。
  图标降低透明度（opacity: 0.4），文字使用 --cr-text-muted 确保 4.5:1 对比度。

  @see UI/UX 优化计划 §3.2, §6.1
-->
<script lang="ts">
    import Icon from './Icon.svelte';

    let {
        message,
        icon = 'inbox',
    }: {
        message: string;
        /** Lucide 图标名称，默认 inbox */
        icon?: string;
    } = $props();
</script>

<div class="cr-empty-state">
    <span class="cr-empty-state__icon">
        <Icon name={icon} size={20} />
    </span>
    <p class="cr-empty-state__text">{message}</p>
</div>

<style>
    .cr-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cr-space-2, 8px);
        padding: var(--cr-space-6, 24px) var(--cr-space-4, 16px);
        margin: 0;
    }

    .cr-empty-state__icon {
        opacity: 0.4;
        color: var(--cr-text-muted);
    }

    .cr-empty-state__text {
        text-align: center;
        color: var(--cr-text-muted);
        font-size: var(--font-ui-small);
        margin: 0;
        line-height: var(--cr-line-height-body, 1.5);
    }
</style>
