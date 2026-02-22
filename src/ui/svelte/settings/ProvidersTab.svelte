<!--
  ProvidersTab.svelte — AI 服务设置 Tab

  两个设置组：
  1. Provider 管理：Provider 卡片列表 + 添加按钮、默认 Provider 下拉、请求超时滑块
  2. 任务模型：各任务类型的模型配置卡片列表

  注意：嵌入维度设置仅在高级 Tab 保留一处，此处不重复。

  @see 需求 10.4, 10.7, 10.9
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import { showSuccess, showError, showWarning } from '../../feedback';
    import type { PluginSettings, TaskType, TaskModelConfig, ProviderConfig } from '../../../types';
    import type { SettingsStore } from '../../../data/settings-store';
    import type { ProviderManager } from '../../../core/provider-manager';
    import { TASK_TYPES } from '../../../data/settings-store';
    import SettingItem from './SettingItem.svelte';
    import ProviderCard from './ProviderCard.svelte';
    import TaskModelCard from './TaskModelCard.svelte';
    import ProviderModal from '../modals/ProviderModal.svelte';
    import Select from '../../components/Select.svelte';
    import Slider from '../../components/Slider.svelte';

    const ctx = getCRContext();
    const i18n = ctx.i18n;
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);
    const providerManager = ctx.container.resolve<ProviderManager>(SERVICE_TOKENS.providerManager);

    /** 当前设置（响应式） */
    let settings = $state<PluginSettings>(settingsStore.getSettings());

    /** 订阅设置变化 */
    const unsubscribe = settingsStore.subscribe((s: PluginSettings) => {
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

    /** Provider ID 列表 */
    let providerIds = $derived(Object.keys(settings.providers));

    /** 默认 Provider 下拉选项 */
    let defaultProviderOptions = $derived(
        providerIds.map(pid => ({ value: pid, label: pid }))
    );

    /** 切换 Provider 启用状态 */
    async function handleToggleEnabled(id: string, enabled: boolean) {
        await settingsStore.updateProvider(id, { enabled });
    }

    /** 测试 Provider 连接 */
    async function handleTestConnection(id: string) {
        showSuccess(i18n.t('common.loading') || 'Testing...');
        const result = await providerManager.checkAvailability(id, true);
        if (result.ok) {
            const caps = result.value;
            showSuccess(i18n.format('notices.connectionSuccess', {
                chat: caps.chat ? 'OK' : 'X',
                embedding: caps.embedding ? 'OK' : 'X',
                models: caps.models.length,
            }));
        } else {
            showError(i18n.format('notices.connectionFailed', {
                error: result.error.message,
            }));
        }
    }

    /** 编辑 Provider（打开 ProviderModal） */
    function handleEditProvider(id: string) {
        modalMode = 'edit';
        modalProviderId = id;
        modalConfig = settings.providers[id];
        showModal = true;
    }

    /** 删除 Provider */
    async function handleDeleteProvider(id: string) {
        // 简单确认后删除
        await settingsStore.removeProvider(id);
        showSuccess(i18n.format('notices.providerDeleted', { id }));
    }

    /** 添加 Provider（打开 ProviderModal） */
    function handleAddProvider() {
        modalMode = 'add';
        modalProviderId = '';
        modalConfig = undefined;
        showModal = true;
    }

    /** Modal 保存回调 */
    async function handleModalSave(id: string, config: ProviderConfig) {
        if (modalMode === 'add') {
            await settingsStore.addProvider(id, config);
            showSuccess(i18n.format('notices.providerAdded', { id }));
        } else {
            await settingsStore.updateProvider(id, config);
            showSuccess(i18n.format('notices.providerUpdated', { id }));
        }
        showModal = false;
    }

    /** Modal 取消回调 */
    function handleModalCancel() {
        showModal = false;
    }

    /** 切换默认 Provider */
    async function handleDefaultProviderChange(value: string) {
        await settingsStore.setDefaultProvider(value);
    }

    /** 更新请求超时 */
    async function handleTimeoutChange(value: number) {
        await settingsStore.updateSettings({ providerTimeoutMs: value });
    }

    // ---- 任务模型 ----

    /** 更新任务模型配置 */
    async function handleTaskModelUpdate(taskType: TaskType, partial: Partial<TaskModelConfig>) {
        const taskModels = {
            ...settings.taskModels,
            [taskType]: { ...settings.taskModels[taskType], ...partial },
        };
        await settingsStore.updateSettings({ taskModels });
    }

    /** 重置任务模型配置 */
    async function handleTaskModelReset(taskType: TaskType) {
        await settingsStore.resetTaskModel(taskType);
    }
</script>

<div class="cr-providers-tab">
    <!-- Provider 管理组 -->
    <div class="cr-settings-group">
        <div class="cr-settings-group__header">
            <h3 class="cr-settings-group__title">
                {i18n.t('settings.provider.title')}
            </h3>
            <button
                type="button"
                class="cr-btn-primary cr-btn--sm"
                onclick={handleAddProvider}
            >
                {i18n.t('settings.provider.addButton')}
            </button>
        </div>
        <p class="cr-settings-group__desc">
            {i18n.t('settings.provider.addDesc')}
        </p>

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
                        onEdit={handleEditProvider}
                        onDelete={handleDeleteProvider}
                    />
                {/each}
            </div>
        {/if}

        <!-- 默认 Provider + 请求超时 -->
        {#if providerIds.length > 0}
            <SettingItem
                name={i18n.t('settings.provider.defaultProvider')}
                description={i18n.t('settings.provider.defaultProviderDesc')}
            >
                <Select
                    value={settings.defaultProviderId}
                    options={defaultProviderOptions}
                    onchange={handleDefaultProviderChange}
                />
            </SettingItem>
        {/if}

        <SettingItem
            name={i18n.t('settings.advanced.queue.providerTimeout')}
            description={i18n.t('settings.advanced.queue.providerTimeoutDesc')}
        >
            <Slider
                value={settings.providerTimeoutMs}
                min={10000}
                max={3600000}
                step={10000}
                unit="ms"
                onchange={handleTimeoutChange}
            />
        </SettingItem>
    </div>

    <!-- 任务模型组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">
            {i18n.t('settings.groups.taskModels')}
        </h3>
        <p class="cr-settings-group__desc">
            {i18n.t('settings.advanced.taskModels.desc')}
        </p>

        <div class="cr-task-model-list">
            {#each TASK_TYPES as tt (tt)}
                <TaskModelCard
                    taskType={tt}
                    config={settings.taskModels[tt]}
                    providers={settings.providers}
                    defaultProviderId={settings.defaultProviderId}
                    isDefault={settingsStore.isTaskModelDefault(tt)}
                    {i18n}
                    onUpdate={handleTaskModelUpdate}
                    onReset={handleTaskModelReset}
                />
            {/each}
        </div>
    </div>

    <!-- ProviderModal -->
    {#if showModal}
        <ProviderModal
            mode={modalMode}
            providerId={modalProviderId}
            currentConfig={modalConfig}
            {providerManager}
            {i18n}
            onsave={handleModalSave}
            oncancel={handleModalCancel}
        />
    {/if}
</div>

<style>
    .cr-providers-tab {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-5, 20px);
    }

    .cr-settings-group {
        display: flex;
        flex-direction: column;
        background: var(--cr-bg-secondary);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md, 8px);
        padding: var(--cr-space-4, 16px);
    }

    .cr-settings-group__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--cr-space-2, 8px);
        padding-bottom: var(--cr-space-2, 8px);
        border-bottom: 1px solid var(--cr-border);
    }

    .cr-settings-group__title {
        margin: 0;
        color: var(--cr-text-normal);
        font-size: 15px;
        font-weight: 600;
        padding-left: var(--cr-space-2, 8px);
        border-left: 3px solid var(--cr-interactive-accent);
    }

    .cr-settings-group__desc {
        margin: 0 0 var(--cr-space-2, 8px) 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.4;
    }

    .cr-provider-list,
    .cr-task-model-list {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2, 8px);
        margin-bottom: var(--cr-space-3, 12px);
    }

    .cr-empty-hint {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        text-align: center;
        padding: var(--cr-space-4, 16px) 0;
        border: 1px dashed var(--cr-border);
        border-radius: var(--cr-radius-md, 6px);
        margin-bottom: var(--cr-space-3, 12px);
    }
</style>
