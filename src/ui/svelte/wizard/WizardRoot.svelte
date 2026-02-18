<!--
  WizardRoot.svelte — 首次配置向导根组件

  分步导航 + 进度指示器，管理 4 个步骤的切换：
  Welcome → Provider → Directory → Complete

  @see 需求 11.1, 11.2, 11.3
-->
<script lang="ts">
    import type CognitiveRazorPlugin from '../../../../main';
    import { setCRContext, getCRContext } from '../../bridge/context';
    import WelcomeStep from './WelcomeStep.svelte';
    import ProviderStep from './ProviderStep.svelte';
    import DirectoryStep from './DirectoryStep.svelte';
    import CompleteStep from './CompleteStep.svelte';

    /** 步骤枚举 */
    type WizardStepId = 'welcome' | 'provider' | 'directory' | 'complete';

    let {
        plugin,
        oncomplete,
    }: {
        plugin: CognitiveRazorPlugin;
        oncomplete: () => void;
    } = $props();

    // 设置 Context，供子组件通过 getCRContext() 获取
    const components = plugin.getComponents();
    setCRContext({
        container: components.container,
        i18n: components.i18n,
        app: plugin.app,
    });

    const ctx = getCRContext();
    const i18n = ctx.i18n;

    /** 步骤定义 */
    const STEPS: WizardStepId[] = ['welcome', 'provider', 'directory', 'complete'];

    /** 当前步骤 */
    let currentStep = $state<WizardStepId>('welcome');

    /** 当前步骤索引 */
    let currentIndex = $derived(STEPS.indexOf(currentStep));

    /** 步骤标签（i18n） */
    let stepLabels = $derived([
        i18n.t('setupWizard.steps.welcome'),
        i18n.t('setupWizard.steps.provider'),
        i18n.t('setupWizard.steps.directory'),
        i18n.t('setupWizard.steps.complete'),
    ]);

    /** 导航到下一步 */
    function goNext() {
        const idx = STEPS.indexOf(currentStep);
        if (idx < STEPS.length - 1) {
            currentStep = STEPS[idx + 1];
        }
    }

    /** 导航到上一步 */
    function goBack() {
        const idx = STEPS.indexOf(currentStep);
        if (idx > 0) {
            currentStep = STEPS[idx - 1];
        }
    }

    /** 完成向导 */
    function handleComplete() {
        oncomplete();
    }
</script>

<div class="cr-wizard">
    <!-- 进度指示器 -->
    <div class="cr-wizard-progress" role="navigation" aria-label="Wizard steps">
        {#each STEPS as step, i (step)}
            <div
                class="cr-wizard-progress__step"
                class:is-active={i === currentIndex}
                class:is-done={i < currentIndex}
                aria-current={i === currentIndex ? 'step' : undefined}
            >
                <span class="cr-wizard-progress__dot">
                    {#if i < currentIndex}
                        ✓
                    {:else}
                        {i + 1}
                    {/if}
                </span>
                <span class="cr-wizard-progress__label">{stepLabels[i]}</span>
            </div>
            {#if i < STEPS.length - 1}
                <div
                    class="cr-wizard-progress__line"
                    class:is-done={i < currentIndex}
                ></div>
            {/if}
        {/each}
    </div>

    <!-- 步骤内容 -->
    <div class="cr-wizard-content">
        {#if currentStep === 'welcome'}
            <WelcomeStep onnext={goNext} />
        {:else if currentStep === 'provider'}
            <ProviderStep onnext={goNext} onback={goBack} />
        {:else if currentStep === 'directory'}
            <DirectoryStep onnext={goNext} onback={goBack} />
        {:else if currentStep === 'complete'}
            <CompleteStep oncomplete={handleComplete} />
        {/if}
    </div>
</div>

<style>
    .cr-wizard {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-6, 24px);
        padding: var(--cr-space-4, 16px) 0;
    }

    /* 进度指示器 */
    .cr-wizard-progress {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        padding: 0 var(--cr-space-4, 16px);
    }

    .cr-wizard-progress__step {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cr-space-1, 4px);
        flex-shrink: 0;
    }

    .cr-wizard-progress__dot {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        border: 2px solid var(--cr-border);
        color: var(--cr-text-muted);
        background: var(--cr-bg-base);
        transition: all 0.2s ease;
    }

    .cr-wizard-progress__step.is-active .cr-wizard-progress__dot {
        border-color: var(--cr-interactive-accent);
        color: var(--cr-interactive-accent);
        background: var(--cr-bg-accent-muted, rgba(var(--cr-accent-rgb, 99, 102, 241), 0.1));
    }

    .cr-wizard-progress__step.is-done .cr-wizard-progress__dot {
        border-color: var(--cr-interactive-accent);
        background: var(--cr-interactive-accent);
        color: white;
    }

    .cr-wizard-progress__label {
        font-size: 11px;
        color: var(--cr-text-faint);
        white-space: nowrap;
    }

    .cr-wizard-progress__step.is-active .cr-wizard-progress__label {
        color: var(--cr-text-normal);
        font-weight: 500;
    }

    .cr-wizard-progress__line {
        flex: 1;
        height: 2px;
        background: var(--cr-border);
        margin: 0 var(--cr-space-2, 8px);
        margin-bottom: 20px;
        min-width: 24px;
        transition: background 0.2s ease;
    }

    .cr-wizard-progress__line.is-done {
        background: var(--cr-interactive-accent);
    }

    /* 步骤内容区 */
    .cr-wizard-content {
        padding: 0 var(--cr-space-2, 8px);
    }
</style>
