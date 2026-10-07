// Synthetic temporary plugin directories only; no real vault, credentials or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli=path.join(root,'scripts/update-write-defaults.mjs');
const oldTask='生成当前概念的结构，字段含义见本次 Schema。充分覆盖主干；层级项只列直接下一层，各列表保持合理粒度。独立项须有实质差别；同义项合并，细节、情境和仅属交叉关系的内容写入相关项说明，不据相关性单列。不设数量目标，不宣称穷尽。不按知名度筛选；归属或地位有争议时说明依据。';
async function fixture(version="v7"){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'cr-write-migration-test-'));
 const plugin=path.join(temporary,'plugin'),rollback=path.join(temporary,'rollback');await fs.mkdir(rollback);await fs.cp(path.join(root,'prompts'),path.join(plugin,'prompts'),{recursive:true});
 for(const type of ['domain','issue','theory']){const p=path.join(plugin,'prompts/phases',type,'structure.md');const content=await fs.readFile(p,'utf8');await fs.writeFile(p,content.replace(/(<task_instruction>\n)[\s\S]*?(\n<\/task_instruction>)/,`$1${oldTask}$2`).replaceAll('\n','\r\n'));}
 if(version==='v8'){
  const historical=JSON.parse(await fs.readFile(path.join(root,'scripts/qa-tests/known-v8-prompt-defaults.json'),'utf8'));
  for(const [relative,content] of Object.entries(historical.templates))await fs.writeFile(path.join(plugin,relative),content);
 }
 if(version==='v5'){
  const historical=JSON.parse(await fs.readFile(path.join(root,'scripts/qa-tests/known-v5-write-defaults.json'),'utf8'));
  for(const [relative,content] of Object.entries(historical.templates))await fs.writeFile(path.join(plugin,relative),content);
  for(const relative of historical.absent)await fs.unlink(path.join(plugin,relative));
  const oldKnowledge=JSON.parse(await fs.readFile(path.join(root,'scripts/qa-tests/known-v8-prompt-defaults.json'),'utf8')).templates['prompts/base/knowledge-policy.md'];
  await fs.writeFile(path.join(plugin,'prompts/base/knowledge-policy.md'),oldKnowledge);
  const oldOperations=JSON.parse(await fs.readFile(path.join(root,'scripts/qa-tests/known-v8-prompt-defaults.json'),'utf8')).templates;
  for(const name of ['merge','tag'])await fs.writeFile(path.join(plugin,`prompts/base/operations/${name}.md`),oldOperations[`prompts/base/operations/${name}.md`]);
 }
 return {temporary,plugin,rollback};
}
async function snapshot(dir){const files={};async function walk(d){for(const e of await fs.readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else if(e.isFile())files[path.relative(dir,p)]=(await fs.readFile(p)).toString('base64');}}await walk(dir);return files;}
function run(f,apply=false,shim){return spawnSync(process.execPath,[...(shim?['--import',shim]:[]),cli,'--plugin-dir',f.plugin,...(apply?['--rollback-dir',f.rollback,'--apply']:[])],{encoding:'utf8'});}
const withFixture=async(fn)=>{const f=await fixture();try{await fn(f);}finally{await fs.rm(f.temporary,{recursive:true,force:true});}};

test('check is read-only; known CRLF v7 defaults update only three structures and are idempotent',()=>withFixture(async f=>{
 const before=await snapshot(f.plugin);let result=run(f);assert.equal(result.status,0,result.stderr);assert.deepEqual(await snapshot(f.plugin),before);assert.deepEqual(await snapshot(f.rollback),{});
 result=run(f,true);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).updated.length,3);
 for(const type of ['domain','issue','theory'])assert.equal(await fs.readFile(path.join(f.plugin,'prompts/phases',type,'structure.md'),'utf8'),await fs.readFile(path.join(root,'prompts/phases',type,'structure.md'),'utf8'));
 const updated=await snapshot(f.plugin);result=run(f,true);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).updated,[]);assert.deepEqual(await snapshot(f.plugin),updated);
 for(const type of ['domain','issue','theory']){const relative=`prompts/phases/${type}/structure.md`;assert.equal((await fs.readFile(path.join(f.rollback,`v9-phases-${type}-structure.md`))).toString('base64'),before[relative]);}
}));

test('unknown base policy refuses the whole batch without backups or edits',()=>withFixture(async f=>{
 await fs.writeFile(path.join(f.plugin,'prompts/base/writing-style.md'),'personal customized style');const before=await snapshot(f.plugin);const result=run(f,true);assert.notEqual(result.status,0);assert.deepEqual(await snapshot(f.plugin),before);assert.deepEqual(await snapshot(f.rollback),{});
}));

test('active queue refuses the whole batch',()=>withFixture(async f=>{
 await fs.mkdir(path.join(f.plugin,'data'));await fs.writeFile(path.join(f.plugin,'data/queue-state-v5.json'),JSON.stringify({tasks:[{state:'running'}]}));const before=await snapshot(f.plugin);const result=run(f,true);assert.notEqual(result.status,0);assert.deepEqual(await snapshot(f.plugin),before);assert.deepEqual(await snapshot(f.rollback),{});
}));

