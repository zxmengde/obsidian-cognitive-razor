import { describe,it,expect,vi } from 'vitest';
import { TFile } from 'obsidian';
import { SemanticIndexRebuilder } from './semantic-index-rebuilder';
import { VectorIndex } from './vector-index';
import { FileStorage } from '../data/file-storage';
import { DEFAULT_SETTINGS } from '../data/settings-store';
import { resolveVectorIndexConfig } from './vector-config';
import { ok } from '../types';
const note=(body='original')=>`---\ncruid: a\ntype: domain\nname: Alpha\nstatus: draft\ncreated: 2026-08-17T00:00:00+08:00\nupdated: 2026-08-17T00:00:00+08:00\naliases: []\ntags: []\nparents: []\n---\n${body}`;
async function harness() {
 const bytes=new Map<string,string>(), folders=new Set<string>();
 const adapter={
  stat:async(p:string)=>bytes.has(p)?{type:'file'}:folders.has(p)?{type:'folder'}:null,
  exists:async(p:string)=>bytes.has(p)||folders.has(p), mkdir:async(p:string)=>{folders.add(p);},
  read:async(p:string)=>{if(!bytes.has(p))throw Object.assign(new Error('missing'),{code:'ENOENT'});return bytes.get(p)!;},
  write:async(p:string,c:string)=>{bytes.set(p,c);}, rename:async(a:string,b:string)=>{bytes.set(b,await adapter.read(a));bytes.delete(a);},
  remove:async(p:string)=>{bytes.delete(p);}, list:async(p:string)=>({files:[...bytes.keys()].filter(x=>x.startsWith(p+'/')&&!x.slice(p.length+1).includes('/')),folders:[...folders].filter(x=>x.startsWith(p+'/')&&!x.slice(p.length+1).includes('/'))})
 };
 let content=note();const file=new TFile();Object.assign(file,{path:'notes/a.md',name:'a.md',basename:'a',extension:'md'});
 const app={vault:{adapter,cachedRead:async()=>content,read:async()=>content,getAbstractFileByPath:(p:string)=>p===file.path?file:null}};
 const cache={snapshotEntries:async()=>[{cruid:'a',path:file.path,file}],getFile:(id:string)=>id==='a'?file:null,waitUntilReady:async()=>{},has:(id:string)=>id==='a',getName:()=>file.basename,getPath:()=>file.path};
 const settings=structuredClone(DEFAULT_SETTINGS);settings.providers.embedding={apiKey:'',baseUrl:'https://unused.example/v1',apiFormat:'disabled',embeddingApiFormat:'openai-embeddings',defaultChatModel:'',defaultEmbedModel:'embed',enabled:true};settings.defaultProviderId='embedding';settings.taskModels.index={providerId:'embedding',model:'embed',embeddingDimension:3};
 const settingsStore={getSettings:()=>structuredClone(settings),subscribe:()=>()=>{}};
 const logger={debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()};
 const storage=new FileStorage(app.vault as never,'synthetic-plugin');await storage.initialize();
 const embed=vi.fn(async()=>ok({embedding:[1,0,0]}));const config=resolveVectorIndexConfig(settings);
 const make=async()=>{const index=new VectorIndex(storage,config.model,config.dimension,logger,cache as never,config.profile);await index.load();const service=new SemanticIndexRebuilder({app:app as never,cruidCache:cache as never,providerManager:{embed} as never,vectorIndex:index,duplicateManager:{refreshNode:async()=>ok(0),clearAll:async()=>ok(0),rebuildFromIndex:async()=>ok(0)} as never,settingsStore:settingsStore as never,logger});return{index,service};};
 return{...(await make()),make,bytes,embed,setContent:(next:string)=>{content=next;}};
}
describe('actual vector persistence freshness',()=>{
 it('retains a valid vector across reload and reading edits until explicitly updated',async()=>{
  const h=await harness();try{
   expect(await h.service.embedMissing()).toMatchObject({ok:true,value:{indexed:1}});
   expect(await h.service.embedMissing()).toMatchObject({ok:true,value:{indexed:0}});
   expect(h.embed).toHaveBeenCalledTimes(1);
   await h.service.dispose();await h.index.dispose();
   const reloaded=await h.make();try{
    expect(await reloaded.service.scanStatus()).toMatchObject({ok:true,value:{missing:0,indexed:1}});
    h.setContent(note('new semantics'));
    expect(await reloaded.service.scanStatus()).toMatchObject({ok:true,value:{missing:0,indexed:1}});
    expect(await reloaded.service.embedMissing()).toMatchObject({ok:true,value:{indexed:0}});
    expect(h.embed).toHaveBeenCalledTimes(1);
    const before = JSON.parse(h.bytes.get('synthetic-plugin/data/vectors/domain/a.json')!).metadata.sourceHash;
    expect(await reloaded.service.embedOne('a')).toMatchObject({ok:true,value:{indexed:1}});
    expect(h.embed).toHaveBeenCalledTimes(2);
    const after = JSON.parse(h.bytes.get('synthetic-plugin/data/vectors/domain/a.json')!).metadata.sourceHash;
    expect(after).toMatch(/^[a-f0-9]{64}$/); expect(after).not.toBe(before);
   }finally{await reloaded.service.dispose();await reloaded.index.dispose();}
  }finally{await h.service.dispose();await h.index.dispose();}
 });
 it('does not treat a missing physical vector as indexed after reload',async()=>{
  const h=await harness();try{
   await h.service.embedMissing();await h.service.dispose();await h.index.dispose();
   h.bytes.delete('synthetic-plugin/data/vectors/domain/a.json');
   const reloaded=await h.make();try{
    expect(await reloaded.service.scanStatus()).toMatchObject({ok:true,value:{missing:1,indexed:0}});
    expect(await reloaded.service.embedMissing()).toMatchObject({ok:true,value:{indexed:1}});
   }finally{await reloaded.service.dispose();await reloaded.index.dispose();}
  }finally{await h.service.dispose();await h.index.dispose();}
 });
});


