/** Live, explicitly opted-in feature evaluation. Never reads personal settings or notes. */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { compileRuntime } from './generate-prompts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = 'http://39.105.206.63:8317/v1';
const model = 'gpt-6.1-sol';
const key = process.env.CR_TEST_API_KEY;
if (!key) throw new Error('Set CR_TEST_API_KEY for an explicitly authorized test run.');
const fixture = JSON.parse(await readFile(resolve(root, 'evals/core_features.json'), 'utf8'));
const output = resolve(root, process.env.CR_EVAL_OUTPUT || 'tmp/feature_eval/results.json');
const selected = process.argv.slice(2);
const cases = fixture.cases.filter(c => !selected.length || selected.includes(c.id));
if (!cases.length || selected.some(id => !fixture.cases.some(c => c.id === id))) throw new Error('Unknown or empty case selection.');
await mkdir(dirname(output), { recursive: true });
const extraFile = resolve(root, 'tmp/feature_eval/runtime.mjs');
await mkdir(dirname(extraFile), { recursive: true });
await build({ stdin: { contents: `export { ProviderManager } from './src/core/provider-manager'; export { DEFAULT_SETTINGS, SettingsStore } from './src/data/settings-store'; export { requestProviderStream } from './src/core/provider-streaming';`, resolveDir: root }, outfile: extraFile, bundle: true, platform: 'node', format: 'esm', target: 'es2022', alias: { obsidian: resolve(root, '__mocks__/obsidian.ts') }, banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, logLevel: 'silent' });
const extra = await import(pathToFileURL(extraFile).href);
await unlink(extraFile);
const { runtime, sourceDigest } = await compileRuntime();
const sha = text => createHash('sha256').update(text).digest('hex');
const promptManager = await runtime.createExportPromptManager(path => readFile(resolve(root, path), 'utf8'));
const settings = structuredClone(extra.DEFAULT_SETTINGS);
settings.defaultProviderId = 'feature-eval';
settings.providers = { 'feature-eval': { apiKey: key, baseUrl, apiFormat: 'openai-responses', embeddingApiFormat: 'disabled', defaultChatModel: model, defaultEmbedModel: '', enabled: true, capabilities: { reasoning: true, nativeWebSearch: false }, parameters: { reasoning_effort: 'high' } } };
settings.providerTimeoutMs = 180000;
settings.providerMaxAttempts = 1;
settings.enableStreamingKeepalive = true;
const results = { generatedAt: new Date().toISOString(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceDigest, model, baseUrl, protocol: 'openai-responses', reasoningEffort: 'high', transport: 'production node-http streaming; production request assembly, parsing and task executors; mocked Obsidian host', fixtureSha256: sha(await readFile(resolve(root, 'evals/core_features.json'))), cases: [] };
let active;
const transport = {
  async requestJson() { throw new Error('This run explicitly requires production streaming transport.'); },
  async requestStream(input) {
    active.wireRequest = JSON.parse(input.body);
    active.endpoint = input.url;
    const response = await extra.requestProviderStream(input);
    active.httpStatus = response.status;
    active.rawStream = response.body;
    active.streamDiagnostics = response.diagnostics;
    return response;
  },
  dispose() {}
};
function snapshot(id, title, body, suffix) {
  const frontmatter = { cruid: `${id}-${suffix}`, type: 'entity', name: title, status: 'draft', created: '2026-10-26 00:00:00', updated: '2026-10-26 00:00:00', aliases: [title], tags: ['cr-test'], parents: ['[[CR测试-信号处理]]'], sourceUids: [`cr-test-source-${suffix}`] };
  const content = `---\n${Object.entries(frontmatter).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n${body}\n`;
  return { nodeId: frontmatter.cruid, path: `CR测试/4-实体/${title}-${suffix}.md`, content, contentHash: sha(content), frontmatter };
}
const flush = () => {
  const content = JSON.stringify(results, null, 2);
  if (content.includes(key)) throw new Error('Credential found in result; refusing to save.');
  return writeFile(output, content, 'utf8');
};
for (const c of cases) {
  active = { id: c.id, startedAt: new Date().toISOString(), expected: c.expected };
  results.cases.push(active);
  const config = structuredClone(settings);
  config.providers['feature-eval'].capabilities.nativeWebSearch = c.search === true;
  const store = new extra.SettingsStore({ loadData: async () => config, saveData: async () => { throw new Error('Test settings must stay in memory.'); } }, runtime.logger);
  const loaded = await store.loadSettings();
  if (!loaded.ok) throw new Error(`Invalid explicit test configuration: ${loaded.error.code}`);
  const manager = new extra.ProviderManager(store, runtime.logger, undefined, undefined, undefined, transport);
  const primary = snapshot(c.id, c.title, c.primary ?? c.body, 'a');
  const task = { id: `test-${c.id}`, nodeId: primary.nodeId, workflowId: `test-${c.id}`, stageId: c.taskType, state: 'running', createdAt: Date.now(), updatedAt: Date.now(), attempt: 1 };
  const example = { id: c.id, taskType: c.taskType, fixture: 'Public-source synthetic test note, not user data.' };
  if (c.taskType === 'merge') {
    example.merge = { pairId: c.id, type: 'entity', similarity: 0.93, canonical: primary, redundant: snapshot(c.id, c.title, c.secondary, 'b'), linkRepairPlan: { entries: [], replacementCount: 0, skipped: [] } };
  } else if (c.taskType === 'verify') {
    example.task = { ...task, payload: { filePath: primary.path, currentContent: primary.content, noteType: 'entity', concept: { type: 'entity', name: { chinese: c.title, english: '' }, coreDefinition: '数字信号处理测试材料', source: 'define', parents: primary.frontmatter.parents } } };
  } else {
    example.task = { ...task, payload: { filePath: primary.path, targetPath: `CR测试/卡片/${c.title}-decks.md`, body: c.body, noteType: 'entity', promptVersion: 'cards-v1' } };
  }
  const start = Date.now();
  console.log(`START ${c.id} search=${c.search === true}`);
  try {
    active.result = await runtime.executePromptExample(example, { settingsStore: store, promptManager, providerManager: manager });
    active.elapsedMs = Date.now() - start;
    active.calls = manager.getExternalCallDiagnostics();
    console.log(`END ${c.id} ok=${active.result.ok} elapsedMs=${active.elapsedMs}${active.result.ok ? '' : ` code=${active.result.error.code}`}`);
  } catch (e) {
    active.failure = { name: e.name, message: String(e.message).replaceAll(key, '[redacted]') };
    console.log(`END ${c.id} failure=${e.name}`);
  } finally { manager.dispose(); await flush(); }
}
results.completedAt = new Date().toISOString();
await flush();
if (results.cases.some(c => !c.result?.ok)) process.exitCode = 1;
