import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rendererFetchProbe, rendererProbeCommand} from './renderer-fetch-probe.mjs';

test('models fetch has no credentials, no body reads, and exactly one dispatch', async () => {
  let calls=0; let cancelled=0;
  const result=await rendererFetchProbe('models','http://192.0.2.1:3000', {fetch:async(url,init)=>{
    calls++; assert.equal(url,'http://192.0.2.1:3000/v1/models');
    assert.equal(init.credentials,'omit'); assert.equal(init.mode,'cors'); assert.equal(init.redirect,'error');
    assert.equal(init.referrerPolicy,'no-referrer'); assert.equal(init.method,'GET');
    assert.equal(init.headers,undefined); assert.equal(init.body,undefined);
    return {status:401,type:'cors',body:{cancel:async()=>cancelled++,getReader(){throw Error('body read forbidden');}},text(){throw Error('body forbidden');}};
  }});
  assert.equal(calls,1); assert.equal(cancelled,1); assert.equal(result.outcome,'HEADERS_READABLE');assert.equal(result.status,401);
  assert.ok(!JSON.stringify(result).includes('192.0.2.1'));
});
test('rejects credential-bearing, arbitrary paths, queries, names and malformed targets before dispatch',async()=>{
  for(const target of ['http://u:p@192.0.2.1','http://192.0.2.1/v1/responses','http://192.0.2.1?key=secret','https://example.com','http://999.2.3.4']) {
    const r=await rendererFetchProbe('models',target,{fetch(){throw Error('must not dispatch');}});assert.equal(r.outcome,'INVALID_IP_ORIGIN');
  }
});
test('fetch rejection is sanitized and never falls back', async()=>{
  let calls=0;const r=await rendererFetchProbe('models','http://192.0.2.1',{fetch:async()=>{calls++;throw new TypeError('secret raw URL');}});
  assert.equal(calls,1);assert.equal(r.outcome,'FETCH_REJECTED');assert.ok(!JSON.stringify(r).includes('secret'));
});
test('pre-cancelled probe does not dispatch',async()=>{
 const c=new AbortController();c.abort();let calls=0;
 const r=await rendererFetchProbe('models','http://192.0.2.1',{signal:c.signal,fetch:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(r.outcome,'CANCELLED');
});
test('synthetic stream counts chunks and closes its fixture without exposing bytes',async()=>{
 let closed=0;let requests=0;
 const server={once(){},listen(port,host,cb){assert.equal(port,18743);assert.equal(host,'127.0.0.1');cb();},closeAllConnections(){},close(){closed++;}};
 const r=await rendererFetchProbe('synthetic-stream','ignored',{http:{createServer(){return server;}},fetch:async(url,init)=>{
  requests++;assert.equal(url,'http://127.0.0.1:18743/qa-stream');assert.equal(init.credentials,'omit');
  return {status:200,type:'cors',body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));c.close();}})};
 }});
 assert.equal(requests,1);assert.equal(r.chunks,2);assert.equal(r.bytes,3);assert.equal(r.outcome,'STREAM_EOF');assert.equal(closed,1);
});
test('fixture bind failure prevents fetch and does not retry another port',async()=>{
 let errorHandler;let closes=0;let calls=0;
 const r=await rendererFetchProbe('synthetic-stream','',{http:{createServer(){return {once(_,fn){errorHandler=fn;},listen(){errorHandler();},close(){closes++;}};}},fetch(){calls++;}});
 assert.equal(r.outcome,'FIXTURE_START_FAILED');assert.equal(calls,0);assert.equal(closes,1);
});
test('temporary command has no provider/settings/key access and production-only injection remains explicit',()=>{
 const generated=rendererProbeCommand();assert.ok(generated.includes('qa-renderer-fetch-probe'));
 assert.ok(!/settingsStore|apiKey|requestUrl|no-cors|webSecurity/.test(generated));
});
test('active cancellation aborts the single pending fetch and returns a safe classification',async()=>{
 const outer=new AbortController();let calls=0;
 const pending=rendererFetchProbe('models','http://192.0.2.1',{signal:outer.signal,fetch:async(_,init)=>{
  calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('private message')),{once:true}));
 }});
 outer.abort();const r=await pending;assert.equal(calls,1);assert.equal(r.outcome,'CANCELLED');assert.ok(!JSON.stringify(r).includes('private'));
});
test('normal command UI is lazy, dispatches only on explicit click, and returns sanitized JSON',async()=>{
 const {runInNewContext}=await import('node:vm');let command;let modal;let calls=0;
 const plugin={app:{},addCommand(c){command=c;},get settingsStore(){throw Error('no settings');}};
 class Modal{constructor(){modal=this;this.titleEl={};this.elements=[];this.contentEl={createEl:(tag,options)=>{const el={tag,options,style:{},value:'',focus(){},select(){}};this.elements.push(el);return el;}};}open(){}}
 runInNewContext(`(function(){${rendererProbeCommand()}}).call(plugin)`,{plugin,Modal,URL,AbortController,Date,setTimeout,clearTimeout,setInterval,clearInterval,window:{fetch:async()=>{calls++;return {status:403,type:'cors',body:{cancel:async()=>{}}};},addEventListener(){},removeEventListener(){}}});
 assert.equal(calls,0);command.callback();assert.equal(calls,0);
 modal.elements.find(e=>e.tag==='input').value='http://192.0.2.1';
 modal.elements.find(e=>e.options?.text==='单次无鉴权 GET /v1/models').onclick();
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(calls,1);const result=JSON.parse(modal.elements.find(e=>e.tag==='textarea').value);assert.equal(result.status,403);assert.equal(result.outcome,'HEADERS_READABLE');
 modal.onClose();
});
test('authorization shape requires successful synthetic-stream gate before dispatch',async()=>{
 let calls=0;const r=await rendererFetchProbe('models-auth-shape','http://192.0.2.1',{fetch(){calls++;}});
 assert.equal(calls,0);assert.equal(r.outcome,'STREAM_GATE_REQUIRED');assert.equal(r.requestOutcome,'not-dispatched');
});
test('authorized shape uses only fixed non-secret invalid headers on bodyless GET, never inference POST',async()=>{
 let calls=0;const r=await rendererFetchProbe('models-auth-shape','http://192.0.2.1',{syntheticStreamPassed:true,fetch:async(url,init)=>{
 calls++;assert.equal(url,'http://192.0.2.1/v1/models');assert.equal(init.method,'GET');assert.equal(init.body,undefined);
 assert.equal(init.headers.Authorization,'Bearer cognitive-razor-invalid-qa-placeholder');assert.equal(init.headers['Content-Type'],'application/json');assert.equal(init.credentials,'omit');
 return {status:401,type:'cors',body:{cancel:async()=>{}}};
 }});assert.equal(calls,1);assert.equal(r.outcome,'HEADERS_READABLE');assert.equal(r.requestOutcome,'response-received');assert.ok(!JSON.stringify(r).includes('Bearer'));
});
test('before-header idle timeout remains uncertain after dispatch and never retries',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0;
 const pending=rendererFetchProbe('models','http://192.0.2.1',{fetch:async(_,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error()),{once:true}));}});
 t.mock.timers.tick(2001);const r=await pending;assert.equal(r.outcome,'IDLE_TIMEOUT');assert.equal(r.phase,'before-response');assert.equal(r.requestOutcome,'unknown-after-dispatch');assert.equal(calls,1);
});
test('after-header idle timeout aborts and releases stream; empty chunks do not renew idle',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let streamController;let closed=0;
 const server={once(){},listen(_p,_h,cb){cb();},close(){closed++;}};
 const pending=rendererFetchProbe('synthetic-stream','',{http:{createServer(){return server;}},fetch:async(_,init)=>({status:200,type:'cors',body:new ReadableStream({start(c){streamController=c;init.signal.addEventListener('abort',()=>c.error(Error()),{once:true});}})})});
 for(let i=0;i<8;i++)await Promise.resolve();t.mock.timers.tick(1500);streamController.enqueue(new Uint8Array());
 for(let i=0;i<8;i++)await Promise.resolve();t.mock.timers.tick(501);
 const r=await pending;assert.equal(r.outcome,'IDLE_TIMEOUT');assert.equal(r.phase,'after-response');assert.equal(r.requestOutcome,'response-received');assert.equal(r.chunks,0);assert.equal(closed,1);
});
test('nonempty heartbeat chunks renew idle while total duration exceeds one idle interval',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let streamController;
 const server={once(){},listen(_p,_h,cb){cb();},close(){}};
 const pending=rendererFetchProbe('synthetic-stream','',{http:{createServer(){return server;}},fetch:async()=>({status:200,type:'cors',body:new ReadableStream({start(c){streamController=c;}})})});
 for(let i=0;i<8;i++)await Promise.resolve();
 for(let i=0;i<4;i++){t.mock.timers.tick(750);streamController.enqueue(new Uint8Array([58,10]));for(let j=0;j<8;j++)await Promise.resolve();}
 streamController.close();const r=await pending;assert.equal(r.outcome,'STREAM_EOF');assert.equal(r.chunks,4);assert.equal(r.chunkSpanMs,2250);assert.equal(r.durationMs,3000);
});
test('late headers after cancellation stay uncertain and cannot become readable success',async()=>{
 const outer=new AbortController();let release;let cancelled=0;
 const pending=rendererFetchProbe('models','http://192.0.2.1',{signal:outer.signal,fetch:()=>new Promise(resolve=>release=resolve)});
 outer.abort();release({status:200,type:'cors',body:{cancel:async()=>cancelled++}});
 const r=await pending;assert.equal(r.outcome,'CANCELLED');assert.equal(r.readable,false);assert.equal(r.status,null);assert.equal(r.requestOutcome,'unknown-after-dispatch');assert.equal(cancelled,1);
});
test('concurrent probes have independent cancellation signals',async()=>{
 const outer=new AbortController();let calls=0;
 const first=rendererFetchProbe('models','http://192.0.2.1',{signal:outer.signal,fetch:async(_,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error()),{once:true}));}});
 const second=rendererFetchProbe('models','http://192.0.2.1',{fetch:async()=>{calls++;return {status:401,type:'cors',body:{cancel:async()=>{}}};}});
 outer.abort();assert.equal((await first).outcome,'CANCELLED');assert.equal((await second).outcome,'HEADERS_READABLE');assert.equal(calls,2);
});
