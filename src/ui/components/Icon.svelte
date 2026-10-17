<!--
  Icon.svelte — Lucide 图标包装组件

  通过 Obsidian 内置的 setIcon API 渲染 Lucide SVG 图标。
  统一尺寸（16px/20px）和颜色继承。

  @see UI/UX 优化计划 §5.1
-->
<script lang="ts">
    import { setIcon } from 'obsidian';

    let {
        name,
        size = 16,
        ariaHidden = true,
        className = '',
    }: {
        /** Lucide 图标名称 */
        name: string;
        /** 图标尺寸（px） */
        size?: 16 | 20;
        /** 是否对屏幕阅读器隐藏 */
        ariaHidden?: boolean;
        /** 额外 CSS 类名 */
        className?: string;
    } = $props();

    let iconEl: HTMLSpanElement | undefined = $state(undefined);

    $effect(() => {
        if (iconEl && name) {
            iconEl.empty();
            setIcon(iconEl, name);
            // 统一 SVG 尺寸
            const svg = iconEl.querySelector('svg');
            if (svg) {
                svg.setAttribute('width', String(size));
                svg.setAttribute('height', String(size));
                svg.style.width = `${size}px`;
                svg.style.height = `${size}px`;
            }
        }
    });
</script>

<span
    bind:this={iconEl}
    class="cr-icon {className}"
    class:cr-icon--20={size === 20}
    aria-hidden={ariaHidden ? 'true' : undefined}
></span>

<style>
    .cr-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        color: inherit;
    }

    .cr-icon--20 {
        width: 20px;
        height: 20px;
    }

    .cr-icon :global(svg) {
        display: block;
    }
</style>