describe('vector repair cost boundaries', () => {
 it('keeps valid legacy vectors without hashes usable and does not regenerate them by default', async () => {
  const h = await harness();
  try {
   await h.service.embedMissing(); await h.service.dispose(); await h.index.dispose();
   const vectorPath = 'synthetic-plugin/data/vectors/domain/a.json';
   const metaPath = 'synthetic-plugin/data/vectors/index.json';
   const vector = JSON.parse(h.bytes.get(vectorPath)!); delete vector.metadata.sourceHash; h.bytes.set(vectorPath, JSON.stringify(vector));
   const meta = JSON.parse(h.bytes.get(metaPath)!); delete meta.concepts.a.sourceHash; h.bytes.set(metaPath, JSON.stringify(meta));
   const reloaded = await h.make();
   try {
    expect(await reloaded.service.scanStatus()).toMatchObject({ ok: true, value: { indexed: 1, missing: 0 } });
    expect(await reloaded.service.embedMissing()).toMatchObject({ ok: true, value: { indexed: 0 } });
    expect(h.embed).toHaveBeenCalledTimes(1);
   } finally { await reloaded.service.dispose(); await reloaded.index.dispose(); }
  } finally { await h.service.dispose(); await h.index.dispose(); }
 });
 it('repairs an incompatible physical vector but does not mistake a permission error for missing content', async () => {
  const h = await harness();
  try {
   await h.service.embedMissing(); await h.service.dispose(); await h.index.dispose();
   const vectorPath = 'synthetic-plugin/data/vectors/domain/a.json';
   const vector = JSON.parse(h.bytes.get(vectorPath)!); vector.metadata.embeddingModel = 'wrong-model'; h.bytes.set(vectorPath, JSON.stringify(vector));
   const reloaded = await h.make();
   try {
    expect(await reloaded.service.scanStatus()).toMatchObject({ ok: true, value: { missing: 1 } });
    expect(await reloaded.service.embedMissing()).toMatchObject({ ok: true, value: { indexed: 1 } });
    expect(h.embed).toHaveBeenCalledTimes(2);
    const storage = (reloaded.index as unknown as { fileStorage: FileStorage }).fileStorage;
    const read = vi.spyOn(storage, 'readVectorFile').mockResolvedValue({ ok: false, error: { code: 'E302_PERMISSION_DENIED', message: 'temporary synthetic IO failure' } });
    try {
     expect(await reloaded.service.scanStatus()).toMatchObject({ ok: false, error: { code: 'E302_PERMISSION_DENIED' } });
     expect(await reloaded.service.embedMissing()).toMatchObject({ ok: false, error: { code: 'E302_PERMISSION_DENIED' } });
     expect(h.embed).toHaveBeenCalledTimes(2);
    } finally { read.mockRestore(); }
   } finally { await reloaded.service.dispose(); await reloaded.index.dispose(); }
  } finally { await h.service.dispose(); await h.index.dispose(); }
 });
});
