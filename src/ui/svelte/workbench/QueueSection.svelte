<!--
  QueueSection.svelte — 工作台队列区

  职责：
  - 状态栏：StatusDot + 紧凑统计 + 暂停/恢复按钮
  - 仅显示 Pending/Running/Failed 任务，不显示已完成
  - 可展开任务列表（概念名称、类型、状态、操作）
  - 批量操作（重试失败、清空等待中需确认 Modal）
  - 状态文字 aria-live="polite"

  @see 需求 6.1-6.10
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import { showSuccess, showError } from '../../feedback';
    import StatusDot from '../../components/StatusDot.svelte';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import SectionCard from '../../components/SectionCard.svelte';
    import EmptyState from '../../components/EmptyState.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import MiniProgress from '../../components/MiniProgress.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import QueueTaskList from './QueueTaskList.svelte';
    import type { QueueStatus, TaskRecord, TaskState } from '../../../types';
    import type { TaskQueue } from '../../../core/task-queue';
    import type { Logger } from '../../../data/logger';

    /** 状态指示器颜色类型 */
    type DotStatus = 'idle' | 'running' | 'paused' | 'error';

    let {
        status,
        tasks,
    }: {
        status: QueueStatus;
        tasks: TaskRecord[];
    } = $props();

    // 从 Context 获取服务
    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const taskQueue = ctx.container.resolve<TaskQueue>(SERVICE_TOKENS.taskQueue);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 组件状态
    let expanded = $state(false);
    let showClearConfirm = $state(false);

    // ========================================================================
    // 派生状态
    // ========================================================================

    /** 仅显示 Pending/Running/Failed 任务 */
    const VISIBLE_STATES: TaskState[] = ['Pending', 'Running', 'Failed'];

    /** 过滤后的可见任务列表 */
    let visibleTasks = $derived(
        tasks.filter(task => VISIBLE_STATES.includes(task.state))
    );

    /** 状态指示器颜色映射 */
    let dotStatus: DotStatus = $derived.by(() => {
        if (status.failed > 0) return 'error';
        if (status.paused) return 'paused';
        if (status.running > 0) return 'running';
        return 'idle';
    });

    /** 状态标签文字 */
    let statusLabel: string = $derived.by(() => {
        if (status.failed > 0) return t.workbench?.queueStatus?.failed ?? '失败';
        if (status.paused) return t.workbench?.queueStatus?.paused ?? '已暂停';
        if (status.running > 0) return t.workbench?.queueStatus?.active ?? '运行中';
        return t.workbench?.queueStatus?.noTasks ?? '空闲';
    });

    /** 紧凑统计文字 */
    let statsText: string = $derived.by(() => {
        const parts: string[] = [];
        if (status.pending > 0) {
            parts.push(`${t.workbench?.queueStatus?.pending ?? '待处理'} ${status.pending}`);
        }
        if (status.running > 0) {
            parts.push(`${t.workbench?.queueStatus?.running ?? '执行中'} ${status.running}`);
        }
        if (status.failed > 0) {
            parts.push(`${t.workbench?.queueStatus?.failed ?? '失败'} ${status.failed}`);
        }
        return parts.join(' · ');
    });

    /** 是否有失败任务 */
    let hasFailed = $derived(status.failed > 0);

    /** 是否有等待中任务 */
    let hasPending = $derived(status.pending > 0);

    /** 失败任务的错误摘要（最近 3 条） */
    let failedErrors = $derived.by(() => {
        const failed = tasks.filter(t => t.state === 'Failed');
        return failed.slice(-3).map(t => {
            const last = t.errors?.[t.errors.length - 1];
            return {
                taskId: t.id,
                code: last?.code ?? 'UNKNOWN',
                message: last?.message ?? '未知错误',
            };
        });
    });

    /** 当前运行任务的进度（0-1） */
    let runningProgress = $derived.by(() => {
        const running = tasks.filter(t => t.state === 'Running');
        if (running.length === 0) return 0;
        const total = running.reduce((sum, t) => {
            const p = (t as Record<string, unknown>).progress;
            return sum + (typeof p === 'number' ? p : 0);
        }, 0);
        return total / running.length;
    });

    // ========================================================================
    // 事件处理
    // ========================================================================

    /** 切换展开/收起任务列表 */
    function toggleExpanded(): void {
        expanded = !expanded;
    }

    /** 暂停/恢复队列 */
    async function handleTogglePause(): Promise<void> {
        try {
            if (status.paused) {
                await taskQueue.resume();
                showSuccess(t.workbench?.notifications?.queueResumed ?? '队列已恢复运行');
            } else {
                await taskQueue.pause();
                showSuccess(t.workbench?.notifications?.queuePaused ?? '队列已暂停');
            }
        } catch (e) {
            logger.error('QueueSection', '暂停/恢复队列失败', e as Error);
        }
    }

    /** 重试所有失败任务 */
    async function handleRetryFailed(): Promise<void> {
        try {
            const result = await taskQueue.retryFailed();
            if (result.ok) {
                showSuccess(`${t.workbench?.notifications?.retryComplete ?? '已重试失败任务'} (${result.value})`);
            }
        } catch (e) {
            logger.error('QueueSection', '重试失败任务异常', e as Error);
        }
    }

    /** 取消单个任务 */
    function handleCancelTask(taskId: string): void {
        try {
            taskQueue.cancel(taskId);
            showSuccess(t.workbench?.notifications?.taskCancelled ?? '任务已取消');
        } catch (e) {
            logger.error('QueueSection', '取消任务失败', e as Error);
        }
    }

    /** 清空等待中任务（需确认） */
    function handleClearPending(): void {
        showClearConfirm = true;
    }

    /** 确认清空等待中 */
    function confirmClearPending(): void {
        showClearConfirm = false;
        const allTasks = taskQueue.getAllTasks();
        let cleared = 0;
        for (const task of allTasks) {
            if (task.state === 'Pending') {
                try {
                    taskQueue.cancel(task.id);
                    cleared++;
                } catch { /* 忽略单项失败 */ }
            }
        }
        showSuccess(`${t.workbench?.notifications?.clearComplete ?? '已清空'} (${cleared})`);
    }

    /** 取消清空 */
    function cancelClearPending(): void {
        showClearConfirm = false;
    }
