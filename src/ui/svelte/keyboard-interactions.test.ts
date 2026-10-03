import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { I18n } from "../../core/i18n";
import { generateFrontmatter, generateMarkdownContent } from "../../core/frontmatter-utils";
import { CR_TYPES } from "../../types";
import { DEFAULT_SETTINGS, SettingsStore } from "../../data/settings-store";
import { resolveTaskModelSnapshot } from "../../core/task-model-resolver";

// Compile the actual components with the production compiler and exercise DOM
// events, including propagation to ModalShell's window listener.
let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  ConfirmModal: unknown;
  CreateHost: unknown;
  TaskModelCard: unknown;
  TaskModelHost: unknown;
};
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as ConfirmModal } from "./src/ui/components/ConfirmModal.svelte"; export { default as TaskModelCard } from "./src/ui/svelte/settings/TaskModelCard.svelte"; export { default as CreateHost } from "test-host"; export { default as TaskModelHost } from "task-model-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "KeyboardTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "test-host", setup(builder) {
      builder.onResolve({ filter: /^(test-host|task-model-host)$/ }, ({ path }) => ({ path, namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({ resolveDir: process.cwd(), contents: compile(
        path === "task-model-host"
          ? '<script>import TaskModelCard from "./src/ui/svelte/settings/TaskModelCard.svelte"; import { resolveTaskModelSnapshot } from "./src/core/task-model-resolver"; let { store, i18n, update } = $props(); let settings = $state(store.getSettings()); const unsubscribe = store.subscribe(value => settings = value); $effect(() => () => unsubscribe());</script><TaskModelCard taskType="write" config={settings.taskModels.write} providers={settings.providers} defaultProviderId={settings.defaultProviderId} resolved={resolveTaskModelSnapshot(settings, "write")} isDefault={false} {i18n} onUpdate={update} onReset={() => {}} />'
          : '<script>import Create from "./src/ui/svelte/workbench/CreateSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, activeFile = null } = $props(); setWorkbenchContext(context); export function setActiveFile(file) { activeFile = file; }</script><Create {activeFile} />',
        { filename: "TestHost.svelte", css: "injected" },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return KeyboardTestUI;`)();
});
afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "empty"); });

function openTaskParameters(target: HTMLElement): HTMLDetailsElement {
  const details = target.querySelector<HTMLDetailsElement>(".cr-task-model-card__advanced")!;
  expect(details.open).toBe(false);
  details.querySelector("summary")!.click();
  ui.flushSync();
  expect(details.open).toBe(true);
  return details;
}

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
      i18n, app: { vault: { on: () => ({}), offref() {}, cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'synthetic', type: 'entity', name: 'Synthetic' }), '') } },
      application: { expand: { prepare }, verify: { start: verify }, cards: { start: cards }, queue: { subscribe: () => () => {}, getSnapshot: () => ({ tasks: [] }) } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      target.querySelector<HTMLButtonElement>('#cr-intent-note')!.click(); ui.flushSync();
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

  it('separates the two intentions and preserves the concept draft across note changes', async () => {
    const define = vi.fn(); const verify = vi.fn(); const cards = vi.fn();
    const target = document.body.appendChild(document.createElement('div'));
    const i18n = new I18n();
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Synthetic.md', basename: 'Synthetic', extension: 'md' }, context: {
      i18n, app: { vault: { on: () => ({}), offref() {}, cachedRead: async () => generateMarkdownContent(generateFrontmatter({ cruid: 'synthetic', type: 'entity', name: 'Synthetic' }), '') } },
      application: { create: { define }, verify: { start: verify }, cards: { start: cards }, queue: { subscribe: () => () => {}, getSnapshot: () => ({ tasks: [] }) } },
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
      const createTab = target.querySelector<HTMLButtonElement>('#cr-intent-create')!;
      const noteTab = target.querySelector<HTMLButtonElement>('#cr-intent-note')!;
      expect(target.querySelector<HTMLElement>('#cr-intent-note-panel')!.hidden).toBe(true);
      noteTab.click(); ui.flushSync();
      expect(target.querySelector<HTMLElement>('#cr-intent-create-panel')!.hidden).toBe(true);
      expect(noteTab.getAttribute('aria-selected')).toBe('true');
      const actions = target.querySelector<HTMLElement>('.cr-note-actions')!;
      expect(actions.querySelectorAll('button')).toHaveLength(3);
      expect(verify).not.toHaveBeenCalled(); expect(cards).not.toHaveBeenCalled(); expect(define).not.toHaveBeenCalled();
      (instance as { setActiveFile(file: unknown): void }).setActiveFile({ path: 'Second.md', basename: 'Second', extension: 'md' }); ui.flushSync();
      expect(target.querySelector('.cr-current-note')?.textContent).toContain('Second');
      expect(input.value).toBe('保留的概念');
      (instance as { setActiveFile(file: unknown): void }).setActiveFile(null); ui.flushSync();
      expect(target.querySelectorAll('.cr-note-actions button')).toHaveLength(3);
      expect(Array.from(target.querySelectorAll<HTMLButtonElement>('.cr-note-actions button')).every(button => button.disabled)).toBe(true);
      expect(input.value).toBe('保留的概念');
      createTab.click(); ui.flushSync();
      expect(input.value).toBe('保留的概念');
      target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.messages.workbench.createConcept.clear}"]`)!.click(); ui.flushSync();
      expect(input.value).toBe(''); expect(submit.disabled).toBe(true);
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each(['completed', 'failed', 'interrupted', 'cancelled'] as const)('clears the Verify started notice after its workflow becomes %s', async (terminal) => {
    let state: string = 'running';
    let notify = () => {};
    const unsubscribe = vi.fn();
    const start = vi.fn(async () => ({ ok: true, value: 'verify-workflow' }));
    const i18n = new I18n();
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Synthetic.md', extension: 'md' }, context: {
      i18n, app: { vault: { on: () => ({}), offref() {}, cachedRead: async () => '' } },
      application: { verify: { start }, queue: {
        subscribe: (listener: (event: { type: string }) => void) => { notify = () => listener({ type: 'queue-paused' }); return unsubscribe; },
        getSnapshot: () => ({ tasks: [{ workflowId: 'verify-workflow', state }] }),
      } }, settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      target.querySelector<HTMLButtonElement>('#cr-intent-note')!.click(); ui.flushSync();
      const verify = target.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.messages.workbench.buttons.verify}"]`)!;
      verify.click();
      await vi.waitFor(() => { ui.flushSync(); expect(target.textContent).toContain(i18n.messages.workbench.notifications.verifyStarted); });
      notify(); ui.flushSync();
      expect(target.textContent).toContain(i18n.messages.workbench.notifications.verifyStarted);
      state = terminal; notify(); ui.flushSync();
      expect(target.textContent).not.toContain(i18n.messages.workbench.notifications.verifyStarted);
      // A workflow which terminates before start() resolves cannot leave a stale notice either.
      verify.click();
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
      await Promise.resolve(); ui.flushSync();
      expect(target.textContent).not.toContain(i18n.messages.workbench.notifications.verifyStarted);
    } finally { await ui.unmount(instance); target.remove(); }
    expect(unsubscribe).toHaveBeenCalledOnce();
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

  it("preserves both task parameter edits when the earlier save is still in progress", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.provider = {
      apiKey: "test", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled",
      defaultChatModel: "model", defaultEmbedModel: "", capabilities: { temperature: true, topP: true },
    };
    settings.defaultProviderId = "provider";
    settings.taskModels.write = { providerId: "provider", model: "model", parameters: { temperature: 0.7, topP: 1 } };
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saveCount = 0;
    const store = new SettingsStore({ loadData: async () => settings, saveData: async () => {
      if (++saveCount === 1) await saveGate;
    } } as never);
    await store.loadSettings();
    const update = vi.fn((type, partial) => store.updateTaskModel(type, partial));
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelHost, { target, props: { store, i18n: new I18n(), update } });
    try {
      ui.flushSync();
      openTaskParameters(target);
      const changeNumber = (selector: string, value: string) => {
        const element = target.querySelector(selector)!.closest(".cr-task-model-card__field")!.querySelector<HTMLInputElement>('input[type="number"]')!;
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        ui.flushSync();
      };
      changeNumber("#tmc-write-temp", "0.8");
      await Promise.resolve();
      changeNumber("#tmc-write-topp", "0.9");
      releaseSave();
      await Promise.all(update.mock.results.map((result) => result.value));
      expect(store.getSettings().taskModels.write.parameters).toEqual({ temperature: 0.8, topP: 0.9 });
    } finally { releaseSave(); await ui.unmount(instance); target.remove(); }
  });

  it("switches a legacy task parameter back to the provider value when inherit is selected", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.provider = { apiKey: "test", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled", defaultChatModel: "model", defaultEmbedModel: "", parameters: { maxTokens: 2048 } };
    settings.taskModels.write = { providerId: "provider", model: "model", maxTokens: 100 };
    const store = new SettingsStore({ loadData: async () => settings, saveData: async () => undefined } as never);
    await store.loadSettings();
    const target = document.body.appendChild(document.createElement("div"));
    const onUpdate = vi.fn(async (type, partial) => store.updateTaskModel(type, partial));
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "write", config: store.getSettings().taskModels.write,
      providers: settings.providers, defaultProviderId: "provider", resolved: resolveTaskModelSnapshot(store.getSettings(), "write"), isDefault: false,
      i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync();
      openTaskParameters(target);
      const select = target.querySelector('#tmc-write-max-tokens')!.closest('.cr-task-model-card__field')!.querySelector('select')!;
      select.value = 'inherit';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(onUpdate).toHaveBeenCalledOnce();
      await onUpdate.mock.results[0].value;
      expect(resolveTaskModelSnapshot(store.getSettings(), "write").maxTokens).toBe(2048);
    } finally { await ui.unmount(instance); target.remove(); }
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
      i18n: new I18n(), app: { vault: { on: () => ({}), offref() {} } }, application: { queue: { subscribe: () => () => undefined }, create: { define: async () => ({ ok: true, value: {
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

  it('preserves selected candidate across intentions and admits a creation only once', async () => {
    const target = document.body.appendChild(document.createElement('div'));
    let release!: (value: unknown) => void;
    const confirm = vi.fn((_concept: unknown) => new Promise(resolve => { release = resolve; }));
    const define = vi.fn(async () => ({ ok: true, value: { coreDefinition: 'fixture', candidates: Object.fromEntries(CR_TYPES.map((type, index) => [type, { name: { chinese: type, english: type }, confidence: 0.9 - index * 0.1 }])) } }));
    const instance = ui.mount(ui.CreateHost, {target, props: {context: {
      i18n: new I18n(), app: {vault: {on: () => ({}), offref() {}}},
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
      target.querySelector<HTMLButtonElement>('#cr-intent-note')!.click(); ui.flushSync();
      target.querySelector<HTMLButtonElement>('#cr-intent-create')!.click(); ui.flushSync();
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
      i18n: new I18n(), app: { vault: { on: () => ({}), offref() {} } }, application: { queue: { subscribe: () => () => undefined }, create: { define } },
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
  it('clears a source-root error on note switch, including a late result for the old note', async () => {
    let release!: (value: unknown) => void;
    const start = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const target = document.body.appendChild(document.createElement('div'));
    const content = generateMarkdownContent(generateFrontmatter({ cruid: 'node', type: 'entity', name: 'Synthetic' }), 'body');
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: 'Outside.md', extension: 'md' }, context: {
      i18n: new I18n(), app: { vault: { cachedRead: async () => content, on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined }, cards: { start } },
      settingsApplication: { getSettings: () => ({}), subscribeSettings: () => () => undefined },
    } } });
    const switchNote = (path: string) => { (instance as { setActiveFile: (file: object) => void }).setActiveFile({ path, extension: 'md' }); ui.flushSync(); };
    const error = { ok: false, error: { code: 'E103_CARDS_SOURCE_OUTSIDE_ROOT', message: 'private path' } };
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const button = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.includes('生成记忆卡片'))!;
      button.click(); release(error);
      await vi.waitFor(() => { ui.flushSync(); expect(target.querySelector('[role="alert"]')).not.toBeNull(); });
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

  it.each([false, true])("always shows one card action across both tabs while preserving CR eligibility (%s)", async (isNode) => {
    const target = document.body.appendChild(document.createElement("div"));
    const start = vi.fn(async () => ({ ok: true, value: "D-习题库/测试-decks.md" }));
    const content = isNode ? generateMarkdownContent(generateFrontmatter({ cruid: "node", type: "entity", name: "测试" }), "正文") : "普通笔记";
    const instance = ui.mount(ui.CreateHost, { target, props: { activeFile: { path: "C-知识库/测试.md", extension: "md" }, context: {
      i18n: new I18n(), app: { vault: { cachedRead: async () => content, on: () => ({}), offref() {} } },
      application: { queue: { subscribe: () => () => undefined }, cards: { start } },
      settingsApplication: { getSettings: () => ({ enableSemanticIndexing: false }), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync(); await Promise.resolve(); ui.flushSync();
      const cardButtons = Array.from(target.querySelectorAll("button")).filter((button) => button.textContent?.includes("生成记忆卡片"));
      expect(cardButtons).toHaveLength(1);
      const cardButton = cardButtons[0];
      expect(cardButton.closest('[hidden]')).toBeNull();
      expect(cardButton.disabled).toBe(!isNode);
      target.querySelector<HTMLButtonElement>('#cr-intent-note')!.click(); ui.flushSync();
      expect(cardButton.closest('[hidden]')).toBeNull();
      target.querySelector<HTMLButtonElement>('#cr-intent-create')!.click(); ui.flushSync();
      expect(cardButton.closest('[hidden]')).toBeNull();
      expect(target.textContent).not.toContain("重建当前笔记向量");
      if (isNode) {
        cardButton.click();
        expect(start).toHaveBeenCalledWith("C-知识库/测试.md");
        await vi.waitFor(() => expect(target.textContent).toContain("D-习题库/测试-decks.md"));
      } else { cardButton.click(); expect(start).not.toHaveBeenCalled(); expect(cardButton.title).toContain('不是概念笔记'); }
    } finally { await ui.unmount(instance); target.remove(); }
  });
});


describe("task parameter progressive disclosure", () => {
  it.each([
    ["write", "temp"], ["write", "topp"], ["write", "max-tokens"], ["index", "dimension"],
  ] as const)("keeps empty specified %s/%s local until a real valid value is entered", async (taskType, id) => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultProviderId = "provider";
    settings.providers.provider = {
      apiKey: "", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings",
      defaultChatModel: "model", defaultEmbedModel: "embed", capabilities: { temperature: true, topP: true },
    };
    const onUpdate = vi.fn();
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType, config: settings.taskModels[taskType], providers: settings.providers, defaultProviderId: "provider",
      resolved: resolveTaskModelSnapshot(settings, taskType), isDefault: true, i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync();
      expect(target.querySelector("#tmc-" + taskType + "-provider")).not.toBeNull();
      expect(onUpdate).not.toHaveBeenCalled();
      const details = openTaskParameters(target);
      const nested = details.querySelector<HTMLDetailsElement>("details");
      if (nested) expect(nested.open).toBe(false);
      const mode = target.querySelector<HTMLSelectElement>(`#tmc-${taskType}-${id}-mode`)!;
      mode.value = "set";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      const input = target.querySelector<HTMLInputElement>(`#tmc-${taskType}-${id}`)!;
      expect(input.value).toBe("");
      expect(onUpdate).not.toHaveBeenCalled();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      expect(onUpdate).not.toHaveBeenCalled();
      expect(input.getAttribute("aria-invalid")).toBe("true");
      input.value = id === "temp" || id === "topp" ? "0" : "512";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      expect(onUpdate).toHaveBeenCalledOnce();
      const key = { temp: "temperature", topp: "topP", "max-tokens": "maxTokens", dimension: "embeddingDimension" }[id];
      expect(onUpdate).toHaveBeenCalledWith(taskType, { parameters: { [key]: id === "temp" || id === "topp" ? 0 : 512 } });
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("keeps unsupported saved values visible and makes protocol rejection explicit", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.research = {
      apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled",
      defaultChatModel: "model", defaultEmbedModel: "", capabilities: { reasoning: true },
      parameters: { temperature: 0.7 },
    };
    settings.taskModels.write = { providerId: "research", model: "", parameters: { topP: 0.9, thinkingLevel: "HIGH" } };
    const onUpdate = vi.fn();
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "write", config: settings.taskModels.write, providers: settings.providers, defaultProviderId: "research",
      resolved: resolveTaskModelSnapshot(settings, "write"), isDefault: false, i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync(); openTaskParameters(target);
      const topP = target.querySelector('[data-parameter="topP"]')!;
      expect(topP.textContent).toContain("当前不发送");
      expect(topP.textContent).toContain("0.9");
      expect(topP.textContent).toContain(new I18n().t("settings.taskDetails.fromTask"));
      expect(topP.querySelector<HTMLInputElement>("input")!.value).toBe("0.9");
      expect(target.querySelector('[data-parameter="thinkingLevel"]')!.textContent).toContain("发送前拒绝请求");
      expect(onUpdate).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("shows Cards inherited service and model without persisting placeholder values", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultProviderId = "research";
    settings.providers.research = { apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "inherited-model", defaultEmbedModel: "" };
    const target = document.body.appendChild(document.createElement("div"));
    const onUpdate = vi.fn();
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "cards", config: settings.taskModels.cards, providers: settings.providers, defaultProviderId: "research",
      resolved: resolveTaskModelSnapshot(settings, "cards"), isDefault: true, i18n: new I18n(), onUpdate, onReset() {},
    } });
    try {
      ui.flushSync();
      expect(target.querySelector<HTMLSelectElement>("#tmc-cards-provider")!.value).toBe("");
      expect(target.querySelector<HTMLInputElement>("#tmc-cards-model")).toBeNull();
      expect(target.querySelector<HTMLSelectElement>("#tmc-cards-model-mode")!.value).toBe("inherit");
      expect(target.textContent).toContain("inherited-model");
      expect(target.textContent).toContain("继承服务默认模型：inherited-model");
      expect(onUpdate).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("updates inherited previews without saving an empty specified draft when the default provider changes", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.A = { apiKey: "", enabled: true, apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: "A-model", defaultEmbedModel: "", capabilities: { temperature: true } };
    settings.providers.B = { ...settings.providers.A, defaultChatModel: "B-model", parameters: { temperature: 0.6 } };
    settings.defaultProviderId = "A";
    const store = new SettingsStore({ loadData: async () => settings, saveData: async () => undefined } as never);
    await store.loadSettings();
    const update = vi.fn((type, partial) => store.updateTaskModel(type, partial));
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.TaskModelHost, { target, props: { store, i18n: new I18n(), update } });
    try {
      ui.flushSync(); openTaskParameters(target);
      const mode = target.querySelector<HTMLSelectElement>("#tmc-write-temp-mode")!;
      mode.value = "set";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      ui.flushSync();
      expect(target.querySelector<HTMLInputElement>("#tmc-write-temp")!.value).toBe("");
      expect(update).not.toHaveBeenCalled();
      await store.updateSettings({ defaultProviderId: "B" });
      ui.flushSync();
      const row = target.querySelector('[data-parameter="temperature"]')!;
      expect(row.textContent).toContain("0.6");
      expect(row.textContent).toContain("B");
      expect(target.querySelector<HTMLInputElement>("#tmc-write-temp")!.value).toBe("");
      expect(store.getSettings().taskModels.write.parameters?.temperature).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
      mode.value = "inherit";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      await update.mock.results[0].value;
      ui.flushSync();
      expect(target.querySelector("#tmc-write-temp")).toBeNull();
      expect(resolveTaskModelSnapshot(store.getSettings(), "write").temperature).toBe(0.6);
      mode.value = "omit";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      await update.mock.results[1].value;
      ui.flushSync();
      expect(store.getSettings().taskModels.write.parameters?.temperature).toBeNull();
      expect(resolveTaskModelSnapshot(store.getSettings(), "write").temperature).toBeUndefined();
      expect(row.textContent).toContain(new I18n().t("settings.taskDetails.omitted"));
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each(["provider", "model"] as const)("labels resolved parameters as blocked when the %s is unavailable", async (missing) => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.research = { apiKey: "", enabled: missing !== "provider", apiFormat: "openai-responses", embeddingApiFormat: "disabled", defaultChatModel: missing === "model" ? "" : "model", defaultEmbedModel: "" };
    settings.taskModels.write = { providerId: "research", model: "", parameters: { maxTokens: 42 } };
    const target = document.body.appendChild(document.createElement("div"));
    const i18n = new I18n();
    const instance = ui.mount(ui.TaskModelCard, { target, props: {
      taskType: "write", config: settings.taskModels.write, providers: settings.providers, defaultProviderId: "research",
      resolved: resolveTaskModelSnapshot(settings, "write"), isDefault: false, i18n, onUpdate: vi.fn(), onReset() {},
    } });
    try {
      ui.flushSync(); openTaskParameters(target);
      const overview = target.querySelector(".cr-task-model-card__overview")!;
      expect(overview.querySelector('[role="status"]')!.textContent).toContain(i18n.t(`settings.taskDetails.${missing}Unavailable`));
      const row = target.querySelector('[data-parameter="maxTokens"]')!;
      expect(row.textContent).toContain("42");
      expect(row.textContent).toContain(i18n.t("settings.taskDetails.resolvedOnly"));
    } finally { await ui.unmount(instance); target.remove(); }
  });

});
