<!-- Expanded contents of one task. The task list owns the outer accordion. -->
<script lang="ts">
    import type { ModelCapabilities, TaskType, TaskModelConfig, ProviderConfig, ResolvedTaskConfig } from '../../../types';
    import Select from '../../components/Select.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Button from '../../components/Button.svelte';
    import {
        resolveParameterValue,
        resolveParameterWrite,
        storedParameterMode,
        type TaskParameterMode,
    } from '../../task-model-parameters';
    import {
        describeTaskParameter,
        taskCapabilitySource,
        taskParameterInputs,
        type TaskParameterKey,
        type ParameterSource,
    } from '../../task-parameter-summary';

    let {
        taskType, config, providers, defaultProviderId, resolved, isDefault = false, i18n, onUpdate, onReset,
    }: {
        taskType: TaskType;
        config: TaskModelConfig;
        providers: Record<string, ProviderConfig>;
        defaultProviderId: string;
        /** The exact current runtime resolver result, including capability filtering. */
        resolved: ResolvedTaskConfig;
        isDefault: boolean;
        i18n: { t: (key: string) => string };
        onUpdate: (taskType: TaskType, partial: Partial<TaskModelConfig>) => void;
        onReset: (taskType: TaskType) => void;
    } = $props();

    type BooleanCapability = 'nativeWebSearch' | 'promptCaching' | 'responseContinuation';
    let isEmbeddingTask = $derived(taskType === 'index');
    let activeProvider = $derived(providers[resolved.providerId]);
    let activeApiFormat = $derived(activeProvider?.apiFormat);
    let providerAvailable = $derived(Boolean(activeProvider?.enabled && (isEmbeddingTask
        ? activeProvider.embeddingApiFormat === 'openai-embeddings' : activeProvider.apiFormat !== 'disabled')));
    let requestBlocked = $derived(!providerAvailable || !resolved.model.trim());
    let inheritedModel = $derived(isEmbeddingTask ? activeProvider?.defaultEmbedModel : activeProvider?.defaultChatModel);
    let showLongTaskReasoningWarning = $derived(
        (taskType === 'write' || taskType === 'verify') &&
        ['high', 'xhigh', 'max'].includes(resolved.reasoningEffort ?? '')
    );

    /** Transient UI drafts never become stored placeholder values. */
    let pendingSetKeys = $state<TaskParameterKey[]>([]);
    let draftValues = $state<Partial<Record<TaskParameterKey, string>>>({});
    let parameterErrors = $state<Partial<Record<TaskParameterKey, string>>>({});
    let parameterKeys = $derived.by((): TaskParameterKey[] => {
        if (isEmbeddingTask) return ['embeddingDimension'];
        const keys: TaskParameterKey[] = ['temperature', 'topP'];
        if (activeApiFormat === 'gemini-generative-language') {
            keys.push('thinkingLevel', 'thinkingBudget');
            if (resolveParameterValue(parameterInputs('reasoning_effort')) !== undefined || config.parameters?.reasoning_effort === null) keys.push('reasoning_effort');
        } else {
            keys.push('reasoning_effort');
            for (const key of ['thinkingLevel', 'thinkingBudget'] as const) {
                if (resolveParameterValue(parameterInputs(key)) !== undefined || config.parameters?.[key] === null) keys.push(key);
            }
        }
        keys.push('maxTokens');
        return keys;
    });
    let capabilityKeys = $derived.by((): BooleanCapability[] => [
        ...(taskType === 'write' || taskType === 'verify' ? ['nativeWebSearch' as const] : []),
        'promptCaching',
        ...(taskType !== 'cards' ? ['responseContinuation' as const] : []),
    ]);
    let providerOptions = $derived.by(() => {
        const opts = [{ value: '', label: taskType === 'cards' ? i18n.t('cards.chooseProvider')
            : isEmbeddingTask && providers[defaultProviderId]?.embeddingApiFormat !== 'openai-embeddings'
                ? i18n.t('taskModels.fields.defaultProviderNoEmbedding') : i18n.t('settings.taskDetails.defaultProvider') }];
        for (const [id, provider] of Object.entries(providers)) {
            if (provider.enabled && (isEmbeddingTask ? provider.embeddingApiFormat === 'openai-embeddings' : provider.apiFormat !== 'disabled')) {
                opts.push({ value: id, label: `${id}${id === defaultProviderId ? ` · ${i18n.t('settings.taskDetails.default')}` : ''}` });
            }
        }
        if (config.providerId && !opts.some((option) => option.value === config.providerId)) {
            opts.push({ value: config.providerId, label: `${config.providerId} (${i18n.t('taskModels.fields.providerUnavailable')})` });
        }
        return opts;
    });

    function text(key: string): string { return i18n.t(`settings.taskDetails.${key}`); }
    function parameterInputs(key: TaskParameterKey) { return taskParameterInputs(key, config, activeProvider); }
    function parameterMode(key: TaskParameterKey): TaskParameterMode {
        return pendingSetKeys.includes(key) ? 'set' : storedParameterMode(parameterInputs(key));
    }
    function parameterValue(key: TaskParameterKey): string {
        if (draftValues[key] !== undefined) return draftValues[key];
        const inputs = parameterInputs(key);
        if (inputs.hasOverride && inputs.override === null) return '';
        const value = resolveParameterValue(inputs);
        return value === undefined ? '' : String(value);
    }
    function parameterLabel(key: TaskParameterKey): string {
        const labels = { temperature: 'temperature', topP: 'topP', reasoning_effort: 'reasoningEffort', thinkingLevel: 'thinkingLevel', thinkingBudget: 'thinkingBudget', maxTokens: 'maxTokens', embeddingDimension: 'embeddingDimension' };
        return key === 'temperature' || key === 'maxTokens' ? text(key) : i18n.t(`taskModels.fields.${labels[key]}`);
    }
    function parameterId(key: TaskParameterKey): string {
        const ids = { temperature: 'temp', topP: 'topp', reasoning_effort: 'reasoning', thinkingLevel: 'thinking-level', thinkingBudget: 'thinking-budget', maxTokens: 'max-tokens', embeddingDimension: 'dimension' };
        return `tmc-${taskType}-${ids[key]}`;
    }
    function sourceText(source: ParameterSource): string {
        return source === 'provider' ? `${text('fromProvider')}${resolved.providerId}` : text(source === 'task' ? 'fromTask' : 'notConfigured');
    }
    function clearDraft(key: TaskParameterKey) {
        pendingSetKeys = pendingSetKeys.filter((pending) => pending !== key);
        delete draftValues[key];
        delete parameterErrors[key];
    }
    function writeParameter(key: TaskParameterKey, value: unknown) {
        const parameters = { [key]: value } as NonNullable<TaskModelConfig['parameters']>;
        // Removing a modern override must also remove its legacy task override.
        onUpdate(taskType, { parameters, ...(key in config ? { [key]: undefined } : {}) });
    }
    function handleParameterMode(key: TaskParameterKey, mode: string) {
        const write = resolveParameterWrite(mode as TaskParameterMode, parameterInputs(key));
        clearDraft(key);
        if (write.action === 'pending') {
            pendingSetKeys = [...pendingSetKeys, key];
            draftValues[key] = '';
            return;
        }
        writeParameter(key, write.action === 'delete' ? undefined : write.action === 'omit' ? null : write.value);
    }
    function handleParameterChange(key: TaskParameterKey, raw: string) {
        const value = raw.trim();
        draftValues[key] = raw;
        if (!value) {
            parameterErrors[key] = text('valueRequired');
            pendingSetKeys = [...new Set([...pendingSetKeys, key])];
            return;
        }
        if (key === 'reasoning_effort' || key === 'thinkingLevel') {
            clearDraft(key);
            writeParameter(key, value);
            return;
        }
        const parsed = Number(value);
        if (key === 'temperature' || key === 'topP') {
            const max = key === 'temperature' ? 2 : 1;
            if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
                parameterErrors[key] = text(key === 'temperature' ? 'temperatureError' : 'topPError');
                return;
            }
        } else if (!Number.isSafeInteger(parsed) || parsed <= 0) {
            parameterErrors[key] = i18n.t('taskModels.fields.positiveIntegerError');
            return;
        }
        clearDraft(key);
        writeParameter(key, parsed);
    }
    function parameterModeOptions() {
        return [{ value: 'inherit', label: text('inherit') }, { value: 'set', label: text('specified') }, { value: 'omit', label: i18n.t('taskModels.fields.doNotSend') }];
    }
    function capabilityValue(key: BooleanCapability): string {
        const value = config.capabilities?.[key];
        return value === undefined ? '' : String(value);
    }
    function capabilitySource(key: keyof ModelCapabilities): string {
        const source = taskCapabilitySource(key, config, activeProvider);
        return source === 'none' ? text('pluginDefault') : sourceText(source);
    }
    function handleCapabilityChange(key: BooleanCapability, value: string) {
        onUpdate(taskType, { capabilities: { [key]: value === '' ? undefined : value === 'true' } });
    }
    function handleStructuredOutputChange(value: string) {
        onUpdate(taskType, { capabilities: { structuredOutput: value ? value as 'prompt' | 'json_object' | 'json_schema' : undefined } });
    }
    function handleReset() {
        pendingSetKeys = [];
        draftValues = {};
        parameterErrors = {};
        onReset(taskType);
    }
