<!--
  DiffContent.svelte — 统一 Diff 视图

  职责：
  - 逐行对比旧内容和新内容
  - 新增行：绿色背景 + 左侧 3px 绿色边线
  - 删除行：红色背景 + 左侧 3px 红色边线
  - 未变行：无背景
  - 复用旧 diff-view.ts 中的 buildLineDiff 算法

  @see 需求 9.2, 9.4
-->
<script lang="ts">
    import { buildLineDiff } from '../diff-view';

    let {
        oldContent,
        newContent,
    }: {
        oldContent: string;
        newContent: string;
    } = $props();

    /** 计算 diff 行 */
    let diffLines = $derived(buildLineDiff(oldContent, newContent));
</script>

<div class="cr-diff-content">
    {#each diffLines as line, i}
        <div
            class="cr-diff-line cr-diff-line--{line.type}"
            role="row"
        >
            <span class="cr-diff-prefix" aria-hidden="true">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span class="cr-diff-text">{line.text || ' '}</span>
        </div>
    {/each}
</div>

<style>
    .cr-diff-content {
        font-family: var(--font-monospace);
        font-size: var(--cr-font-sm, 13px);
        line-height: 1.6;
    }

    .cr-diff-line {
        display: flex;
        padding: 0 var(--cr-space-3);
        min-height: 1.6em;
    }

    /* 新增行 */
    .cr-diff-line--add {
        background: var(--cr-diff-add-bg);
        border-left: 3px solid var(--cr-diff-add-border);
    }

    /* 删除行 */
    .cr-diff-line--remove {
        background: var(--cr-diff-remove-bg);
        border-left: 3px solid var(--cr-diff-remove-border);
    }

    /* 未变行 */
    .cr-diff-line--context {
        border-left: 3px solid transparent;
    }

    .cr-diff-prefix {
        width: 20px;
        flex-shrink: 0;
        color: var(--cr-text-muted);
        user-select: none;
        text-align: center;
    }

    .cr-diff-text {
        flex: 1;
        white-space: pre-wrap;
        word-break: break-all;
    }
</style>
