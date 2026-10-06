import {describe,it,expect} from 'vitest';
import {ok} from '../types';
import {readResponsesReplayOutput,readResponsesOutputHistory,MAX_RESPONSES_REPLAY_BYTES} from '../utils/responses-replay';
import {WriteTaskExecutor} from './write-task-executor';
import {ResponsePipeline} from './response-pipeline';
import {Validator} from '../data/validator';
import {schemaRegistry} from './schema-registry';
import {parseOpenAIResponsesResponse} from './provider-response-parsers';
import {WorkflowStore} from '../data/workflow-store';
import {WorkflowCoordinator} from './workflow-coordinator';
import {buildTaskChatRequest,PROMPT_VERSION,canReplayConversation} from './task-execution-support';
import {OPENAI_RESPONSES_ADAPTER} from './openai-responses-adapter';
const logger={debug(){},info(){},warn(){},error(){}};
const capabilities={temperature:false,topP:false,reasoning:true,nativeWebSearch:true,promptCaching:true,promptCacheMode:'implicit',responseContinuation:true};
const snapshot={providerId:'fixture',model:'gpt-6.1-sol',capabilities,providerSnapshot:{apiFormat:'openai-responses',baseUrl:'https://example.invalid/v1'}};
const output=[{type:'reasoning',id:'rs_fixture',encrypted_content:'SYNTHETIC_OPAQUE_STATE',summary:[]},{type:'web_search_call',id:'ws_fixture',status:'completed',action:{type:'search',query:'synthetic query',sources:[{type:'url',url:'https://example.invalid/source'}]}},{type:'message',id:'msg_fixture',role:'assistant',phase:'final_answer',status:'completed',content:[{type:'output_text',text:'{"definition":"synthetic definition"}',annotations:[]}]}];
const raw={id:'resp_fixture',status:'completed',output};
async function fixture(){const files=new Map<string,string>();const storage={listFiles:async()=>ok([...files.keys()]),read:async(p:string)=>ok(files.get(p)!),exists:async(p:string)=>files.has(p),atomicWrite:async(p:string,v:string)=>{files.set(p,v);return ok(undefined);}};const store=new WorkflowStore(storage as never,logger);await store.initialize();const artifact={version:'7.0.0',workflowId:'fixture',kind:'create',state:'active',nodeId:'fixture',type:'domain',filePath:'Synthetic.md',noteTitle:'Synthetic',parents:[],concept:{name:{chinese:'合成概念',english:''},coreDefinition:'synthetic'},autoVerify:false,accumulated:{},noteCreated:true,appliedStageIds:[],createdAt:1,updatedAt:1};expect((await store.create(artifact as never)).ok).toBe(true);const coordinator=new WorkflowCoordinator({workflowStore:store,settingsStore:{getSettings:()=>({verifyReportPresentation:'expanded'})}} as never);return{files,storage,store,coordinator,artifact};}
describe('Responses native continuation state',()=>{
 it('preserves only supported replay output, excluding envelope metadata and secret-like extras',()=>{
  const r=parseOpenAIResponsesResponse({...raw,metadata:{apiKey:'NEVER_COPY'},output:output.map(i=>({...i,debug:'NEVER_COPY'}))});expect(r.ok).toBe(true);if(r.ok){expect((r.value as any).responsesOutput).toEqual(output);expect(JSON.stringify(r)).not.toContain('NEVER_COPY');}
 });
 it('round trips native state through actual coordinator, durable store reload and next Responses body',async()=>{
  const f=await fixture(),parsed=parseOpenAIResponsesResponse(raw);if(!parsed.ok)throw Error('parse');const first=buildTaskChatRequest('write','<system_instructions>Stable</system_instructions>\nfirst request',snapshot as never);
  const result={phaseResult:{definition:'synthetic definition'},responseId:parsed.value.responseId,responseContent:parsed.value.content,promptUser:first.messages.at(-1)!.content,systemPrompt:first.messages[0].content,responsesOutput:(parsed.value as any).responsesOutput};
  expect((await(f.coordinator as any).persistPendingStageResult(f.artifact,'core',result,{modelSnapshot:snapshot})).ok).toBe(true);const reloaded=new WorkflowStore(f.storage as never,logger);await reloaded.initialize();const artifact=reloaded.get('fixture')!;
  const conversation={...artifact.conversation,previousResponseId:artifact.conversation!.responseId};const next=buildTaskChatRequest('write','<system_instructions>Stable</system_instructions>\nnext request',snapshot as never,undefined,undefined,undefined,conversation as never);
  const body=OPENAI_RESPONSES_ADAPTER.buildRequestBody(next);expect(body.input).toEqual([{role:'user',content:first.messages.at(-1)!.content},...output,{role:'user',content:'next request'}]);expect(body).not.toHaveProperty('previous_response_id');expect(body.instructions).toBe('Stable');expect(next.messages.filter(m=>m.role==='assistant')).toHaveLength(1);
 });
 it('keeps old text-only artifacts and incompatible bindings on complete text fallback',()=>{
  const c={...snapshot,promptVersion:PROMPT_VERSION,apiFormat:'openai-responses',endpoint:'openai-responses|https://example.invalid/v1',responseContinuationEnabled:true,promptCachingEnabled:true,promptCacheMode:'implicit',systemPrompt:'Stable',history:[{role:'user',content:'old request'},{role:'assistant',content:'old answer'}]};
  const next=buildTaskChatRequest('write','<system_instructions>Stable</system_instructions>\nnext request',snapshot as never,undefined,undefined,undefined,c as never);expect(OPENAI_RESPONSES_ADAPTER.buildRequestBody(next).input).toEqual([...c.history,{role:'user',content:'next request'}]);
  for(const patch of [{providerId:'other'},{model:'other'},{providerSnapshot:{...snapshot.providerSnapshot,baseUrl:'https://other.invalid/v1'}},{providerSnapshot:{...snapshot.providerSnapshot,apiFormat:'openai-chat-completions'} }])expect(canReplayConversation(c as never,{...snapshot,...patch} as never)).toBe(false);
 });
});

