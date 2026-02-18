<!--
  ProviderStep.svelte — Provider 配置步骤

  表单字段：Provider ID、API Key、Base URL、聊天模型、嵌入模型。
  连接测试按钮、保存并校验、跳过选项。

  @see 需求 11.3, 11.4, 11.5, 11.6
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import type { ProviderConfig } from '../../../types';
    import { safeErrorMessage } from '../../../types';
    import type { SettingsStore } from '../../../data/settings-store';
    import type { ProviderManager } from '../../../core/provider-manager';
    import { formatMessage } from '../../../core/i18n';
    import Button from '../../components/Button.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import PasswordInput from '../../components/PasswordInput.svelte';

    let {
        onnext,
        onback,
    }: {
        onnext: () => void;
        onback: () => void;
    } = $props();

    const ctx = getCRContext();
    const i18n = ctx.i18n;
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);
    const providerManager = ctx.container.resolve<ProviderManager>(SERVICE_TOKENS.providerManager);

    /** 翻译快捷方式 */
    function t(key: string): string {
        const val = i18n.t(key);
        return val === key ? key : val;
    }

    /** 表单状态 */
    let providerId = $state('gemini');
    let apiKey = $state('');
    let baseUrl = $state('');
    let chatModel = $state('gemini-2.5-flash');
    let embedModel = $state('text-embedding-004');

    /** UI 状态 */
    let saving = $state(false);
    let validationStatus = $state<'idle' | 'checking' | 'ok' | 'offline' | 'error'>('idle');
    let validationMessage = $state('');
    let showSkip = $state(false);

    /** 校验状态文本 */
    let statusText = $derived(() => {
        switch (validationStatus) {
            case 'idle': return t('setupWizard.validation.idle');
            case 'checking': return t('setupWizard.validation.checking');
            case 'ok': return validationMessage || t('setupWizard.validation.ok');
            case 'offline': return validationMessage || t('setupWizard.validation.offline');
            case 'error': return validationMessage || t('setupWizard.validation.error');
            default: return '';
        }
    });

    /** 保存并校验 */
    async function handleSaveAndValidate() {
        if (!apiKey.trim()) {
            new Notice(t('setupWizard.notices.enterApiKey'));
            return;
        }
        if (!providerId.trim()) {
            new Notice(t('setupWizard.notices.enterProviderId'));
            return;
        }

        saving = true;
        validationStatus = 'checking';
        validationMessage = '';

        try {
            const config: ProviderConfig = {
                apiKey: apiKey.trim(),
                baseUrl: baseUrl.trim() || undefined,
                defaultChatModel: chatModel.trim(),
                defaultEmbedModel: embedModel.trim(),
                enabled: true,
            };

            // 保存 Provider
            const settings = settingsStore.getSettings();
            const hasProvider = !!settings.providers[providerId];
            const saveResult = hasProvider
                ? await settingsStore.updateProvider(providerId, config)
                : await settingsStore.addProvider(providerId, config);

            if (!saveResult.ok) {
                validationStatus = 'error';
                validationMessage = saveResult.error.message;
                showSkip = true;
                saving = false;
                return;
            }

            // 连接测试
            try {
                const checkResult = await providerManager.checkAvailability(providerId, true);
                if (!checkResult.ok) {
                    const isOffline = checkResult.error.code === 'E204_PROVIDER_ERROR' &&
                        typeof checkResult.error.details === 'object' &&
                        (checkResult.error.details as { kind?: unknown } | null)?.kind === 'network';
                    if (isOffline) {
                        validationStatus = 'offline';
                        validationMessage = t('setupWizard.validation.offlineSaved');
                        showSkip = true;
                    } else {
                        validationStatus = 'error';
                        validationMessage = formatMessage(
                            t('setupWizard.validation.failedWithMessage'),
                            { message: checkResult.error.message }
                        );
                        showSkip = true;
                    }
                    saving = false;
                    return;
                }
                // 校验成功，直接进入下一步
                validationStatus = 'ok';
                validationMessage = t('setupWizard.validation.ok');
                saving = false;
                onnext();
            } catch {
                validationStatus = 'offline';
                validationMessage = t('setupWizard.validation.offlineSavedByError');
                showSkip = true;
                saving = false;
            }
        } catch (error) {
            const msg = safeErrorMessage(error);
            validationStatus = 'error';
            validationMessage = msg;
            showSkip = true;
            saving = false;
        }
    }
