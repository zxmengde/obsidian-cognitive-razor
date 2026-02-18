<!--
  HistorySection.svelte — 工作台历史区

  职责：
  - Collapsible 包装（默认折叠，折叠持久化，header 显示数量 badge + 清空按钮）
  - 最多显示 10 条快照，超出显示"还有 N 条更早的记录"
  - 当前打开笔记的快照自动置顶，监听活跃文件变化实时重排
  - 查看打开 Diff 标签页（Snapshot 模式），撤销直接恢复 + Notice
  - 清空全部需确认 Modal

  @see 需求 8.1-8.9
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import type { TFile } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import { openDiffTab } from '../diff-utils';
    import Collapsible from '../../components/Collapsible.svelte';
    import EmptyState from '../../components/EmptyState.svelte';
    import Button from '../../components/Button.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import SnapshotItem from './SnapshotItem.svelte';
    import type { SnapshotMetadata } from '../../../types';
    import type { UndoManager } from '../../../core/undo-manager';
    import type { SettingsStore } from '../../../data/settings-store';
    import type { Logger } from '../../../data/logger';

    /** 最大显示条数 */
    const MAX_DISPLAY = 10;

    let {
        snapshots,
        activeFile,
        onRefresh,
    }: {
        snapshots: SnapshotMetadata[];
        activeFile: TFile | null;
        onRefresh: () => Promise<void>;
    } = $props();

    // 从 Context 获取服务
    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const app = ctx.app;
    const undoManager = ctx.container.resolve<UndoManager>(SERVICE_TOKENS.undoManager);
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 折叠状态（从设置持久化读取，默认折叠）
    let collapsed = $state(
        settingsStore.getSettings().uiState?.sectionCollapsed?.history ?? true
    );

    // 清空确认 Modal 状态
    let showClearConfirm = $state(false);

    /** 操作类型 → i18n 标签映射 */
    const opLabels = t.workbench?.recentOps?.operationLabels ?? {};

    /** 按活跃文件置顶 + 时间降序排列 */
    let sortedSnapshots = $derived.by(() => {
        const activePath = activeFile?.path ?? '';
        return [...snapshots].sort((a, b) => {
            const aMatch = a.path === activePath ? 1 : 0;
            const bMatch = b.path === activePath ? 1 : 0;
            if (aMatch !== bMatch) return bMatch - aMatch;
            // 同组内按时间降序
            return new Date(b.created).getTime() - new Date(a.created).getTime();
        });
    });

    /** 截取显示列表 */
    let displayList = $derived(sortedSnapshots.slice(0, MAX_DISPLAY));

    /** 超出条数 */
    let overflowCount = $derived(
        sortedSnapshots.length > MAX_DISPLAY
            ? sortedSnapshots.length - MAX_DISPLAY
            : 0
    );

    /** 从文件路径提取文件名（不含扩展名） */
    function extractFileName(filePath: string): string {
        const parts = filePath.split('/');
        const name = parts[parts.length - 1] ?? filePath;
        return name.replace(/\.md$/, '');
    }

    /** 根据 taskId 推断操作类型标签 */
    function getOperationLabel(taskId: string): string {
        // taskId 格式通常为 "type-xxx"，提取前缀
        const prefix = taskId.split('-')[0]?.toLowerCase() ?? '';
        const labels = opLabels as Record<string, string>;
        return labels[prefix] ?? labels['fallback'] ?? '操作';
    }

    /** 计算相对时间 */
    function getRelativeTime(created: string): string {
        const now = Date.now();
        const then = new Date(created).getTime();
        const diffMs = now - then;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHour = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        const ops = t.workbench?.recentOps;
        if (diffMin < 1) return ops?.timeJustNow ?? '刚刚';
        if (diffMin < 60) return (ops?.timeMinutesAgo ?? '{minutes} 分钟前').replace('{minutes}', String(diffMin));
        if (diffHour < 24) return (ops?.timeHoursAgo ?? '{hours} 小时前').replace('{hours}', String(diffHour));
        return (ops?.timeDaysAgo ?? '{days} 天前').replace('{days}', String(diffDay));
    }

    /** 折叠状态变化时持久化 */
    function handleToggle(newCollapsed: boolean): void {
        collapsed = newCollapsed;
        void settingsStore.updateSettings({
            uiState: {
                sectionCollapsed: { history: newCollapsed },
            },
        } as any);
    }

    /** 查看快照：打开 Diff 标签页（Snapshot 模式） */
    async function handleView(snapshot: SnapshotMetadata): Promise<void> {
        logger.info('HistorySection', '用户请求查看快照', { snapshotId: snapshot.id });

        try {
            // 读取快照内容（旧内容）
            const snapshotResult = await undoManager.restoreSnapshot(snapshot.id);
            if (!snapshotResult.ok) {
                new Notice(t.workbench?.recentOps?.viewSnapshotFailed ?? '读取快照失败');
                return;
            }

            const snapshotData = snapshotResult.value;

            // 读取当前文件内容（新内容）
            const file = app.vault.getAbstractFileByPath(snapshot.path);
            let currentContent = '';
            if (file && 'extension' in file) {
                currentContent = await app.vault.read(file as import('obsidian').TFile);
            }

            const fileName = extractFileName(snapshot.path);

            // 打开 Snapshot Diff 标签页
            await openDiffTab(app, {
                mode: 'snapshot',
                noteName: fileName,
                oldContent: snapshotData.content,
                newContent: currentContent,
                snapshotId: snapshot.id,
                onAccept: async () => {
                    // 接受 = 恢复到快照版本
                    logger.info('HistorySection', '用户接受恢复快照', { snapshotId: snapshot.id });
                    const result = await undoManager.restoreSnapshotToFile(snapshot.id);
                    if (result.ok) {
                        new Notice(t.workbench?.recentOps?.undo ?? '已恢复');
                        await onRefresh();
                    } else {
                        new Notice(t.workbench?.recentOps?.undoFailed ?? '恢复失败');
                    }
                },
                onReject: () => {
                    logger.info('HistorySection', '用户取消恢复快照', { snapshotId: snapshot.id });
                },
            });
        } catch (error) {
            logger.error('HistorySection', '打开快照对比失败', error as Error, { snapshotId: snapshot.id });
            new Notice(t.workbench?.recentOps?.viewSnapshotFailed ?? '打开快照对比失败');
        }
    }

    /** 撤销：恢复快照内容 + Notice 反馈 */
    async function handleUndo(snapshot: SnapshotMetadata): Promise<void> {
        logger.info('HistorySection', '用户请求撤销操作', { snapshotId: snapshot.id });
        const result = await undoManager.restoreSnapshotToFile(snapshot.id);
        if (result.ok) {
            new Notice(t.workbench?.recentOps?.undo ?? '已撤销');
            // 刷新快照列表
            await onRefresh();
        } else {
            logger.error('HistorySection', '撤销操作失败', undefined, { snapshotId: snapshot.id });
            new Notice(t.workbench?.recentOps?.undo ?? '撤销失败');
        }
    }

    /** 清空全部：显示确认 Modal */
    function handleClearAllClick(): void {
        showClearConfirm = true;
    }

    /** 确认清空 */
    async function handleClearConfirm(): Promise<void> {
        showClearConfirm = false;
        const result = await undoManager.clearAllSnapshots();
        if (result.ok) {
            new Notice(t.workbench?.recentOps?.clearAll ?? '已清空全部');
            await onRefresh();
        } else {
            logger.error('HistorySection', '清空快照失败');
            new Notice(t.workbench?.recentOps?.clearAll ?? '清空失败');
        }
    }

    /** 取消清空 */
    function handleClearCancel(): void {
        showClearConfirm = false;
    }
