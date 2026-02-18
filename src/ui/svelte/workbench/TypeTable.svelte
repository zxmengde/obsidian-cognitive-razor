<!--
  TypeTable.svelte — 类型置信度表格

  渲染 Define 结果中 5 种知识类型的置信度行：
  - 类型标签（i18n）、标准名称、置信度进度条、创建按钮
  - 最高置信度行：Primary 按钮 + 强调色进度条
  - 其余行：Ghost 按钮 + 淡化色进度条
  - 点击创建后通过 oncreate 回调通知父组件

  @see 需求 4.7, 4.8, 4.9
-->
<script lang="ts">
    import type { CRType, StandardizedConcept } from '../../../types';
    import { getCRContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import ProgressBar from '../../components/ProgressBar.svelte';

    /** 5 种知识类型的固定顺序 */
    const TYPE_ORDER: CRType[] = ['Domain', 'Issue', 'Theory', 'Entity', 'Mechanism'];

    let {
        concept,
        oncreate,
    }: {
        /** Define 返回的标准化概念数据 */
        concept: StandardizedConcept;
        /** 用户选择某类型创建时的回调 */
        oncreate?: (type: CRType) => void;
    } = $props();

    const ctx = getCRContext();
    const t = ctx.i18n.t();

    /** 按置信度排序的类型行数据 */
    let rows = $derived(
        TYPE_ORDER
            .map(type => ({
                type,
                label: (t.crTypes as Record<string, string>)?.[type] ?? type,
                name: concept.standardNames[type]?.chinese ?? '',
                confidence: concept.typeConfidences[type] ?? 0,
            }))
            .sort((a, b) => b.confidence - a.confidence)
    );

    /** 最高置信度值 */
    let maxConfidence = $derived(
        rows.length > 0 ? rows[0].confidence : 0
    );
</script>

<div class="cr-type-table" role="table" aria-label={t.workbench?.createConcept?.selectType ?? '选择概念类型'}>
    {#each rows as row (row.type)}
        {@const isPrimary = row.confidence === maxConfidence && maxConfidence > 0}
        <div
            class="cr-type-table__row"
            class:cr-type-table__row--primary={isPrimary}
            role="row"
        >
            <span class="cr-type-table__label" role="cell">{row.label}</span>
            <span class="cr-type-table__name" role="cell" title={row.name}>{row.name}</span>
            <div class="cr-type-table__bar" role="cell">
                <ProgressBar
                    value={row.confidence}
                    color={isPrimary ? 'default' : 'muted'}
                />
            </div>
            <div class="cr-type-table__action" role="cell">
                <Button
                    variant={isPrimary ? 'primary' : 'ghost'}
                    size="sm"
                    onclick={() => oncreate?.(row.type)}
                >
                    {t.workbench?.createConcept?.create ?? '创建'}
                </Button>
            </div>
        </div>
    {/each}
</div>

<style>
    .cr-type-table {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
    }

    .cr-type-table__row {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        padding: var(--cr-space-1) var(--cr-space-2);
        border-radius: var(--cr-radius-sm, 4px);
    }

    .cr-type-table__row--primary {
        background: var(--cr-bg-hover);
    }

    .cr-type-table__label {
        width: 48px;
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-muted);
        flex-shrink: 0;
    }

    .cr-type-table__name {
        flex: 1;
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .cr-type-table__bar {
        width: 60px;
        flex-shrink: 0;
    }

    .cr-type-table__action {
        flex-shrink: 0;
    }
</style>
