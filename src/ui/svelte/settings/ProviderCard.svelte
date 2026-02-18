<!--
  ProviderCard.svelte — Provider 摘要卡片

  显示单个 Provider 的配置信息：名称、API Key（密码）、Base URL、
  默认模型、启用开关、连接测试、编辑/删除按钮。

  @see 需求 10.4, 10.7
-->
<script lang="ts">
    import type { ProviderConfig } from '../../../types';
    import Toggle from '../../components/Toggle.svelte';

    let {
        id,
        config,
        isDefault = false,
        i18n,
        onToggleEnabled,
        onTestConnection,
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
        onTestConnection: (id: string) => void;
        /** 编辑 */
        onEdit: (id: string) => void;
        /** 删除 */
        onDelete: (id: string) => void;
    } = $props();

    /** 连接测试中 */
    let testing = $state(false);

    /** 遮蔽 API Key 显示 */
    let maskedKey = $derived(
        config.apiKey
            ? config.apiKey.slice(0, 4) + '••••' + config.apiKey.slice(-4)
            : '—'
    );

    async function handleTest() {
        testing = true;
        try {
            await onTestConnection(id);
        } finally {
            testing = false;
        }
    }
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
            <span class="cr-provider-card__label">{i18n.t('settings.provider.model')}</span>
            <span class="cr-provider-card__value">
                {config.defaultChatModel || '—'}
            </span>
        </div>
    </div>

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
            <button
                type="button"
                class="cr-btn-ghost cr-btn--sm"
                disabled={testing || !config.enabled}
                aria-disabled={testing || !config.enabled ? 'true' : undefined}
                onclick={handleTest}
            >
                {#if testing}
                    <span class="cr-loading-spinner" aria-hidden="true"></span>
                {/if}
                {i18n.t('settings.provider.testConnection')}
            </button>
            <button
                type="button"
                class="cr-btn-ghost cr-btn--sm"
                onclick={() => onEdit(id)}
            >
                {i18n.t('common.edit')}
            </button>
            <button
                type="button"
                class="cr-btn-danger cr-btn--sm"
                onclick={() => onDelete(id)}
            >
                {i18n.t('common.delete')}
            </button>
        </div>
    </div>
</div>

<style>
    .cr-provider-card {
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md, 6px);
        padding: var(--cr-space-3, 12px);
        background: var(--cr-bg-base);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2, 8px);
    }

    .cr-provider-card--disabled {
        opacity: 0.6;
    }

    .cr-provider-card__header {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
    }

    .cr-provider-card__name {
        font-weight: 600;
        color: var(--cr-text-normal);
        font-size: var(--font-ui-medium, 14px);
    }

    .cr-provider-card__badge {
        font-size: var(--cr-font-xs, 11px);
        color: var(--cr-interactive-accent);
        border: 1px solid var(--cr-interactive-accent);
        border-radius: var(--cr-radius-sm, 4px);
        padding: 0 var(--cr-space-1, 4px);
        line-height: 1.6;
    }

    .cr-provider-card__info {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-1, 4px);
    }

    .cr-provider-card__row {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2, 8px);
        font-size: var(--cr-font-sm, 13px);
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
        font-size: var(--cr-font-xs, 11px);
    }

    .cr-provider-card__actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: var(--cr-space-2, 8px);
        border-top: 1px solid var(--cr-border);
    }

    .cr-provider-card__buttons {
        display: flex;
        gap: var(--cr-space-1, 4px);
    }
</style>
