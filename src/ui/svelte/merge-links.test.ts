import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { I18n } from "../../core/i18n";
import { ok, type DuplicateMergeDraft, type DuplicatePair } from "../../types";

let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  MergeHost: unknown;
};
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as MergeHost } from "merge-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "MergeLinksTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "merge-host", setup(builder) {
      builder.onResolve({ filter: /^merge-host$/ }, () => ({ path: "merge-host", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Merge from "./src/ui/svelte/workbench/MergeModal.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, pair, onsuccess, onclose } = $props(); setWorkbenchContext(context);</script><Merge {pair} {onsuccess} {onclose} />',
        { filename: "MergeHost.svelte", css: "injected" },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return MergeLinksTestUI;`)();
});

afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "empty"); });

function fixture() {
  const pair: DuplicatePair = { id: "a--b", nodeIdA: "a", nodeIdB: "b", type: "entity", similarity: 0.9, status: "pending" };
  const draft: DuplicateMergeDraft = {
    pairId: pair.id, canonicalNodeId: "a", redundantNodeId: "b", canonicalContentHash: "a-hash", redundantContentHash: "b-hash",
    name: "Same", body: "body", aliases: [], tags: [], parents: ["[[Domain/A, B]]", "[[Domain/Remove]]"], sourceUids: [], conflicts: [],
  };
  const paths = new Map([["a", "Current/Same.md"], ["b", "Archive/Same.md"]]);
  const openLinkText = vi.fn(async (_path: string, _source: string, _newLeaf: boolean) => undefined);
  const getConceptPath = vi.fn((id: string) => paths.get(id) ?? null);
  const prepareMerge = vi.fn(async () => ok({ draft, similarity: 0.9, linkRepairPlan: { entries: [], skipped: [], replacementCount: 0 } }));
  const confirmMerge = vi.fn(async (_draft: DuplicateMergeDraft, _plan: unknown) => ok({}));
  const context = { i18n: new I18n(), app: { workspace: { openLinkText } }, application: { duplicates: { getConceptName: () => "Same", getConceptPath, prepareMerge, confirmMerge } } };
  return { pair, draft, paths, openLinkText, getConceptPath, prepareMerge, confirmMerge, context };
}

describe("Merge dialog link fidelity", () => {
  it("opens each human-review candidate by its current CRUID path and preserves comma parents after edits", async () => {
    const f = fixture();
    const target = document.body.appendChild(document.createElement("div"));
    const onsuccess = vi.fn();
    const instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, onclose: vi.fn(), onsuccess } });
    try {
      ui.flushSync();
      const labels = f.context.i18n.messages.workbench.duplicates;
      const open = Array.from(target.querySelectorAll("button")).filter((button) => button.textContent?.trim() === labels.openNote);
      expect(open).toHaveLength(2);
      open[0].click(); open[1].click();
      expect(f.openLinkText.mock.calls).toEqual([["Current/Same.md", "", true], ["Archive/Same.md", "", true]]);
      f.paths.set("b", "Moved/Same.md");
      open[1].click();
      expect(f.openLinkText).toHaveBeenLastCalledWith("Moved/Same.md", "", true);
      expect(f.prepareMerge).not.toHaveBeenCalled();
      Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.trim() === labels.generateDraft)!.click();
      await vi.waitFor(() => { ui.flushSync(); expect(target.querySelectorAll("textarea")).toHaveLength(2); });
      const parents = target.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(parents.value).toBe("[[Domain/A, B]]\n[[Domain/Remove]]");
      parents.value = "[[Domain/A, B]]\n[[Domain/User Replacement]]\n[[Domain/A, B]]";
      parents.dispatchEvent(new Event("input", { bubbles: true }));
      ui.flushSync();
      Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.trim() === labels.confirmMerge)!.click();
      await vi.waitFor(() => expect(f.confirmMerge).toHaveBeenCalledOnce());
      expect(f.confirmMerge.mock.calls[0][0]).toMatchObject({ parents: ["[[Domain/A, B]]", "[[Domain/User Replacement]]"] });
      await vi.waitFor(() => expect(onsuccess).toHaveBeenCalledOnce());
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("does not guess a same-name note when a CRUID no longer resolves", async () => {
    const f = fixture();
    f.paths.delete("a");
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, onclose: vi.fn(), onsuccess: vi.fn() } });
    try {
      ui.flushSync();
      Array.from(target.querySelectorAll("button")).find((button) => button.textContent?.trim() === f.context.i18n.messages.workbench.duplicates.openNote)!.click();
      ui.flushSync();
      expect(f.getConceptPath).toHaveBeenCalledWith("a");
      expect(f.openLinkText).not.toHaveBeenCalled();
      expect(f.prepareMerge).not.toHaveBeenCalled();
      expect(target.textContent).toContain("资源或对象不存在");
    } finally { await ui.unmount(instance); target.remove(); }
  });
});
