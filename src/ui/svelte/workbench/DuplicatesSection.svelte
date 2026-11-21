<!--
  DuplicatesSection.svelte — 工作台重复对区

  职责：
  - 默认收起，标题行显示数量
  - 列表按相似度降序排列，每项显示该重复对的合并稿状态（来自任务队列）
  - 恢复记录显示停在哪一步

-->
<script lang="ts">
    import { fade } from 'svelte/transition';
    import { SvelteMap, SvelteSet } from 'svelte/reactivity';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import DuplicateItem from './DuplicateItem.svelte';
    import type { DuplicatePair, DuplicateMergePreview, TaskRecord } from '../../../types';
    import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';
    import MergeModal from './MergeModal.svelte';

    let {
        pairs,
        tasks = [],
    }: {
        pairs: DuplicatePair[];
        tasks?: TaskRecord[];
    } = $props();

    // 从 Context 获取服务
    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
    const duplicates = ctx.application.duplicates;
    const detailsToggleLabels = {
        expand: t.common.details.expand,
        collapse: t.common.details.collapse,
    };

    let collapsed = $state(true);
    let displaySettings = $state(ctx.settingsApplication.getSettings());
    const unsubscribeSettings = ctx.settingsApplication.subscribeSettings(value => displaySettings = value);
    $effect(() => () => unsubscribeSettings());
    let feedback = $state<UiFeedback | null>(null);
    const dismissingIds = new SvelteSet<string>();
    let activeMergePair = $state<DuplicatePair | null>(null);
    let readyMergePreview = $state<DuplicateMergePreview | undefined>(undefined);
    let openingMerge = 0;
    $effect(() => () => { openingMerge++; });
    let recovery = $state(duplicates.getRecoveryOperations());
    const recoveryIds = new SvelteSet<string>();

    /** 按相似度降序排列 */
    let sortedPairs = $derived(
        [...pairs].sort((a, b) => b.similarity - a.similarity)
    );

    /**
     * 每个重复对最近一次合并稿任务的状态。用户提交后可以离开对话框，
     * 列表需要告诉他稿子在生成还是已经可以审阅。
     */
    let latestMergeTasks = $derived.by(() => {
        const latest = new SvelteMap<string, TaskRecord>();
        for (const task of tasks) {
            if (task.stageId !== 'merge') continue;
            const pairId = (task.payload as { pairId?: string }).pairId;
            if (!pairId) continue;
            const current = latest.get(pairId);
            if (!current || task.createdAt > current.createdAt) latest.set(pairId, task);
        }
        return latest;
    });
    let mergeStates = $derived.by(() => {
        const states = new SvelteMap<string, 'generating' | 'ready'>();
        for (const [pairId, task] of latestMergeTasks) {
            if (task.state === 'pending' || task.state === 'running') states.set(pairId, 'generating');
            else if (task.state === 'completed') states.set(pairId, 'ready');
        }
        return states;
    });

    /** 通过 CruidCache 解析概念名称 */
    function resolveName(nodeId: string): string {
        return duplicates.getConceptName(nodeId) ?? nodeId;
    }


    /**
     * The recovery log is a service read model, not an event stream: a merge
     * that fails mid-way must show its continuation entry without reopening
     * the workbench.
     */
    function refreshRecovery(): void {
        recovery = duplicates.getRecoveryOperations();
    }
    async function openMerge(pair: DuplicatePair): Promise<void> {
        const generation = ++openingMerge;
        try {
            // 生成中的任务由对话框接上；刚完成的任务直接按 workflowId 读稿，
            // 只有队列里已没有记录时才扫描草稿目录找旧稿。
            const task = latestMergeTasks.get(pair.id);
            const ready = task && (task.state === 'pending' || task.state === 'running')
                ? { ok: true as const, value: undefined }
                : task?.state === 'completed' && task.workflowId
                    ? await duplicates.getMergeDraft(task.workflowId)
                    : await duplicates.findReadyMergeDraft(pair.id);
            if (generation !== openingMerge) return;
            if (!ready.ok) { feedback = toSafeErrorFeedback(ready.error, t.workbench.notifications.mergeFailed); return; }
            readyMergePreview = ready.value;
            activeMergePair = pair;
        } catch (error) { if (generation === openingMerge) feedback = toSafeErrorFeedback(error, t.workbench.notifications.mergeFailed); }
    }

    /** 点击忽略：标记为非重复 + Notice 反馈 */
    async function handleDismiss(pair: DuplicatePair): Promise<void> {
        if (dismissingIds.has(pair.id)) return;
        dismissingIds.add(pair.id);
        feedback = null;
        try {
            const result = await duplicates.dismiss(pair.id);
            if (result.ok) {
                feedback = { level: 'success', message: t.workbench.notifications.dismissSuccess };
            } else {
                feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.dismissFailed);
            }
        } catch (e) {
            feedback = toSafeErrorFeedback(e, t.workbench.notifications.dismissFailed);
        } finally {
            dismissingIds.delete(pair.id);
        }
    }

    async function handleRecovery(operationId: string): Promise<void> {
        if (recoveryIds.has(operationId)) return;
        recoveryIds.add(operationId);
        feedback = null;
        try {
            const result = await duplicates.resumeMerge(operationId);
            if (result.ok) {
                recovery = recovery.filter((operation) => operation.id !== operationId);
                feedback = { level: 'success', message: t.workbench.recovery.actionCompleted };
            } else {
                recovery = duplicates.getRecoveryOperations();
                feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.mergeFailed);
            }
        } catch (error) {
            feedback = toSafeErrorFeedback(error, t.workbench.notifications.mergeFailed);
        } finally {
            recoveryIds.delete(operationId);
        }
    }

    async function handleDiscardRecovery(operationId: string): Promise<void> {
        if (recoveryIds.has(operationId)) return;
        recoveryIds.add(operationId);
        try {
            const result = await duplicates.discardRecovery(operationId);
            if (result.ok) recovery = recovery.filter((operation) => operation.id !== operationId);
            else feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.mergeFailed);
        } finally {
            recoveryIds.delete(operationId);
        }
    }
