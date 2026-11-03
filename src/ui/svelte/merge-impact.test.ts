import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { compile } from 'svelte/compiler';
import { I18n } from '../../core/i18n';
import { err, ok, type DuplicateMergeImpact, type DuplicatePair } from '../../types';

let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  MergeHost: unknown;
};

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'empty', { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as MergeHost } from "merge-impact-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'MergeImpactUI',
    conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'],
    alias: { obsidian: './__mocks__/obsidian.ts', '@': './src' },
    plugins: [{ name: 'merge-impact-host', setup(builder) {
      builder.onResolve({ filter: /^merge-impact-host$/ }, () => ({ path: 'merge-impact-host', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Merge from "./src/ui/svelte/workbench/MergeModal.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, pair, initialPreview, onsuccess, onclose } = $props(); setWorkbenchContext(context);</script><Merge {pair} {initialPreview} {onsuccess} {onclose} />',
        { filename: 'MergeHost.svelte', css: 'injected' },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: 'injected' } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return MergeImpactUI;`)();
});
afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, 'empty'); });

const pair: DuplicatePair = { id: 'a--b', nodeIdA: 'a', nodeIdB: 'b', type: 'entity', similarity: 0.9, status: 'pending' };

function impactFor(nodeId: string, extra: Partial<DuplicateMergeImpact> = {}): DuplicateMergeImpact {
  const keepA = nodeId === 'a';
  return {
    pairId: pair.id, type: pair.type, similarity: 0.9,
    canonical: { nodeId, path: keepA ? 'Current/Same.md' : 'Archive/Same.md', name: keepA ? 'Primary note' : 'Secondary note' },
    redundant: { nodeId: keepA ? 'b' : 'a', path: keepA ? 'Archive/Same.md' : 'Current/Same.md', name: keepA ? 'Secondary note' : 'Primary note' },
    linkedPaths: ['Notes/First.md'], linkReplacements: 2, ambiguousLinks: [], ...extra,
  };
}

function harness(impactResult: (nodeId: string) => ReturnType<typeof ok<DuplicateMergeImpact>> | ReturnType<typeof err>) {
  const i18n = new I18n();
  const previewMergeImpact = vi.fn(async (_pairId: string, nodeId: string) => impactResult(nodeId));
  const startMerge = vi.fn(async () => ok('merge-workflow'));
  const context = {
    i18n,
    app: { workspace: { openLinkText: vi.fn() } },
    application: { duplicates: {
      getConceptName: () => 'Same',
      getConceptPath: (id: string) => (id === 'a' ? 'Current/Same.md' : 'Archive/Same.md'),
      previewMergeImpact, startMerge, confirmMerge: vi.fn(async () => ok({})),
    } },
  };
  return { i18n, context, previewMergeImpact, startMerge };
}

const bodyText = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const primary = () => document.body.querySelector<HTMLButtonElement>('.cr-modal-footer .cr-btn-primary')!;

describe('merge impact preview before any merge work', () => {
  it('lists the notes to keep, trash and rewrite, and blocks generation until the preview arrives', async () => {
    const h = harness((nodeId) => ok(impactFor(nodeId, { linkedPaths: ['Notes/First.md', 'Notes/Second.md'], linkReplacements: 5 })));
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.MergeHost, { target, props: { context: h.context, pair, onclose: vi.fn(), onsuccess: vi.fn() } });
    try {
      ui.flushSync();
      expect(primary().disabled).toBe(true);
      expect(h.previewMergeImpact).toHaveBeenCalledExactlyOnceWith(pair.id, 'a');
      await vi.waitFor(() => { ui.flushSync(); expect(primary().disabled).toBe(false); });

      const labels = h.i18n.messages.workbench.duplicates;
      expect(bodyText()).toContain(labels.impactTitle);
      expect(bodyText()).toContain(`Primary note · Current/Same.md`);
      expect(bodyText()).toContain(`Secondary note · Archive/Same.md`);
      expect(bodyText()).toContain('Notes/First.md');
      expect(bodyText()).toContain('Notes/Second.md');
      expect(bodyText()).toContain(h.i18n.format('workbench.duplicates.impactLinkCount', { count: 5 }));
      // The backup covers settings and runtime data, never note bodies.
      expect(bodyText()).toContain(labels.impactBackup);
      expect(h.startMerge).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it('reloads the preview when the user keeps the other note', async () => {
    const h = harness((nodeId) => ok(impactFor(nodeId)));
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.MergeHost, { target, props: { context: h.context, pair, onclose: vi.fn(), onsuccess: vi.fn() } });
    try {
      ui.flushSync();
      await vi.waitFor(() => { ui.flushSync(); expect(primary().disabled).toBe(false); });
      const choice = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.cr-merge-choice button'));
      expect(choice).toHaveLength(2);
      choice[1].click();
      ui.flushSync();
      expect(h.previewMergeImpact).toHaveBeenLastCalledWith(pair.id, 'b');
      // Keeping the other note swaps which one is rewritten and which is trashed.
      await vi.waitFor(() => { ui.flushSync(); expect(bodyText()).toContain('Secondary note · Archive/Same.md'); });
      expect(bodyText()).toContain('Primary note · Current/Same.md');
      expect(primary().disabled).toBe(false);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it('reports an unreadable impact and keeps the draft request disabled', async () => {
    const h = harness(() => err('E311_NOT_FOUND', 'private note body'));
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.MergeHost, { target, props: { context: h.context, pair, onclose: vi.fn(), onsuccess: vi.fn() } });
    try {
      ui.flushSync();
      await vi.waitFor(() => { ui.flushSync(); expect(document.body.querySelector('[role="alert"]')).not.toBeNull(); });
      expect(bodyText()).not.toContain('private note body');
      expect(primary().disabled).toBe(true);
      expect(h.startMerge).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });
});
