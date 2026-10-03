/** Standalone host-only visual fixture. Does not load settings, vault data or network ports. Never publish its output. */
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import path from 'node:path';
const outfile = path.resolve(process.argv[2] || '../product-ui-qa-main.js');
const entry = `
import { Plugin, ItemView } from 'obsidian';
import { mount, unmount } from 'svelte';
import WorkbenchRoot from './src/ui/svelte/workbench/WorkbenchRoot.svelte';
import SettingsRoot from './src/ui/svelte/settings/SettingsRoot.svelte';
import { I18n } from './src/core/i18n';
import { DEFAULT_SETTINGS, SettingsStore } from './src/data/settings-store';
import { SettingsApplication } from './src/app/settings-application';
import { generateMarkdownContent, generateFrontmatter } from './src/core/frontmatter-utils';
const VIEW='cr-product-ui-fixture';
const ok=value=>({ok:true,value});
const never=async()=>({ok:false,error:{code:'E101_INVALID_INPUT',message:'QA fixture: operation disabled'}});
export default class ProductUiFixture extends Plugin {
 async onload() {
  this.state={tasks:[],listeners:new Set()};
  const settings=structuredClone(DEFAULT_SETTINGS);
  settings.defaultProviderId='日常服务'; settings.enableSemanticIndexing=true; settings.enableDuplicateDetection=true;
  settings.providers['日常服务']={apiKey:'',enabled:true,apiFormat:'openai-chat-completions',embeddingApiFormat:'openai-embeddings',defaultChatModel:'chat-main',defaultEmbedModel:'embed-main'};
  settings.providers['卡片服务']={...settings.providers['日常服务'],embeddingApiFormat:'disabled',defaultChatModel:'cards-model'};
  settings.taskModels.cards={providerId:'卡片服务',model:'cards-model'};
  const store=new SettingsStore({loadData:async()=>settings,saveData:async()=>{}}); await store.loadSettings();
  this.settingsApplication=new SettingsApplication({settingsStore:store,providerProbe:{probe:never},ensureSemanticIndex:never,resetRuntimeData:never});
  this.registerView(VIEW,leaf=>new FixtureView(leaf,this));
  this.addCommand({id:'qa-product-workbench',name:'QA 产品工作台（合成数据，无 API）',callback:()=>this.open('workbench')});
  this.addCommand({id:'qa-product-settings',name:'QA 产品设置（仅内存，无 API）',callback:()=>this.open('settings')});
  this.addCommand({id:'qa-product-unknown',name:'QA 注入未知结果（仅内存）',callback:()=>{this.addTask('间隔重复','interrupted');}});
  this.addCommand({id:'qa-product-late',name:'QA 模拟迟到结果（仅内存）',callback:()=>{for(const t of this.state.tasks)if(t.state==='running')t.state='completed';this.emit();}});
 }
 onunload(){this.settingsApplication?.dispose();}
 emit(){for(const cb of this.state.listeners)cb({type:'queue-paused'});}
 addTask(name,state='running',stageId='verify'){
  const task={id:String(Date.now()),nodeId:'qa-only',workflowId:'qa-only',noteTitle:name,stageId,payload:{},state,createdAt:Date.now(),updatedAt:Date.now(),attempt:1,...(state==='interrupted'?{error:{kind:'uncertain',code:'E206_PROVIDER_REQUEST_UNCERTAIN',message:'QA only'}}:{})};
  this.state.tasks.push(task);this.emit();return task.id;
 }
 async open(mode){this.mode=mode;let leaf=this.app.workspace.getLeavesOfType(VIEW)[0] || (mode==='workbench'?this.app.workspace.getRightLeaf(false):this.app.workspace.getLeaf('tab'));await leaf.setViewState({type:VIEW,active:true});if(leaf.view instanceof FixtureView)await leaf.view.render();this.app.workspace.revealLeaf(leaf);}
}
class FixtureView extends ItemView {
 constructor(leaf,plugin){super(leaf);this.plugin=plugin;}
 getViewType(){return VIEW;} getDisplayText(){return 'QA · 合成界面 / 无 API';} getIcon(){return 'flask-conical';}
 async onOpen(){await this.render();}
 async onClose(){if(this.instance)await unmount(this.instance);this.instance=undefined;}
 async render(){
  await this.onClose();const host=this.contentEl;host.replaceChildren();host.addClass('cr-scope');
  const p=this.plugin;
  if(p.mode==='settings'){host.style.padding='24px';this.instance=mount(SettingsRoot,{target:host,props:{app:p.app,i18n:new I18n(),settingsApplication:p.settingsApplication}});return;}
  host.style.padding='0';
  const snap=()=>({tasks:[...p.state.tasks],status:{paused:false,total:p.state.tasks.length,...Object.fromEntries(['pending','running','failed','interrupted','completed','cancelled'].map(state=>[state,p.state.tasks.filter(t=>t.state===state).length]))}});
  const queue={getSnapshot:snap,subscribe:cb=>{p.state.listeners.add(cb);return()=>p.state.listeners.delete(cb);},pause:async()=>ok(),resume:async()=>ok(),retry:never,retryUncertain:never,retryFailed:never,cancelAllActive:never,removeTerminal:never,remove:async id=>{p.state.tasks=p.state.tasks.filter(t=>t.id!==id);p.emit();return ok(true);},cancel:async id=>{const task=p.state.tasks.find(t=>t.id===id);if(task)task.state='cancelled';p.emit();return ok(true);}};
  const file={path:'C-知识库/5-机制/间隔重复.md',basename:'间隔重复',extension:'md'};
  const app={workspace:{getActiveFile:()=>file,on:()=>({}),offref(){}},vault:{on:()=>({}),offref(){},cachedRead:async()=>generateMarkdownContent(generateFrontmatter({cruid:'qa-only',type:'mechanism',name:'间隔重复'}),'Only an in-memory visual fixture')}};
  const application={queue,duplicates:{getPendingPairs:()=>[],subscribe:()=>()=>{},getRecoveryOperations:()=>[]},
   create:{define:async input=>ok({coreDefinition:'QA only',candidates:Object.fromEntries([['mechanism','间隔重复','Spaced repetition',.86],['theory','间隔效应','Spacing effect',.7],['issue','如何安排有效的复习间隔','',.5],['entity',input,'',.3],['domain','记忆与学习','Memory',.2]].map(([type,chinese,english,confidence])=>[type,{name:{chinese,english},confidence}]))}),confirm:async()=>ok(p.addTask('间隔重复','running','core'))},verify:{start:async()=>ok(p.addTask('间隔重复'))},cards:{start:never},expand:{prepare:never}};
  this.instance=mount(WorkbenchRoot,{target:host,props:{app,i18n:new I18n(),application,settingsApplication:p.settingsApplication,onOpenSettings:()=>p.open('settings')}});
 }
}
`;
await build({stdin:{contents:entry,resolveDir:process.cwd()},outfile,bundle:true,format:'cjs',target:'es2022',external:['obsidian','electron','crypto','fs','path','http','https','events','url','stream','util','buffer'],conditions:['svelte','browser'],mainFields:['svelte','browser','module','main'],alias:{'@':'./src'},plugins:[sveltePlugin({preprocess:sveltePreprocess(),compilerOptions:{css:'injected'}})]});
console.log(outfile);
