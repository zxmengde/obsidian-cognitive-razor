<!--
  SettingItem.svelte — 通用设置项组件

  模仿 Obsidian 原生 Setting 类的布局：
  左侧标签（name）+ 说明文字（description），右侧通过 children snippet 插入输入控件。
  单行 flex 布局，左侧自动扩展，右侧紧凑排列。

-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        name,
        description = '',
        inlineControl = false,
        children,
    }: {
        /** 设置项标签名称 */
        name: string;
        /** 可选的说明文字 */
        description?: string;
        /** Keep a compact control (such as a switch) beside its wrapping label. */
        inlineControl?: boolean;
        /** 右侧控件插槽 */
        children?: Snippet;
    } = $props();
</script>

<div class="cr-setting-item" class:cr-setting-item--inline-control={inlineControl}>
    <div class="cr-setting-item__info">
        <div class="cr-setting-item__name">{name}</div>
        {#if description}
            <div class="cr-setting-item__desc">{description}</div>
        {/if}
    </div>
    <div class="cr-setting-item__control">
        {#if children}
            {@render children()}
        {/if}
    </div>
</div>

<style>
    .cr-setting-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cr-space-4);
        padding: var(--cr-space-4) 0;
        border-bottom: 1px solid var(--cr-border);
        min-height: 40px;
    }

    .cr-setting-item__info {
        flex: 1;
        min-width: 0;
    }

    .cr-setting-item__name {
        color: var(--cr-text-normal);
        font-size: var(--cr-font-base);
        line-height: 1.4;
    }

    .cr-setting-item__desc {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
        line-height: var(--cr-line-height-body);
        margin-top: var(--cr-space-half);
    }

    .cr-setting-item__control {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
    }
</style>