describe('native replay safety and compatibility',()=>{
 it('falls back without truncating visible output for missing opaque state, unknown tools, or oversized state',()=>{
  for(const changed of [output.map(i=>i.type==='reasoning'?{...i,encrypted_content:undefined}:i),[...output,{type:'future_tool',id:'future'}],output.map(i=>i.type==='reasoning'?{...i,encrypted_content:'x'.repeat(MAX_RESPONSES_REPLAY_BYTES)}:i)]){
   const r=parseOpenAIResponsesResponse({...raw,output:changed});expect(r.ok).toBe(true);if(r.ok){expect(r.value.content).toBe('{"definition":"synthetic definition"}');expect(r.value.responsesOutput).toBeUndefined();}
  }
 });
 it('isolates output snapshots from caller mutation and validates native-to-text alignment',()=>{
  const cloned=structuredClone(output),safe=readResponsesReplayOutput(cloned)!;cloned[1].action!.query='changed';expect((safe[1].action as {query:string}).query).toBe('synthetic query');
  const history=[{role:'user',content:'first'},{role:'assistant',content:'{"definition":"synthetic definition"}'}];expect(readResponsesOutputHistory([output],history)).toBeDefined();expect(readResponsesOutputHistory([output],[history[0],{role:'assistant',content:'edited answer'}])).toBeUndefined();expect(readResponsesOutputHistory([output],[])).toBeUndefined();
 });
 it('preserves native tool/phase fields and explicit user boundaries without duplicate assistant text',()=>{
  const history=[{role:'user',content:'first'},{role:'assistant',content:'{"definition":"synthetic definition"}'}];const c={providerId:'fixture',model:'gpt-6.1-sol',promptVersion:PROMPT_VERSION,apiFormat:'openai-responses',endpoint:'openai-responses|https://example.invalid/v1',responseContinuationEnabled:true,promptCachingEnabled:true,promptCacheMode:'explicit',history,responsesOutputHistory:[output]};
  const request=buildTaskChatRequest('write','<system_instructions>Stable</system_instructions>\nnext request',{...snapshot,capabilities:{...capabilities,promptCacheMode:'explicit'}} as never,undefined,undefined,undefined,c as never);const body=OPENAI_RESPONSES_ADAPTER.buildRequestBody(request);const input=body.input as Array<Record<string,unknown>>;expect(input.filter(i=>i.type==='message')).toEqual([output[2]]);expect(input.find(i=>i.type==='reasoning')).toEqual(output[0]);expect(input.find(i=>i.type==='web_search_call')).toEqual(output[1]);expect((input[1].content as Array<Record<string,unknown>>)[0].prompt_cache_breakpoint).toEqual({mode:'explicit'});expect((input.at(-1)!.content as Array<Record<string,unknown>>)[0].text).toBe('next request');expect(input.filter(i=>i.role==='assistant')).toHaveLength(1);
 });
 it('drops only corrupt optional native history on storage reload, keeping the existing workflow',async()=>{
  const f=await fixture();const path=[...f.files.keys()][0];const artifact=JSON.parse(f.files.get(path)!);artifact.conversation={providerId:'fixture',model:'gpt-6.1-sol',promptVersion:PROMPT_VERSION,promptCacheKey:'key',history:[{role:'user',content:'first'},{role:'assistant',content:'answer'}],responsesOutputHistory:[{apiKey:'NEVER_COPY'}]};f.files.set(path,JSON.stringify(artifact));const reloaded=new WorkflowStore(f.storage as never,logger);await reloaded.initialize();expect(reloaded.get('fixture')!.conversation!.history).toEqual(artifact.conversation.history);expect(reloaded.get('fixture')!.conversation!.responsesOutputHistory).toBeUndefined();
 });
 it.each(['failed','incomplete'])('does not produce replay state from %s responses',status=>{
  const r=parseOpenAIResponsesResponse({...raw,status,...(status==='incomplete'?{incomplete_details:{reason:'max_output_tokens'}}:{})});if(r.ok)expect(r.value.responsesOutput).toBeUndefined();else expect(r.ok).toBe(false);
 });
 it.each(['invalid','cancelled'])('does not return native state from a %s Write attempt',async kind=>{
  const abort=new AbortController(),response=parseOpenAIResponsesResponse(raw);if(!response.ok)throw Error('parse');let calls=0;
  const executor=new WriteTaskExecutor({providerManager:{chat:async()=>{calls++;if(kind==='cancelled')abort.abort();return kind==='invalid'?ok({...response.value,content:'{"definition":3}'}):response;}} as never,promptManager:{loadPhaseTemplate:async()=>ok('synthetic'),buildPhasedWrite:()=>'<system_instructions>Stable</system_instructions>\ncurrent'} as never,responsePipeline:new ResponsePipeline(new Validator()),schemaRegistry,logger});
  const task={id:'write',nodeId:'fixture',stageId:'core',state:'running',createdAt:1,updatedAt:1,attempt:1,payload:{concept:{type:'domain',name:{chinese:'合成领域',english:''},coreDefinition:'synthetic',parents:[],source:'define'},accumulated:{}}};const r=await executor.execute(task as never,abort.signal,{modelSnapshot:snapshot,attemptReason:'initial'} as never);expect(r.ok).toBe(false);expect(calls).toBe(1);expect(r).not.toHaveProperty('value.responsesOutput');
 });
});

