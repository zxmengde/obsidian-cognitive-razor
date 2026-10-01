<!--
  TypeTable.svelte — 类型置信度表格

  渲染 Define 预览中的知识类型候选：
  - 类型标签（i18n）、标准名称、置信度进度条、创建按钮
  - 最高置信度行：Primary 按钮 + 强调色进度条
  - 其余行：Ghost 按钮 + 淡化色进度条
  - 点击创建后通过 oncreate 回调通知父组件

-->
<script lang="ts">
    import type { CRType, DefinePreview } from '../../../types';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import ProgressBar from '../../components/ProgressBar.svelte';

    /** 知识类型的固定顺序 */
    const TYPE_ORDER: CRType[] = ['domain', 'issue', 'theory', 'entity', 'mechanism'];

    let {
        concept,
        oncreate,
        types = TYPE_ORDER,
    }: {
        /** Define 返回的临时预览 */
        concept: DefinePreview;
        /** 用户选择某类型创建时的回调 */
        oncreate?: (type: CRType) => void;
        /** Optional restriction used by an Expand confirmation. */
        types?: readonly CRType[];
    } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;

    /** 按置信度排序的类型行数据 */
    let rows = $derived(
        TYPE_ORDER
            .filter(type => types.includes(type))
            .map(type => ({
                type,
                label: t.crTypes[type],
                name: concept.candidates[type]?.name.chinese.trim() || concept.candidates[type]?.name.english.trim() || '',
                confidence: concept.candidates[type]?.confidence ?? 0,
            }))
            .sort((a, b) => b.confidence - a.confidence)
    );

    /** 最高置信度值 */
    let maxConfidence = $derived(
        rows.length > 0 ? rows[0].confidence : 0
    );
</script>

<div class="cr-type-table" role="table" aria-label={t.workbench.createConcept.selectType}>
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
                    {t.workbench.createConcept.create}
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
        border-radius: var(--cr-radius-sm);
    }

    .cr-type-table__row--primary {
        background: var(--cr-bg-hover);
    }

    .cr-type-table__label {
        width: 48px;
        font-size: var(--cr-font-sm);
        color: var(--cr-text-muted);
        flex-shrink: 0;
    }

    .cr-type-table__name {
        flex: 1;
        font-size: var(--cr-font-sm);
        color: var(--cr-text-normal);
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
