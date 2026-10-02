import * as obsidian from 'obsidian';
import { DEFAULT_SETTINGS } from '../../data/settings-store';
import { TaskQueue } from '../../core/task-queue';
import { ProviderManager } from '../../core/provider-manager';
import { VerifyTaskExecutor } from '../../core/verify-task-executor';
import { ProviderTimeoutError } from '../../core/provider-transport';
import type { TaskExecutionContext } from '../../types';
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { compile } from "svelte/compiler";
import { I18n } from "../../core/i18n";
import { ok, type TaskRecord, type QueueStatus } from "../../types";

let ui: {
  mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
  unmount: (instance: object) => Promise<void>;
  flushSync: () => void;
  QueueHost: unknown;
};
beforeAll(async () => {
  Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
  const result = await build({
    stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as QueueHost } from "queue-host";', resolveDir: process.cwd() },
    bundle: true, write: false, format: "iife", globalName: "QueueTestUI",
    conditions: ["svelte", "browser"], mainFields: ["svelte", "browser", "module", "main"],
    alias: { obsidian: "./__mocks__/obsidian.ts", "@": "./src" },
    plugins: [{ name: "queue-host", setup(builder) {
      builder.onResolve({ filter: /^queue-host$/ }, () => ({ path: "queue-host", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ resolveDir: process.cwd(), contents: compile(
        '<script>import Queue from "./src/ui/svelte/workbench/QueueSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let { context, tasks, status } = $props(); setWorkbenchContext(context);</script><Queue {tasks} {status} />',
        { filename: "QueueHost.svelte", css: "injected" },
      ).js.code }));
    } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: "injected" } })],
  });
  ui = new Function(`${result.outputFiles[0].text}; return QueueTestUI;`)();
});

afterAll(() => { Reflect.deleteProperty(HTMLElement.prototype, "empty"); });


function fixture() {
  const tasks: TaskRecord[] = [
    { id: "known", nodeId: "known", noteTitle: "Known failure", stageId: "core", payload: {}, state: "failed", createdAt: 1, updatedAt: 1, attempt: 1, error: { code: "E401_PROVIDER_NOT_CONFIGURED", kind: "known", message: "synthetic private body" } },
    { id: "uncertain", nodeId: "uncertain", noteTitle: "Uncertain request", stageId: "core", payload: {}, state: "interrupted", createdAt: 2, updatedAt: 2, attempt: 1, error: { code: "E206_PROVIDER_REQUEST_UNCERTAIN", kind: "uncertain", message: "synthetic private body" } },
  ];
  const queue = {
    retry: vi.fn(async (_id: string) => ok(true)), retryUncertain: vi.fn(async (_id: string) => ok(true)),
    cancelAllActive: vi.fn(async () => ok(1)), retryFailed: vi.fn(async () => ok(1)), cancel: vi.fn(async (_id: string) => ok(true)),
    remove: vi.fn(async (_id: string) => ok(true)), pause: vi.fn(async () => ok(true)), resume: vi.fn(async () => ok(true)),
  };
  const status: QueueStatus = { paused: false, total: 2, pending: 0, running: 0, failed: 1, interrupted: 1, completed: 0, cancelled: 0 };
  const i18n = new I18n();
  const context = { i18n, application: { queue }, settingsApplication: { getSettings: () => ({ queuePageSize: 50 }), subscribeSettings: () => () => undefined } };
  return { tasks, status, queue, context, labels: i18n.messages.workbench.queueStatus };
}

