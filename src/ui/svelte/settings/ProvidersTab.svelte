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

    /** 默认 Provider 下拉选项 */
    let defaultProviderOptions = $derived.by(() => {
        const options = enabledChatProviderIds.map(pid => ({ value: pid, label: pid }));
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
    <!-- Provider 管理组 -->
    <SettingsSection
        title={i18n.t('settings.provider.title')}
        description={i18n.t('settings.provider.addDesc')}
    >
        {#snippet actions()}
            <Button
                variant="primary"
                size="sm"
                onclick={handleAddProvider}
            >
                {i18n.t('settings.provider.addButton')}
            </Button>
        {/snippet}

        <!-- Provider 卡片列表 -->
        {#if providerIds.length === 0}
            <div class="cr-empty-hint">
                {i18n.t('settings.provider.noProvider')}
            </div>
        {:else}
            <div class="cr-provider-list">
                {#each providerIds as pid (pid)}
                    <ProviderCard
                        id={pid}
                        config={settings.providers[pid]}
                        isDefault={pid === settings.defaultProviderId}
                        {i18n}
                        onToggleEnabled={handleToggleEnabled}
                        onTestConnection={handleTestConnection}
                        onTestTaskConnection={handleTestTaskConnection}
                        onEdit={handleEditProvider}
                        onDelete={handleDeleteProvider}
                    />
                {/each}
            </div>
        {/if}

        <!-- 默认 Provider -->
        {#if defaultProviderOptions.length > 0}
            <SettingItem
                name={i18n.t('settings.provider.defaultProvider')}
                description={i18n.t('settings.provider.defaultProviderDesc')}
            >
                <Select
                    value={settings.defaultProviderId}
                    options={defaultProviderOptions}
                    ariaLabel={i18n.t('settings.provider.defaultProvider')}
                    onchange={handleDefaultProviderChange}
                />
            </SettingItem>
        {/if}

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
    .cr-providers-tab {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-5);
    }

    .cr-provider-list {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
        margin-bottom: var(--cr-space-3);
    }

    .cr-empty-hint {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
        text-align: center;
        padding: var(--cr-space-4) 0;
        border: 1px dashed var(--cr-border);
        border-radius: var(--cr-radius-md);
        margin-bottom: var(--cr-space-3);
    }
</style>