describe('official Responses replay field variants',()=>{
 it.each([{type:'find_in_page',url:'https://example.invalid',pattern:'term'},{type:'open_page',url:null},{type:'open_page'},{type:'search'}])('preserves valid action %j',action=>{
  const items=output.map(i=>i.type==='web_search_call'?{...i,action}:i);expect(readResponsesReplayOutput(items)?.[1].action).toEqual(action);
 });
 it('preserves a nullable message phase',()=>{expect(readResponsesReplayOutput(output.map(i=>i.type==='message'?{...i,phase:null}:i))?.[2].phase).toBeNull();});
 it.each([{type:'find',url:'https://example.invalid',pattern:'term'},{type:'find_in_page',pattern:'term'},{type:'find_in_page',url:'https://example.invalid'},{type:'search',queries:null}])('declines malformed action %j without sending it',action=>{
  expect(readResponsesReplayOutput(output.map(i=>i.type==='web_search_call'?{...i,action}:i))).toBeUndefined();
 });
 it('declines unsupported reasoning text instead of silently removing official replay data',()=>{expect(readResponsesReplayOutput(output.map(i=>i.type==='reasoning'?{...i,content:[{type:'reasoning_text',text:'SYNTHETIC_PRIVATE_TEXT'}]}:i))).toBeUndefined();});
 it('does not forward fields from another action variant',()=>{expect(readResponsesReplayOutput(output.map(i=>i.type==='web_search_call'?{...i,action:{type:'open_page',url:null,pattern:'irrelevant',queries:['irrelevant']}}:i))?.[1].action).toEqual({type:'open_page',url:null});});
});