</script>

<Collapsible
    title={t.workbench?.recentOps?.title ?? '操作历史'}
    count={snapshots.length}
    {collapsed}
    onToggle={handleToggle}
>
    {#snippet actions()}
        {#if snapshots.length > 0}
            <Button
                variant="ghost"
                size="sm"
                ariaLabel={t.workbench?.recentOps?.clearAll ?? '清空全部'}
                onclick={(e: MouseEvent) => { e.stopPropagation(); handleClearAllClick(); }}
            >
                {t.workbench?.recentOps?.clearAll ?? '清空全部'}
            </Button>
        {/if}
    {/snippet}

    {#if displayList.length > 0}
        <div class="cr-history-list">
            {#each displayList as snap (snap.id)}
                <SnapshotItem
                    snapshot={snap}
                    fileName={extractFileName(snap.path)}
                    operationLabel={getOperationLabel(snap.taskId)}
                    relativeTime={getRelativeTime(snap.created)}
                    onview={(s) => void handleView(s)}
                    onundo={(s) => void handleUndo(s)}
                />
            {/each}
        </div>
        {#if overflowCount > 0}
            <p class="cr-history-overflow">
                {(t.workbench?.recentOps?.moreSnapshots ?? '还有 {count} 个更早的快照').replace('{count}', String(overflowCount))}
            </p>
        {/if}
    {:else}
        <EmptyState message={t.workbench?.recentOps?.empty ?? '暂无可撤销的操作'} />
    {/if}
</Collapsible>

{#if showClearConfirm}
    <ConfirmModal
        title={t.workbench?.recentOps?.clearAllConfirmTitle ?? '确认清空'}
        message={t.workbench?.recentOps?.clearAllConfirmMessage ?? '确定要清空所有快照吗？此操作不可撤销。'}
        danger={true}
        onconfirm={() => void handleClearConfirm()}
        oncancel={handleClearCancel}
    />
{/if}

<style>
    .cr-history-list {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1, 4px);
    }

    .cr-history-overflow {
        text-align: center;
        color: var(--cr-text-faint);
        font-size: var(--font-ui-smaller, 11px);
        padding: var(--cr-space-2, 8px) 0;
        margin: 0;
    }
</style>
