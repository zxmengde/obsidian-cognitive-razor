<!--
  DuplicateItem.svelte — 重复对列表项

  显示一对语义相似的概念：
  - 顶部相似度进度条（颜色分级：>90% 红、80-90% 橙、<80% 蓝）
  - 两个概念名称 + 类型标签 + 相似度百分比
  - 忽略按钮，hover 淡入

-->
<script lang="ts">
    import { getWorkbenchContext } from '../../bridge/context';
    import Icon from '../../components/Icon.svelte';
    import ProgressBar from '../../components/ProgressBar.svelte';
    import Button from '../../components/Button.svelte';
    import type { DuplicatePair, CRType } from '../../../types';

    type BarColor = 'red' | 'orange' | 'blue';

    let {
        pair,
        nameA,
        nameB,
        dismissing = false,
        ondismiss,
        onmerge,
    }: {
        pair: DuplicatePair;
        nameA: string;
        nameB: string;
        dismissing?: boolean;
        ondismiss: (pair: DuplicatePair) => void;
        onmerge: (pair: DuplicatePair) => void;
    } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;

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
        return t.crTypes[type];
    }
</script>

    <div
    class="cr-dup-item"
    role="listitem"
    aria-label={ctx.i18n.format('workbench.duplicates.ariaLabel', { nameA, nameB, percent })}
>
    <!-- 相似度进度条 -->
    <div class="cr-dup-item__bar">
        <ProgressBar value={pair.similarity} color={barColor} />
    </div>

    <!-- 概念信息 -->
    <div class="cr-dup-item__body">
        <div class="cr-dup-item__concepts">
            <span class="cr-dup-item__name">{nameA}</span>
            <span class="cr-dup-item__vs" aria-hidden="true">
                <Icon name="arrow-left-right" size={16} />
            </span>
            <span class="cr-dup-item__name">{nameB}</span>
        </div>
        <div class="cr-dup-item__meta">
            <span class="cr-dup-item__type">{getTypeLabel(pair.type)}</span>
            <span class="cr-dup-item__similarity">{percent}%</span>
        </div>
    </div>

    <!-- 操作按钮 -->
    <div class="cr-dup-item__actions">
        <Button variant="primary" size="sm" ariaLabel={t.workbench.duplicates.mergeAria} onclick={(e: MouseEvent) => { e.stopPropagation(); onmerge(pair); }}>
            {t.workbench.duplicates.merge}
        </Button>
        <Button
            variant="ghost"
            size="sm"
            loading={dismissing}
            disabled={dismissing}
            ariaLabel={t.workbench.duplicates.dismissAria}
            onclick={(e: MouseEvent) => { e.stopPropagation(); if (!dismissing) ondismiss(pair); }}
        >
            {t.workbench.duplicates.dismiss}
        </Button>
    </div>
</div>

<style>
    .cr-dup-item {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
        padding: var(--cr-space-2);
        border-radius: var(--cr-radius-sm);
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
        gap: var(--cr-space-2);
        min-width: 0;
    }

    .cr-dup-item__concepts {
        display: flex;
        align-items: center;
        gap: var(--cr-space-1);
        min-width: 0;
        flex: 1;
    }

    .cr-dup-item__name {
        font-size: var(--font-ui-small);
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
        gap: var(--cr-space-2);
        flex-shrink: 0;
    }

    .cr-dup-item__type {
        font-size: var(--font-ui-smaller);
        color: var(--cr-text-muted);
        padding: 1px 6px;
        border-radius: var(--cr-radius-sm);
        background: var(--cr-bg-secondary);
    }

    .cr-dup-item__similarity {
        font-size: var(--font-ui-smaller);
        color: var(--cr-text-muted);
        font-variant-numeric: tabular-nums;
    }

    /* 操作按钮：默认半透明，hover 淡入 */
    .cr-dup-item__actions {
        display: flex;
        gap: var(--cr-space-1);
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
