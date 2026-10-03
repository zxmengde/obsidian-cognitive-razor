import * as obsidian from "obsidian";
import { ProviderManager } from "../../core/provider-manager";
import { buildTaskChatRequest } from "../../core/task-execution-support";
import { resolveTaskModelSnapshot } from "../../core/task-model-resolver";
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { compile } from 'svelte/compiler';
import { readFileSync } from 'node:fs';
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

async function harness(failSave = false, saveDelay?: () => Promise<void>, expandOverrides = true) {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.providers.daily = { apiKey: '', enabled: true, apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat-main', defaultEmbedModel: 'embed-main', parameters: { temperature: 0.7 }, capabilities: { temperature: true } };
    settings.providers.research = { ...settings.providers.daily, defaultChatModel: 'reasoning-model' };
    settings.defaultProviderId = 'daily';
    settings.taskModels.write = { providerId: 'research', model: 'reasoning-model', parameters: { topP: 0.9, maxTokens: null } };
    settings.enableSemanticIndexing = true;
    settings.enableDuplicateDetection = true;
    const save = vi.fn(async () => { await saveDelay?.(); if (failSave) { failSave = false; throw new Error('synthetic disk failure'); } });
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
    const navigate = vi.fn(() => { target.scrollTop = 0; });
    const instance = ui.mount(ui.SettingsRoot, { target, props: { app: {}, i18n: new I18n(), settingsApplication: application, onTabNavigate: navigate } });
    ui.flushSync();
    if (expandOverrides) {
        target.querySelector<HTMLButtonElement>('[aria-label="按任务单独调整（进阶）"]')!.click();
        ui.flushSync();
    }
    const button = (label: string) => {
        const result = Array.from(target.querySelectorAll<HTMLElement>('button, [role="button"]')).find(el => el.textContent?.trim().replace(/\s*›$/, '') === label);
        if (!result) throw new Error(`Missing button: ${label}`);
        return result;
    };
    const click = (label: string) => { button(label).click(); ui.flushSync(); };
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); ui.flushSync(); };
    const openTask = async (task: string) => {
        target.querySelector<HTMLButtonElement>(`#cr-task-trigger-${task}`)!.click();
        await settle();
        return target.querySelector<HTMLElement>('.cr-task-detail-view:not([hidden])')!;
    };
    const back = async () => {
        target.querySelector<HTMLButtonElement>('.cr-task-detail-view:not([hidden]) [aria-label="返回 AI 与模型"]')!.click();
        await settle();
    };
    return { target, application, store, save, probe, ensure, reset, maintenance, click, button, settle, navigate,
        openTask, back,
        cleanup: async () => { await ui.unmount(instance); application.dispose(); target.remove(); } };
}

