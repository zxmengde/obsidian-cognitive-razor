<!-- AI 服务与任务模型设置。 -->
<script lang="ts">
    import { getSettingsContext } from '../../bridge/context';
    import type { PluginSettings, ProviderConfig, Result, TaskType } from '../../../types';
    import type { ProviderProbeAttemptReason, ProviderProbeRequest } from '../../../core/model-gateway';
    import {
        toProviderProbeReadModel,
        type ProviderProbeReadModel,
    } from '../../provider-probe-result';
    import SettingItem from './SettingItem.svelte';
    import SettingsSection from './SettingsSection.svelte';
    import ProviderCard from './ProviderCard.svelte';
    import ProviderModal from '../modals/ProviderModal.svelte';
    import Select from '../../components/Select.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import Button from '../../components/Button.svelte';
    import { resolveTaskModelSnapshot } from '../../../core/task-model-resolver';

    import { taskSettingsSummary } from '../../settings-summaries';

    let { onConfigureTask, overridesOpen, onToggleOverrides }: {
        onConfigureTask: (task: TaskType) => void;
        overridesOpen: boolean;
        onToggleOverrides: () => void;
    } = $props();
    const displayTasks: TaskType[] = ['define', 'tag', 'write', 'verify', 'merge', 'cards', 'index'];

    const ctx = getSettingsContext();
    const i18n = ctx.i18n;
    const settingsApplication = ctx.settingsApplication;

    /** 当前设置（响应式） */
    let settings = $state<PluginSettings>(settingsApplication.getSettings());

    /** 订阅设置变化 */
    const unsubscribe = settingsApplication.subscribeSettings((s: PluginSettings) => {
        settings = s;
    });

    $effect(() => {
        return () => unsubscribe();
    });

    // ---- Provider 管理 ----

    /** Modal 状态 */
    let showModal = $state(false);
    let modalMode = $state<'add' | 'edit'>('add');
    let modalProviderId = $state('');
    let modalConfig = $state<ProviderConfig | undefined>(undefined);
    let deleteProviderId = $state<string | undefined>(undefined);

    /** Provider ID 列表 */
    let providerIds = $derived(Object.keys(settings.providers));
    let enabledChatProviderIds = $derived(
        providerIds.filter(pid => settings.providers[pid]?.enabled && settings.providers[pid]?.apiFormat !== 'disabled'),
    );

    const taskSummaries = $derived(displayTasks.map(taskType => ({ taskType, summary: taskSettingsSummary(settings, taskType) })));
    const inheritedTasks = $derived(taskSummaries.filter(({ taskType, summary }) => taskType !== 'index' && summary.source === 'inherited' && !summary.issue));
    const visibleTasks = $derived(overridesOpen ? taskSummaries : taskSummaries.filter(task => !inheritedTasks.includes(task)));

    /** 默认 Provider 下拉选项 */
    let defaultProviderOptions = $derived.by(() => {
        const options = [{ value: '', label: i18n.t('settings.redesign.chooseDefault') }, ...enabledChatProviderIds.map(pid => ({ value: pid, label: pid }))];
        const current = settings.defaultProviderId;
        if (current && !options.some(option => option.value === current)) {
            options.push({
                value: current,
                label: `${current} (${i18n.t('taskModels.fields.providerUnavailable')})`,
            });
        }
        return options;
    });

    /** 切换 Provider 启用状态 */
    async function handleToggleEnabled(id: string, enabled: boolean) {
        await ctx.settingsApplication.updateProvider(id, { enabled });
    }

    /** 测试 Provider 连接 */
    async function probeProvider(
        request: ProviderProbeRequest,
        config: ProviderConfig,
        signal?: AbortSignal,
    ): Promise<ProviderProbeReadModel | undefined> {
        const result = await ctx.settingsApplication.testProvider(request, signal);
        if (signal?.aborted) return undefined;
        return toProviderProbeReadModel(result, config);
    }

    async function handleTestConnection(
        id: string,
        attemptReason: ProviderProbeAttemptReason,
        signal?: AbortSignal,
    ): Promise<ProviderProbeReadModel | undefined> {
        const current = settings.providers[id];
        if (!current) {
            return undefined;
        }
        // Keep the explanation tied to the exact configuration that was tested.
        // Settings may change while the network request is in flight.
        const config = { ...current };
        return probeProvider({
            providerId: id,
            configOverride: config,
            attemptReason,
        }, config, signal);
    }

    async function handleTestTaskConnection(
        id: string,
        taskType: Exclude<TaskType, 'index'>,
        attemptReason: ProviderProbeAttemptReason,
        signal?: AbortSignal,
    ): Promise<ProviderProbeReadModel | undefined> {
        const current = settings.providers[id];
        if (!current) return undefined;
        // Resolve through the same parser used by real task execution. The
        // saved Provider is forced as the target while retaining task overrides.
        const snapshot = resolveTaskModelSnapshot(
            { ...settings, providers: { ...settings.providers, [id]: current } },
            taskType,
            id,
        );
        return probeProvider({
            providerId: id,
            configOverride: { ...current },
            attemptReason,
            taskConfig: snapshot,
        }, { ...current }, signal);
    }

    async function handleModalTest(
        request: ProviderProbeRequest,
        signal?: AbortSignal,
    ): Promise<ProviderProbeReadModel | undefined> {
        const config = request.configOverride;
        if (!config) return undefined;
        return probeProvider(request, config, signal);
    }

    /** 编辑 Provider（打开 ProviderModal） */
    function handleEditProvider(id: string) {
        modalMode = 'edit';
        modalProviderId = id;
        modalConfig = settings.providers[id];
        showModal = true;
    }

    function handleDeleteProvider(id: string) {
        deleteProviderId = id;
    }

    async function confirmDeleteProvider() {
        const id = deleteProviderId;
        if (!id) return;
        deleteProviderId = undefined;
        await ctx.settingsApplication.removeProvider(id);
    }

    /** 添加 Provider（打开 ProviderModal） */
    function handleAddProvider() {
        modalMode = 'add';
        modalProviderId = '';
        modalConfig = undefined;
        showModal = true;
    }

    /** Modal 保存回调 */
    async function handleModalSave(id: string, config: ProviderConfig): Promise<Result<void>> {
        let result: Result<void>;
        if (modalMode === 'add') {
            result = await ctx.settingsApplication.addProvider(id, config);
        } else {
            result = await ctx.settingsApplication.updateProvider(id, config);
        }
        if (result.ok) {
            showModal = false;
        }
        return result;
    }

    /** Modal 取消回调 */
    function handleModalCancel() {
        showModal = false;
    }

    /** 切换默认 Provider */
    async function handleDefaultProviderChange(value: string) {
        await ctx.settingsApplication.updateSettings({ defaultProviderId: value });
    }

