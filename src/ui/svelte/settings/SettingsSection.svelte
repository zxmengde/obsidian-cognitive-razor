<script lang="ts">
    import type { Snippet } from 'svelte';

    let {
        title,
        description = '',
        actions,
        children,
    }: {
        title?: string;
        description?: string;
        actions?: Snippet;
        children?: Snippet;
    } = $props();
</script>

<section class="cr-settings-section">
    {#if title}
    <div class="cr-settings-section__header">
        <div class="cr-settings-section__heading">
            <h3>{title}</h3>
            {#if description}
                <p>{description}</p>
            {/if}
        </div>
        {#if actions}
            <div class="cr-settings-section__actions">
                {@render actions()}
            </div>
        {/if}
    </div>
    {/if}
    {#if children}
        {@render children()}
    {/if}
</section>

<style>
    .cr-settings-section {
        padding: var(--cr-space-4) 0;
        border-bottom: 1px solid var(--cr-border);
    }

    .cr-settings-section:first-child {
        padding-top: 0;
    }

    .cr-settings-section:last-child {
        border-bottom: 0;
    }

    .cr-settings-section__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cr-space-4);
        margin-bottom: var(--cr-space-2);
    }

    .cr-settings-section__heading {
        min-width: 0;
    }

    .cr-settings-section h3 {
        margin: 0;
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium);
        font-weight: 600;
    }

    .cr-settings-section p {
        margin: var(--cr-space-1) 0 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
        line-height: var(--cr-line-height-body);
    }

    .cr-settings-section__actions {
        flex-shrink: 0;
    }
</style>
