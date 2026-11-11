import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { compile } from 'svelte/compiler';
import { I18n } from '../../core/i18n';
import { DEFAULT_SETTINGS, SettingsStore } from '../../data/settings-store';
import { SettingsApplication } from '../../app/settings-application';
import type {
  onSettingsSection as OnSettingsSection,
  requestSettingsSection as RequestSettingsSection,
  takeSettingsSection as TakeSettingsSection,
  clearSettingsSection as ClearSettingsSection,
} from '../settings-intent';

let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  SettingsRoot: unknown;
  CreateHost: unknown;
  // The settings view is bundled separately, so the intent channel must come
  // from that same bundle or the mounted view never sees the request.
  intent: {
    requestSettingsSection: typeof RequestSettingsSection;
    takeSettingsSection: typeof TakeSettingsSection;
    onSettingsSection: typeof OnSettingsSection;
    clearSettingsSection: typeof ClearSettingsSection;
  };
};

let requestSettingsSection: typeof RequestSettingsSection;
let takeSettingsSection: typeof TakeSettingsSection;
let onSettingsSection: typeof OnSettingsSection;
let clearSettingsSection: typeof ClearSettingsSection;

beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, 'empty', { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as SettingsRoot } from "./src/ui/svelte/settings/SettingsRoot.svelte"; export { default as CreateHost } from "create-entry-host"; export * as intent from "./src/ui/settings-intent";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'SettingsEntryUI',
    conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'],
    alias: { obsidian: './__mocks__/obsidian.ts', '@': './src' },
    plugins: [{ name: 'create-entry-host', setup(builder) {
      builder.onResolve({ filter: /^create-entry-host$/ }, () => ({ path: 'create-entry-host', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Create from "./src/ui/svelte/workbench/CreateSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, activeFile = null, onOpenSettings } = $props(); setWorkbenchContext(context);</script><Create {activeFile} {onOpenSettings} />',
        { filename: 'CreateHost.svelte', css: 'injected' },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: 'injected' } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return SettingsEntryUI;`)();
  ({ requestSettingsSection, takeSettingsSection, onSettingsSection, clearSettingsSection } = ui.intent);
});
afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, 'empty'); });
beforeEach(() => { clearSettingsSection(); });

async function settingsHarness({ withProvider = true }: { withProvider?: boolean } = {}) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (withProvider) {
    settings.providers.daily = { apiKey: '', enabled: true, apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat-main', defaultEmbedModel: 'embed-main' };
    settings.defaultProviderId = 'daily';
  }
  const store = new SettingsStore({ loadData: async () => settings, saveData: async () => undefined } as never);
  await store.loadSettings();
  const probe = vi.fn(async () => ({ ok: true as const, value: { chat: true, embedding: true } }));
  const application = new SettingsApplication({
    settingsStore: store,
    providerProbe: { probe } as never,
    ensureSemanticIndex: vi.fn(async () => ({}) as never),
    resetRuntimeData: vi.fn(async () => ({ ok: true as const, value: undefined })),
  });
  const target = document.body.appendChild(document.createElement('div'));
  const navigate = vi.fn(() => { target.scrollTop = 0; });
  const instance = ui.mount(ui.SettingsRoot, { target, props: { app: {}, i18n: new I18n(), settingsApplication: application, onTabNavigate: navigate } });
  ui.flushSync();
  return {
    target, probe, navigate,
    cleanup: async () => { await ui.unmount(instance); application.dispose(); target.remove(); },
  };
}

describe('connection test as a primary settings action', () => {
  it('offers the connection test on the card and runs it from there', async () => {
    const h = await settingsHarness();
    const i18n = new I18n();
    try {
      const card = Array.from(h.target.querySelectorAll<HTMLElement>('.cr-provider-card')).find(el => el.querySelector('.cr-provider-card__name')?.textContent?.includes('daily'))!;
      const action = card.querySelector<HTMLButtonElement>('.cr-provider-card__actions button')!;
      expect(action.textContent?.trim()).toBe(i18n.t('settings.provider.testConnection'));
      // The promoted button must not need the "⋯" menu to be opened first.
      expect(card.querySelector<HTMLDetailsElement>('.cr-provider-extra')!.open).toBe(false);
      action.click();
      await vi.waitFor(() => expect(h.probe).toHaveBeenCalledOnce());
      expect((h.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: 'daily' });
      await vi.waitFor(() => { ui.flushSync(); expect(card.querySelector('.cr-provider-probe-status')).not.toBeNull(); });
    } finally { await h.cleanup(); }
  });

  it('keeps the temporary-parameter probe inside the menu', async () => {
    const h = await settingsHarness();
    try {
      const card = Array.from(h.target.querySelectorAll<HTMLElement>('.cr-provider-card')).find(el => el.querySelector('.cr-provider-card__name')?.textContent?.includes('daily'))!;
      expect(card.querySelector('.cr-provider-card__actions')?.querySelector('[aria-label*="临时"]')).toBeNull();
      expect(card.querySelector('.cr-provider-card__actions')?.textContent).not.toContain('临时使用此连接');
      card.querySelector<HTMLDetailsElement>('.cr-provider-extra')!.querySelector('summary')!.click();
      ui.flushSync();
      expect(card.querySelector('.cr-provider-link')).not.toBeNull();
      expect(h.probe).not.toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });
});

describe('settings section intent', () => {
  it('delivers a pending request once and live requests to mounted listeners', () => {
    const seen: string[] = [];
    requestSettingsSection('connections');
    expect(takeSettingsSection()).toBe('connections');
    expect(takeSettingsSection()).toBeUndefined();
    const stop = onSettingsSection((section) => seen.push(section));
    requestSettingsSection('connections');
    expect(seen).toEqual(['connections']);
    expect(takeSettingsSection()).toBeUndefined();
    stop();
    requestSettingsSection('connections');
    expect(seen).toEqual(['connections']);
    expect(takeSettingsSection()).toBe('connections');
  });

  it('lands on the connections section when the workbench hint opens settings', async () => {
    const h = await settingsHarness({ withProvider: false });
    try {
      requestSettingsSection('connections');
      // No connection is configured yet, so the section has no list to focus;
      // the landing spot must still be reachable through the add button.
      await vi.waitFor(() => {
        ui.flushSync();
        expect(document.activeElement?.closest('#cr-settings-connections')).not.toBeNull();
      });
      expect(document.activeElement?.tagName).toBe('BUTTON');
      expect(h.target.querySelector('[role="tabpanel"]')?.id).toBe('cr-settings-panel-providers');
      expect(h.navigate).toHaveBeenCalled();
    } finally { await h.cleanup(); }
  });

  it('focuses the promoted connection test when a connection exists', async () => {
    const h = await settingsHarness();
    try {
      requestSettingsSection('connections');
      await vi.waitFor(() => {
        ui.flushSync();
        expect(document.activeElement?.closest('#cr-settings-connections')).not.toBeNull();
      });
      expect(document.activeElement?.closest('.cr-settings-section')?.id).toBe('cr-settings-connections');
    } finally { await h.cleanup(); }
  });
});

describe('unconfigured workbench hint', () => {
  it('opens settings from the hint itself', async () => {
    const i18n = new I18n();
    const onOpenSettings = vi.fn();
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.CreateHost, { target, props: {
      onOpenSettings,
      context: {
        i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {} } },
        application: { create: { define: vi.fn() }, queue: { subscribe: () => () => undefined } },
        settingsApplication: { getSettings: () => structuredClone(DEFAULT_SETTINGS), subscribeSettings: () => () => undefined },
      },
    } });
    try {
      ui.flushSync();
      const hint = target.querySelector<HTMLButtonElement>('.cr-create-help--action')!;
      expect(hint.tagName).toBe('BUTTON');
      expect(hint.textContent).toContain(i18n.messages.workbench.product.notConfigured);
      expect(hint.textContent).toContain(i18n.messages.workbench.product.openSettings);
      hint.click();
      expect(onOpenSettings).toHaveBeenCalledOnce();
    } finally { await ui.unmount(instance); target.remove(); }
  });
});
