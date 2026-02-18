<!--
  ExpandPanel.svelte — 拓展内联面板

  职责：
  - 展开时自动调用 ExpandOrchestrator.prepare() 获取候选列表
  - 加载状态 → 候选列表（含全选/全不选 + 勾选列表）→ 创建/取消
  - 标注已存在和不可创建的候选项
  - 提交后调用 createFromHierarchical/createFromAbstract

  @see 需求 5.3, 5.10, 5.11
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import type { TFile } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import Button from '../../components/Button.svelte';
    import type { ExpandOrchestrator, ExpandPlan, HierarchicalCandidate, HierarchicalPlan, AbstractPlan } from '../../../core/expand-orchestrator';
    import type { Logger } from '../../../data/logger';

    let {
        activeFile,
        onclose,
    }: {
        activeFile: TFile | null;
        onclose?: () => void;
    } = $props();

    // 从 Context 获取服务
    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const expandOrch = ctx.container.resolve<ExpandOrchestrator>(SERVICE_TOKENS.expandOrchestrator);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 组件状态
    let loading = $state(true);
    let error = $state<string | null>(null);
    let plan = $state<ExpandPlan | null>(null);
    let selected = $state<Set<number>>(new Set());
    let submitting = $state(false);

    // 派生状态：可创建的候选索引列表
    let creatableIndices = $derived.by(() => {
        if (!plan) return [] as number[];
        if (plan.mode === 'hierarchical') {
            return plan.candidates
                .map((c, i) => c.status === 'creatable' ? i : -1)
                .filter(i => i >= 0);
        }
        // 抽象模式：所有候选均可选
        return plan.candidates.map((_, i) => i);
    });

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
    async function loadCandidates(): Promise<void> {
        if (!activeFile) {
            error = t.expand?.notInitialized ?? '拓展功能未初始化';
            loading = false;
            return;
        }

        loading = true;
        error = null;

        try {
            const result = await expandOrch.prepare(activeFile);
            if (result.ok) {
                plan = result.value;
                // 默认选中所有可创建项
                selected = new Set(creatableIndices);
            } else {
                error = result.error.message;
            }
        } catch (e) {
            logger.error('ExpandPanel', '加载候选列表失败', e as Error);
            error = t.imageModal?.genericFailure ?? '操作失败，请稍后重试';
        } finally {
            loading = false;
        }
    }

    // 组件挂载时自动加载
    $effect(() => {
        void loadCandidates();
    });

    /** 切换单个候选的选中状态 */
    function toggleCandidate(index: number): void {
        const next = new Set(selected);
        if (next.has(index)) {
            next.delete(index);
        } else {
            next.add(index);
        }
        selected = next;
    }

    /** 全选 */
    function selectAll(): void {
        selected = new Set(creatableIndices);
    }

    /** 全不选 */
    function deselectAll(): void {
        selected = new Set();
    }

    /** 提交创建 */
    async function handleSubmit(): Promise<void> {
        if (!plan || !hasSelection || submitting) return;

        submitting = true;
        try {
            if (plan.mode === 'hierarchical') {
                const selectedCandidates = [...selected].map(i => plan!.candidates[i] as HierarchicalCandidate);
                const result = await expandOrch.createFromHierarchical(plan as HierarchicalPlan, selectedCandidates);
                if (result.ok) {
                    const { started, failed } = result.value;
                    if (failed.length > 0) {
                        new Notice((t.expand?.startedWithFailures ?? '已启动 {started} 个任务，{failed} 个未能启动')
                            .replace('{started}', String(started))
                            .replace('{failed}', String(failed.length)));
                    } else {
                        new Notice((t.expand?.started ?? '已启动 {count} 个创建任务')
                            .replace('{count}', String(started)));
                    }
                    onclose?.();
                } else {
                    new Notice(result.error.message);
                }
            } else {
                // 抽象模式
                const selectedCandidates = [...selected].map(i => (plan as AbstractPlan).candidates[i]);
                const result = await expandOrch.createFromAbstract(plan as AbstractPlan, selectedCandidates);
                if (result.ok) {
                    new Notice((t.expand?.started ?? '已启动 {count} 个创建任务')
                        .replace('{count}', '1'));
                    onclose?.();
                } else {
                    new Notice(result.error.message);
                }
            }
        } catch (e) {
            logger.error('ExpandPanel', '创建失败', e as Error);
            new Notice(t.imageModal?.genericFailure ?? '操作失败，请稍后重试');
        } finally {
            submitting = false;
        }
    }
</script>

