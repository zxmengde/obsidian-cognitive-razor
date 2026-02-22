<!--
  SystemTab.svelte — 系统设置 Tab

  两个设置组：
  1. 日志：日志级别下拉、清空日志按钮
  2. 数据管理：导出设置、导入设置、重置为默认（Danger 按钮 + 确认 Modal）

  @see 需求 10.4, 10.8, 10.9
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import { showSuccess, showError } from '../../feedback';
    import type { PluginSettings } from '../../../types';
    import type { LogLevel } from '../../../data/logger';
    import type { SettingsStore } from '../../../data/settings-store';
    import { Logger } from '../../../data/logger';
    import SettingItem from './SettingItem.svelte';
    import Select from '../../components/Select.svelte';
    import Button from '../../components/Button.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';

    const ctx = getCRContext();
    const i18n = ctx.i18n;
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    /** 当前设置（响应式） */
    let settings = $state<PluginSettings>(settingsStore.getSettings());

    /** 订阅设置变化 */
    const unsubscribe = settingsStore.subscribe((s: PluginSettings) => {
        settings = s;
    });

    /** 组件销毁时取消订阅 */
    $effect(() => {
        return () => unsubscribe();
    });

    /** 是否显示重置确认 Modal */
    let showResetConfirm = $state(false);

    /** 日志级别选项 */
    const logLevelOptions = $derived([
        { value: 'debug', label: i18n.t('settings.advanced.logging.levels.debug') },
        { value: 'info', label: i18n.t('settings.advanced.logging.levels.info') },
        { value: 'warn', label: i18n.t('settings.advanced.logging.levels.warn') },
        { value: 'error', label: i18n.t('settings.advanced.logging.levels.error') },
    ]);

    /** 切换日志级别 */
    async function handleLogLevelChange(value: string) {
        const level = value as LogLevel;
        await settingsStore.updateSettings({ logLevel: level });
        logger.setLogLevel(level);
        showSuccess(i18n.format('notices.logLevelChanged', { level }));
    }

    /** 清空日志 */
    function handleClearLogs() {
        logger.clear();
        showSuccess(i18n.t('notices.logsCleared'));
    }

    /** 导出设置 */
    function handleExportSettings() {
        const json = settingsStore.exportSettings();
        // 创建下载链接
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cognitive-razor-settings.json';
        a.click();
        URL.revokeObjectURL(url);
        showSuccess(i18n.t('notices.settingsExported'));
    }

    /** 导入设置 */
    function handleImportSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const json = await file.text();
                const result = await settingsStore.importSettings(json);
                if (result.ok) {
                    showSuccess(i18n.t('notices.settingsImported'));
                } else {
                    showError(`${result.error.code}: ${result.error.message}`);
                }
            } catch (e) {
                showError(i18n.t('notices.settingsImportFailed'));
            }
        };
        input.click();
    }

    /** 重置为默认 */
    async function handleResetConfirm() {
        showResetConfirm = false;
        const result = await settingsStore.resetToDefaults();
        if (result.ok) {
            showSuccess(i18n.t('notices.settingsReset'));
        }
    }
</script>

<div class="cr-system-tab">
    <!-- 日志组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.groups.logging')}</h3>

        <SettingItem
            name={i18n.t('settings.advanced.logging.logLevel')}
            description={i18n.t('settings.advanced.logging.logLevelDesc')}
        >
            <Select
                value={settings.logLevel}
                options={logLevelOptions}
                onchange={handleLogLevelChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.advanced.logging.clearLogs')}
            description={i18n.t('settings.advanced.logging.clearLogsDesc')}
        >
            <Button variant="secondary" onclick={handleClearLogs}>
                {i18n.t('settings.advanced.logging.clearLogs')}
            </Button>
        </SettingItem>
    </div>

    <!-- 数据管理组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.groups.dataManagement')}</h3>

        <SettingItem
            name={i18n.t('settings.importExport.export')}
            description={i18n.t('settings.importExport.exportDesc')}
        >
            <Button variant="secondary" onclick={handleExportSettings}>
                {i18n.t('settings.importExport.export')}
            </Button>
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.importExport.import')}
            description={i18n.t('settings.importExport.importDesc')}
        >
            <Button variant="secondary" onclick={handleImportSettings}>
                {i18n.t('settings.importExport.import')}
            </Button>
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.importExport.reset')}
            description={i18n.t('settings.importExport.resetDesc')}
        >
            <Button variant="danger" onclick={() => showResetConfirm = true}>
                {i18n.t('settings.importExport.reset')}
            </Button>
        </SettingItem>
    </div>
</div>

<!-- 重置确认 Modal -->
{#if showResetConfirm}
    <ConfirmModal
        title={i18n.t('confirmDialogs.resetSettings.title')}
        message={i18n.t('confirmDialogs.resetSettings.message')}
        danger={true}
        onconfirm={handleResetConfirm}
        oncancel={() => showResetConfirm = false}
    />
{/if}

<style>
    .cr-system-tab {
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

    .cr-settings-group__title {
        margin: 0 0 var(--cr-space-2, 8px) 0;
        padding-bottom: var(--cr-space-2, 8px);
        border-bottom: 1px solid var(--cr-border);
        color: var(--cr-text-normal);
        font-size: 15px;
        font-weight: 600;
        padding-left: var(--cr-space-2, 8px);
        border-left: 3px solid var(--cr-interactive-accent);
    }
</style>
