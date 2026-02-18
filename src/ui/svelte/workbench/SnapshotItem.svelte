<!--
  SnapshotItem.svelte — 快照列表项

  显示单条快照信息：
  - 操作类型标签 + 文件名 + 相对时间
  - 查看/撤销按钮（hover 淡入）

  @see 需求 8.3, 8.4, 8.5
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import type { SnapshotMetadata } from '../../../types';

    let {
        snapshot,
        fileName,
        operationLabel,
        relativeTime,
        onview,
        onundo,
    }: {
        snapshot: SnapshotMetadata;
        fileName: string;
        operationLabel: string;
        relativeTime: string;
        onview: (snapshot: SnapshotMetadata) => void;
        onundo: (snapshot: SnapshotMetadata) => void;
    } = $props();

    const ctx = getCRContext();
    const t = ctx.i18n.t();
</script>

<div class="cr-snapshot-item">
    <!-- 左侧信息 -->
    <div class="cr-snapshot-item__info">
        <span class="cr-snapshot-item__op">{operationLabel}</span>
        <span class="cr-snapshot-item__name" title={snapshot.path}>{fileName}</span>
        <span class="cr-snapshot-item__time">{relativeTime}</span>
    </div>

    <!-- 右侧操作按钮 -->
    <div class="cr-snapshot-item__actions">
        <Button
            variant="ghost"
            size="sm"
            ariaLabel={t.workbench?.recentOps?.viewAria ?? '查看快照'}
            onclick={(e: MouseEvent) => { e.stopPropagation(); onview(snapshot); }}
        >
            {t.workbench?.recentOps?.view ?? '查看'}
        </Button>
        <Button
            variant="ghost"
            size="sm"
            ariaLabel={t.workbench?.recentOps?.undoAria ?? '撤销此操作'}
            onclick={(e: MouseEvent) => { e.stopPropagation(); onundo(snapshot); }}
        >
            {t.workbench?.recentOps?.undo ?? '撤销'}
        </Button>
    </div>
</div>

<style>
    .cr-snapshot-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cr-space-2, 8px);
        padding: var(--cr-space-2, 8px);
        border-radius: var(--cr-radius-sm, 4px);
        transition: background 0.15s;
    }

    .cr-snapshot-item:hover {
        background: var(--cr-bg-hover);
    }

    .cr-snapshot-item__info {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
        min-width: 0;
        flex: 1;
    }

    .cr-snapshot-item__op {
        font-size: var(--font-ui-smaller, 11px);
        color: var(--cr-text-muted);
        padding: 1px 6px;
        border-radius: var(--cr-radius-sm, 4px);
        background: var(--cr-bg-secondary);
        flex-shrink: 0;
        white-space: nowrap;
    }

    .cr-snapshot-item__name {
        font-size: var(--font-ui-small, 13px);
        color: var(--cr-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .cr-snapshot-item__time {
        font-size: var(--font-ui-smaller, 11px);
        color: var(--cr-text-faint);
        flex-shrink: 0;
        white-space: nowrap;
    }

    /* 操作按钮：默认半透明，hover 淡入 */
    .cr-snapshot-item__actions {
        display: flex;
        gap: var(--cr-space-1, 4px);
        flex-shrink: 0;
        opacity: 0.4;
        transition: opacity 0.15s;
    }

    .cr-snapshot-item:hover .cr-snapshot-item__actions {
        opacity: 1;
    }

    /* 减弱动效 */
    @media (prefers-reduced-motion: reduce) {
        .cr-snapshot-item,
        .cr-snapshot-item__actions {
            transition: none;
        }
    }
</style>
