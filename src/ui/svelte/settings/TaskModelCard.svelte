<!--
  TaskModelCard.svelte — 任务模型配置卡片

  为单个任务类型显示 Provider 下拉、模型输入、温度滑块、重置按钮。

-->
<script lang="ts">
    import type { TaskType, TaskModelConfig, ProviderConfig } from '../../../types';
    import Select from '../../components/Select.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Slider from '../../components/Slider.svelte';
    import Button from '../../components/Button.svelte';
    import {
        resolveParameterValue,
        resolveParameterWrite,
        storedParameterMode,
        type TaskParameterInputs,
        type TaskParameterMode,
    } from '../../task-model-parameters';

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

    /** 是否显示聊天模型参数（温度、topP、推理强度） */
    let showChatParams = $derived(!isEmbeddingTask);

    let activeProvider = $derived(providers[config.providerId || (taskType === 'cards' ? '' : defaultProviderId)]);
    let activeApiFormat = $derived(activeProvider?.apiFormat ?? 'openai-chat-completions');
    let inheritedModel = $derived(
        isEmbeddingTask ? activeProvider?.defaultEmbedModel : activeProvider?.defaultChatModel
    );
    let temperatureMax = $derived(2);
    let showLongTaskReasoningWarning = $derived(
        (taskType === 'write' || taskType === 'verify') &&
        (config.reasoning_effort === 'high' ||
            config.reasoning_effort === 'xhigh' ||
            config.reasoning_effort === 'max')
    );
    let maxTokensError = $state('');
    let embeddingDimensionError = $state('');

    /** Provider 下拉选项 */
    let providerOptions = $derived(() => {
        const opts: Array<{ value: string; label: string }> = [
            {
                value: '',
                label: taskType === 'cards' ? i18n.t('cards.chooseProvider') : isEmbeddingTask && providers[defaultProviderId]?.embeddingApiFormat !== 'openai-embeddings'
                    ? i18n.t('taskModels.fields.defaultProviderNoEmbedding')
                    : i18n.t('taskModels.fields.useDefaultProvider'),
            },
        ];
        for (const [pid, pConfig] of Object.entries(providers)) {
            if (pConfig.enabled && (isEmbeddingTask
                ? pConfig.embeddingApiFormat === 'openai-embeddings'
                : pConfig.apiFormat !== 'disabled')) {
                const suffix = pid === defaultProviderId ? ' ★' : '';
                opts.push({ value: pid, label: pid + suffix });
            }
        }
        if (config.providerId && !opts.some((option) => option.value === config.providerId)) {
            opts.push({
                value: config.providerId,
                label: `${config.providerId} (${i18n.t('taskModels.fields.providerUnavailable')})`,
            });
        }
        return opts;
    });

    function handleProviderChange(value: string) {
        const partial: Partial<TaskModelConfig> = { providerId: value };
        onUpdate(taskType, partial);
    }

    function handleModelChange(value: string) {
        onUpdate(taskType, { model: value });
    }

    function handleTemperatureChange(value: number) {
        onUpdate(taskType, { parameters: { temperature: value } });
    }

    type ParameterKey = 'temperature' | 'topP' | 'reasoning_effort' | 'thinkingLevel' | 'thinkingBudget' | 'maxTokens' | 'embeddingDimension';
    type ParameterMode = TaskParameterMode;

    /** 已切换为“指定值”但还没有真实值可写入的参数。 */
    let pendingSetKeys = $state<ParameterKey[]>([]);

    function parameterInputs(key: ParameterKey): TaskParameterInputs {
        const overrides = config.parameters as Record<string, unknown> | undefined;
        return {
            hasOverride: !!overrides && Object.prototype.hasOwnProperty.call(overrides, key),
            override: overrides?.[key],
            legacy: config[key as keyof TaskModelConfig],
            provider: activeProvider?.parameters?.[key as keyof NonNullable<ProviderConfig['parameters']>],
        };
    }

    function parameterMode(key: ParameterKey): ParameterMode {
        const inputs = parameterInputs(key);
        if (pendingSetKeys.includes(key)) return 'set';
        return storedParameterMode(inputs);
    }

    function handleParameterMode(key: ParameterKey, mode: string) {
        const write = resolveParameterWrite(mode as ParameterMode, parameterInputs(key));
        if (write.action === 'pending') {
            // 没有真实值时只展开输入框。写入占位数字（旧实现的 1）会立刻持久化
            // 错误参数：嵌入维度会重置整个向量索引，maxTokens 会截断下一次输出。
            pendingSetKeys = [...new Set([...pendingSetKeys, key])];
            return;
        }
        pendingSetKeys = pendingSetKeys.filter((pending) => pending !== key);
        const value = write.action === 'delete' ? undefined : write.action === 'omit' ? null : write.value;
        const parameters = { [key]: value } as NonNullable<TaskModelConfig['parameters']>;
        // Legacy top-level values otherwise keep overriding the Provider after
        // the modern override is removed by selecting "inherit".
        onUpdate(taskType, { parameters, ...(key in config ? { [key]: undefined } : {}) });
    }

    function parameterModeOptions() {
        return [
            { value: 'inherit', label: i18n.t('taskModels.fields.inherit') },
            { value: 'set', label: i18n.t('taskModels.fields.specified') },
            { value: 'omit', label: i18n.t('taskModels.fields.doNotSend') },
        ];
    }

    function handleTopPChange(value: number) {
        onUpdate(taskType, { parameters: { topP: value } });
    }

    function handleStringParameterChange(key: 'reasoning_effort' | 'thinkingLevel', value: string) {
        const trimmed = value.trim();
        onUpdate(taskType, { parameters: { [key]: trimmed ? trimmed : null } });
    }

    function handleThinkingBudgetChange(value: string) {
        const trimmed = value.trim();
        if (!trimmed) {
            onUpdate(taskType, { parameters: { thinkingBudget: null } });
            return;
        }
        const parsed = Number(trimmed);
        if (Number.isSafeInteger(parsed) && parsed > 0) {
            onUpdate(taskType, { parameters: { thinkingBudget: parsed } });
        }
    }

    function parameterValue(key: ParameterKey): string {
        const inputs = parameterInputs(key);
        if (inputs.hasOverride && inputs.override === null) return '';
        const value = resolveParameterValue(inputs);
        return value === undefined ? '' : String(value);
    }

    function numericParameterValue(key: ParameterKey, fallback: number): number {
        const raw = Number(parameterValue(key));
        return Number.isFinite(raw) ? raw : fallback;
    }

    function handleStructuredOutputChange(value: string) {
        const capabilities = { structuredOutput: value ? value as 'prompt' | 'json_object' | 'json_schema' : undefined };
        onUpdate(taskType, { capabilities });
    }

    function capabilityValue(key: 'nativeWebSearch' | 'promptCaching' | 'responseContinuation'): string {
        const value = config.capabilities?.[key];
        return value === undefined ? '' : value ? 'true' : 'false';
    }

    function handleCapabilityChange(key: 'nativeWebSearch' | 'promptCaching' | 'responseContinuation', value: string) {
        const capabilities = { [key]: value === '' ? undefined : value === 'true' };
        onUpdate(taskType, { capabilities });
    }

    function handleMaxTokensChange(value: string) {
        const trimmed = value.trim();
        if (!trimmed) {
            maxTokensError = '';
            onUpdate(taskType, { parameters: { maxTokens: null } });
            return;
        }
        const parsed = Number(trimmed);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
            maxTokensError = i18n.t('taskModels.fields.positiveIntegerError');
            return;
        }
        maxTokensError = '';
        onUpdate(taskType, { parameters: { maxTokens: parsed } });
    }

    function handleEmbeddingDimensionChange(value: string) {
        const trimmed = value.trim();
        if (!trimmed) {
            embeddingDimensionError = '';
            onUpdate(taskType, { parameters: { embeddingDimension: null } });
            return;
        }
        const parsed = Number(trimmed);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
            embeddingDimensionError = i18n.t('taskModels.fields.positiveIntegerError');
            return;
        }
        embeddingDimensionError = '';
        onUpdate(taskType, { parameters: { embeddingDimension: parsed } });
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
            <Button
                variant="ghost"
                size="sm"
                onclick={() => onReset(taskType)}
                ariaLabel={i18n.t('taskModels.reset')}
            >
                {i18n.t('taskModels.reset')}
            </Button>
        {:else}
            <span class="cr-task-model-card__badge">
                {i18n.t('taskModels.isDefault')}
            </span>
        {/if}
    </div>

    <!-- 配置行 -->
    <div class="cr-task-model-card__fields">
        <div class="cr-task-model-card__field">
            <label class="cr-task-model-card__label" for={`tmc-${taskType}-provider`}>
                {i18n.t('taskModels.fields.provider')}
            </label>
            <Select
                id={`tmc-${taskType}-provider`}
                value={config.providerId}
                options={providerOptions()}
                onchange={handleProviderChange}
            />
        </div>

        <div class="cr-task-model-card__field">
            <label class="cr-task-model-card__label" for={`tmc-${taskType}-model`}>
                {i18n.t('taskModels.fields.model')}
            </label>
            <TextInput
                id={`tmc-${taskType}-model`}
                value={config.model}
                placeholder={taskType === "cards" ? i18n.t('cards.modelPlaceholder') : `${i18n.t('taskModels.fields.useProviderDefaultModel')}${inheritedModel ? `: ${inheritedModel}` : ''}`}
                onchange={handleModelChange}
                widthClass="cr-input-md"
            />
        </div>

        {#if !isEmbeddingTask}
            <div class="cr-task-model-card__capabilities">
                <span class="cr-task-model-card__label">{i18n.t('taskModels.fields.capabilities')}</span>
                {#if taskType === 'write' || taskType === 'verify'}
                    <span>{i18n.t('taskModels.fields.nativeWebSearch')}</span><Select value={capabilityValue('nativeWebSearch')} options={[{ value: '', label: i18n.t('taskModels.fields.inherit') }, { value: 'true', label: i18n.t('taskModels.fields.enabled') }, { value: 'false', label: i18n.t('taskModels.fields.disabled') }]} onchange={(value) => handleCapabilityChange('nativeWebSearch', value)} />
                {/if}
                <span>{i18n.t('taskModels.fields.promptCaching')}</span><Select value={capabilityValue('promptCaching')} options={[{ value: '', label: i18n.t('taskModels.fields.inherit') }, { value: 'true', label: i18n.t('taskModels.fields.enabled') }, { value: 'false', label: i18n.t('taskModels.fields.disabled') }]} onchange={(value) => handleCapabilityChange('promptCaching', value)} />
                {#if taskType !== 'cards'}
                <span>{i18n.t('taskModels.fields.responseContinuation')}</span><Select value={capabilityValue('responseContinuation')} options={[{ value: '', label: i18n.t('taskModels.fields.inherit') }, { value: 'true', label: i18n.t('taskModels.fields.enabled') }, { value: 'false', label: i18n.t('taskModels.fields.disabled') }]} onchange={(value) => handleCapabilityChange('responseContinuation', value)} />
                {/if}
            </div>
            {#if taskType !== 'cards'}
            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label" for={`tmc-${taskType}-structured`}>{i18n.t('taskModels.fields.structuredOutput')}</label>
                <Select
                    id={`tmc-${taskType}-structured`}
                    value={config.capabilities?.structuredOutput ?? ''}
                    options={[
                        { value: '', label: i18n.t('taskModels.fields.inherit') },
                        { value: 'prompt', label: i18n.t('taskModels.fields.structuredOutputOptions.prompt') },
                        { value: 'json_object', label: i18n.t('taskModels.fields.structuredOutputOptions.json_object') },
                        { value: 'json_schema', label: i18n.t('taskModels.fields.structuredOutputOptions.json_schema') },
                    ]}
                    onchange={handleStructuredOutputChange}
                />
            </div>
            {/if}
        {/if}

        {#if isEmbeddingTask}
            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label" for={`tmc-${taskType}-dimension`}>
                    {i18n.t('taskModels.fields.embeddingDimension')}
                </label>
                <Select value={parameterMode('embeddingDimension')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('embeddingDimension', value)} />
                <div class="cr-task-model-card__input-stack">
                    {#if parameterMode('embeddingDimension') === 'set'}
                    <TextInput
                        id={`tmc-${taskType}-dimension`}
                        value={parameterValue('embeddingDimension')}
                        placeholder={i18n.t('taskModels.fields.optional')}
                        invalid={Boolean(embeddingDimensionError)}
                        ariaDescribedBy={embeddingDimensionError ? `tmc-${taskType}-dimension-error` : undefined}
                        onchange={handleEmbeddingDimensionChange}
                        widthClass="cr-input-sm"
                    />
                    {/if}
                    {#if embeddingDimensionError}
                        <span id={`tmc-${taskType}-dimension-error`} class="cr-task-model-card__error" role="alert">
                            {embeddingDimensionError}
                        </span>
                    {/if}
                </div>
            </div>
        {/if}

            {#if showChatParams}
            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label" for={`tmc-${taskType}-temp`}>
                    {i18n.t('taskModels.fields.temperature')}
                </label>
                <Select value={parameterMode('temperature')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('temperature', value)} />
                {#if parameterMode('temperature') === 'set'}
                    <Slider
                        id={`tmc-${taskType}-temp`}
                        value={numericParameterValue('temperature', 0.7)}
                        min={0}
                        max={temperatureMax}
                        step={0.1}
                        ariaLabel={i18n.t('taskModels.fields.temperature')}
                        onchange={handleTemperatureChange}
                    />
                {/if}
            </div>

            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label" for={`tmc-${taskType}-topp`}>
                    {i18n.t('taskModels.fields.topP')}
                </label>
                <Select value={parameterMode('topP')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('topP', value)} />
                {#if parameterMode('topP') === 'set'}
                    <Slider
                        id={`tmc-${taskType}-topp`}
                        value={numericParameterValue('topP', 1)}
                        min={0}
                        max={1}
                        step={0.05}
                        ariaLabel={i18n.t('taskModels.fields.topP')}
                        onchange={handleTopPChange}
                    />
                {/if}
            </div>

            {/if}

            {#if showChatParams}
            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label" for={`tmc-${taskType}-reasoning`}>
                    {i18n.t('taskModels.fields.reasoningEffort')}
                </label>
                {#if activeApiFormat === 'gemini-generative-language'}
                    <div class="cr-task-model-card__parameter-row">
                        <span>{i18n.t('taskModels.fields.thinkingLevel')}</span>
                        <Select value={parameterMode('thinkingLevel')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('thinkingLevel', value)} />
                        {#if parameterMode('thinkingLevel') === 'set'}
                            <TextInput value={parameterValue('thinkingLevel')} placeholder="LOW / HIGH" onchange={(value) => handleStringParameterChange('thinkingLevel', value)} widthClass="cr-input-sm" />
                        {/if}
                    </div>
                    <div class="cr-task-model-card__parameter-row">
                        <span>{i18n.t('taskModels.fields.thinkingBudget')}</span>
                        <Select value={parameterMode('thinkingBudget')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('thinkingBudget', value)} />
                        {#if parameterMode('thinkingBudget') === 'set'}
                            <TextInput value={parameterValue('thinkingBudget')} placeholder={i18n.t('taskModels.fields.optional')} onchange={handleThinkingBudgetChange} widthClass="cr-input-sm" />
                        {/if}
                    </div>
                {:else}
                    <Select value={parameterMode('reasoning_effort')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('reasoning_effort', value)} />
                    {#if parameterMode('reasoning_effort') === 'set'}
                        <TextInput id={`tmc-${taskType}-reasoning`} value={parameterValue('reasoning_effort')} placeholder="effort" onchange={(value) => handleStringParameterChange('reasoning_effort', value)} widthClass="cr-input-sm" />
                    {/if}
                {/if}
            </div>

            {#if showLongTaskReasoningWarning}
                <div class="cr-task-model-card__warning" role="status">
                    {i18n.t('taskModels.fields.longTaskReasoningWarning')}
                </div>
            {/if}

            <div class="cr-task-model-card__field">
                <label class="cr-task-model-card__label" for={`tmc-${taskType}-max-tokens`}>
                    {i18n.t('taskModels.fields.maxTokens')}
                </label>
                <Select value={parameterMode('maxTokens')} options={parameterModeOptions()} onchange={(value) => handleParameterMode('maxTokens', value)} />
                <div class="cr-task-model-card__input-stack">
                    {#if parameterMode('maxTokens') === 'set'}
                    <TextInput
                        id={`tmc-${taskType}-max-tokens`}
                        value={parameterValue('maxTokens')}
                        placeholder={i18n.t('taskModels.fields.maxTokensPlaceholder')}
                        invalid={Boolean(maxTokensError)}
                        ariaDescribedBy={`tmc-${taskType}-max-tokens-desc${maxTokensError ? ` tmc-${taskType}-max-tokens-error` : ''}`}
                        onchange={handleMaxTokensChange}
                        widthClass="cr-input-sm"
                    />
                    {/if}
                    {#if maxTokensError}
                        <span id={`tmc-${taskType}-max-tokens-error`} class="cr-task-model-card__error" role="alert">
                            {maxTokensError}
                        </span>
                    {/if}
                </div>
            </div>
            {/if}
    </div>
</div>

<style>
    .cr-task-model-card {
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        padding: var(--cr-space-3);
        background: var(--cr-bg-base);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-task-model-card__header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        flex-wrap: wrap;
    }

    .cr-task-model-card__title {
        font-weight: 600;
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium);
    }

    .cr-task-model-card__desc {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
    }

    .cr-task-model-card__spacer {
        flex: 1;
    }

    .cr-task-model-card__badge {
        font-size: var(--cr-font-xs);
        color: var(--cr-text-muted);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-sm);
        padding: 0 var(--cr-space-1);
        line-height: 1.6;
    }

    .cr-task-model-card__fields {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-task-model-card__field {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
    }

    .cr-task-model-card__label {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
        min-width: 80px;
        flex-shrink: 0;
    }

    .cr-task-model-card__capabilities {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        flex-wrap: wrap;
    }

    .cr-task-model-card__input-stack {
        display: flex;
        min-width: 0;
        flex: 1;
        flex-direction: column;
        gap: var(--cr-space-1);
    }

    .cr-task-model-card__error {
        color: var(--cr-status-error);
        font-size: var(--cr-font-xs);
        line-height: 1.3;
    }

    :global(.cr-task-model-card__description) {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-xs);
        line-height: 1.35;
    }

    .cr-task-model-card__warning {
        padding: var(--cr-space-2);
        border-left: 3px solid var(--cr-status-warning);
        background: var(--cr-overlay-warning-15);
        color: var(--cr-text-normal);
        font-size: var(--cr-font-sm);
        line-height: 1.4;
    }
</style>
