<!--
  WelcomeStep.svelte — 向导欢迎步骤

  显示欢迎信息、功能亮点列表、语言选择和开始按钮。

  @see 需求 11.2, 11.3, 11.6
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import type { SettingsStore } from '../../../data/settings-store';
    import Button from '../../components/Button.svelte';
    import Select from '../../components/Select.svelte';

    let {
        onnext,
    }: {
        onnext: () => void;
    } = $props();

    const ctx = getCRContext();
    const i18n = ctx.i18n;
    const settingsStore = ctx.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore);

    /** 当前语言 */
    let language = $state(settingsStore.getSettings().language);

    /** 语言选项 */
    let languageOptions = $derived([
        { value: 'zh', label: i18n.t('setupWizard.welcome.languageOptionZh') },
        { value: 'en', label: i18n.t('setupWizard.welcome.languageOptionEn') },
    ]);

    /** 切换语言 */
    async function handleLanguageChange(value: string) {
        const lang = value as 'zh' | 'en';
        language = lang;
        await settingsStore.update({ language: lang });
        i18n.setLanguage(lang);
    }
</script>

<div class="cr-wizard-step">
    <h1 class="cr-wizard-title">{i18n.t('setupWizard.welcome.title')}</h1>
    <p class="cr-wizard-subtitle">{i18n.t('setupWizard.welcome.subtitle')}</p>

    <ul class="cr-wizard-features">
        <li>{i18n.t('setupWizard.welcome.featureDefineTagWrite')}</li>
        <li>{i18n.t('setupWizard.welcome.featureMergeAmend')}</li>
        <li>{i18n.t('setupWizard.welcome.featureVector')}</li>
    </ul>

    <div class="cr-wizard-language">
        <span class="cr-wizard-language__label">
            {i18n.t('setupWizard.welcome.languageName')}
        </span>
        <Select
            value={language}
            options={languageOptions}
            onchange={handleLanguageChange}
        />
    </div>

    <div class="cr-wizard-buttons">
        <Button variant="primary" onclick={onnext}>
            {i18n.t('setupWizard.actions.getStarted')}
        </Button>
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

    .cr-wizard-features {
        margin: var(--cr-space-2, 8px) 0;
        padding-left: var(--cr-space-5, 20px);
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2, 8px);
        color: var(--cr-text-normal);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.5;
    }

    .cr-wizard-language {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--cr-space-2, 8px) 0;
    }

    .cr-wizard-language__label {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-normal);
        font-weight: 500;
    }

    .cr-wizard-buttons {
        display: flex;
        justify-content: flex-end;
        gap: var(--cr-space-3, 12px);
        margin-top: var(--cr-space-3, 12px);
    }
</style>
