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
  noticeMessages: Array<{ message: string }>;
};
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { noticeMessages } from "obsidian"; export { default as MergeHost } from "merge-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "MergeLinksTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "merge-host", setup(builder) {
      builder.onResolve({ filter: /^merge-host$/ }, () => ({ path: "merge-host", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Merge from "./src/ui/svelte/workbench/MergeModal.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, pair, initialPreview, onsuccess, onclose } = $props(); setWorkbenchContext(context);</script><Merge {pair} {initialPreview} {onsuccess} {onclose} />',
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
  const startMerge = vi.fn(async () => ok("merge-workflow"));
  const preview = { pairId: pair.id, type: pair.type, canonical: { nodeId: "a", path: paths.get("a")! }, redundant: { nodeId: "b", path: paths.get("b")! }, draft, similarity: .9, linkRepairPlan: { entries: [], skipped: [], replacementCount: 0 } };
  const confirmMerge = vi.fn(async (_draft: DuplicateMergeDraft, _plan: unknown) => ok({}));
  const context = { i18n: new I18n(), app: { workspace: { openLinkText } }, application: { duplicates: { getConceptName: () => "Same", getConceptPath, startMerge, prepareMerge, confirmMerge } } };
  return { pair, draft, preview, paths, openLinkText, getConceptPath, startMerge, prepareMerge, confirmMerge, context };
}

describe("Merge dialog link fidelity", () => {
  it("closes after durable queue acceptance without waiting for a model preview", async () => {
    const f = fixture();
    const startMerge = vi.fn(async () => ok("merge-workflow"));
    Object.assign(f.context.application.duplicates, { startMerge });
    const target = document.body.appendChild(document.createElement("div"));
    const onclose = vi.fn();
    const instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, onclose, onsuccess: vi.fn() } });
    try {
      ui.flushSync();
      document.body.querySelector<HTMLButtonElement>(".cr-modal-footer .cr-btn-primary")!.click();
      document.body.querySelector<HTMLButtonElement>(".cr-modal-footer .cr-btn-primary")!.click();
      await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
      expect(startMerge).toHaveBeenCalledWith(f.pair.id, "a");
      expect(startMerge).toHaveBeenCalledOnce();
      expect(f.prepareMerge).not.toHaveBeenCalled();
      expect(ui.noticeMessages.at(-1)?.message).toContain("Current/Same.md：合并稿生成已加入任务队列");
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("portals into the owning window, retains keyboard focus and removes the overlay on teardown", async () => {
    const f = fixture();
    const frame = document.body.appendChild(document.createElement('iframe'));
    const owner = frame.contentDocument!;
    const opener = owner.body.appendChild(owner.createElement('button'));
    opener.focus();
    const pane = owner.body.appendChild(owner.createElement('div'));
    pane.style.cssText = 'width: 360px; container-type: inline-size; overflow: hidden; transform: translateX(0)';
    const onclose = vi.fn();
    const instance = ui.mount(ui.MergeHost, { target: pane, props: { context: f.context, pair: f.pair, onclose, onsuccess: vi.fn() } });
    try {
      ui.flushSync();
      const overlay = owner.querySelector('.cr-modal-overlay')!;
      expect(overlay.parentElement).toBe(owner.body);
      expect(overlay.classList.contains('cr-scope')).toBe(true);
      expect(pane.querySelector('[role="dialog"]')).toBeNull();
      expect(overlay.querySelector('.cr-modal-footer .cr-btn-primary')).not.toBeNull();
      expect(overlay.querySelector('.cr-modal-content .cr-modal-footer')).toBeNull();
      await vi.waitFor(() => expect(overlay.contains(owner.activeElement)).toBe(true));
      const buttons = overlay.querySelectorAll<HTMLButtonElement>('button');
      buttons[buttons.length - 1].focus();
      buttons[buttons.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(owner.activeElement).toBe(buttons[0]);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      expect(onclose).not.toHaveBeenCalled();
      frame.contentWindow!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      expect(onclose).toHaveBeenCalledOnce();
    } finally {
      await ui.unmount(instance);
      expect(owner.querySelector('.cr-modal-overlay')).toBeNull();
      await vi.waitFor(() => expect(owner.activeElement).toBe(opener));
      frame.remove();
    }
  });

  it("does not reopen or cancel an accepted submission after the user closes the dialog", async () => {
    const f = fixture();
    const result = ok("merge-workflow");
    let release!: (value: typeof result) => void;
    f.startMerge.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const target = document.body.appendChild(document.createElement('div'));
    const onsuccess = vi.fn();
    const instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, onclose: vi.fn(), onsuccess } });
    ui.flushSync();
    document.body.querySelector<HTMLButtonElement>('.cr-modal-footer .cr-btn-primary')!.click();
    ui.flushSync();
    expect(f.startMerge).toHaveBeenCalledOnce();
    await ui.unmount(instance);
    release(result); await Promise.resolve(); ui.flushSync();
    expect(document.body.querySelector('.cr-modal-overlay')).toBeNull();
    expect(f.confirmMerge).not.toHaveBeenCalled(); expect(onsuccess).not.toHaveBeenCalled();
    target.remove();
  });

  it("locks every draft field until the merge commit resolves and restores edits on failure", async () => {
    const f = fixture();
    let rejectCommit!: (reason: unknown) => void;
    f.confirmMerge.mockImplementation(() => new Promise((_resolve, reject) => { rejectCommit = reject; }));
    const target = document.body.appendChild(document.createElement("div"));
    const onsuccess = vi.fn();
    const instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, initialPreview: f.preview, onclose: vi.fn(), onsuccess } });
    const labels = f.context.i18n.messages.workbench.duplicates;
    const click = (text: string) => Array.from(document.body.querySelectorAll("button")).find(button => button.textContent?.trim() === text)!.click();
    try {
      ui.flushSync(); expect(document.body.querySelectorAll("textarea")).toHaveLength(2);
      const name = document.body.querySelector("input")!;
      name.value = "Human reviewed name";
      name.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync(); click(labels.confirmMerge); ui.flushSync();
      expect(f.confirmMerge).toHaveBeenCalledOnce();
      expect(f.confirmMerge.mock.calls[0][0].name).toBe("Human reviewed name");
      expect(Array.from(document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).every(field => field.disabled)).toBe(true);
      rejectCommit(new Error("synthetic private upstream body"));
      await vi.waitFor(() => { ui.flushSync(); expect(name.disabled).toBe(false); });
      expect(name.value).toBe("Human reviewed name");
      expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
      expect(document.body.textContent).not.toContain("synthetic private upstream body");
      expect(onsuccess).not.toHaveBeenCalled();
    } finally { rejectCommit?.(new Error("test cleanup")); await ui.unmount(instance); target.remove(); }
  });

  it("opens each human-review candidate by its current CRUID path and preserves comma parents after edits", async () => {
    const f = fixture();
    const target = document.body.appendChild(document.createElement("div"));
    const onsuccess = vi.fn();
    let instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, onclose: vi.fn(), onsuccess } });
    try {
      ui.flushSync();
      const labels = f.context.i18n.messages.workbench.duplicates;
      const open = Array.from(document.body.querySelectorAll("button")).filter((button) => button.textContent?.trim() === labels.openNote);
      expect(open).toHaveLength(2);
      open[0].click(); open[1].click();
      expect(f.openLinkText.mock.calls).toEqual([["Current/Same.md", "", true], ["Archive/Same.md", "", true]]);
      f.paths.set("b", "Moved/Same.md");
      open[1].click();
      expect(f.openLinkText).toHaveBeenLastCalledWith("Moved/Same.md", "", true);
      expect(f.prepareMerge).not.toHaveBeenCalled();
      await ui.unmount(instance);
      instance = ui.mount(ui.MergeHost, { target, props: { context: f.context, pair: f.pair, initialPreview: f.preview, onclose: vi.fn(), onsuccess } });
      ui.flushSync(); expect(document.body.querySelectorAll("textarea")).toHaveLength(2);
      const parents = document.body.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(parents.value).toBe("[[Domain/A, B]]\n[[Domain/Remove]]");
      parents.value = "[[Domain/A, B]]\n[[Domain/User Replacement]]\n[[Domain/A, B]]";
      parents.dispatchEvent(new Event("input", { bubbles: true }));
      ui.flushSync();
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === labels.confirmMerge)!.click();
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
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === f.context.i18n.messages.workbench.duplicates.openNote)!.click();
      ui.flushSync();
      expect(f.getConceptPath).toHaveBeenCalledWith("a");
      expect(f.openLinkText).not.toHaveBeenCalled();
      expect(f.prepareMerge).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("资源或对象不存在");
    } finally { await ui.unmount(instance); target.remove(); }
  });
});
