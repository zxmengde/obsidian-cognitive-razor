<!--
  ProviderModal.svelte — 添加/编辑 Provider 配置 Modal

  表单字段：名称（Provider ID）、API Key（密码输入）、Base URL、
  默认聊天模型、默认嵌入模型、启用开关。
  连接测试按钮、保存/取消按钮。
  焦点捕获（Focus Trap）、ARIA 属性、Escape 关闭。

  @see 需求 12.3, 12.5, 12.6
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import { untrack } from 'svelte';
    import Button from '../../components/Button.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import PasswordInput from '../../components/PasswordInput.svelte';
    import Toggle from '../../components/Toggle.svelte';
    import type { ProviderConfig } from '../../../types';
    import type { ProviderManager } from '../../../core/provider-manager';
    import type { I18n } from '../../../core/i18n';

    let {
        mode,
        providerId = '',
        currentConfig = undefined,
        providerManager,
        i18n,
        onsave,
        oncancel,
    }: {
        mode: 'add' | 'edit';
        providerId?: string;
        currentConfig?: ProviderConfig;
        providerManager: ProviderManager;
        i18n: I18n;
        onsave: (id: string, config: ProviderConfig) => Promise<void>;
        oncancel: () => void;
    } = $props();

    /** 表单状态（untrack 避免 state_referenced_locally 警告：这些是有意的单次初始化） */
    let formId = $state(untrack(() => providerId));
    let formApiKey = $state(untrack(() => currentConfig?.apiKey ?? ''));
    let formBaseUrl = $state(untrack(() => currentConfig?.baseUrl ?? ''));
    let formChatModel = $state(untrack(() => currentConfig?.defaultChatModel ?? ''));
    let formEmbedModel = $state(untrack(() => currentConfig?.defaultEmbedModel ?? ''));
    let formEnabled = $state(untrack(() => currentConfig?.enabled ?? true));

    /** UI 状态 */
    let saving = $state(false);
    let testing = $state(false);
    let testResult = $state<{ ok: boolean; message: string } | null>(null);
    let errors = $state<Record<string, string>>({});

    /** 挂载前记录触发元素 */
    let previousActiveElement: HTMLElement | null = null;

    /** 对话框容器引用 */
    let dialogEl: HTMLDivElement | undefined = $state(undefined);

    /** 标题 ID（aria-labelledby） */
    const titleId = `cr-provider-title-${Math.random().toString(36).slice(2, 8)}`;

    /** 标题文本 */
    let title = $derived(
        mode === 'add'
            ? i18n.t('modals.addProvider.title')
            : i18n.t('modals.editProvider.title')
    );

    /** 翻译快捷方式 */
    function t(key: string): string {
        return i18n.t(key) || key;
    }

    /**
     * 获取对话框内所有可聚焦元素
     */
    function getFocusableElements(): HTMLElement[] {
        if (!dialogEl) return [];
        return Array.from(
            dialogEl.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
        );
    }

    /**
     * 焦点捕获：Tab/Shift+Tab 在 Modal 内循环
     */
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
            return;
        }
        if (e.key === 'Tab') {
            const focusable = getFocusableElements();
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    }

    /** 恢复焦点到触发元素 */
    function restoreFocus() {
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
            setTimeout(() => previousActiveElement?.focus(), 0);
        }
    }

    /** 检测是否为内网/本地地址（安全校验，防止 SSRF） */
    function isPrivateHost(hostname: string): boolean {
        const h = hostname.toLowerCase();
        return (
            h === 'localhost' ||
            h === '127.0.0.1' ||
            h === '::1' ||
            /^10\./.test(h) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
            /^192\.168\./.test(h)
        );
    }

    /** 表单验证 */
    function validate(): boolean {
        const newErrors: Record<string, string> = {};
        if (!formId.trim()) {
            newErrors.id = t('modals.providerConfig.errors.providerIdRequired');
        }
        if (!formApiKey.trim()) {
            newErrors.apiKey = t('modals.providerConfig.errors.apiKeyRequired');
        }
        if (formBaseUrl.trim()) {
            try {
                const url = new URL(formBaseUrl.trim());
                if (!['http:', 'https:'].includes(url.protocol)) {
                    newErrors.baseUrl = t('modals.providerConfig.errors.invalidUrlProtocol');
                } else if (isPrivateHost(url.hostname)) {
                    newErrors.baseUrl = t('modals.providerConfig.errors.privateAddressBlocked');
                }
            } catch {
                newErrors.baseUrl = t('modals.providerConfig.errors.invalidUrl');
            }
        }
        errors = newErrors;
        return Object.keys(newErrors).length === 0;
    }

    /** 保存 */
    async function handleSave() {
        if (!validate()) return;
        saving = true;
        try {
            const config: ProviderConfig = {
                apiKey: formApiKey.trim(),
                baseUrl: formBaseUrl.trim() || undefined,
                defaultChatModel: formChatModel.trim(),
                defaultEmbedModel: formEmbedModel.trim(),
                enabled: formEnabled,
            };
            await onsave(formId.trim(), config);
            restoreFocus();
        } catch (e) {
            new Notice(t('modals.providerConfig.errors.saveFailed'));
        } finally {
            saving = false;
        }
    }

    /** 取消 */
    function handleCancel() {
        restoreFocus();
        oncancel();
    }

    /** 点击遮罩层关闭 */
    function handleOverlayClick() {
        handleCancel();
    }

    /** 连接测试 */
    async function handleTestConnection() {
        if (!formApiKey.trim()) {
            errors = { ...errors, apiKey: t('modals.providerConfig.errors.apiKeyRequired') };
            return;
        }
        testing = true;
        testResult = null;
        try {
            // 临时构建配置用于测试
            const tempConfig: ProviderConfig = {
                apiKey: formApiKey.trim(),
                baseUrl: formBaseUrl.trim() || undefined,
                defaultChatModel: formChatModel.trim(),
                defaultEmbedModel: formEmbedModel.trim(),
                enabled: true,
            };
            const result = await providerManager.checkAvailability(
                formId.trim() || '__test__',
                true,
                tempConfig
            );
            if (result.ok) {
                const caps = result.value;
                testResult = {
                    ok: true,
                    message: i18n.format('notices.connectionSuccess', {
                        chat: caps.chat ? 'OK' : 'X',
                        embedding: caps.embedding ? 'OK' : 'X',
                        models: caps.models.length,
                    }),
                };
            } else {
                testResult = {
                    ok: false,
                    message: i18n.format('notices.connectionFailed', {
                        error: result.error.message,
                    }),
                };
            }
        } catch (e) {
            testResult = {
                ok: false,
                message: String(e),
            };
        } finally {
            testing = false;
        }
    }

    /**
     * 挂载时：记录触发元素 + 聚焦第一个可聚焦元素
     */
    $effect(() => {
        previousActiveElement = document.activeElement as HTMLElement | null;
        const timer = setTimeout(() => {
            const focusable = getFocusableElements();
            if (focusable.length > 0) {
                focusable[0].focus();
            }
        }, 0);
        return () => clearTimeout(timer);
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- 遮罩层 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cr-provider-overlay" onmousedown={handleOverlayClick}>
    <!-- 对话框 -->
    <div
        bind:this={dialogEl}
        class="cr-provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabindex="0"
        onmousedown={(e: MouseEvent) => e.stopPropagation()}
    >
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
                    disabled={mode === 'edit'}
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
                    <span class="cr-provider-field__required">*</span>
                </label>
                <p class="cr-provider-field__desc">
                    {t('modals.providerConfig.fields.apiKeyDesc')}
                </p>
                <PasswordInput
                    id="pm-api-key"
                    value={formApiKey}
                    placeholder="sk-..."
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
                    placeholder="https://api.openai.com/v1"
                    onchange={(v) => { formBaseUrl = v; errors = { ...errors, baseUrl: '' }; }}
                />
                {#if errors.baseUrl}
                    <p class="cr-provider-field__error">{errors.baseUrl}</p>
                {/if}
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
                    onchange={(v) => { formChatModel = v; }}
                />
            </div>

            <!-- 默认嵌入模型 -->
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
                    onchange={(v) => { formEmbedModel = v; }}
                />
            </div>

            <!-- 启用开关（Toggle 是 div[role=switch]，用 aria-labelledby 关联） -->
            <div class="cr-provider-field cr-provider-field--row">
                <span class="cr-provider-field__label" id="pm-enabled-label">
                    {t('settings.provider.enabled')}
                </span>
                <Toggle
                    checked={formEnabled}
                    ariaLabel={t('settings.provider.enabled')}
                    onchange={(v) => { formEnabled = v; }}
                />
            </div>
        </div>

        <!-- 连接测试结果 -->
        {#if testResult}
            <div
                class="cr-provider-test-result"
                class:cr-provider-test-result--ok={testResult.ok}
                class:cr-provider-test-result--fail={!testResult.ok}
                role="status"
                aria-live="polite"
            >
                {testResult.message}
            </div>
        {/if}

        <!-- 操作按钮 -->
        <div class="cr-provider-actions">
            <Button
                variant="ghost"
                loading={testing}
                onclick={handleTestConnection}
            >
                {t('settings.provider.testConnection')}
            </Button>
            <div class="cr-provider-actions__right">
                <Button variant="secondary" onclick={handleCancel}>
                    {t('common.cancel')}
                </Button>
                <Button variant="primary" loading={saving} onclick={handleSave}>
                    {t('common.save')}
                </Button>
            </div>
        </div>
    </div>
</div>


<style>
    /* 遮罩层 */
    .cr-provider-overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-modal, 50);
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.5);
    }

    /* 对话框容器 */
    .cr-provider-dialog {
        background: var(--cr-bg-base);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        box-shadow: var(--cr-shadow-lg);
        padding: var(--cr-space-6);
        min-width: 380px;
        max-width: 520px;
        width: 90%;
        max-height: 85vh;
        overflow-y: auto;
    }

    .cr-provider-dialog__title {
        margin: 0 0 var(--cr-space-1) 0;
        font-size: var(--font-ui-medium, 16px);
        font-weight: 600;
        color: var(--cr-text-normal);
    }

    .cr-provider-dialog__desc {
        margin: 0 0 var(--cr-space-4) 0;
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm, 13px);
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
        font-size: var(--font-ui-small, 13px);
        font-weight: 500;
        color: var(--cr-text-normal);
    }

    .cr-provider-field__required {
        color: var(--cr-text-error);
        margin-left: 2px;
    }

    .cr-provider-field__desc {
        margin: 0;
        font-size: var(--cr-font-xs, 12px);
        color: var(--cr-text-muted);
        line-height: 1.3;
    }

    .cr-provider-field__error {
        margin: 0;
        font-size: var(--cr-font-xs, 12px);
        color: var(--cr-text-error);
    }

    /* 连接测试结果 */
    .cr-provider-test-result {
        margin-top: var(--cr-space-2);
        padding: var(--cr-space-2) var(--cr-space-3);
        border-radius: var(--cr-radius-sm);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.4;
        white-space: pre-line;
    }

    .cr-provider-test-result--ok {
        background: var(--cr-bg-success, rgba(0, 200, 83, 0.1));
        color: var(--cr-text-success, #00c853);
        border: 1px solid var(--cr-border-success, rgba(0, 200, 83, 0.3));
    }

    .cr-provider-test-result--fail {
        background: var(--cr-bg-error, rgba(255, 82, 82, 0.1));
        color: var(--cr-text-error);
        border: 1px solid var(--cr-border-error, rgba(255, 82, 82, 0.3));
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
