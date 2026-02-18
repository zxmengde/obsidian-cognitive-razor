<!--
  TaskModelCard.svelte — 任务模型配置卡片

  为单个任务类型显示 Provider 下拉、模型输入、温度滑块、重置按钮。

  @see 需求 10.4, 10.7
-->
<script lang="ts">
    import type { TaskType, TaskModelConfig, ProviderConfig } from '../../../types';
    import Select from '../../components/Select.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Slider from '../../components/Slider.svelte';

    let {
        taskType,
        config,
        providers,
        defaultProviderId,
        isDefault = false,
        i18n,
        onUpdate,
        onReset,
    }: {
        /** 任务类型 */
        taskType: TaskType;
        /** 当前任务模型配置 */
        config: TaskModelConfig;
        /** 可用的 Provider 列表 */
        providers: Record<string, ProviderConfig>;
        /** 默认 Provider ID */
        defaultProviderId: string;
        /** 是否为默认配置 */
        isDefault: boolean;
        /** i18n 实例 */
        i18n: { t: (key: string) => string };
        /** 更新配置 */
        onUpdate: (taskType: TaskType, partial: Partial<TaskModelConfig>) => void;
        /** 重置为默认 */
        onReset: (taskType: TaskType) => void;
    } = $props();

    /** 是否为嵌入类任务（index 不需要温度/topP/推理参数） */
    let isEmbeddingTask = $derived(taskType === 'index');

    /** 是否为图片生成任务（不需要温度/topP/推理参数） */
    let isImageTask = $derived(taskType === 'image-generate');

    /** 是否显示聊天模型参数（温度、topP、推理强度） */
    let showChatParams = $derived(!isEmbeddingTask && !isImageTask);

    /** 推理强度下拉选项 */
    let reasoningOptions = $derived(() => [
        { value: '', label: i18n.t('taskModels.reasoningEffortOptions.notSet') },
        { value: 'low', label: i18n.t('taskModels.reasoningEffortOptions.low') },
        { value: 'medium', label: i18n.t('taskModels.reasoningEffortOptions.medium') },
        { value: 'high', label: i18n.t('taskModels.reasoningEffortOptions.high') },
    ]);

    /** Provider 下拉选项 */
    let providerOptions = $derived(() => {
        const opts: Array<{ value: string; label: string }> = [
            { value: '', label: i18n.t('taskModels.fields.useDefaultProvider') },
        ];
        for (const [pid, pConfig] of Object.entries(providers)) {
            if (pConfig.enabled) {
                const suffix = pid === defaultProviderId ? ' ★' : '';
                opts.push({ value: pid, label: pid + suffix });
            }
        }
        return opts;
    });

    function handleProviderChange(value: string) {
        onUpdate(taskType, { providerId: value });
    }

    function handleModelChange(value: string) {
        onUpdate(taskType, { model: value });
    }

    function handleTemperatureChange(value: number) {
        onUpdate(taskType, { temperature: value });
    }

    function handleTopPChange(value: number) {
        onUpdate(taskType, { topP: value });
    }

    function handleReasoningEffortChange(value: string) {
        // 空字符串表示不设置
        const effort = value === '' ? undefined : value as "low" | "medium" | "high";
        onUpdate(taskType, { reasoning_effort: effort });
    }
</script>

<div class="cr-task-model-card">
    <!-- 头部：任务名称 + 状态标签 + 重置按钮 -->
    <div class="cr-task-model-card__header">
        <span class="cr-task-model-card__title">
            {i18n.t(`taskModels.tasks.${taskType}.name`)}
        </span>
        <span class="cr-task-model-card__desc">
            {i18n.t(`taskModels.tasks.${taskType}.desc`)}
        </span>
        <span class="cr-task-model-card__spacer"></span>
        {#if !isDefault}
            <button
                type="button"
                class="cr-btn-ghost cr-btn--sm"
                onclick={() => onReset(taskType)}
                aria-label={i18n.t('taskModels.reset')}
            >
                {i18n.t('taskModels.reset')}
            </button>
        {:else}
            <span class="cr-task-model-card__badge">
                {i18n.t('taskModels.isDefault')}
            </span>
        {/if}
    </div>

    <!-- 配置行 -->
    <div class="cr-task-model-card__fields">
        <div class="cr-task-model-card__field">
            <label class="cr-task-model-card__label">
                {i18n.t('taskModels.fields.provider')}
            </label>
            <Select
                value={config.providerId}
                options={providerOptions()}
                onchange={handleProviderChange}
            />
        </div>

        <div class="cr-task-model-card__field">
            <label class="cr-task-model-card__label">
                {i18n.t('taskModels.fields.model')}
            </label>
            <TextInput
                value={config.model}
                placeholder={i18n.t('taskModels.fields.model')}
                onchange={handleModelChange}
                widthClass="cr-input-md"
            />
        </div>

        {#if showChatParams}
            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label">
                    {i18n.t('taskModels.fields.temperature')}
                </label>
                <Slider
                    value={config.temperature ?? 0.7}
                    min={0}
                    max={2}
                    step={0.1}
                    onchange={handleTemperatureChange}
                />
            </div>

            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label">
                    {i18n.t('taskModels.fields.topP')}
                </label>
                <Slider
                    value={config.topP ?? 1}
                    min={0}
                    max={1}
                    step={0.05}
                    onchange={handleTopPChange}
                />
            </div>

            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label">
                    {i18n.t('taskModels.fields.reasoningEffort')}
                </label>
                <Select
                    value={config.reasoning_effort ?? ''}
                    options={reasoningOptions()}
                    onchange={handleReasoningEffortChange}
                />
            </div>
        {/if}
    </div>
</div>

<style>
    .cr-task-model-card {
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md, 6px);
        padding: var(--cr-space-3, 12px);
        background: var(--cr-bg-base);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2, 8px);
    }

    .cr-task-model-card__header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
        flex-wrap: wrap;
    }

    .cr-task-model-card__title {
        font-weight: 600;
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium, 14px);
    }

    .cr-task-model-card__desc {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
    }

    .cr-task-model-card__spacer {
        flex: 1;
    }

    .cr-task-model-card__badge {
        font-size: var(--cr-font-xs, 11px);
        color: var(--cr-text-muted);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm, 4px);
        padding: 0 var(--cr-space-1, 4px);
        line-height: 1.6;
    }

    .cr-task-model-card__fields {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2, 8px);
    }

    .cr-task-model-card__field {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
    }

    .cr-task-model-card__label {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        min-width: 80px;
        flex-shrink: 0;
    }
</style>
