<!--
  CreateSection.svelte — 工作台创建区

  职责：
  - 全宽搜索输入框（含清除/提交按钮、Enter 键触发 Define）
  - Define 加载状态（按钮动画 + 输入框禁用）
  - Define 成功后显示类型置信度表格（TypeTable，任务 6.3 实现）
  - 操作按钮行（拓展、配图、核查），右对齐，Secondary 样式
  - 无活跃笔记时隐藏按钮行显示引导文字
  - 图片未启用时隐藏配图按钮

  @see 需求 4.1-4.6, 4.10-4.13
-->
<script lang="ts">
    import type { TFile } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import { showSuccess, showError } from '../../feedback';
    import Button from '../../components/Button.svelte';
    import Icon from '../../components/Icon.svelte';
    import SectionCard from '../../components/SectionCard.svelte';
    import InlinePanel from '../../components/InlinePanel.svelte';
    import TypeTable from './TypeTable.svelte';
    import ExpandPanel from './ExpandPanel.svelte';
    import type { StandardizedConcept, CRType } from '../../../types';
    import type { CreateOrchestrator } from '../../../core/create-orchestrator';
    import type { VerifyOrchestrator } from '../../../core/verify-orchestrator';
    import type { Logger } from '../../../data/logger';

    /** 当前展开的面板类型 */
    type ActivePanel = 'none' | 'expand';

    let {
        activeFile,
    }: {
        activeFile: TFile | null;
    } = $props();

    // 从 Context 获取服务
    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const createOrch = ctx.container.resolve<CreateOrchestrator>(SERVICE_TOKENS.createOrchestrator);
    const verifyOrch = ctx.container.resolve<VerifyOrchestrator>(SERVICE_TOKENS.verifyOrchestrator);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 组件状态
    let inputValue = $state('');
    let defining = $state(false);
    let defineResult = $state<StandardizedConcept | null>(null);
    let error = $state<string | null>(null);
    let activePanel = $state<ActivePanel>('none');

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
        error = null;
    }

    /** 触发 Define 流程 */
    async function handleDefine(): Promise<void> {
        if (!hasInput || defining) return;

        defining = true;
        error = null;
        defineResult = null;

        try {
            const result = await createOrch.defineDirect(inputValue.trim());
            if (result.ok) {
                defineResult = result.value;
            } else {
                error = result.error.message;
                logger.warn('CreateSection', 'Define 失败', { error: result.error });
            }
        } catch (e) {
            error = t.workbench?.createConcept?.defining ?? '定义失败';
            logger.error('CreateSection', 'Define 异常', e as Error);
        } finally {
            defining = false;
        }
    }

    /** 键盘事件：Enter 触发 Define */
    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Enter' && hasInput && !defining) {
            e.preventDefault();
            void handleDefine();
        }
    }

    /** 触发 Verify 流程 */
    function handleVerify(): void {
        if (!activeFile) return;
        const result = verifyOrch.startVerifyPipeline(activeFile.path);
        if (result.ok) {
            showSuccess(t.notices?.verifyStarted ?? '核查已启动');
        } else {
            showError(result.error.message);
        }
    }

    /** 选择类型并创建（TypeTable 回调） */
    function handleCreateType(type: CRType): void {
        if (!defineResult) return;
        const result = createOrch.startCreatePipelineWithStandardized(defineResult, type);
        if (result.ok) {
            clearInput();
        } else {
            showError(result.error.message);
        }
    }
</script>

<!-- 搜索输入区 -->
<SectionCard>
    <div class="cr-create-section">
        <div class="cr-search-row">
            <input
                class="cr-search-input"
                type="text"
                placeholder={t.workbench?.createConcept?.placeholder ?? '输入概念描述...'}
                bind:value={inputValue}
                onkeydown={handleKeydown}
                disabled={defining}
                aria-label={t.workbench?.createConcept?.placeholder ?? '输入概念描述'}
            />
            {#if hasInput}
                <button
                    class="cr-search-btn cr-search-clear"
                    onclick={clearInput}
                    disabled={defining}
                    aria-label={t.workbench?.createConcept?.clear ?? '清空输入'}
                >
                    <Icon name="x" size={16} />
                </button>
            {/if}
            <Button
                variant="primary"
                size="icon"
                disabled={!hasInput}
                loading={defining}
                onclick={() => void handleDefine()}
                ariaLabel={t.workbench?.createConcept?.startButton ?? '开始'}
            >
                {#if !defining}<Icon name="corner-down-left" size={16} />{/if}
            </Button>
        </div>

        <!-- 操作按钮行：仅在有活跃 Markdown 笔记时显示 -->
        {#if isMarkdown}
            <div class="cr-action-grid">
                <Button
                    variant={activePanel === 'expand' ? 'primary' : 'secondary'}
                    size="sm"
                    onclick={() => togglePanel('expand')}
                >
                    {t.workbench?.buttons?.expand ?? '拓展'}
                </Button>
                <Button variant="secondary" size="sm" onclick={handleVerify}>
                    {t.workbench?.buttons?.verify ?? '核查'}
                </Button>
            </div>
        {:else}
            <div class="cr-hint-text">
                {t.workbench?.buttons?.openNoteHint ?? '打开一篇 Markdown 笔记以使用改进、拓展等工具'}
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

<!-- 错误状态 -->
{#if error}
    <div class="cr-error-inline">{error}</div>
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
        height: 40px;
        padding: 0 var(--cr-space-3);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md, 6px);
        background: var(--cr-bg-base);
        color: var(--cr-text-normal);
        font-size: var(--cr-font-base, 14px);
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

    .cr-search-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: var(--cr-radius-sm, 4px);
        background: transparent;
        color: var(--cr-text-muted);
        cursor: pointer;
        font-size: 14px;
        padding: 0;
    }

    .cr-search-btn:hover {
        color: var(--cr-text-primary);
        background: var(--cr-bg-hover);
    }

    /* 操作按钮网格 */
    .cr-action-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--cr-space-2);
    }

    /* 引导文字 */
    .cr-hint-text {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-text-muted);
        text-align: center;
        padding: var(--cr-space-2) 0;
    }

    /* 内联错误 */
    .cr-error-inline {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-status-error);
        padding: var(--cr-space-1) 0;
    }
</style>
