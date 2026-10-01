import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { compile } from 'svelte/compiler';
import { I18n } from '../../core/i18n';
import { DEFAULT_SETTINGS, SettingsStore } from '../../data/settings-store';
import { SettingsApplication, type SemanticIndexPort } from '../../app/settings-application';
import { taskSettingsSummary } from '../settings-summaries';

let ui: {
    mount: (component: unknown, options: { target: HTMLElement; props: Record<string, unknown> }) => object;
    unmount: (instance: object) => Promise<void>;
    flushSync: () => void;
    SettingsRoot: unknown;
    QueueHost: unknown;
};
beforeAll(async () => {
    Object.defineProperty(HTMLElement.prototype, "empty", { configurable: true, value() { this.replaceChildren(); } });
    const result = await build({
        stdin: { contents: 'export { mount, unmount, flushSync } from "svelte"; export { default as SettingsRoot } from "./src/ui/svelte/settings/SettingsRoot.svelte"; export { default as QueueHost } from "queue-display-test-host";', resolveDir: process.cwd() },
        bundle: true, write: false, format: 'iife', globalName: 'SettingsTestUI',
        conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'],
        alias: { obsidian: './__mocks__/obsidian.ts', '@': './src' },
        plugins: [{ name: 'queue-display-test-host', setup(builder) {
            builder.onResolve({ filter: /^queue-display-test-host$/ }, ({ path }) => ({ path, namespace: 'test-host' }));
            builder.onLoad({ filter: /.*/, namespace: 'test-host' }, () => ({ resolveDir: process.cwd(), contents: compile('<script>import Queue from "./src/ui/svelte/workbench/QueueSection.svelte"; import { setWorkbenchContext } from "./src/ui/bridge/context"; let {context, tasks, status} = $props(); setWorkbenchContext(context);</script><Queue {tasks} {status} />', { filename: 'QueueHost.svelte', css: 'injected' }).js.code }));
        } }, sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: 'injected' } })],
    });
    ui = new Function(`${result.outputFiles[0].text}; return SettingsTestUI;`)();
});
afterAll(() => { document.body.replaceChildren(); Reflect.deleteProperty(HTMLElement.prototype, "empty"); });

async function harness(failSave = false) {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.daily = { apiKey: '', enabled: true, apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat-main', defaultEmbedModel: 'embed-main', parameters: { temperature: 0.7 }, capabilities: { temperature: true } };
    settings.providers.research = { ...settings.providers.daily, defaultChatModel: 'reasoning-model' };
    settings.defaultProviderId = 'daily';
    settings.taskModels.write = { providerId: 'research', model: 'reasoning-model', parameters: { topP: 0.9, maxTokens: null } };
    settings.enableSemanticIndexing = true;
    settings.enableDuplicateDetection = true;
    const save = vi.fn(async () => { if (failSave) { failSave = false; throw new Error('synthetic disk failure'); } });
    const store = new SettingsStore({ loadData: async () => settings, saveData: save } as never);
    await store.loadSettings();
    const probe = vi.fn(async () => ({ ok: true as const, value: { chat: true, embedding: true } }));
    const maintenance = {
        scanSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { eligible: 3, indexed: 2, missing: 1, missingNotes: [{ cruid: 'missing-one', name: '缺失笔记', path: 'C/缺失.md', type: 'entity', status: 'draft' }] } })),
        inspectVectorFiles: vi.fn(async () => ({ ok: true as const, value: { indexedEntries: 2, physicalFiles: 3, orphanFiles: [{ path: 'vectors/orphan.json', mtime: 1, size: 1 }], missingEntries: [], staleEntries: [], invalidEntries: [] } })),
        cleanupOrphanedVectorFiles: vi.fn(async () => ({ ok: true as const, value: { deleted: 1, skipped: 0, failed: 0 } })),
        embedMissingSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { eligible: 3, indexed: 1, skipped: 0, failed: 0 } })),
        embedOneSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { indexed: 1, failed: 0 } })),
        rebuildSemanticIndex: vi.fn(async () => ({ ok: true as const, value: { indexed: 3, skipped: 0, failed: 0 } })),
        rebuildDuplicatePairs: vi.fn(async () => ({ ok: true as const, value: 2 })),
        cancelSemanticIndexRebuild: vi.fn(),
    };
    const ensure = vi.fn(async () => maintenance as unknown as SemanticIndexPort);
    const reset = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const application = new SettingsApplication({ settingsStore: store, providerProbe: { probe } as never, ensureSemanticIndex: ensure, resetRuntimeData: reset });
    const target = document.body.appendChild(document.createElement('div'));
    const instance = ui.mount(ui.SettingsRoot, { target, props: { app: {}, i18n: new I18n(), settingsApplication: application } });
    ui.flushSync();
    const button = (label: string) => {
        const result = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(el => el.textContent?.trim() === label);
        if (!result) throw new Error(`Missing button: ${label}`);
        return result;
    };
    const click = (label: string) => { button(label).click(); ui.flushSync(); };
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); ui.flushSync(); };
    return { target, application, store, save, probe, ensure, reset, maintenance, click, button, settle,
        cleanup: async () => { await ui.unmount(instance); application.dispose(); target.remove(); } };
}

