<!--
  CreateSection.svelte — 工作台创建区

  职责：
  - 全宽输入框（含清除按钮、Enter 键触发 Define）与识别按钮
  - Define 等待计时与取消
  - Define 成功后显示类型置信度表格
  - 区块标题右侧放设置入口；当前笔记的操作在 CurrentNoteSection

-->
<script lang="ts">
    import { taskSettingsSummary } from '../../settings-summaries';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import TypeTable from './TypeTable.svelte';
    import type { DefinePreview, CRType } from '../../../types';
    import { confirmDefinePreview } from '../../../domain/concept';
    import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';
    import { onWorkbenchFocus, takeWorkbenchFocus } from '../../workbench-intent';

    let { onOpenSettings }: { onOpenSettings?: () => void } = $props();

    // 从 Context 获取服务
    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
    const application = ctx.application;
    const detailsToggleLabels = {
        expand: t.common.details.expand,
        collapse: t.common.details.collapse,
    };

    // 组件状态
    let inputValue = $state('');
    let editingInput = $state(false);
    let creating = $state(false);
    const product = t.workbench.product;
    let settings = $state(ctx.settingsApplication.getSettings());
    const unsubscribeSettings = ctx.settingsApplication.subscribeSettings(value => settings = value);
    $effect(() => () => unsubscribeSettings());
    const defineUnavailable = $derived(Boolean(settings.providers && settings.taskModels && taskSettingsSummary(settings, 'define').issue));
    let defining = $state(false);
    let defineElapsedSeconds = $state(0);
    let defineResult = $state<DefinePreview | null>(null);
    let feedback = $state<UiFeedback | null>(null);
    let defineAbortController: AbortController | undefined;
    $effect(() => () => defineAbortController?.abort('create panel unmounted'));
    // Freshly opened view: the user came here to type, so the cursor starts in
    // the concept field. Restored leaves never request focus.
    let inputEl = $state<HTMLInputElement | undefined>(undefined);
    function focusInput(): void {
        if (inputEl && inputEl.isConnected) inputEl.focus();
    }
    $effect(() => {
        if (takeWorkbenchFocus()) focusInput();
    });
    $effect(() => onWorkbenchFocus(focusInput));

    // 派生状态
    let hasInput = $derived(inputValue.trim().length > 0);

    /** 清空输入框和结果 */
    function clearInput(): void {
        inputValue = '';
        defineResult = null;
        editingInput = false;
        feedback = null;
    }

    function reportError(errorValue: unknown, fallback: string): void {
        feedback = toSafeErrorFeedback(errorValue, fallback);
    }

    /** 触发 Define 流程 */
    async function handleDefine(): Promise<void> {
        if (!hasInput || defining || defineUnavailable) return;

        defining = true;
        defineElapsedSeconds = 0;
        feedback = null;
        defineResult = null;
        const controller = new AbortController();
        defineAbortController = controller;
        const startedAt = Date.now();
        // The wait can run for tens of seconds, so show how long it has been
        // going instead of an indefinite spinner.
        const timer = window.setInterval(() => {
            defineElapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        }, 1000);

        try {
            const result = await application.create.define(inputValue.trim(), controller.signal);
            if (controller.signal.aborted) return;
            if (result.ok) {
                defineResult = result.value;
                editingInput = false;
            } else {
                reportError(result.error, t.workbench.notifications.defineFailed);
            }
        } catch (_error) {
            if (controller.signal.aborted) return;
            reportError(_error, t.workbench.notifications.defineFailed);
        } finally {
            window.clearInterval(timer);
            if (defineAbortController === controller) {
                defineAbortController = undefined;
                defining = false;
            }
        }
    }

    /**
     * 取消 Define：中止请求并清空输入。
     *
     * The user asked to drop this attempt, so the draft goes with it and no
     * error feedback is shown; a cancelled request is not a failure.
     */
    function cancelDefine(): void {
        const controller = defineAbortController;
        if (!controller) return;
        defineAbortController = undefined;
        defining = false;
        defineElapsedSeconds = 0;
        controller.abort('define cancelled by user');
        clearInput();
        focusInput();
    }

    /** 键盘事件：Enter 触发 Define */
    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Enter' && !e.isComposing && !e.defaultPrevented && hasInput && !defining) {
            e.preventDefault();
            void handleDefine();
        }
    }

    /** 选择类型并创建（TypeTable 回调） */
    async function handleCreateType(type: CRType): Promise<void> {
        if (!defineResult || creating) return;
        const confirmed = confirmDefinePreview(defineResult, type);
        if (!confirmed.ok) {
            reportError(confirmed.error, t.workbench.notifications.defineFailed);
            return;
        }
        creating = true;
        try {
            const result = await application.create.confirm(confirmed.value);
            if (result.ok) clearInput();
            else reportError(result.error, t.workbench.notifications.unknownFailure);
        } catch (error) { reportError(error, t.workbench.notifications.unknownFailure); }
        finally { creating = false; }
    }
</script>