test('an edit made during staging survives instead of being replaced',()=>withFixture(async f=>{
 const target=path.join(f.plugin,'prompts/phases/domain/structure.md');const shim=path.join(f.temporary,'concurrent-edit.mjs');await fs.writeFile(shim,`import fs from 'node:fs/promises';const write=fs.writeFile.bind(fs);let changed=false;fs.writeFile=async(p,...args)=>{const r=await write(p,...args);if(!changed&&String(p).endsWith('.write-v9-tmp')){changed=true;await write(${JSON.stringify(target)},'concurrent personal edit');}return r;};`);
 const result=run(f,true,shim);assert.notEqual(result.status,0);assert.equal(await fs.readFile(target,'utf8'),'concurrent personal edit');assert.equal((await fs.readdir(path.dirname(target))).some(n=>n.endsWith('.write-v9-tmp')),false);
}));

test('existing backup symlinks and contradictory absence markers are rejected',()=>withFixture(async f=>{
 const backup=path.join(f.rollback,'v9-phases-domain-structure.md'),target=path.join(f.plugin,'prompts/phases/domain/structure.md');const before=await snapshot(f.plugin);await fs.symlink(target,backup);let result=run(f,true);assert.notEqual(result.status,0);assert.deepEqual(await snapshot(f.plugin),before);
 await fs.unlink(backup);await fs.copyFile(target,backup);await fs.writeFile(backup+'.absent','absent');result=run(f,true);assert.notEqual(result.status,0);assert.deepEqual(await snapshot(f.plugin),before);
}));


test('exact v5 defaults migrate all 18 changed files and preserve the original bytes and missing-policy receipt',async()=>{
 const f=await fixture('v5');try{
  const before=await snapshot(f.plugin);let result=run(f);assert.equal(result.status,0,result.stderr);assert.deepEqual(await snapshot(f.plugin),before);assert.deepEqual(await snapshot(f.rollback),{});
  result=run(f,true);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).updated.length,18);
  assert.equal(await fs.readFile(path.join(f.plugin,'prompts/base/write-policy.md'),'utf8'),await fs.readFile(path.join(root,'prompts/base/write-policy.md'),'utf8'));
  assert.equal((await fs.lstat(path.join(f.rollback,'v9-base-write-policy.md.absent'))).isFile(),true);
  for(const [relative,content] of Object.entries(before))if(relative.startsWith('prompts/phases/'))assert.equal((await fs.readFile(path.join(f.rollback,`v9-phases-${path.basename(path.dirname(relative))}-${path.basename(relative)}`))).toString('base64'),content);
 }finally{await fs.rm(f.temporary,{recursive:true,force:true});}
});

test('a customized v5 structure still refuses before the whole batch is written',async()=>{
 const f=await fixture('v5');try{
  const file=path.join(f.plugin,'prompts/phases/issue/structure.md');await fs.appendFile(file,'\nPersonal custom instruction');const before=await snapshot(f.plugin);const result=run(f,true);assert.notEqual(result.status,0);assert.deepEqual(await snapshot(f.plugin),before);assert.deepEqual(await snapshot(f.rollback),{});
 }finally{await fs.rm(f.temporary,{recursive:true,force:true});}
});


test('exact v8 defaults migrate all changed templates; custom operation template blocks the batch', async()=>{
 const f=await fixture('v8');try{
  const before=await snapshot(f.plugin);let result=run(f);assert.equal(result.status,0,result.stderr);assert.deepEqual(await snapshot(f.plugin),before);
  result=run(f,true);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).updated.length,11);
  for(const relative of Object.keys(JSON.parse(await fs.readFile(path.join(root,'scripts/qa-tests/known-v8-prompt-defaults.json'),'utf8')).templates)){
   assert.equal(await fs.readFile(path.join(f.plugin,relative),'utf8'),await fs.readFile(path.join(root,relative),'utf8'));
   assert.equal((await fs.readFile(path.join(f.rollback,'v9-'+relative.replace(/^prompts\//,'').replaceAll('/','-')))).toString('base64'),before[relative]);
  }
  const updated=await snapshot(f.plugin);result=run(f,true);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).updated,[]);assert.deepEqual(await snapshot(f.plugin),updated);
 }finally{await fs.rm(f.temporary,{recursive:true,force:true});}
 const customized=await fixture('v8');try{
  await fs.appendFile(path.join(customized.plugin,'prompts/base/operations/define.md'),'\nPersonal custom text');const before=await snapshot(customized.plugin);const result=run(customized,true);assert.notEqual(result.status,0);assert.match(result.stderr,/Custom or unknown template/);assert.deepEqual(await snapshot(customized.plugin),before);assert.deepEqual(await snapshot(customized.rollback),{});
 }finally{await fs.rm(customized.temporary,{recursive:true,force:true});}
 const customPolicy=await fixture('v8');try{
  await fs.appendFile(path.join(customPolicy.plugin,'prompts/base/knowledge-policy.md'),'\nPersonal policy');const before=await snapshot(customPolicy.plugin);const result=run(customPolicy,true);assert.notEqual(result.status,0);assert.match(result.stderr,/Custom or unknown template/);assert.deepEqual(await snapshot(customPolicy.plugin),before);assert.deepEqual(await snapshot(customPolicy.rollback),{});
 }finally{await fs.rm(customPolicy.temporary,{recursive:true,force:true});}
});
