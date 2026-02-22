<!--
  MiniProgress.svelte — SVG 环形迷你进度指示器

  当有 Running 任务时显示环形进度，尺寸 20x20px。

  @see UI/UX 优化计划 §3.6
-->
<script lang="ts">
    let {
        value = 0,
        size = 20,
    }: {
        /** 进度值 0-1 */
        value?: number;
        /** 尺寸（px） */
        size?: number;
    } = $props();

    const STROKE_WIDTH = 2.5;
    let radius = $derived((size - STROKE_WIDTH) / 2);
    let circumference = $derived(2 * Math.PI * radius);
    let offset = $derived(circumference * (1 - Math.min(Math.max(value, 0), 1)));
</script>

<svg
    class="cr-mini-progress"
    width={size}
    height={size}
    viewBox="0 0 {size} {size}"
    role="progressbar"
    aria-valuenow={Math.round(value * 100)}
    aria-valuemin={0}
    aria-valuemax={100}
>
    <!-- 背景环 -->
    <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--cr-border)"
        stroke-width={STROKE_WIDTH}
    />
    <!-- 进度环 -->
    <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--cr-interactive-accent)"
        stroke-width={STROKE_WIDTH}
        stroke-dasharray={circumference}
        stroke-dashoffset={offset}
        stroke-linecap="round"
        transform="rotate(-90 {size / 2} {size / 2})"
        class="cr-mini-progress__ring"
    />
</svg>

<style>
    .cr-mini-progress {
        flex-shrink: 0;
    }

    .cr-mini-progress__ring {
        transition: stroke-dashoffset 0.3s ease;
    }

    @media (prefers-reduced-motion: reduce) {
        .cr-mini-progress__ring {
            transition: none;
        }
    }
</style>
