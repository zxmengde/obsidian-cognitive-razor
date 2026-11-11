<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { getWorkbenchContext } from '../../bridge/context';
  import type { DuplicatePair, DuplicateMergePreview, DuplicateMergeDraft, DuplicateMergeImpact, TaskRecord } from '../../../types';
  import { mergeSourceBody, reviewMergeSource } from '../../../core/merge-review';
  import ModalShell from '../../components/ModalShell.svelte';
  import Button from '../../components/Button.svelte';
  import TextInput from '../../components/TextInput.svelte';
  import InlineAlert from '../../components/InlineAlert.svelte';
  import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';

  let { pair, initialPreview, onclose, onsuccess }: { pair: DuplicatePair; initialPreview?: DuplicateMergePreview; onclose: () => void; onsuccess: () => void } = $props();
  const ctx = getWorkbenchContext();
  const t = ctx.i18n.messages;
  const d = t.workbench.duplicates;
  const detailsToggleLabels = { expand: t.common.details.expand, collapse: t.common.details.collapse };
  const uid = Math.random().toString(36).slice(2, 8);
  const titleId = `cr-merge-title-${uid}`;
  let preview = $state<DuplicateMergePreview | null>(untrack(() => initialPreview ?? null));
  let canonical = $state<'a' | 'b'>(untrack(() => initialPreview?.draft.canonicalNodeId === pair.nodeIdB ? 'b' : 'a'));
  let impact = $state<DuplicateMergeImpact | null>(null);
  let impactLoading = $state(false);
  let impactGeneration = 0;
  let loading = $state(false);
  let confirming = $state(false);
  let feedback = $state<UiFeedback | null>(null);
  let body = $state(untrack(() => initialPreview?.draft.body ?? ''));
  let name = $state(untrack(() => initialPreview?.draft.name ?? ''));
  let aliases = $state(untrack(() => initialPreview?.draft.aliases.join(', ') ?? ''));
  let tags = $state(untrack(() => initialPreview?.draft.tags.join(', ') ?? ''));
  let parents = $state(untrack(() => initialPreview?.draft.parents.join('\n') ?? ''));
  /** 正在生成的合并稿任务；生成期间对话框保持打开并跟随任务状态。 */
  let workflowId = $state<string | null>(null);
  let generationStartedAt = $state(0);
  let now = $state(Date.now());
  let sourceView = $state<'redundant' | 'canonical'>('redundant');
  let stopWatching: (() => void) | null = null;
  let ticker: number | undefined;
  let disposed = false;
  onDestroy(() => { disposed = true; impactGeneration++; stopGenerationWatch(); });

  const nodeId = $derived(canonical === 'a' ? pair.nodeIdA : pair.nodeIdB);
  const nameA = $derived(ctx.application.duplicates.getConceptName(pair.nodeIdA) ?? pair.nodeIdA);
  const nameB = $derived(ctx.application.duplicates.getConceptName(pair.nodeIdB) ?? pair.nodeIdB);
  const options = $derived([
    { key: 'a' as const, id: pair.nodeIdA, name: nameA, path: ctx.application.duplicates.getConceptPath(pair.nodeIdA) },
    { key: 'b' as const, id: pair.nodeIdB, name: nameB, path: ctx.application.duplicates.getConceptPath(pair.nodeIdB) },
  ]);
  const keepName = $derived(canonical === 'a' ? nameA : nameB);
  const trashName = $derived(canonical === 'a' ? nameB : nameA);
  /** A long link list is truncated; the total count is never truncated. */
  const linkedPreview = $derived(impact?.linkedPaths.slice(0, 8) ?? []);
  const linkedRest = $derived(Math.max(0, (impact?.linkedPaths.length ?? 0) - linkedPreview.length));
  const generating = $derived(workflowId !== null && !preview);
  const elapsedSeconds = $derived(Math.max(0, Math.floor((now - generationStartedAt) / 1000)));

  // 原文只取一次；对照随正文编辑重新计算，便于边改边看还缺什么。
  const sources = $derived(preview ? {
    canonical: mergeSourceBody(preview.canonical.content ?? ''),
    redundant: mergeSourceBody(preview.redundant.content ?? ''),
  } : null);
  const review = $derived(sources && sources[sourceView] ? reviewMergeSource(sources[sourceView], body) : null);

  /**
   * 第一步：先给出影响范围，不写入任何文件。
   *
   * The merge rewrites one note, repairs links in others and sends a second one
   * to the trash, and the reset backup does not cover note bodies. None of that
   * may happen before the user has seen it.
   */
  async function loadImpact(): Promise<void> {
    if (impactLoading || disposed) return;
    const generation = ++impactGeneration;
    impact = null;
    impactLoading = true;
    feedback = null;
    const submittedNodeId = nodeId;
    try {
      const result = await ctx.application.duplicates.previewMergeImpact(pair.id, submittedNodeId);
      if (disposed || generation !== impactGeneration) return;
      if (result.ok) impact = result.value;
      else feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.mergeFailed);
    } catch (error) {
      if (!disposed && generation === impactGeneration) feedback = toSafeErrorFeedback(error, t.workbench.notifications.mergeFailed);
    } finally {
      if (!disposed && generation === impactGeneration) impactLoading = false;
    }
  }

  function chooseCanonical(value: 'a' | 'b'): void {
    if (loading || confirming || generating || value === canonical) return;
    canonical = value;
    void loadImpact();
  }

  function activeMergeTask(): TaskRecord | undefined {
    return ctx.application.queue.getSnapshot().tasks.find(task => task.stageId === 'merge'
      && (task.state === 'pending' || task.state === 'running')
      && (task.payload as { pairId?: string }).pairId === pair.id);
  }

  onMount(() => {
    // 重新打开时接上仍在生成的任务，而不是让用户再提交一次被拒绝。
    const running = preview ? undefined : activeMergeTask();
    if (running?.workflowId) {
      canonical = running.nodeId === pair.nodeIdB ? 'b' : 'a';
      watchGeneration(running.workflowId, running.createdAt);
    }
    void loadImpact();
  });

  function applyPreview(value: DuplicateMergePreview): void {
    preview = value;
    canonical = value.draft.canonicalNodeId === pair.nodeIdB ? 'b' : 'a';
    body = value.draft.body;
    name = value.draft.name;
    aliases = value.draft.aliases.join(', ');
    tags = value.draft.tags.join(', ');
    parents = value.draft.parents.join('\n');
  }

  function stopGenerationWatch(): void {
    stopWatching?.();
    stopWatching = null;
    window.clearInterval(ticker);
    ticker = undefined;
  }

  function watchGeneration(id: string, startedAt: number): void {
    stopGenerationWatch();
    workflowId = id;
    generationStartedAt = startedAt;
    now = Date.now();
    ticker = window.setInterval(() => { now = Date.now(); }, 1000);
    stopWatching = ctx.application.queue.subscribe(() => syncGeneration(id));
    syncGeneration(id);
  }

  function syncGeneration(id: string): void {
    if (disposed || workflowId !== id) return;
    const task = ctx.application.queue.getSnapshot().tasks.find(item => item.workflowId === id);
    if (task && (task.state === 'pending' || task.state === 'running')) return;
    stopGenerationWatch();
    if (task?.state === 'completed') { void loadDraft(id); return; }
    workflowId = null;
    feedback = task?.state === 'failed' || task?.state === 'interrupted'
      ? toSafeErrorFeedback(task.error, d.generationFailed)
      : { level: 'info', message: d.generationStopped };
  }

  async function loadDraft(id: string): Promise<void> {
    try {
      const result = await ctx.application.duplicates.getMergeDraft(id);
      if (disposed || workflowId !== id) return;
      if (result.ok) applyPreview(result.value);
      else { workflowId = null; feedback = toSafeErrorFeedback(result.error, d.generationFailed); }
    } catch (error) {
      if (!disposed && workflowId === id) { workflowId = null; feedback = toSafeErrorFeedback(error, d.generationFailed); }
    }
  }

  async function prepare(): Promise<void> {
    if (loading || generating || disposed) return;
    loading = true; feedback = null;
    try {
      const result = await ctx.application.duplicates.startMerge(pair.id, nodeId);
      if (disposed) return;
      if (result.ok) {
        preview = null;
        watchGeneration(result.value, Date.now());
      } else feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.mergeFailed);
    } catch (error) { if (!disposed) feedback = toSafeErrorFeedback(error, t.workbench.notifications.mergeFailed); }
    finally { loading = false; }
  }

  async function cancelGeneration(): Promise<void> {
    const task = workflowId ? ctx.application.queue.getSnapshot().tasks.find(item => item.workflowId === workflowId) : undefined;
    if (!task) return;
    const result = await ctx.application.queue.cancel(task.id);
    if (!result.ok && !disposed) feedback = toSafeErrorFeedback(result.error, d.generationFailed);
  }

  function openNote(cruid: string): void {
    const path = ctx.application.duplicates.getConceptPath(cruid);
    if (!path) {
      feedback = toSafeErrorFeedback({ code: 'E311_NOT_FOUND' }, t.workbench.notifications.mergeFailed);
      return;
    }
    void ctx.app.workspace.openLinkText(path, '', true);
  }
  function split(value: string): string[] { return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]; }
  async function confirm(): Promise<void> {
    if (!preview || confirming || loading) return;
    confirming = true; feedback = null;
    const draft: DuplicateMergeDraft = { ...preview.draft, body, name, aliases: split(aliases), tags: split(tags), parents: [...new Set(parents.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))] };
    try {
      const result = await ctx.application.duplicates.confirmMerge(draft, preview.linkRepairPlan);
      if (!disposed) {
        if (result.ok) onsuccess(); else feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.mergeFailed);
      }
    } catch (error) { if (!disposed) feedback = toSafeErrorFeedback(error, t.workbench.notifications.mergeFailed); }
    finally { confirming = false; }
  }
