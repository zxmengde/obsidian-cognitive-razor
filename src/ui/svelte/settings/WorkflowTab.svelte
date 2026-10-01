<script lang="ts">
    import { getSettingsContext } from '../../bridge/context';
    import type { DirectoryScheme, LogLevel, PluginSettings, TaskType, TaskModelConfig } from '../../../types';
    import { TASK_TYPES } from '../../../data/settings-store';
    import type { SemanticIndexRebuildProgress, SemanticIndexStatus } from '../../../core/semantic-index-rebuilder';
    import type { VectorIndexMaintenanceReport } from '../../../core/vector-index';
    import SettingItem from './SettingItem.svelte';
    import SettingsSection from './SettingsSection.svelte';
    import Select from '../../components/Select.svelte';
    import Slider from '../../components/Slider.svelte';
    import TextInput from '../../components/TextInput.svelte';
    import Toggle from '../../components/Toggle.svelte';
    import Button from '../../components/Button.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import TaskModelCard from './TaskModelCard.svelte';
    import Collapsible from '../../components/Collapsible.svelte';

    const DIRECTORY_KEYS: (keyof DirectoryScheme)[] = [
        'domain', 'issue', 'theory', 'entity', 'mechanism'
    ];

    const { i18n, settingsApplication } = getSettingsContext();
    const detailsToggleLabels = {
        expand: i18n.t('common.details.expand'),
        collapse: i18n.t('common.details.collapse'),
    };
    const LOG_LEVEL_OPTIONS: Array<{ value: LogLevel; label: string }> = [
        { value: 'silent', label: i18n.t('settings.advanced.queue.logLevels.silent') },
        { value: 'debug', label: i18n.t('settings.advanced.queue.logLevels.debug') },
        { value: 'info', label: i18n.t('settings.advanced.queue.logLevels.info') },
        { value: 'warn', label: i18n.t('settings.advanced.queue.logLevels.warn') },
        { value: 'error', label: i18n.t('settings.advanced.queue.logLevels.error') },
    ];
    let notePath = $state('');
    async function rebuildSpecifiedNote(): Promise<void> {
        if (maintenanceRunning || !notePath.trim()) return;
        missingEmbedRunning = true;
        try {
            const result = await settingsApplication.rebuildSpecifiedNote(notePath);
            missingEmbedFeedback = result.ok ? { level: result.value.failed ? "error" : "success", message: i18n.format('cards.rebuildComplete', result.value) } : { level: "error", message: result.error.message };
        } finally { missingEmbedRunning = false; }
    }
    let settings = $state<PluginSettings>(settingsApplication.getSettings());
    let showRebuildConfirm = $state(false);
    let rebuildState = $state(settingsApplication.getSemanticIndexRebuildState());
    let saveState = $state(settingsApplication.getSaveState());
    let duplicateRebuildRunning = $state(false);
    let duplicateRebuildFeedback = $state<{ level: 'success' | 'error'; message: string } | null>(null);
    let indexStatus = $state<SemanticIndexStatus | null>(null);
    let indexScanRunning = $state(false);
    let missingEmbedRunning = $state(false);
    let missingEmbedFeedback = $state<{ level: 'success' | 'error'; message: string } | null>(null);
    let vectorReport = $state<VectorIndexMaintenanceReport | null>(null);
    let vectorScanRunning = $state(false);
    let vectorCleanupRunning = $state(false);
    let vectorCleanupFeedback = $state<{ level: 'success' | 'error'; message: string } | null>(null);
    let showVectorCleanupConfirm = $state(false);
    let semanticAdvancedCollapsed = $state(true);
    let queueAdvancedCollapsed = $state(true);
    const unsubscribe = settingsApplication.subscribeSettings((value) => settings = value);
    const unsubscribeRebuild = settingsApplication.subscribeSemanticIndexRebuildState((value) => rebuildState = value);
    const unsubscribeSave = settingsApplication.subscribeSaveState((value) => saveState = value);
    $effect(() => () => {
        unsubscribe();
        unsubscribeRebuild();
        unsubscribeSave();
        settingsApplication.cancelSemanticIndexRebuild();
    });

    let rebuildRunning = $derived(rebuildState.status === 'running');
    let maintenanceRunning = $derived(rebuildRunning || duplicateRebuildRunning || indexScanRunning || missingEmbedRunning || vectorScanRunning || vectorCleanupRunning || saveState.status === 'saving');

    async function scanSemanticIndex(force = false): Promise<void> {
        if (indexScanRunning || (!force && maintenanceRunning)) return;
        indexScanRunning = true;
        try {
            const result = await settingsApplication.scanSemanticIndex();
            if (result.ok) indexStatus = result.value;
            else missingEmbedFeedback = { level: 'error', message: result.error.message };
        } finally { indexScanRunning = false; }
    }

    async function embedMissing(): Promise<void> {
        if (missingEmbedRunning || maintenanceRunning) return;
        missingEmbedRunning = true;
        missingEmbedFeedback = null;
        try {
            const result = await settingsApplication.embedMissingSemanticIndex();
            missingEmbedFeedback = result.ok
                ? { level: result.value.failed > 0 ? 'error' : 'success', message: i18n.format('settings.advanced.semanticIndexing.missingComplete', result.value) }
                : { level: 'error', message: result.error.message };
            await scanSemanticIndex(true);
        } finally { missingEmbedRunning = false; }
    }

    async function embedOne(cruid: string): Promise<void> {
        if (missingEmbedRunning || maintenanceRunning) return;
        missingEmbedRunning = true;
        const result = await settingsApplication.embedOneSemanticIndex(cruid);
        missingEmbedFeedback = result.ok
            ? { level: result.value.failed > 0 ? 'error' : 'success', message: i18n.t('settings.advanced.semanticIndexing.embedOneComplete') }
            : { level: 'error', message: result.error.message };
        missingEmbedRunning = false;
        await scanSemanticIndex(true);
    }

    async function scanVectorFiles(force = false): Promise<void> {
        if (vectorScanRunning || (!force && maintenanceRunning)) return;
        vectorScanRunning = true;
        vectorReport = null;
        vectorCleanupFeedback = null;
        try {
            const result = await settingsApplication.inspectVectorFiles();
            if (result.ok) vectorReport = result.value;
            else vectorCleanupFeedback = { level: 'error', message: result.error.message };
        } finally { vectorScanRunning = false; }
    }

    async function cleanupVectorFiles(): Promise<void> {
        if (!vectorReport || vectorCleanupRunning || maintenanceRunning) return;
        showVectorCleanupConfirm = false;
        vectorCleanupRunning = true;
        vectorCleanupFeedback = null;
        try {
            const result = await settingsApplication.cleanupOrphanedVectorFiles(vectorReport.orphanFiles);
            vectorCleanupFeedback = result.ok
                ? { level: result.value.failed > 0 ? 'error' : 'success', message: i18n.format('settings.advanced.semanticIndexing.cleanupVectorFilesComplete', { ...result.value }) }
                : { level: 'error', message: result.error.message };
            await scanVectorFiles(true);
        } finally { vectorCleanupRunning = false; }
    }

    async function updateDirectory(key: keyof DirectoryScheme, value: string): Promise<void> {
        await settingsApplication.updateSettings({
            directoryScheme: { [key]: value },
        });
    }

    async function rebuildSemanticIndex(): Promise<void> {
        if (rebuildRunning) return;
        showRebuildConfirm = false;
        await settingsApplication.rebuildSemanticIndex();
    }

    function cancelSemanticIndexRebuild(): void {
        if (!rebuildRunning || rebuildState.cancelRequested) return;
        settingsApplication.cancelSemanticIndexRebuild();
    }

    async function rebuildDuplicatePairs(): Promise<void> {
        if (maintenanceRunning) return;
        duplicateRebuildRunning = true;
        duplicateRebuildFeedback = null;
        try {
            const result = await settingsApplication.rebuildDuplicatePairs();
            duplicateRebuildFeedback = result.ok
                ? {
                    level: 'success',
                    message: i18n.format('settings.advanced.semanticIndexing.rebuildDuplicatesComplete', {
                        count: result.value,
                    }),
                }
                : {
                    level: 'error',
                    message: i18n.t('settings.advanced.semanticIndexing.rebuildDuplicatesFailed'),
                };
        } catch {
            duplicateRebuildFeedback = {
                level: 'error',
                message: i18n.t('settings.advanced.semanticIndexing.rebuildDuplicatesFailed'),
            };
        } finally {
            duplicateRebuildRunning = false;
        }
    }

    function rebuildProgressText(progress: SemanticIndexRebuildProgress): string {
        return i18n.format(`settings.advanced.semanticIndexing.rebuildPhases.${progress.phase}`, {
            completed: progress.completed,
            total: progress.total,
            failed: progress.failed,
        });
    }
