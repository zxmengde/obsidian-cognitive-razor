<!--
  TextInput.svelte — 文本输入控件

  用于设置页中的文本配置项。
  支持宽度类：cr-input-xs / cr-input-sm / cr-input-md / cr-input-lg。

  @see 需求 10.4
-->
<script lang="ts">
    let {
        value = '',
        placeholder = '',
        onchange,
        disabled = false,
        widthClass = '',
        id = undefined,
    }: {
        value?: string;
        placeholder?: string;
        onchange: (value: string) => void;
        disabled?: boolean;
        widthClass?: string;
        id?: string;
    } = $props();

    /** 组合 CSS 类名 */
    let className = $derived(
        ['cr-text-input', widthClass].filter(Boolean).join(' ')
    );

    function handleInput(e: Event) {
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
    oninput={handleInput}
/>

<style>
    .cr-text-input {
        padding: var(--cr-space-1, 4px) var(--cr-space-2, 8px);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-base);
        color: var(--cr-text-normal);
        font-size: var(--font-ui-small, 13px);
        min-height: 28px;
    }

    .cr-text-input:focus-visible {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: -1px;
    }

    .cr-text-input:hover:not(:disabled) {
        border-color: var(--cr-bg-border-hover);
    }

    .cr-text-input::placeholder {
        color: var(--cr-text-faint);
    }

    .cr-text-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