<div class="cr-create-section">
    <div class="cr-section-header">
        <h2 class="cr-section-title">{product.newConcept}</h2>
        {#if onOpenSettings}
            <button type="button" class="clickable-icon cr-section-icon" aria-label={product.settingsAria} title={product.settings} onclick={onOpenSettings}><Icon name="settings" size={16} /></button>
        {/if}
    </div>
    {#if !defineResult || editingInput}
        <div class="cr-search-row">
            <div class="cr-search-field">
                <input id="cr-concept-input" class="cr-search-input" type="text" placeholder={product.placeholder}
                    bind:this={inputEl} bind:value={inputValue} oninput={() => defineResult = null} onkeydown={handleKeydown} disabled={defining || creating} aria-label={t.workbench.createConcept.placeholder} />
                {#if hasInput}<Button variant="ghost" size="icon" onclick={clearInput} disabled={defining || creating} ariaLabel={t.workbench.createConcept.clear}><Icon name="x" size={16} /></Button>{/if}
            </div>
            <Button variant="primary" disabled={!hasInput || creating || defineUnavailable} loading={defining} onclick={() => void handleDefine()} ariaLabel={t.workbench.createConcept.startButton}>{t.workbench.createConcept.startButton}</Button>
        </div>
        {#if defining}
            <!-- No live region: the counter changes every second and would talk
                 over the screen reader. The cancel button carries the label. -->
            <div class="cr-define-progress">
                <span class="cr-define-progress__elapsed">{ctx.i18n.format('workbench.createConcept.elapsed', { seconds: defineElapsedSeconds })}</span>
                <Button variant="secondary" size="sm" onclick={cancelDefine} ariaLabel={t.workbench.createConcept.cancel}>{t.workbench.createConcept.cancel}</Button>
            </div>
        {/if}
        {#if defineUnavailable}
            <!-- The hint is the only place the user learns why Define is dead.
                 The whole sentence is the entry point, not just a trailing
                 link: this is the first thing a new user has to act on. -->
            {#if onOpenSettings}
                <button type="button" class="cr-create-help cr-create-help--action" onclick={onOpenSettings} aria-label={`${product.notConfigured} ${product.openSettings}`}>
                    <span class="cr-create-help__text">{product.notConfigured}</span>
                    <span class="cr-create-help__cue">{product.openSettings} ›</span>
                </button>
            {:else}
                <p class="cr-create-help" role="status">{product.notConfigured}</p>
            {/if}
        {/if}
    {:else}
        <div class="cr-result-heading"><h2>{inputValue}</h2><button class="cr-text-action" type="button" disabled={creating} onclick={() => editingInput = true}>{product.editInput}</button></div>
        <TypeTable concept={defineResult} oncreate={handleCreateType} disabled={creating} />
    {/if}
    {#if feedback}<InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />{/if}
</div>

<style>
    .cr-create-section { min-width: 0; }
    .cr-result-heading h2 { font-size: var(--cr-font-base); font-weight: 600; line-height: 1.4; margin: 0; padding: 0; color: var(--cr-text-normal); overflow-wrap: anywhere; }
    .cr-search-row { display: flex; flex-direction: column; gap: 10px; }
    .cr-search-field { position: relative; min-width: 0; }
    .cr-search-field :global(.cr-btn-ghost) { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); }
    .cr-search-input { width: 100%; height: 42px; padding: 0 40px 0 12px; border: 1px solid var(--cr-border); border-radius: var(--cr-field-radius); background: var(--cr-bg-field); color: var(--cr-text-normal); font-size: var(--cr-font-sm); box-shadow: none; }
    .cr-search-input:focus { border-color: var(--cr-border-focus); }
    .cr-search-row :global(.cr-btn-primary) { width: 100%; min-height: 38px; border-radius: var(--cr-field-radius); }
    .cr-create-help { margin: var(--cr-space-3) 0 0; font-size: var(--cr-font-fine); line-height: 1.5; color: var(--cr-text-faint); }
    /* The whole sentence is the button; keep it reading as a hint but show the
       pointer and focus ring of an action. Obsidian buttons default to a fixed
       height and nowrap, which overflows narrow sidebars. */
    .cr-create-help--action { display: block; width: 100%; height: auto; padding: 0; white-space: normal; overflow-wrap: anywhere; border: 0; border-radius: var(--cr-field-radius); box-shadow: none; background: none; text-align: left; font: inherit; font-size: var(--cr-font-fine); line-height: 1.5; color: var(--cr-text-faint); cursor: pointer; }
    .cr-create-help--action:hover .cr-create-help__cue,
    .cr-create-help--action:focus-visible .cr-create-help__cue { text-decoration: underline; }
    .cr-create-help--action:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
    .cr-create-help__cue { margin-left: var(--cr-space-1); color: var(--cr-interactive-accent); }
    .cr-define-progress { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; }
    .cr-define-progress__elapsed { color: var(--cr-text-muted); font-size: var(--cr-font-xs); font-variant-numeric: tabular-nums; }
    .cr-result-heading { display: flex; align-items: baseline; gap: 12px; justify-content: space-between; margin-bottom: var(--cr-space-4); }
    .cr-result-heading h2 { min-width: 0; }
    .cr-text-action { flex-shrink: 0; height: auto; padding: 0; border: 0; box-shadow: none; background: none; color: var(--cr-interactive-accent); font-size: var(--cr-font-xs); }
</style>
