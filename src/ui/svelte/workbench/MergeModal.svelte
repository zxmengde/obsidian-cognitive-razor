<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { getWorkbenchContext } from '../../bridge/context';
  import type { DuplicatePair, DuplicateMergePreview, DuplicateMergeDraft, DuplicateMergeImpact } from '../../../types';
  import ModalShell from '../../components/ModalShell.svelte';
  import Button from '../../components/Button.svelte';
  import TextInput from '../../components/TextInput.svelte';
  import InlineAlert from '../../components/InlineAlert.svelte';
  import { toSafeErrorFeedback, type UiFeedback } from '../../error-feedback';
  import { showActionFeedback } from '../../feedback';

  let { pair, initialPreview, onclose, onsuccess }: { pair: DuplicatePair; initialPreview?: DuplicateMergePreview; onclose: () => void; onsuccess: () => void } = $props();
  const ctx = getWorkbenchContext();
  const t = ctx.i18n.messages;
  const detailsToggleLabels = { expand: t.common.details.expand, collapse: t.common.details.collapse };
  const titleId = `cr-merge-title-${Math.random().toString(36).slice(2, 8)}`;
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
  let disposed = false;
  onDestroy(() => { disposed = true; impactGeneration++; });

  const nodeId = $derived(canonical === 'a' ? pair.nodeIdA : pair.nodeIdB);
  const nameA = $derived(ctx.application.duplicates.getConceptName(pair.nodeIdA) ?? pair.nodeIdA);
  const nameB = $derived(ctx.application.duplicates.getConceptName(pair.nodeIdB) ?? pair.nodeIdB);
  /** A long link list is truncated; the total count is never truncated. */
  const linkedPreview = $derived(impact?.linkedPaths.slice(0, 8) ?? []);
  const linkedRest = $derived(Math.max(0, (impact?.linkedPaths.length ?? 0) - linkedPreview.length));

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
    if (loading || confirming || value === canonical) return;
    canonical = value;
    void loadImpact();
  }

  onMount(() => { void loadImpact(); });

  async function prepare(): Promise<void> {
    if (loading || disposed) return;
    loading = true; feedback = null;
    const submittedNodeId = nodeId;
    const submittedPairId = pair.id;
    const submittedPath = ctx.application.duplicates.getConceptPath(submittedNodeId) ?? undefined;
    try {
      const result = await ctx.application.duplicates.startMerge(submittedPairId, submittedNodeId);
      if (result.ok) {
        showActionFeedback({ level: 'success', message: t.workbench.duplicates.queued }, submittedPath);
        if (!disposed) onclose();
      } else if (!disposed) feedback = toSafeErrorFeedback(result.error, t.workbench.notifications.mergeFailed);
    } catch (error) { if (!disposed) feedback = toSafeErrorFeedback(error, t.workbench.notifications.mergeFailed); }
    finally { loading = false; }
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
    <div class="cr-merge-actions">
      <Button variant="secondary" disabled={confirming} onclick={onclose}>{t.common.cancel}</Button>
      {#if preview}
        <Button variant="secondary" disabled={confirming} loading={loading} onclick={() => void prepare()}>{t.workbench.duplicates.regenerateDraft}</Button>
        <Button variant="danger" disabled={loading} loading={confirming} onclick={() => void confirm()}>{t.workbench.duplicates.confirmMerge}</Button>
      {:else}
        <Button variant="primary" loading={loading} disabled={!impact || impactLoading} onclick={() => void prepare()}>{t.workbench.duplicates.generateDraft}</Button>
      {/if}
    </div>
  {/snippet}
  <h3 id={titleId}>{t.workbench.duplicates.mergeTitle}</h3>
  {#if !preview}
    <p>{t.workbench.duplicates.chooseCanonical}</p>
    <div class="cr-merge-choice">
      <Button variant={canonical === 'a' ? 'primary' : 'secondary'} disabled={loading || impactLoading} onclick={() => chooseCanonical('a')}>{nameA}</Button>
      <Button variant={canonical === 'b' ? 'primary' : 'secondary'} disabled={loading || impactLoading} onclick={() => chooseCanonical('b')}>{nameB}</Button>
    </div>
    <div class="cr-merge-actions">
      <Button variant="ghost" onclick={() => openNote(pair.nodeIdA)}>{t.workbench.duplicates.openNote}</Button>
      <Button variant="ghost" onclick={() => openNote(pair.nodeIdB)}>{t.workbench.duplicates.openNote}</Button>
    </div>
    {#if impactLoading}
      <p class="cr-merge-impact__pending" role="status">{t.workbench.duplicates.impactLoading}</p>
    {:else if impact}
      <section class="cr-merge-impact" aria-label={t.workbench.duplicates.impactTitle}>
        <h4>{t.workbench.duplicates.impactTitle}</h4>
        <dl>
          <dt>{t.workbench.duplicates.impactKeep}</dt>
          <dd>{impact.canonical.name} · {impact.canonical.path}</dd>
          <dt>{t.workbench.duplicates.impactTrash}</dt>
          <dd>{impact.redundant.name} · {impact.redundant.path}</dd>
          <dt>{t.workbench.duplicates.impactRewrite}</dt>
          <dd>
            {#if impact.linkedPaths.length === 0}
              {t.workbench.duplicates.impactNoRewrite}
            {:else}
              {#each linkedPreview as path (path)}<span class="cr-merge-impact__path">{path}</span>{/each}
              {#if linkedRest > 0}<span class="cr-merge-impact__path">{ctx.i18n.format('workbench.duplicates.impactMore', { count: linkedRest })}</span>{/if}
              <span class="cr-merge-impact__count">{ctx.i18n.format('workbench.duplicates.impactLinkCount', { count: impact.linkReplacements })}</span>
            {/if}
          </dd>
          {#if impact.ambiguousLinks.length > 0}
            <dt>{t.workbench.duplicates.impactAmbiguous}</dt>
            <dd>{ctx.i18n.format('workbench.duplicates.impactLinkCount', { count: impact.ambiguousLinks.length })}</dd>
          {/if}
        </dl>
        <p class="cr-merge-impact__backup">{t.workbench.duplicates.impactBackup}</p>
      </section>
    {/if}
  {:else}
    <p>{nameA} / {nameB} · {Math.round(preview.similarity * 100)}%</p>
    <label>{t.workbench.duplicates.fieldName}<TextInput disabled={confirming || loading} value={name} onchange={(value) => { name = value; }} /></label>
    <label>{t.workbench.duplicates.fieldAliases}<TextInput disabled={confirming || loading} value={aliases} onchange={(value) => { aliases = value; }} /></label>
    <label>{t.workbench.duplicates.fieldTags}<TextInput disabled={confirming || loading} value={tags} onchange={(value) => { tags = value; }} /></label>
    <!-- One parent link per line: a single-line input would strip the newlines
         that separate multiple parents and silently merge them into one link. -->
    <label>{t.workbench.duplicates.fieldParents}<textarea bind:value={parents} rows="3" disabled={confirming || loading}></textarea></label>
    <label>{t.workbench.duplicates.fieldBody}<textarea bind:value={body} rows="14" disabled={confirming || loading}></textarea></label>
    {#if preview.draft.conflicts.length > 0}<InlineAlert level="warning" message={`${t.workbench.duplicates.conflicts}: ${preview.draft.conflicts.join('；')}`} {detailsToggleLabels} />{/if}
    <p>{t.workbench.duplicates.linkPreview}: {preview.linkRepairPlan.replacementCount} · {preview.linkRepairPlan.entries.length} {t.workbench.duplicates.files}</p>
    {#if preview.linkRepairPlan.skipped.length > 0}<p>{t.workbench.duplicates.skipped}: {preview.linkRepairPlan.skipped.length}</p>{/if}

  {/if}
  {#if feedback}<InlineAlert level={feedback.level} message={feedback.message} details={feedback.details} {detailsToggleLabels} />{/if}
</ModalShell>

<style>
  h3 { margin: 0 0 var(--cr-space-3); font-size: 1.3em; }
  p { color: var(--cr-text-muted); line-height: var(--cr-line-height-body); overflow-wrap: anywhere; }
  label { display: flex; flex-direction: column; gap: var(--cr-space-2); margin: var(--cr-space-4) 0; color: var(--cr-text-muted); }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; background: var(--cr-bg-base); color: var(--cr-text-normal); border: 1px solid var(--cr-border); border-radius: var(--cr-radius-sm); padding: 8px; font: inherit; }
  .cr-merge-choice, .cr-merge-actions { display: flex; gap: var(--cr-space-2); flex-wrap: wrap; }
  .cr-merge-choice :global(button) { height: auto; min-height: 36px; white-space: normal; overflow-wrap: anywhere; }
  .cr-merge-actions { justify-content: flex-end; }
  .cr-merge-choice + .cr-merge-actions { margin-top: var(--cr-space-3); justify-content: flex-start; }
  .cr-merge-impact { margin-top: var(--cr-space-4); padding: var(--cr-space-3); border: 1px solid var(--cr-border); border-radius: var(--cr-radius-sm); background: var(--cr-bg-secondary); }
  .cr-merge-impact h4 { margin: 0 0 var(--cr-space-2); font-size: var(--cr-font-sm); font-weight: 600; color: var(--cr-text-normal); }
  .cr-merge-impact dl { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: var(--cr-space-1) var(--cr-space-3); margin: 0; font-size: var(--cr-font-sm); }
  .cr-merge-impact dt { color: var(--cr-text-muted); }
  .cr-merge-impact dd { margin: 0; color: var(--cr-text-normal); overflow-wrap: anywhere; }
  .cr-merge-impact__path { display: block; }
  .cr-merge-impact__count { display: block; color: var(--cr-text-muted); font-size: var(--cr-font-xs); }
  .cr-merge-impact__backup { margin: var(--cr-space-2) 0 0; font-size: var(--cr-font-xs); }
  .cr-merge-impact__pending { margin-top: var(--cr-space-4); font-size: var(--cr-font-sm); }
</style>
