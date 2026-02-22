<!--
  Slider.svelte — 滑块控件，支持直接输入数字微调

  用于设置页中的数值范围配置项。
  滑块旁边有一个小的数字输入框，可以直接输入精确值。
  显示当前值 + 单位。

  @see 需求 10.4, 10.5
-->
<script lang="ts">
    let {
        value = 0,
        min = 0,
        max = 100,
        step = 1,
        unit = '',
        onchange,
        disabled = false,
        id = undefined,
    }: {
        value?: number;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
        onchange: (value: number) => void;
        disabled?: boolean;
        id?: string;
    } = $props();

    /** 滑块拖动 */
    function handleSlider(e: Event) {
        const target = e.target as HTMLInputElement;
        onchange(Number(target.value));
    }

    /** 数字输入框变更 */
    function handleInput(e: Event) {
        const target = e.target as HTMLInputElement;
        let num = Number(target.value);
        // 钳位到有效范围
        if (Number.isNaN(num)) return;
        num = Math.min(max, Math.max(min, num));
        onchange(num);
    }
</script>

<div class="cr-slider" class:cr-slider--disabled={disabled}>
    <input
        type="range"
        class="cr-slider__range"
        {id}
        {value}
        {min}
        {max}
        {step}
        {disabled}
        oninput={handleSlider}
    />
    <input
        type="number"
        class="cr-slider__number"
        {value}
        {min}
        {max}
        {step}
        {disabled}
        onchange={handleInput}
    />
    {#if unit}
        <span class="cr-slider__unit">{value}{unit}</span>
    {:else}
        <span class="cr-slider__unit">{value}</span>
    {/if}
</div>

<style>
    .cr-slider {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
    }

    .cr-slider--disabled {
        opacity: 0.5;
    }

    .cr-slider__range {
        flex: 1;
        min-width: 80px;
        cursor: pointer;
        accent-color: var(--cr-interactive-accent);
    }

    .cr-slider__range:disabled {
        cursor: not-allowed;
    }

    .cr-slider__number {
        width: 56px;
        padding: var(--cr-space-1, 4px);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-base);
        color: var(--cr-text-normal);
        font-size: var(--font-ui-small, 13px);
        text-align: center;
    }

    .cr-slider__number:focus-visible {
        outline: 2px solid var(--cr-border-focus);
        outline-offset: -1px;
    }

    .cr-slider__number:disabled {
        cursor: not-allowed;
    }

    .cr-slider__unit {
        color: var(--cr-text-muted);
        font-size: var(--font-ui-small, 13px);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        min-width: 48px;
        text-align: right;
    }
</style>
