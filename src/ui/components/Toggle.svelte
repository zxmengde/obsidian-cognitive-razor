<!--
  Toggle.svelte — 布尔值开关控件

  用于设置页中的布尔配置项，支持 disabled 状态和 ARIA 无障碍属性。
  样式通过 scoped styles + --cr-* 变量引用。

  @see 需求 10.4
-->
<script lang="ts">
    let {
        checked = false,
        onchange,
        disabled = false,
        ariaLabel = undefined,
    }: {
        checked?: boolean;
        onchange: (checked: boolean) => void;
        disabled?: boolean;
        ariaLabel?: string | undefined;
    } = $props();

    function handleClick() {
        if (!disabled) {
            onchange(!checked);
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
        }
    }
</script>

<div
    class="cr-toggle"
    class:cr-toggle--checked={checked}
    class:cr-toggle--disabled={disabled}
    role="switch"
    aria-checked={checked}
    aria-disabled={disabled ? 'true' : undefined}
    aria-label={ariaLabel}
    tabindex={disabled ? -1 : 0}
    onclick={handleClick}
    onkeydown={handleKeydown}
>
    <div class="cr-toggle__thumb"></div>
</div>

<style>
    .cr-toggle {
        position: relative;
        width: 36px;
        height: 20px;
        border-radius: 10px;
        background: var(--cr-border);
        cursor: pointer;
        transition: background 0.15s ease;
        flex-shrink: 0;
    }

    .cr-toggle:focus-visible {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: 2px;
    }

    .cr-toggle--checked {
        background: var(--cr-interactive-accent);
    }

    .cr-toggle--disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .cr-toggle__thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        transition: transform 0.15s ease;
    }

    .cr-toggle--checked .cr-toggle__thumb {
        transform: translateX(16px);
    }
</style>
