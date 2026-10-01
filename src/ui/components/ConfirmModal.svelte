<!--
  ConfirmModal.svelte — 确认对话框组件

  支持标题、消息、确认/取消按钮，以及 danger 模式。
  容器、焦点和键盘生命周期由 ModalShell 统一处理。

-->
<script lang="ts">
    import Button from './Button.svelte';
    import ModalShell from './ModalShell.svelte';

    let {
        title,
        message,
        confirmLabel,
        cancelLabel,
        danger = false,
        onconfirm,
        oncancel,
    }: {
        title: string;
        message: string;
        confirmLabel: string;
        cancelLabel: string;
        danger?: boolean;
        onconfirm: () => void;
        oncancel: () => void;
    } = $props();

    /** 标题元素 ID（用于 aria-labelledby） */
    const titleId = `cr-confirm-title-${Math.random().toString(36).slice(2, 8)}`;

    /** 确认操作 */
    function handleConfirm() {
        onconfirm();
    }

    /** 取消操作 */
    function handleCancel() {
        oncancel();
    }
</script>

<ModalShell {titleId} oncancel={handleCancel}>
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
</ModalShell>


<style>
    /* 标题 */
    .cr-confirm-title {
        margin: 0 0 var(--cr-space-3) 0;
        font-size: var(--font-ui-medium);
        font-weight: 600;
        color: var(--cr-text-normal);
    }

    /* 消息 */
    .cr-confirm-message {
        margin: 0 0 var(--cr-space-5) 0;
        color: var(--cr-text-muted);
        font-size: var(--font-ui-small);
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