describe('approved settings information architecture', () => {
    it('opens seven compact task summaries and changes disclosure without writes, probes or runtime initialization', async () => {
        const h = await harness();
        try {
            expect(h.target.querySelectorAll('.cr-task-summary')).toHaveLength(7);
            expect(h.target.querySelector('.cr-task-model-card')).toBeNull();
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-write')!.click(); ui.flushSync();
            expect(h.target.querySelectorAll('.cr-task-model-card')).toHaveLength(1);
            expect(h.target.querySelector<HTMLDetailsElement>('.cr-task-model-card details')!.open).toBe(false);
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-define')!.click(); ui.flushSync();
            expect(h.target.querySelectorAll('.cr-task-model-card')).toHaveLength(1);
            expect(h.target.querySelector('#tmc-write-model')).toBeNull();
            h.click('笔记与卡片');
            expect(h.target.querySelector<HTMLInputElement>('[aria-label="知识库根目录"]')).toBeTruthy();
            h.target.querySelector<HTMLDetailsElement>('details')!.open = true;
            h.click('维护与备份');
            expect(h.target.textContent).toContain('Markdown 笔记会保留');
            expect(h.target.textContent).toContain('正文和卡片不在备份中');
            expect(h.target.textContent).toContain('成功重置后目前没有一键恢复入口');
            expect(h.target.textContent).toContain('不要单独恢复队列或工作流');
            expect(h.target.textContent).toContain('settings.json 可能包含 API Key');
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('links card settings back to the one independently configured task editor', async () => {
        const h = await harness();
        try {
            h.click('笔记与卡片');
            h.click('调整'); await h.settle();
            expect(h.target.querySelector('#cr-task-trigger-cards')?.getAttribute('aria-expanded')).toBe('true');
            expect(h.target.querySelectorAll('.cr-task-model-card')).toHaveLength(1);
            expect(h.target.textContent).toContain('独立配置');
            expect(h.save).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('reveals only the repair corresponding to an explicit inspection and keeps cleanup confirmation', async () => {
        const h = await harness();
        try {
            h.click('维护与备份');
            const locale = new I18n();
            expect(h.target.textContent).not.toContain(locale.t('settings.advanced.semanticIndexing.embedMissing'));
            h.click(locale.t('settings.advanced.semanticIndexing.scanMissing')); await h.settle();
            expect(h.maintenance.scanSemanticIndex).toHaveBeenCalledOnce();
            expect(h.target.textContent).toContain(locale.t('settings.advanced.semanticIndexing.embedMissing'));
            expect(h.maintenance.embedMissingSemanticIndex).not.toHaveBeenCalled();
            h.click(locale.t('settings.advanced.semanticIndexing.scanVectorFiles')); await h.settle();
            h.click(locale.t('settings.advanced.semanticIndexing.cleanupVectorFiles'));
            expect(h.target.querySelector('[role="dialog"]')).toBeTruthy();
            expect(h.maintenance.cleanupOrphanedVectorFiles).not.toHaveBeenCalled();
            h.click('取消');
            expect(h.target.querySelector('[role="dialog"]')).toBeNull();
            h.click(locale.t('settings.advanced.semanticIndexing.cleanupVectorFiles'));
            h.click(locale.t('settings.advanced.semanticIndexing.cleanupVectorFilesConfirm')); await h.settle();
            expect(h.maintenance.cleanupOrphanedVectorFiles).toHaveBeenCalledWith([{ path: 'vectors/orphan.json', mtime: 1, size: 1 }]);
            expect(h.maintenance.rebuildSemanticIndex).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('retains failed-save feedback across navigation and retries the same mutation', async () => {
        const h = await harness(true);
        try {
            const select = h.target.querySelector<HTMLSelectElement>('[aria-label="默认 Provider"]')!;
            select.value = 'research'; select.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.application.getSaveState().status).toBe('save-failed');
            h.click('维护与备份'); expect(h.target.querySelector('[role="alert"]')).toBeTruthy();
            h.click('重试'); await h.settle();
            expect(h.application.getSaveState().status).toBe('saved');
            expect(h.store.getSettings().defaultProviderId).toBe('research');
            expect(h.save).toHaveBeenCalledTimes(2);
        } finally { await h.cleanup(); }
    });
    it('opens and cancels provider editing without persisting or probing', async () => {
        const h = await harness();
        try {
            h.click('编辑连接');
            expect(h.target.querySelector('#pm-chat-model')).toBeTruthy();
            expect(h.target.querySelector<HTMLDetailsElement>('.cr-provider-disclosure:last-of-type')?.open).toBe(false);
            h.click('取消');
            expect(h.target.querySelector('[role="dialog"]')).toBeNull();
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('navigates tabs with Arrow/Home/End and retains a single tab stop', async () => {
        const h = await harness();
        try {
            const first = h.target.querySelector<HTMLButtonElement>('[role="tab"]')!;
            first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })); ui.flushSync();
            expect(h.target.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('维护与备份');
            expect(h.target.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
            h.target.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); ui.flushSync();
            expect(h.target.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('AI 与模型');
        } finally { await h.cleanup(); }
    });
});

describe('read-only task summary', () => {
    it('resolves inheritance while preserving Cards requirements and disabled assignments', () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.defaultProviderId = 'daily';
        settings.providers.daily = { enabled: true, apiKey: '', apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat', defaultEmbedModel: 'embed' };
        const before = structuredClone(settings);
        expect(taskSettingsSummary(settings, 'define')).toMatchObject({ source: 'inherited', resolved: { providerId: 'daily', model: 'chat' } });
        expect(taskSettingsSummary(settings, 'index').resolved.model).toBe('embed');
        expect(taskSettingsSummary(settings, 'cards')).toMatchObject({ source: 'independent', issue: 'unconfigured', resolved: { providerId: '', model: '' } });
        expect(settings).toEqual(before);
        settings.providers.daily.enabled = false;
        expect(taskSettingsSummary(settings, 'define').issue).toBe('disabled');
        settings.taskModels.write.parameters = { topP: null };
        expect(taskSettingsSummary(settings, 'write').source).toBe('customized');
    });
});


describe('display preferences do not change task execution', () => {
    it('uses configured batch size while select-all still includes every filtered task and summary stays visible', async () => {
        const h = await harness();
        let queueInstance: object | undefined;
        const target = document.body.appendChild(document.createElement('div'));
        try {
            await h.application.updateSettings({ queuePageSize: 25, queueDefaultFilter: 'all' });
            const tasks = Array.from({ length: 63 }, (_, i) => ({ id: `task-${i}`, noteTitle: `任务 ${i}`, stageId: 'verify', state: i < 60 ? 'completed' : i < 62 ? 'failed' : 'interrupted', payload: {} }));
            const props = { context: { i18n: new I18n(), settingsApplication: h.application, application: { queue: {} } }, tasks, status: { total: 63, pending: 0, running: 0, completed: 60, failed: 2, interrupted: 1, cancelled: 0, paused: false } };
            queueInstance = ui.mount(ui.QueueHost, { target, props }); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(25);
            const selectAll = target.querySelector<HTMLInputElement>('.cr-queue-select-all input')!;
            selectAll.checked = true; selectAll.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(target.textContent).toContain('删除选中 (63)');
            const more = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.includes('显示更多'))!;
            more.click(); ui.flushSync(); expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(50);
            await h.application.updateSettings({ queuePageSize: 100, queueDefaultFilter: 'failed' }); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(63);
            await ui.unmount(queueInstance); queueInstance = ui.mount(ui.QueueHost, { target, props }); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(2);
            expect(target.textContent).toContain('失败 2'); expect(target.textContent).toContain('已中断');
            const filter = target.querySelector<HTMLSelectElement>('.cr-queue-select-label select')!;
            filter.value = 'active'; filter.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(0);
            expect(target.textContent).toContain('失败 2'); expect(target.textContent).toContain('已中断');
            expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { if (queueInstance) await ui.unmount(queueInstance); target.remove(); await h.cleanup(); }
    });
    it('can restore only the three display options without resetting models or directories', async () => {
        const h = await harness();
        try {
            await h.application.updateSettings({ verifyReportPresentation: 'collapsed', queueDefaultFilter: 'failed', queuePageSize: 25 });
            const before = h.store.getSettings();
            h.click('笔记与卡片');
            h.click('恢复这三项显示偏好的默认值'); await h.settle();
            expect(h.store.getSettings()).toEqual({ ...before, verifyReportPresentation: 'expanded', queueDefaultFilter: 'all', queuePageSize: 50 });
        } finally { await h.cleanup(); }
    });
});
