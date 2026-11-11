<!--
  VerifyIssuesPanel.svelte — 当前笔记的核查问题清单

  报告留在笔记里（真相只有一份）；这里把报告的顶层条目列成清单：
  点条目跳到正文中被引用的原文，勾选框写回报告里的任务标记。
  写回前重新解析当前文件并核对原行，不一致就放弃并提示，不覆盖新编辑。
-->
<script lang="ts">
    import type { MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
    import { getWorkbenchContext } from '../../bridge/context';
    import InlineAlert from '../../components/InlineAlert.svelte';
    import {
        locateIssue,
        readVerificationReport,
        setIssueResolved,
        type VerificationIssue,
        type VerificationReportView,
    } from '../../../core/verification-issues';

    let { activeFile }: { activeFile: TFile | null } = $props();

    const ctx = getWorkbenchContext();
    const t = ctx.i18n.messages.workbench.verifyIssues;

    let content = $state('');
    let report = $state<VerificationReportView | null>(null);
    let selectedLine = $state<number | null>(null);
    let writing = $state(false);
    let notice = $state<string | null>(null);

    $effect(() => {
        const file = activeFile;
        let disposed = false;
        let timer: number | undefined;
        report = null;
        selectedLine = null;
        notice = null;
        const refresh = async () => {
            if (!file || file.extension !== 'md') return;
            try {
                const text = await ctx.app.vault.cachedRead(file);
                if (disposed) return;
                content = text;
                report = readVerificationReport(text);
            } catch { if (!disposed) report = null; }
        };
        void refresh();
        // 编辑器每次保存都会触发 modify；合并为一次读取。
        const event = ctx.app.vault.on('modify', (changed) => {
            if (changed !== file) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void refresh(), 300);
        });
        return () => { disposed = true; window.clearTimeout(timer); ctx.app.vault.offref(event); };
    });

    const done = $derived(report?.issues.filter(issue => issue.resolved).length ?? 0);
    const total = $derived(report?.issues.length ?? 0);

    function findLeaf(file: TFile): WorkspaceLeaf {
        const open = ctx.app.workspace.getLeavesOfType('markdown')
            .find(leaf => (leaf.view as MarkdownView).file?.path === file.path);
        return open ?? ctx.app.workspace.getLeaf('tab');
    }

    async function reveal(line: number): Promise<void> {
        const file = activeFile;
        if (!file) return;
        const leaf = findLeaf(file);
        await leaf.openFile(file, { active: true, eState: { line } });
        const editor = (leaf.view as MarkdownView).editor;
        if (editor) {
            const position = { line, ch: 0 };
            editor.setCursor(position);
            editor.scrollIntoView({ from: position, to: position }, true);
        }
        ctx.app.workspace.setActiveLeaf(leaf, { focus: true });
    }

    async function jump(issue: VerificationIssue): Promise<void> {
        if (!report) return;
        selectedLine = issue.line;
        const location = locateIssue(content, report, issue);
        notice = location ? null : t.notLocated;
        await reveal(location?.line ?? issue.line);
    }

    async function toggle(issue: VerificationIssue, resolved: boolean): Promise<void> {
        const file = activeFile;
        if (!file || writing) return;
        writing = true;
        notice = null;
        let conflict = false;
        try {
            const next = await ctx.app.vault.process(file, (current) => {
                const updated = setIssueResolved(current, issue, resolved);
                if (updated === null) { conflict = true; return current; }
                return updated;
            });
            content = next;
            report = readVerificationReport(next);
            if (conflict) notice = t.conflict;
        } catch {
            notice = t.writeFailed;
        } finally {
            writing = false;
        }
    }
</script>

{#if report}
    <div class="cr-verify-issues" role="region" aria-label={t.title}>
        <div class="cr-verify-issues-head">
            <h2>{t.title}</h2>
            {#if total > 0}<span>{ctx.i18n.format('workbench.verifyIssues.progress', { done: String(done), total: String(total) })}</span>{/if}
            {#if report.verifiedAt}<span>{ctx.i18n.format('workbench.verifyIssues.verifiedAt', { time: report.verifiedAt })}</span>{/if}
        </div>
        {#if total > 0}
            <ul class="cr-verify-issue-list">
                {#each report.issues as issue (issue.line)}
                    <li class:is-resolved={issue.resolved} class:is-selected={selectedLine === issue.line}>
                        <input type="checkbox" checked={issue.resolved} disabled={writing}
                            aria-label={ctx.i18n.format('workbench.verifyIssues.markResolved', { title: issue.title })}
                            onchange={(event) => void toggle(issue, event.currentTarget.checked)} />
                        <button type="button" class="cr-verify-issue" aria-label={ctx.i18n.format('workbench.verifyIssues.jumpAria', { title: issue.title })}
                            onclick={() => void jump(issue)}>
                            <span class="cr-verify-issue-title">{issue.title}</span>
                            {#if selectedLine === issue.line && issue.text.includes('\n')}
                                <span class="cr-verify-issue-detail">{issue.text.slice(issue.text.indexOf('\n') + 1)}</span>
                            {/if}
                        </button>
                    </li>
                {/each}
            </ul>
            {#if done === total}<p class="cr-verify-issues-hint">{t.allResolved}</p>{/if}
        {:else if report.clean}
            <p class="cr-verify-issues-hint">{t.clean}</p>
        {:else}
            <p class="cr-verify-issues-hint">{t.unsplit} <button type="button" class="cr-text-action" onclick={() => void reveal(report!.startLine)}>{t.openReport}</button></p>
        {/if}
        {#if notice}<InlineAlert level="info" message={notice} detailsToggleLabels={ctx.i18n.messages.common.details} />{/if}
    </div>
{/if}

<style>
    .cr-verify-issues { margin-top: var(--cr-space-6); display: flex; flex-direction: column; gap: var(--cr-space-2); }
    .cr-verify-issues-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--cr-space-1) var(--cr-space-3); }
    .cr-verify-issues-head h2 { margin: 0; font-size: var(--cr-font-base); font-weight: 600; }
    .cr-verify-issues-head span { color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
    .cr-verify-issue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .cr-verify-issue-list li { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: start; gap: var(--cr-space-2); padding: var(--cr-space-1) 0; }
    .cr-verify-issue-list input { margin: 3px 0 0; }
    .cr-verify-issue { display: flex; flex-direction: column; align-items: flex-start; gap: var(--cr-space-1); width: 100%; min-width: 0; height: auto; padding: 0; border: 0; box-shadow: none; background: none; color: var(--cr-text-normal); font-size: var(--cr-font-sm); line-height: var(--cr-line-height-body); text-align: left; white-space: normal; cursor: pointer; }
    .cr-verify-issue:hover .cr-verify-issue-title { color: var(--cr-text-accent); }
    .cr-verify-issue:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; border-radius: var(--cr-radius-sm); }
    .cr-verify-issue-title { overflow-wrap: anywhere; }
    .cr-verify-issue-detail { color: var(--cr-text-muted); font-size: var(--cr-font-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
    .is-resolved .cr-verify-issue-title { color: var(--cr-text-faint); text-decoration: line-through; }
    .is-selected .cr-verify-issue-title { color: var(--cr-text-accent); }
    .cr-text-action { height: auto; padding: 0; border: 0; box-shadow: none; background: none; color: var(--cr-interactive-accent); font-size: var(--cr-font-xs); cursor: pointer; }
    .cr-verify-issues-hint { margin: 0; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
</style>
