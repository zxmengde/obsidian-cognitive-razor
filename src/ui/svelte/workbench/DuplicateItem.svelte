<!--
  DuplicateItem.svelte — 重复对列表项

  显示一对语义相似的概念：
  - 顶部相似度进度条（颜色分级：>90% 红、80-90% 橙、<80% 蓝）
  - 两个概念名称 + 类型标签 + 相似度百分比
  - 操作按钮（对比/忽略），hover 淡入

  @see 需求 7.3, 7.4, 7.5, 7.6, 7.7
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import ProgressBar from '../../components/ProgressBar.svelte';
    import Button from '../../components/Button.svelte';
    import type { DuplicatePair, CRType } from '../../../types';

    type BarColor = 'red' | 'orange' | 'blue';

    let {
        pair,
        nameA,
        nameB,
        oncompare,
        ondismiss,
    }: {
        pair: DuplicatePair;
        nameA: string;
        nameB: string;
        oncompare: (pair: DuplicatePair) => void;
        ondismiss: (pair: DuplicatePair) => void;
    } = $props();

    const ctx = getCRContext();
    const t = ctx.i18n.t();

    /** 相似度百分比 */
    let percent = $derived(Math.round(pair.similarity * 100));

    /** 进度条颜色分级 */
    let barColor: BarColor = $derived.by(() => {
        if (pair.similarity > 0.9) return 'red';
        if (pair.similarity >= 0.8) return 'orange';
        return 'blue';
    });

    /** 类型标签（通过 i18n 获取） */
    function getTypeLabel(type: CRType): string {
        return (t.crTypes as Record<string, string>)?.[type] ?? type;
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cr-dup-item" onclick={() => oncompare(pair)}>
    <!-- 相似度进度条 -->
    <div class="cr-dup-item__bar">
        <ProgressBar value={pair.similarity} color={barColor} />
    </div>

    <!-- 概念信息 -->
    <div class="cr-dup-item__body">
        <div class="cr-dup-item__concepts">
            <span class="cr-dup-item__name">{nameA}</span>
            <span class="cr-dup-item__vs" aria-hidden="true">↔</span>
            <span class="cr-dup-item__name">{nameB}</span>
        </div>
        <div class="cr-dup-item__meta">
            <span class="cr-dup-item__type">{getTypeLabel(pair.type)}</span>
            <span class="cr-dup-item__similarity">{percent}%</span>
        </div>
    </div>

    <!-- 操作按钮 -->
    <div class="cr-dup-item__actions">
        <Button
            variant="ghost"
            size="sm"
            ariaLabel={t.workbench?.duplicates?.compareAria ?? '对比合并'}
            onclick={(e: MouseEvent) => { e.stopPropagation(); oncompare(pair); }}
        >
            {t.workbench?.duplicates?.compare ?? '对比'}
        </Button>
        <Button
            variant="ghost"
            size="sm"
            ariaLabel={t.workbench?.duplicates?.dismissAria ?? '忽略此重复对'}
            onclick={(e: MouseEvent) => { e.stopPropagation(); ondismiss(pair); }}
        >
            {t.workbench?.duplicates?.dismiss ?? '忽略'}
        </Button>
    </div>
</div>

<style>
    .cr-dup-item {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1, 4px);
        padding: var(--cr-space-2, 8px);
        border-radius: var(--cr-radius-sm, 4px);
        cursor: pointer;
        transition: background 0.15s;
    }

    .cr-dup-item:hover {
        background: var(--cr-bg-hover);
    }

    .cr-dup-item__bar {
        width: 100%;
    }

    .cr-dup-item__body {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cr-space-2, 8px);
        min-width: 0;
    }

    .cr-dup-item__concepts {
        display: flex;
        align-items: center;
        gap: var(--cr-space-1, 4px);
        min-width: 0;
        flex: 1;
    }

    .cr-dup-item__name {
        font-size: var(--font-ui-small, 13px);
        color: var(--cr-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 40%;
    }

    .cr-dup-item__vs {
        font-size: 11px;
        color: var(--cr-text-faint);
        flex-shrink: 0;
    }

    .cr-dup-item__meta {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
        flex-shrink: 0;
    }

    .cr-dup-item__type {
        font-size: var(--font-ui-smaller, 11px);
        color: var(--cr-text-muted);
        padding: 1px 6px;
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-secondary);
    }

    .cr-dup-item__similarity {
        font-size: var(--font-ui-smaller, 11px);
        color: var(--cr-text-muted);
        font-variant-numeric: tabular-nums;
    }

    /* 操作按钮：默认半透明，hover 淡入 */
    .cr-dup-item__actions {
        display: flex;
        gap: var(--cr-space-1, 4px);
        justify-content: flex-end;
        opacity: 0.4;
        transition: opacity 0.15s;
    }

    .cr-dup-item:hover .cr-dup-item__actions {
        opacity: 1;
    }

    /* 减弱动效 */
    @media (prefers-reduced-motion: reduce) {
        .cr-dup-item,
        .cr-dup-item__actions {
            transition: none;
        }
    }
</style>