</script>

<div class="cr-wizard-step">
    <h1 class="cr-wizard-title">{t('setupWizard.provider.title')}</h1>

    <div class="cr-wizard-hint">
        {t('setupWizard.provider.apiKeyHintBeforeLink')}
        <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a>
        {t('setupWizard.provider.apiKeyHintAfterLink')}
    </div>

    <!-- 表单 -->
    <div class="cr-wizard-form">
        <div class="cr-wizard-field">
            <label class="cr-wizard-field__label">API Key</label>
            <p class="cr-wizard-field__desc">{t('setupWizard.provider.apiKeyDesc')}</p>
            <PasswordInput
                value={apiKey}
                placeholder="AIza..."
                onchange={(v) => { apiKey = v; }}
            />
        </div>

        <div class="cr-wizard-field">
            <label class="cr-wizard-field__label">{t('setupWizard.provider.customEndpointName')}</label>
            <p class="cr-wizard-field__desc">{t('setupWizard.provider.customEndpointDesc')}</p>
            <TextInput
                value={baseUrl}
                placeholder="https://generativelanguage.googleapis.com/v1beta/openai/"
                onchange={(v) => { baseUrl = v; }}
            />
        </div>

        <div class="cr-wizard-field">
            <label class="cr-wizard-field__label">Provider ID</label>
            <TextInput
                value={providerId}
                placeholder="gemini"
                onchange={(v) => { providerId = v; }}
            />
        </div>

        <div class="cr-wizard-field">
            <label class="cr-wizard-field__label">{t('setupWizard.provider.chatModelName')}</label>
            <TextInput
                value={chatModel}
                placeholder="gemini-2.5-flash"
                onchange={(v) => { chatModel = v; }}
            />
        </div>

        <div class="cr-wizard-field">
            <label class="cr-wizard-field__label">{t('setupWizard.provider.embedModelName')}</label>
            <TextInput
                value={embedModel}
                placeholder="text-embedding-004"
                onchange={(v) => { embedModel = v; }}
            />
        </div>
    </div>

    <!-- 校验状态 -->
    {#if validationStatus !== 'idle'}
        <div
            class="cr-wizard-validation"
            class:cr-wizard-validation--ok={validationStatus === 'ok'}
            class:cr-wizard-validation--error={validationStatus === 'error'}
            class:cr-wizard-validation--offline={validationStatus === 'offline'}
            class:cr-wizard-validation--checking={validationStatus === 'checking'}
            role="status"
            aria-live="polite"
        >
            {statusText()}
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
            <Button variant="primary" loading={saving} onclick={handleSaveAndValidate}>
                {t('setupWizard.actions.saveAndValidate')}
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

    .cr-wizard-hint {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.5;
    }

    .cr-wizard-hint a {
        color: var(--cr-interactive-accent);
    }

    .cr-wizard-form {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-3, 12px);
    }

    .cr-wizard-field {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1, 4px);
    }

    .cr-wizard-field__label {
        font-size: var(--font-ui-small, 13px);
        font-weight: 500;
        color: var(--cr-text-normal);
    }

    .cr-wizard-field__desc {
        margin: 0;
        font-size: var(--cr-font-xs, 12px);
        color: var(--cr-text-muted);
        line-height: 1.3;
    }

    /* 校验状态 */
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

    .cr-wizard-validation--offline {
        background: var(--cr-bg-warning, rgba(255, 171, 0, 0.1));
        color: var(--cr-text-warning, #ffab00);
    }

    .cr-wizard-validation--checking {
        background: var(--cr-bg-secondary);
        color: var(--cr-text-muted);
    }

    /* 按钮行 */
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
