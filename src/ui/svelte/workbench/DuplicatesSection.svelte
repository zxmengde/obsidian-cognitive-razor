<!--
  DuplicatesSection.svelte — 工作台重复对区

  职责：
  - Collapsible 包装（默认展开，折叠持久化，header 显示数量 badge）
  - 列表按相似度降序排列
  - 点击对比打开 Diff 标签页（Merge 模式），点击忽略 Notice 反馈
  - 空状态显示"暂无重复概念"

  @see 需求 7.1-7.8, 9.13
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import { openDiffTab } from '../diff-utils';
    import Collapsible from '../../components/Collapsible.svelte';
    import EmptyState from '../../components/EmptyState.svelte';
    import DuplicateItem from './DuplicateItem.svelte';
    import type { DuplicatePair } from '../../../types';
    import type { DuplicateManager } from '../../../core/duplicate-manager';
    import type { SettingsStore } from '../../../data/settings-store';
    import type { CruidCache } from '../../../core/cruid-cache';
    import type { Logger } from '../../../data/logger';

    let {
        pairs,
    }: {
        pairs: DuplicatePair[];
    } = $props();

    // 从 Context 获取服务
    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const app = ctx.app;
    const duplicateManager = ctx.container.resolve<DuplicateManager>(SERVICE_TOKENS.duplicateManager);
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);
    const cruidCache = ctx.container.resolve<CruidCache>(SERVICE_TOKENS.cruidCache);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 折叠状态（从设置持久化读取，默认展开）
    let collapsed = $state(
        settingsStore.getSettings().uiState?.sectionCollapsed?.duplicates ?? false
    );

    /** 按相似度降序排列 */
    let sortedPairs = $derived(
        [...pairs].sort((a, b) => b.similarity - a.similarity)
    );

    /** 通过 CruidCache 解析概念名称 */
    function resolveName(nodeId: string): string {
        return cruidCache.getName(nodeId) ?? nodeId;
    }

    /** 折叠状态变化时持久化 */
    function handleToggle(newCollapsed: boolean): void {
        collapsed = newCollapsed;
        void settingsStore.updateSettings({
            uiState: {
                sectionCollapsed: { duplicates: newCollapsed },
            },
        } as any);
    }

    /** 读取笔记文件内容 */
    async function readNoteContent(nodeId: string): Promise<string> {
        const file = cruidCache.getFile(nodeId);
        if (!file) return '';
        return await app.vault.read(file);
    }

    /** 点击对比：打开 Diff 标签页（Merge 模式） */
    async function handleCompare(pair: DuplicatePair): Promise<void> {
        logger.info('DuplicatesSection', '用户请求对比重复对', { pairId: pair.id });

        const nameA = resolveName(pair.nodeIdA);
        const nameB = resolveName(pair.nodeIdB);

        try {
            // 读取两个笔记的内容
            const [contentA, contentB] = await Promise.all([
                readNoteContent(pair.nodeIdA),
                readNoteContent(pair.nodeIdB),
            ]);

            if (!contentA && !contentB) {
                new Notice(t.workbench?.notifications?.compareNoContent ?? '无法读取笔记内容');
                return;
            }

            // 打开 Merge Diff 标签页
            await openDiffTab(app, {
                mode: 'merge',
                noteName: `${nameA} ↔ ${nameB}`,
                oldContent: contentA,
                newContent: contentB,
                mergeNames: { nameA, nameB },
                mergePairId: pair.id,
                onAccept: () => {
                    logger.info('DuplicatesSection', '用户接受合并', { pairId: pair.id });
                },
                onReject: () => {
                    logger.info('DuplicatesSection', '用户拒绝合并', { pairId: pair.id });
                },
            });
        } catch (error) {
            logger.error('DuplicatesSection', '打开对比标签页失败', error as Error, { pairId: pair.id });
            new Notice(t.workbench?.notifications?.compareFailed ?? '打开对比失败');
        }
    }

    /** 点击忽略：标记为非重复 + Notice 反馈 */
    async function handleDismiss(pair: DuplicatePair): Promise<void> {
        const result = await duplicateManager.markAsNonDuplicate(pair.id);
        if (result.ok) {
            new Notice(t.workbench?.notifications?.dismissSuccess ?? '已忽略重复对');
        } else {
            logger.error('DuplicatesSection', '忽略重复对失败', undefined, { pairId: pair.id });
            new Notice(t.workbench?.notifications?.dismissFailed ?? '忽略失败');
        }
    }
</script>

<Collapsible
    title={t.workbench?.duplicates?.title ?? '重复概念'}
    count={pairs.length}
    {collapsed}
    onToggle={handleToggle}
>
    {#if sortedPairs.length > 0}
        <div class="cr-dup-list">
            {#each sortedPairs as pair (pair.id)}
                <DuplicateItem
                    {pair}
                    nameA={resolveName(pair.nodeIdA)}
                    nameB={resolveName(pair.nodeIdB)}
                    oncompare={(p) => void handleCompare(p)}
                    ondismiss={(p) => void handleDismiss(p)}
                />
            {/each}
        </div>
    {:else}
        <EmptyState message={t.workbench?.duplicates?.empty ?? '暂无重复概念'} />
    {/if}
</Collapsible>

<style>
    .cr-dup-list {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1, 4px);
    }
</style>
