<!--
  CreateSection.svelte — 工作台创建区

  职责：
  - 全宽搜索输入框（含清除/提交按钮、Enter 键触发 Define）
  - Define 加载状态（按钮动画 + 输入框禁用）
  - Define 成功后显示类型置信度表格
  - 常显输入区和当前笔记操作行（拓展、核查、卡片），无需切换模式
  - 无活跃笔记或不适用时禁用对应按钮，保留原执行校验

-->
<script lang="ts">
    import { taskSettingsSummary } from '../../settings-summaries';
    import { extractFrontmatter } from '../../../core/frontmatter-utils';
    import type { TFile } from 'obsidian';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import InlinePanel from '../../components/InlinePanel.svelte';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import TypeTable from './TypeTable.svelte';
    import ExpandPanel from './ExpandPanel.svelte';
    import type { DefinePreview, CRType } from '../../../types';
    import { confirmDefinePreview } from '../../../domain/concept';
    import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';
    import { showActionFeedback } from '../../feedback';
    import { onWorkbenchFocus, onWorkbenchPanel, takeWorkbenchFocus, takeWorkbenchPanel, type WorkbenchPanelIntent } from '../../workbench-intent';

    /** 当前展开的面板类型 */
    type ActivePanel = 'none' | 'expand';

    let {
        activeFile,
        onOpenSettings,
    }: {
        activeFile: TFile | null;
        onOpenSettings?: () => void;
    } = $props();

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
    let activePanel = $state<ActivePanel>('none');
    let verifying = $state(false);
    let generatingCards = $state(false);
    let isCRNode = $state(false);
    let noteGeneration = 0;
    let mounted = true;
    $effect(() => () => { mounted = false; noteGeneration++; });
    let defineAbortController: AbortController | undefined;
    $effect(() => () => defineAbortController?.abort('create panel unmounted'));
    $effect(() => {
        const file = activeFile;
        let disposed = false;
        let refreshSequence = 0;
        noteGeneration++;
        verifying = false;
        generatingCards = false;
        activePanel = 'none';
        isCRNode = false;
        const refresh = async () => {
            const sequence = ++refreshSequence;
            isCRNode = false;
            if (!file || file.extension !== 'md') return;
            try {
                const content = await ctx.app.vault.cachedRead(file);
                if (!disposed && sequence === refreshSequence) isCRNode = !!extractFrontmatter(content);
            } catch { if (!disposed && sequence === refreshSequence) isCRNode = false; }
        };
        void refresh();
        const event = ctx.app.vault.on('modify', (changed) => { if (changed === file) void refresh(); });
        return () => { disposed = true; ctx.app.vault.offref(event); };
    });
    // Task outcomes are announced once per workbench by the runtime, so this
    // panel no longer subscribes on its own.
    // A command asks for the expand panel before the view exists; honour that
    // request once the note's frontmatter has been read.
    let requestedPanel = $state<WorkbenchPanelIntent | undefined>(undefined);
    $effect(() => {
        if (requestedPanel === 'expand' && isCRNode) {
            requestedPanel = undefined;
            activePanel = 'expand';
        }
    });
    $effect(() => onWorkbenchPanel((panel) => { requestedPanel = panel; }));
    $effect(() => {
        const pending = takeWorkbenchPanel();
        if (pending) requestedPanel = pending;
    });
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
    let isMarkdown = $derived(activeFile?.extension === 'md');
    const actionUnavailable = $derived(!isMarkdown ? product.noNote : !isCRNode ? product.nonConcept : undefined);

    /** 切换面板：再次点击同一按钮则收起 */
    function togglePanel(panel: ActivePanel): void {
        if (!isCRNode) return;
        activePanel = activePanel === panel ? 'none' : panel;
    }

    /** 关闭当前面板 */
    function closePanel(): void {
        activePanel = 'none';
    }

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

    /** 触发 Verify 流程 */
    async function handleVerify(): Promise<void> {
        if (!activeFile || !isCRNode || verifying) return;
        const filePath = activeFile.path;
        const generation = noteGeneration;
        verifying = true;
        try {
            const result = await application.verify.start(filePath);
            if (!mounted) return;
            if (result.ok) {
                showActionFeedback({ level: 'success', message: t.workbench.notifications.verifyStarted }, filePath);
            } else {
                showActionFeedback(toSafeErrorFeedback(result.error, t.workbench.notifications.unknownFailure), filePath);
            }
        } catch (e) {
            if (mounted) showActionFeedback(toSafeErrorFeedback(e, t.workbench.notifications.unknownFailure), filePath);
        } finally {
            if (generation === noteGeneration) verifying = false;
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

    async function handleCards(): Promise<void> {
        if (!activeFile || !isCRNode || generatingCards) return;
        const path = activeFile.path;
        const generation = noteGeneration;
        generatingCards = true;
        try {
            const result = await application.cards.start(path);
            if (!mounted) return;
            if (result.ok) showActionFeedback({ level: 'success', message: ctx.i18n.format("cards.queued", { path: result.value }) }, path);
            else showActionFeedback(result.error.code === "E401_PROVIDER_NOT_CONFIGURED"
                ? { level: 'error', message: t.cards.configureFirst } : toSafeErrorFeedback(result.error, t.cards.failed), path);
        } catch (error) { if (mounted) showActionFeedback(toSafeErrorFeedback(error, t.cards.failed), path); }
        finally { if (generation === noteGeneration) generatingCards = false; }
    }
</script>

<div class="cr-create-section">
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
    <div class="cr-note-actions">
        <button class="cr-btn-secondary cr-note-action" type="button" disabled={!isCRNode} aria-expanded={activePanel === 'expand'} title={actionUnavailable ?? product.expandDesc} onclick={() => togglePanel('expand')}>{product.expandTitle}</button>
        <button class="cr-btn-secondary cr-note-action" type="button" disabled={!isCRNode || verifying} aria-busy={verifying ? 'true' : undefined} onclick={() => void handleVerify()} aria-label={t.workbench.buttons.verify} title={actionUnavailable ?? product.verifyDesc}>{#if verifying}<span class="cr-loading-spinner" aria-hidden="true"></span>{/if}{t.workbench.buttons.verify}</button>
        <button class="cr-btn-secondary cr-note-action" type="button" disabled={!isCRNode || generatingCards} aria-busy={generatingCards ? 'true' : undefined} onclick={() => void handleCards()} aria-label={t.cards.generate} title={actionUnavailable ?? product.cardsDesc}>{#if generatingCards}<span class="cr-loading-spinner" aria-hidden="true"></span>{/if}{t.cards.generate}</button>
    </div>
</div>
{#if isCRNode}<InlinePanel expanded={activePanel === 'expand'} onclose={closePanel}><ExpandPanel {activeFile} onclose={closePanel} /></InlinePanel>{/if}

<style>
    .cr-create-section { min-width: 0; }
    h2 { font-size: var(--cr-heading-workbench); line-height: 1.4; margin: 0; padding: 0; color: var(--cr-text-normal); overflow-wrap: anywhere; }
    .cr-search-row { display: flex; flex-direction: column; gap: 10px; }
    .cr-search-field { position: relative; min-width: 0; }
    .cr-search-field :global(.cr-btn-ghost) { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); }
    .cr-search-input { width: 100%; height: 42px; padding: 0 40px 0 12px; border: 1px solid var(--cr-border); border-radius: var(--cr-field-radius); background: var(--cr-bg-field); color: var(--cr-text-normal); font-size: var(--cr-font-sm); box-shadow: none; }
    .cr-search-input:focus { border-color: var(--cr-border-focus); }
    .cr-search-row :global(.cr-btn-primary) { width: 100%; min-height: 38px; border-radius: var(--cr-field-radius); }
    .cr-create-help { margin: 16px 0 0; font-size: var(--cr-font-fine); line-height: 1.7; color: var(--cr-text-faint); }
    /* The whole sentence is the button; keep it reading as a hint but show the
       pointer and focus ring of an action. */
    .cr-create-help--action { display: block; width: 100%; padding: 0; border: 0; border-radius: var(--cr-field-radius); box-shadow: none; background: none; text-align: left; font: inherit; font-size: var(--cr-font-fine); line-height: 1.7; color: var(--cr-text-faint); cursor: pointer; }
    .cr-create-help--action:hover .cr-create-help__cue,
    .cr-create-help--action:focus-visible .cr-create-help__cue { text-decoration: underline; }
    .cr-create-help--action:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
    .cr-create-help__cue { margin-left: var(--cr-space-1); color: var(--cr-interactive-accent); }
    .cr-define-progress { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; }
    .cr-define-progress__elapsed { color: var(--cr-text-muted); font-size: var(--cr-font-xs); font-variant-numeric: tabular-nums; }
    .cr-result-heading { display: flex; align-items: baseline; gap: 12px; justify-content: space-between; margin-bottom: 24px; }
    .cr-result-heading h2 { min-width: 0; }
    .cr-text-action { flex-shrink: 0; height: auto; padding: 0; border: 0; box-shadow: none; background: none; color: var(--cr-interactive-accent); font-size: var(--cr-font-xs); }
    .cr-note-actions { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); align-items: center; gap: 8px; margin-top: 16px; }
    .cr-note-action { width: 100%; min-width: 0; min-height: 32px; padding: 6px; box-sizing: border-box; border-radius: var(--cr-field-radius); font-size: var(--cr-font-sm); font-weight: 600; overflow-wrap: anywhere; }
</style>
