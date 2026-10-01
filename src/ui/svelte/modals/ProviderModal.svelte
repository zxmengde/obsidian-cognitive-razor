<!--
  ProviderModal.svelte — 添加/编辑 Provider 配置 Modal

  表单字段：名称（Provider ID）、API Key（密码输入）、Base URL、
  默认聊天模型、默认嵌入模型、启用开关。
   连接测试按钮、保存/取消按钮。容器生命周期由 ModalShell 统一处理。

-->
<script lang="ts">
    import { onDestroy, untrack } from 'svelte';
    import Button from '../../components/Button.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import PasswordInput from '../../components/PasswordInput.svelte';
    import Select from '../../components/Select.svelte';
    import Toggle from '../../components/Toggle.svelte';
    import ModalShell from '../../components/ModalShell.svelte';
    import { DEFAULT_ENDPOINTS } from '../../../types';
    import type { EmbeddingApiFormat, ProviderApiFormat, ProviderConfig, Result } from '../../../types';
    import type { ProviderProbeRequest } from '../../../core/model-gateway';
    import type { I18n } from '../../../core/i18n';
    import { isValidProviderId } from '../../../data/settings-store';
    import ProviderProbeStatus from '../settings/ProviderProbeStatus.svelte';
    import type { ProviderProbeReadModel } from '../../provider-probe-result';
    import { toSafeErrorFeedback } from '../../error-feedback';

    let {
        mode,
        providerId = '',
        currentConfig = undefined,
        ontest,
        i18n,
        onsave,
        oncancel,
    }: {
        mode: 'add' | 'edit';
        providerId?: string;
        currentConfig?: ProviderConfig;
        ontest: (request: ProviderProbeRequest, signal?: AbortSignal) => Promise<ProviderProbeReadModel | undefined>;
        i18n: I18n;
        onsave: (id: string, config: ProviderConfig) => Promise<Result<void>>;
        oncancel: () => void;
    } = $props();

    /** 表单状态（untrack 避免 state_referenced_locally 警告：这些是有意的单次初始化） */
    let formId = $state(untrack(() => providerId));
    let formApiKey = $state(untrack(() => currentConfig?.apiKey ?? ''));
    let formBaseUrl = $state(untrack(() => currentConfig?.baseUrl ?? ''));
    let formApiFormat = $state<ProviderApiFormat>(untrack(() => currentConfig?.apiFormat ?? 'openai-chat-completions'));
    let formEnableWebSearch = $state(untrack(
        () => currentConfig?.capabilities?.nativeWebSearch ?? currentConfig?.enableWebSearch ?? false
    ));
    let formTemperatureSupported = $state(untrack(() => currentConfig?.capabilities?.temperature ?? false));
    let formTopPSupported = $state(untrack(() => currentConfig?.capabilities?.topP ?? false));
    let formReasoningSupported = $state(untrack(() => currentConfig?.capabilities?.reasoning ?? false));
    let formPromptCaching = $state(untrack(() => currentConfig?.capabilities?.promptCaching ?? false));
    let formPromptCacheMode = $state<'implicit' | 'explicit'>(untrack(() => currentConfig?.capabilities?.promptCacheMode ?? 'implicit'));
    let formResponseContinuation = $state(untrack(() => currentConfig?.capabilities?.responseContinuation ?? false));
    let formStructuredOutput = $state<NonNullable<ProviderConfig['capabilities']>['structuredOutput']>(untrack(() => currentConfig?.capabilities?.structuredOutput ?? 'prompt'));
    let formTemperature = $state(untrack(() => currentConfig?.parameters?.temperature ?? 0.7));
    let formTopP = $state(untrack(() => currentConfig?.parameters?.topP ?? 1));
    let formReasoningEffort = $state(untrack(() => currentConfig?.parameters?.reasoning_effort ?? ''));
    let formThinkingLevel = $state(untrack(() => currentConfig?.parameters?.thinkingLevel ?? ''));
    let formThinkingBudget = $state(untrack(() => currentConfig?.parameters?.thinkingBudget === undefined ? '' : String(currentConfig.parameters.thinkingBudget)));
    let formMaxTokens = $state(untrack(() => currentConfig?.parameters?.maxTokens === undefined ? '' : String(currentConfig.parameters.maxTokens)));
    let formEmbeddingDimension = $state(untrack(() => currentConfig?.parameters?.embeddingDimension === undefined ? '' : String(currentConfig.parameters.embeddingDimension)));
    let formEmbeddingApiFormat = $state<EmbeddingApiFormat>(untrack(
        () => currentConfig?.embeddingApiFormat ?? (
            currentConfig?.apiFormat === 'gemini-generative-language'
                ? 'disabled'
                : 'openai-embeddings'
        )
    ));
    let formChatModel = $state(untrack(() => currentConfig?.defaultChatModel ?? ''));
    let formEmbedModel = $state(untrack(() => currentConfig?.defaultEmbedModel ?? ''));
    let formEnabled = $state(untrack(() => currentConfig?.enabled ?? true));

    /** UI 状态 */
    let saving = $state(false);
    let testing = $state(false);
    let testResult = $state<ProviderProbeReadModel | undefined>();
    let saveError = $state<string | undefined>();
    let errors = $state<Record<string, string>>({});
    let testAbortController: AbortController | undefined;
    let testedSignature: string | undefined;

    /** 标题 ID（aria-labelledby） */
    const titleId = `cr-provider-title-${Math.random().toString(36).slice(2, 8)}`;

    /** 标题文本 */
    let title = $derived(
        mode === 'add'
            ? i18n.t('modals.addProvider.title')
            : i18n.t('modals.editProvider.title')
    );

    let endpointPlaceholder = $derived(
        formApiFormat === 'disabled'
            ? DEFAULT_ENDPOINTS['openai-chat-completions']
            : DEFAULT_ENDPOINTS[formApiFormat]
    );

    /** 翻译快捷方式 */
    function t(key: string): string {
        return i18n.t(key);
    }

    const apiFormatOptions = [
        { value: 'openai-chat-completions', label: t('modals.providerConfig.apiFormats.openaiChatCompletions') },
        { value: 'openai-responses', label: t('modals.providerConfig.apiFormats.openaiResponses') },
        { value: 'gemini-generative-language', label: t('modals.providerConfig.apiFormats.geminiGenerativeLanguage') },
        { value: 'disabled', label: t('modals.providerConfig.apiFormats.disabled') },
    ];

    const embeddingApiFormatOptions = [
        { value: 'openai-embeddings', label: t('modals.providerConfig.embeddingApiFormats.openaiEmbeddings') },
        { value: 'disabled', label: t('modals.providerConfig.embeddingApiFormats.disabled') },
    ];

    function handleApiFormatChange(value: string) {
        formApiFormat = value as ProviderApiFormat;
        errors = { ...errors, apiFormat: '', chatModel: '' };
    }

    /** 表单验证 */
    function validate(requireProviderId = true): boolean {
        const newErrors: Record<string, string> = {};
        if (requireProviderId) {
            const id = formId.trim();
            if (!id) {
                newErrors.id = t('modals.providerConfig.errors.providerIdRequired');
            } else if (!isValidProviderId(id)) {
                newErrors.id = t('modals.providerConfig.errors.providerIdInvalid');
            }
        }
        if (!formApiKey.trim() && !formBaseUrl.trim()) {
            newErrors.apiKey = t('modals.providerConfig.errors.apiKeyRequired');
        }
        if (formApiFormat !== 'disabled' && !formChatModel.trim()) {
            newErrors.chatModel = t('modals.providerConfig.errors.chatModelRequired');
        }
        if (formEmbeddingApiFormat === 'openai-embeddings' && !formEmbedModel.trim()) {
            newErrors.embedModel = t('modals.providerConfig.errors.embedModelRequired');
        }
        if (formReasoningSupported && formApiFormat === 'gemini-generative-language' && formThinkingLevel.trim() && formThinkingBudget.trim()) {
            newErrors.reasoning = t('modals.providerConfig.errors.thinkingExclusive');
        } else if (formReasoningSupported && formApiFormat === 'gemini-generative-language' && formThinkingBudget.trim()) {
            const budget = Number(formThinkingBudget);
            if (!Number.isSafeInteger(budget) || budget <= 0) newErrors.reasoning = t('taskModels.fields.positiveIntegerError');
        }
        for (const [value, field] of [[formMaxTokens, 'maxTokens'], [formEmbeddingDimension, 'embeddingDimension']] as const) {
            if (value.trim()) {
                const parsed = Number(value.trim());
                if (!Number.isSafeInteger(parsed) || parsed <= 0) newErrors[field] = t('taskModels.fields.positiveIntegerError');
            }
        }
        if (formApiFormat === 'disabled' && formEmbeddingApiFormat === 'disabled') {
            newErrors.apiFormat = t('modals.providerConfig.errors.capabilityRequired');
        }
        if (formBaseUrl.trim()) {
            try {
                const url = new URL(formBaseUrl.trim());
                if (!['http:', 'https:'].includes(url.protocol)) {
                    newErrors.baseUrl = t('modals.providerConfig.errors.invalidUrlProtocol');
                }
            } catch {
                newErrors.baseUrl = t('modals.providerConfig.errors.invalidUrl');
            }
        }
        errors = newErrors;
        return Object.keys(newErrors).length === 0;
    }

    function buildConfig(enabled = formEnabled): ProviderConfig {
        return {
            apiKey: formApiKey.trim(),
            baseUrl: formBaseUrl.trim() || undefined,
            apiFormat: formApiFormat,
            capabilities: {
                nativeWebSearch: formEnableWebSearch,
                temperature: formTemperatureSupported,
                topP: formTopPSupported,
                reasoning: formReasoningSupported,
                promptCaching: formPromptCaching,
                ...(formPromptCaching ? { promptCacheMode: formPromptCacheMode } : {}),
                ...(formPromptCaching && formPromptCacheMode === 'explicit' ? { promptCacheTtl: '30m' as const } : {}),
                responseContinuation: formResponseContinuation,
                structuredOutput: formStructuredOutput,
            },
            parameters: {
                ...(formTemperatureSupported ? { temperature: formTemperature } : {}),
                ...(formTopPSupported ? { topP: formTopP } : {}),
                ...(formReasoningSupported && formApiFormat === 'gemini-generative-language' && formThinkingLevel.trim() ? { thinkingLevel: formThinkingLevel.trim() } : {}),
                ...(formReasoningSupported && formApiFormat === 'gemini-generative-language' && formThinkingBudget.trim() && !formThinkingLevel.trim() ? { thinkingBudget: Number(formThinkingBudget) } : {}),
                ...(formReasoningSupported && formApiFormat !== 'gemini-generative-language' && formReasoningEffort.trim() ? { reasoning_effort: formReasoningEffort.trim() } : {}),
                ...(formMaxTokens.trim() ? { maxTokens: Number(formMaxTokens.trim()) } : {}),
                ...(formEmbeddingDimension.trim() ? { embeddingDimension: Number(formEmbeddingDimension.trim()) } : {}),
            },
            embeddingApiFormat: formEmbeddingApiFormat,
            defaultChatModel: formApiFormat === 'disabled' ? '' : formChatModel.trim(),
            defaultEmbedModel: formEmbeddingApiFormat === 'disabled' ? '' : formEmbedModel.trim(),
            enabled,
        };
    }

    function buildTestSignature(config = buildConfig(true)): string {
        return JSON.stringify({ id: formId.trim(), config });
    }

    function invalidateConnectionTest(reason: string) {
        const staleController = testAbortController;
        testAbortController = undefined;
        testedSignature = undefined;
        testResult = undefined;
        testing = false;
        staleController?.abort(reason);
    }

    $effect(() => {
        const currentSignature = buildTestSignature();
        if (!testedSignature || currentSignature === testedSignature) return;
        invalidateConnectionTest('provider configuration changed');
    });

    /** 保存 */
    async function handleSave() {
        if (saving || !validate()) return;
        invalidateConnectionTest('provider configuration saved');
        saving = true;
        saveError = undefined;
        try {
            const result = await onsave(formId.trim(), buildConfig());
            saveError = result.ok
                ? undefined
                : toSafeErrorFeedback(result, t('modals.providerConfig.errors.saveFailed')).message;
        } catch {
            saveError = t('modals.providerConfig.errors.saveFailed');
        } finally {
            saving = false;
        }
    }

    /** 取消 */
    function handleCancel() {
        if (saving) return;
        testAbortController?.abort('provider modal closed');
        oncancel();
    }

    /** 连接测试 */
    async function handleTestConnection(attemptReason: 'initial' | 'manual-retry' = 'initial') {
        if (testing) return;
        if (!validate(false)) return;
        const abortController = new AbortController();
        testAbortController = abortController;
        const tempConfig = buildConfig(true);
        const requestSignature = buildTestSignature(tempConfig);
        testedSignature = requestSignature;
        testing = true;
        testResult = undefined;
        try {
            // 使用当前表单快照构建连接测试配置。
            const result = await ontest({
                providerId: formId.trim() || '__test__',
                configOverride: tempConfig,
                attemptReason,
            }, abortController.signal);
            if (abortController.signal.aborted || buildTestSignature() !== requestSignature) return;
            if (result) testResult = result;
        } catch {
            if (abortController.signal.aborted) return;
            testResult = {
                outcome: 'failed',
                chat: tempConfig.apiFormat === 'disabled' ? 'disabled' : 'unavailable',
                embedding: tempConfig.embeddingApiFormat === 'disabled' ? 'disabled' : 'unavailable',
            };
        } finally {
            if (testAbortController === abortController) {
                testAbortController = undefined;
                testing = false;
            }
        }
    }

    onDestroy(() => {
        testAbortController?.abort('provider modal unmounted');
    });