</script>

<div class="cr-task-model-card">
    <div class="cr-task-model-card__overview">
        <div class="cr-task-model-card__overview-heading">
            <span class="cr-task-model-card__description">{text(taskType === 'cards' ? 'independent' : isDefault ? 'defaultConfig' : 'customConfig')}</span>
            {#if !isDefault}
                <Button variant="ghost" size="sm" onclick={handleReset} ariaLabel={i18n.t('taskModels.reset')}>{i18n.t('taskModels.reset')}</Button>
            {/if}
        </div>
        <p class="cr-task-model-card__resolved">{resolved.providerId || text('providerMissing')} · {resolved.model || text('modelMissing')}</p>
        <p class="cr-task-model-card__description">{text('resolvedHint')}</p>
        {#if !providerAvailable}
            <p class="cr-task-model-card__warning" role="status">{text('providerUnavailable')}</p>
        {:else if !resolved.model.trim()}
            <p class="cr-task-model-card__warning" role="status">{text('modelUnavailable')}</p>
        {/if}
    </div>

    <div class="cr-task-model-card__basic cr-task-model-card__field">
        <label for={`tmc-${taskType}-provider`}>{text('provider')}</label>
        <Select id={`tmc-${taskType}-provider`} value={config.providerId} options={providerOptions} onchange={(value) => onUpdate(taskType, { providerId: value })} />
        <p class="cr-task-model-card__description">{taskType === 'cards' ? text('cardsProviderHint') : config.providerId ? text('fromTask') : text('defaultProviderHint')}</p>
    </div>
    <div class="cr-task-model-card__basic cr-task-model-card__field">
        <label for={`tmc-${taskType}-model`}>{text('model')}</label>
        <TextInput id={`tmc-${taskType}-model`} value={config.model}
            placeholder={taskType === 'cards' ? i18n.t('cards.modelPlaceholder') : inheritedModel || text('modelMissing')}
            onchange={(value) => onUpdate(taskType, { model: value })} />
        <p class="cr-task-model-card__description">{taskType === 'cards' ? text('cardsModelHint') : config.model.trim() ? text('modelSpecified') : `${text('modelInherited')}${inheritedModel || text('modelMissing')}`}</p>
    </div>

    <details class="cr-task-model-card__advanced">
        <summary>
            <span>{text('advanced')}</span><span class="cr-task-model-card__chevron" aria-hidden="true">›</span>
        </summary>
        <p class="cr-task-model-card__description cr-task-model-card__intro">{text('modeHint')}</p>
        <p class="cr-task-model-card__description cr-task-model-card__intro">{text('capabilityHint')}</p>
        {#each parameterKeys as key (key)}
            {@const summary = describeTaskParameter(key, config, resolved)}
            <div class="cr-task-model-card__parameter cr-task-model-card__field" data-parameter={key}>
                <label class="cr-task-model-card__parameter-label" for={`${parameterId(key)}-mode`}>{parameterLabel(key)}</label>
                <div class="cr-task-model-card__parameter-controls">
                    <Select id={`${parameterId(key)}-mode`} value={parameterMode(key)} options={parameterModeOptions()}
                        ariaLabel={`${parameterLabel(key)} · ${text('mode')}`} onchange={(value) => handleParameterMode(key, value)} />
                    {#if parameterMode(key) === 'set'}
                        {#if key === 'reasoning_effort' || key === 'thinkingLevel'}
                            <TextInput id={parameterId(key)} value={parameterValue(key)} placeholder={text('enterValue')}
                                ariaLabel={parameterLabel(key)} invalid={Boolean(parameterErrors[key])}
                                ariaDescribedBy={`${parameterId(key)}-desc${parameterErrors[key] ? ` ${parameterId(key)}-error` : ''}`}
                                onchange={(value) => handleParameterChange(key, value)} />
                        {:else}
                            <input type="number" class="cr-task-model-card__number" id={parameterId(key)} value={parameterValue(key)}
                                min={key === 'temperature' || key === 'topP' ? 0 : 1}
                                max={key === 'temperature' ? 2 : key === 'topP' ? 1 : undefined}
                                step={key === 'temperature' || key === 'topP' ? 'any' : 1}
                                placeholder={text('enterValue')} aria-label={parameterLabel(key)}
                                aria-invalid={parameterErrors[key] ? 'true' : undefined}
                                aria-describedby={`${parameterId(key)}-desc${parameterErrors[key] ? ` ${parameterId(key)}-error` : ''}`}
                                onchange={(event) => handleParameterChange(key, event.currentTarget.value)} />
                        {/if}
                    {/if}
                </div>
                <div id={`${parameterId(key)}-desc`} class="cr-task-model-card__parameter-result">
                    {#if summary.omitted}
                        <span>{text('omitted')}</span>
                        <span class="cr-task-model-card__description">{text('fromTask')}</span>
                    {:else if summary.unsupported}
                        <span class="cr-task-model-card__warning">{text('notSent')}</span>
                        <span class="cr-task-model-card__warning">{text('unsupported')}</span>
                        {#if summary.configuredValue !== undefined}
                            <span class="cr-task-model-card__description">{text('retainedValue')}{String(summary.configuredValue)} · {sourceText(summary.source)}{text('retainedHint')}</span>
                        {/if}
                    {:else if summary.value !== undefined}
                        {#if requestBlocked}<span class="cr-task-model-card__description">{text('resolvedOnly')}</span>{/if}
                        <div class="cr-task-model-card__effective-value"><strong>{summary.value}</strong><span class="cr-task-model-card__description">{sourceText(summary.source)}</span></div>
                    {:else}
                        <span class="cr-task-model-card__description">{text('unset')}</span>
                    {/if}
                    {#if summary.protocolIssue}
                        <span class="cr-task-model-card__warning" role="status">{text(`protocol.${summary.protocolIssue}`)}</span>
                    {/if}
                    {#if pendingSetKeys.includes(key)}
                        <span class="cr-task-model-card__description">{text('pendingValue')}</span>
                    {/if}
                    {#if parameterErrors[key]}
                        <span id={`${parameterId(key)}-error`} class="cr-task-model-card__error" role="alert">{parameterErrors[key]}</span>
                    {/if}
                </div>
            </div>
        {/each}
        {#if showLongTaskReasoningWarning}
            <p class="cr-task-model-card__warning cr-task-model-card__intro" role="status">{i18n.t('taskModels.fields.longTaskReasoningWarning')}</p>
        {/if}

        {#if !isEmbeddingTask}
            <details class="cr-task-model-card__capabilities">
                <summary><span>{text('capabilities')}</span><span class="cr-task-model-card__chevron" aria-hidden="true">›</span></summary>
                <p class="cr-task-model-card__description cr-task-model-card__intro">{text('capabilitiesHint')}</p>
                {#each capabilityKeys as key (key)}
                    <div class="cr-task-model-card__parameter cr-task-model-card__field">
                        <label for={`tmc-${taskType}-${key}`}>{i18n.t(`taskModels.fields.${key}`)}</label>
                        <div class="cr-task-model-card__parameter-controls">
                            <Select id={`tmc-${taskType}-${key}`} value={capabilityValue(key)}
                                options={[{ value: '', label: text('inherit') }, { value: 'true', label: i18n.t('taskModels.fields.enabled') }, { value: 'false', label: i18n.t(key === 'promptCaching' ? 'taskModels.fields.promptCachingDisabled' : 'taskModels.fields.disabled') }]}
                                onchange={(value) => handleCapabilityChange(key, value)} />
                        </div>
                        <div class="cr-task-model-card__parameter-result cr-task-model-card__description">
                            <span>{key === 'promptCaching' && !resolved.capabilities[key] ? i18n.t('taskModels.fields.promptCachingDisabled') : i18n.t(`taskModels.fields.${resolved.capabilities[key] ? 'enabled' : 'disabled'}`)} · {capabilitySource(key)}</span>
                            {#if key === 'promptCaching'}<span>{i18n.t('taskModels.fields.promptCachingDesc')}</span>{/if}
                        </div>
                    </div>
                {/each}
                {#if taskType !== 'cards'}
                    <div class="cr-task-model-card__parameter cr-task-model-card__field">
                        <label for={`tmc-${taskType}-structured`}>{i18n.t('taskModels.fields.structuredOutput')}</label>
                        <div class="cr-task-model-card__parameter-controls">
                            <Select id={`tmc-${taskType}-structured`} value={config.capabilities?.structuredOutput ?? ''}
                                options={[{ value: '', label: text('inherit') }, ...(['prompt', 'json_object', 'json_schema'] as const).map((value) => ({ value, label: i18n.t(`taskModels.fields.structuredOutputOptions.${value}`) }))]}
                                onchange={handleStructuredOutputChange} />
                        </div>
                        <div class="cr-task-model-card__parameter-result cr-task-model-card__description">
                            <span>{i18n.t(`taskModels.fields.structuredOutputOptions.${resolved.capabilities.structuredOutput}`)} · {capabilitySource('structuredOutput')}</span>
                        </div>
                    </div>
                {/if}
            </details>
        {/if}
        <p class="cr-task-model-card__description cr-task-model-card__footnote">{text('emptySpecifiedHint')}</p>
    </details>
</div>

<style>
    .cr-task-model-card { min-width: 0; color: var(--cr-text-normal); }
    .cr-task-model-card p { margin: 0; }
    .cr-task-model-card__overview { padding: var(--cr-space-3) 0 var(--cr-space-5); }
    .cr-task-model-card__overview-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--cr-space-2); }
    .cr-task-model-card__resolved { font-size: var(--font-ui-medium); line-height: 1.5; overflow-wrap: anywhere; margin: var(--cr-space-2) 0 !important; }
    .cr-task-model-card__description { color: var(--cr-text-muted); font-size: var(--font-ui-small); line-height: 1.6; overflow-wrap: anywhere; }
    .cr-task-model-card__basic { display: flex; flex-direction: column; gap: var(--cr-space-2); padding: var(--cr-space-5) 0; border-top: 1px solid var(--cr-border); }
    .cr-task-model-card__basic :global(input), .cr-task-model-card__basic :global(select) { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; min-height: 36px; background-color: var(--cr-bg-secondary); }
    .cr-task-model-card__advanced, .cr-task-model-card__capabilities { border-top: 1px solid var(--cr-border); }
    .cr-task-model-card summary { display: flex; align-items: center; justify-content: space-between; gap: var(--cr-space-3); min-height: 44px; padding: var(--cr-space-4) 0; color: var(--cr-text-normal); cursor: pointer; list-style: none; font-weight: 600; }
    .cr-task-model-card summary::-webkit-details-marker { display: none; }
    .cr-task-model-card summary:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; border-radius: var(--cr-radius-sm); }
    .cr-task-model-card__chevron { color: var(--cr-text-muted); flex-shrink: 0; }
    .cr-task-model-card details[open] > summary .cr-task-model-card__chevron { transform: rotate(90deg); }
    .cr-task-model-card__intro { padding-bottom: var(--cr-space-2); }
    .cr-task-model-card__parameter { display: grid; grid-template-columns: minmax(0, 1fr) minmax(110px, 160px); gap: var(--cr-space-2) var(--cr-space-4); align-items: start; border-top: 1px solid var(--cr-border); padding: var(--cr-space-5) 0; }
    .cr-task-model-card__parameter-label { font-weight: 600; }
    .cr-task-model-card__parameter label { min-width: 0; line-height: 1.6; padding-top: var(--cr-space-1); overflow-wrap: anywhere; }
    .cr-task-model-card__parameter-controls { grid-column: 2; grid-row: 1 / span 2; display: flex; flex-direction: column; gap: var(--cr-space-2); min-width: 0; }
    .cr-task-model-card__parameter-controls :global(input), .cr-task-model-card__parameter-controls :global(select) { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; min-height: 36px; background-color: var(--cr-bg-secondary); }
    .cr-task-model-card__number { border: 1px solid var(--cr-border); border-radius: var(--cr-radius-sm); padding: var(--cr-space-1) var(--cr-space-2); color: var(--cr-text-normal); font-size: var(--font-ui-small); }
    .cr-task-model-card__number:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: -1px; }
    .cr-task-model-card__number[aria-invalid='true'] { border-color: var(--cr-status-error); }
    .cr-task-model-card__parameter-result { display: flex; flex-direction: column; gap: var(--cr-space-1); min-width: 0; font-size: var(--font-ui-small); line-height: 1.5; overflow-wrap: anywhere; }
    .cr-task-model-card__effective-value { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--cr-space-2); }
    .cr-task-model-card__effective-value strong { font-size: var(--font-ui-medium); font-weight: 600; }
    .cr-task-model-card__warning { color: var(--cr-status-warning); font-size: var(--font-ui-small); line-height: 1.6; overflow-wrap: anywhere; }
    .cr-task-model-card__error { color: var(--cr-status-error); font-size: var(--font-ui-small); line-height: 1.5; }
    .cr-task-model-card__capabilities > summary { font-weight: 400; }
    .cr-task-model-card__footnote { border-top: 1px solid var(--cr-border); padding: var(--cr-space-5) 0; }
    @media (max-width: 420px) {
        .cr-task-model-card__parameter { grid-template-columns: minmax(0, 1fr) minmax(100px, 42%); gap: var(--cr-space-2); }
        .cr-task-model-card__parameter-result { grid-column: 1 / -1; }
        .cr-task-model-card__parameter-controls { grid-row: auto; }
    }
</style>
