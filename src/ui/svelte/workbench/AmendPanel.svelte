<!--
  AmendPanel.svelte — 修订内联面板

  职责：
  - 修订指令输入框 + 提交/取消按钮
  - 提交后调用 AmendOrchestrator.startAmendPipeline()
  - 提交成功后自动收起面板

  @see 需求 5.2
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import type { TFile } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import Button from '../../components/Button.svelte';
    import type { AmendOrchestrator } from '../../../core/amend-orchestrator';
    import type { Logger } from '../../../data/logger';

    let {
        activeFile,
        onclose,
    }: {
        activeFile: TFile | null;
        onclose?: () => void;
    } = $props();

    // 从 Context 获取服务
    const ctx = getCRContext();
    const t = ctx.i18n.t();
    const amendOrch = ctx.container.resolve<AmendOrchestrator>(SERVICE_TOKENS.amendOrchestrator);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 组件状态
    let instruction = $state('');
    let submitting = $state(false);

    // 派生状态
    let hasInput = $derived(instruction.trim().length > 0);

    /** 提交修订 */
    async function handleSubmit(): Promise<void> {
        if (!hasInput || !activeFile || submitting) return;

        submitting = true;
        try {
            const result = amendOrch.startAmendPipeline(activeFile.path, instruction.trim());
            if (result.ok) {
                new Notice(t.notices?.improveStarted ?? '改进任务已启动，请等待 AI 生成改进内容...');
                instruction = '';
                onclose?.();
            } else {
                new Notice(result.error.message);
            }
        } catch (e) {
            logger.error('AmendPanel', '提交修订失败', e as Error);
            new Notice(t.imageModal?.genericFailure ?? '操作失败，请稍后重试');
        } finally {
            submitting = false;
        }
    }

    /** Enter 键提交 */
    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === 'Enter' && !e.shiftKey && hasInput && !submitting) {
            e.preventDefault();
            void handleSubmit();
        }
    }
</script>

<div class="cr-amend-panel">
    <input
        class="cr-amend-input"
        type="text"
        placeholder={t.workbench?.amendModal?.placeholder ?? '请输入修订指令（例如：补充更多示例、优化定义、添加相关理论）'}
        bind:value={instruction}
        onkeydown={handleKeydown}
        disabled={submitting}
        aria-label={t.workbench?.amendModal?.title ?? '修订笔记'}
    />
    <div class="cr-amend-actions">
        <Button
            variant="primary"
            size="sm"
            disabled={!hasInput}
            loading={submitting}
            onclick={() => void handleSubmit()}
        >
            {t.workbench?.amendModal?.title ?? '修订'}
        </Button>
        <Button
            variant="ghost"
            size="sm"
            disabled={submitting}
            onclick={() => onclose?.()}
        >
            {t.imageModal?.cancel ?? '取消'}
        </Button>
    </div>
</div>

<style>
    .cr-amend-panel {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-amend-input {
        width: 100%;
        height: 36px;
        padding: 0 var(--cr-space-3);
        border: 1px solid var(--cr-border);
        border-radius: var(--cr-radius-md, 6px);
        background: var(--cr-bg-primary);
        color: var(--cr-text-primary);
        font-size: var(--cr-font-base, 14px);
        outline: none;
        transition: border-color 0.15s;
        box-sizing: border-box;
    }

    .cr-amend-input:focus {
        border-color: var(--cr-accent);
    }

    .cr-amend-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .cr-amend-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--cr-space-2);
    }
</style>
