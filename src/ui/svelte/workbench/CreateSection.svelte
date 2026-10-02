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
    import { extractFrontmatter } from '../../../core/frontmatter-utils';
    import type { TFile } from 'obsidian';
    import { getWorkbenchContext } from '../../bridge/context';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import SectionCard from '../../components/SectionCard.svelte';
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
        if (!hasInput || defining) return;

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
        if (!defineResult) return;
        const confirmed = confirmDefinePreview(defineResult, type);
        if (!confirmed.ok) {
            reportError(confirmed.error, t.workbench.notifications.defineFailed);
            return;
        }
        const result = await application.create.confirm(confirmed.value);
        if (result.ok) {
            clearInput();
        } else {
            reportError(result.error, t.workbench.notifications.unknownFailure);
        }
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

<!-- 搜索输入区 -->
<SectionCard>
    <div class="cr-create-section">
        <div class="cr-search-row">
            <input
                class="cr-search-input"
                type="text"
                placeholder={t.workbench.createConcept.placeholder}
                bind:value={inputValue}
                onkeydown={handleKeydown}
                disabled={defining}
                aria-label={t.workbench.createConcept.placeholder}
            />
            {#if hasInput}
                <Button
                    variant="ghost"
                    size="icon"
                    onclick={clearInput}
                    disabled={defining}
                    ariaLabel={t.workbench.createConcept.clear}
                >
                    <Icon name="x" size={16} />
                </Button>
            {/if}
            <Button
                variant="primary"
                disabled={!hasInput}
                loading={defining}
                onclick={() => void handleDefine()}
                ariaLabel={t.workbench.createConcept.startButton}
            >
                {t.workbench.createConcept.startButton}
            </Button>
        </div>

        <!-- 操作按钮行：仅在有活跃 Markdown 笔记时显示 -->
        {#if isMarkdown}
            <div class="cr-current-note"><span>{t.workbench.createConcept.currentNote}</span><strong title={activeFile?.path}>{activeFile?.basename ?? activeFile?.path.split('/').pop()?.replace(/\.md$/, '')}</strong></div>
            <div class="cr-action-grid">
                <Button
                    variant={activePanel === 'expand' ? 'primary' : 'secondary'}
                    size="sm"
                    onclick={() => togglePanel('expand')}
                >
                    {t.workbench.buttons.expand}
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    loading={verifying}
                    disabled={verifying}
                    onclick={() => void handleVerify()}
                >
                    {t.workbench.buttons.verify}
                </Button>
                {#if isCRNode}
                <Button
                    variant="secondary"
                    size="sm"
                    loading={generatingCards}
                    disabled={generatingCards}
                    onclick={() => void handleCards()}
                >
                    {t.cards.generate}
                </Button>
                {/if}
            </div>
        {:else}
            <div class="cr-hint-text">
                {t.workbench.buttons.openNoteHint}
            </div>
        {/if}
    </div>
</SectionCard>

<!-- Define 结果：类型置信度表格 -->
{#if defineResult}
    <TypeTable
        concept={defineResult}
        oncreate={handleCreateType}
    />
{/if}

<!-- 操作反馈 -->
{#if feedback}
    <InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />
{/if}

<!-- 内联展开面板区 -->
{#if isMarkdown}
    <InlinePanel expanded={activePanel === 'expand'} onclose={closePanel}>
        <ExpandPanel {activeFile} onclose={closePanel} />
    </InlinePanel>
{/if}

<style>
    .cr-create-section {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-3);
    }

    .cr-search-row {
        display: flex;
        align-items: center;
        gap: var(--cr-space-2);
    }

    .cr-search-input {
        flex: 1;
        min-width: 0;
        height: 40px;
        padding: 0 var(--cr-space-3);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md);
        background: var(--cr-bg-base);
        color: var(--cr-text-normal);
        font-size: var(--cr-font-base);
        outline: none;
        transition: border-color 0.15s;
    }

    .cr-search-input:focus {
        border-color: var(--cr-border-focus);
    }

    .cr-search-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* 操作按钮网格 */
    .cr-action-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: var(--cr-space-2);
    }

    .cr-current-note { display: flex; align-items: baseline; gap: var(--cr-space-2); min-width: 0; font-size: var(--cr-font-sm); }
    .cr-current-note span { flex-shrink: 0; color: var(--cr-text-muted); }
    .cr-current-note strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .cr-search-row :global(.cr-btn-primary) { min-height: 40px; flex-shrink: 0; }

    /* 引导文字 */
    .cr-hint-text {
        font-size: var(--cr-font-sm);
        color: var(--cr-text-muted);
        text-align: center;
        padding: var(--cr-space-2) 0;
    }

</style>
