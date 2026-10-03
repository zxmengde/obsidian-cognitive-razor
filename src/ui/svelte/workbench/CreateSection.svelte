<!--
  CreateSection.svelte — 工作台创建区

  职责：
  - 全宽搜索输入框（含清除/提交按钮、Enter 键触发 Define）
  - Define 加载状态（按钮动画 + 输入框禁用）
  - Define 成功后显示类型置信度表格
  - 操作按钮行（拓展、核查）
  - 无活跃笔记时隐藏按钮行显示引导文字

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

    /** 当前展开的面板类型 */
    type ActivePanel = 'none' | 'expand';

    let {
        activeFile,
    }: {
        activeFile: TFile | null;
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
    let intent = $state<'create' | 'note'>('create');
    let editingInput = $state(false);
    let creating = $state(false);
    const product = t.workbench.product;
    let settings = $state(ctx.settingsApplication.getSettings());
    const unsubscribeSettings = ctx.settingsApplication.subscribeSettings(value => settings = value);
    $effect(() => () => unsubscribeSettings());
    const defineUnavailable = $derived(Boolean(settings.providers && settings.taskModels && taskSettingsSummary(settings, 'define').issue));
    let defining = $state(false);
    let defineResult = $state<DefinePreview | null>(null);
    let feedback = $state<UiFeedback | null>(null);
    let feedbackSourcePath = $state<string | undefined>();
    $effect(() => {
        if (feedbackSourcePath && feedbackSourcePath !== activeFile?.path) {
            feedback = null;
            feedbackSourcePath = undefined;
        }
    });
    let activePanel = $state<ActivePanel>('none');
    let verifying = $state(false);
    let verifyWorkflowId: string | undefined;
    function clearFinishedVerifyNotice(): void {
        if (!verifyWorkflowId) return;
        const active = application.queue.getSnapshot().tasks.some(task => task.workflowId === verifyWorkflowId && (task.state === 'pending' || task.state === 'running'));
        if (active) return;
        verifyWorkflowId = undefined;
        if (feedback?.level === 'success' && feedback.message === t.workbench.notifications.verifyStarted) feedback = null;
    }
    let generatingCards = $state(false);
    let isCRNode = $state(false);
    let defineAbortController: AbortController | undefined;
    $effect(() => () => defineAbortController?.abort('create panel unmounted'));
    $effect(() => {
        const file = activeFile;
        let disposed = false;
        isCRNode = false;
        const refresh = async () => {
            if (!file || file.extension !== 'md') return;
            try {
                const content = await ctx.app.vault.cachedRead(file);
                if (!disposed) isCRNode = !!extractFrontmatter(content);
            } catch { if (!disposed) isCRNode = false; }
        };
        void refresh();
        const event = ctx.app.vault.on('modify', (changed) => { if (changed === file) void refresh(); });
        return () => { disposed = true; ctx.app.vault.offref(event); };
    });
    const unsubscribeQueue = application.queue.subscribe((event) => {
        clearFinishedVerifyNotice();
        if (event.type === 'task-completed' && event.task.stageId === 'cards') reportSuccess(ctx.i18n.format("cards.completed", { path: event.task.payload.targetPath }));
    });
    $effect(() => () => unsubscribeQueue());

    // 派生状态
    let hasInput = $derived(inputValue.trim().length > 0);
    let isMarkdown = $derived(activeFile?.extension === 'md');

    function handleIntentKey(event: KeyboardEvent): void {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        intent = event.key === 'Home' ? 'create' : event.key === 'End' ? 'note' : intent === 'create' ? 'note' : 'create';
        if (intent === 'create') closePanel();
        (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>(`#cr-intent-${intent}`)?.focus();
    }

    /** 切换面板：再次点击同一按钮则收起 */
    function togglePanel(panel: ActivePanel): void {
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
        feedbackSourcePath = undefined;
    }

    function reportError(errorValue: unknown, fallback: string): void {
        feedbackSourcePath = undefined;
        feedback = toSafeErrorFeedback(errorValue, fallback);
    }

    function reportSuccess(message: string): void {
        feedbackSourcePath = undefined;
        feedback = { level: 'success', message };
    }

    /** 触发 Define 流程 */
    async function handleDefine(): Promise<void> {
        if (!hasInput || defining || defineUnavailable) return;

        defining = true;
        feedback = null;
        feedbackSourcePath = undefined;
        defineResult = null;
        const controller = new AbortController();
        defineAbortController = controller;

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
            if (defineAbortController === controller) {
                defineAbortController = undefined;
                defining = false;
            }
        }
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
        if (!activeFile || verifying) return;
        const filePath = activeFile.path;
        verifying = true;
        feedback = null;
        feedbackSourcePath = undefined;
        try {
            const result = await application.verify.start(filePath);
            if (result.ok) {
                verifyWorkflowId = result.value;
                reportSuccess(t.workbench.notifications.verifyStarted);
                // A fast task can finish before start() resolves.
                clearFinishedVerifyNotice();
            } else {
                reportError(result.error, t.workbench.notifications.unknownFailure);
            }
        } catch (e) {
            reportError(e, t.workbench.notifications.unknownFailure);
        } finally {
            verifying = false;
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
        generatingCards = true;
        feedback = null;
        feedbackSourcePath = undefined;
        try {
            const result = await application.cards.start(path);
            if (result.ok) reportSuccess(ctx.i18n.format("cards.queued", { path: result.value }));
            else if (result.error.code === "E401_PROVIDER_NOT_CONFIGURED") feedback = { level: "error", message: t.cards.configureFirst };
            else {
                reportError(result.error, t.cards.failed);
                if (result.error.code === "E103_CARDS_SOURCE_OUTSIDE_ROOT") feedbackSourcePath = path;
            }
        } catch (error) { reportError(error, t.cards.failed); }
        finally { generatingCards = false; }
    }
</script>

<div class="cr-create-section">
    <div class="cr-intent-switch" role="tablist" aria-label={product.title}>
        <button id="cr-intent-create" type="button" role="tab" tabindex={intent === 'create' ? 0 : -1} onkeydown={handleIntentKey} aria-selected={intent === 'create'} aria-controls="cr-intent-create-panel" class:active={intent === 'create'} onclick={() => { intent = 'create'; closePanel(); }}>{product.newConcept}</button>
        <button id="cr-intent-note" type="button" role="tab" tabindex={intent === 'note' ? 0 : -1} onkeydown={handleIntentKey} aria-selected={intent === 'note'} aria-controls="cr-intent-note-panel" class:active={intent === 'note'} onclick={() => intent = 'note'}>{product.currentNote}</button>
    </div>
    <div id="cr-intent-create-panel" role="tabpanel" aria-labelledby="cr-intent-create" hidden={intent !== 'create'}>
        {#if !defineResult || editingInput}
            <h2 class="cr-create-heading">{product.prompt}</h2>
            <p class="cr-create-intro">{product.intro}</p>
            <div class="cr-search-row">
                <div class="cr-search-field">
                    <input id="cr-concept-input" class="cr-search-input" type="text" placeholder={product.placeholder}
                        bind:value={inputValue} oninput={() => defineResult = null} onkeydown={handleKeydown} disabled={defining || creating} aria-label={t.workbench.createConcept.placeholder} />
                    {#if hasInput}<Button variant="ghost" size="icon" onclick={clearInput} disabled={defining || creating} ariaLabel={t.workbench.createConcept.clear}><Icon name="x" size={16} /></Button>{/if}
                </div>
                <Button variant="primary" disabled={!hasInput || creating || defineUnavailable} loading={defining} onclick={() => void handleDefine()} ariaLabel={t.workbench.createConcept.startButton}>{t.workbench.createConcept.startButton}</Button>
            </div>
            <p class="cr-create-help" role="status">{defineUnavailable ? product.notConfigured : product.afterIdentify}</p>
        {:else}
            <div class="cr-result-heading"><h2>{inputValue}</h2><button class="cr-text-action" type="button" disabled={creating} onclick={() => editingInput = true}>{product.editInput}</button></div>
            <TypeTable concept={defineResult} oncreate={handleCreateType} disabled={creating} />
        {/if}
    </div>
    <div id="cr-intent-note-panel" role="tabpanel" aria-labelledby="cr-intent-note" hidden={intent !== 'note'}>
        {#if isMarkdown}
            <div class="cr-current-note"><h2>{activeFile?.basename ?? activeFile?.path.split('/').pop()?.replace(/\.md$/, '')}</h2><p>{activeFile?.path.includes('/') ? activeFile.path.slice(0, activeFile.path.lastIndexOf('/')) : product.rootFolder}</p></div>
            <div class="cr-note-actions">
                <button class="cr-btn-secondary cr-note-action" type="button" aria-expanded={activePanel === 'expand'} title={product.expandDesc} onclick={() => togglePanel('expand')}>{product.expandTitle}</button>
                <button class="cr-btn-secondary cr-note-action" type="button" disabled={verifying} aria-busy={verifying ? 'true' : undefined} onclick={() => void handleVerify()} aria-label={t.workbench.buttons.verify} title={product.verifyDesc}>{#if verifying}<span class="cr-loading-spinner" aria-hidden="true"></span>{/if}{t.workbench.buttons.verify}</button>
                {#if isCRNode}
                    <button class="cr-btn-secondary cr-note-action" type="button" disabled={generatingCards} aria-busy={generatingCards ? 'true' : undefined} onclick={() => void handleCards()} aria-label={t.cards.generate} title={product.cardsDesc}>{#if generatingCards}<span class="cr-loading-spinner" aria-hidden="true"></span>{/if}{t.cards.generate}</button>
                {:else}<p class="cr-note-ineligible">{product.nonConcept}</p>{/if}
            </div>
        {:else}<p class="cr-note-empty">{product.noNote}</p>{/if}
    </div>
</div>
{#if feedback}<InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />{/if}
{#if isMarkdown && intent === 'note'}<InlinePanel expanded={activePanel === 'expand'} onclose={closePanel}><ExpandPanel {activeFile} onclose={closePanel} /></InlinePanel>{/if}

<style>
    .cr-create-section { min-width: 0; }
    [hidden] { display: none; }
    .cr-intent-switch { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; gap: 3px; min-height: 36px; border-radius: var(--cr-field-radius); background: var(--cr-bg-secondary); margin-bottom: 26px; }
    .cr-intent-switch button { height: auto; min-height: 30px; width: 100%; padding: 4px 8px; border: 0; box-shadow: none; background: transparent; border-radius: 5px; color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
    .cr-intent-switch button.active { background: var(--cr-bg-selected); color: var(--cr-text-normal); font-weight: 600; }
    h2 { font-size: var(--cr-heading-workbench); line-height: 1.4; margin: 0; padding: 0; color: var(--cr-text-normal); overflow-wrap: anywhere; }
    .cr-create-intro, .cr-current-note p { margin: 8px 0 21px; font-size: var(--cr-font-xs); color: var(--cr-text-muted); line-height: 1.7; overflow-wrap: anywhere; }
    .cr-search-row { display: flex; flex-direction: column; gap: 10px; }
    .cr-search-field { position: relative; min-width: 0; }
    .cr-search-field :global(.cr-btn-ghost) { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); }
    .cr-search-input { width: 100%; height: 42px; padding: 0 40px 0 12px; border: 1px solid var(--cr-border); border-radius: var(--cr-field-radius); background: var(--cr-bg-field); color: var(--cr-text-normal); font-size: var(--cr-font-sm); box-shadow: none; }
    .cr-search-input:focus { border-color: var(--cr-border-focus); }
    .cr-search-row :global(.cr-btn-primary) { width: 100%; min-height: 38px; border-radius: var(--cr-field-radius); }
    .cr-create-help { margin: 16px 0 0; font-size: var(--cr-font-fine); line-height: 1.7; color: var(--cr-text-faint); }
    .cr-result-heading { display: flex; align-items: baseline; gap: 12px; justify-content: space-between; margin-bottom: 24px; }
    .cr-result-heading h2 { min-width: 0; }
    .cr-text-action { flex-shrink: 0; height: auto; padding: 0; border: 0; box-shadow: none; background: none; color: var(--cr-interactive-accent); font-size: var(--cr-font-xs); }
    .cr-current-note p { margin-bottom: 15px; }
    .cr-note-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .cr-note-action { width: auto; max-width: 100%; min-height: 32px; padding: 6px 10px; border-radius: var(--cr-field-radius); font-size: var(--cr-font-sm); font-weight: 600; overflow-wrap: anywhere; }
    .cr-note-empty, .cr-note-ineligible { color: var(--cr-text-muted); font-size: var(--cr-font-xs); line-height: 1.7; margin: 14px 0; }
</style>
