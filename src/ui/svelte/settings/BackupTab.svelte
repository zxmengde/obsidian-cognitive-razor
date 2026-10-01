<script lang="ts">
    import { getSettingsContext } from '../../bridge/context';
    import SettingItem from './SettingItem.svelte';
    import SettingsSection from './SettingsSection.svelte';
    import Button from '../../components/Button.svelte';
    import ConfirmModal from '../../components/ConfirmModal.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';

    const { i18n, settingsApplication } = getSettingsContext();
    const detailsToggleLabels = {
        expand: i18n.t('common.details.expand'),
        collapse: i18n.t('common.details.collapse'),
    };
    let showResetConfirm = $state(false);
    let importError = $state<string | undefined>();

    function exportSettings(): void {
        importError = undefined;
        const blob = new Blob([settingsApplication.exportSettings()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'cognitive-razor-settings.json';
        anchor.click();
        URL.revokeObjectURL(url);
    }

    function importSettings(): void {
        importError = undefined;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                await settingsApplication.importSettings(await file.text());
            } catch {
                importError = i18n.t('settings.importExport.importFailed');
            }
        };
        input.click();
    }

    async function resetSettings(): Promise<void> {
        showResetConfirm = false;
        await settingsApplication.resetAndStart();
    }
</script>

<SettingsSection title={i18n.t('settings.redesign.settingsBackup')}>
    {#if importError}
        <InlineAlert level="error" message={importError} {detailsToggleLabels} />
    {/if}
    <SettingItem
        name={i18n.t('settings.importExport.export')}
        description={i18n.t('settings.importExport.exportDesc')}
    >
        <Button variant="secondary" onclick={exportSettings}>
            {i18n.t('settings.importExport.export')}
        </Button>
    </SettingItem>
    <SettingItem
        name={i18n.t('settings.importExport.import')}
        description={i18n.t('settings.importExport.importDesc')}
    >
        <Button variant="secondary" onclick={importSettings}>
            {i18n.t('settings.importExport.import')}
        </Button>
    </SettingItem>
</SettingsSection>
<section class="cr-settings-danger">
    <h3>{i18n.t('settings.redesign.dangerZone')}</h3>
    <p>{i18n.t('settings.redesign.resetScope')}</p>
    <details>
        <summary>{i18n.t('settings.redesign.resetRecoveryTitle')}</summary>
        <p>{i18n.t('settings.redesign.resetBackupLocation')}</p>
        <p>{i18n.t('settings.redesign.resetInterruptedRecovery')}</p>
        <p>{i18n.t('settings.redesign.resetManualRecovery')}</p>
    </details>
    <Button variant="danger" onclick={() => showResetConfirm = true}>{i18n.t('settings.importExport.reset')}…</Button>
    <p class="cr-settings-hint">{i18n.t('settings.redesign.confirmAgain')}</p>
</section>

{#if showResetConfirm}
    <ConfirmModal
        title={i18n.t('confirmDialogs.resetSettings.title')}
        message={i18n.t('confirmDialogs.resetSettings.message')}
        confirmLabel={i18n.t('settings.importExport.reset')}
        cancelLabel={i18n.t('common.cancel')}
        danger={true}
        onconfirm={() => void resetSettings()}
        oncancel={() => showResetConfirm = false}
    />
{/if}

<style>
    .cr-settings-danger { margin-top: var(--cr-space-6); padding-top: var(--cr-space-4); border-top: 1px solid var(--cr-status-error); }
    .cr-settings-danger h3 { color: var(--cr-status-error); font-size: var(--font-ui-medium); }
    .cr-settings-danger p { color: var(--cr-text-muted); font-size: var(--cr-font-sm); line-height: 1.6; }
</style>
