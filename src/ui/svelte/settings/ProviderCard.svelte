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
        taskSignature = '',
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
        /** Used only to invalidate stale forced-provider task test results. */
        taskSignature?: string;
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

    let testMode = $state('connection');
    let showTest = $state(false);
    function signature(taskType?: Exclude<TaskType, 'index'>): string {
        return JSON.stringify({ id, config, tasks: taskType ? taskSignature : undefined });
    }

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
        testResult = undefined;
        lastTaskProbeType = taskType;
        const abortController = new AbortController();
        const requestSignature = signature(taskType);
        testAbortController = abortController;
        testedSignature = requestSignature;
        try {
            const result = taskType
                ? await onTestTaskConnection(id, taskType, attemptReason, abortController.signal)
                : await onTestConnection(id, attemptReason, abortController.signal);
            if (result && !abortController.signal.aborted && signature(taskType) === requestSignature) {
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
        const currentSignature = signature(lastTaskProbeType);
        if (testedSignature && testedSignature !== currentSignature) {
            testResult = undefined;
            testedSignature = undefined;
        }
    });

    $effect(() => () => testAbortController?.abort('provider card unmounted'));
</script>

<div class="cr-provider-card" class:cr-provider-card--disabled={!config.enabled}>
    <div class="cr-provider-card__header">
        <div class="cr-provider-card__summary">
            <div class="cr-provider-card__name">{id} {#if isDefault}<span class="cr-provider-card__badge">{i18n.t('settings.redesign.currentDefault')}</span>{/if}</div>
            <p class="cr-provider-card__scope">
                {#if !config.enabled}{i18n.t('settings.provider.disabled')} · {/if}
                {config.apiFormat !== 'disabled' ? i18n.t('settings.redesign.chat') : ''}{config.apiFormat !== 'disabled' && config.embeddingApiFormat !== 'disabled' ? '、' : ''}{config.embeddingApiFormat !== 'disabled' ? i18n.t('settings.redesign.embedding') : ''}
                · {#if testing}{i18n.t('settings.redesign.testing')}{:else if testResult}{i18n.t(lastTaskProbeType ? 'settings.redesign.taskTest' : 'settings.redesign.connectionTest')} {lastTaskProbeType ? i18n.t(`settings.redesign.tasks.${lastTaskProbeType}`) : ''} · {i18n.t(`settings.redesign.testOutcomes.${testResult.outcome}`)}{:else}{i18n.t('settings.redesign.untested')}{/if}
            </p>
        </div>
        <Button variant="ghost" size="sm" ariaLabel={`${i18n.t('common.edit')} ${id}`} onclick={() => onEdit(id)}>{i18n.t('common.edit')}</Button>
    </div>
    <div class="cr-provider-card__utilities">
        <button class="cr-provider-link" aria-expanded={showTest} onclick={() => showTest = !showTest}>{i18n.t('settings.redesign.test')}</button>
        <details class="cr-provider-details">
            <summary>{i18n.t('settings.redesign.connectionDetails')}</summary>
            <dl>
                <dt>API Key</dt><dd>{maskedKey}</dd>
                <dt>Base URL</dt><dd>{config.baseUrl || '—'}</dd>
                <dt>API</dt><dd>{apiFormatLabel}</dd>
                <dt>{i18n.t('settings.provider.model')}</dt><dd>{config.defaultChatModel || '—'}</dd>
                <dt>{i18n.t('modals.providerConfig.fields.embedModel')}</dt><dd>{config.defaultEmbedModel || '—'}</dd>
            </dl>
            <div class="cr-provider-card__more">
                <span>{i18n.t('settings.provider.enabled')}</span>
                <Toggle checked={config.enabled} onchange={(value) => onToggleEnabled(id, value)} ariaLabel={`${i18n.t('settings.provider.enabled')} ${id}`} />
                <Button variant="danger" size="sm" ariaLabel={`${i18n.t('common.delete')} ${id}`} onclick={() => onDelete(id)}>{i18n.t('common.delete')}</Button>
            </div>
        </details>
    </div>
    {#if showTest}
        <div class="cr-provider-test">
            <Select value={testMode} options={[{ value: 'connection', label: i18n.t('settings.provider.testConnection') }, { value: 'task', label: i18n.t('settings.redesign.testUsingProvider') }]} ariaLabel={i18n.t('settings.redesign.testMode')} onchange={(value) => testMode = value} />
            {#if testMode === 'task'}
                {#if config.apiFormat === 'disabled'}<p class="cr-settings-hint">{i18n.t('settings.redesign.chatRequiredForTaskTest')}</p>{/if}
                <Select value={taskProbeType} options={[
                    { value: 'define', label: i18n.t('taskModels.tasks.define.name') },
                    { value: 'tag', label: i18n.t('taskModels.tasks.tag.name') },
                    { value: 'write', label: i18n.t('taskModels.tasks.write.name') },
                    { value: 'verify', label: i18n.t('taskModels.tasks.verify.name') },
                ]} ariaLabel={i18n.t('settings.provider.testTaskConfig')} onchange={(value) => taskProbeType = value as Exclude<TaskType, 'index'>} />
            {/if}
            <Button variant="secondary" size="sm" disabled={!config.enabled || (testMode === 'task' && config.apiFormat === 'disabled')} loading={testing} onclick={() => void handleTest('initial', testMode === 'task' ? taskProbeType : undefined)}>{i18n.t('settings.redesign.runTest')}</Button>
            <p class="cr-settings-hint">{testMode === 'task' ? i18n.t('settings.redesign.forcedTestNotice') : i18n.t('settings.redesign.connectionTestNotice')} ({id})</p>
        </div>
    {/if}
    {#if testResult}
        <ProviderProbeStatus result={testResult} {i18n} onretry={() => void handleTest('manual-retry', lastTaskProbeType)} retrying={testing} />
    {/if}
</div>

<style>
    .cr-provider-card { padding: var(--cr-space-3) 0; border-bottom: 1px solid var(--cr-border); }
    .cr-provider-card__header { display: flex; align-items: center; justify-content: space-between; gap: var(--cr-space-2); }
    .cr-provider-card__summary { min-width: 0; overflow-wrap: anywhere; }
    .cr-provider-card__name { color: var(--cr-text-normal); font-size: var(--font-ui-medium); }
    .cr-provider-card__scope { color: var(--cr-text-muted); font-size: var(--cr-font-sm); margin: var(--cr-space-1) 0; }
    .cr-provider-card__badge { font-size: var(--cr-font-xs); color: var(--cr-interactive-accent); border-radius: var(--cr-radius-sm); background: var(--background-modifier-hover); padding: 2px 6px; margin-left: var(--cr-space-1); }
    .cr-provider-card--disabled .cr-provider-card__name { color: var(--cr-text-muted); }
    .cr-provider-card__utilities { display: flex; align-items: flex-start; gap: var(--cr-space-3); font-size: var(--cr-font-xs); color: var(--cr-text-muted); }
    .cr-provider-link { background: none; border: 0; box-shadow: none; padding: 0; height: auto; font-size: inherit; color: var(--cr-text-muted); }
    .cr-provider-details { min-width: 0; flex: 1; }
    .cr-provider-details summary { cursor: pointer; }
    .cr-provider-details dl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--cr-space-2); }
    .cr-provider-details dd { margin: 0; overflow-wrap: anywhere; color: var(--cr-text-normal); }
    .cr-provider-card__more, .cr-provider-test { display: flex; align-items: center; flex-wrap: wrap; gap: var(--cr-space-2); }
    .cr-provider-test { padding: var(--cr-space-2) 0; }
    .cr-provider-test :global(select) { max-width: 100%; }
    .cr-provider-test p { width: 100%; }
</style>
