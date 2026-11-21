<!--
  维护页的结果区：重建结论、各项维护反馈、缺失向量与向量文件检查结果。
  原生设置行只放操作按钮；需要列表和二次操作的结果集中在这里，由同一控制器驱动。
-->
<script lang="ts">
    import { onDestroy, untrack } from 'svelte';
    import type { I18n } from '../../../core/i18n';
    import type { SettingsApplication } from '../../../app/settings-application';
    import type { MaintenanceController, MaintenanceState } from '../../settings/maintenance-controller';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import Button from '../../components/Button.svelte';

    let { controller: controllerProp, settingsApplication: applicationProp, i18n: i18nProp, onCleanupRequest }: {
        controller: MaintenanceController;
        settingsApplication: SettingsApplication;
        i18n: I18n;
        /** 清理多余向量文件前须经原生确认框。 */
        onCleanupRequest: () => void;
    } = $props();

    // 组件只挂载一次，属性在生命周期内不变；untrack 表明这是有意的单次读取。
    const { controller, settingsApplication, i18n } = untrack(() => ({ controller: controllerProp, settingsApplication: applicationProp, i18n: i18nProp }));
    const detailsToggleLabels = { expand: i18n.t('common.details.expand'), collapse: i18n.t('common.details.collapse') };
    let view = $state<MaintenanceState>(controller.getState());
    let rebuildState = $state(settingsApplication.getSemanticIndexRebuildState());
    let running = $state(controller.isRunning());
    const refreshRunning = () => { running = controller.isRunning(); };
    const unsubscribers = [
        controller.subscribe(value => { view = value; refreshRunning(); }),
        settingsApplication.subscribeSemanticIndexRebuildState(value => { rebuildState = value; refreshRunning(); }),
        settingsApplication.subscribeSaveState(refreshRunning),
    ];
    onDestroy(() => { for (const unsubscribe of unsubscribers) unsubscribe(); });
</script>