</script>

<div class="cr-providers-tab">
    <header class="cr-settings-page-heading"><h2>{i18n.t('settings.tabs.providers')}</h2><p>{i18n.t('settings.redesign.aiDesc')}</p></header>
    <SettingsSection title="">
        <SettingItem name={i18n.t('settings.redesign.defaultUse')}>
            <Select value={settings.defaultProviderId} options={defaultProviderOptions} ariaLabel={i18n.t('settings.provider.defaultProvider')} onchange={handleDefaultProviderChange} />
        </SettingItem>
        {#if enabledChatProviderIds.length > 0 && !settings.defaultProviderId}
            <p class="cr-task-summary__issue" role="status">{i18n.t('settings.redesign.defaultMissing')}</p>
        {/if}
        <div class="cr-default-model-row">
        <p class="cr-default-model">{settings.providers[settings.defaultProviderId]?.defaultChatModel || i18n.t('settings.redesign.unconfigured')} <span>· {i18n.t('settings.redesign.providerDefaultModel')}</span></p>
        {#if settings.providers[settings.defaultProviderId]}
            <Button variant="ghost" size="sm" onclick={() => handleEditProvider(settings.defaultProviderId)}>{i18n.t('settings.redesign.editConnection')}</Button>
        {/if}
        </div>
        <p class="cr-settings-hint">{i18n.t('settings.redesign.defaultIndexWarning')}</p>
    </SettingsSection>
    <SettingsSection title={i18n.t('settings.redesign.taskUsage')} description={i18n.t('settings.redesign.effectiveConfig')}>
        <button type="button" class="cr-task-overrides-toggle" onclick={onToggleOverrides} aria-label={i18n.t('settings.redesign.taskOverrides')} aria-expanded={overridesOpen} aria-controls="cr-task-usage">
            {i18n.t('settings.redesign.taskOverrides')} · {i18n.t(overridesOpen ? 'settings.redesign.collapse' : 'settings.redesign.expand')}
        </button>
        <div class="cr-task-list" id="cr-task-usage">
            {#if !overridesOpen && inheritedTasks.length > 0}
                <div class="cr-inherited-summary">
                    <span class="cr-task-summary__title">{i18n.t('settings.redesign.inherited')}</span>
                    <span class="cr-task-summary__model">{inheritedTasks.map(({ taskType }) => i18n.t(`settings.redesign.tasks.${taskType}`)).join('、')}</span>
                </div>
            {/if}
            {#each visibleTasks as { taskType, summary } (taskType)}
                <section class="cr-task-row">
                    {#snippet summaryCopy()}
                        <span class="cr-task-summary__copy">
                            <span class="cr-task-summary__title">{i18n.t(`settings.redesign.tasks.${taskType}`)} <span class="cr-task-source">{i18n.t(`settings.redesign.${summary.source}`)}</span></span>
                            {#if taskType === 'index' || summary.source !== 'inherited' || summary.issue}
                                <span class="cr-task-summary__model">{summary.resolved.providerId || '—'} · {summary.resolved.model || '—'}</span>
                            {/if}
                            {#if summary.issue}<span class="cr-task-summary__issue">{i18n.t(`settings.redesign.${summary.issue}`)}</span>{/if}
                            {#if taskType === 'cards' && overridesOpen}<span class="cr-task-summary__hint">{i18n.t('settings.redesign.cardsIndependent')}</span>{/if}
                        </span>
                    {/snippet}
                        <button class="cr-task-summary" id={`cr-task-trigger-${taskType}`} onclick={() => onConfigureTask(taskType)}>
                            {@render summaryCopy()}
                            <span class="cr-task-summary__action">{i18n.t('settings.redesign.adjust')} <span aria-hidden="true">›</span></span>
                        </button>
                </section>
            {/each}
        </div>
    </SettingsSection>
    <SettingsSection title={i18n.t('settings.redesign.manageConnections')}>
        {#snippet actions()}<Button variant="ghost" size="sm" onclick={handleAddProvider}>{i18n.t('settings.redesign.addConnection')}</Button>{/snippet}
        {#if providerIds.length === 0}
            <div class="cr-empty-hint">{i18n.t('settings.provider.noProvider')}</div>
        {:else}
            <div class="cr-provider-list">
                {#each providerIds as pid (pid)}
                    <ProviderCard id={pid} config={settings.providers[pid]} taskSignature={JSON.stringify(settings.taskModels)} isDefault={pid === settings.defaultProviderId} {i18n} onToggleEnabled={handleToggleEnabled} onTestConnection={handleTestConnection} onTestTaskConnection={handleTestTaskConnection} onEdit={handleEditProvider} onDelete={handleDeleteProvider} />
                {/each}
            </div>
        {/if}
        <p class="cr-settings-hint">{i18n.t('settings.redesign.testScopeNotice')}</p>
    </SettingsSection>

    <!-- ProviderModal -->
    {#if showModal}
        <ProviderModal
            mode={modalMode}
            providerId={modalProviderId}
            currentConfig={modalConfig}
            ontest={handleModalTest}
            {i18n}
            onsave={handleModalSave}
            oncancel={handleModalCancel}
        />
    {/if}

    {#if deleteProviderId}
        <ConfirmModal
            title={i18n.t('confirmDialogs.deleteProvider.title')}
            message={i18n.format('confirmDialogs.deleteProvider.message', { id: deleteProviderId })}
            confirmLabel={i18n.t('common.delete')}
            cancelLabel={i18n.t('common.cancel')}
            danger={true}
            onconfirm={() => void confirmDeleteProvider()}
            oncancel={() => deleteProviderId = undefined}
        />
    {/if}
</div>

<style>
    .cr-providers-tab { display: flex; flex-direction: column; }
    .cr-default-model-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--cr-space-2); margin-top: var(--cr-space-2); }
    .cr-default-model { margin: 0; overflow-wrap: anywhere; }
    .cr-default-model span, .cr-empty-hint { color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
    .cr-task-overrides-toggle { height: auto; padding: var(--cr-space-2) 0; border: 0; background: transparent; box-shadow: none; color: var(--cr-interactive-accent); font: inherit; text-align: left; cursor: pointer; }
    .cr-task-overrides-toggle:focus-visible { outline: 2px solid var(--cr-border-focus); }
    .cr-inherited-summary { display: flex; flex-direction: column; gap: var(--cr-space-1); padding: var(--cr-space-3) 0; overflow-wrap: anywhere; }
    .cr-task-row { border-top: 1px solid var(--cr-border); }
    .cr-task-summary { display: flex; align-items: center; justify-content: space-between; gap: var(--cr-space-3); width: 100%; height: auto; border: 0; border-radius: 0; background: transparent; box-shadow: none; text-align: left; padding: var(--cr-space-3) 0; line-height: var(--cr-line-height-body); color: var(--cr-text-normal); }
    button.cr-task-summary:hover { background: var(--cr-bg-hover); }
    .cr-task-summary:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
    .cr-task-summary__copy { display: flex; flex-direction: column; gap: var(--cr-space-1); min-width: 0; overflow-wrap: anywhere; }
    .cr-task-summary__title { font-weight: 600; font-size: var(--cr-font-base); }
    .cr-task-source { margin-left: var(--cr-space-2); font-weight: 400; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-task-summary__model { color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
    .cr-task-summary__hint, .cr-task-summary__action { font-size: var(--cr-font-xs); color: var(--cr-text-muted); }
    .cr-task-summary__action { flex-shrink: 0; }
    .cr-task-summary__issue { color: var(--cr-status-warning); font-size: var(--cr-font-xs); }
</style>
