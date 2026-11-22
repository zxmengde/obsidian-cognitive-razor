import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { I18n } from "../../core/i18n";
import { generateFrontmatter, generateMarkdownContent } from "../../core/frontmatter-utils";
import { CR_TYPES } from "../../types";
import { DEFAULT_SETTINGS } from "../../data/settings-store";

// Compile the actual components with the production compiler and exercise DOM
// events, including propagation to ModalShell's window listener.
let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  ConfirmModal: unknown;
  CreateHost: unknown;
  noticeMessages: Array<{ message: string; timeout?: number }>;
};
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { noticeMessages } from "obsidian"; export { default as ConfirmModal } from "./src/ui/components/ConfirmModal.svelte"; export { default as CreateHost } from "test-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "KeyboardTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "test-host", setup(builder) {
      builder.onResolve({ filter: /^test-host$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Create from "./src/ui/svelte/workbench/CreateSection.svelte"; import Note from "./src/ui/svelte/workbench/CurrentNoteSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, activeFile = null } = $props(); setWorkbenchContext(context); export function setActiveFile(file) { activeFile = file; }</script><Create /><Note {activeFile} />',
        { filename: "TestHost.svelte", css: "injected" },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return KeyboardTestUI;`)();
});
afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "empty"); });

describe("keyboard interaction safety", () => {
  it('presents note actions as labelled buttons and preserves expansion, focus and busy locks', async () => {
    let releaseVerify!: (value: unknown) => void;
    let releaseCards!: (value: unknown) => void;
    const verify = vi.fn(() => new Promise(resolve => { releaseVerify = resolve; }));
    const cards = vi.fn(() => new Promise(resolve => { releaseCards = resolve; }));
    const prepare = vi.fn(async () => ({ ok: false, error: { code: 'E101_INVALID_INPUT' } }));
    const target = document.body.appendChild(document.createElement('div'));
    const i18n = new I18n();
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Synthetic.md', basename: 'Synthetic', extension: 'md' }, context: {
      i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {}, cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'synthetic', type: 'entity', name: 'Synthetic' }), '') } },
      application: { expand: { prepare }, verify: { start: verify }, cards: { start: cards }, queue: { subscribe: () => () => {}, getSnapshot: () => ({ tasks: [] }) } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const actions = target.querySelectorAll<HTMLButtonElement>('.cr-note-action');
      expect(actions).toHaveLength(3);
      expect(Array.from(actions, button => button.textContent?.trim())).toEqual([i18n.messages.workbench.product.expandTitle, i18n.messages.workbench.buttons.verify, i18n.messages.cards.generate]);
      expect(target.querySelector('.cr-note-action-description')).toBeNull();
      expect(Array.from(actions, button => button.title)).toEqual([i18n.messages.workbench.product.expandDesc, i18n.messages.workbench.product.verifyDesc, i18n.messages.workbench.product.cardsDesc]);
      for (const button of Array.from(actions)) {
        expect(button.tagName).toBe('BUTTON'); expect(button.type).toBe('button');
        expect(button.classList.contains('cr-btn-secondary')).toBe(true);
        expect(button.closest('details, summary')).toBeNull(); expect(button.querySelector('svg')).toBeNull();
        expect(button.hasAttribute('aria-describedby')).toBe(false);
        button.focus(); expect(document.activeElement).toBe(button);
      }
      actions[0].click(); ui.flushSync();
      expect(actions[0].getAttribute('aria-expanded')).toBe('true'); expect(prepare).toHaveBeenCalledOnce();
      actions[0].click(); ui.flushSync(); expect(actions[0].getAttribute('aria-expanded')).toBe('false');
      expect(target.querySelector('.cr-inline-panel--expanded')).toBeNull();
      actions[1].click(); actions[1].click(); ui.flushSync();
      expect(verify).toHaveBeenCalledExactlyOnceWith('Synthetic.md');
      expect(actions[1].disabled).toBe(true); expect(actions[1].getAttribute('aria-busy')).toBe('true');
      releaseVerify({ ok: true, value: 'verify-workflow' });
      await vi.waitFor(() => { ui.flushSync(); expect(actions[1].disabled).toBe(false); });
      actions[2].click(); actions[2].click(); ui.flushSync();
      expect(cards).toHaveBeenCalledExactlyOnceWith('Synthetic.md');
      expect(actions[2].disabled).toBe(true); expect(actions[2].getAttribute('aria-busy')).toBe('true');
      releaseCards({ ok: true, value: 'Synthetic-decks.md' });
      await vi.waitFor(() => { ui.flushSync(); expect(actions[2].disabled).toBe(false); });
      expect(actions[1].hasAttribute('aria-expanded')).toBe(false); expect(actions[2].hasAttribute('aria-expanded')).toBe(false);
    } finally {
      releaseVerify?.({ ok: false, error: { code: 'E101_INVALID_INPUT' } });
      releaseCards?.({ ok: false, error: { code: 'E101_INVALID_INPUT' } });
      await ui.unmount(instance); target.remove();
    }
  });

  it('keeps one input and action row, follows note changes without automatic requests, and preserves the draft', async () => {
    const define = vi.fn(async () => ({ ok: false, error: { code: 'E101_INVALID_INPUT' } }));
    const verify = vi.fn(async () => ({ ok: false, error: { code: 'E101_INVALID_INPUT' } }));
    const cards = vi.fn(async () => ({ ok: true, value: 'Second-decks.md' }));
    const prepare = vi.fn(async () => ({ ok: false, error: { code: 'E101_INVALID_INPUT' } }));
    const target = document.body.appendChild(document.createElement('div'));
    const i18n = new I18n();
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Synthetic.md', basename: 'Synthetic', extension: 'md' }, context: {
      i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {}, cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'synthetic', type: 'entity', name: 'Synthetic' }), '') } },
      application: { create: { define }, expand: { prepare }, verify: { start: verify }, cards: { start: cards }, queue: { subscribe: () => () => {}, getSnapshot: () => ({ tasks: [] }) } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const input = target.querySelector<HTMLInputElement>('.cr-search-input')!;
      const submit = target.querySelector<HTMLButtonElement>('.cr-search-row > .cr-btn-primary')!;
      expect(submit.disabled).toBe(true);
      expect(input.parentElement?.contains(submit)).toBe(false);
      input.value = '保留的概念'; input.dispatchEvent(new Event('input')); ui.flushSync();
      expect(submit.disabled).toBe(false);
      const clearButton = target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.messages.workbench.createConcept.clear}"]`)!;
      expect(getComputedStyle(clearButton).position).toBe('absolute');
      expect(target.querySelector('[role="tablist"], [role="tab"], [role="tabpanel"]')).toBeNull();
      expect(target.querySelector('.cr-create-heading, .cr-create-intro, .cr-create-help')).toBeNull();
      // 当前笔记区独立成块，标明操作对象。
      expect(target.querySelector('.cr-current-note__name')?.textContent).toBe('Synthetic');
      expect(target.textContent).not.toContain('想理解什么？');
      expect(target.textContent).not.toContain('输入一个概念，先看看适合如何整理。');
      expect(target.textContent).not.toContain('识别后由你选择类型，再创建笔记');
      const actions = target.querySelector<HTMLElement>('.cr-note-actions')!;
      expect(actions.querySelectorAll('button')).toHaveLength(3);
      expect(verify).not.toHaveBeenCalled(); expect(cards).not.toHaveBeenCalled(); expect(define).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
      (instance as { setActiveFile(file: unknown): void }).setActiveFile({ path: 'Second.md', basename: 'Second', extension: 'md' }); ui.flushSync();
      await Promise.resolve(); ui.flushSync();
      expect(verify).not.toHaveBeenCalled(); expect(cards).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
      const buttons = actions.querySelectorAll<HTMLButtonElement>('button');
      buttons[1].click();
      await vi.waitFor(() => { ui.flushSync(); expect(buttons[1].disabled).toBe(false); });
      expect(verify).toHaveBeenCalledExactlyOnceWith('Second.md');
      buttons[2].click();
      await vi.waitFor(() => { ui.flushSync(); expect(buttons[2].disabled).toBe(false); });
      expect(cards).toHaveBeenCalledExactlyOnceWith('Second.md');
      buttons[0].click(); ui.flushSync();
      expect(prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: 'Second.md' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); ui.flushSync();
      expect(buttons[0].getAttribute('aria-expanded')).toBe('false');
      expect(target.querySelector('.cr-inline-panel--expanded')).toBeNull();
      expect(define).not.toHaveBeenCalled();
      input.value = ' 保留的概念 '; input.dispatchEvent(new Event('input')); ui.flushSync();
      submit.click();
      await vi.waitFor(() => { ui.flushSync(); expect(input.disabled).toBe(false); });
      expect(define).toHaveBeenCalledExactlyOnceWith('保留的概念', expect.any(AbortSignal));
      expect(input.value).toBe(' 保留的概念 ');
      // 没有可操作的知识节点时不摆出禁用按钮，只给一行说明。
      (instance as { setActiveFile(file: unknown): void }).setActiveFile(null); ui.flushSync();
      expect(target.querySelectorAll('.cr-note-actions button')).toHaveLength(0);
      expect(target.querySelector('.cr-current-note .cr-section-hint')?.textContent).toBe(i18n.messages.workbench.product.noNoteHint);
      expect(input.value).toBe(' 保留的概念 ');
      (instance as { setActiveFile(file: unknown): void }).setActiveFile({ path: 'Image.png', extension: 'png' }); ui.flushSync();
      expect(target.querySelectorAll('.cr-note-actions button')).toHaveLength(0);
      expect(target.querySelector('.cr-current-note .cr-section-hint')?.textContent).toBe(i18n.messages.workbench.product.noNoteHint);
      expect(prepare).toHaveBeenCalledOnce(); expect(verify).toHaveBeenCalledOnce(); expect(cards).toHaveBeenCalledOnce(); expect(define).toHaveBeenCalledOnce();
      target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.messages.workbench.createConcept.clear}"]`)!.click(); ui.flushSync();
      expect(input.value).toBe(''); expect(submit.disabled).toBe(true);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it('keeps the missing-provider warning and blocks both Define click and Enter after removing guidance', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    const define = vi.fn();
    const i18n = new I18n();
    const instance = ui.mount(ui.CreateHost, { target, props: { context: {
      i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined }, create: { define } },
      settingsApplication: { getSettings: () => structuredClone(DEFAULT_SETTINGS), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      const input = target.querySelector<HTMLInputElement>('.cr-search-input')!;
      input.value = '概念'; input.dispatchEvent(new Event('input')); ui.flushSync();
      expect(target.querySelector('[role="status"]')?.textContent).toBe(i18n.messages.workbench.product.notConfigured);
      const submit = target.querySelector<HTMLButtonElement>('.cr-search-row > .cr-btn-primary')!;
      expect(submit.disabled).toBe(true); submit.click();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect(define).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each([
    { name: 'no service at all', withService: false, hint: false },
    { name: 'define works but cards has a broken override', withService: true, hint: true },
  ])('disables note actions whose task has no usable model ($name)', async ({ withService, hint }) => {
    const target = document.body.appendChild(document.createElement('div'));
    const i18n = new I18n();
    const verify = vi.fn(); const cards = vi.fn();
    const settings = structuredClone(DEFAULT_SETTINGS);
    if (withService) {
      settings.providers.svc = { apiKey: '', baseUrl: 'http://127.0.0.1:9/v1', apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat', defaultEmbedModel: 'embed', enabled: true };
      settings.defaultProviderId = 'svc';
      settings.taskModels.cards = { ...settings.taskModels.cards, providerId: 'missing' };
    }
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Gate.md', basename: 'Gate', extension: 'md' }, context: {
      i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {}, cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'gate', type: 'entity', name: 'Gate' }), '') } },
      application: { verify: { start: verify }, cards: { start: cards }, queue: { subscribe: () => () => undefined } },
      settingsApplication: { getSettings: () => settings, subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const [expand, verifyButton, cardsButton] = Array.from(target.querySelectorAll<HTMLButtonElement>('.cr-note-action'));
      // 拓展只打开面板，不直接请求模型，保持可用。
      expect(expand.disabled).toBe(false);
      expect(verifyButton.disabled).toBe(!withService);
      expect(cardsButton.disabled).toBe(true);
      expect(cardsButton.title).toBe(i18n.messages.workbench.product.noteActionsUnavailable);
      cardsButton.click(); expect(cards).not.toHaveBeenCalled();
      // 识别概念不可用时创建区已给出提示，当前笔记区不重复。
      const hints = Array.from(target.querySelectorAll('.cr-current-note .cr-section-hint'), (el) => el.textContent ?? '');
      expect(hints.some((text) => text.includes(i18n.messages.workbench.product.noteActionsUnavailable))).toBe(hint);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it('uses one native Notice for a Verify admission and leaves no inline action feedback', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    const i18n = new I18n();
    const start = vi.fn(async () => ({ ok: true, value: 'verify-workflow' }));
    // Queue outcome notices belong to the runtime, so the panel must not
    // subscribe on its own or the same task would be announced twice.
    const subscribe = vi.fn(() => () => undefined);
    ui.noticeMessages.length = 0;
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Notice-admission.md', extension: 'md' }, context: {
      i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {}, cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'notice', type: 'entity', name: 'Notice' }), '') } },
      application: { verify: { start }, queue: { subscribe } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const verify = target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.messages.workbench.buttons.verify}"]`)!;
      verify.click(); verify.click();
      await vi.waitFor(() => { ui.flushSync(); expect(verify.disabled).toBe(false); });
      expect(start).toHaveBeenCalledOnce();
      expect(ui.noticeMessages).toEqual([{ message: `Notice-admission.md：${i18n.messages.workbench.notifications.verifyStarted}`, timeout: 3000 }]);
      expect(target.querySelector('[role="alert"]')).toBeNull();
      expect(target.textContent).not.toContain(i18n.messages.workbench.notifications.verifyStarted);
    } finally { await ui.unmount(instance); target.remove(); }
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("owns keyboard and focus in the dialog's popout document", async () => {
    const frame = document.body.appendChild(document.createElement("iframe"));
    const popout = frame.contentDocument!;
    const ownerWindow = frame.contentWindow!;
    const opener = popout.body.appendChild(popout.createElement("button"));
    opener.focus();
    const target = popout.body.appendChild(popout.createElement("div"));
    const oncancel = vi.fn();
    const instance = ui.mount(ui.ConfirmModal, { target, props: {
      title: "确认", message: "测试", confirmLabel: "确定", cancelLabel: "取消", onconfirm: vi.fn(), oncancel,
    } });
    try {
      ui.flushSync();
      await vi.waitFor(() => expect(popout.activeElement).toBe(target.querySelector("button")));
      const buttons = target.querySelectorAll("button");
      buttons[1].focus();
      const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      buttons[1].dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(popout.activeElement).toBe(buttons[0]);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      expect(oncancel).not.toHaveBeenCalled();
      ownerWindow.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      expect(oncancel).toHaveBeenCalledOnce();
    } finally {
      await ui.unmount(instance);
      await vi.waitFor(() => expect(popout.activeElement).toBe(opener));
      ownerWindow.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      expect(oncancel).toHaveBeenCalledOnce();
      frame.remove();
    }
  });

  it.each([0, 1])("Enter activates only the focused dialog button (%s)", async (buttonIndex) => {
    const target = document.body.appendChild(document.createElement("div"));
    const onconfirm = vi.fn();
    const oncancel = vi.fn();
    const instance = ui.mount(ui.ConfirmModal, { target, props: {
      title: "删除", message: "删除数据？", confirmLabel: "确定", cancelLabel: "取消", danger: true, onconfirm, oncancel,
    } });
    try {
      ui.flushSync();
      const button = target.querySelectorAll("button")[buttonIndex];
      button.focus();
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      // happy-dom does not synthesize the browser's default button click.
      if (!event.defaultPrevented) button.click();
      expect(onconfirm).toHaveBeenCalledTimes(buttonIndex);
      expect(oncancel).toHaveBeenCalledTimes(1 - buttonIndex);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("shows an English-only Define candidate so users can identify what they create", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.CreateHost, { target, props: { context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {} } }, application: { queue: { subscribe: () => () => undefined }, create: { define: async () => ({ ok: true, value: {
        coreDefinition: "", candidates: Object.fromEntries(CR_TYPES.map((type) => [type, {
          name: { chinese: "", english: `${type} English Name` }, confidence: 0.8,
        }])),
      } }) } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      const input = target.querySelector("input")!;
      input.value = "concept";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      ui.flushSync();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(target.querySelectorAll('.cr-type-table__row')).toHaveLength(3));
      target.querySelector<HTMLButtonElement>('.cr-type-table__other')!.click(); ui.flushSync();
      expect(target.querySelectorAll('.cr-type-table__row')).toHaveLength(5);
      expect(target.textContent).toContain("entity English Name");
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it('preserves selected candidate across note changes and admits a creation only once', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    let release!: (value: unknown) => void;
    const confirm = vi.fn((_concept: unknown) => new Promise(resolve => { release = resolve; }));
    const define = vi.fn(async () => ({ ok: true, value: { coreDefinition: 'fixture', candidates: Object.fromEntries(CR_TYPES.map((type, index) => [type, { name: { chinese: type, english: type }, confidence: 0.9 - index * 0.1 }])) } }));
    const instance = ui.mount(ui.CreateHost, {target, props: {context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: {on: () => ({}), offref() {}}},
      application: {queue: {subscribe: () => () => undefined}, create: {define, confirm}},
      settingsApplication: {getSettings: () => ({}), subscribeSettings: () => () => undefined},
    }}});
    try {
      ui.flushSync(); const input = target.querySelector<HTMLInputElement>('.cr-search-input')!;
      input.value = 'fixture concept'; input.dispatchEvent(new Event('input')); ui.flushSync();
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      await vi.waitFor(() => expect(target.querySelector('.cr-type-table')).not.toBeNull());
      target.querySelector<HTMLButtonElement>('.cr-type-table__other')!.click(); ui.flushSync();
      const candidate = target.querySelector<HTMLInputElement>('input[type="radio"][value="mechanism"]')!;
      candidate.click(); ui.flushSync();
      (instance as { setActiveFile(file: unknown): void }).setActiveFile({ path: 'Second.md', extension: 'md' }); ui.flushSync();
      (instance as { setActiveFile(file: unknown): void }).setActiveFile(null); ui.flushSync();
      expect(candidate.checked).toBe(true); expect(define).toHaveBeenCalledOnce();
      expect(target.querySelector('.cr-result-heading')?.textContent).toContain('fixture concept');
      const submit = target.querySelector<HTMLButtonElement>('.cr-type-table > .cr-btn-primary')!;
      expect(submit.textContent).toContain('创建机制笔记'); submit.click(); submit.click(); ui.flushSync();
      expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toMatchObject({type: 'mechanism'});
      expect(submit.disabled).toBe(true);
      release({ok: true, value: 'workflow'}); await Promise.resolve(); await Promise.resolve(); ui.flushSync();
      expect(target.querySelector('.cr-type-table')).toBeNull();
    } finally { release?.({ok: true, value: 'workflow'}); await ui.unmount(instance); target.remove(); }
  });

  it("waits for Chinese IME composition to finish before submitting Define", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const define = vi.fn(async () => ({ ok: false, error: { code: "E101_INVALID_INPUT" } }));
    const instance = ui.mount(ui.CreateHost, { target, props: { context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {} } }, application: { queue: { subscribe: () => () => undefined }, create: { define } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      const input = target.querySelector("input")!;
      input.value = "知识";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      ui.flushSync();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
      expect(define).not.toHaveBeenCalled();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(define).toHaveBeenCalledOnce();
    } finally { await ui.unmount(instance); target.remove(); }
  });
});


