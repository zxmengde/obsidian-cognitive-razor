<!--
  DirectoryStep.svelte — 目录方案配置步骤

  显示 5 种知识类型的目录路径，支持编辑。
  点击"创建目录并继续"后初始化目录结构。

  @see 需求 11.2, 11.3, 11.6
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import type { DirectoryScheme, PluginSettings } from '../../../types';
    import { safeErrorMessage } from '../../../types';
    import type { SettingsStore } from '../../../data/settings-store';
    import Button from '../../components/Button.svelte';
    import TextInput from '../../components/TextInput.svelte';

    let {
        onnext,
        onback,
    }: {
        onnext: () => void;
        onback: () => void;
    } = $props();

    const ctx = getCRContext();
    const i18n = ctx.i18n;
    const app = ctx.app;
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);

    /** 目录方案的 5 种知识类型键 */
    const DIRECTORY_KEYS: (keyof DirectoryScheme)[] = [
        'Domain', 'Issue', 'Theory', 'Entity', 'Mechanism'
    ];

    /** 当前设置 */
    let settings = $state<PluginSettings>(settingsStore.getSettings());

    /** UI 状态 */
    let creating = $state(false);
    let statusMessage = $state('');
    let statusType = $state<'idle' | 'creating' | 'done' | 'error'>('idle');
    let showSkip = $state(false);

    /** 翻译快捷方式 */
    function t(key: string): string {
        const val = i18n.t(key);
        return val === key ? key : val;
    }

    /** 更新目录路径 */
    async function handleDirectoryChange(key: keyof DirectoryScheme, value: string) {
        const scheme = { ...settings.directoryScheme, [key]: value };
        await settingsStore.update({ directoryScheme: scheme });
        settings = settingsStore.getSettings();
    }

    /** 确保目录存在 */
    async function ensureDirectory(rawPath: string): Promise<void> {
        const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
        if (!normalized) return;
        const parts = normalized.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const exists = await app.vault.adapter.exists(current);
            if (!exists) {
                await app.vault.adapter.mkdir(current);
            }
        }
    }

    /** 创建目录并继续 */
    async function handleCreateDirectories() {
        creating = true;
        statusType = 'creating';
        statusMessage = t('setupWizard.directoryStatus.creating');

        try {
            const scheme = settings.directoryScheme;
            const directories = Object.values(scheme)
                .map((dir) => dir.trim())
                .filter((dir) => dir.length > 0);
            const uniqueDirs = Array.from(new Set(directories));

            for (const dir of uniqueDirs) {
                await ensureDirectory(dir);
            }

            statusType = 'done';
            statusMessage = t('setupWizard.directoryStatus.done');
            creating = false;
            onnext();
        } catch (error) {
            const msg = safeErrorMessage(error);
            statusType = 'error';
            statusMessage = msg;
            showSkip = true;
            creating = false;
        }
    }
</script>

<div class="cr-wizard-step">
    <h1 class="cr-wizard-title">{t('setupWizard.directory.title')}</h1>
    <p class="cr-wizard-subtitle">{t('setupWizard.directory.subtitle')}</p>

    <!-- 目录列表 -->
    <div class="cr-wizard-directories">
        {#each DIRECTORY_KEYS as key (key)}
            <div class="cr-wizard-dir-item">
                <label class="cr-wizard-dir-item__label">
                    {i18n.t(`crTypes.${key}`)}
                </label>
                <TextInput
                    value={settings.directoryScheme[key]}
                    placeholder={key}
                    onchange={(v) => handleDirectoryChange(key, v)}
                    widthClass="cr-input-md"
                />
            </div>
        {/each}
    </div>

    <!-- 状态信息 -->
    {#if statusType !== 'idle'}
        <div
            class="cr-wizard-validation"
            class:cr-wizard-validation--ok={statusType === 'done'}
            class:cr-wizard-validation--error={statusType === 'error'}
            class:cr-wizard-validation--checking={statusType === 'creating'}
            role="status"
            aria-live="polite"
        >
            {statusMessage}
        </div>
    {/if}

    <!-- 按钮行 -->
    <div class="cr-wizard-buttons">
        <Button variant="secondary" onclick={onback}>
            {t('setupWizard.actions.back')}
        </Button>
        <div class="cr-wizard-buttons__right">
            {#if showSkip}
                <Button variant="ghost" onclick={onnext}>
                    {t('setupWizard.actions.skipAndContinue')}
                </Button>
            {/if}
            <Button variant="primary" loading={creating} onclick={handleCreateDirectories}>
                {t('setupWizard.actions.createAndContinue')}
            </Button>
        </div>
    </div>
</div>

<style>
    .cr-wizard-step {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-3, 12px);
    }

    .cr-wizard-title {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--cr-text-normal);
    }

    .cr-wizard-subtitle {
        margin: 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.5;
    }

    .cr-wizard-directories {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-3, 12px);
    }

    .cr-wizard-dir-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cr-space-3, 12px);
    }

    .cr-wizard-dir-item__label {
        font-size: var(--font-ui-small, 13px);
        font-weight: 500;
        color: var(--cr-text-normal);
        min-width: 60px;
    }

    .cr-wizard-validation {
        padding: var(--cr-space-2, 8px) var(--cr-space-3, 12px);
        border-radius: var(--cr-radius-sm, 4px);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.4;
    }

    .cr-wizard-validation--ok {
        background: var(--cr-bg-success, rgba(0, 200, 83, 0.1));
        color: var(--cr-text-success, #00c853);
    }

    .cr-wizard-validation--error {
        background: var(--cr-bg-error, rgba(255, 82, 82, 0.1));
        color: var(--cr-text-error);
    }

    .cr-wizard-validation--checking {
        background: var(--cr-bg-secondary);
        color: var(--cr-text-muted);
    }

    .cr-wizard-buttons {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--cr-space-3, 12px);
        margin-top: var(--cr-space-3, 12px);
    }

    .cr-wizard-buttons__right {
        display: flex;
        gap: var(--cr-space-2, 8px);
    }
</style>
