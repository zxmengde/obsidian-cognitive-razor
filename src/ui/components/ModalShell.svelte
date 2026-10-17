<script lang="ts">
    import { onMount } from 'svelte';
    import type { Snippet } from 'svelte';

    let {
        titleId,
        wide = false,
        hostLevel = false,
        footer,
        dismissible = true,
        oncancel,
        children,
    }: {
        titleId: string;
        wide?: boolean;
        hostLevel?: boolean;
        footer?: Snippet;
        dismissible?: boolean;
        oncancel: () => void;
        children?: Snippet;
    } = $props();

    // Escape pane containment (container-type/transform/overflow) while staying
    // in the owning Obsidian window. Svelte retains component context/events.
    function portal(node: HTMLDivElement) {
        if (!hostLevel) return;
        node.ownerDocument.body.appendChild(node);
        return { destroy() { node.remove(); } };
    }

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
        const activeElement = dialogEl?.ownerDocument.activeElement ?? null;

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
        // Obsidian can mount the same component in a separate window. Own the
        // keyboard listener, focus and timers in the document hosting this dialog.
        const ownerDocument = dialogEl?.ownerDocument;
        const ownerWindow = ownerDocument?.defaultView;
        if (!ownerDocument || !ownerWindow) return;
        const activeElement = ownerDocument.activeElement;
        const previousActiveElement = activeElement && 'focus' in activeElement
            ? activeElement as HTMLElement
            : null;
        ownerWindow.addEventListener('keydown', handleKeydown);
        const focusTimer = ownerWindow.setTimeout(() => {
            const firstFocusable = getFocusableElements()[0];
            (firstFocusable ?? dialogEl)?.focus();
        }, 0);

        return () => {
            ownerWindow.removeEventListener('keydown', handleKeydown);
            ownerWindow.clearTimeout(focusTimer);
            if (!previousActiveElement) return;
            ownerWindow.setTimeout(() => {
                if (previousActiveElement.isConnected) {
                    previousActiveElement.focus();
                }
            }, 0);
        };
    });
</script>


<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cr-modal-overlay cr-scope" use:portal onmousedown={requestCancel}>
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
        <div class="cr-modal-content">
            {#if children}{@render children()}{/if}
        </div>
        {#if footer}<div class="cr-modal-footer">{@render footer()}</div>{/if}
    </div>
</div>

<style>
    .cr-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--cr-layer-modal);
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
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 0;
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        background: var(--cr-bg-base);
        box-shadow: var(--cr-shadow-lg);
    }

    .cr-modal-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--cr-space-6); }
    .cr-modal-footer { flex-shrink: 0; border-top: 1px solid var(--cr-border); padding: var(--cr-space-4) var(--cr-space-6); background: var(--cr-bg-base); }

    .cr-modal-dialog--wide {
        max-width: 720px;
    }
</style>