describe('approved settings information architecture', () => {
    it('has no provider output-mode choice or per-task output override', async () => {
        const h = await harness();
        try {
            for (const taskType of ['define', 'tag', 'write', 'verify']) {
                const task = await h.openTask(taskType);
                expect(task.querySelector(`#tmc-${taskType}-structured`)).toBeNull();
                expect(task.textContent).not.toContain('结构化输出');
                await h.back();
            }
            const modalSource = readFileSync('src/ui/svelte/modals/ProviderModal.svelte', 'utf8');
            expect(modalSource).not.toContain('pm-structured-output');
            expect(modalSource).not.toContain('formStructuredOutput');
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('propagates real UI edits through persisted settings and reload into the actual request payload', async () => {
        const h = await harness();
        const request = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({ status: 200, text: '', json: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } } as never);
        try {
            const task = await h.openTask('write');
            const change = async (selector: string, value: string) => {
                const input = task.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
                input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            };
            await change('#tmc-write-provider', 'daily');
            await change('#tmc-write-model', 'ui-selected-model');
            task.querySelector<HTMLDetailsElement>('.cr-task-model-card__advanced')!.querySelector('summary')!.click(); ui.flushSync();
            await change('#tmc-write-temp-mode', 'set'); await change('#tmc-write-temp', '0.25');
            await change('#tmc-write-max-tokens-mode', 'set'); await change('#tmc-write-max-tokens', '512');
            const saved = (h.save.mock.calls.at(-1) as unknown as [typeof DEFAULT_SETTINGS])[0];
            const reloaded = new SettingsStore({ loadData: async () => structuredClone(saved), saveData: vi.fn() } as never);
            expect((await reloaded.loadSettings()).ok).toBe(true);
            expect(reloaded.getSettings()).toEqual(h.store.getSettings());
            const manager = new ProviderManager(reloaded, { debug() {}, info() {}, warn() {}, error() {} });
            try {
                expect((await manager.chat(buildTaskChatRequest('write', '<system_instructions>policy</system_instructions>synthetic input', resolveTaskModelSnapshot(reloaded.getSettings(), 'write')))).ok).toBe(true);
                const body = JSON.parse((request.mock.calls[0][0] as { body: string }).body);
                expect(body).toMatchObject({ model: 'ui-selected-model', temperature: 0.25, max_tokens: 512 });
            } finally { manager.dispose(); }
            expect(h.probe).not.toHaveBeenCalled();
        } finally { request.mockRestore(); await h.cleanup(); }
    });

    it('keeps connection actions folded and preserves temporary forced-provider probes without editing tasks', async () => {
        const h = await harness();
        try {
            const card = Array.from(h.target.querySelectorAll<HTMLElement>('.cr-provider-card')).find(el => el.querySelector('.cr-provider-card__name')?.textContent?.includes('daily'))!;
            const menu = card.querySelector<HTMLDetailsElement>('.cr-provider-extra')!;
            expect(menu.open).toBe(false);
            expect(h.target.querySelector<HTMLSelectElement>('[aria-label="默认 Provider"] option[value="daily"]')?.textContent).toContain('daily · chat-main');
            const before = structuredClone(h.store.getSettings().taskModels);
            menu.querySelector('summary')!.click(); ui.flushSync();
            card.querySelector<HTMLButtonElement>('.cr-provider-link')!.click(); ui.flushSync();
            const mode = card.querySelector<HTMLSelectElement>('[aria-label="测试范围"]')!;
            mode.value = 'temporary'; mode.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            card.querySelector<HTMLButtonElement>('.cr-provider-test button')!.click(); await h.settle();
            expect((h.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: 'daily', taskType: 'write', taskConfig: { providerId: 'daily', model: 'reasoning-model' } });
            expect(card.querySelector('.cr-provider-probe-status__target')?.textContent).toContain('临时使用此连接');
            expect(h.store.getSettings().taskModels).toEqual(before); expect(h.save).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('retains location preview and original configuration after save failure, then retries once', async () => {
        const h = await harness(true);
        try {
            h.click('笔记与卡片'); h.target.querySelector<HTMLButtonElement>('#cr-locations-edit')!.click(); ui.flushSync();
            const input = h.target.querySelector<HTMLInputElement>('[aria-label="知识库根目录"]')!;
            input.value = 'New/Root'; input.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            h.click('预览变化'); h.click('确认并保存位置'); await h.settle();
            expect(h.store.getSettings().cardsSourceRoot).toBe(DEFAULT_SETTINGS.cardsSourceRoot);
            expect(h.target.querySelector('.cr-location-preview')).toBeTruthy();
            expect(h.target.querySelector('.cr-location-editor [role="alert"]')).toBeTruthy();
            h.click('确认并保存位置'); await h.settle();
            expect(h.store.getSettings().cardsSourceRoot).toBe('New/Root'); expect(h.save).toHaveBeenCalledTimes(2);
        } finally { await h.cleanup(); }
    });
    it('rejects a stale location preview without overwriting externally updated locations', async () => {
        const h = await harness();
        try {
            h.click('笔记与卡片'); h.target.querySelector<HTMLButtonElement>('#cr-locations-edit')!.click(); ui.flushSync();
            h.click('预览变化');
            await h.store.updateSettings({ cardsTargetRoot: 'Changed/Decks' }); await h.settle(); h.save.mockClear();
            h.click('确认并保存位置'); await h.settle();
            expect(h.store.getSettings().cardsTargetRoot).toBe('Changed/Decks');
            expect(h.target.querySelector('.cr-location-editor')?.textContent).toContain('预览期间位置已改变');
            expect(h.save).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('tests the actual index task snapshot and invalidates the displayed result after edits', async () => {
        const h = await harness();
        try {
            await h.store.updateTaskModel('index', { providerId: 'research', model: 'actual-embed', parameters: { embeddingDimension: 256 } }); await h.settle();
            const task = await h.openTask('index');
            const button = task.querySelector<HTMLButtonElement>('.cr-task-details__probe button')!;
            button.click(); await h.settle();
            expect(h.probe).toHaveBeenCalledOnce();
            expect((h.probe.mock.calls[0] as unknown as [unknown])[0]).toMatchObject({ providerId: 'research', taskType: 'index', taskConfig: { providerId: 'research', model: 'actual-embed', embeddingDimension: 256 } });
            expect(task.querySelector('.cr-provider-probe-status__target')?.textContent?.replace(/\s+/g, ' ')).toContain('research · actual-embed · 请求维度: 256');
            expect(task.querySelector('.cr-provider-probe-status__capabilities')?.textContent).toContain(new I18n().t('settings.provider.probe.status.disabled'));
            await h.store.updateTaskModel('index', { model: 'changed-embed' }); await h.settle();
            expect(task.querySelector('.cr-provider-probe-status')).toBeNull();
            h.probe.mockResolvedValueOnce({ ok: false, error: { code: 'E211_MODEL_SCHEMA_VIOLATION', message: 'Synthetic' } } as never);
            button.click(); await h.settle();
            expect(task.querySelector('.cr-provider-probe-status__target')?.textContent).toContain('changed-embed');
            expect(task.querySelector('.cr-provider-probe-status')?.textContent).toContain(new I18n().t('settings.redesign.testOutcomes.failed'));
        } finally { await h.cleanup(); }
    });
    it('makes model inheritance explicit and never persists an empty specified draft', async () => {
        const h = await harness();
        try {
            const cards = await h.openTask('cards');
            const mode = cards.querySelector<HTMLSelectElement>('#tmc-cards-model-mode')!;
            expect(mode.value).toBe('inherit'); expect(cards.querySelector('#tmc-cards-model')).toBeNull();
            mode.value = 'specified'; mode.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().taskModels.cards.model).toBe('chat-main');
            const model = cards.querySelector<HTMLInputElement>('#tmc-cards-model')!;
            model.value = ''; model.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().taskModels.cards.model).toBe('chat-main'); expect(cards.querySelector('[role="alert"]')).toBeTruthy();
            await h.back(); await h.openTask('cards'); expect(model.value).toBe('');
            mode.value = 'inherit'; mode.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().taskModels.cards.model).toBe(''); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('leaves seven legacy custom paths intact until conversion is previewed and confirmed', async () => {
        const h = await harness();
        try {
            const legacy = { directoryScheme: { domain: 'Old/A', issue: 'Old/B', theory: 'Different/C', entity: 'D', mechanism: 'E' }, cardsSourceRoot: 'Original', cardsTargetRoot: 'Decks' };
            await h.store.updateSettings(legacy); await h.settle(); h.save.mockClear();
            h.click('笔记与卡片'); expect(h.target.querySelector('.cr-location-heading')?.textContent).toContain('自定义位置');
            expect(h.target.querySelector('.cr-location-example')).toBeNull();
            expect(h.target.querySelector('.cr-workflow-tab')?.textContent).toContain('机制笔记目录不在卡片来源范围内');
            expect(h.store.getSettings()).toMatchObject(legacy);
            h.target.querySelector<HTMLButtonElement>('#cr-locations-edit')!.click(); ui.flushSync();
            expect(h.target.querySelector<HTMLInputElement>('[aria-label="领域"]')?.value).toBe('Old/A');
            const mode = h.target.querySelector<HTMLSelectElement>('.cr-location-editor select')!;
            mode.value = 'unified'; mode.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            h.click('预览变化'); expect(h.target.querySelectorAll('.cr-location-change')).toHaveLength(7);
            expect(h.store.getSettings()).toMatchObject(legacy); expect(h.save).not.toHaveBeenCalled();
            h.click('确认并保存位置'); await h.settle();
            expect(h.store.getSettings().directoryScheme.domain).toBe('Original/1-领域');
            expect(h.store.getSettings().cardsTargetRoot).toBe('Decks'); expect(h.save).toHaveBeenCalledOnce();
            expect(h.target.querySelector('.cr-location-example')?.textContent).toContain('Original/5-机制/笔记.md → Decks/5-机制/笔记-decks.md');
            expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it.each(['', 'x', 'prefix-test-only-suffix'])('shows only configuration status for a saved credential (%s)', async (key) => {
        const h = await harness();
        try {
            expect((await h.store.updateProvider('daily', { apiKey: key })).ok).toBe(true); await h.settle();
            const card = Array.from(h.target.querySelectorAll<HTMLElement>('.cr-provider-card')).find(el => el.querySelector('.cr-provider-card__name')?.textContent?.includes('daily'))!;
            const details = card.querySelector<HTMLDetailsElement>('details')!; details.open = true;
            const value = Array.from(details.querySelectorAll('dt')).find(el => el.textContent === 'API Key')!.nextElementSibling!;
            expect(value.textContent).toBe(key ? '已配置' : '未配置'); expect(value.innerHTML).not.toContain('••••');
            expect(value.getAttribute('title')).toBeNull(); expect(value.getAttribute('data-key')).toBeNull();
            expect(h.store.getSettings().providers.daily.apiKey).toBe(key); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('keeps task inheritance visible while override controls are opt-in and preserves existing assignments', async () => {
        const h = await harness(false, undefined, false);
        try {
            const before = structuredClone(h.store.getSettings());
            expect(h.target.querySelectorAll('.cr-task-summary')).toHaveLength(3);
            expect(h.target.querySelector('.cr-other-task-summary')?.textContent).toContain('定义、标记、撰写、核查、合并');
            expect(h.target.querySelector('#cr-task-trigger-cards')?.textContent).toContain('daily · chat-main');
            expect(h.target.querySelectorAll('[id^="cr-task-trigger-"]')).toHaveLength(3);
            expect(h.target.textContent).toContain('沿用默认');
            expect(h.target.querySelector('[aria-label="按任务单独调整（进阶）"]')?.textContent).toContain('4 项沿用默认');
            h.target.querySelector<HTMLButtonElement>('[aria-label="按任务单独调整（进阶）"]')!.click(); ui.flushSync();
            expect(h.target.querySelectorAll('[id^="cr-task-trigger-"]')).toHaveLength(7);
            await h.openTask('write'); await h.back();
            expect(document.activeElement?.id).toBe('cr-task-trigger-write');
            h.target.querySelector<HTMLButtonElement>('[aria-label="按任务单独调整（进阶）"]')!.click(); ui.flushSync();
            expect(h.target.querySelectorAll('[id^="cr-task-trigger-"]')).toHaveLength(3);
            expect(h.store.getSettings()).toEqual(before);
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });

    it('warns when existing services have no default without silently choosing or clearing overrides', async () => {
        const h = await harness(false, undefined, false);
        try {
            await h.application.updateSettings({ defaultProviderId: '' }); await h.settle();
            expect(h.target.textContent).toContain('已有可用服务，但尚未选择默认服务');
            expect(h.target.querySelector('[role="status"]')).not.toBeNull();
            expect(h.store.getSettings().defaultProviderId).toBe('');
            expect(h.store.getSettings().taskModels.write.providerId).toBe('research');
            await h.application.updateSettings({ defaultProviderId: 'daily' }); await h.settle();
            expect(h.target.textContent).not.toContain('已有可用服务，但尚未选择默认服务');
            expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });

    it('keeps unavailable inherited tasks individually visible and exposes all seven adjustments', async () => {
        const h = await harness(false, undefined, false);
        try {
            await h.store.updateProvider('daily', { enabled: false }); await h.settle();
            expect(h.target.querySelector('.cr-inherited-summary')).toBeNull();
            expect(h.target.querySelectorAll('.cr-task-summary')).toHaveLength(7);
            expect(h.target.querySelector('#cr-task-trigger-cards')?.textContent).toContain('服务已禁用');
            h.target.querySelector<HTMLButtonElement>('[aria-label="按任务单独调整（进阶）"]')!.click(); ui.flushSync();
            expect(h.target.querySelector('#cr-task-trigger-index')?.textContent).toContain('embed-main');
            await h.openTask('cards'); await h.back();
            expect(document.activeElement?.id).toBe('cr-task-trigger-cards');
            expect(h.target.querySelectorAll('[id^="cr-task-trigger-"]')).toHaveLength(7);
            expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });

    it('starts without example providers and resolves ordinary tasks from a single default without replacing overrides', () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        expect(settings.providers).toEqual({}); expect(settings.defaultProviderId).toBe('');
        settings.defaultProviderId = 'one';
        settings.providers.one = { enabled: true, apiKey: '', apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat', defaultEmbedModel: 'embed' };
        for (const task of ['define', 'tag', 'write', 'verify', 'merge'] as const) {
            expect(taskSettingsSummary(settings, task)).toMatchObject({ source: 'inherited', resolved: { providerId: 'one', model: 'chat' } });
        }
        expect(taskSettingsSummary(settings, 'index').resolved.model).toBe('embed');
        settings.taskModels.define.providerId = 'old-assignment';
        expect(taskSettingsSummary(settings, 'define')).toMatchObject({ source: 'customized', issue: 'unconfigured', resolved: { providerId: 'old-assignment' } });
        settings.taskModels.cards = { providerId: 'one', model: 'chat' };
        expect(taskSettingsSummary(settings, 'cards')).toMatchObject({ source: 'customized', issue: undefined, resolved: { providerId: 'one', model: 'chat' } });
        expect(Object.keys(settings.providers)).toEqual(['one']);
    });

    it('keeps its title and text tabs distinct from host heading and button defaults', async () => {
        // Cascade regression only: happy-dom does not verify browser geometry.
        // Use the host rules reported by real-host QA, not its full theme.
        const style = document.head.appendChild(document.createElement('style'));
        style.textContent = `
            .vertical-tab-content h1 { display: none; }
            .vertical-tab-content h2 { padding: 0 16px; }
            .vertical-tab-content h1, .vertical-tab-content h3 { padding: 0 16px; }
            button:not(.clickable-icon) { box-shadow: var(--input-shadow); }
            .cr-scope { --font-ui-medium: 16px; --size-4-4: 16px; --input-shadow: 0 0 0 1px black; }
            ${readFileSync('styles.css', 'utf8')}
        `;
        const h = await harness();
        h.target.classList.add('vertical-tab-content', 'cr-scope');
        try {
            const title = h.target.querySelector<HTMLElement>('.cr-settings-title')!;
            expect(title.textContent).toBe('Cognitive Razor');
            expect(getComputedStyle(title).display).toBe('block');
            expect(getComputedStyle(title).paddingLeft).toBe('0px');
            expect(getComputedStyle(title).paddingRight).toBe('0px');
            expect(getComputedStyle(h.target.querySelector<HTMLElement>('.cr-settings-content')!).paddingLeft).toBe('0px');
            expect(getComputedStyle(h.target.querySelector<HTMLElement>('[role="tablist"]')!).position).not.toBe('sticky');
            expect(h.button('编辑').tagName).toBe('BUTTON');
            expect(getComputedStyle(h.button('编辑')).boxShadow).toBe('none');
            for (const tab of Array.from(h.target.querySelectorAll<HTMLElement>('[role="tab"]'))) {
                const css = getComputedStyle(tab);
                expect(css.flexGrow).toBe('0');
                expect(css.boxShadow).toBe('none');
                expect(css.height).toBe('auto');
                expect(css.borderRadius).toBe('0px');
            }
            // A preceding header must not cause extra top padding on section 1.
            for (const label of ['AI 与模型', '笔记与卡片', '维护与备份']) {
                h.click(label);
                const section = h.target.querySelector<HTMLElement>('.cr-settings-section')!;
                expect(getComputedStyle(section).paddingTop).toBe('0px');
                const heading = h.target.querySelector<HTMLElement>('.cr-settings-page-heading h2')!;
                expect(getComputedStyle(heading).paddingLeft).toBe('0px');
                expect(getComputedStyle(heading).paddingRight).toBe('0px');
                for (const heading of Array.from(h.target.querySelectorAll<HTMLElement>('.cr-settings-section h3, .cr-settings-danger h3'))) {
                    expect(getComputedStyle(heading).paddingLeft).toBe('0px');
                    expect(getComputedStyle(heading).paddingRight).toBe('0px');
                }
            }
            expect(getComputedStyle(h.target.querySelector<HTMLElement>('.cr-settings-danger .cr-btn-danger')!).backgroundColor).toBe('transparent');
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); style.remove(); }
    });
    it('resets host scroll after switching panels but not after editing a setting', async () => {
        const h = await harness();
        try {
            h.target.scrollTop = 640;
            h.click('维护与备份'); await h.settle();
            expect(h.target.querySelector('[role="tabpanel"]')?.id).toBe('cr-settings-panel-backup');
            expect(h.target.scrollTop).toBe(0);
            expect(h.navigate).toHaveBeenCalledOnce();
            h.target.scrollTop = 320;
            h.click('笔记与卡片'); await h.settle();
            expect(h.target.scrollTop).toBe(0);
            expect(h.navigate).toHaveBeenCalledTimes(2);
            h.target.scrollTop = 120;
            h.target.querySelector<HTMLButtonElement>('#cr-locations-edit')!.click(); ui.flushSync();
            const rootInput = h.target.querySelector<HTMLInputElement>('[aria-label="知识库根目录"]')!;
            rootInput.value = 'Example/cards-source';
            rootInput.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.target.scrollTop).toBe(120);
            expect(h.navigate).toHaveBeenCalledTimes(2);
            expect(h.store.getSettings().cardsSourceRoot).toBe(DEFAULT_SETTINGS.cardsSourceRoot);
            expect(h.save).not.toHaveBeenCalled();
            h.click('预览变化'); h.click('确认并保存位置'); await h.settle();
            expect(h.store.getSettings().cardsSourceRoot).toBe('Example/cards-source');
            expect(h.save).toHaveBeenCalledOnce();
            expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('previews all seven location fields before an atomic save and cancels without writes', async () => {
        const h = await harness();
        try {
            h.click('笔记与卡片');
            expect(h.target.querySelectorAll('.cr-location-paths dd')).toHaveLength(5);
            const open = () => { h.target.querySelector<HTMLButtonElement>('#cr-locations-edit')!.click(); ui.flushSync(); };
            open();
            expect(h.target.querySelectorAll('.cr-location-editor input')).toHaveLength(7);
            const root = h.target.querySelector<HTMLInputElement>('[aria-label="知识库根目录"]')!;
            root.value = 'Example/Knowledge'; root.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            h.click('预览变化');
            expect(h.target.querySelectorAll('.cr-location-change')).toHaveLength(7);
            expect(h.target.querySelector('.cr-location-preview')?.textContent).toContain('Example/Knowledge/1-领域');
            expect(h.store.getSettings().cardsSourceRoot).toBe(DEFAULT_SETTINGS.cardsSourceRoot);
            expect(h.save).not.toHaveBeenCalled();
            h.click('取消');
            expect(h.target.querySelector('.cr-location-editor')).toBeNull(); expect(h.save).not.toHaveBeenCalled();
            open(); const input = h.target.querySelector<HTMLInputElement>('[aria-label="知识库根目录"]')!;
            input.value = 'Example/Knowledge'; input.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            h.click('预览变化'); h.click('确认并保存位置'); await h.settle();
            expect(h.store.getSettings().directoryScheme.domain).toBe('Example/Knowledge/1-领域');
            expect(h.store.getSettings().cardsSourceRoot).toBe('Example/Knowledge');
            expect(h.target.querySelector('.cr-location-editor')).toBeNull();
            expect(h.save).toHaveBeenCalledOnce(); expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('shows slider numbers once while preserving unit conversion, range edits and clamping', async () => {
        const h = await harness();
        const locale = new I18n();
        try {
            h.click('维护与备份');
            h.click(locale.t('settings.redesign.execution'));
            const timeout = h.target.querySelector<HTMLInputElement>(`input[type="number"][aria-label="${locale.t('settings.advanced.queue.taskTimeout')}"]`)!;
            const slider = timeout.closest('.cr-slider')!;
            expect(slider.querySelector('.cr-slider__unit')?.textContent).toBe(locale.t('common.units.seconds'));
            expect(timeout.value).toBe(String(h.store.getSettings().taskTimeoutMs / 1000));
            timeout.value = '90';
            timeout.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().taskTimeoutMs).toBe(90000);
            expect(slider.querySelector<HTMLInputElement>('input[type="range"]')?.value).toBe('90');

            const concurrency = h.target.querySelector<HTMLInputElement>(`input[type="number"][aria-label="${locale.t('settings.concurrency.name')}"]`)!;
            const concurrencySlider = concurrency.closest('.cr-slider')!;
            expect(concurrencySlider.querySelector('.cr-slider__unit')).toBeNull();
            concurrency.value = '99';
            concurrency.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().concurrency).toBe(10);
            const range = concurrencySlider.querySelector<HTMLInputElement>('input[type="range"]')!;
            range.value = '3';
            range.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().concurrency).toBe(3);
            expect(concurrency.value).toBe('3');
            expect(h.save).toHaveBeenCalledTimes(3);
            expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('persists both 3600-second timeout controls as milliseconds across settings reload', async () => {
        const h = await harness();
        const locale = new I18n();
        try {
            h.click('维护与备份');
            h.click(locale.t('settings.redesign.execution'));
            for (const label of ['taskTimeout', 'networkTimeout']) {
                const input = h.target.querySelector<HTMLInputElement>(`input[type="number"][aria-label="${locale.t(`settings.advanced.queue.${label}`)}"]`)!;
                input.value = '3600';
                input.dispatchEvent(new Event('change', { bubbles: true }));
                await h.settle();
                expect(input.value).toBe('3600');
            }
            const saved = (h.save.mock.lastCall as unknown as [typeof DEFAULT_SETTINGS])[0];
            const reloaded = new SettingsStore({ loadData: async () => saved, saveData: async () => undefined } as never);
            expect((await reloaded.loadSettings()).ok).toBe(true);
            expect(reloaded.getSettings()).toMatchObject({ taskTimeoutMs: 3_600_000, providerTimeoutMs: 3_600_000 });
            expect(h.save).toHaveBeenCalledTimes(2);
        } finally { await h.cleanup(); }
    });
    it('opts only compact switch controls into inline rows and preserves their changes', async () => {
        const h = await harness();
        const locale = new I18n();
        try {
            h.click('笔记与卡片');
            const switches = Array.from(h.target.querySelectorAll<HTMLElement>('[role="switch"]'));
            expect(switches).toHaveLength(3);
            for (const control of switches) {
                expect(control.closest('.cr-setting-item')?.classList.contains('cr-setting-item--inline-control')).toBe(true);
            }
            for (const control of Array.from(h.target.querySelectorAll('input'))) {
                expect(control.closest('.cr-setting-item')?.classList.contains('cr-setting-item--inline-control')).toBe(false);
            }
            const autoVerify = switches.find(control => control.getAttribute('aria-label')?.startsWith(locale.t('settings.product.autoVerify')))!;
            autoVerify.click(); await h.settle();
            expect(h.store.getSettings().enableAutoVerify).toBe(true);
            expect(autoVerify.getAttribute('aria-checked')).toBe('true');
            h.click('维护与备份');
            h.click(locale.t('settings.redesign.execution'));
            const keepalive = h.target.querySelector<HTMLElement>('[role="switch"]')!;
            expect(keepalive.closest('.cr-setting-item')?.classList.contains('cr-setting-item--inline-control')).toBe(true);
            const previous = h.store.getSettings().enableStreamingKeepalive;
            keepalive.click(); await h.settle();
            expect(h.store.getSettings().enableStreamingKeepalive).toBe(!previous);
            expect(h.save).toHaveBeenCalledTimes(2);
        } finally { await h.cleanup(); }
    });
    it('keeps generation rows compact and folds threshold and API explanations with display options', async () => {
        const h = await harness();
        const locale = new I18n();
        try {
            h.click('笔记与卡片');
            const workflow = h.target.querySelector<HTMLElement>('.cr-workflow-tab')!;
            const generation = Array.from(workflow.querySelectorAll<HTMLElement>('.cr-settings-section')).find(section => section.querySelector('h3')?.textContent === locale.t('settings.product.generation'))!;
            const rows = Array.from(generation.querySelectorAll<HTMLElement>('.cr-setting-item'));
            expect(rows).toHaveLength(3);
            expect(rows.map(row => row.querySelector('.cr-setting-item__name')?.textContent)).toEqual(['创建后自动核查', '语义索引', '发现相似笔记']);
            expect(rows.map(row => row.querySelector('.cr-feature-status')?.textContent)).toEqual(['关闭', '开启', '开启']);
            expect(generation.querySelector('.cr-setting-item__desc')).toBeNull();
            expect(generation.querySelector('.cr-slider')).toBeNull();
            const auto = rows[0].querySelector<HTMLElement>('[role="switch"]')!;
            expect(auto.getAttribute('aria-label')).toContain(locale.t('settings.redesign.autoVerifyCost'));
            expect(auto.closest('[title]')?.getAttribute('title')).toBe(locale.t('settings.redesign.autoVerifyCost'));
            const options = workflow.querySelector<HTMLDetailsElement>('.cr-settings-disclosure')!;
            expect(options.open).toBe(false);
            expect(options.querySelector('.cr-feature-explanations')?.textContent).toContain(locale.t('settings.redesign.autoVerifyCost'));
            expect(options.querySelector('.cr-feature-explanations')?.textContent).toContain(locale.t('settings.advanced.semanticIndexing.enabledDesc'));
            options.querySelector('summary')!.click(); ui.flushSync();
            expect(options.open).toBe(true);
            const threshold = options.querySelector<HTMLInputElement>(`input[type="number"][aria-label="${locale.t('settings.similarityThreshold.name')}"]`)!;
            threshold.value = '0.82'; threshold.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().similarityThreshold).toBe(0.82);
            auto.click(); await h.settle();
            expect(rows[0].querySelector('.cr-feature-status')?.textContent).toBe('开启');
            rows[1].querySelector<HTMLElement>('[role="switch"]')!.click(); await h.settle();
            expect(rows[1].querySelector('.cr-feature-status')?.textContent).toBe('关闭');
            expect(rows[2].querySelector('.cr-feature-status')?.textContent).toBe('需先开启索引');
            expect(rows[2].querySelector('[role="switch"]')?.getAttribute('aria-disabled')).toBe('true');
            expect(h.store.getSettings().enableDuplicateDetection).toBe(true);
            expect(options.querySelector('.cr-slider')).toBeNull();
            rows[1].querySelector<HTMLElement>('[role="switch"]')!.click(); await h.settle();
            expect(rows[2].querySelector('.cr-feature-status')?.textContent).toBe('开启');
            expect(options.querySelector<HTMLInputElement>(`input[type="number"][aria-label="${locale.t('settings.similarityThreshold.name')}"]`)?.value).toBe('0.82');
            rows[2].querySelector<HTMLElement>('[role="switch"]')!.click(); await h.settle();
            expect(h.store.getSettings().enableDuplicateDetection).toBe(false);
            expect(rows[2].querySelector('.cr-feature-status')?.textContent).toBe('关闭');
            options.querySelector('summary')!.click(); ui.flushSync();
            expect(options.open).toBe(false);
            expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('shows transport only within enabled streaming advanced controls and persists explicit selection', async () => {
        const h = await harness(); const locale = new I18n();
        try {
            h.click('维护与备份'); h.click(locale.t('settings.redesign.execution'));
            const selector = 'select[aria-label="' + locale.t('settings.advanced.queue.streamingTransport') + '"]';
            expect(h.target.querySelector(selector)).toBeNull();
            h.target.querySelector<HTMLElement>('[role="switch"]')!.click(); await h.settle();
            const select = h.target.querySelector<HTMLSelectElement>(selector)!;
            expect(select.value).toBe('node-http'); select.value = 'renderer-fetch'; select.dispatchEvent(new Event('change', { bubbles: true })); await h.settle();
            expect(h.store.getSettings().streamingTransport).toBe('renderer-fetch');
            h.target.querySelector<HTMLElement>('[role="switch"]')!.click(); await h.settle();
            expect(h.target.querySelector(selector)).toBeNull(); expect(h.store.getSettings().streamingTransport).toBe('renderer-fetch');
        } finally { await h.cleanup(); }
    });
    it('opens a dedicated task page and returns focus to its overview row without writes or probes', async () => {
        const h = await harness();
        try {
            expect(h.target.querySelectorAll('.cr-task-summary')).toHaveLength(7);
            expect(h.target.querySelector('.cr-task-model-card')).toBeNull();
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-write')!.click(); await h.settle();
            expect(h.target.querySelectorAll('.cr-task-model-card')).toHaveLength(1);
            expect(h.target.querySelector('.cr-providers-tab')).toBeNull();
            expect(h.target.querySelectorAll('.cr-task-summary')).toHaveLength(0);
            expect(h.target.querySelector('.cr-task-details__breadcrumb')?.textContent).toContain('AI 与模型');
            expect(h.target.querySelector('.cr-task-details')?.textContent).toContain('只调整这一个任务');
            expect(document.activeElement?.id).toBe('cr-task-detail-heading-write');
            expect(h.target.querySelector<HTMLDetailsElement>('.cr-task-model-card details')!.open).toBe(false);
            h.target.querySelector<HTMLButtonElement>('[aria-label="返回 AI 与模型"]')!.click(); await h.settle();
            expect(h.target.querySelectorAll('.cr-task-summary')).toHaveLength(7);
            expect(document.activeElement?.id).toBe('cr-task-trigger-write');
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-define')!.click(); ui.flushSync();
            expect(h.target.querySelectorAll('.cr-task-detail-view:not([hidden]) .cr-task-model-card')).toHaveLength(1);
            expect(h.target.querySelector('#tmc-write-model')?.closest('.cr-task-detail-view')?.hasAttribute('hidden')).toBe(true);
            h.click('笔记与卡片');
            expect(h.target.querySelector('#cr-locations-edit')).toBeTruthy();
            expect(h.target.querySelector('.cr-location-paths')?.textContent).toContain(DEFAULT_SETTINGS.cardsSourceRoot);
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
    it('keeps cards and index editing exclusively on AI and models', async () => {
        const h = await harness();
        try {
            h.click('笔记与卡片'); await h.settle();
            expect(h.target.querySelectorAll('[id^="cr-task-trigger-"]')).toHaveLength(0);
            expect(h.target.querySelectorAll('.cr-task-model-card')).toHaveLength(0);
            expect(h.target.querySelector('.cr-workflow-tab')?.textContent).not.toContain('卡片使用模型');
            h.click('AI 与模型'); await h.openTask('cards');
            expect(document.activeElement?.id).toBe('cr-task-detail-heading-cards');
            expect(h.target.querySelectorAll('.cr-task-model-card')).toHaveLength(1);
            expect(h.target.textContent).toContain('跟随当前默认服务');
            expect(h.target.querySelector<HTMLSelectElement>('#tmc-cards-model-mode')?.value).toBe('inherit');
            expect(h.target.querySelector('#tmc-cards-model')).toBeNull();
            expect(h.save).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('retains each task draft, validation error and disclosure across back and tab navigation', async () => {
        const h = await harness();
        try {
            const write = await h.openTask('write');
            const advanced = write.querySelector<HTMLDetailsElement>('.cr-task-model-card__advanced')!;
            advanced.querySelector('summary')!.click(); ui.flushSync();
            const mode = write.querySelector<HTMLSelectElement>('#tmc-write-max-tokens-mode')!;
            mode.value = 'set'; mode.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            const number = write.querySelector<HTMLInputElement>('#tmc-write-max-tokens')!;
            number.value = '0'; number.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(write.querySelector('[role="alert"]')).toBeTruthy();
            const model = write.querySelector<HTMLInputElement>('#tmc-write-model')!;
            model.value = 'uncommitted-model'; model.dispatchEvent(new Event('input', { bubbles: true }));
            await h.back();
            expect(write.hidden).toBe(true);
            const cards = await h.openTask('cards');
            expect(cards.querySelector<HTMLInputElement>('#tmc-cards-model')).toBeNull();
            expect(cards.querySelector<HTMLSelectElement>('#tmc-cards-model-mode')?.value).toBe('inherit');
            expect(cards.querySelector<HTMLSelectElement>('#tmc-cards-provider')?.value).toBe('');
            expect(cards.querySelector('[role="alert"]')).toBeNull();
            h.click('维护与备份'); await h.settle();
            expect(h.target.querySelector('.cr-task-detail-view:not([hidden])')).toBeNull();
            h.click('AI 与模型'); await h.settle();
            const resumed = await h.openTask('write');
            expect(resumed).toBe(write);
            expect(advanced.open).toBe(true);
            expect(model.value).toBe('uncommitted-model');
            expect(number.value).toBe('0');
            expect(mode.value).toBe('set');
            expect(write.querySelector('[role="alert"]')).toBeTruthy();
            expect(h.store.getSettings().taskModels.write.model).toBe('reasoning-model');
            expect(h.store.getSettings().taskModels.write.parameters?.maxTokens).toBeNull();
            expect(h.store.getSettings().taskModels.cards.providerId).toBe('');
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled(); expect(h.ensure).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('lets only the latest navigation scroll or focus after repeated clicks and rapid tab changes', async () => {
        const h = await harness();
        try {
            const trigger = h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-write')!;
            trigger.click(); trigger.click(); ui.flushSync();
            const maintenance = h.button('维护与备份'); maintenance.focus();
            h.click('维护与备份'); await h.settle();
            expect(document.activeElement).toBe(maintenance);
            expect(h.target.querySelector('.cr-task-detail-view:not([hidden])')).toBeNull();
            expect(h.navigate).toHaveBeenCalledOnce();

            h.click('AI 与模型'); await h.settle();
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-write')!.click(); ui.flushSync();
            h.target.querySelector<HTMLButtonElement>('.cr-task-detail-view:not([hidden]) .cr-task-details__back')!.click(); ui.flushSync();
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-cards')!.click(); await h.settle();
            expect(document.activeElement?.id).toBe('cr-task-detail-heading-cards');
            expect(h.target.querySelectorAll('.cr-task-detail-view:not([hidden])')).toHaveLength(1);
            expect(h.target.querySelectorAll('#tmc-write-model')).toHaveLength(1);
            expect(h.target.querySelectorAll('#tmc-cards-model-mode')).toHaveLength(1);
            expect(h.target.querySelectorAll('#tmc-cards-model')).toHaveLength(0);
            // A retained, hidden editor cannot take over the current route.
            h.target.querySelector<HTMLInputElement>('#tmc-write-model')!.closest('.cr-task-detail-view')!.querySelector<HTMLButtonElement>('.cr-task-details__back')!.click();
            await h.settle();
            expect(document.activeElement?.id).toBe('cr-task-detail-heading-cards');
            await h.back();
            expect(document.activeElement?.id).toBe('cr-task-trigger-cards');
            expect(h.save).not.toHaveBeenCalled(); expect(h.probe).not.toHaveBeenCalled();
        } finally { await h.cleanup(); }
    });
    it('does not scroll or steal focus after the settings root is unmounted during navigation', async () => {
        const h = await harness();
        const outside = document.body.appendChild(document.createElement('button'));
        try {
            h.target.querySelector<HTMLButtonElement>('#cr-task-trigger-write')!.click();
            outside.focus();
            await h.cleanup();
            await h.settle();
            expect(document.activeElement).toBe(outside);
            expect(h.navigate).not.toHaveBeenCalled();
        } finally { outside.remove(); }
    });
    it('retains in-flight task saves and failed-save retry across detail and tab navigation', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const h = await harness(true, () => gate);
        try {
            const write = await h.openTask('write');
            const model = write.querySelector<HTMLInputElement>('#tmc-write-model')!;
            model.value = 'changed-model';
            model.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(h.application.getSaveState().status).toBe('saving');
            expect(h.target.querySelector('.cr-settings-header .cr-settings-save-state[role="status"]')).toBeTruthy();
            await h.back();
            h.click('维护与备份'); await h.settle();
            release(); await h.settle();
            expect(h.application.getSaveState().status).toBe('save-failed');
            expect(h.target.querySelector('.cr-settings-save-state[role="alert"]')).toBeTruthy();
            expect(h.target.querySelector('.cr-settings-header .cr-settings-save-state[role="alert"] button')?.textContent?.trim()).toBe('重试');
            h.click('AI 与模型'); await h.settle();
            await h.openTask('write');
            expect(model.value).toBe('changed-model');
            h.click('重试'); await h.settle();
            expect(h.application.getSaveState().status).toBe('saved');
            expect(h.target.querySelector('.cr-settings-header .cr-settings-save-state[role="status"]')?.textContent?.trim()).toBe('已保存');
            expect(h.store.getSettings().taskModels.write.model).toBe('changed-model');
            expect(h.store.getSettings().taskModels.cards.model).toBe('');
            expect(h.save).toHaveBeenCalledTimes(2);
            expect(h.probe).not.toHaveBeenCalled();
        } finally { release(); await h.cleanup(); }
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
            h.click('编辑');
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
    it('resolves inheritance for Cards and preserves disabled assignments', () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.defaultProviderId = 'daily';
        settings.providers.daily = { enabled: true, apiKey: '', apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat', defaultEmbedModel: 'embed' };
        const before = structuredClone(settings);
        expect(taskSettingsSummary(settings, 'define')).toMatchObject({ source: 'inherited', resolved: { providerId: 'daily', model: 'chat' } });
        expect(taskSettingsSummary(settings, 'index').resolved.model).toBe('embed');
        expect(taskSettingsSummary(settings, 'cards')).toMatchObject({ source: 'inherited', issue: undefined, resolved: { providerId: 'daily', model: 'chat' } });
        expect(settings).toEqual(before);
        settings.providers.daily.enabled = false;
        expect(taskSettingsSummary(settings, 'define').issue).toBe('disabled');
        settings.taskModels.write.parameters = { topP: null };
        expect(taskSettingsSummary(settings, 'write').source).toBe('customized');
    });
});


describe('display preferences do not change task execution', () => {
    it('paginates history, excludes folded history from selection and retains unresolved summary while filtering', async () => {
        const h = await harness();
        let queueInstance: object | undefined;
        const target = document.body.appendChild(document.createElement('div'));
        try {
            await h.application.updateSettings({ queuePageSize: 25, queueDefaultFilter: 'all' });
            const tasks = Array.from({ length: 63 }, (_, i) => ({ id: `task-${i}`, noteTitle: `任务 ${i}`, stageId: 'verify', state: i < 60 ? 'completed' : i < 62 ? 'failed' : 'interrupted', payload: {} }));
            const props = { context: { i18n: new I18n(), settingsApplication: h.application, application: { queue: {} } }, tasks, status: { total: 63, pending: 0, running: 0, completed: 60, failed: 2, interrupted: 1, cancelled: 0, paused: false } };
            queueInstance = ui.mount(ui.QueueHost, { target, props }); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(3);
            const selectAll = target.querySelector<HTMLInputElement>('.cr-queue-select-all input')!;
            selectAll.checked = true; selectAll.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(target.textContent).toContain('删除选中 (3)');
            const history = target.querySelector<HTMLDetailsElement>('.cr-queue-history')!;
            history.querySelector('summary')!.click(); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(28);
            selectAll.checked = true; selectAll.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(target.textContent).toContain('删除选中 (63)');
            const more = Array.from(target.querySelectorAll('button')).find(button => button.textContent?.includes('显示更多'))!;
            more.click(); ui.flushSync(); expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(53);
            await h.application.updateSettings({ queuePageSize: 100, queueDefaultFilter: 'failed' }); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(63);
            await ui.unmount(queueInstance); queueInstance = ui.mount(ui.QueueHost, { target, props }); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(2);
            expect(target.textContent).toContain('需要处理 · 3 项');
            const filter = target.querySelector<HTMLSelectElement>('.cr-queue-select-label select')!;
            filter.value = 'active'; filter.dispatchEvent(new Event('change', { bubbles: true })); ui.flushSync();
            expect(target.querySelectorAll('[role="listitem"]')).toHaveLength(0);
            expect(target.textContent).toContain('需要处理 · 3 项');
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