</script>

<!-- 队列区 -->
<SectionCard>
    <div class="cr-queue-section">
        <!-- 状态栏 -->
        <div class="cr-queue-status-bar">
            <!-- 状态栏（可点击展开/折叠） -->
            <div
                class="cr-queue-status-info"
                role="button"
                tabindex="0"
                onclick={toggleExpanded}
                onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(); } }}
                aria-expanded={expanded}
                aria-label={expanded ? '折叠队列' : '展开队列'}
            >
                <StatusDot status={dotStatus} label={statusLabel} />
                {#if statsText}
                    <span class="cr-queue-stats" aria-live="polite">{statsText}</span>
                {/if}
                <span
                    class="cr-queue-expand-icon"
                    class:cr-queue-expand-icon--open={expanded}
                    aria-hidden="true"
                >
                    <Icon name="chevron-right" size={16} />
                </span>
            </div>

            <!-- 迷你进度 + 暂停/恢复按钮 -->
            <div class="cr-queue-controls">
                {#if status.running > 0}
                    <MiniProgress value={runningProgress} />
                {/if}
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={() => void handleTogglePause()}
                    ariaLabel={status.paused
                        ? (t.workbench?.queueStatus?.resumeQueue ?? '恢复队列')
                        : (t.workbench?.queueStatus?.pauseQueue ?? '暂停队列')}
                >
                    <Icon name={status.paused ? 'play' : 'pause'} size={16} />
                </Button>
            </div>
        </div>

        <!-- 展开的任务列表 -->
        {#if expanded}
            <div class="cr-queue-details">
                {#if visibleTasks.length > 0}
                    <QueueTaskList
                        tasks={visibleTasks}
                        oncancel={handleCancelTask}
                    />

                    <!-- 批量操作 -->
                    <div class="cr-queue-batch-actions">
                        {#if hasFailed}
                            <Button
                                variant="secondary"
                                size="sm"
                                onclick={() => void handleRetryFailed()}
                            >
                                {t.workbench?.queueStatus?.retryFailed ?? '重试失败'}
                            </Button>
                        {/if}
                        {#if hasPending}
                            <Button
                                variant="ghost"
                                size="sm"
                                onclick={handleClearPending}
                            >
                                {t.workbench?.queueStatus?.clearPending ?? '清除待处理'}
                            </Button>
                        {/if}
                    </div>
                {:else}
                    <EmptyState
                        message={t.workbench?.queueStatus?.noTasks ?? '队列中暂无任务'}
                        icon="inbox"
                    />
                {/if}
            </div>
        {/if}

        <!-- 内联错误摘要 -->
        {#if failedErrors.length > 0}
            <div class="cr-queue-errors" aria-live="assertive">
                {#each failedErrors as err (err.taskId)}
                    <InlineAlert
                        level="error"
                        message="[{err.code}] {err.message}"
                    />
                {/each}
            </div>
        {/if}
    </div>
</SectionCard>

<!-- 清空等待中确认 Modal -->
{#if showClearConfirm}
    <ConfirmModal
        title={t.workbench?.queueStatus?.clearPendingConfirmTitle ?? '确认清空待处理'}
        message={t.workbench?.queueStatus?.clearPendingConfirmMessage ?? '是否取消所有待处理任务？'}
        danger={true}
        onconfirm={confirmClearPending}
        oncancel={cancelClearPending}
    />
{/if}

<style>
    .cr-queue-section {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-queue-status-bar {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
    }

    .cr-queue-status-info {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        flex: 1;
        cursor: pointer;
        padding: var(--cr-space-1) 0;
        user-select: none;
    }

    .cr-queue-status-info:hover .cr-queue-expand-icon {
        color: var(--cr-text-normal);
    }

    .cr-queue-stats {
        font-size: var(--font-ui-small, 13px);
        color: var(--cr-text-muted);
    }

    .cr-queue-expand-icon {
        color: var(--cr-text-faint);
        margin-left: auto;
        transition: transform 200ms ease, color 0.15s;
        display: inline-flex;
    }

    .cr-queue-expand-icon--open {
        transform: rotate(90deg);
    }

    .cr-queue-controls {
        display: flex;
        align-items: center;
        gap: var(--cr-space-1);
    }

    .cr-queue-details {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
        padding-left: var(--cr-space-1);
    }

    .cr-queue-batch-actions {
        display: flex;
        gap: var(--cr-space-2);
        justify-content: flex-end;
        padding-top: var(--cr-space-1);
    }

    .cr-queue-errors {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
        margin-top: var(--cr-space-2);
    }
</style>
