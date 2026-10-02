/** Actual Svelte components with synthetic ports. No vault or model API access. */
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve(process.argv[2] || '/tmp/cognitive-workbench-preview');
await mkdir(out, { recursive: true });
const entry = `
import { mount, tick } from 'svelte';
import WorkbenchRoot from './src/ui/svelte/workbench/WorkbenchRoot.svelte';
import { I18n } from './src/core/i18n';
import { generateFrontmatter, generateMarkdownContent } from './src/core/frontmatter-utils';
HTMLElement.prototype.empty = function () { this.replaceChildren(); };
window.fetch = () => { throw Error('Network prohibited in this synthetic preview'); };
(async () => {
const params = new URLSearchParams(location.search);
const width = Number(params.get('width') || 448);
document.getElementById('app').style.width = width + 'px';
if (params.has('light')) document.body.classList.add('light');
const i18n = new I18n(); const t = i18n.messages;
const ok = value => ({ ok: true, value });
const noop = () => () => {};
const task = (id, state, stageId, title) => ({ id, nodeId: id, stageId, noteTitle: title, state, payload: {}, createdAt: 1, updatedAt: 1, attempt: 1 });
const tasks = [
 ...Array.from({length:6}, (_,i) => task('done-'+i, 'completed', 'core', '间隔重复 (Spaced repetition)')),
 ...[task('verify-a', 'interrupted', 'verify', '间隔重复 (Spaced repetition)'), task('verify-b', 'interrupted', 'verify', 'Card QA')].map(task => ({ ...task, startedAt: 1000, finishedAt: 127000, error: {kind:'uncertain',code:'E206_PROVIDER_REQUEST_UNCERTAIN',upstreamStatus:524} })),
];
const status = { paused:false,total:8,pending:0,running:0,failed:0,interrupted:2,completed:6,cancelled:0 };
const pair = { id: 'a--b', nodeIdA:'a',nodeIdB:'b',type:'entity',similarity:.97,status:'pending' };
const draft = { pairId:pair.id, canonicalNodeId:'a',redundantNodeId:'b',name:'Green bell spacing',body:('# Green bell spacing\\n\\nSynthetic preview for manual review and editing.\\n\\n').repeat(14),aliases:[],tags:[],parents:['[[QA-Merge/Parent One]]','[[QA-Merge/Parent Two]]'],sourceUids:[],conflicts:[],canonicalContentHash:'a',redundantContentHash:'b' };
const queue = { getSnapshot: () => ({status,tasks}), subscribe:noop, retry:async () => ok(true),retryUncertain:async () => ok(true),cancel:async () => ok(true),remove:async () => ok(true),retryFailed:async () => ok(0),removeTerminal:async () => ok(0),pause:async () => ok(true),resume:async () => ok(true) };
const application = {queue,duplicates:{getPendingPairs:() => [pair],subscribe:noop,getRecoveryOperations:() => [],getConceptName:id=>id==='a'?'Beta':'Alpha',getConceptPath:id=>'QA-Merge/'+id+'.md',prepareMerge:async()=>ok({draft,similarity:.97,linkRepairPlan:{entries:[],skipped:[],replacementCount:2}}),confirmMerge:async()=>ok({})}};
const file = {path:'QA-Merge/Card QA.md',basename:'Card QA',extension:'md'};
const app = {workspace:{getActiveFile:()=>file,on:noop,offref(){},openLinkText:async()=>{}},vault:{on:noop,offref(){},cachedRead:async()=>generateMarkdownContent(generateFrontmatter({cruid:'synthetic',type:'entity',name:'Card QA'}),'Synthetic only')}};
mount(WorkbenchRoot,{target:document.getElementById('app'),props:{app,i18n,application,settingsApplication:{getSettings:()=>({queuePageSize:50}),subscribeSettings:noop}}});
await tick(); await new Promise(resolve=>setTimeout(resolve,60));
const clickText = text => Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===text)?.click();
if(params.has('management')) document.querySelector('.cr-queue-management').open=true;
if(params.has('details')) document.querySelector('.cr-task-feedback details').open=true;
if(params.has('merge')) { clickText(t.workbench.duplicates.merge); await tick(); clickText(t.workbench.duplicates.generateDraft); await tick(); await tick(); }
await new Promise(resolve=>requestAnimationFrame(resolve));
const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
const summary = rect('.cr-queue-status-bar'); const next = rect('.cr-queue-details');
const dialog=rect('.cr-modal-dialog'); const footer=rect('.cr-modal-footer'); const content=rect('.cr-modal-content');
const report={width,synthetic:true,summary,next,noOverlap:summary.bottom<=next.top,historyFolded:!document.querySelector('.cr-queue-history').open,visibleTaskCount:document.querySelectorAll('.cr-task-item').length,noHorizontalOverflow:document.getElementById('app').scrollWidth<=width,dialog,footer,content,hostOverlay:document.querySelector('.cr-modal-overlay')?.parentElement===document.body,footerVisible:footer?footer.bottom<=innerHeight:undefined};
if(params.has('merge')) { const body=document.querySelector('.cr-modal-content');body.scrollTop=body.scrollHeight;report.footerAfterScroll=rect('.cr-modal-footer');report.footerStationary=report.footerAfterScroll.top===footer.top; }
const output=document.createElement('pre');output.id='qa-results';output.hidden=true;output.textContent=JSON.stringify(report);document.body.append(output);
})();`;
await build({ stdin: {contents:entry,resolveDir:process.cwd()},bundle:true,outfile:path.join(out,'preview.js'),format:'iife',conditions:['svelte','browser'],mainFields:['svelte','browser','module','main'],alias:{obsidian:'./__mocks__/obsidian.ts','@':'./src'},plugins:[sveltePlugin({preprocess:sveltePreprocess(),compilerOptions:{css:'injected'}})] });
await copyFile('styles.css',path.join(out,'styles.css'));
// Same synthetic theme as the settings harness, plus a host-like fixed button
// height and shadow to exercise the original wrapping-height regression.
const settingsHarness=await readFile('scripts/preview-settings.mjs','utf8');
const theme=settingsHarness.split('<style>')[1].split('</style>')[0];
await writeFile(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Synthetic workbench QA</title><link rel="stylesheet" href="styles.css"><style>${theme}
button { height:30px; box-shadow:0 1px 3px #0005; } #app { margin:0 0 0 auto; padding:0; height:calc(100vh - 46px); overflow:auto; transform:translateX(0); border-left:1px solid var(--background-modifier-border); } .preview-main { position:absolute;top:100px;left:40px;color:var(--text-muted);max-width:40%; } </style></head><body><aside>实际组件 · 合成数据预览<span>非 Obsidian 宿主 · 无 API</span></aside><div class="preview-main"><h2>专用布局检查</h2><p>360 / 448px 工作台；宿主居中合并编辑。</p></div><main id="app" class="cr-scope"></main><script src="preview.js"></script></body></html>`);
console.log(out);
