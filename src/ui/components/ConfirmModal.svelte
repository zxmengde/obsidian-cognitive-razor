<!--
  ConfirmModal.svelte — 确认对话框组件

  支持标题、消息、确认/取消按钮，以及 danger 模式。
  实现焦点捕获（Focus Trap）：Tab/Shift+Tab 在 Modal 内循环。
  打开时焦点移到第一个可聚焦元素，关闭时恢复焦点到触发元素。
  设置 ARIA 属性：role="dialog"、aria-modal="true"、aria-labelledby。
  Escape 键关闭（等同取消），Enter 键确认。

  @see 需求 12.2, 12.4, 12.5, 12.6, 12.7
-->
<script lang="ts">
    import Button from './Button.svelte';

    let {
        title,
        message,
        confirmLabel = '确认',
        cancelLabel = '取消',
        danger = false,
        onconfirm,
        oncancel,
    }: {
        title: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
        onconfirm: () => void;
        oncancel: () => void;
    } = $props();

    /** 挂载前记录触发元素，关闭时恢复焦点 */
    let previousActiveElement: HTMLElement | null = null;

    /** 对话框容器引用 */
    let dialogEl: HTMLDivElement | undefined = $state(undefined);

    /** 标题元素 ID（用于 aria-labelledby） */
    const titleId = `cr-confirm-title-${Math.random().toString(36).slice(2, 8)}`;

    /**
     * 获取对话框内所有可聚焦元素
     */
    function getFocusableElements(): HTMLElement[] {
        if (!dialogEl) return [];
        return Array.from(
            dialogEl.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
        );
    }

    /**
     * 焦点捕获：Tab/Shift+Tab 在 Modal 内循环
     */
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
            return;
        }
        if (e.key === 'Tab') {
            const focusable = getFocusableElements();
            if (focusable.length === 0) return;

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                // Shift+Tab：从第一个元素跳到最后一个
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                // Tab：从最后一个元素跳到第一个
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }

    /** 确认操作 */
    function handleConfirm() {
        restoreFocus();
        onconfirm();
    }

    /** 取消操作 */
    function handleCancel() {
        restoreFocus();
        oncancel();
    }

    /** 点击遮罩层关闭（等同取消） */
    function handleOverlayClick() {
        handleCancel();
    }

    /** 恢复焦点到触发元素 */
    function restoreFocus() {
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
            // 延迟恢复焦点，确保 Modal 已从 DOM 移除
            setTimeout(() => previousActiveElement?.focus(), 0);
        }
    }

    /**
     * 挂载时：记录触发元素 + 聚焦第一个可聚焦元素
     */
    $effect(() => {
        // 记录当前焦点元素
        previousActiveElement = document.activeElement as HTMLElement | null;

        // 延迟聚焦，确保 DOM 已渲染
        const timer = setTimeout(() => {
            const focusable = getFocusableElements();
            if (focusable.length > 0) {
                focusable[0].focus();
            }
        }, 0);

        return () => {
            clearTimeout(timer);
        };
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- 遮罩层 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cr-confirm-overlay" onmousedown={handleOverlayClick}>
    <!-- 对话框 -->
    <div
        bind:this={dialogEl}
        class="cr-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
    >
        <h3 id={titleId} class="cr-confirm-title">{title}</h3>
        <p class="cr-confirm-message">{message}</p>
        <div class="cr-confirm-actions">
            <Button variant="secondary" onclick={handleCancel}>
                {cancelLabel}
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} onclick={handleConfirm}>
                {confirmLabel}
            </Button>
        </div>
    </div>
</div>


<style>
    /* 遮罩层 */
    .cr-confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-modal, 50);
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
    }

    /* 对话框容器 */
    .cr-confirm-dialog {
        background: var(--cr-bg-base);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        box-shadow: var(--cr-shadow-lg);
        padding: var(--cr-space-6);
        min-width: 320px;
        max-width: 480px;
        width: 90%;
    }

    /* 标题 */
    .cr-confirm-title {
        margin: 0 0 var(--cr-space-3) 0;
        font-size: var(--font-ui-medium, 16px);
        font-weight: 600;
        color: var(--cr-text-normal);
    }

    /* 消息 */
    .cr-confirm-message {
        margin: 0 0 var(--cr-space-5) 0;
        color: var(--cr-text-muted);
        font-size: var(--font-ui-small, 14px);
        line-height: 1.5;
    }

    /* 按钮行：两个按钮等宽 */
    .cr-confirm-actions {
        display: flex;
        gap: var(--cr-space-3);
    }

    .cr-confirm-actions :global(button) {
        flex: 1;
    }
</style>