describe("queue user actions with synthetic application responses", () => {
  it("keeps unresolved tasks above folded history and reveals safe details only on demand", async () => {
    const f = fixture();
    f.tasks.unshift({ ...f.tasks[0], id: 'done', noteTitle: 'Completed history', state: 'completed', error: undefined });
    f.status.completed = 1; f.status.total = 3;
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.QueueHost, { target, props: f });
    try {
      ui.flushSync();
      const rows = target.querySelectorAll('.cr-task-item');
      expect(rows[0].textContent).toContain('Known failure');
      expect(rows[1].textContent).toContain('Uncertain request');
      expect(rows).toHaveLength(2);
      const history = target.querySelector<HTMLDetailsElement>('.cr-queue-history')!;
      expect(history.open).toBe(false);

      expect(target.querySelector<HTMLDetailsElement>('.cr-queue-management')!.open).toBe(false);
      const details = rows[1].querySelector<HTMLDetailsElement>('details')!;
      expect(details.open).toBe(false);
      expect(rows[1].querySelector('.cr-task-warning')?.textContent).toContain('重试可能重复计费');
      expect(rows[1].querySelector('.cr-task-state')?.closest('details')).toBeNull();
      details.querySelector('summary')!.click(); ui.flushSync();
      expect(details.open).toBe(true); expect(details.textContent).toContain('必须由你单独确认');
      history.querySelector('summary')!.click(); ui.flushSync();
      expect(history.open).toBe(true);
      expect(history.querySelector('.cr-task-item')?.textContent).toContain('Completed history');
      expect(f.queue.retryUncertain).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each(['http524', 'local-timeout'] as const)('preserves %s from transport through Verify wrapping, queue reload and rendered feedback', async (mode) => {
    const request = vi.spyOn(obsidian, 'requestUrl');
    if (mode === 'http524') request.mockResolvedValue({ status: 524, headers: {}, text: 'private response body', json: {} } as never);
    else request.mockRejectedValue(new ProviderTimeoutError(60000));
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.defaultProviderId = 'synthetic';
    settings.providers.synthetic = { apiKey: '', baseUrl: 'https://example.test/v1', enabled: true, apiFormat: 'openai-responses', embeddingApiFormat: 'disabled', defaultChatModel: 'synthetic', defaultEmbedModel: '' };
    const settingsStore = { getSettings: () => settings, subscribe: () => () => undefined };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const files = new Map<string, string>();
    const fileStorage = {
      read: async (path: string) => files.has(path) ? ok(files.get(path)!) : { ok: false, error: { code: 'E301_FILE_NOT_FOUND', message: 'missing' } },
      atomicWrite: async (path: string, value: string) => { files.set(path, value); return ok(undefined); },
    };
    const manager = new ProviderManager(settingsStore as never, logger);
    const executor = new VerifyTaskExecutor({ providerManager: manager, logger,
      promptManager: { build: () => '<system_instructions>synthetic audit</system_instructions>synthetic input' } as never,
      responsePipeline: {} as never,
    });
    const queue = new TaskQueue(logger, settingsStore as never, { fileStorage: fileStorage as never });
    const restored = new TaskQueue(logger, settingsStore as never, { fileStorage: fileStorage as never });
    const target = document.body.appendChild(document.createElement('div'));
    let instance: object | undefined;
    try {
      expect((await queue.initialize()).ok).toBe(true);
      queue.setTaskRunner({ run: (task: TaskRecord, context: TaskExecutionContext) => executor.execute(task as TaskRecord<'verify'>, new AbortController().signal, context), abort() {} } as never);
      const admitted = await queue.enqueueDurably({ nodeId: 'node', workflowId: 'workflow', stageId: 'verify', payload: { filePath: 'Synthetic.md', currentContent: 'synthetic content', noteType: 'entity' } });
      expect(admitted.ok).toBe(true);
      await vi.waitFor(() => expect(queue.getSnapshot().status.interrupted).toBe(1));
      expect(request).toHaveBeenCalledOnce();
      expect((await restored.initialize()).ok).toBe(true);
      const snapshot = restored.getSnapshot();
      expect(snapshot.tasks[0].error).toMatchObject(mode === 'http524' ? { upstreamStatus: 524 } : { requestTimeoutMs: 60000 });
      expect(JSON.stringify(snapshot)).not.toContain('private response body');
      const f = fixture();
      instance = ui.mount(ui.QueueHost, { target, props: { ...f, ...snapshot } }); ui.flushSync();
      expect(target.textContent).toContain(mode === 'http524' ? '上游返回 HTTP 524' : '本地等待超时（本次阈值 60 秒）');
      expect(target.textContent).toContain('必须由你单独确认');
      expect(request).toHaveBeenCalledOnce();
    } finally { if (instance) await ui.unmount(instance); target.remove(); await queue.dispose(); await restored.dispose(); manager.dispose(); request.mockRestore(); }
  });

  it('labels keep and cancel distinctly and dispatches only the confirmed choice', async () => {
    const f = fixture(); f.tasks[0].state = 'running'; f.status.running = 1; f.status.failed = 0;
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.QueueHost, { target, props: f });
    try {
      ui.flushSync();
      const open = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.trim() === f.labels.cancelAllActive)!;
      open.click(); ui.flushSync();
      const buttons = target.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
      expect(Array.from(buttons).map(button => button.textContent?.trim())).toEqual(['保留任务', '取消任务']);
      buttons[0].click(); ui.flushSync(); expect(f.queue.cancelAllActive).not.toHaveBeenCalled();
      open.click(); ui.flushSync();
      target.querySelector<HTMLButtonElement>('[role="dialog"] .cr-btn-danger')!.click();
      await vi.waitFor(() => expect(f.queue.cancelAllActive).toHaveBeenCalledOnce());
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it.each([524, 0])("distinguishes upstream status from a local timeout (%s)", async (status) => {
    const f = fixture();
    Object.assign(f.tasks[1].error!, status ? { upstreamStatus: status } : { requestTimeoutMs: 60000 });
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.QueueHost, { target, props: f });
    try {
      ui.flushSync();
      expect(target.textContent).toContain(status ? '上游返回 HTTP 524' : '本地等待超时（本次阈值 60 秒）');
      if (status) expect(target.textContent).toContain('提高客户端超时不一定能解决');
      expect(target.innerHTML).not.toContain('synthetic private body');
      expect(f.queue.retryUncertain).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("shows reason, elapsed time and explicit next steps without exposing sensitive error text", async () => {
    const f = fixture();
    f.tasks[1].startedAt = 1000; f.tasks[1].finishedAt = 61000;
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.QueueHost, { target, props: f });
    try {
      ui.flushSync();
      const rows = target.querySelectorAll('.cr-task-item');
      expect(rows[0].textContent).toContain('默认服务');
      expect(rows[1].textContent).toContain('无法确认');
      expect(rows[1].textContent).toContain('本次运行约 60 秒');
      expect(rows[1].textContent).toContain('必须由你单独确认');
      expect(target.innerHTML).not.toContain('synthetic private body');
      expect(f.queue.retry).not.toHaveBeenCalled(); expect(f.queue.retryUncertain).not.toHaveBeenCalled();
    } finally { await ui.unmount(instance); target.remove(); }
  });

  it("allows narrow task metadata and the queue summary to wrap without fixed host button height", () => {
    // Source-level responsive contract; geometry still requires real host QA.
    const list = readFileSync('src/ui/svelte/workbench/QueueTaskList.svelte', 'utf8');
    const section = readFileSync('src/ui/svelte/workbench/QueueSection.svelte', 'utf8');
    for (const source of [list, section]) expect(source).toContain('@container cr-workbench (max-width: 620px)');
    expect(list).toContain('.cr-task-meta { grid-column: 2 / -1; grid-row: 2; }');
    expect(list).toContain('flex-wrap: wrap;');
    expect(section).toContain('height: auto; min-height: 32px; box-shadow: none;');
    expect(list).toContain('grid-row: 1; white-space: normal; overflow-wrap: anywhere;');
    expect(section).toContain('.cr-queue-stats { flex-basis: 100%; order: 1; min-width: 0; white-space: normal;');
    expect(section).not.toContain('text-overflow: ellipsis');
  });

  it("requires a separate confirmation for an uncertain retry and suppresses double dispatch", async () => {
    const f = fixture();
    let release!: (result: ReturnType<typeof ok<boolean>>) => void;
    f.queue.retryUncertain.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.QueueHost, { target, props: f });
    try {
      ui.flushSync();
      const retry = target.querySelectorAll<HTMLButtonElement>('.cr-task-item')[1].querySelector<HTMLButtonElement>(`button[aria-label="${f.labels.retry}"]`)!;
      retry.click(); ui.flushSync();
      expect(f.queue.retry).not.toHaveBeenCalled();
      expect(f.queue.retryUncertain).not.toHaveBeenCalled();
      const confirm = target.querySelector<HTMLButtonElement>('[role="dialog"] .cr-btn-danger')!;
      confirm.click(); confirm.click(); ui.flushSync();
      expect(f.queue.retryUncertain).toHaveBeenCalledExactlyOnceWith('uncertain');
      expect(retry.disabled).toBe(true);
      release(ok(true));
      await vi.waitFor(() => { ui.flushSync(); expect(retry.disabled).toBe(false); });
    } finally { release?.(ok(true)); await ui.unmount(instance); target.remove(); }
  });

  it("excludes uncertain requests from selected bulk retry and safely reports rejected actions", async () => {
    const f = fixture();
    f.queue.retry.mockRejectedValueOnce(new Error('synthetic private body'));
    const target = document.body.appendChild(document.createElement("div"));
    const instance = ui.mount(ui.QueueHost, { target, props: f });
    try {
      ui.flushSync();
      for (const checkbox of Array.from(target.querySelectorAll<HTMLInputElement>('.cr-task-select'))) checkbox.click();
      ui.flushSync();
      const retrySelected = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.includes(f.labels.retrySelected))!;
      expect(retrySelected.textContent).toContain('(1)');
      retrySelected.click();
      await vi.waitFor(() => { ui.flushSync(); expect(f.queue.retry).toHaveBeenCalledExactlyOnceWith('known'); expect(target.querySelector('[role="alert"]')).not.toBeNull(); });
      expect(f.queue.retryUncertain).not.toHaveBeenCalled();
      expect(target.textContent).not.toContain('synthetic private body');
    } finally { await ui.unmount(instance); target.remove(); }
  });
});