<div class="cr-maintenance-results">
    {#if rebuildState.status === 'completed' && rebuildState.summary}
        <InlineAlert level="success" message={i18n.format('settings.advanced.semanticIndexing.rebuildComplete', { indexed: rebuildState.summary.indexed, reused: rebuildState.summary.reused })} {detailsToggleLabels} />
    {:else if rebuildState.status === 'partial' && rebuildState.summary}
        <InlineAlert
            level="warning"
            message={rebuildState.summary.duplicateRefreshFailed
                ? i18n.format('settings.advanced.semanticIndexing.rebuildDuplicateFailed', { indexed: rebuildState.summary.indexed })
                : i18n.format('settings.advanced.semanticIndexing.rebuildPartial', { indexed: rebuildState.summary.indexed, skipped: rebuildState.summary.skipped })}
            {detailsToggleLabels}
        />
    {:else if rebuildState.status === 'cancelled'}
        <InlineAlert level="info" message={i18n.t('settings.advanced.semanticIndexing.rebuildCancelled')} {detailsToggleLabels} />
    {:else if rebuildState.status === 'failed'}
        <InlineAlert level="error" message={i18n.t('settings.advanced.semanticIndexing.rebuildFailed')} {detailsToggleLabels} />
    {/if}
    {#each [view.duplicateRebuildFeedback, view.missingEmbedFeedback, view.vectorCleanupFeedback] as feedback, index (index)}
        {#if feedback}<InlineAlert level={feedback.level} message={feedback.message} {detailsToggleLabels} />{/if}
    {/each}

    {#if view.indexStatus}
        <div class="cr-maintenance-block" role="status">
            <p>{i18n.format('settings.advanced.semanticIndexing.counts', { eligible: view.indexStatus.eligible, indexed: view.indexStatus.indexed, missing: view.indexStatus.missing })}</p>
            {#if view.indexStatus.missing > 0}
                <div class="cr-maintenance-actions">
                    <Button variant="secondary" size="sm" loading={view.missingEmbedRunning} disabled={running} onclick={() => void controller.embedMissing()}>{i18n.t('settings.advanced.semanticIndexing.embedMissing')}</Button>
                </div>
                <details class="cr-maintenance-details"><summary>{i18n.t('settings.redesign.missingDetails')}</summary>
                    <ul class="cr-maintenance-list">
                        {#each view.indexStatus.missingNotes as note (note.cruid)}
                            <li class="cr-missing-item">
                                <span class="cr-missing-item__name">{note.name}</span>
                                <span class="cr-missing-item__meta">{note.path} · {i18n.t(`crTypes.${note.type}`)} · {note.status}</span>
                                <Button variant="ghost" size="sm" disabled={view.missingEmbedRunning} onclick={() => void controller.embedOne(note.cruid)}>{i18n.t('settings.advanced.semanticIndexing.embedOne')}</Button>
                            </li>
                        {/each}
                    </ul>
                </details>
            {/if}
        </div>
    {/if}

    {#if view.vectorReport}
        {@const report = view.vectorReport}
        <div class="cr-maintenance-block" role="status">
            <p>{i18n.format('settings.advanced.semanticIndexing.vectorCounts', {
                indexedEntries: report.indexedEntries,
                physicalFiles: report.physicalFiles,
                orphaned: report.orphanFiles.length,
                missing: report.missingEntries.length,
                stale: report.staleEntries.length,
                invalid: report.invalidEntries.length,
            })}</p>
            {#if report.orphanFiles.length > 0}
                <div class="cr-maintenance-actions">
                    <Button variant="secondary" size="sm" loading={view.vectorCleanupRunning} disabled={running} onclick={onCleanupRequest}>{i18n.t('settings.advanced.semanticIndexing.cleanupVectorFiles')}</Button>
                </div>
                <details class="cr-maintenance-details"><summary>{i18n.t('settings.redesign.orphanDetails')}</summary>
                    <ul class="cr-maintenance-list">{#each report.orphanFiles as file (file.path)}<li>{file.path}</li>{/each}</ul>
                </details>
            {/if}
            {#each [
                { key: 'missingEntries', entries: report.missingEntries },
                { key: 'staleEntries', entries: report.staleEntries },
                { key: 'invalidEntries', entries: report.invalidEntries },
            ] as group (group.key)}
                {#if group.entries.length > 0}
                    <details class="cr-maintenance-details"><summary>{i18n.t(`settings.advanced.semanticIndexing.${group.key}`)}</summary>
                        <ul class="cr-maintenance-list">{#each group.entries as entry (`${entry.type}/${entry.uid}`)}<li>{entry.type}/{entry.uid}</li>{/each}</ul>
                    </details>
                {/if}
            {/each}
        </div>
    {/if}
</div>

<style>
    .cr-maintenance-results { display: flex; flex-direction: column; gap: var(--cr-space-3); width: 100%; min-width: 0; }
    .cr-maintenance-block { display: flex; flex-direction: column; gap: var(--cr-space-2); color: var(--cr-text-muted); font-size: var(--cr-font-sm); overflow-wrap: anywhere; }
    .cr-maintenance-block p { margin: 0; }
    .cr-maintenance-actions { display: flex; gap: var(--cr-space-2); flex-wrap: wrap; }
    .cr-maintenance-details summary { cursor: pointer; color: var(--cr-text-normal); }
    .cr-maintenance-list { margin: var(--cr-space-2) 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--cr-space-1); }
    .cr-missing-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 var(--cr-space-2); align-items: center; }
    .cr-missing-item__name { color: var(--cr-text-normal); }
    .cr-missing-item__meta { grid-row: 2; color: var(--cr-text-faint); font-size: var(--cr-font-xs); }
    .cr-missing-item :global(button) { grid-row: 1 / span 2; grid-column: 2; }
</style>