<!-- 加载状态 -->
{#if loading}
    <div class="cr-expand-loading">
        <span class="cr-loading-spinner" aria-hidden="true"></span>
        <span>{t.workbench?.buttons?.expand ?? '拓展'}...</span>
    </div>
{:else if error}
    <!-- 错误状态 -->
    <div class="cr-expand-error">
        <p>{error}</p>
        <Button variant="ghost" size="sm" onclick={() => onclose?.()}>
            {t.imageModal?.cancel ?? '取消'}
        </Button>
    </div>
{:else if plan}
    <div class="cr-expand-panel">
        <!-- 统计信息 -->
        {#if stats}
            <div class="cr-expand-stats">
                <span>{t.expand?.stats?.total ?? '候选总数'}: {stats.total}</span>
                <span class="cr-expand-stat-creatable">{t.expand?.stats?.creatable ?? '可创建'}: {stats.creatable}</span>
                {#if stats.existing > 0}
                    <span class="cr-expand-stat-existing">{t.expand?.stats?.existing ?? '已存在'}: {stats.existing}</span>
                {/if}
                {#if stats.invalid > 0}
                    <span class="cr-expand-stat-invalid">{t.expand?.stats?.invalid ?? '不可创建'}: {stats.invalid}</span>
                {/if}
            </div>
        {/if}

        <!-- 抽象模式说明 -->
        {#if plan.mode === 'abstract'}
            <div class="cr-expand-hint">{t.expand?.abstractInstruction ?? '选择至少 1 个相似概念'}</div>
        {/if}

        <!-- 松散结构提示 -->
        {#if plan.mode === 'hierarchical' && plan.looseStructure}
            <div class="cr-expand-hint cr-expand-hint--warn">{t.expand?.looseStructureHint ?? '未找到标准章节，已回退全局扫描'}</div>
        {/if}

        <!-- 全选/全不选 -->
        <div class="cr-expand-select-bar">
            <button class="cr-link-btn" onclick={selectAll} disabled={allSelected}>
                {t.expand?.selectAll ?? '全选'}
            </button>
            <span class="cr-expand-sep">|</span>
            <button class="cr-link-btn" onclick={deselectAll} disabled={!hasSelection}>
                {t.expand?.deselectAll ?? '全不选'}
            </button>
        </div>

        <!-- 候选列表 -->
        <div class="cr-expand-list" role="list">
            {#each plan.candidates as candidate, index}
                {@const isHierarchical = plan.mode === 'hierarchical'}
                {@const hCandidate = isHierarchical ? candidate as HierarchicalCandidate : null}
                {@const isCreatable = isHierarchical ? hCandidate!.status === 'creatable' : true}
                {@const isChecked = selected.has(index)}

                <label
                    class="cr-expand-item"
                    class:cr-expand-item--disabled={!isCreatable}
                    role="listitem"
                >
                    <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!isCreatable || submitting}
                        onchange={() => toggleCandidate(index)}
                    />
                    <span class="cr-expand-item-name">{candidate.name}</span>
                    {#if isHierarchical && hCandidate}
                        {#if hCandidate.status === 'existing'}
                            <span class="cr-expand-badge cr-expand-badge--existing">
                                {t.expand?.status?.existing ?? '已存在'}
                            </span>
                        {:else if hCandidate.status === 'invalid'}
                            <span class="cr-expand-badge cr-expand-badge--invalid">
                                {t.expand?.status?.invalid ?? '不可创建'}
                            </span>
                        {/if}
                    {:else if plan.mode === 'abstract'}
                        <span class="cr-expand-similarity">
                            {Math.round((candidate as import('../../../core/expand-orchestrator').AbstractCandidate).similarity * 100)}%
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
                    ? (t.expand?.abstractConfirm ?? '生成')
                    : (t.expand?.confirm ?? '创建已选')}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onclick={() => onclose?.()}
            >
                {t.imageModal?.cancel ?? '取消'}
            </Button>
        </div>
    </div>
{/if}

<style>
    .cr-expand-loading {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        padding: var(--cr-space-2) 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
    }

    .cr-expand-error {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
        color: var(--cr-status-error, #e53935);
        font-size: var(--cr-font-sm, 13px);
    }

    .cr-expand-error p {
        margin: 0;
    }

    .cr-expand-panel {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-expand-stats {
        display: flex;
        gap: var(--cr-space-3);
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-muted);
    }

    .cr-expand-stat-creatable { color: var(--cr-status-success, #43a047); }
    .cr-expand-stat-existing { color: var(--cr-text-muted); }
    .cr-expand-stat-invalid { color: var(--cr-status-error, #e53935); }

    .cr-expand-hint {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-muted);
        padding: var(--cr-space-1) 0;
    }

    .cr-expand-hint--warn {
        color: var(--cr-status-warning, #f9a825);
    }

    .cr-expand-select-bar {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        font-size: var(--cr-font-sm, 13px);
    }

    .cr-link-btn {
        background: none;
        border: none;
        color: var(--cr-accent);
        cursor: pointer;
        padding: 0;
        font-size: inherit;
    }

    .cr-link-btn:hover:not(:disabled) {
        text-decoration: underline;
    }

    .cr-link-btn:disabled {
        color: var(--cr-text-muted);
        cursor: default;
    }

    .cr-expand-sep {
        color: var(--cr-text-muted);
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
        border-radius: var(--cr-radius-sm, 4px);
        cursor: pointer;
        font-size: var(--cr-font-sm, 13px);
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
        border-radius: var(--cr-radius-sm, 4px);
        white-space: nowrap;
    }

    .cr-expand-badge--existing {
        background: var(--cr-bg-hover);
        color: var(--cr-text-muted);
    }

    .cr-expand-badge--invalid {
        background: color-mix(in srgb, var(--cr-status-error, #e53935) 15%, transparent);
        color: var(--cr-status-error, #e53935);
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
