<!--
  GeneralTab.svelte — 通用设置 Tab

  两个设置组：
  1. 知识存储：5 种知识类型的目录路径编辑器
  2. 自动化：创建后自动核查（开关）

  @see 需求 10.2, 10.4, 10.9
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import type { PluginSettings, DirectoryScheme } from '../../../types';
    import type { SettingsStore } from '../../../data/settings-store';
    import SettingItem from './SettingItem.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Toggle from '../../components/Toggle.svelte';

    /** 目录方案的 5 种知识类型键 */
    const DIRECTORY_KEYS: (keyof DirectoryScheme)[] = [
        'Domain', 'Issue', 'Theory', 'Entity', 'Mechanism'
    ];

    const ctx = getCRContext();
    const i18n = ctx.i18n;
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);

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

    /** 更新目录路径 */
    async function handleDirectoryChange(key: keyof DirectoryScheme, value: string) {
        const scheme = { ...settings.directoryScheme, [key]: value };
        await settingsStore.updateSettings({ directoryScheme: scheme });
    }

    /** 切换自动核查 */
    async function handleAutoVerifyChange(checked: boolean) {
        await settingsStore.updateSettings({ enableAutoVerify: checked });
    }
</script>

<div class="cr-general-tab">
    <!-- 知识存储组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.groups.knowledgeStorage')}</h3>
        <p class="cr-settings-group__desc">
            {i18n.t('settings.advanced.directoryScheme.desc')}
        </p>

        {#each DIRECTORY_KEYS as key (key)}
            <SettingItem
                name={i18n.t(`crTypes.${key}`)}
                description={i18n.t(`crTypeDirectories.${key}`)}
            >
                <TextInput
                    value={settings.directoryScheme[key]}
                    placeholder={key}
                    onchange={(v) => handleDirectoryChange(key, v)}
                    widthClass="cr-input-md"
                />
            </SettingItem>
        {/each}
    </div>

    <!-- 自动化组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.groups.automation')}</h3>

        <SettingItem
            name={i18n.t('settings.advanced.features.enableAutoVerify')}
            description={i18n.t('settings.advanced.features.enableAutoVerifyDesc')}
        >
            <Toggle
                checked={settings.enableAutoVerify}
                onchange={handleAutoVerifyChange}
            />
        </SettingItem>
    </div>
</div>

<style>
    .cr-general-tab {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-4, 16px);
    }

    .cr-settings-group {
        display: flex;
        flex-direction: column;
    }

    .cr-settings-group__title {
        margin: 0 0 var(--cr-space-2, 8px) 0;
        padding-bottom: var(--cr-space-2, 8px);
        border-bottom: 1px solid var(--cr-border);
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium, 14px);
        font-weight: 600;
    }

    .cr-settings-group__desc {
        margin: 0 0 var(--cr-space-2, 8px) 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.4;
    }
</style>