</script>

<ModalShell {titleId} wide={true} hostLevel={true} dismissible={!confirming} oncancel={onclose}>
  {#snippet footer()}
    <div class="cr-merge-footer">
      {#if preview}
        <p class="cr-merge-summary">{ctx.i18n.format('workbench.duplicates.confirmSummary', { keep: keepName, trash: trashName, files: preview.linkRepairPlan.entries.length, links: preview.linkRepairPlan.replacementCount })}</p>
      {/if}
      <div class="cr-merge-actions">
        <Button variant="secondary" disabled={confirming} onclick={onclose}>{t.common.cancel}</Button>
        {#if preview}
          <Button variant="secondary" disabled={confirming} loading={loading} onclick={() => void prepare()}>{d.regenerateDraft}</Button>
          <Button variant="danger" disabled={loading} loading={confirming} onclick={() => void confirm()}>{d.confirmMerge}</Button>
        {:else if generating}
          <Button variant="secondary" onclick={() => void cancelGeneration()}>{d.cancelGeneration}</Button>
        {:else}
          <Button variant="primary" loading={loading} disabled={!impact || impactLoading} onclick={() => void prepare()}>{d.generateDraft}</Button>
        {/if}
      </div>
    </div>
  {/snippet}
  <h3 id={titleId}>{d.mergeTitle}</h3>
  {#if generating}
    <div class="cr-merge-generating" role="status">
      <p class="cr-merge-generating__state">{ctx.i18n.format('workbench.duplicates.generating', { seconds: elapsedSeconds })}</p>
      <p>{d.generatingHint}</p>
    </div>
  {:else if !preview}
    <p>{d.chooseCanonical}</p>
    <div class="cr-merge-choice" role="radiogroup" aria-labelledby={titleId}>
      {#each options as option (option.key)}
        <div class="cr-merge-option" class:is-selected={canonical === option.key}>
          <label>
            <input type="radio" name={`cr-merge-keep-${uid}`} checked={canonical === option.key} disabled={loading || impactLoading}
              onchange={() => chooseCanonical(option.key)} />
            <span class="cr-merge-option__name">{option.name}</span>
            {#if option.path}<span class="cr-merge-option__path">{option.path}</span>{/if}
          </label>
          <Button variant="ghost" ariaLabel={ctx.i18n.format('workbench.duplicates.openNoteAria', { name: option.name })} onclick={() => openNote(option.id)}>{d.openNote}</Button>
        </div>
      {/each}
    </div>
    {#if impactLoading}
      <p class="cr-merge-impact__pending" role="status">{d.impactLoading}</p>
    {:else if impact}
      <section class="cr-merge-impact" aria-label={d.impactTitle}>
        <h4>{d.impactTitle}</h4>
        <dl>
          <dt>{d.impactKeep}</dt>
          <dd>{impact.canonical.name} · {impact.canonical.path}</dd>
          <dt>{d.impactTrash}</dt>
          <dd>{impact.redundant.name} · {impact.redundant.path}</dd>
          <dt>{d.impactRewrite}</dt>
          <dd>
            {#if impact.linkedPaths.length === 0}
              {d.impactNoRewrite}
            {:else}
              {#each linkedPreview as path (path)}<span class="cr-merge-impact__path">{path}</span>{/each}
              {#if linkedRest > 0}<span class="cr-merge-impact__path">{ctx.i18n.format('workbench.duplicates.impactMore', { count: linkedRest })}</span>{/if}
              <span class="cr-merge-impact__count">{ctx.i18n.format('workbench.duplicates.impactLinkCount', { count: impact.linkReplacements })}</span>
            {/if}
          </dd>
          {#if impact.ambiguousLinks.length > 0}
            <dt>{d.impactAmbiguous}</dt>
            <dd>{ctx.i18n.format('workbench.duplicates.impactLinkCount', { count: impact.ambiguousLinks.length })}</dd>
          {/if}
        </dl>
        <p class="cr-merge-impact__backup">{d.impactBackup}</p>
      </section>
    {/if}
  {:else}
    {#if preview.draft.conflicts.length > 0}
      <section class="cr-merge-conflicts" aria-label={d.conflicts}>
        <h4>{d.conflicts}</h4>
        <ul>{#each preview.draft.conflicts as conflict, index (index)}<li>{conflict}</li>{/each}</ul>
      </section>
    {/if}
    <div class="cr-merge-review">
      <div class="cr-merge-draft">
        <label>{d.fieldName}<TextInput disabled={confirming || loading} value={name} onchange={(value) => { name = value; }} /></label>
        <label>{d.fieldAliases}<TextInput disabled={confirming || loading} value={aliases} onchange={(value) => { aliases = value; }} /></label>
        <label>{d.fieldTags}<TextInput disabled={confirming || loading} value={tags} onchange={(value) => { tags = value; }} /></label>
        <!-- One parent link per line: a single-line input would strip the newlines
             that separate multiple parents and silently merge them into one link. -->
        <label>{d.fieldParents}<textarea bind:value={parents} rows="3" disabled={confirming || loading}></textarea></label>
        <label>{d.fieldBody}<textarea bind:value={body} rows="16" disabled={confirming || loading}></textarea></label>
        {#if preview.linkRepairPlan.skipped.length > 0}<p class="cr-merge-note">{d.skipped}: {preview.linkRepairPlan.skipped.length}</p>{/if}
      </div>
      {#if sources && (sources.canonical || sources.redundant)}
        <section class="cr-merge-source" aria-label={d.sourceTitle}>
          <div class="cr-merge-source__tabs" role="group" aria-label={d.sourceTitle}>
            <button type="button" aria-pressed={sourceView === 'redundant'} onclick={() => { sourceView = 'redundant'; }}>{ctx.i18n.format('workbench.duplicates.sourceTrash', { name: trashName })}</button>
            <button type="button" aria-pressed={sourceView === 'canonical'} onclick={() => { sourceView = 'canonical'; }}>{ctx.i18n.format('workbench.duplicates.sourceKeep', { name: keepName })}</button>
          </div>
          {#if review}
            <p class="cr-merge-note" class:is-warning={review.missingLines > 0}>
              {review.missingLines > 0 ? ctx.i18n.format('workbench.duplicates.missingLines', { count: review.missingLines }) : d.allKept}
            </p>
            {#if review.missingFacts.length > 0}
              <p class="cr-merge-note is-warning">{d.missingFacts}{#each review.missingFacts as fact, index (fact)}{index > 0 ? '、' : ''}<code>{fact}</code>{/each}</p>
            {/if}
            <div class="cr-merge-source__text">
              {#each review.lines as line, index (index)}<div class="cr-merge-line" class:is-missing={line.status === 'missing'}>{line.text || ' '}</div>{/each}
            </div>
            <p class="cr-merge-note">{d.reviewHint}</p>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
  {#if feedback}<InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />{/if}
</ModalShell>

<style>
  h3 { margin: 0 0 var(--cr-space-3); font-size: var(--cr-heading-workbench); font-weight: 600; }
  h4 { margin: 0 0 var(--cr-space-2); font-size: var(--cr-font-sm); font-weight: 600; color: var(--cr-text-normal); }
  p { margin: 0 0 var(--cr-space-3); color: var(--cr-text-muted); line-height: var(--cr-line-height-body); overflow-wrap: anywhere; }
  label { display: flex; flex-direction: column; gap: var(--cr-space-1); margin: 0 0 var(--cr-space-3); color: var(--cr-text-muted); font-size: var(--cr-font-sm); }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; background: var(--cr-bg-base); color: var(--cr-text-normal); border: 1px solid var(--cr-border); border-radius: var(--cr-field-radius); padding: var(--cr-space-2); font: inherit; line-height: var(--cr-line-height-body); }
  .cr-merge-footer { display: flex; flex-direction: column; gap: var(--cr-space-2); }
  .cr-merge-summary { margin: 0; font-size: var(--cr-font-sm); color: var(--cr-text-normal); }
  .cr-merge-actions { display: flex; gap: var(--cr-space-2); flex-wrap: wrap; justify-content: flex-end; }
  .cr-merge-choice { display: flex; flex-direction: column; margin: 0 0 var(--cr-space-4); border-top: 1px solid var(--cr-border); }
  .cr-merge-option { display: flex; align-items: center; gap: var(--cr-space-2); padding: var(--cr-space-2) 0; border-bottom: 1px solid var(--cr-border); }
  .cr-merge-option label { flex: 1; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--cr-space-2); margin: 0; cursor: pointer; }
  .cr-merge-option input { grid-row: span 2; margin: 3px 0 0; }
  .cr-merge-option__name { color: var(--cr-text-normal); font-size: var(--cr-font-base); overflow-wrap: anywhere; }
  .is-selected .cr-merge-option__name { font-weight: 600; }
  .cr-merge-option__path { color: var(--cr-text-faint); font-size: var(--cr-font-xs); overflow-wrap: anywhere; }
  .cr-merge-impact dl { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: var(--cr-space-1) var(--cr-space-3); margin: 0; font-size: var(--cr-font-sm); }
  .cr-merge-impact dt { color: var(--cr-text-muted); }
  .cr-merge-impact dd { margin: 0; color: var(--cr-text-normal); overflow-wrap: anywhere; }
  .cr-merge-impact__path { display: block; }
  .cr-merge-impact__count { display: block; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
  .cr-merge-impact__backup { margin: var(--cr-space-3) 0 0; font-size: var(--cr-font-xs); }
  .cr-merge-impact__pending { font-size: var(--cr-font-sm); }
  .cr-merge-generating { padding: var(--cr-space-6) 0; }
  .cr-merge-generating__state { color: var(--cr-text-normal); font-size: var(--cr-font-base); }
  .cr-merge-conflicts { margin: 0 0 var(--cr-space-4); padding-left: var(--cr-space-3); border-left: 2px solid var(--cr-status-warning); }
  .cr-merge-conflicts ul { margin: 0; padding-left: var(--cr-space-4); color: var(--cr-text-normal); font-size: var(--cr-font-sm); line-height: var(--cr-line-height-body); }
  .cr-merge-review { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--cr-space-6); align-items: start; }
  .cr-merge-draft { min-width: 0; }
  .cr-merge-source { min-width: 0; display: flex; flex-direction: column; gap: var(--cr-space-2); }
  .cr-merge-source__tabs { display: flex; gap: var(--cr-space-4); border-bottom: 1px solid var(--cr-border); }
  .cr-merge-source__tabs button { height: auto; padding: var(--cr-space-1) 0; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; box-shadow: none; background: none; color: var(--cr-text-muted); font-size: var(--cr-font-sm); white-space: normal; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
  .cr-merge-source__tabs button[aria-pressed='true'] { color: var(--cr-text-normal); border-bottom-color: var(--cr-interactive-accent); }
  .cr-merge-source__tabs button:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; }
  .cr-merge-source__text { max-height: 420px; overflow: auto; font-size: var(--cr-font-sm); line-height: var(--cr-line-height-body); color: var(--cr-text-normal); }
  .cr-merge-line { min-height: 1lh; padding: 0 var(--cr-space-2); white-space: pre-wrap; overflow-wrap: anywhere; border-left: 2px solid transparent; }
  .cr-merge-line.is-missing { background: var(--cr-overlay-warning-15); border-left-color: var(--cr-status-warning); }
  .cr-merge-note { margin: 0; font-size: var(--cr-font-xs); }
  .cr-merge-note.is-warning { color: var(--cr-text-normal); }
  .cr-merge-note code { font-size: var(--cr-font-xs); }
</style>
