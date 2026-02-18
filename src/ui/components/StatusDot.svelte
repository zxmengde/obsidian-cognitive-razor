<!--
  StatusDot.svelte — 状态指示器圆点

  根据状态显示不同颜色的圆点，running 状态带脉冲动画。
  可选 label 文字通过 aria-live="polite" 通知屏幕阅读器。

  @see 需求 6.3, 15.4, 14.6
-->
<script lang="ts">
    /** 状态类型 */
    type DotStatus = 'idle' | 'running' | 'paused' | 'error';

    let {
        status = 'idle',
        label = undefined,
    }: {
        status?: DotStatus;
        label?: string | undefined;
    } = $props();
</script>

<span class="cr-status-dot-wrapper">
    <span
        class="cr-status-dot cr-status-dot--{status}"
        class:cr-status-dot--pulse={status === 'running'}
        aria-hidden="true"
    ></span>
    {#if label}
        <span class="cr-status-dot-label" aria-live="polite">{label}</span>
    {/if}
</span>

<style>
    .cr-status-dot-wrapper {
        display: inline-flex;
        align-items: center;
        gap: var(--cr-space-1h, 6px);
    }

    .cr-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    /* 颜色映射 */
    .cr-status-dot--idle {
        background: var(--cr-text-faint);
    }

    .cr-status-dot--running {
        background: var(--cr-interactive-accent);
    }

    .cr-status-dot--paused {
        background: var(--cr-status-warning);
    }

    .cr-status-dot--error {
        background: var(--cr-status-error);
    }

    /* 脉冲动画 — 仅 running 状态 */
    .cr-status-dot--pulse {
        animation: cr-pulse 1.5s ease-in-out infinite;
    }

    @keyframes cr-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
    }

    /* 减弱动效 */
    @media (prefers-reduced-motion: reduce) {
        .cr-status-dot--pulse {
            animation: none;
        }
    }

    .cr-status-dot-label {
        font-size: var(--font-ui-small);
        color: var(--cr-text-muted);
    }
</style>