it.each(['gpt-6.1-sol','gpt-6-sol',undefined])('only forwards opaque Write state for the confirmed requested model, reported=%s',async model=>{
 const phase={definition:'合成定义',core_questions:'合成问题',methodology:'合成方法',boundaries:[]};
 const r=parseOpenAIResponsesResponse({...raw,model,output:output.map(i=>i.type==='message'?{...i,content:[{type:'output_text',text:JSON.stringify({result:{stage:"core",...phase}}),annotations:[]}]}:i)});if(!r.ok)throw Error('parse');
 const executor=new WriteTaskExecutor({providerManager:{chat:async()=>r} as never,promptManager:{loadPhaseTemplate:async()=>ok('synthetic'),buildPhasedWrite:()=>'<system_instructions>Stable</system_instructions>\ncurrent'} as never,responsePipeline:new ResponsePipeline(new Validator()),schemaRegistry,logger});
 const task={id:'write',nodeId:'fixture',stageId:'core',state:'running',createdAt:1,updatedAt:1,attempt:1,payload:{concept:{type:'domain',name:{chinese:'合成领域',english:''},coreDefinition:'synthetic',parents:[],source:'define'},accumulated:{}}};
 const context={modelSnapshot:snapshot,attemptReason:'initial'};const result=await executor.execute(task as never,new AbortController().signal,context as never);expect(result.ok).toBe(true);if(!result.ok)throw Error('Write validation failed');expect(!!result.value.responsesOutput).toBe(model==='gpt-6.1-sol');
 const f=await fixture();expect((await(f.coordinator as any).persistPendingStageResult(f.artifact,'core',result.value,context)).ok).toBe(true);
 const reloaded=new WorkflowStore(f.storage as never,logger);await reloaded.initialize();const conversation=reloaded.get('fixture')!.conversation!;
 const next=buildTaskChatRequest('write','<system_instructions>Stable</system_instructions>\\nnext request',snapshot as never,undefined,undefined,undefined,{...conversation,previousResponseId:conversation.responseId});
 const body=OPENAI_RESPONSES_ADAPTER.buildRequestBody(next);expect(body).not.toHaveProperty('previous_response_id');
 expect(JSON.stringify(body).includes('SYNTHETIC_OPAQUE_STATE')).toBe(model==='gpt-6.1-sol');
 expect((body.input as unknown[]).length).toBe(model==='gpt-6.1-sol'?5:3);
 expect(conversation.history).toEqual([{role:'user',content:'current\n<write_stage>core</write_stage>'},{role:'assistant',content:JSON.stringify({result:{stage:"core",...phase}})}]);
});

it('keeps server-id continuation incremental and does not replay the local native state twice',()=>{
 const c={providerId:'fixture',model:'gpt-6.1-sol',promptVersion:PROMPT_VERSION,apiFormat:'openai-responses',endpoint:'openai-responses|https://example.invalid/v1',responseContinuationEnabled:true,promptCachingEnabled:false,promptCacheMode:'implicit',previousResponseId:'resp_first',history:[{role:'user',content:'first'},{role:'assistant',content:'{"definition":"synthetic definition"}'}],responsesOutputHistory:[output]};
 const request=buildTaskChatRequest('write','<system_instructions>Stable</system_instructions>\nnext request',{...snapshot,capabilities:{...capabilities,promptCaching:false}} as never,undefined,undefined,undefined,c as never);const body=OPENAI_RESPONSES_ADAPTER.buildRequestBody(request);expect(request.responsesInput).toBeUndefined();expect(body.input).toBe('next request');expect(body.previous_response_id).toBe('resp_first');
});

it('preserves official empty reasoning content without admitting plaintext reasoning',()=>{
 const empty=output.map(i=>i.type==='reasoning'?{...i,content:[]}:i);
 expect(readResponsesReplayOutput(empty)?.[0].content).toEqual([]);
 for(const content of [null,'unsupported',[{type:'reasoning_text',text:'SYNTHETIC_PRIVATE_TEXT'}]])expect(readResponsesReplayOutput(output.map(i=>i.type==='reasoning'?{...i,content}:i))).toBeUndefined();
});
