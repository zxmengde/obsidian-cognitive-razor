/** Replay recorded live-model results at the real Obsidian persistence boundary.
 * Build as CommonJS with obsidian external; invoke run(app, fixtures, records).
 * This does not enable the installed plugin, load personal settings, or call a model.
 */
import { TFile, type App, type Vault } from 'obsidian';
import { FileStorage } from '../src/data/file-storage';
import { NoteRepository } from '../src/core/note-repository';
import { DuplicateMergeService } from '../src/core/duplicate-merge-service';
import { CardGenerationService } from '../src/core/card-generation-service';
import { generateMarkdownContent, generateFrontmatter, extractFrontmatter } from '../src/core/frontmatter-utils';
import { makeVerificationReportBlock } from '../src/core/verification-report';
import { SettingsStore, DEFAULT_SETTINGS } from '../src/data/settings-store';
import { ok, type ILogger, type TaskRecord } from '../src/types';

const TEST_ROOT = 'CR测试-feature-eval';
const DATA_ROOT = '.obsidian/plugins/obsidian-cognitive-razor/tmp/feature_eval/host';
const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
export let lastResults: any;
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

export async function run(app: App, fixtures: any, records: any) {
  if ((app.vault.adapter as any).getBasePath().replaceAll('\\', '/').toLowerCase() !== 'c:/code/obsidian') throw new Error('Wrong vault');
  const owned = new Set<string>();
  const guard = (path: string) => { if (!path.startsWith(`${TEST_ROOT}/`) || path.split('/').some(p => p === '..')) throw new Error('Outside test notes'); };
  const scopedVault = new Proxy(app.vault, { get(target, prop) {
    if (prop === 'getMarkdownFiles') return () => [...owned].map(p => target.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
    if (prop === 'getAbstractFileByPath') return (path: string) => { guard(path); return target.getAbstractFileByPath(path); };
    if (['read', 'cachedRead', 'process', 'modify', 'trash'].includes(String(prop))) return (file: TFile, ...args: any[]) => { guard(file.path); if (!owned.has(file.path)) throw new Error('Not an owned test file'); return (target as any)[prop](file, ...args); };
    const value = (target as any)[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const scoped = { vault: scopedVault, metadataCache: app.metadataCache } as App;
  const notes = new NoteRepository(scoped, logger);
  async function create(path: string, content: string) {
    guard(path);
    if (app.vault.getAbstractFileByPath(path)) throw new Error(`Existing test path; refusing overwrite: ${path}`);
    owned.add(path);
    await notes.create(path, content);
    return app.vault.getAbstractFileByPath(path) as TFile;
  }
  function content(id: string, name: string, body: string, parents: string[] = []) {
    return generateMarkdownContent(generateFrontmatter({ cruid: id, type: 'entity', name, parents, aliases: [name], tags: ['cr-test'] }), body);
  }
  const results: any = { startedAt: new Date().toISOString(), vault: 'C:/code/obsidian', replay: 'Recorded live GPT-6.1 Sol results, no additional host model request', excluded: ['Installed Cognitive Razor UI and task queue', 'Real embedding/vector refresh: controlled reindex callback only'], checks: [], files: [] };
  const runTag = Date.now().toString(36);
  lastResults = results;
  const check = (name: string, value: boolean, detail?: unknown) => results.checks.push({ name, passed: value, ...(detail === undefined ? {} : { detail }) });
  const getResult = (id: string) => unwrap(records.cases.find((c: any) => c.id === id).result) as any;
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.cardsSourceRoot = `${TEST_ROOT}/知识`;
  settings.cardsTargetRoot = `${TEST_ROOT}/卡片`;
  settings.defaultProviderId = 'recorded-model';
  settings.providers = { 'recorded-model': { enabled: true, apiKey: '', apiFormat: 'openai-responses', embeddingApiFormat: 'disabled', defaultChatModel: 'gpt-6.1-sol', defaultEmbedModel: '' } };
  const store = new SettingsStore({ loadData: async () => settings, saveData: async () => { throw new Error('No settings persistence'); } } as any, logger);
  unwrap(await store.loadSettings());
  for (const c of fixtures.cases.filter((c: any) => c.taskType === 'verify')) {
    const path = `${TEST_ROOT}/知识/${c.title}.md`;
    const before = content(`host-${c.id}`, c.title, c.body);
    const file = await create(path, before);
    const report = getResult(c.id).reportText;
    const manual = '\n\n人工验收保留标记：核查开始后添加的正文。\n';
    await app.vault.append(file, manual);
    const result = await notes.replaceVerificationReport(path, makeVerificationReportBlock(report), 'evergreen');
    const after = await app.vault.read(file);
    check(`${c.id}: report committed`, result === 'updated' && after.includes(report));
    check(`${c.id}: source body and later edit preserved`, after.includes(c.body) && after.includes(manual.trim()));
    check(`${c.id}: status evergreen`, extractFrontmatter(after)?.frontmatter.status === 'evergreen');
  }
  const storage = new FileStorage(app.vault, `${DATA_ROOT}/cards`);
  unwrap(await storage.initialize());
  const tasks: Array<TaskRecord<'cards'> & { workflowId: string; queueOrder: number }> = [];
  const queue = { getSnapshot: () => ({ tasks }), enqueueDurably: async (intent: any) => { tasks.push({ ...intent, id: intent.workflowId, queueOrder: tasks.length, state: 'running', createdAt: Date.now(), updatedAt: Date.now(), attempt: 1 }); return ok(intent.workflowId); } };
  const cards = new CardGenerationService({ storage, settings: store, notes, queue: queue as any });
  const port = cards.wrapPort({ resolve: async () => ok({}) });
  for (const c of fixtures.cases.filter((c: any) => c.taskType === 'cards')) {
    const source = `${TEST_ROOT}/知识/${c.title}.md`;
    const original = content(`host-${c.id}`, c.title, c.body);
    const sourceFile = await create(source, original);
    const marked = '\n<!-- cognitive-razor:verify-report -->\n核查报告不应成为制卡正文\n<!-- /cognitive-razor:verify-report -->\n';
    await app.vault.append(sourceFile, marked);
    const target = unwrap(await cards.start(source));
    let task = tasks.at(-1)!;
    const payload = unwrap(await port.resolve(task)) as any;
    check(`${c.id}: captured source excludes YAML and report`, payload.body === c.body);
    check(`${c.id}: mirrored target path`, target === source.replace('/知识/', '/卡片/').replace(/\.md$/, '-decks.md'));
    const originalTask = task;
    unwrap(await port.beforeComplete!(task, getResult(c.id), {} as any));
    task.state = 'completed';
    const targetFile = app.vault.getAbstractFileByPath(target) as TFile;
    owned.add(target);
    const first = await app.vault.read(targetFile);
    const manual = '\n\n手工保留标记：不得删除本段。\n';
    await app.vault.append(targetFile, manual);
    unwrap(await cards.start(source));
    task = tasks.at(-1)!;
    unwrap(await port.beforeComplete!(task, getResult(c.id), {} as any));
    task.state = 'completed';
    const after = await app.vault.read(targetFile);
    check(`${c.id}: append preserves existing file and manual content`, after.startsWith(first + manual));
    check(`${c.id}: repeated generation appends same batch by design`, after.split(getResult(c.id).markdown).length - 1 === 2);
    const beforeReplay = after;
    const replay = await port.beforeComplete!(originalTask, getResult(c.id), {} as any);
    check(`${c.id}: completed task cannot append twice`, !replay.ok && await app.vault.read(targetFile) === beforeReplay);
  }
  await cards.dispose();
  for (const c of fixtures.cases.filter((c: any) => c.taskType === 'merge')) {
    const preview = getResult(c.id);
    const primary = await create(`${TEST_ROOT}/知识/${c.id}-主笔记.md`, content(`${c.id}-a`, c.title, c.primary));
    // 每轮使用独立回收站文件，避免旧的同名测试记录造成假阳性。
    const secondary = await create(`${TEST_ROOT}/知识/${c.id}-冗余笔记-${runTag}.md`, content(`${c.id}-b`, c.title, c.secondary));
    const reference = await create(`${TEST_ROOT}/知识/${c.id}-引用.md`, content(`${c.id}-ref`, `${c.id}-引用`, `正文引用 [[${secondary.path}|保留显示文本]]。\n\n代码不应修复：\`[[${secondary.path}]]\`。`, [`[[${secondary.path}]]`]));
    // Host metadata positions are asynchronous; wait only for our own reference.
    for (let n = 0; n < 40 && !app.metadataCache.getFileCache(reference)?.links?.length; n++) await new Promise(r => setTimeout(r, 100));
    const pair = { id: c.id, type: 'entity', similarity: 0.93, nodeIdA: `${c.id}-a`, nodeIdB: `${c.id}-b`, status: 'pending' };
    const cache = { getFile: (id: string) => { const f = id === pair.nodeIdA ? primary : id === pair.nodeIdB ? secondary : undefined; return f && app.vault.getAbstractFileByPath(f.path) === f ? f : undefined; } };
    const journal = new FileStorage(app.vault, `${DATA_ROOT}/${c.id}`);
    unwrap(await journal.initialize());
    const indexCalls: string[] = [];
    const service = new DuplicateMergeService({ app: scoped, fileStorage: journal, noteRepository: notes, cruidCache: cache as any, duplicateManager: { getPair: () => pair, removePairsByNodeId: async () => { pair.status = 'merged'; return ok(undefined); } } as any, providerManager: {} as any, promptManager: {} as any, settingsStore: store, reindex: async path => { indexCalls.push(path); return ok({ indexed: 1, failed: 0 }); }, logger });
    unwrap(await service.initialize());
    const captured = unwrap(await service.captureMergeInput(c.id, pair.nodeIdA));
    const draft = { ...preview.draft, canonicalContentHash: captured.canonical.contentHash, redundantContentHash: captured.redundant.contentHash };
    const confirmed = await service.confirmMerge(draft, captured.linkRepairPlan);
    const final = await app.vault.read(primary);
    const links = await app.vault.read(reference);
    check(`${c.id}: merged body committed`, confirmed.ok && final.includes(draft.body));
    check(`${c.id}: body and parent links repaired`, links.includes(`[[${primary.path}|保留显示文本]]`) && extractFrontmatter(links)?.frontmatter.parents.some(p => p.includes(primary.path.replace(/\.md$/, ''))) === true, { plannedReplacements: captured.linkRepairPlan.replacementCount });
    check(`${c.id}: inline code untouched`, links.includes(`\`[[${secondary.path}]]\``));
    check(`${c.id}: redundant removed from active vault`, app.vault.getAbstractFileByPath(secondary.path) === null);
    const trash = `.trash/${secondary.name}`;
    check(`${c.id}: redundant found in local trash`, await app.vault.adapter.exists(trash), { path: trash });
    check(`${c.id}: completed operation not offered for recovery`, service.getRecoveryOperations().length === 0);
    check(`${c.id}: reindex seam invoked (embedding excluded)`, indexCalls.length === 1 && indexCalls[0] === primary.path);
    await service.dispose();
  }
  results.files = [...owned].filter(p => app.vault.getAbstractFileByPath(p));
  results.completedAt = new Date().toISOString();
  return results;
}

/** Deterministic reproduction of the known edit window, using real Vault.process. */
export async function runMergeRace(app: App, records: any, timing: 'after_confirmation' | 'before_confirmation' | 'before_confirmation_redundant' = 'after_confirmation') {
  if ((app.vault.adapter as any).getBasePath().replaceAll('\\', '/').toLowerCase() !== 'c:/code/obsidian') throw new Error('Wrong vault');
  const caseName = timing === 'after_confirmation' ? 'merge_race' : timing === 'before_confirmation' ? 'merge_stale' : 'merge_stale_redundant';
  const path = `${TEST_ROOT}/知识/${caseName}-主笔记.md`;
  const redundantPath = `${TEST_ROOT}/知识/${caseName}-冗余笔记.md`;
  const notes = new NoteRepository(app, logger);
  for (const p of [path, redundantPath]) if (app.vault.getAbstractFileByPath(p)) throw new Error('Existing race-test note');
  const original = records.cases.find((c: any) => c.id === 'merge_complement').result.value;
  const canonicalInput = extractFrontmatter(original.canonical.content), redundantInput = extractFrontmatter(original.redundant.content);
  if (!canonicalInput || !redundantInput) throw new Error('Invalid recorded merge inputs');
  await notes.create(path, generateMarkdownContent({ ...original.canonical.frontmatter, cruid: 'host-race-a' }, canonicalInput.body));
  await notes.create(redundantPath, generateMarkdownContent({ ...original.redundant.frontmatter, cruid: 'host-race-b' }, redundantInput.body));
  const primary = app.vault.getAbstractFileByPath(path) as TFile;
  const redundant = app.vault.getAbstractFileByPath(redundantPath) as TFile;
  const pair = { id: 'host-merge-race', type: 'entity', similarity: 0.93, nodeIdA: 'host-race-a', nodeIdB: 'host-race-b', status: 'pending' };
  const scoped = { vault: new Proxy(app.vault, { get(target, p) { return p === 'getMarkdownFiles' ? () => [primary, redundant] : typeof (target as any)[p] === 'function' ? (target as any)[p].bind(target) : (target as any)[p]; } }), metadataCache: app.metadataCache } as App;
  const journal = new FileStorage(app.vault, `${DATA_ROOT}/${caseName}`);
  unwrap(await journal.initialize());
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const gateEntered = new Promise<void>(resolve => { entered = resolve; });
  const write = journal.atomicWrite.bind(journal);
  let first = true;
  journal.atomicWrite = async (p, value) => { if (timing === 'after_confirmation' && first) { first = false; entered(); await blocked; } return write(p, value); };
  const deps = { app: scoped, fileStorage: journal, noteRepository: notes, cruidCache: { getFile: (id: string) => id === pair.nodeIdA ? primary : id === pair.nodeIdB && app.vault.getAbstractFileByPath(redundantPath) ? redundant : undefined } as any, duplicateManager: { getPair: () => pair, removePairsByNodeId: async () => ok(undefined) } as any, providerManager: {} as any, promptManager: {} as any, settingsStore: {} as any, reindex: async () => ok({ indexed: 1, failed: 0 }), logger };
  const service = new DuplicateMergeService(deps);
  unwrap(await service.initialize());
  const captured = unwrap(await service.captureMergeInput(pair.id, pair.nodeIdA));
  const draft = { ...original.draft, pairId: pair.id, canonicalNodeId: pair.nodeIdA, redundantNodeId: pair.nodeIdB, canonicalContentHash: captured.canonical.contentHash, redundantContentHash: captured.redundant.contentHash };
  const marker = 'CR测试并发新增的重要内容：本段必须保留。';
  const changedFile = timing === 'before_confirmation_redundant' ? redundant : primary;
  let beforeCommit;
  let pending;
  if (timing !== 'after_confirmation') {
    await app.vault.append(changedFile, `\n\n${marker}\n`);
    beforeCommit = await app.vault.read(changedFile);
    pending = service.confirmMerge(draft, captured.linkRepairPlan);
  } else {
    pending = service.confirmMerge(draft, captured.linkRepairPlan);
    await gateEntered;
    try { await app.vault.append(primary, `\n\n${marker}\n`); beforeCommit = await app.vault.read(primary); }
    finally { release(); }
  }
  const result = await pending;
  const afterCommit = await app.vault.read(primary);
  const recovery = service.getRecoveryOperations();
  let resumed;
  if (recovery.length) {
    await service.dispose();
    const reloaded = new DuplicateMergeService(deps);
    unwrap(await reloaded.initialize());
    resumed = await reloaded.resumeMerge(recovery[0].id);
    await reloaded.dispose();
  }
  await service.dispose();
  const finalContent = await app.vault.read(primary);
  const redundantPresent = !!app.vault.getAbstractFileByPath(redundantPath);
  const changedContent = app.vault.getAbstractFileByPath(changedFile.path) ? await app.vault.read(changedFile) : null;
  const recoveryPassed = timing === 'after_confirmation' ? recovery.length === 1 && resumed && !resumed.ok && resumed.error.code === 'E321_MERGE_CONTENT_CHANGED' : recovery.length === 0;
  const passed = !result.ok && result.error.code === 'E321_MERGE_CONTENT_CHANGED' && changedContent === beforeCommit && redundantPresent && recoveryPassed;
  return { checkedAt: new Date().toISOString(), timing, requirement: 'Reject changed inputs and preserve their edits, including after recovery', passed, result: result.ok ? { ok: true, phase: result.value.phase } : result, beforeCommit, afterCommit, finalContent, changedContent, redundantPresent, recovery, ...(resumed ? { resumed } : {}), files: [path, redundantPath], excluded: ['Controlled reindex callback; no real embedding request'] };
}
