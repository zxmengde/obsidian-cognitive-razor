<!--
  MergeNameSelect.svelte — 合并名称选择控件

  职责：
  - 合并模式下在操作栏内显示名称选择
  - 支持下拉选择（笔记 A 名称 / 笔记 B 名称）+ 自定义输入

  @see 需求 9.7
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';

    let {
        names,
        selected = $bindable(''),
    }: {
        names: { nameA: string; nameB: string };
        selected: string;
    } = $props();

    const ctx = getCRContext();
    const t = ctx.i18n.t();

    /** 是否使用自定义输入 */
    let useCustom = $state(false);
    let customName = $state('');

    /** 下拉选项 */
    const options = $derived([
        { value: names.nameA, label: names.nameA },
        { value: names.nameB, label: names.nameB },
        { value: '__custom__', label: t.diff?.customName ?? '自定义名称...' },
    ]);

    /** 处理下拉变化 */
    function handleSelectChange(e: Event): void {
        const value = (e.target as HTMLSelectElement).value;
        if (value === '__custom__') {
            useCustom = true;
            selected = customName;
        } else {
            useCustom = false;
            selected = value;
        }
    }

    /** 处理自定义输入变化 */
    function handleCustomInput(e: Event): void {
        customName = (e.target as HTMLInputElement).value;
        selected = customName;
    }

    // 默认选中第一个名称
    $effect(() => {
        if (!selected && names.nameA) {
            selected = names.nameA;
        }
    });
</script>

<div class="cr-merge-name-select">
    <label class="cr-merge-label">
        {t.diff?.mergedNoteName ?? '合并后名称'}:
    </label>
    <select
        class="cr-merge-select"
        onchange={handleSelectChange}
        aria-label={t.diff?.mergedNoteName ?? '合并后名称'}
    >
        {#each options as opt}
            <option value={opt.value} selected={opt.value === selected}>
                {opt.label}
            </option>
        {/each}
    </select>
    {#if useCustom}
        <input
            class="cr-merge-custom-input"
            type="text"
            placeholder={t.diff?.customNamePlaceholder ?? '输入自定义名称'}
            value={customName}
            oninput={handleCustomInput}
            aria-label={t.diff?.customNamePlaceholder ?? '输入自定义名称'}
        />
    {/if}
</div>

<style>
    .cr-merge-name-select {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        flex-wrap: wrap;
    }

    .cr-merge-label {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-muted);
        white-space: nowrap;
    }

    .cr-merge-select {
        height: 28px;
        padding: 0 var(--cr-space-2);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-primary);
        color: var(--cr-text-primary);
        font-size: var(--cr-font-sm, 13px);
    }

    .cr-merge-custom-input {
        height: 28px;
        padding: 0 var(--cr-space-2);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-primary);
        color: var(--cr-text-primary);
        font-size: var(--cr-font-sm, 13px);
        min-width: 120px;
    }

    .cr-merge-custom-input:focus {
        border-color: var(--cr-accent);
        outline: none;
    }
</style>
