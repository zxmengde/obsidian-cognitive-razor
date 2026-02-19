<!--
  Select.svelte — 下拉选择控件

  用于设置页中的枚举配置项。
  样式通过 scoped styles + --cr-* 变量引用。

  @see 需求 10.4
-->
<script lang="ts">
    let {
        value = '',
        options = [],
        onchange,
        disabled = false,
        id = undefined,
    }: {
        value?: string;
        options?: Array<{ value: string; label: string }>;
        onchange: (value: string) => void;
        disabled?: boolean;
        id?: string;
    } = $props();

    function handleChange(e: Event) {
        const target = e.target as HTMLSelectElement;
        onchange(target.value);
    }
</script>

<select
    class="cr-select"
    {id}
    {value}
    {disabled}
    aria-disabled={disabled ? 'true' : undefined}
    onchange={handleChange}
>
    {#each options as opt (opt.value)}
        <option value={opt.value} selected={opt.value === value}>
            {opt.label}
        </option>
    {/each}
</select>

<style>
    .cr-select {
        appearance: none;
        background: var(--cr-bg-base);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        padding: var(--cr-space-1) var(--cr-space-6) var(--cr-space-1) var(--cr-space-2);
        color: var(--cr-text-normal);
        font-size: var(--font-ui-small, 13px);
        cursor: pointer;
        min-height: 28px;
        /* 下拉箭头 */
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
    }

    .cr-select:focus-visible {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: -1px;
    }

    .cr-select:hover:not(:disabled) {
        border-color: var(--cr-bg-border-hover);
    }

    .cr-select:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
</style>
