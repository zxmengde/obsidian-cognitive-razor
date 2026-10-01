<!--
  ProviderCard.svelte — Provider 摘要卡片

  显示单个 Provider 的配置信息：名称、API Key（密码）、Base URL、
  默认模型、启用开关、连接测试、编辑/删除按钮。

-->
<script lang="ts">
    import type { ProviderConfig, TaskType } from '../../../types';
    import type { ProviderProbeAttemptReason } from '../../../core/model-gateway';
    import ProviderProbeStatus from './ProviderProbeStatus.svelte';
    import type { ProviderProbeReadModel } from '../../provider-probe-result';
    import Toggle from '../../components/Toggle.svelte';
    import Button from '../../components/Button.svelte';
    import Select from '../../components/Select.svelte';

    let {
        id,
        config,
        isDefault = false,
        i18n,
        onToggleEnabled,
        onTestConnection,
        onTestTaskConnection,
        onEdit,
        onDelete,
    }: {
        /** Provider ID */
        id: string;
        /** Provider 配置 */
        config: ProviderConfig;
        /** 是否为默认 Provider */
        isDefault: boolean;
        /** i18n 实例 */
        i18n: { t: (key: string) => string };
        /** 切换启用状态 */
        onToggleEnabled: (id: string, enabled: boolean) => void;
        /** 测试连接 */
        onTestConnection: (
            id: string,
            attemptReason: ProviderProbeAttemptReason,
            signal?: AbortSignal,
        ) => Promise<ProviderProbeReadModel | undefined>;
        /** 按任务快照测试（包括该任务声明的参数和能力）。 */
        onTestTaskConnection: (
            id: string,
            taskType: Exclude<TaskType, 'index'>,
            attemptReason: ProviderProbeAttemptReason,
            signal?: AbortSignal,
        ) => Promise<ProviderProbeReadModel | undefined>;
        /** 编辑 */
        onEdit: (id: string) => void;
        /** 删除 */
        onDelete: (id: string) => void;
    } = $props();

    /** 连接测试中 */
    let testing = $state(false);
    let testResult = $state<ProviderProbeReadModel | undefined>();
    let testAbortController: AbortController | undefined;
    let testedSignature = $state<string | undefined>();
    let taskProbeType = $state<Exclude<TaskType, 'index'>>('write');
    let lastTaskProbeType = $state<Exclude<TaskType, 'index'> | undefined>();

    /** 遮蔽 API Key 显示 */
    let maskedKey = $derived(
        config.apiKey
            ? config.apiKey.slice(0, 4) + '••••' + config.apiKey.slice(-4)
            : '—'
    );

    let apiFormatLabel = $derived(
        i18n.t(`modals.providerConfig.apiFormats.${config.apiFormat === 'disabled'
            ? 'disabled'
            : config.apiFormat === 'openai-responses'
                ? 'openaiResponses'
                : config.apiFormat === 'gemini-generative-language'
                        ? 'geminiGenerativeLanguage'
                        : 'openaiChatCompletions'}`)
    );

    async function handleTest(
        attemptReason: ProviderProbeAttemptReason = 'initial',
        taskType?: Exclude<TaskType, 'index'>,
    ) {
        if (testing) return;
        testing = true;
        lastTaskProbeType = taskType;
        const abortController = new AbortController();
        const requestSignature = JSON.stringify({ id, config });
        testAbortController = abortController;
        testedSignature = requestSignature;
        try {
            const result = taskType
                ? await onTestTaskConnection(id, taskType, attemptReason, abortController.signal)
                : await onTestConnection(id, attemptReason, abortController.signal);
            if (result && !abortController.signal.aborted && JSON.stringify({ id, config }) === requestSignature) {
                testResult = result;
            }
        } finally {
            if (testAbortController === abortController) {
                testAbortController = undefined;
                testing = false;
            }
        }
    }

    $effect(() => {
        const currentSignature = JSON.stringify({ id, config });
        if (testedSignature && testedSignature !== currentSignature) {
            testResult = undefined;
            testedSignature = undefined;
        }
    });

    $effect(() => () => testAbortController?.abort('provider card unmounted'));
</script>

