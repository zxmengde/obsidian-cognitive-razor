<!--
  CompleteStep.svelte — 向导完成步骤

  显示完成信息和"开始使用"按钮。

  @see 需求 11.2, 11.3, 11.6
-->
<script lang="ts">
    import { getCRContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';

    let {
        oncomplete,
    }: {
        oncomplete: () => void;
    } = $props();

    const ctx = getCRContext();
    const i18n = ctx.i18n;
</script>

<div class="cr-wizard-step cr-wizard-complete">
    <div class="cr-wizard-complete__icon" aria-hidden="true">✓</div>
    <h1 class="cr-wizard-title">{i18n.t('setupWizard.complete.title')}</h1>
    <p class="cr-wizard-subtitle">{i18n.t('setupWizard.complete.subtitle')}</p>

    <div class="cr-wizard-buttons cr-wizard-buttons--center">
        <Button variant="primary" onclick={oncomplete}>
            {i18n.t('setupWizard.actions.openWorkbench')}
        </Button>
    </div>
</div>

<style>
    .cr-wizard-step {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-3, 12px);
    }

    .cr-wizard-complete {
        align-items: center;
        text-align: center;
        padding: var(--cr-space-6, 24px) 0;
    }

    .cr-wizard-complete__icon {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--cr-interactive-accent);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        font-weight: 600;
        margin-bottom: var(--cr-space-2, 8px);
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

    .cr-wizard-buttons {
        margin-top: var(--cr-space-4, 16px);
    }

    .cr-wizard-buttons--center {
        display: flex;
        justify-content: center;
    }
</style>
