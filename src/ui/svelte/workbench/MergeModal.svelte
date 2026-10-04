<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { getWorkbenchContext } from '../../bridge/context';
  import type { DuplicatePair, DuplicateMergePreview, DuplicateMergeDraft } from '../../../types';
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
  let loading = $state(false);
  let confirming = $state(false);
  let feedback = $state<UiFeedback | null>(null);
  let body = $state(untrack(() => initialPreview?.draft.body ?? ''));
  let name = $state(untrack(() => initialPreview?.draft.name ?? ''));
  let aliases = $state(untrack(() => initialPreview?.draft.aliases.join(', ') ?? ''));
  let tags = $state(untrack(() => initialPreview?.draft.tags.join(', ') ?? ''));
  let parents = $state(untrack(() => initialPreview?.draft.parents.join('\n') ?? ''));
  let disposed = false;
  onDestroy(() => { disposed = true; });

  const nodeId = $derived(canonical === 'a' ? pair.nodeIdA : pair.nodeIdB);
  const nameA = $derived(ctx.application.duplicates.getConceptName(pair.nodeIdA) ?? pair.nodeIdA);
  const nameB = $derived(ctx.application.duplicates.getConceptName(pair.nodeIdB) ?? pair.nodeIdB);

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
        <Button variant="primary" loading={loading} onclick={() => void prepare()}>{t.workbench.duplicates.generateDraft}</Button>
      {/if}
    </div>
  {/snippet}
  <h3 id={titleId}>{t.workbench.duplicates.mergeTitle}</h3>
  {#if !preview}
    <p>{t.workbench.duplicates.chooseCanonical}</p>
    <div class="cr-merge-choice">
      <Button variant={canonical === 'a' ? 'primary' : 'secondary'} disabled={loading} onclick={() => { canonical = 'a'; }}>{nameA}</Button>
      <Button variant={canonical === 'b' ? 'primary' : 'secondary'} disabled={loading} onclick={() => { canonical = 'b'; }}>{nameB}</Button>
    </div>
    <div class="cr-merge-actions">
      <Button variant="ghost" onclick={() => openNote(pair.nodeIdA)}>{t.workbench.duplicates.openNote}</Button>
      <Button variant="ghost" onclick={() => openNote(pair.nodeIdB)}>{t.workbench.duplicates.openNote}</Button>
    </div>
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
</style>