<div class="cr-provider-card" class:cr-provider-card--disabled={!config.enabled}>
    <!-- 头部：名称 + 状态标签 -->
    <div class="cr-provider-card__header">
        <span class="cr-provider-card__name">{id}</span>
        {#if isDefault}
            <span class="cr-provider-card__badge">{i18n.t('settings.provider.setDefault')}</span>
        {/if}
    </div>

    <!-- 信息行 -->
    <div class="cr-provider-card__info">
        <div class="cr-provider-card__row">
            <span class="cr-provider-card__label">API Key</span>
            <span class="cr-provider-card__value">{maskedKey}</span>
        </div>
        {#if config.baseUrl}
            <div class="cr-provider-card__row">
                <span class="cr-provider-card__label">Base URL</span>
                <span class="cr-provider-card__value cr-provider-card__value--mono">
                    {config.baseUrl}
                </span>
            </div>
        {/if}
        <div class="cr-provider-card__row">
            <span class="cr-provider-card__label">API</span>
            <span class="cr-provider-card__value">{apiFormatLabel}</span>
        </div>
        <div class="cr-provider-card__row">
            <span class="cr-provider-card__label">{i18n.t('modals.providerConfig.fields.webSearch')}</span>
            <span class="cr-provider-card__value">
                {config.capabilities?.nativeWebSearch
                    ? i18n.t('modals.providerConfig.webSearchStates.enabled')
                    : i18n.t('modals.providerConfig.webSearchStates.disabled')}
            </span>
        </div>
        {#if config.apiFormat !== 'disabled'}
        <div class="cr-provider-card__row">
            <span class="cr-provider-card__label">{i18n.t('settings.provider.model')}</span>
            <span class="cr-provider-card__value">
                {config.defaultChatModel || '—'}
            </span>
        </div>
        {/if}
        <div class="cr-provider-card__row">
            <span class="cr-provider-card__label">{i18n.t('modals.providerConfig.fields.embeddingApiFormat')}</span>
            <span class="cr-provider-card__value">
                {config.embeddingApiFormat === 'openai-embeddings'
                    ? i18n.t('modals.providerConfig.embeddingApiFormats.openaiEmbeddings')
                    : i18n.t('modals.providerConfig.embeddingApiFormats.disabled')}
            </span>
        </div>
        {#if config.embeddingApiFormat === 'openai-embeddings'}
            <div class="cr-provider-card__row">
                <span class="cr-provider-card__label">{i18n.t('modals.providerConfig.fields.embedModel')}</span>
                <span class="cr-provider-card__value">{config.defaultEmbedModel || '—'}</span>
            </div>
        {/if}
    </div>

    {#if testResult}
        <ProviderProbeStatus
            result={testResult}
            {i18n}
            onretry={() => void handleTest('manual-retry', lastTaskProbeType)}
            retrying={testing}
        />
    {/if}

    <!-- 底部操作栏 -->
    <div class="cr-provider-card__actions">
        <Toggle
            checked={config.enabled}
            onchange={(v) => onToggleEnabled(id, v)}
            ariaLabel={config.enabled
                ? i18n.t('settings.provider.enabled')
                : i18n.t('settings.provider.disabled')}
        />
        <div class="cr-provider-card__buttons">
            <Button
                variant="ghost"
                size="sm"
                disabled={testing || !config.enabled}
                loading={testing}
                onclick={() => void handleTest()}
            >
                {i18n.t('settings.provider.testConnection')}
            </Button>
            <Select
                value={taskProbeType}
                options={[
                    { value: 'define', label: i18n.t('taskModels.tasks.define.name') },
                    { value: 'tag', label: i18n.t('taskModels.tasks.tag.name') },
                    { value: 'write', label: i18n.t('taskModels.tasks.write.name') },
                    { value: 'verify', label: i18n.t('taskModels.tasks.verify.name') },
                ]}
                ariaLabel={i18n.t('settings.provider.testTaskConfig')}
                onchange={(value) => { taskProbeType = value as Exclude<TaskType, 'index'>; }}
            />
            <Button
                variant="ghost"
                size="sm"
                disabled={testing || !config.enabled}
                loading={testing}
                onclick={() => void handleTest('initial', taskProbeType)}
            >
                {i18n.t('settings.provider.testTaskConfig')}
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onclick={() => onEdit(id)}
            >
                {i18n.t('common.edit')}
            </Button>
            <Button
                variant="danger"
                size="sm"
                onclick={() => onDelete(id)}
            >
                {i18n.t('common.delete')}
            </Button>
        </div>
    </div>
</div>

<style>
    .cr-provider-card {
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        padding: var(--cr-space-3);
        background: var(--cr-bg-base);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-provider-card--disabled {
        opacity: 0.6;
    }

    .cr-provider-card__header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
    }

    .cr-provider-card__name {
        font-weight: 600;
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium);
    }

    .cr-provider-card__badge {
        font-size: var(--cr-font-xs);
        color: var(--cr-interactive-accent);
        border: 1px solid var(--cr-interactive-accent);
        border-radius: var(--cr-radius-sm);
        padding: 0 var(--cr-space-1);
        line-height: 1.6;
    }

    .cr-provider-card__info {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1);
    }

    .cr-provider-card__row {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
        font-size: var(--cr-font-sm);
    }

    .cr-provider-card__label {
        color: var(--cr-text-muted);
        min-width: 64px;
        flex-shrink: 0;
    }

    .cr-provider-card__value {
        color: var(--cr-text-normal);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .cr-provider-card__value--mono {
        font-family: var(--font-monospace);
        font-size: var(--cr-font-xs);
    }

    .cr-provider-card__actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: var(--cr-space-2);
        border-top: 1px solid var(--cr-border);
    }

    .cr-provider-card__buttons {
        display: flex;
        gap: var(--cr-space-1);
    }
</style>
