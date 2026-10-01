<!--
  ExpandPanel.svelte — 拓展内联面板

  职责：
  - 展开时自动调用 ExpandOrchestrator.prepare() 获取候选列表
  - 加载状态 → 默认未选择的候选列表（含全选/全不选）→ 创建/取消
  - 标注已存在和不可创建的候选项
  - 层级候选在用户确认后直接创建；抽象候选先显示 Define 预览，再等待二次确认

-->
<script lang="ts">
    import type { TFile } from 'obsidian';
    import { SvelteSet } from 'svelte/reactivity';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import type { ExpandPlan, HierarchicalCandidate, HierarchicalPlan, AbstractCandidate, AbstractPlan, AbstractExpandPreview } from '../../../core/expand-orchestrator';
    import type { CRType } from '../../../types';
    import { confirmDefinePreview } from '../../../domain/concept';
    import TypeTable from './TypeTable.svelte';
    import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';

    let {
        activeFile,
        onclose,
    }: {
        activeFile: TFile | null;
        onclose?: () => void;
    } = $props();

    // 从 Context 获取服务
    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
    const expand = ctx.application.expand;
    const detailsToggleLabels = {
        expand: t.common.details.expand,
        collapse: t.common.details.collapse,
    };

    // 组件状态
    let loading = $state(true);
    let feedback = $state<UiFeedback | null>(null);
    let plan = $state<ExpandPlan | null>(null);
    let abstractPreview = $state<AbstractExpandPreview | null>(null);
    const selected = new SvelteSet<number>();
    let submitting = $state(false);
    let loadGeneration = 0;

    function getCreatableIndices(value: ExpandPlan | null): number[] {
        if (!value) return [];
        if (value.mode === 'hierarchical') {
            return value.candidates
                .map((candidate, index) => candidate.status === 'creatable' ? index : -1)
                .filter(index => index >= 0);
        }
        return value.candidates
            .map((candidate, index) => candidate.status === 'queued' ? -1 : index)
            .filter(index => index >= 0);
    }

    function replaceSelection(indices: Iterable<number>): void {
        selected.clear();
        for (const index of indices) {
            selected.add(index);
        }
    }

    // 派生状态：可创建的候选索引列表
    let creatableIndices = $derived(getCreatableIndices(plan));

    let hasSelection = $derived(selected.size > 0);
    let allSelected = $derived(
        creatableIndices.length > 0 && creatableIndices.every(i => selected.has(i))
    );

    // 统计信息（仅层级模式）
    let stats = $derived.by(() => {
        if (!plan || plan.mode !== 'hierarchical') return null;
        const candidates = plan.candidates;
        return {
            total: candidates.length,
            creatable: candidates.filter(c => c.status === 'creatable').length,
            existing: candidates.filter(c => c.status === 'existing').length,
            invalid: candidates.filter(c => c.status === 'invalid').length,
        };
    });

    /** 加载候选列表 */
    async function loadCandidates(file: TFile | null, generation: number): Promise<void> {
        if (!file) {
            if (generation !== loadGeneration) return;
            feedback = { level: 'error', message: t.expand.notInitialized };
            plan = null;
            abstractPreview = null;
            selected.clear();
            loading = false;
            return;
        }

        loading = true;
        feedback = null;
        plan = null;
        abstractPreview = null;
        selected.clear();

        try {
            const result = await expand.prepare(file);
            if (generation !== loadGeneration) return;
            if (result.ok) {
                plan = result.value;
            } else {
                feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.unknownFailure);
            }
        } catch (_error) {
            if (generation !== loadGeneration) return;
            feedback = toSafeErrorFeedback(_error, t.workbench.notifications.unknownFailure);
        } finally {
            if (generation === loadGeneration) {
                loading = false;
            }
        }
    }

    // 活跃文件变化时重新加载；旧请求和卸载后的结果都失去写入权。
    $effect(() => {
        const file = activeFile;
        const generation = ++loadGeneration;
        void loadCandidates(file, generation);
        return () => {
            if (loadGeneration === generation) {
                loadGeneration++;
            }
        };
    });

    /** 切换单个候选的选中状态 */
    function toggleCandidate(index: number): void {
        if (selected.has(index)) {
            selected.delete(index);
        } else {
            selected.add(index);
        }
    }

    /** 全选 */
    function selectAll(): void {
        replaceSelection(creatableIndices);
    }

    /** 全不选 */
    function deselectAll(): void {
        selected.clear();
    }

    /** 提交创建 */
    async function handleSubmit(): Promise<void> {
        if (!plan || !hasSelection || submitting) return;

        const submittedPlan = plan;
        const submissionGeneration = loadGeneration;
        submitting = true;
        feedback = null;
        try {
            if (submittedPlan.mode === 'hierarchical') {
                const selectedCandidates = [...selected].map(i => submittedPlan.candidates[i] as HierarchicalCandidate);
                const result = await expand.confirmHierarchical(submittedPlan as HierarchicalPlan, selectedCandidates);
                if (result.ok) {
                    const { started, failed } = result.value;
                    if (failed.length > 0) {
                        feedback = {
                            level: 'warning',
                            message: t.expand.startedWithFailures
                                .replace('{started}', String(started))
                                .replace('{failed}', String(failed.length)),
                        };
                    } else {
                        feedback = {
                            level: 'success',
                            message: t.expand.started.replace('{count}', String(started)),
                        };
                    }
                    if (submissionGeneration === loadGeneration) {
                        selected.clear();
                        plan = null;
                    }
                } else {
                    feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.unknownFailure);
                }
            } else {
                // Abstract mode stops at a preview. A separate click confirms it.
                const selectedCandidates = [...selected].map(i => (submittedPlan as AbstractPlan).candidates[i]);
                const result = await expand.prepareAbstractPreview(submittedPlan as AbstractPlan, selectedCandidates);
                if (result.ok) {
                    if (submissionGeneration === loadGeneration) abstractPreview = result.value;
                } else {
                    feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.unknownFailure);
                }
            }
        } catch (_error) {
            feedback = toSafeErrorFeedback(_error, t.workbench.notifications.unknownFailure);
        } finally {
            submitting = false;
        }
    }

    async function handleConfirmAbstract(type: CRType): Promise<void> {
        const pending = abstractPreview;
        if (!pending || submitting) return;
        const confirmed = confirmDefinePreview(pending.preview, type, {
            source: 'abstract-expand',
            parents: pending.parents,
        });
        if (!confirmed.ok) {
            feedback = toSafeErrorFeedback(confirmed.error, t.workbench.notifications.unknownFailure);
            return;
        }

        const confirmationGeneration = loadGeneration;
        submitting = true;
        feedback = null;
        try {
            const result = await expand.confirmAbstract(pending, confirmed.value);
            if (result.ok) {
                feedback = { level: 'success', message: t.expand.started.replace('{count}', '1') };
                if (confirmationGeneration === loadGeneration) {
                    abstractPreview = null;
                    selected.clear();
                    plan = null;
                }
            } else {
                feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.unknownFailure);
            }
        } catch (_error) {
            feedback = toSafeErrorFeedback(_error, t.workbench.notifications.unknownFailure);
        } finally {
            submitting = false;
        }
    }

    function cancelAbstractPreview(): void {
        if (submitting) return;
        abstractPreview = null;
    }
