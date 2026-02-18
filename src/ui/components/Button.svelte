<!--
  Button.svelte — 通用按钮组件
  
  支持四种变体（Primary/Secondary/Ghost/Danger）、三种尺寸（默认/小/图标）、
  disabled 和 loading 状态，以及完整的 ARIA 无障碍属性。
  
  按钮样式由全局 styles.css 中的 cr-btn-* 类定义，本组件仅负责
  根据 props 组装正确的 CSS 类名和 ARIA 属性。
  
  @see 需求 16.4, 16.5, 16.6, 14.5
-->
<script lang="ts">
    import type { Snippet } from 'svelte';

    /** 按钮变体 */
    type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
    /** 按钮尺寸 */
    type ButtonSize = 'default' | 'sm' | 'icon';

    let {
        variant = 'secondary',
        size = 'default',
        disabled = false,
        loading = false,
        ariaLabel = undefined,
        onclick = undefined,
        children,
    }: {
        variant?: ButtonVariant;
        size?: ButtonSize;
        disabled?: boolean;
        loading?: boolean;
        ariaLabel?: string | undefined;
        onclick?: ((e: MouseEvent) => void) | undefined;
        children?: Snippet;
    } = $props();

    /** 变体 → CSS 类映射 */
    const VARIANT_CLASS: Record<ButtonVariant, string> = {
        primary: 'cr-btn-primary',
        secondary: 'cr-btn-secondary',
        ghost: 'cr-btn-ghost',
        danger: 'cr-btn-danger',
    };

    /** 尺寸 → CSS 类映射 */
    const SIZE_CLASS: Record<ButtonSize, string> = {
        default: '',
        sm: 'cr-btn--sm',
        icon: 'cr-btn--icon',
    };

    /** 组合后的 CSS 类名 */
    let className = $derived(
        [
            VARIANT_CLASS[variant],
            SIZE_CLASS[size],
            loading ? 'is-loading' : '',
        ]
            .filter(Boolean)
            .join(' ')
    );

    /** disabled 或 loading 时均禁用交互 */
    let isDisabled = $derived(disabled || loading);
</script>

<button
    class={className}
    disabled={isDisabled}
    aria-disabled={isDisabled ? 'true' : undefined}
    aria-label={ariaLabel}
    aria-busy={loading ? 'true' : undefined}
    onclick={isDisabled ? undefined : onclick}
>
    {#if loading}
        <span class="cr-loading-spinner" aria-hidden="true"></span>
    {/if}
    {#if children}
        {@render children()}
    {/if}
</button>
