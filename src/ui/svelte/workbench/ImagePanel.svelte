<!--
  ImagePanel.svelte — 图片配置内联面板

  职责：
  - 描述输入框 + 生成/取消按钮
  - 提交后调用 ImageInsertOrchestrator.startImagePipeline()
  - 提交成功后自动收起面板

  @see 需求 5.4
-->
<script lang="ts">
    import { Notice } from 'obsidian';
    import type { TFile } from 'obsidian';
    import { getCRContext } from '../../bridge/context';
    import { SERVICE_TOKENS } from '../../../../main';
    import Button from '../../components/Button.svelte';
    import type { ImageInsertOrchestrator } from '../../../core/image-insert-orchestrator';
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
    const imageOrch = ctx.container.resolve<ImageInsertOrchestrator>(SERVICE_TOKENS.imageInsertOrchestrator);
    const logger = ctx.container.resolve<Logger>(SERVICE_TOKENS.logger);

    // 组件状态
    let description = $state('');
    let submitting = $state(false);

    // 派生状态：至少 5 个字符
    let hasInput = $derived(description.trim().length >= 5);

    /** 提交图片生成 */
    async function handleSubmit(): Promise<void> {
        if (!hasInput || !activeFile || submitting) return;

        submitting = true;
        try {
            // 构建 ImagePipelineOptions
            const content = await ctx.app.vault.cachedRead(activeFile);
            const result = imageOrch.startImagePipeline({
                filePath: activeFile.path,
                cursorPosition: { line: 0, ch: 0 },
                userPrompt: description.trim(),
                contextBefore: content.substring(0, 500),
                contextAfter: '',
            });

            if (result.ok) {
                new Notice(t.notices?.imageTaskCreated ?? '图片生成任务已创建');
                description = '';
                onclose?.();
            } else {
                new Notice(result.error.message);
            }
        } catch (e) {
            logger.error('ImagePanel', '图片生成失败', e as Error);
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

<div class="cr-image-panel">
    <input
        class="cr-image-input"
        type="text"
        placeholder={t.imageModal?.promptPlaceholder ?? '例如：一张展示量子纠缠的简洁线稿图，带精炼标注。'}
        bind:value={description}
        onkeydown={handleKeydown}
        disabled={submitting}
        aria-label={t.imageModal?.promptLabel ?? '描述你想要的图片'}
    />
    {#if !hasInput && description.trim().length > 0}
        <div class="cr-image-hint">
            {t.imageModal?.promptTooShort ?? '请至少输入 5 个字符。'}
        </div>
    {/if}
    <div class="cr-image-actions">
        <Button
            variant="primary"
            size="sm"
            disabled={!hasInput}
            loading={submitting}
            onclick={() => void handleSubmit()}
        >
            {t.imageModal?.generate ?? '生成'}
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
    .cr-image-panel {
        display: flex;
        flex-direction: column;
        gap: var(--cr-space-2);
    }

    .cr-image-input {
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

    .cr-image-input:focus {
        border-color: var(--cr-accent);
    }

    .cr-image-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .cr-image-hint {
        font-size: var(--cr-font-sm, 13px);
        color: var(--cr-status-warning, #f9a825);
    }

    .cr-image-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--cr-space-2);
    }
</style>