</script>

<div class="cr-workflow-tab">
    <SettingsSection title={i18n.t('cards.directories')} description={i18n.t('cards.directoriesDesc')}>
        <SettingItem name={i18n.t('cards.sourceRoot')}>
            <TextInput value={settings.cardsSourceRoot} onchange={(value) => void settingsApplication.updateSettings({ cardsSourceRoot: value })} />
        </SettingItem>
        <SettingItem name={i18n.t('cards.targetRoot')}>
            <TextInput value={settings.cardsTargetRoot} onchange={(value) => void settingsApplication.updateSettings({ cardsTargetRoot: value })} />
        </SettingItem>
    </SettingsSection>
    <SettingsSection
        title={i18n.t('settings.groups.taskModels')}
        description={i18n.t('settings.advanced.taskModels.desc')}
    >
        <div class="cr-task-model-list">
            {#each TASK_TYPES as taskType (taskType)}
                <TaskModelCard
                    taskType={taskType}
                    config={settings.taskModels[taskType]}
                    providers={settings.providers}
                    defaultProviderId={settings.defaultProviderId}
                    isDefault={settingsApplication.isTaskModelDefault(taskType)}
                    {i18n}
                    onUpdate={(type: TaskType, partial: Partial<TaskModelConfig>) => void settingsApplication.updateTaskModel(type, partial)}
                    onReset={(type: TaskType) => void settingsApplication.resetTaskModel(type)}
                />
            {/each}
        </div>
    </SettingsSection>
    {#if rebuildState.status === 'completed' && rebuildState.summary}
        <InlineAlert
            level="success"
            message={i18n.format('settings.advanced.semanticIndexing.rebuildComplete', { indexed: rebuildState.summary.indexed })}
            {detailsToggleLabels}
        />
    {:else if rebuildState.status === 'partial' && rebuildState.summary}
        <InlineAlert
            level="warning"
            message={rebuildState.summary.duplicateRefreshFailed
                ? i18n.format('settings.advanced.semanticIndexing.rebuildDuplicateFailed', { indexed: rebuildState.summary.indexed })
                : i18n.format('settings.advanced.semanticIndexing.rebuildPartial', {
                    indexed: rebuildState.summary.indexed,
                    skipped: rebuildState.summary.skipped,
                })}
            {detailsToggleLabels}
        />
    {:else if rebuildState.status === 'cancelled'}
        <InlineAlert level="info" message={i18n.t('settings.advanced.semanticIndexing.rebuildCancelled')} {detailsToggleLabels} />
    {:else if rebuildState.status === 'failed'}
        <InlineAlert level="error" message={i18n.t('settings.advanced.semanticIndexing.rebuildFailed')} {detailsToggleLabels} />
    {/if}
    {#if duplicateRebuildFeedback}
        <InlineAlert level={duplicateRebuildFeedback.level} message={duplicateRebuildFeedback.message} {detailsToggleLabels} />
    {/if}
    {#if missingEmbedFeedback}
        <InlineAlert level={missingEmbedFeedback.level} message={missingEmbedFeedback.message} {detailsToggleLabels} />
    {/if}
    {#if vectorCleanupFeedback}
        <InlineAlert level={vectorCleanupFeedback.level} message={vectorCleanupFeedback.message} {detailsToggleLabels} />
    {/if}

    <SettingsSection
        title={i18n.t('settings.groups.knowledgeStorage')}
        description={i18n.t('settings.advanced.directoryScheme.desc')}
    >
        {#each DIRECTORY_KEYS as key (key)}
            <SettingItem
                name={i18n.t(`crTypes.${key}`)}
                description={i18n.t(`crTypeDirectories.${key}`)}
            >
                <TextInput
                    value={settings.directoryScheme[key]}
                    placeholder={key}
                    ariaLabel={i18n.t(`crTypes.${key}`)}
                    onchange={(value) => void updateDirectory(key, value)}
                    widthClass="cr-input-md"
                />
            </SettingItem>
        {/each}
    </SettingsSection>

    <SettingsSection title={i18n.t('settings.groups.automation')}>
        <SettingItem
            name={i18n.t('settings.advanced.features.enableAutoVerify')}
            description={i18n.t('settings.advanced.features.enableAutoVerifyDesc')}
        >
            <Toggle
                checked={settings.enableAutoVerify}
                ariaLabel={i18n.t('settings.advanced.features.enableAutoVerify')}
                onchange={async (value) => { await settingsApplication.updateSettings({ enableAutoVerify: value }); }}
            />
        </SettingItem>
    </SettingsSection>

    <Collapsible
        title={i18n.t('settings.groups.semanticIndexing')}
        collapsed={semanticAdvancedCollapsed}
        onToggle={(value) => semanticAdvancedCollapsed = value}
    >
        <SettingItem name={i18n.t('cards.rebuildNote')} description={i18n.t('cards.rebuildNoteDesc')}>
            <TextInput value={notePath} onchange={(value) => notePath = value} placeholder={i18n.t('cards.notePlaceholder')} />
            <Button disabled={maintenanceRunning || !notePath.trim() || !settings.enableSemanticIndexing} onclick={() => void rebuildSpecifiedNote()}>{i18n.t('cards.rebuildNote')}</Button>
        </SettingItem>

    <SettingsSection title="">
        <SettingItem
            name={i18n.t('settings.advanced.semanticIndexing.enabled')}
            description={i18n.t('settings.advanced.semanticIndexing.enabledDesc')}
        >
            <Toggle
                checked={settings.enableSemanticIndexing}
                disabled={maintenanceRunning}
                ariaLabel={i18n.t('settings.advanced.semanticIndexing.enabled')}
                onchange={async (value) => { await settingsApplication.updateSettings({ enableSemanticIndexing: value }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.semanticIndexing.duplicates')}
            description={i18n.t('settings.advanced.semanticIndexing.duplicatesDesc')}
        >
            <Toggle
                checked={settings.enableDuplicateDetection}
                disabled={!settings.enableSemanticIndexing || maintenanceRunning}
                ariaLabel={i18n.t('settings.advanced.semanticIndexing.duplicates')}
                onchange={async (value) => { await settingsApplication.updateSettings({ enableDuplicateDetection: value }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.similarityThreshold.name')}
            description={i18n.t('settings.similarityThreshold.desc')}
        >
            <Slider
                value={settings.similarityThreshold}
                min={0}
                max={1}
                step={0.01}
                disabled={!settings.enableSemanticIndexing || !settings.enableDuplicateDetection || maintenanceRunning}
                ariaLabel={i18n.t('settings.similarityThreshold.name')}
                onchange={async (value) => { await settingsApplication.updateSettings({ similarityThreshold: value }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.semanticIndexing.scanMissing')}
            description={i18n.t('settings.advanced.semanticIndexing.scanMissingDesc')}
        >
            <Button variant="secondary" loading={indexScanRunning} disabled={!settings.enableSemanticIndexing || maintenanceRunning} onclick={() => void scanSemanticIndex()}>
                {i18n.t('settings.advanced.semanticIndexing.scanMissing')}
            </Button>
        </SettingItem>
        {#if indexStatus}
            <div class="cr-index-status" role="status">
                <span>{i18n.format('settings.advanced.semanticIndexing.counts', { eligible: indexStatus.eligible, indexed: indexStatus.indexed, missing: indexStatus.missing })}</span>
                {#if indexStatus.missing > 0}
                    <Button variant="secondary" loading={missingEmbedRunning} disabled={maintenanceRunning} onclick={() => void embedMissing()}>
                        {i18n.t('settings.advanced.semanticIndexing.embedMissing')}
                    </Button>
                    <div class="cr-missing-list">
                        {#each indexStatus.missingNotes as note (note.cruid)}
                            <div class="cr-missing-item">
                                <strong>{note.name}</strong><span>{note.path}</span><span>{i18n.t(`crTypes.${note.type}`)} · {note.status}</span>
                                <Button variant="ghost" size="sm" disabled={missingEmbedRunning} onclick={() => void embedOne(note.cruid)}>{i18n.t('settings.advanced.semanticIndexing.embedOne')}</Button>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
        <SettingItem
            name={i18n.t('settings.advanced.semanticIndexing.vectorMaintenance')}
            description={i18n.t('settings.advanced.semanticIndexing.vectorMaintenanceDesc')}
        >
            <Button variant="secondary" loading={vectorScanRunning} disabled={maintenanceRunning} onclick={() => void scanVectorFiles()}>
                {i18n.t('settings.advanced.semanticIndexing.scanVectorFiles')}
            </Button>
        </SettingItem>
        {#if vectorReport}
            <div class="cr-vector-status" role="status">
                <span>{i18n.format('settings.advanced.semanticIndexing.vectorCounts', {
                    indexedEntries: vectorReport.indexedEntries,
                    physicalFiles: vectorReport.physicalFiles,
                    orphaned: vectorReport.orphanFiles.length,
                    missing: vectorReport.missingEntries.length,
                    stale: vectorReport.staleEntries.length,
                    invalid: vectorReport.invalidEntries.length,
                })}</span>
                {#if vectorReport.orphanFiles.length > 0}
                    <Button variant="secondary" loading={vectorCleanupRunning} disabled={maintenanceRunning} onclick={() => showVectorCleanupConfirm = true}>
                        {i18n.t('settings.advanced.semanticIndexing.cleanupVectorFiles')}
                    </Button>
                    <div class="cr-vector-list">
                        {#each vectorReport.orphanFiles as file (file.path)}
                            <span>{file.path}</span>
                        {/each}
                    </div>
                {/if}
                {#if vectorReport.missingEntries.length > 0}
                    <div class="cr-vector-list">
                        <strong>{i18n.t('settings.advanced.semanticIndexing.missingEntries')}</strong>
                        {#each vectorReport.missingEntries as entry (`${entry.type}/${entry.uid}`)}
                            <span>{entry.type}/{entry.uid}</span>
                        {/each}
                    </div>
                {/if}
                {#if vectorReport.staleEntries.length > 0}
                    <div class="cr-vector-list">
                        <strong>{i18n.t('settings.advanced.semanticIndexing.staleEntries')}</strong>
                        {#each vectorReport.staleEntries as entry (`${entry.type}/${entry.uid}`)}
                            <span>{entry.type}/{entry.uid}</span>
                        {/each}
                    </div>
                {/if}
                {#if vectorReport.invalidEntries.length > 0}
                    <div class="cr-vector-list">
                        <strong>{i18n.t('settings.advanced.semanticIndexing.invalidEntries')}</strong>
                        {#each vectorReport.invalidEntries as entry (`${entry.type}/${entry.uid}`)}
                            <span>{entry.type}/{entry.uid}</span>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
        <SettingItem
            name={i18n.t('settings.advanced.semanticIndexing.rebuildDuplicates')}
            description={i18n.t('settings.advanced.semanticIndexing.rebuildDuplicatesDesc')}
        >
            <Button
                variant="secondary"
                loading={duplicateRebuildRunning}
                disabled={!settings.enableSemanticIndexing || !settings.enableDuplicateDetection || maintenanceRunning}
                onclick={() => void rebuildDuplicatePairs()}
            >
                {i18n.t('settings.advanced.semanticIndexing.rebuildDuplicates')}
            </Button>
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.semanticIndexing.rebuild')}
            description={i18n.t('settings.advanced.semanticIndexing.rebuildDesc')}
        >
            <div class="cr-rebuild-control">
                {#if rebuildState.progress}
                    <span class="cr-rebuild-progress" role="status" aria-live="polite">
                        {rebuildProgressText(rebuildState.progress)}
                    </span>
                {/if}
                {#if rebuildRunning}
                    <Button
                        variant="secondary"
                        disabled={rebuildState.cancelRequested || (rebuildState.progress !== undefined && rebuildState.progress.phase !== 'scanning' && rebuildState.progress.phase !== 'embedding')}
                        onclick={cancelSemanticIndexRebuild}
                    >
                        {i18n.t('common.cancel')}
                    </Button>
                {:else}
                    <Button
                        variant="secondary"
                        disabled={!settings.enableSemanticIndexing || duplicateRebuildRunning}
                        onclick={() => showRebuildConfirm = true}
                    >
                        {i18n.t('settings.advanced.semanticIndexing.rebuild')}
                    </Button>
                {/if}
            </div>
        </SettingItem>
    </SettingsSection>
    </Collapsible>

    <Collapsible
        title={i18n.t('settings.advanced.queue.title')}
        collapsed={queueAdvancedCollapsed}
        onToggle={(value) => queueAdvancedCollapsed = value}
    >
    <SettingsSection title="">
        <SettingItem
            name={i18n.t('settings.advanced.queue.logLevel')}
            description={i18n.t('settings.advanced.queue.logLevelDesc')}
        >
            <Select
                value={settings.logLevel}
                options={LOG_LEVEL_OPTIONS}
                ariaLabel={i18n.t('settings.advanced.queue.logLevel')}
                onchange={async (value) => { await settingsApplication.updateSettings({ logLevel: value as LogLevel }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.concurrency.name')}
            description={i18n.t('settings.concurrency.desc')}
        >
            <Slider
                value={settings.concurrency}
                min={1}
                max={10}
                step={1}
                ariaLabel={i18n.t('settings.concurrency.name')}
                onchange={async (value) => { await settingsApplication.updateSettings({ concurrency: value }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.queue.taskTimeout')}
            description={i18n.t('settings.advanced.queue.taskTimeoutDesc')}
        >
            <Slider
                value={settings.taskTimeoutMs / 1000}
                min={30}
                max={3600}
                step={30}
                unit={i18n.t('common.units.seconds')}
                ariaLabel={i18n.t('settings.advanced.queue.taskTimeout')}
                onchange={async (value) => { await settingsApplication.updateSettings({ taskTimeoutMs: value * 1000 }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.queue.networkTimeout')}
            description={i18n.t('settings.advanced.queue.networkTimeoutDesc')}
        >
            <Slider
                value={settings.providerTimeoutMs / 1000}
                min={10}
                max={3600}
                step={10}
                unit={i18n.t('common.units.seconds')}
                ariaLabel={i18n.t('settings.advanced.queue.networkTimeout')}
                onchange={async (value) => { await settingsApplication.updateSettings({ providerTimeoutMs: value * 1000 }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.queue.streamingKeepalive')}
            description={i18n.t('settings.advanced.queue.streamingKeepaliveDesc')}
        >
            <Toggle
                checked={settings.enableStreamingKeepalive}
                ariaLabel={i18n.t('settings.advanced.queue.streamingKeepalive')}
                onchange={async (value) => { await settingsApplication.updateSettings({ enableStreamingKeepalive: value }); }}
            />
        </SettingItem>
        <SettingItem
            name={i18n.t('settings.advanced.queue.providerMaxAttempts')}
            description={i18n.t('settings.advanced.queue.providerMaxAttemptsDesc')}
        >
            <Slider
                value={settings.providerMaxAttempts}
                min={1}
                max={3}
                step={1}
                ariaLabel={i18n.t('settings.advanced.queue.providerMaxAttempts')}
                onchange={async (value) => { await settingsApplication.updateSettings({ providerMaxAttempts: value }); }}
            />
        </SettingItem>
    </SettingsSection>
    </Collapsible>
</div>

{#if showRebuildConfirm}
    <ConfirmModal
        title={i18n.t('settings.advanced.semanticIndexing.rebuildConfirmTitle')}
        message={i18n.t('settings.advanced.semanticIndexing.rebuildConfirmMessage')}
        confirmLabel={i18n.t('settings.advanced.semanticIndexing.rebuildConfirm')}
        cancelLabel={i18n.t('common.cancel')}
        onconfirm={() => void rebuildSemanticIndex()}
        oncancel={() => showRebuildConfirm = false}
    />
{/if}

{#if showVectorCleanupConfirm}
    <ConfirmModal
        title={i18n.t('settings.advanced.semanticIndexing.cleanupVectorFilesConfirmTitle')}
        message={i18n.t('settings.advanced.semanticIndexing.cleanupVectorFilesConfirmMessage')}
        confirmLabel={i18n.t('settings.advanced.semanticIndexing.cleanupVectorFilesConfirm')}
        cancelLabel={i18n.t('common.cancel')}
        onconfirm={() => void cleanupVectorFiles()}
        oncancel={() => showVectorCleanupConfirm = false}
    />
{/if}

<style>
    .cr-workflow-tab {
        display: flex;
        flex-direction: column;
    }

    /* The section component owns heading, spacing and separators. */
    .cr-workflow-tab :global(.cr-settings-section) {
        width: 100%;
    }

    .cr-rebuild-control {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--cr-space-2);
        min-height: 32px;
    }

    .cr-task-model-list { display: flex; flex-direction: column; gap: var(--cr-space-2); }

    .cr-rebuild-progress {
        color: var(--cr-text-muted);
        font-size: var(--cr-font-sm);
        white-space: nowrap;
    }

    .cr-index-status { display: flex; flex-direction: column; gap: var(--cr-space-2); padding: 0 var(--cr-space-3) var(--cr-space-3); color: var(--cr-text-muted); }
    .cr-missing-list { display: flex; flex-direction: column; gap: var(--cr-space-1); }
    .cr-missing-item { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto auto; gap: var(--cr-space-2); align-items: center; font-size: var(--cr-font-sm); }
    .cr-missing-item span { overflow-wrap: anywhere; }
    .cr-vector-status { display: flex; flex-direction: column; gap: var(--cr-space-2); padding: 0 var(--cr-space-3) var(--cr-space-3); color: var(--cr-text-muted); }
    .cr-vector-list { display: flex; flex-direction: column; gap: var(--cr-space-1); font-size: var(--cr-font-sm); overflow-wrap: anywhere; }
    @media (max-width: 700px) { .cr-missing-item { grid-template-columns: 1fr; } }
</style>
