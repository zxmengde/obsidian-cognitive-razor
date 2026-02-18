<!--
  AdvancedTab.svelte — 高级设置 Tab

  四个设置组：
  1. 去重检测：相似度阈值滑块、嵌入向量维度下拉（唯一配置点）
  2. 队列性能：并发数、自动重试、最大重试次数、任务超时、历史保留上限
  3. 快照管理：最大快照数、快照保留天数
  4. 图片生成：启用开关、默认尺寸/质量/风格下拉、上下文窗口大小

  @see 需求 10.4, 10.5, 10.7, 10.9
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

    /** 图片尺寸选项 */
    const imageSizeOptions = $derived([
        { value: '1024x1024', label: i18n.t('imageGeneration.defaultSize.square') },
        { value: '1792x1024', label: i18n.t('imageGeneration.defaultSize.landscape') },
        { value: '1024x1792', label: i18n.t('imageGeneration.defaultSize.portrait') },
    ]);

    /** 图片质量选项 */
    const imageQualityOptions = $derived([
        { value: 'standard', label: i18n.t('imageGeneration.defaultQuality.standard') },
        { value: 'hd', label: i18n.t('imageGeneration.defaultQuality.hd') },
    ]);

    /** 图片风格选项 */
    const imageStyleOptions = $derived([
        { value: 'vivid', label: i18n.t('imageGeneration.defaultStyle.vivid') },
        { value: 'natural', label: i18n.t('imageGeneration.defaultStyle.natural') },
    ]);

    /* ── 去重检测 ── */

    async function handleSimilarityChange(value: number) {
        await settingsStore.update({ similarityThreshold: value });
    }

    async function handleEmbeddingDimensionChange(value: string) {
        await settingsStore.update({ embeddingDimension: Number(value) });
    }

    /* ── 队列性能 ── */

    async function handleConcurrencyChange(value: number) {
        await settingsStore.update({ concurrency: value });
    }

    async function handleAutoRetryChange(checked: boolean) {
        await settingsStore.update({ autoRetry: checked });
    }

    async function handleMaxRetriesChange(value: number) {
        await settingsStore.update({ maxRetryAttempts: value });
    }

    async function handleTaskTimeoutChange(value: number) {
        await settingsStore.update({ taskTimeoutMs: value });
    }

    async function handleMaxHistoryChange(value: number) {
        await settingsStore.update({ maxTaskHistory: value });
    }

    /* ── 快照管理 ── */

    async function handleMaxSnapshotsChange(value: number) {
        await settingsStore.update({ maxSnapshots: value });
    }

    async function handleSnapshotRetentionChange(value: number) {
        await settingsStore.update({ maxSnapshotAgeDays: value });
    }

    /* ── 图片生成 ── */

    async function handleImageEnabledChange(checked: boolean) {
        const imageGeneration = { ...settings.imageGeneration, enabled: checked };
        await settingsStore.update({ imageGeneration });
    }

    async function handleImageSizeChange(value: string) {
        const imageGeneration = { ...settings.imageGeneration, defaultSize: value as PluginSettings['imageGeneration']['defaultSize'] };
        await settingsStore.update({ imageGeneration });
    }

    async function handleImageQualityChange(value: string) {
        const imageGeneration = { ...settings.imageGeneration, defaultQuality: value as 'standard' | 'hd' };
        await settingsStore.update({ imageGeneration });
    }

    async function handleImageStyleChange(value: string) {
        const imageGeneration = { ...settings.imageGeneration, defaultStyle: value as 'vivid' | 'natural' };
        await settingsStore.update({ imageGeneration });
    }

    async function handleContextWindowChange(value: number) {
        const imageGeneration = { ...settings.imageGeneration, contextWindowSize: value };
        await settingsStore.update({ imageGeneration });
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

        <SettingItem
            name={i18n.t('settings.advanced.queue.maxTaskHistory')}
            description={i18n.t('settings.advanced.queue.maxTaskHistoryDesc')}
        >
            <Slider
                value={settings.maxTaskHistory}
                min={50}
                max={1000}
                step={50}
                onchange={handleMaxHistoryChange}
            />
        </SettingItem>
    </div>

    <!-- 快照管理组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('settings.groups.snapshots')}</h3>

        <SettingItem
            name={i18n.t('settings.maxSnapshots.name')}
            description={i18n.t('settings.maxSnapshots.desc')}
        >
            <Slider
                value={settings.maxSnapshots}
                min={10}
                max={500}
                step={10}
                onchange={handleMaxSnapshotsChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('settings.maxSnapshotAgeDays.name')}
            description={i18n.t('settings.maxSnapshotAgeDays.desc')}
        >
            <Slider
                value={settings.maxSnapshotAgeDays}
                min={1}
                max={365}
                step={1}
                unit={i18n.t('settings.units.days')}
                onchange={handleSnapshotRetentionChange}
            />
        </SettingItem>
    </div>

    <!-- 图片生成组 -->
    <div class="cr-settings-group">
        <h3 class="cr-settings-group__title">{i18n.t('imageGeneration.title')}</h3>

        <SettingItem
            name={i18n.t('imageGeneration.enabled.name')}
            description={i18n.t('imageGeneration.enabled.desc')}
        >
            <Toggle
                checked={settings.imageGeneration.enabled}
                onchange={handleImageEnabledChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('imageGeneration.defaultSize.name')}
            description={i18n.t('imageGeneration.defaultSize.desc')}
        >
            <Select
                value={settings.imageGeneration.defaultSize}
                options={imageSizeOptions}
                disabled={!settings.imageGeneration.enabled}
                onchange={handleImageSizeChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('imageGeneration.defaultQuality.name')}
            description={i18n.t('imageGeneration.defaultQuality.desc')}
        >
            <Select
                value={settings.imageGeneration.defaultQuality}
                options={imageQualityOptions}
                disabled={!settings.imageGeneration.enabled}
                onchange={handleImageQualityChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('imageGeneration.defaultStyle.name')}
            description={i18n.t('imageGeneration.defaultStyle.desc')}
        >
            <Select
                value={settings.imageGeneration.defaultStyle}
                options={imageStyleOptions}
                disabled={!settings.imageGeneration.enabled}
                onchange={handleImageStyleChange}
            />
        </SettingItem>

        <SettingItem
            name={i18n.t('imageGeneration.contextWindowSize.name')}
            description={i18n.t('imageGeneration.contextWindowSize.desc')}
        >
            <Slider
                value={settings.imageGeneration.contextWindowSize}
                min={100}
                max={2000}
                step={100}
                disabled={!settings.imageGeneration.enabled}
                onchange={handleContextWindowChange}
            />
        </SettingItem>
    </div>
</div>

<style>
    .cr-advanced-tab {
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

    .cr-settings-group__warning {
        margin: var(--cr-space-1, 4px) 0 0 0;
        color: var(--cr-text-warning);
        font-size: var(--cr-font-xs, 12px);
        line-height: 1.4;
    }
</style>