</script>

<ModalShell {titleId} wide={true} dismissible={!saving} oncancel={handleCancel}>
        <!-- 标题 -->
        <h3 id={titleId} class="cr-provider-dialog__title">{title}</h3>
        <p class="cr-provider-dialog__desc">
            {t('modals.providerConfig.description')}
        </p>

        <!-- 表单 -->
        <div class="cr-provider-form">
            <!-- Provider ID -->
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-provider-id">
                    {t('modals.providerConfig.fields.providerId')}
                    <span class="cr-provider-field__required">*</span>
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.providerIdDesc')}
                </p>
                <TextInput
                    id="pm-provider-id"
                    value={formId}
                    placeholder="my-openai"
                    disabled={saving || mode === 'edit'}
                    onchange={(v) => { formId = v; errors = { ...errors, id: '' }; }}
                />
                {#if errors.id}
                    <p class="cr-provider-field__error">{errors.id}</p>
                {/if}
            </div>

            <!-- API Key -->
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-api-key">
                    {t('modals.providerConfig.fields.apiKey')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.apiKeyDesc')}
                </p>
                <PasswordInput
                    id="pm-api-key"
                    value={formApiKey}
                    placeholder="sk-..."
                    disabled={saving}
                    showLabel={t('common.password.show')}
                    hideLabel={t('common.password.hide')}
                    onchange={(v) => { formApiKey = v; errors = { ...errors, apiKey: '' }; }}
                />
                {#if errors.apiKey}
                    <p class="cr-provider-field__error">{errors.apiKey}</p>
                {/if}
            </div>

            <!-- Base URL -->
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-base-url">
                    {t('modals.providerConfig.fields.endpoint')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.endpointDesc')}
                </p>
                <TextInput
                    id="pm-base-url"
                    value={formBaseUrl}
                    placeholder={endpointPlaceholder}
                    disabled={saving}
                    onchange={(v) => { formBaseUrl = v; errors = { ...errors, baseUrl: '' }; }}
                />
                {#if errors.baseUrl}
                    <p class="cr-provider-field__error">{errors.baseUrl}</p>
                {/if}
            </div>

            <!-- 聊天 API 协议 -->
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-api-format">
                    {t('modals.providerConfig.fields.apiFormat')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.apiFormatDesc')}
                </p>
                <Select
                    id="pm-api-format"
                    value={formApiFormat}
                    options={apiFormatOptions}
                    disabled={saving}
                    onchange={handleApiFormatChange}
                />
                {#if errors.apiFormat}
                    <p class="cr-provider-field__error">{errors.apiFormat}</p>
                {/if}
            </div>

            {#if formApiFormat !== 'disabled'}
            <div class="cr-provider-field cr-provider-field--row">
                <div>
                    <span class="cr-provider-field__label" id="pm-web-search-label">
                        {t('modals.providerConfig.fields.webSearch')}
                    </span>
                    <p class="cr-provider-field__desc">
                        {t('modals.providerConfig.fields.webSearchDesc')}
                    </p>
                </div>
                <Toggle
                    checked={formEnableWebSearch}
                    disabled={saving}
                    ariaLabel={t('modals.providerConfig.fields.webSearch')}
                    onchange={(v) => { formEnableWebSearch = v; }}
                />
            </div>

            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label">{t('taskModels.fields.temperature')}</span>
                <Toggle checked={formTemperatureSupported} disabled={saving} ariaLabel={t('taskModels.fields.temperature')} onchange={(v) => { formTemperatureSupported = v; }} />
                {#if formTemperatureSupported}<TextInput value={String(formTemperature)} onchange={(v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 2) formTemperature = n; }} widthClass="cr-input-sm" />{/if}
            </div>
            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label">{t('taskModels.fields.topP')}</span>
                <Toggle checked={formTopPSupported} disabled={saving} ariaLabel={t('taskModels.fields.topP')} onchange={(v) => { formTopPSupported = v; }} />
                {#if formTopPSupported}<TextInput value={String(formTopP)} onchange={(v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1) formTopP = n; }} widthClass="cr-input-sm" />{/if}
            </div>
            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label">{t('taskModels.fields.reasoningEffort')}</span>
                <Toggle checked={formReasoningSupported} disabled={saving} ariaLabel={t('taskModels.fields.reasoningEffort')} onchange={(v) => { formReasoningSupported = v; }} />
                {#if formReasoningSupported && formApiFormat === 'gemini-generative-language'}
                    <TextInput value={formThinkingLevel} placeholder="thinking level" onchange={(v) => { formThinkingLevel = v; }} widthClass="cr-input-sm" />
                    <TextInput value={formThinkingBudget} placeholder="thinking budget" onchange={(v) => { formThinkingBudget = v; }} widthClass="cr-input-sm" />
                {:else if formReasoningSupported}
                    <TextInput value={formReasoningEffort} placeholder="effort" onchange={(v) => { formReasoningEffort = v; }} widthClass="cr-input-sm" />
                {/if}
                {#if errors.reasoning}<p class="cr-provider-field__error">{errors.reasoning}</p>{/if}
            </div>
            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label">{t('taskModels.fields.promptCaching')}</span>
                <Toggle checked={formPromptCaching} disabled={saving} ariaLabel={t('taskModels.fields.promptCaching')} onchange={(v) => { formPromptCaching = v; }} />
                {#if formPromptCaching && formApiFormat === 'openai-responses'}
                    <Select value={formPromptCacheMode} options={[{ value: 'implicit', label: t('taskModels.fields.promptCacheImplicit') }, { value: 'explicit', label: t('taskModels.fields.promptCacheExplicit') }]} disabled={saving} onchange={(value) => { formPromptCacheMode = value as 'implicit' | 'explicit'; }} />
                {/if}
            </div>
            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label">{t('taskModels.fields.responseContinuation')}</span>
                <Toggle checked={formResponseContinuation} disabled={saving} ariaLabel={t('taskModels.fields.responseContinuation')} onchange={(v) => { formResponseContinuation = v; }} />
            </div>

            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-structured-output">
                    {t('taskModels.fields.structuredOutput')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('taskModels.fields.structuredOutputDesc')}
                </p>
                <Select
                    id="pm-structured-output"
                    value={formStructuredOutput}
                    options={[
                        { value: 'prompt', label: t('taskModels.fields.structuredOutputOptions.prompt') },
                        { value: 'json_object', label: t('taskModels.fields.structuredOutputOptions.json_object') },
                        { value: 'json_schema', label: t('taskModels.fields.structuredOutputOptions.json_schema') },
                    ]}
                    disabled={saving}
                    onchange={(value) => { formStructuredOutput = value as NonNullable<ProviderConfig['capabilities']>['structuredOutput']; }}
                />
            </div>

            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-max-tokens">
                    {t('taskModels.fields.maxTokens')}
                </label>
                <TextInput
                    id="pm-max-tokens"
                    value={formMaxTokens}
                    placeholder={t('taskModels.fields.maxTokensPlaceholder')}
                    invalid={Boolean(errors.maxTokens)}
                    onchange={(v) => { formMaxTokens = v; errors = { ...errors, maxTokens: '' }; }}
                    widthClass="cr-input-sm"
                    disabled={saving}
                />
                {#if errors.maxTokens}<p class="cr-provider-field__error">{errors.maxTokens}</p>{/if}
            </div>

            <!-- 默认聊天模型 -->
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-chat-model">
                    {t('modals.providerConfig.fields.chatModel')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.chatModelDesc')}
                </p>
                <TextInput
                    id="pm-chat-model"
                    value={formChatModel}
                    placeholder="gemini-2.5-flash"
                    disabled={saving}
                    onchange={(v) => { formChatModel = v; errors = { ...errors, chatModel: '' }; }}
                />
                {#if errors.chatModel}
                    <p class="cr-provider-field__error">{errors.chatModel}</p>
                {/if}
            </div>
            {/if}

            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-embedding-api-format">
                    {t('modals.providerConfig.fields.embeddingApiFormat')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.embeddingApiFormatDesc')}
                </p>
                <Select
                    id="pm-embedding-api-format"
                    value={formEmbeddingApiFormat}
                    options={embeddingApiFormatOptions}
                    disabled={saving}
                    onchange={(value) => { formEmbeddingApiFormat = value as EmbeddingApiFormat; errors = { ...errors, apiFormat: '', embedModel: '' }; }}
                />
            </div>

            <!-- 默认嵌入模型 -->
            {#if formEmbeddingApiFormat === 'openai-embeddings'}
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-embed-model">
                    {t('modals.providerConfig.fields.embedModel')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.embedModelDesc')}
                </p>
                <TextInput
                    id="pm-embed-model"
                    value={formEmbedModel}
                    placeholder="text-embedding-004"
                    disabled={saving}
                    onchange={(v) => { formEmbedModel = v; errors = { ...errors, embedModel: '' }; }}
                />
                {#if errors.embedModel}
                    <p class="cr-provider-field__error">{errors.embedModel}</p>
                {/if}
            </div>
            <div class="cr-provider-field">
                <label class="cr-provider-field__label" for="pm-embedding-dimension">
                    {t('taskModels.fields.embeddingDimension')}
                </label>
                <p class="cr-provider-field__desc">
                    {t('taskModels.fields.embeddingDimensionDesc')}
                </p>
                <TextInput
                    id="pm-embedding-dimension"
                    value={formEmbeddingDimension}
                    placeholder={t('taskModels.fields.optional')}
                    invalid={Boolean(errors.embeddingDimension)}
                    onchange={(v) => { formEmbeddingDimension = v; errors = { ...errors, embeddingDimension: '' }; }}
                    widthClass="cr-input-sm"
                    disabled={saving}
                />
                {#if errors.embeddingDimension}<p class="cr-provider-field__error">{errors.embeddingDimension}</p>{/if}
            </div>
            {/if}

            <!-- 启用开关（Toggle 是 div[role=switch]，用 aria-labelledby 关联） -->
            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label" id="pm-enabled-label">
                    {t('settings.provider.enabled')}
                </span>
                <Toggle
                    checked={formEnabled}
                    disabled={saving}
                    ariaLabel={t('settings.provider.enabled')}
                    onchange={(v) => { formEnabled = v; }}
                />
            </div>
        </div>

        <!-- 连接测试结果 -->
        {#if testResult}
            <ProviderProbeStatus
                result={testResult}
                {i18n}
                onretry={() => void handleTestConnection('manual-retry')}
                retrying={testing}
            />
        {/if}

        {#if saveError}
            <div class="cr-provider-test-result cr-provider-test-result--fail" role="alert">
                {saveError}
            </div>
        {/if}

        <!-- 操作按钮 -->
        <div class="cr-provider-actions">
            <Button
                variant="ghost"
                loading={testing}
                disabled={saving}
                onclick={() => void handleTestConnection()}
            >
                {t('settings.provider.testConnection')}
            </Button>
            <div class="cr-provider-actions__right">
                <Button variant="secondary" disabled={saving} onclick={handleCancel}>
                    {t('common.cancel')}
                </Button>
                <Button variant="primary" loading={saving} onclick={handleSave}>
                    {t('common.save')}
                </Button>
            </div>
        </div>
 </ModalShell>


<style>
    .cr-provider-dialog__title {
        margin: 0 0 var(--cr-space-1) 0;
        font-size: var(--font-ui-medium);
        font-weight: 600;
        color: var(--cr-text-normal);
    }

    .cr-provider-dialog__desc {
        margin: 0 0 var(--cr-space-4) 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
        line-height: 1.4;
    }

    /* 表单 */
    .cr-provider-form {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-4);
    }

    /* 表单字段 */
    .cr-provider-field {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
    }

    .cr-provider-field--row {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
    }

    .cr-provider-field__label {
        font-size: var(--font-ui-small);
        font-weight: 500;
        color: var(--cr-text-normal);
    }

    .cr-provider-field__required {
        color: var(--cr-text-error);
        margin-left: 2px;
    }

    .cr-provider-field__desc {
        margin: 0;
        font-size: var(--cr-font-xs);
        color: var(--cr-text-muted);
        line-height: 1.3;
    }

    .cr-provider-field__error {
        margin: 0;
        font-size: var(--cr-font-xs);
        color: var(--cr-text-error);
    }

    /* 操作按钮行 */
    .cr-provider-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--cr-space-5);
        gap: var(--cr-space-3);
    }

    .cr-provider-actions__right {
        display: flex;
        gap: var(--cr-space-3);
    }

    .cr-provider-actions__right :global(button) {
        min-width: 72px;
    }
</style>
