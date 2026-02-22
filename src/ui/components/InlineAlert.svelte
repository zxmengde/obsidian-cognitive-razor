<!--
  InlineAlert.svelte — 内联错误/警告/成功提示

  靠近问题发生位置显示反馈信息，支持展开详情。
  使用 aria-live="assertive" 确保屏幕阅读器播报。

  @see UI/UX 优化计划 §3.4
-->
<script lang="ts">
    import Icon from './Icon.svelte';

    type AlertLevel = 'error' | 'warning' | 'success' | 'info';

    let {
        level = 'error',
        message,
        details = undefined,
    }: {
        level?: AlertLevel;
        message: string;
        details?: string | undefined;
    } = $props();

    let expanded = $state(false);

    const ICON_MAP: Record<AlertLevel, string> = {
        error: 'alert-triangle',
        warning: 'alert-triangle',
        success: 'check-circle-2',
        info: 'info',
    };
</script>

<div
    class="cr-inline-alert cr-inline-alert--{level}"
    role="alert"
    aria-live="assertive"
>
    <div class="cr-inline-alert__header">
        <Icon name={ICON_MAP[level]} size={16} />
        <span class="cr-inline-alert__message">{message}</span>
        {#if details}
            <button
                class="cr-inline-alert__toggle"
                onclick={() => expanded = !expanded}
                aria-expanded={expanded}
                aria-label={expanded ? '收起详情' : '展开详情'}
            >
                <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
        {/if}
    </div>
    {#if details && expanded}
        <div class="cr-inline-alert__details">{details}</div>
    {/if}
</div>

<style>
    .cr-inline-alert {
        border-radius: var(--cr-radius-sm, 4px);
        padding: var(--cr-space-2, 8px) var(--cr-space-3, 12px);
        font-size: var(--cr-font-sm, 13px);
        line-height: var(--cr-line-height-body, 1.5);
    }

    .cr-inline-alert--error {
        background: var(--cr-overlay-error-10);
        color: var(--cr-status-error);
    }

    .cr-inline-alert--warning {
        background: var(--cr-overlay-warning-15);
        color: var(--cr-status-warning);
    }

    .cr-inline-alert--success {
        background: var(--cr-overlay-success-10);
        color: var(--cr-status-success);
    }

    .cr-inline-alert--info {
        background: var(--cr-overlay-info-15);
        color: var(--cr-status-info);
    }

    .cr-inline-alert__header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
    }

    .cr-inline-alert__message {
        flex: 1;
        min-width: 0;
    }

    .cr-inline-alert__toggle {
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0;
        display: flex;
        align-items: center;
        opacity: 0.7;
    }

    .cr-inline-alert__toggle:hover {
        opacity: 1;
    }

    .cr-inline-alert__details {
        margin-top: var(--cr-space-2, 8px);
        padding-top: var(--cr-space-2, 8px);
        border-top: 1px solid currentColor;
        opacity: 0.8;
        font-size: var(--cr-font-xs, 11px);
        white-space: pre-wrap;
        word-break: break-all;
    }
</style>
