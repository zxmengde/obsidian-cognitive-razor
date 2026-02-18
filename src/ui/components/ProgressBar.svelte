<!--
  ProgressBar.svelte — 进度条组件

  支持 0-1 或 0-100 的值输入，自动归一化为百分比。
  支持颜色分级（default/red/orange/blue），用于重复对相似度显示。

  @see 需求 7.3
-->
<script lang="ts">
    type BarColor = 'default' | 'red' | 'orange' | 'blue' | 'muted';

    let {
        value = 0,
        color = 'default',
        showLabel = false,
    }: {
        value?: number;
        color?: BarColor;
        showLabel?: boolean;
    } = $props();

    /** 归一化为 0-100 百分比 */
    let percent = $derived(
        value > 1 ? Math.min(Math.max(value, 0), 100) : Math.min(Math.max(value * 100, 0), 100)
    );
</script>

<div class="cr-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
    <div
        class="cr-progress__fill cr-progress__fill--{color}"
        style:width="{percent}%"
    ></div>
    {#if showLabel}
        <span class="cr-progress__label">{Math.round(percent)}%</span>
    {/if}
</div>

<style>
    .cr-progress {
        position: relative;
        width: 100%;
        height: 6px;
        background: var(--cr-bg-secondary);
        border-radius: var(--cr-radius-sm, 4px);
        overflow: hidden;
    }

    .cr-progress__fill {
        height: 100%;
        border-radius: var(--cr-radius-sm, 4px);
        transition: width 0.2s ease;
    }

    /* 颜色变体 */
    .cr-progress__fill--default {
        background: var(--cr-interactive-accent);
    }

    .cr-progress__fill--red {
        background: var(--cr-status-error);
    }

    .cr-progress__fill--orange {
        background: var(--cr-status-warning);
    }

    .cr-progress__fill--blue {
        background: var(--cr-interactive-accent);
    }

    .cr-progress__fill--muted {
        background: var(--cr-text-muted);
        opacity: 0.4;
    }

    .cr-progress__label {
        position: absolute;
        right: 0;
        top: -18px;
        font-size: var(--font-ui-smaller, 11px);
        color: var(--cr-text-muted);
    }

    /* 减弱动效 */
    @media (prefers-reduced-motion: reduce) {
        .cr-progress__fill {
            transition: none;
        }
    }
</style>
