<!--
  AdvancedTab.svelte — 高级设置 Tab

  两个设置组：
  1. 去重检测：相似度阈值滑块、嵌入向量维度下拉（唯一配置点）
  2. 队列性能：并发数、自动重试、最大重试次数、任务超时、历史保留上限

  @see 需求 10.4, 10.5, 10.7
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import type { PluginSettings } from '../../../types';
    import type { SettingsStore } from '../../../data/settings-store';
    import SettingItem from './SettingItem.svelte';
    import Select from '../../components/Select.svelte';
    import Slider from '../../components/Slider.svelte';
    import Toggle from '../../components/Toggle.svelte';

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

    /** 嵌入向量维度选项 */
    const embeddingDimensionOptions = $derived([
        { value: '256', label: '256' },
        { value: '512', label: '512' },
        { value: '1024', label: '1024' },
        { value: '1536', label: '1536' },
        { value: '3072', label: '3072' },
    ]);

    /* ── 去重检测 ── */

    async function handleSimilarityChange(value: number) {
        await settingsStore.updateSettings({ similarityThreshold: value });
    }

    async function handleEmbeddingDimensionChange(value: string) {
        await settingsStore.updateSettings({ embeddingDimension: Number(value) });
    }

    /* ── 队列性能 ── */

    async function handleConcurrencyChange(value: number) {
        await settingsStore.updateSettings({ concurrency: value });
    }

    async function handleAutoRetryChange(checked: boolean) {
        await settingsStore.updateSettings({ autoRetry: checked });
    }

    async function handleMaxRetriesChange(value: number) {
        await settingsStore.updateSettings({ maxRetryAttempts: value });
    }

    async function handleTaskTimeoutChange(value: number) {
        await settingsStore.updateSettings({ taskTimeoutMs: value });
    }
</script>

<div class="cr-advanced-tab">
    <!-- 去重检测组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.groups.deduplication')}</h3>

        <SettingItem
            name={i18n.t('settings.similarityThreshold.name')}
            description={i18n.t('settings.similarityThreshold.desc')}
        >
            <Slider
                value={settings.similarityThreshold}
                min={0}
                max={1}
                step={0.01}
                onchange={handleSimilarityChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.advanced.embedding.dimension')}
            description={i18n.t('settings.advanced.embedding.dimensionDesc')}
        >
            <Select
                value={String(settings.embeddingDimension)}
                options={embeddingDimensionOptions}
                onchange={handleEmbeddingDimensionChange}
            />
        </SettingItem>

        <p class="cr-settings-group__warning">
            {i18n.t('settings.advanced.embedding.dimensionWarning')}
        </p>
    </div>

    <!-- 队列性能组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.advanced.queue.title')}</h3>

        <SettingItem
            name={i18n.t('settings.concurrency.name')}
            description={i18n.t('settings.concurrency.desc')}
        >
            <Slider
                value={settings.concurrency}
                min={1}
                max={10}
                step={1}
                onchange={handleConcurrencyChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.advanced.queue.autoRetry')}
            description={i18n.t('settings.advanced.queue.autoRetryDesc')}
        >
            <Toggle
                checked={settings.autoRetry}
                onchange={handleAutoRetryChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.advanced.queue.maxRetryAttempts')}
            description={i18n.t('settings.advanced.queue.maxRetryAttemptsDesc')}
        >
            <Slider
                value={settings.maxRetryAttempts}
                min={1}
                max={10}
                step={1}
                disabled={!settings.autoRetry}
                onchange={handleMaxRetriesChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.advanced.queue.taskTimeout')}
            description={i18n.t('settings.advanced.queue.taskTimeoutDesc')}
        >
            <Slider
                value={settings.taskTimeoutMs}
                min={30000}
                max={600000}
                step={30000}
                unit="ms"
                onchange={handleTaskTimeoutChange}
            />
        </SettingItem>
    </div>
</div>

<style>
    .cr-advanced-tab {
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

    .cr-settings-group__warning {
        margin: var(--cr-space-1, 4px) 0 0 0;
        color: var(--cr-text-warning);
        font-size: var(--cr-font-xs, 12px);
        line-height: 1.4;
    }
</style>