</script>

<!-- 加载状态 -->
{#if loading}
    <div class="cr-expand-loading">
        <span class="cr-loading-spinner" aria-hidden="true"></span>
        <span>{t.workbench.buttons.expand}...</span>
    </div>
{:else if feedback && !plan}
    <div class="cr-expand-feedback">
        <InlineAlert level={feedback?.level ?? 'error'} message={feedback?.message ?? t.workbench.notifications.unknownFailure} details={feedback?.details} {detailsToggleLabels} />
        <Button variant="ghost" size="sm" onclick={() => onclose?.()}>
            {t.common.cancel}
        </Button>
    </div>
{:else if plan}
    <div class="cr-expand-panel">
        {#if feedback}
            <InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />
        {/if}
        <!-- 统计信息 -->
        {#if stats}
            <div class="cr-expand-stats">
                <span>{t.expand.stats.total}: {stats.total}</span>
                <span class="cr-expand-stat-creatable">{t.expand.stats.creatable}: {stats.creatable}</span>
                {#if stats.existing > 0}
                    <span class="cr-expand-stat-existing">{t.expand.stats.existing}: {stats.existing}</span>
                {/if}
                {#if stats.invalid > 0}
                    <span class="cr-expand-stat-invalid">{t.expand.stats.invalid}: {stats.invalid}</span>
                {/if}
            </div>
        {/if}

        <!-- 抽象模式说明 -->
        {#if plan.mode === 'abstract'}
            <div class="cr-expand-hint">{t.expand.abstractInstruction}</div>
        {/if}

        {#if abstractPreview}
            <div class="cr-expand-preview">
                <TypeTable
                    concept={abstractPreview.preview}
                    types={[abstractPreview.type]}
                    oncreate={handleConfirmAbstract}
                />
                <Button variant="ghost" size="sm" disabled={submitting} onclick={cancelAbstractPreview}>
                    {t.common.cancel}
                </Button>
            </div>
        {:else}
        <!-- 全选/全不选 -->
        <div class="cr-expand-select-bar">
            <Button variant="ghost" size="sm" onclick={selectAll} disabled={allSelected}>
                {t.expand.selectAll}
            </Button>
            <Button variant="ghost" size="sm" onclick={deselectAll} disabled={!hasSelection}>
                {t.expand.deselectAll}
            </Button>
        </div>

        <!-- 候选列表 -->
        <div class="cr-expand-list" role="list">
            {#each plan.candidates as candidate, index (index)}
                {@const isHierarchical = plan.mode === 'hierarchical'}
                {@const hCandidate = isHierarchical ? candidate as HierarchicalCandidate : null}
                {@const isCreatable = isHierarchical ? hCandidate!.status === 'creatable' : true}
                {@const isQueued = !isHierarchical && (candidate as AbstractCandidate).status === 'queued'}
                {@const isChecked = selected.has(index)}

                <label
                    class="cr-expand-item"
                    class:cr-expand-item--disabled={!isCreatable}
                    role="listitem"
                >
                    <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!isCreatable || isQueued || submitting}
                        onchange={() => toggleCandidate(index)}
                    />
                    <span class="cr-expand-item-name">{candidate.name}</span>
                    {#if isHierarchical && hCandidate}
                        {#if hCandidate.status === 'existing'}
                            <span class="cr-expand-badge cr-expand-badge--existing">
                                {t.expand.status.existing}
                            </span>
                        {:else if hCandidate.status === 'invalid'}
                            <span class="cr-expand-badge cr-expand-badge--invalid">
                                {t.expand.status.invalid}
                            </span>
                        {/if}
                    {:else if plan.mode === 'abstract'}
                        {#if isQueued}
                            <span class="cr-expand-badge cr-expand-badge--existing">{t.expand.status.queued}</span>
                        {/if}
                        <span class="cr-expand-similarity">
                            {Math.round((candidate as AbstractCandidate).similarity * 100)}%
                        </span>
                    {/if}
                </label>
            {/each}
        </div>

        <!-- 操作按钮 -->
        <div class="cr-expand-actions">
            <Button
                variant="primary"
                size="sm"
                disabled={!hasSelection}
                loading={submitting}
                onclick={() => void handleSubmit()}
            >
                {plan.mode === 'abstract'
                    ? t.expand.abstractConfirm
                    : t.expand.confirm.replace('{count}', String(selected.size))}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onclick={() => onclose?.()}
            >
                {t.common.cancel}
            </Button>
        </div>
        {/if}
    </div>
{/if}

<style>
    .cr-expand-loading {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        padding: var(--cr-space-2) 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
    }

    .cr-expand-feedback {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
        font-size: var(--cr-font-sm);
    }

    .cr-expand-panel {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-expand-preview {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-expand-stats {
        display: flex;
        gap: var(--cr-space-3);
        font-size: var(--cr-font-sm);
        color: var(--cr-text-muted);
    }

    .cr-expand-stat-creatable { color: var(--cr-status-success); }
    .cr-expand-stat-existing { color: var(--cr-text-muted); }
    .cr-expand-stat-invalid { color: var(--cr-status-error); }

    .cr-expand-hint {
        font-size: var(--cr-font-sm);
        color: var(--cr-text-muted);
        padding: var(--cr-space-1) 0;
    }

    .cr-expand-select-bar {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        font-size: var(--cr-font-sm);
    }
    .cr-expand-list {
        max-height: 240px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
    }

    .cr-expand-item {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        padding: var(--cr-space-1) var(--cr-space-2);
        border-radius: var(--cr-radius-sm);
        cursor: pointer;
        font-size: var(--cr-font-sm);
    }

    .cr-expand-item:hover {
        background: var(--cr-bg-hover);
    }

    .cr-expand-item--disabled {
        opacity: 0.5;
        cursor: default;
    }

    .cr-expand-item-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .cr-expand-badge {
        font-size: 11px;
        padding: 1px 6px;
        border-radius: var(--cr-radius-sm);
        white-space: nowrap;
    }

    .cr-expand-badge--existing {
        background: var(--cr-bg-hover);
        color: var(--cr-text-muted);
    }

    .cr-expand-badge--invalid {
        background: color-mix(in srgb, var(--cr-status-error) 15%, transparent);
        color: var(--cr-status-error);
    }

    .cr-expand-similarity {
        font-size: 11px;
        color: var(--cr-text-muted);
        white-space: nowrap;
    }

    .cr-expand-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--cr-space-2);
    }
</style>