</script>

{#if recovery.length > 0}
    <section class="cr-dup-recovery" aria-live="polite">
        <div class="cr-dup-recovery__heading">
            <strong>{t.workbench.recovery.title}</strong>
            <span>{t.workbench.recovery.summary.replace('{count}', String(recovery.length))}</span>
        </div>
        {#each recovery as operation (operation.id)}
            <div class="cr-dup-recovery__item">
                <span>{operation.preview.canonical.path} → {operation.preview.redundant.path}</span>
                <span class="cr-dup-recovery__phase">{ctx.i18n.format('workbench.recovery.stoppedAt', { phase: t.workbench.recovery.phases[operation.phase] })}</span>
                <div class="cr-dup-recovery__actions">
                    <Button size="sm" variant="primary" loading={recoveryIds.has(operation.id)} disabled={recoveryIds.has(operation.id)} onclick={() => void handleRecovery(operation.id)}>{t.workbench.recovery.continueMerge}</Button>
                    <Button size="sm" variant="ghost" disabled={recoveryIds.has(operation.id)} onclick={() => void handleDiscardRecovery(operation.id)}>{t.workbench.recovery.discard}</Button>
                </div>
            </div>
        {/each}
    </section>
{/if}

<section class="cr-duplicates-section">
    <button class="cr-duplicates-heading" type="button" aria-expanded={!collapsed} onclick={() => collapsed = !collapsed}>
        <span class="cr-section-title">{t.workbench.product.similarNotes}</span>
        <span>{!displaySettings.enableSemanticIndexing ? t.workbench.product.indexDisabled : !displaySettings.enableDuplicateDetection ? t.workbench.product.duplicatesDisabled : pairs.length > 0 ? ctx.i18n.format('workbench.product.similarCount', {count: pairs.length}) : t.workbench.product.noSimilar} {pairs.length > 0 ? '›' : ''}</span>
    </button>
    {#if !collapsed}
    {#if sortedPairs.length > 0}
        <div class="cr-dup-list" role="list">
            {#each sortedPairs as pair (pair.id)}
                <div out:fade={{ duration: 150 }}>
                    <DuplicateItem
                        {pair}
                        nameA={resolveName(pair.nodeIdA)}
                        nameB={resolveName(pair.nodeIdB)}
                        mergeState={mergeStates.get(pair.id)}
                        dismissing={dismissingIds.has(pair.id)}
                        ondismiss={(p) => void handleDismiss(p)}
                        onmerge={(p) => void openMerge(p)}
                    />
                </div>
            {/each}
        </div>
    {:else}
        <p class="cr-duplicates-empty">{!displaySettings.enableSemanticIndexing ? t.workbench.product.indexDisabled : !displaySettings.enableDuplicateDetection ? t.workbench.product.duplicatesDisabled : t.workbench.product.noSimilar}</p>
    {/if}
    {/if}
</section>

{#if activeMergePair}
    <MergeModal
        pair={activeMergePair}
        initialPreview={readyMergePreview}
        onclose={() => { activeMergePair = null; refreshRecovery(); }}
        onsuccess={() => {
            activeMergePair = null;
            refreshRecovery();
            feedback = { level: 'success', message: t.workbench.notifications.mergeSuccess };
        }}
    />
{/if}

{#if feedback}
    <InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />
{/if}

<style>
    .cr-duplicates-heading { display: flex; justify-content: space-between; align-items: baseline; gap: var(--cr-space-3); width: 100%; text-align: left; padding: 0; height: auto; border: 0; box-shadow: none; background: none; color: var(--cr-text-normal); }
    .cr-duplicates-heading span:not(.cr-section-title) { font-size: var(--cr-font-xs); color: var(--cr-text-muted); }
    .cr-duplicates-empty { color: var(--cr-text-muted); font-size: var(--cr-font-xs); margin-top: var(--cr-space-3); }
    .cr-dup-list {
        display: flex;
        flex-direction: column;
        margin-top: var(--cr-space-3);
    }

    .cr-dup-recovery {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
        margin-bottom: var(--cr-space-2);
        padding: var(--cr-space-2);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm);
    }

    .cr-dup-recovery__heading,
    .cr-dup-recovery__item,
    .cr-dup-recovery__actions {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        flex-wrap: wrap;
    }

    .cr-dup-recovery__heading span,
    .cr-dup-recovery__phase {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-xs);
    }

    .cr-dup-recovery__item {
        justify-content: space-between;
        padding-top: var(--cr-space-1);
        border-top: 1px solid var(--cr-border);
    }
</style>
