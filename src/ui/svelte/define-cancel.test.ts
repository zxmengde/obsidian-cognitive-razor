import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { compile } from 'svelte/compiler';
import { I18n } from '../../core/i18n';
import { DEFAULT_SETTINGS } from '../../data/settings-store';

let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  CreateHost: unknown;
};

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'empty', { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as CreateHost } from "create-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'DefineTestUI',
    conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'],
    alias: { obsidian: './__mocks__/obsidian.ts', '@': './src' },
    plugins: [{ name: 'create-host', setup(builder) {
      builder.onResolve({ filter: /^create-host$/ }, () => ({ path: 'create-host', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Create from "./src/ui/svelte/workbench/CreateSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, activeFile = null } = $props(); setWorkbenchContext(context);</script><Create {activeFile} />',
        { filename: 'CreateHost.svelte', css: 'injected' },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: 'injected' } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return DefineTestUI;`)();
});
afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, 'empty'); });
afterEach(() => { vi.useRealTimers(); });

/** A configured provider keeps the Define button enabled: an unconfigured
 *  settings snapshot blocks the action by design. */
function configuredSettings() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.providers.synthetic = { apiKey: "", baseUrl: "https://example.test/v1", enabled: true, apiFormat: "openai-chat-completions", embeddingApiFormat: "disabled", defaultChatModel: "synthetic-model", defaultEmbedModel: "" };
  settings.defaultProviderId = "synthetic";
  return settings;
}

function harness() {
  const i18n = new I18n();
  let signal: AbortSignal | undefined;
  const define = vi.fn((_input: string, abortSignal?: AbortSignal) => {
    signal = abortSignal;
    // Never resolves on its own: only the cancel button ends this attempt.
    return new Promise<never>(() => undefined);
  });
  const context = {
    i18n,
    app: { vault: { on: () => ({}), offref() {} } },
    application: { create: { define }, queue: { subscribe: () => () => undefined } },
    settingsApplication: { getSettings: () => configuredSettings(), subscribeSettings: () => () => undefined },
  };
  return { i18n, define, context, getSignal: () => signal };
}

describe('Define cancellation and elapsed time', () => {
  it('shows elapsed seconds and cancels the request while clearing the draft', async () => {
    vi.useFakeTimers();
    const h = harness();
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.CreateHost, { target, props: { context: h.context } });
    try {
      ui.flushSync();
      const input = target.querySelector<HTMLInputElement>('.cr-search-input')!;
      input.value = '待取消的概念';
      input.dispatchEvent(new Event('input'));
      ui.flushSync();
      expect(target.querySelector('.cr-define-progress')).toBeNull();

      target.querySelector<HTMLButtonElement>('.cr-search-row > .cr-btn-primary')!.click();
      ui.flushSync();
      expect(h.define).toHaveBeenCalledExactlyOnceWith('待取消的概念', expect.any(AbortSignal));
      const elapsed = () => target.querySelector('.cr-define-progress__elapsed')!.textContent!.trim();
      expect(elapsed()).toBe(h.i18n.format('workbench.createConcept.elapsed', { seconds: 0 }));

      vi.advanceTimersByTime(3000);
      ui.flushSync();
      expect(elapsed()).toBe(h.i18n.format('workbench.createConcept.elapsed', { seconds: 3 }));

      const cancel = target.querySelector<HTMLButtonElement>(`.cr-define-progress button[aria-label="${h.i18n.messages.workbench.createConcept.cancel}"]`)!;
      expect(cancel.textContent?.trim()).toBe(h.i18n.messages.workbench.createConcept.cancel);
      cancel.click();
      ui.flushSync();

      expect(h.getSignal()!.aborted).toBe(true);
      expect(target.querySelector('.cr-define-progress')).toBeNull();
      // Cancelling drops the draft: the user asked to stop, not to retry.
      expect(input.value).toBe('');
      expect(target.querySelector('.cr-search-row > .cr-btn-primary')!.hasAttribute('disabled')).toBe(true);
      expect(target.querySelector('[role="alert"]')).toBeNull();
      expect(target.textContent).not.toContain(h.i18n.messages.workbench.notifications.defineFailed);
    } finally {
      await ui.unmount(instance);
      target.remove();
    }
  });

  it('keeps the draft and reports the failure when the request fails on its own', async () => {
    const i18n = new I18n();
    const target = document.body.appendChild(document.createElement('div'));
    const define = vi.fn(async () => ({ ok: false as const, error: { code: 'E500_INTERNAL_ERROR' } }));
    const instance = ui.mount(ui.CreateHost, { target, props: { context: {
      i18n, app: { vault: { on: () => ({}), offref() {} } },
      application: { create: { define }, queue: { subscribe: () => () => undefined } },
      settingsApplication: { getSettings: () => configuredSettings(), subscribeSettings: () => () => undefined },
    } } });
    try {
      ui.flushSync();
      const input = target.querySelector<HTMLInputElement>('.cr-search-input')!;
      input.value = '会失败的概念';
      input.dispatchEvent(new Event('input'));
      ui.flushSync();
      target.querySelector<HTMLButtonElement>('.cr-search-row > .cr-btn-primary')!.click();
      await vi.waitFor(() => { ui.flushSync(); expect(target.querySelector('[role="alert"]')).not.toBeNull(); });
      expect(input.value).toBe('会失败的概念');
      expect(target.querySelector('.cr-define-progress')).toBeNull();
    } finally {
      await ui.unmount(instance);
      target.remove();
    }
  });
});
