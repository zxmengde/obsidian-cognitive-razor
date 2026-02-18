<!--
  QueueTaskList.svelte — 队列任务列表

  显示过滤后的任务项：概念名称、任务类型、状态、操作按钮。
  Pending 任务提供取消按钮，Failed 任务显示错误图标（hover 显示错误信息）。

  @see 需求 6.5, 6.6, 6.7, 6.8
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import Button from '../../components/Button.svelte';
    import type { TaskRecord, StandardizedConcept, CRType } from '../../../types';
    import type { SettingsStore } from '../../../data/settings-store';
    import { renderNamingTemplate } from '../../../core/naming-utils';

    let {
        tasks,
        oncancel,
    }: {
        tasks: TaskRecord[];
        oncancel: (taskId: string) => void;
    } = $props();

    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);

    /** 任务类型 → 显示标签映射 */
    const TYPE_LABELS: Record<string, string> = {
        define: 'Define',
        tag: 'Tag',
        write: 'Write',
        amend: 'Amend',
        merge: 'Merge',
        index: 'Index',
        verify: 'Verify',
        'image-generate': 'Image',
    };

    /** 获取任务显示名称（复用旧逻辑） */
    function getTaskDisplayName(task: TaskRecord): string {
        const payload = task.payload as Record<string, unknown>;
        const namingTemplate = settingsStore.getSettings().namingTemplate || '{{chinese}} ({{english}})';

        const standardizedData = payload?.standardizedData as StandardizedConcept | undefined;
        const conceptType = (payload?.conceptType as CRType) || standardizedData?.primaryType;

        if (standardizedData?.standardNames && conceptType) {
            const nameData = standardizedData.standardNames[conceptType];
            if (nameData?.chinese || nameData?.english) {
                const name = renderNamingTemplate(namingTemplate, {
                    chinese: nameData.chinese || '',
                    english: nameData.english || '',
                    type: conceptType,
                });
                return name.length > 30 ? name.substring(0, 30) + '...' : name;
            }
        }

        if (payload?.filePath && typeof payload.filePath === 'string') {
            const fileName = payload.filePath.split('/').pop() || payload.filePath;
            const noteName = fileName.replace(/\.md$/, '');
            return noteName.length > 30 ? noteName.substring(0, 30) + '...' : noteName;
        }

        if (payload?.userInput && typeof payload.userInput === 'string') {
            const input = payload.userInput;
            return input.length > 20 ? input.substring(0, 20) + '...' : input;
        }

        return task.id.substring(0, 8);
    }

    /** 获取任务最后一条错误信息 */
    function getErrorMessage(task: TaskRecord): string {
        if (task.errors && task.errors.length > 0) {
            const last = task.errors[task.errors.length - 1];
            return `[${last.code}] ${last.message}`;
        }
        return t.workbench?.queueStatus?.failed ?? '失败';
    }

    /** 状态标签 */
    function getStateLabel(state: string): string {
        const map: Record<string, string> = {
            Pending: t.workbench?.queueStatus?.pending ?? '待处理',
            Running: t.workbench?.queueStatus?.running ?? '执行中',
            Failed: t.workbench?.queueStatus?.failed ?? '失败',
        };
        return map[state] ?? state;
    }
</script>

<div class="cr-task-list" role="list">
    {#each tasks as task (task.id)}
        <div class="cr-task-item" role="listitem">
            <!-- 概念名称 -->
            <span class="cr-task-name" title={getTaskDisplayName(task)}>
                {getTaskDisplayName(task)}
            </span>

            <!-- 任务类型 -->
            <span class="cr-task-type">
                {TYPE_LABELS[task.taskType] ?? task.taskType}
            </span>

            <!-- 状态 -->
            <span
                class="cr-task-state cr-task-state--{task.state.toLowerCase()}"
            >
                {#if task.state === 'Failed'}
                    <span
                        class="cr-task-error-icon"
                        title={getErrorMessage(task)}
                        aria-label={getErrorMessage(task)}
                    >⚠</span>
                {/if}
                {getStateLabel(task.state)}
            </span>

            <!-- 操作 -->
            <span class="cr-task-actions">
                {#if task.state === 'Pending'}
                    <Button
                        variant="ghost"
                        size="icon"
                        onclick={() => oncancel(task.id)}
                        ariaLabel={t.workbench?.queueStatus?.cancel ?? '取消'}
                    >✕</Button>
                {/if}
            </span>
        </div>
    {/each}
</div>

<style>
    .cr-task-list {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
    }

    .cr-task-item {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        padding: var(--cr-space-1h, 6px) var(--cr-space-2);
        border-radius: var(--cr-radius-sm, 4px);
        font-size: var(--font-ui-small, 13px);
    }

    .cr-task-item:hover {
        background: var(--cr-bg-hover);
    }

    .cr-task-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--cr-text-normal);
    }

    .cr-task-type {
        flex-shrink: 0;
        color: var(--cr-text-muted);
        font-size: var(--font-ui-smaller, 11px);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .cr-task-state {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: var(--cr-space-1, 4px);
        font-size: var(--font-ui-smaller, 11px);
    }

    .cr-task-state--pending {
        color: var(--cr-text-muted);
    }

    .cr-task-state--running {
        color: var(--cr-interactive-accent);
    }

    .cr-task-state--failed {
        color: var(--cr-status-error);
    }

    .cr-task-error-icon {
        cursor: help;
    }

    .cr-task-actions {
        flex-shrink: 0;
        width: 28px;
        display: flex;
        justify-content: center;
    }
</style>
