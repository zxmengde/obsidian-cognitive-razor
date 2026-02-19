<!--
  PasswordInput.svelte — 密码输入控件，带显示/隐藏切换

  用于设置页中的 API Key 等敏感信息输入。
  眼睛图标按钮切换 type="password" / type="text"。

  @see 需求 10.6
-->
<script lang="ts">
    let {
        value = '',
        placeholder = '',
        onchange,
        disabled = false,
        id = undefined,
    }: {
        value?: string;
        placeholder?: string;
        onchange: (value: string) => void;
        disabled?: boolean;
        id?: string;
    } = $props();

    /** 是否显示明文 */
    let visible = $state(false);

    /** 输入类型 */
    let inputType = $derived(visible ? 'text' : 'password');

    function handleInput(e: Event) {
        const target = e.target as HTMLInputElement;
        onchange(target.value);
    }

    function toggleVisibility() {
        if (!disabled) {
            visible = !visible;
        }
    }
</script>

<div class="cr-password-input" class:cr-password-input--disabled={disabled}>
    <input
        type={inputType}
        class="cr-password-input__field"
        {id}
        {value}
        {placeholder}
        {disabled}
        aria-disabled={disabled ? 'true' : undefined}
        oninput={handleInput}
    />
    <button
        type="button"
        class="cr-password-input__toggle"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        tabindex={disabled ? -1 : 0}
        {disabled}
        onclick={toggleVisibility}
    >
        {#if visible}
            <!-- 眼睛打开图标（明文状态） -->
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>
        {:else}
            <!-- 眼睛关闭图标（密码状态） -->
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                 viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
        {/if}
    </button>
</div>

<style>
    .cr-password-input {
        display: flex;
        align-items: center;
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-base);
        overflow: hidden;
    }

    .cr-password-input:focus-within {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: -1px;
    }

    .cr-password-input:hover:not(.cr-password-input--disabled) {
        border-color: var(--cr-bg-border-hover);
    }

    .cr-password-input--disabled {
        opacity: 0.5;
    }

    .cr-password-input__field {
        flex: 1;
        border: none;
        background: transparent;
        padding: var(--cr-space-1, 4px) var(--cr-space-2, 8px);
        color: var(--cr-text-normal);
        font-size: var(--font-ui-small, 13px);
        min-height: 28px;
        outline: none;
    }

    .cr-password-input__field::placeholder {
        color: var(--cr-text-faint);
    }

    .cr-password-input__toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--cr-text-muted);
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
    }

    .cr-password-input__toggle:hover:not(:disabled) {
        color: var(--cr-text-normal);
    }

    .cr-password-input__toggle:disabled {
        cursor: not-allowed;
    }
</style>
