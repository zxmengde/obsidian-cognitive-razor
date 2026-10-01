/** Cloud-only synthetic UI harness. No vault, credentials, model or disk operations. */
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve(process.argv[2] || '/tmp/cognitive-settings-preview');
await mkdir(out, { recursive: true });
const entry = `
import { mount } from 'svelte';
import SettingsRoot from './src/ui/svelte/settings/SettingsRoot.svelte';
import { SettingsStore, DEFAULT_SETTINGS } from './src/data/settings-store';
import { SettingsApplication } from './src/app/settings-application';
import { I18n } from './src/core/i18n';
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
(async () => {
const settings = structuredClone(DEFAULT_SETTINGS);
const provider = { apiKey: '', enabled: true, apiFormat: 'openai-chat-completions', embeddingApiFormat: 'openai-embeddings', defaultChatModel: 'chat-main', defaultEmbedModel: 'embed-model', capabilities: { temperature: true, reasoning: true }, parameters: { temperature: 0.7 } };
settings.providers = { '日常服务': provider, '研究服务': { ...provider, defaultChatModel: 'reasoning-model', embeddingApiFormat: 'disabled' }, '卡片服务': { ...provider, defaultChatModel: 'cards-model', embeddingApiFormat: 'disabled' } };
settings.defaultProviderId = '日常服务';
settings.taskModels.write = { providerId: '研究服务', model: 'reasoning-model', parameters: { topP: 0.9, reasoning_effort: 'medium', maxTokens: null } };
settings.taskModels.cards = { providerId: '卡片服务', model: 'cards-model' };
settings.enableSemanticIndexing = true; settings.enableDuplicateDetection = true;
let failNextSave = false;
const stats = { saves: 0, probes: 0, scans: 0, actions: 0 };
const store = new SettingsStore({ loadData: async () => settings, saveData: async () => { stats.saves++; if (failNextSave) { failNextSave = false; throw Error('示例：磁盘保存失败'); } } });
await store.loadSettings();
const ok = value => ({ ok: true, value });
const port = {
scanSemanticIndex: async () => {stats.scans++; return ok({ eligible: 128, indexed: 125, missing: 3, missingNotes: [1,2,3].map(n => ({ cruid: 'example-'+n, name: '示例笔记 '+n, path: 'C-知识库/示例笔记-'+n+'.md', type: 'entity', status: 'draft' })) });},
inspectVectorFiles: async () => {stats.scans++; return ok({ indexedEntries:125, physicalFiles:127, orphanFiles: [1,2].map(n => ({path:'vectors/example-'+n+'.json',mtime:0,size:1})), missingEntries:[], staleEntries:[], invalidEntries:[] });},
embedMissingSemanticIndex: async () => {stats.actions++; return ok({eligible:128,indexed:3,skipped:0,failed:0});},
embedOneSemanticIndex: async () => {stats.actions++; return ok({indexed:1,failed:0});},
cleanupOrphanedVectorFiles: async () => {stats.actions++; return ok({deleted:2,failed:0,skipped:0});},
rebuildDuplicatePairs: async () => {stats.actions++; return ok(0);},
rebuildSemanticIndex: async () => {stats.actions++; return ok({indexed:128,skipped:0,failed:0});}, cancelSemanticIndexRebuild() {} };
const application = new SettingsApplication({ settingsStore: store, providerProbe: {probe:async () => {stats.probes++; return ok({chat:true,embedding:true});}}, ensureSemanticIndex:async () => port, rebuildSemanticNote:async () => {stats.actions++;return ok({indexed:1,failed:0});}, resetRuntimeData:async () => {stats.actions++;return ok(undefined);} });
window.preview = { stats, application, store, failNextSave: () => failNextSave = true };
document.getElementById('fail-save').onclick = () => { failNextSave = true; document.getElementById('preview-feedback').textContent = '下次设置保存将模拟失败；可测试全局重试。'; };
document.getElementById('theme').onclick = () => document.body.classList.toggle('light');
document.getElementById('narrow').onclick = () => document.getElementById('app').style.width = '320px';
document.getElementById('wide').onclick = () => document.getElementById('app').style.width = '820px';
mount(SettingsRoot, {target:document.getElementById('app'), props:{app:{},i18n:new I18n(),settingsApplication:application}});
})();`;
await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true, outfile: path.join(out, 'preview.js'), format: 'iife', conditions: ['svelte', 'browser'], mainFields: ['svelte', 'browser', 'module', 'main'], alias: { obsidian: './__mocks__/obsidian.ts', '@': './src' }, plugins: [sveltePlugin({ preprocess: sveltePreprocess(), compilerOptions: { css: 'injected' } })] });
await copyFile('styles.css', path.join(out, 'styles.css'));
await writeFile(path.join(out, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cognitive Razor 设置 · 合成数据预览</title><link rel="stylesheet" href="styles.css"><style>
:root{--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#393939;--background-modifier-border-hover:#555;--background-modifier-hover:#ffffff08;--background-modifier-cover:#0009;--text-normal:#ddd;--text-muted:#999;--text-faint:#777;--text-error:#e58c8c;--text-success:#7bbd8a;--interactive-accent:#a997df;--interactive-accent-hover:#9a87d1;--text-on-accent:#181818;--color-orange:#d7ab66;--color-red:#d38a8a;--color-green:#7eb58b;--color-blue:#7cadd1;--font-ui-medium:16px;--font-ui-small:14px;--font-ui-smaller:12px;--font-text-size:16px;--h2-size:24px;--font-interface:Arial,'Noto Sans CJK SC',sans-serif;--font-monospace:monospace;color-scheme:dark}
.preview-tools{display:flex;gap:8px;flex-wrap:wrap;max-width:820px;margin:12px auto;padding:0 20px;font-size:12px}#app{width:820px;max-width:100%}*{box-sizing:border-box}body{background:var(--background-primary);color:var(--text-normal);font:16px/1.5 var(--font-interface);margin:0}body.light{--background-primary:#fafafa;--background-secondary:#f0f0f0;--background-modifier-border:#ddd;--background-modifier-hover:#00000006;--text-normal:#262626;--text-muted:#666;--text-faint:#888;--interactive-accent:#7356b7;--color-orange:#95691b;--color-red:#b04949;color-scheme:light}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default}#app{max-width:820px;margin:0 auto;padding:28px}aside{padding:12px 28px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--background-modifier-border);display:flex;justify-content:space-between;gap:12px}.footer{max-width:820px;margin:0 auto;padding:28px;color:var(--text-muted);font-size:12px;border-top:1px solid var(--background-modifier-border)}@media(max-width:520px){#app{padding:20px}aside{padding:12px 20px}}
</style></head><body><aside><span>实际组件 · 合成示例数据</span><span>云端浏览器预览 / 非 Obsidian 宿主</span></aside><div class="preview-tools"><button id="theme">深色 / 浅色</button><button id="narrow">320px 容器</button><button id="wide">桌面宽度</button><button id="fail-save">模拟下一次保存失败</button><span id="preview-feedback" role="status"></span></div><main id="app" class="cr-scope"></main><div class="footer">不连接模型，不读取笔记或真实配置。此预览用于布局与交互检查；仍需专用 Obsidian 测试库验收。</div><script src="preview.js"></script></body></html>`);
console.log(out);
