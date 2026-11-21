<!--
  CurrentNoteSection.svelte — 工作台「当前笔记」区

  职责：
  - 标明操作对象：当前笔记的名称、类型与状态
  - 拓展、核查、生成卡片三项操作，以及拓展面板与核查问题列表
  - 当前文件不是知识节点时只显示一行说明，不摆出一排禁用按钮
  - 核查与卡片的可用性与识别概念同一规则：对应任务没有可用模型时禁用并说明
-->
<script lang="ts">
    import type { CachedMetadata, TFile } from 'obsidian';
    import { getWorkbenchContext } from '../../bridge/context';
    import { extractFrontmatter } from '../../../core/frontmatter-utils';
    import type { CRFrontmatter } from '../../../types';
    import { taskSettingsSummary } from '../../settings-summaries';
    import InlinePanel from '../../components/InlinePanel.svelte';
    import ExpandPanel from './ExpandPanel.svelte';
    import VerifyIssuesPanel from './VerifyIssuesPanel.svelte';
    import { toSafeErrorFeedback } from '../../error-feedback';
    import { showActionFeedback } from '../../feedback';
    import { onWorkbenchPanel, takeWorkbenchPanel, type WorkbenchPanelIntent } from '../../workbench-intent';

    let { activeFile, onOpenSettings }: { activeFile: TFile | null; onOpenSettings?: () => void } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages;
    const product = t.workbench.product;
    const application = ctx.application;

    let settings = $state(ctx.settingsApplication.getSettings());
    const unsubscribeSettings = ctx.settingsApplication.subscribeSettings(value => settings = value);
    $effect(() => () => unsubscribeSettings());
    // 与创建区同一判定：设置尚未载入模型配置时不预先拦截，执行入口仍会校验。
    const unavailable = (task: 'define' | 'verify' | 'cards') => Boolean(settings.providers && settings.taskModels && taskSettingsSummary(settings, task).issue);
    const verifyUnavailable = $derived(unavailable('verify'));
    const cardsUnavailable = $derived(unavailable('cards'));
    /** 识别概念不可用时创建区已给出设置入口，这里不再重复同一提示。 */
    const defineUnavailable = $derived(unavailable('define'));

    let node = $state<CRFrontmatter | null>(null);
    /** 切换笔记后、读到 frontmatter 前：保留操作区并暂时禁用，避免在两篇知识节点之间来回闪烁。 */
    let judging = $state(false);
    let expandOpen = $state(false);
    let verifying = $state(false);
    let generatingCards = $state(false);
    let noteGeneration = 0;
    let mounted = true;
    $effect(() => () => { mounted = false; noteGeneration++; });

    $effect(() => {
        const file = activeFile;
        let disposed = false;
        let refreshSequence = 0;
        noteGeneration++;
        verifying = false;
        generatingCards = false;
        expandOpen = false;
        node = null;
        judging = false;
        // 只解析 frontmatter 段；正文编辑不改变它时直接沿用上次结论。
        let lastFrontmatter: string | undefined;
        const judge = (content: string, cache: CachedMetadata | null): void => {
            const end = cache?.frontmatterPosition?.end.offset;
            const head = end === undefined ? content : content.slice(0, end);
            judging = false;
            if (head === lastFrontmatter) return;
            lastFrontmatter = head;
            node = extractFrontmatter(head)?.frontmatter ?? null;
        };
        // 元数据缓存已确认没有 cruid 时，严格解析必然失败，不必读文件。
        const lacksCruid = (cache: CachedMetadata | null): boolean =>
            cache !== null && typeof cache.frontmatter?.cruid !== 'string';
        const initial = async () => {
            const sequence = ++refreshSequence;
            if (!file || file.extension !== 'md') return;
            const cache = ctx.app.metadataCache.getFileCache(file);
            if (lacksCruid(cache)) return;
            judging = true;
            try {
                const content = await ctx.app.vault.cachedRead(file);
                if (!disposed && sequence === refreshSequence) judge(content, cache);
            } catch { if (!disposed && sequence === refreshSequence) { node = null; judging = false; } }
        };
        void initial();
        // changed 事件自带解析后的正文与缓存，只在当前笔记重新解析后触发，不再读文件。
        const event = ctx.app.metadataCache.on('changed', (changed, data, cache) => {
            if (changed !== file || disposed) return;
            refreshSequence++;
            if (lacksCruid(cache)) { lastFrontmatter = undefined; node = null; judging = false; return; }
            judge(data, cache);
        });
        return () => { disposed = true; ctx.app.metadataCache.offref(event); };
    });

    const isCRNode = $derived(node !== null && !judging);
    const isMarkdown = $derived(activeFile?.extension === 'md');

    // 命令可能在视图创建前请求拓展面板；读到 frontmatter 后再兑现一次。
    let requestedPanel = $state<WorkbenchPanelIntent | undefined>(undefined);
    $effect(() => {
        if (requestedPanel === 'expand' && isCRNode) {
            requestedPanel = undefined;
            expandOpen = true;
        }
    });
    $effect(() => onWorkbenchPanel((panel) => { requestedPanel = panel; }));
    $effect(() => {
        const pending = takeWorkbenchPanel();
        if (pending) requestedPanel = pending;
    });

    async function handleVerify(): Promise<void> {
        if (!activeFile || !isCRNode || verifying || verifyUnavailable) return;
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

    async function handleCards(): Promise<void> {
        if (!activeFile || !isCRNode || generatingCards || cardsUnavailable) return;
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

<div class="cr-current-note">
    <div class="cr-section-header">
        <h2 class="cr-section-title">{product.currentNote}</h2>
    </div>
    {#if !isMarkdown || (!node && !judging)}
        <p class="cr-section-hint">{isMarkdown ? product.notNodeHint : product.noNoteHint}</p>
    {:else}
        <div class="cr-current-note__identity">
            {#if node && !judging}
                <span class="cr-current-note__name">{node.name || activeFile?.basename}</span>
                <span class="cr-current-note__meta">{t.crTypes[node.type]} · {product.noteStates[node.status]}</span>
            {:else}
                <span class="cr-current-note__name">{activeFile?.basename ?? ''}</span>
            {/if}
        </div>
        <div class="cr-note-actions">
            <button class="cr-btn-secondary cr-note-action" type="button" disabled={!isCRNode} aria-expanded={expandOpen} title={product.expandDesc} onclick={() => expandOpen = !expandOpen}>{product.expandTitle}</button>
            <button class="cr-btn-secondary cr-note-action" type="button" disabled={!isCRNode || verifying || verifyUnavailable} aria-busy={verifying ? 'true' : undefined} aria-label={t.workbench.buttons.verify}
                title={verifyUnavailable ? product.noteActionsUnavailable : product.verifyDesc} onclick={() => void handleVerify()}>
                {#if verifying}<span class="cr-loading-spinner" aria-hidden="true"></span>{/if}{t.workbench.buttons.verify}
            </button>
            <button class="cr-btn-secondary cr-note-action" type="button" disabled={!isCRNode || generatingCards || cardsUnavailable} aria-busy={generatingCards ? 'true' : undefined} aria-label={t.cards.generate}
                title={cardsUnavailable ? product.noteActionsUnavailable : product.cardsDesc} onclick={() => void handleCards()}>
                {#if generatingCards}<span class="cr-loading-spinner" aria-hidden="true"></span>{/if}{t.cards.generate}
            </button>
        </div>
        {#if (verifyUnavailable || cardsUnavailable) && !defineUnavailable}
            <p class="cr-section-hint">
                {product.noteActionsUnavailable}
                {#if onOpenSettings}<button type="button" class="cr-text-action" onclick={onOpenSettings}>{product.openSettings}</button>{/if}
            </p>
        {/if}
        {#if isCRNode}
            <InlinePanel expanded={expandOpen} onclose={() => expandOpen = false}><ExpandPanel {activeFile} onclose={() => expandOpen = false} /></InlinePanel>
            <VerifyIssuesPanel {activeFile} />
        {/if}
    {/if}
</div>

<style>
    .cr-current-note { min-width: 0; }
    .cr-current-note__identity { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--cr-space-1) var(--cr-space-2); margin-bottom: var(--cr-space-3); min-width: 0; }
    .cr-current-note__name { color: var(--cr-text-normal); font-size: var(--cr-font-base); overflow-wrap: anywhere; }
    .cr-current-note__meta { color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-note-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: var(--cr-space-2); }
    .cr-note-action { display: inline-flex; align-items: center; justify-content: center; gap: var(--cr-space-1); width: 100%; min-width: 0; min-height: 32px; height: auto; padding: 6px; border-radius: var(--cr-field-radius); font-size: var(--cr-font-sm); white-space: normal; overflow-wrap: anywhere; }
    .cr-note-action[aria-expanded='true'] { background: var(--cr-bg-active); }
    .cr-current-note :global(.cr-section-hint) { margin-top: var(--cr-space-2); }
    .cr-text-action { height: auto; padding: 0; margin-left: var(--cr-space-1); border: 0; box-shadow: none; background: none; color: var(--cr-interactive-accent); font-size: inherit; cursor: pointer; }
    .cr-text-action:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
</style>
