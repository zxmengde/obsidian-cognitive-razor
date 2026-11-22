import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { compile } from 'svelte/compiler';
import { I18n } from '../../core/i18n';
import { DEFAULT_SETTINGS } from '../../data/settings-store';
import {
  cloneDefaults,
  createSettingsEnvironment,
  findRow,
  loadSettingsBundle,
  type SettingsBundle,
  type SettingsEnvironment,
} from './settings-test-support';

/** 工作台的未配置提示位于工作台组件内；这里单独打包，避免工作台改动拖垮设置页测试。 */
let workbench: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  CreateHost: unknown;
};

let bundle: SettingsBundle;

beforeAll(async () => {
  bundle = await loadSettingsBundle();
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as CreateHost } from "create-entry-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', globalName: 'CreateEntryUI',
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
  workbench = new Function(`${result.outputFiles[0].text}; return CreateEntryUI;`)();
});

beforeEach(() => { bundle.intent.clearSettingsSection(); });

afterAll(() => { document.body.replaceChildren(); });

function withDailyService() {
  const settings = cloneDefaults();
  settings.providers.daily = { apiKey: '', enabled: true, apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat-main', defaultEmbedModel: 'embed-main' };
  settings.defaultProviderId = 'daily';
  return settings;
}

async function withEnv(run: (env: SettingsEnvironment) => Promise<void>, settings = withDailyService()) {
  const env = await createSettingsEnvironment({ settings });
  try {
    await run(env);
  } finally {
    document.body.querySelectorAll('.modal-container').forEach((modal) => modal.remove());
    await env.cleanup();
  }
}

describe('connection test as a service row action', () => {
  it('offers the connection test on the row and runs it from there', async () => {
    await withEnv(async (env) => {
      const i18n = new I18n();
      const row = findRow(env.tab.containerEl, 'daily');
      const testButton = row.querySelector<HTMLButtonElement>('button[aria-label="测试连接 daily"]')!;
      expect(testButton.textContent).toBe(i18n.t('settings.native.testService'));
      // 连接测试直接在行上，不需要先打开「更多操作」菜单。
      expect(env.bundle.obs.shownMenus).toHaveLength(0);

      testButton.focus();
      testButton.click();
      expect(testButton.textContent).toBe(i18n.t('settings.native.testing'));
      // 进行中用 aria-disabled：按钮不失焦，重复点击被忽略。
      expect(testButton.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(testButton);
      testButton.click();
      await vi.waitFor(() => expect(env.probe).toHaveBeenCalledOnce());
      expect((env.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: 'daily' });
      await vi.waitFor(() => {
        env.bundle.flushSync();
        expect(row.querySelector('.cr-service-probe .cr-provider-probe-status')).not.toBeNull();
      });
      expect(testButton.textContent).toBe(i18n.t('settings.native.testService'));
      expect(testButton.getAttribute('aria-disabled')).toBeNull();
      expect(testButton.disabled).toBe(false);
      expect(env.probe).toHaveBeenCalledOnce();
    });
  });

  it('keeps the temporary-parameter probe inside the more-actions menu', async () => {
    await withEnv(async (env) => {
      const i18n = new I18n();
      const row = findRow(env.tab.containerEl, 'daily');
      expect(row.textContent).not.toContain(i18n.t('settings.redesign.testUsingProvider'));

      row.querySelector<HTMLElement>('[aria-label="更多操作 daily"]')!.click();
      const menu = env.bundle.obs.shownMenus.at(-1)!;
      // 默认服务不显示「设为默认」；删除由原生列表的删除按钮提供，不在菜单里。
      expect(menu.items.map((item) => item.title)).toEqual([i18n.t('settings.native.disable'), i18n.t('settings.native.taskProbe')]);
      expect(env.probe).not.toHaveBeenCalled();

      menu.items.find((item) => item.title === i18n.t('settings.native.taskProbe'))!.trigger();
      const modal = document.body.querySelector<HTMLElement>('.modal-container')!;
      expect(modal.querySelector('.modal-title')?.textContent).toBe(i18n.format('settings.native.taskProbeTitle', { id: 'daily' }));
      // 打开弹窗只是选择参数，不发起请求。
      expect(env.probe).not.toHaveBeenCalled();

      const run = Array.from(modal.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === i18n.t('settings.native.taskProbeRun'))!;
      run.click();
      await vi.waitFor(() => expect(env.probe).toHaveBeenCalledOnce());
      expect((env.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: 'daily', taskType: 'write' });
      await vi.waitFor(() => {
        env.bundle.flushSync();
        expect(modal.querySelector('.cr-task-probe-result .cr-provider-probe-status')).not.toBeNull();
      });
      // 临时测试不改变保存的任务配置。
      expect(env.store.getSettings().taskModels.write.providerId).toBe('');
      expect(env.save).not.toHaveBeenCalled();
    });
  });
});

describe('settings section intent', () => {
  it('delivers a pending request once and live requests to mounted listeners', () => {
    const { intent } = bundle;
    const seen: string[] = [];
    intent.requestSettingsSection('connections');
    expect(intent.takeSettingsSection()).toBe('connections');
    expect(intent.takeSettingsSection()).toBeUndefined();
    const stop = intent.onSettingsSection((section) => seen.push(section));
    intent.requestSettingsSection('connections');
    expect(seen).toEqual(['connections']);
    expect(intent.takeSettingsSection()).toBeUndefined();
    stop();
    intent.requestSettingsSection('connections');
    expect(seen).toEqual(['connections']);
    expect(intent.takeSettingsSection()).toBe('connections');
  });

  it('lands on the add-service button when the workbench hint opens settings without services', async () => {
    await withEnv(async (env) => {
      const i18n = new I18n();
      bundle.intent.requestSettingsSection('connections');
      // 还没有服务时没有可测试的行，落点是添加按钮。
      await vi.waitFor(() => {
        env.bundle.flushSync();
        expect(document.activeElement?.closest('.cr-services')).not.toBeNull();
      });
      expect(document.activeElement?.tagName).toBe('BUTTON');
      expect(document.activeElement?.textContent).toBe(i18n.t('settings.native.addService'));
    }, cloneDefaults());
  });

  it('focuses the connection test of the first service when a connection exists', async () => {
    await withEnv(async (env) => {
      bundle.intent.requestSettingsSection('connections');
      await vi.waitFor(() => {
        env.bundle.flushSync();
        expect(document.activeElement?.closest('.cr-services')).not.toBeNull();
      });
      expect(document.activeElement?.getAttribute('aria-label')).toBe('测试连接 daily');
    });
  });
});

describe('unconfigured workbench hint', () => {
  it('opens settings from the hint itself', async () => {
    const i18n = new I18n();
    const onOpenSettings = vi.fn();
    const target = document.body.appendChild(document.createElement('div'));
    const instance = workbench.mount(workbench.CreateHost, { target, props: {
      onOpenSettings,
      context: {
        i18n, app: { metadataCache: { on: () => ({}), offref() {}, getFileCache: () => null }, vault: { on: () => ({}), offref() {} } },
        application: { create: { define: vi.fn() }, queue: { subscribe: () => () => undefined } },
        settingsApplication: { getSettings: () => structuredClone(DEFAULT_SETTINGS), subscribeSettings: () => () => undefined },
      },
    } });
    try {
      workbench.flushSync();
      const hint = target.querySelector<HTMLButtonElement>('.cr-create-help--action')!;
      expect(hint.tagName).toBe('BUTTON');
      expect(hint.textContent).toContain(i18n.messages.workbench.product.notConfigured);
      expect(hint.textContent).toContain(i18n.messages.workbench.product.openSettings);
      hint.click();
      expect(onOpenSettings).toHaveBeenCalledOnce();
    } finally { await workbench.unmount(instance); target.remove(); }
  });
});
