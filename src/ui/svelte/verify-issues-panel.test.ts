import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { I18n } from "../../core/i18n";
import { makeVerificationReportBlock } from "../../core/verification-report";

let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  PanelHost: unknown;
};

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as PanelHost } from "panel-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "VerifyIssuesTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "panel-host", setup(builder) {
      builder.onResolve({ filter: /^panel-host$/ }, () => ({ path: "panel-host", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Panel from "./src/ui/svelte/workbench/VerifyIssuesPanel.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, activeFile } = $props(); setWorkbenchContext(context);</script><Panel {activeFile} />',
        { filename: "PanelHost.svelte", css: "injected" },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return VerifyIssuesTestUI;`)();
});

afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "empty"); });

const REPORT = "### 需要修改或核实的问题\n\n1. “所有金属都导电”过于绝对。\n   - 最小修正：改为“多数金属导电”。\n2. 「特性」一节缺少来源。";

function fixture() {
  let text = `---\ncruid: a\n---\n\n## 定义\n\n所有金属都导电。\n\n## 特性\n\n数值。\n\n<!-- cognitive-razor:verify-report -->\n${makeVerificationReportBlock(REPORT, Date.UTC(2026, 10, 10))}\n<!-- /cognitive-razor:verify-report -->\n`;
  const file = { path: "C/Metal.md", extension: "md" };
  const editor = { setCursor: vi.fn(), scrollIntoView: vi.fn() };
  const leaf = { view: { file, editor }, openFile: vi.fn(async () => undefined) };
  const vault = {
    cachedRead: vi.fn(async () => text),
    on: vi.fn(() => ({})),
    offref: vi.fn(),
    process: vi.fn(async (_file: unknown, fn: (current: string) => string) => { text = fn(text); return text; }),
  };
  const workspace = { getLeavesOfType: vi.fn(() => [leaf]), getLeaf: vi.fn(), setActiveLeaf: vi.fn() };
  const context = { i18n: new I18n(), app: { vault, workspace } };
  return { file, leaf, editor, vault, context, read: () => text, edit: (next: string) => { text = next; } };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  ui.flushSync();
}

describe("Verify issues panel", () => {
  it("lists report issues and jumps to the quoted text in the open editor", async () => {
    const f = fixture();
    const target = document.createElement("div");
    const instance = ui.mount(ui.PanelHost, { target, props: { context: f.context, activeFile: f.file } });
    await settle();
    const titles = [...target.querySelectorAll(".cr-verify-issue-title")].map(node => node.textContent);
    expect(titles).toEqual(["“所有金属都导电”过于绝对。", "「特性」一节缺少来源。"]);
    expect(target.textContent).toContain("0/2 已处理");

    (target.querySelectorAll<HTMLButtonElement>(".cr-verify-issue")[0]).click();
    await settle();
    const line = f.read().split("\n").indexOf("所有金属都导电。");
    expect(f.leaf.openFile).toHaveBeenCalledWith(f.file, { active: true, eState: { line } });
    expect(f.editor.setCursor).toHaveBeenCalledWith({ line, ch: 0 });
    expect(f.vault.process).not.toHaveBeenCalled();
    await ui.unmount(instance);
  });

  it("writes the resolved mark into the report and refuses a stale toggle", async () => {
    const f = fixture();
    const target = document.createElement("div");
    const instance = ui.mount(ui.PanelHost, { target, props: { context: f.context, activeFile: f.file } });
    await settle();
    const boxes = () => target.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    const check = (box: HTMLInputElement) => { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); };
    check(boxes()[0]);
    await settle();
    expect(f.read()).toContain("1. [x] “所有金属都导电”过于绝对。");
    expect(target.textContent).toContain("1/2 已处理");

    // 用户在面板刷新前改掉了第二条：写回必须放弃，不覆盖。
    const edited = f.read().replace("2. 「特性」一节缺少来源。", "2. 用户改写的条目");
    f.edit(edited);
    check(boxes()[1]);
    await settle();
    expect(f.read()).toBe(edited);
    expect(target.textContent).toContain("报告已被修改，请重试。");
    await ui.unmount(instance);
  });
});
