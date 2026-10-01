<script lang="ts">
    import { onMount } from 'svelte';
    import type { Snippet } from 'svelte';

    let {
        titleId,
        wide = false,
        dismissible = true,
        oncancel,
        children,
    }: {
        titleId: string;
        wide?: boolean;
        dismissible?: boolean;
        oncancel: () => void;
        children?: Snippet;
    } = $props();

    let dialogEl: HTMLDivElement | undefined = $state(undefined);

    function requestCancel(): void {
        if (dismissible) oncancel();
    }

    function getFocusableElements(): HTMLElement[] {
        if (!dialogEl) return [];
        return Array.from(dialogEl.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ));
    }

    function trapTabFocus(event: KeyboardEvent): void {
        const focusable = getFocusableElements();
        if (focusable.length === 0) {
            event.preventDefault();
            dialogEl?.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeElement = document.activeElement;

        if (event.shiftKey && (activeElement === first || !dialogEl?.contains(activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (activeElement === last || !dialogEl?.contains(activeElement))) {
            event.preventDefault();
            first.focus();
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing) return;

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                requestCancel();
                break;
            case 'Tab':
                trapTabFocus(event);
                break;
        }
    }

    onMount(() => {
        const previousActiveElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const focusTimer = window.setTimeout(() => {
            const firstFocusable = getFocusableElements()[0];
            (firstFocusable ?? dialogEl)?.focus();
        }, 0);

        return () => {
            window.clearTimeout(focusTimer);
            if (!previousActiveElement) return;
            window.setTimeout(() => {
                if (previousActiveElement.isConnected) {
                    previousActiveElement.focus();
                }
            }, 0);
        };
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cr-modal-overlay" onmousedown={requestCancel}>
    <div
        bind:this={dialogEl}
        class="cr-modal-dialog"
        class:cr-modal-dialog--wide={wide}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="-1"
        onmousedown={(event: MouseEvent) => event.stopPropagation()}
    >
        {#if children}
            {@render children()}
        {/if}
    </div>
</div>

<style>
    .cr-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-modal);
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        padding: var(--cr-space-4);
        background: var(--cr-bg-cover);
    }

    .cr-modal-dialog {
        box-sizing: border-box;
        width: 100%;
        max-width: 480px;
        max-height: calc(100vh - 2 * var(--cr-space-4));
        overflow-y: auto;
        padding: var(--cr-space-6);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        background: var(--cr-bg-base);
        box-shadow: var(--cr-shadow-lg);
    }

    .cr-modal-dialog--wide {
        max-width: 520px;
    }
</style>
