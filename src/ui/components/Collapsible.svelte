<!--
  Collapsible.svelte — 可折叠区域组件

  header 设置 role="button"、tabindex="0"、aria-expanded、aria-controls。
  内容区设置 role="region"、aria-labelledby。
  折叠/展开使用 max-height 过渡（200ms）。
  数量 badge 显示在标题旁，actions 具名插槽用于放置操作按钮。

  @see 需求 14.1, 14.2, 15.2
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        title,
        count = undefined,
        collapsed = false,
        onToggle = undefined,
        children,
        actions = undefined,
    }: {
        title: string;
        count?: number | undefined;
        collapsed?: boolean;
        onToggle?: ((collapsed: boolean) => void) | undefined;
        children?: Snippet;
        actions?: Snippet;
    } = $props();

    /** 唯一 ID，用于 aria-controls / aria-labelledby 关联 */
    const uid = `cr-col-${Math.random().toString(36).slice(2, 8)}`;
    const headerId = `${uid}-header`;
    const contentId = `${uid}-content`;

    function toggle() {
        collapsed = !collapsed;
        onToggle?.(collapsed);
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    }
</script>

<div class="cr-collapsible">
    <!-- header -->
    <div
        class="cr-collapsible-header"
        id={headerId}
        role="button"
        tabindex={0}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onclick={toggle}
        onkeydown={handleKeydown}
    >
        <span class="cr-collapse-icon" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
        </span>
        <span class="cr-section-title">{title}</span>
        {#if count != null && count > 0}
            <span class="cr-badge">{count}</span>
        {/if}
        {#if actions}
            <!-- 阻止点击 actions 区域触发折叠 -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="cr-collapsible-actions" onclick={(e: MouseEvent) => e.stopPropagation()}>
                {@render actions()}
            </span>
        {/if}
    </div>

    <!-- 内容区 -->
    <div
        id={contentId}
        class="cr-collapsible-content"
        class:cr-collapsible-content--collapsed={collapsed}
        role="region"
        aria-labelledby={headerId}
    >
        {#if !collapsed && children}
            {@render children()}
        {/if}
    </div>
</div>

<style>
    .cr-collapsible {
        width: 100%;
    }

    .cr-collapsible-header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
        padding: var(--cr-space-2, 8px) var(--cr-space-1, 4px);
        cursor: pointer;
        user-select: none;
        border: none;
        background: none;
        width: 100%;
        text-align: left;
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium);
        border-radius: var(--cr-radius-sm, 4px);
    }

    .cr-collapsible-header:hover {
        background: var(--cr-bg-hover);
    }

    .cr-collapsible-header:focus-visible {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: -2px;
    }

    .cr-collapse-icon {
        font-size: 12px;
        line-height: 1;
        flex-shrink: 0;
        width: 12px;
        text-align: center;
    }

    .cr-section-title {
        font-weight: 600;
        flex-shrink: 0;
    }

    .cr-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 var(--cr-space-1, 4px);
        border-radius: 9px;
        background: var(--cr-bg-secondary);
        color: var(--cr-text-muted);
        font-size: var(--font-ui-smaller, 11px);
        font-weight: 600;
        line-height: 1;
    }

    .cr-collapsible-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: var(--cr-space-1, 4px);
    }

    .cr-collapsible-content {
        overflow: hidden;
        max-height: 2000px;
        transition: max-height 0.2s ease-out;
    }

    .cr-collapsible-content--collapsed {
        max-height: 0;
    }

    /* 减弱动效 */
    @media (prefers-reduced-motion: reduce) {
        .cr-collapsible-content {
            transition: none;
        }
    }
</style>