describe("card generation entry", () => {
  it('lets a newer metadata change win over a late first read for all three action qualifications', async () => {
    const reads: Array<(text: string) => void> = [];
    let changed!: (file: object, data: string, cache: object) => void;
    const file = { path: 'Read-order.md', extension: 'md' };
    const target = document.body.appendChild(document.createElement('div'));
    const actions = { verify: { start: vi.fn() }, cards: { start: vi.fn() }, expand: { prepare: vi.fn() } };
    const crContent = (cruid: string) => generateMarkdownContent(generateFrontmatter({ cruid, type: 'entity', name: cruid }), '正文');
    const crCache = (content: string) => ({ frontmatter: { cruid: 'x' }, frontmatterPosition: { end: { offset: content.indexOf('\n---', 3) + 4 } } });
    const cachedRead = vi.fn(() => new Promise<string>(resolve => reads.push(resolve)));
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: file, context: {
      i18n: new I18n(), app: {
        metadataCache: { getFileCache: () => null, on: (_event: string, callback: typeof changed) => { changed = callback; return {}; }, offref() {} },
        vault: { cachedRead, on: () => ({}), offref() {} } },
      application: { ...actions, queue: { subscribe: () => () => undefined } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    const disabled = () => Array.from(target.querySelectorAll<HTMLButtonElement>('.cr-note-action')).every(button => button.disabled);
    try {
      ui.flushSync();
      expect(disabled()).toBe(true);
      changed(file, 'ordinary note', {}); ui.flushSync();
      reads[0](crContent('old'));
      await Promise.resolve(); ui.flushSync();
      expect(disabled()).toBe(true);
      // 普通笔记不提供操作按钮，只说明原因。
      expect(target.querySelectorAll('.cr-note-action')).toHaveLength(0);
      expect(target.querySelector('.cr-current-note .cr-section-hint')?.textContent).toBe(new I18n().messages.workbench.product.notNodeHint);
      expect(actions.verify.start).not.toHaveBeenCalled();
      expect(actions.cards.start).not.toHaveBeenCalled();
      expect(actions.expand.prepare).not.toHaveBeenCalled();
      changed({ path: 'Other.md', extension: 'md' }, crContent('other'), crCache(crContent('other'))); ui.flushSync();
      expect(disabled()).toBe(true);
      const latest = crContent('latest');
      changed(file, latest, crCache(latest)); ui.flushSync();
      expect(Array.from(target.querySelectorAll<HTMLButtonElement>('.cr-note-action')).every(button => !button.disabled)).toBe(true);
      changed(file, `${latest}\n更多正文`, crCache(latest)); ui.flushSync();
      expect(disabled()).toBe(false);
      // 节点判定只读一次；另一次来自确认为知识节点后挂载的核查问题列表。
      expect(cachedRead).toHaveBeenCalledTimes(2);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it('skips reading a note whose cached frontmatter has no cruid', async () => {
    const cachedRead = vi.fn(async () => 'plain');
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Plain.md', extension: 'md' }, context: {
      i18n: new I18n(), app: {
        metadataCache: { getFileCache: () => ({ frontmatter: { title: 'x' } }), on: () => ({}), offref() {} },
        vault: { cachedRead, on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    try {
      await Promise.resolve(); ui.flushSync();
      expect(cachedRead).not.toHaveBeenCalled();
      expect(Array.from(target.querySelectorAll<HTMLButtonElement>('.cr-note-action')).every(button => button.disabled)).toBe(true);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each(['verify', 'cards'] as const)('keeps B busy when A %s returns late and attributes the Notice to A', async action => {
    const requests: Array<{ resolve(value: unknown): void }> = [];
    const start = vi.fn(() => new Promise(resolve => requests.push({ resolve })));
    const target = document.body.appendChild(document.createElement('div'));
    ui.noticeMessages.length = 0;
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: `${action}-A.md`, extension: 'md' }, context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'race', type: 'entity', name: 'Race' }), ''), on: () => ({}), offref() {} } },
      application: { [action]: { start }, queue: { subscribe: () => () => undefined } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    const index = action === 'verify' ? 1 : 2;
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      target.querySelectorAll<HTMLButtonElement>('.cr-note-action')[index].click(); ui.flushSync();
      (instance as { setActiveFile(file: object): void }).setActiveFile({ path: `${action}-B.md`, extension: 'md' });
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const b = target.querySelectorAll<HTMLButtonElement>('.cr-note-action')[index];
      b.click(); ui.flushSync();
      requests[0].resolve({ ok: false, error: { code: 'E101_INVALID_INPUT', message: 'private raw payload' } });
      await Promise.resolve(); ui.flushSync();
      expect(b.disabled).toBe(true); expect(b.getAttribute('aria-busy')).toBe('true');
      expect(ui.noticeMessages).toHaveLength(1);
      expect(ui.noticeMessages[0].message).toContain(`${action}-A.md：`);
      expect(ui.noticeMessages[0].message).not.toContain('private raw payload');
      expect(target.querySelector('[role="alert"]')).toBeNull();
      requests[1].resolve({ ok: true, value: 'B-accepted' });
      await Promise.resolve(); ui.flushSync();
      expect(b.disabled).toBe(false);
      expect(ui.noticeMessages).toHaveLength(2);
      expect(ui.noticeMessages[1].message).toContain(`${action}-B.md：`);
      expect(start).toHaveBeenCalledTimes(2);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each(['verify', 'cards'] as const)('ignores an unmounted %s completion', async action => {
    let release!: (value: unknown) => void;
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: `unmounted-${action}.md`, extension: 'md' }, context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'unmount', type: 'entity', name: 'Unmount' }), ''), on: () => ({}), offref() {} } },
      application: { [action]: { start: () => new Promise(resolve => { release = resolve; }) }, queue: { subscribe: () => () => undefined } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    ui.flushSync(); await Promise.resolve(); ui.flushSync();
    target.querySelectorAll<HTMLButtonElement>('.cr-note-action')[action === 'verify' ? 1 : 2].click();
    await ui.unmount(instance); target.remove();
    ui.noticeMessages.length = 0;
    release({ ok: true, value: 'late' }); await Promise.resolve(); ui.flushSync();
    expect(ui.noticeMessages).toHaveLength(0);
  });

  it('reports a source-root error through Notice with the submitted note identity', async () => {
    let release!: (value: unknown) => void;
    const start = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const target = document.body.appendChild(document.createElement('div'));
    const content = generateMarkdownContent(generateFrontmatter({ cruid: 'node', type: 'entity', name: 'Synthetic' }), 'body');
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Outside.md', extension: 'md' }, context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { cachedRead: async () => content, on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined }, cards: { start } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    const switchNote = (path: string) => { (instance as { setActiveFile: (file: object) => void }).setActiveFile({ path, extension: 'md' }); ui.flushSync(); };
    const error = { ok: false, error: { code: 'E103_CARDS_SOURCE_OUTSIDE_ROOT', message: 'private path' } };
    ui.noticeMessages.length = 0;
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const button = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.includes('生成记忆卡片'))!;
      button.click(); release(error);
      await vi.waitFor(() => { ui.flushSync(); expect(ui.noticeMessages).toHaveLength(1); });
      expect(ui.noticeMessages[0].message).toContain('Outside.md：');
      expect(ui.noticeMessages[0].message).not.toContain('private path');
      expect(target.querySelector('[role="alert"]')).toBeNull();
      switchNote('C-知识库/Valid.md');
      expect(target.querySelector('[role="alert"]')).toBeNull();
      switchNote('Outside.md'); await Promise.resolve(); ui.flushSync();
      Array.from(target.querySelectorAll('button')).find(button => button.textContent?.includes('生成记忆卡片'))!.click();
      expect(start).toHaveBeenCalledTimes(2);
      switchNote('C-知识库/Valid.md'); release(error);
      await Promise.resolve(); await Promise.resolve(); ui.flushSync();
      expect(target.querySelector('[role="alert"]')).toBeNull();
      expect(start).toHaveBeenCalledTimes(2);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each([false, true])("always shows one card action without modes while preserving CR eligibility (%s)", async (isNode) => {
    const target = document.body.appendChild(document.createElement("div"));
    const start = vi.fn(async () => ({ ok: true, value: "D-习题库/测试-decks.md" }));
    const content = isNode ? generateMarkdownContent(generateFrontmatter({ cruid: "node", type: "entity", name: "测试" }), "正文") : "普通笔记";
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: "C-知识库/测试.md", extension: "md" }, context: {
      i18n: new I18n(), app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { cachedRead: async () => content, on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined }, cards: { start } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const cardButtons = Array.from(target.querySelectorAll("button")).filter((button) => button.textContent?.includes("生成记忆卡片"));
      // 知识节点只有一个卡片入口；普通笔记不出现该入口，只说明原因。
      expect(cardButtons).toHaveLength(isNode ? 1 : 0);
      expect(target.querySelector('[role="tablist"]')).toBeNull();
      expect(target.textContent).not.toContain("重建当前笔记向量");
      if (isNode) {
        const cardButton = cardButtons[0];
        expect(cardButton.closest('[hidden]')).toBeNull();
        expect(cardButton.disabled).toBe(false);
        cardButton.click();
        expect(start).toHaveBeenCalledWith("C-知识库/测试.md");
        await vi.waitFor(() => expect(ui.noticeMessages.some(notice => notice.message.includes("D-习题库/测试-decks.md"))).toBe(true));
        expect(target.querySelector('[role="alert"]')).toBeNull();
      } else {
        expect(start).not.toHaveBeenCalled();
        expect(target.querySelector('.cr-current-note .cr-section-hint')?.textContent).toBe(new I18n().messages.workbench.product.notNodeHint);
      }
    } finally { await ui.unmount(instance); target.remove(); }
  });
});
