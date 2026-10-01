<!--
  TextInput.svelte — 文本输入控件

  用于设置页中的文本配置项。
  支持宽度类：cr-input-xs / cr-input-sm / cr-input-md / cr-input-lg。

-->
<script lang="ts">
    let {
        value = '',
        placeholder = '',
        onchange,
        disabled = false,
        widthClass = '',
        id = undefined,
        ariaLabel = undefined,
        invalid = false,
        ariaDescribedBy = undefined,
    }: {
        value?: string;
        placeholder?: string;
        onchange: (value: string) => void;
        disabled?: boolean;
        widthClass?: string;
        id?: string;
        ariaLabel?: string;
        invalid?: boolean;
        ariaDescribedBy?: string;
    } = $props();

    /** 组合 CSS 类名 */
    let className = $derived(
        ['cr-text-input', widthClass].filter(Boolean).join(' ')
    );

    // Persist settings after the edit is committed, rather than once per
    // keystroke. This keeps plugin-data writes and listener updates bounded.
    function handleChange(e: Event) {
        const target = e.target as HTMLInputElement;
        onchange(target.value);
    }
</script>

<input
    type="text"
    class={className}
    {id}
    {value}
    {placeholder}
    {disabled}
    aria-disabled={disabled ? 'true' : undefined}
    aria-label={ariaLabel}
    aria-invalid={invalid ? 'true' : undefined}
    aria-describedby={ariaDescribedBy}
    class:cr-text-input--invalid={invalid}
    onchange={handleChange}
/>

<style>
    .cr-text-input {
        padding: var(--cr-space-1) var(--cr-space-2);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm);
        background: var(--cr-bg-base);
        color: var(--cr-text-normal);
        font-size: var(--font-ui-small);
        min-height: 28px;
    }

    .cr-text-input:focus-visible {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: -1px;
    }

    .cr-text-input:hover:not(:disabled) {
        border-color: var(--cr-bg-border-hover);
    }

    .cr-text-input--invalid {
        border-color: var(--cr-status-error);
    }

    .cr-text-input::placeholder {
        color: var(--cr-text-faint);
    }

    .cr-text-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
