import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {parseOpenAIResponsesResponse} from './provider-response-parsers';
import {aggregateProviderStream} from './provider-streaming';
import {WriteTaskExecutor} from './write-task-executor';
import {PromptManager} from './prompt-manager';
import {ResponsePipeline} from './response-pipeline';
import {Validator} from '../data/validator';
import {schemaRegistry} from './schema-registry';
import {DEFAULT_MODEL_CAPABILITIES,ok} from '../types';
const logger={debug(){},info(){},warn(){},error(){}};
const final={sub_domains:[{name:'最终合成分支',description:'来自 final_answer 的唯一实际条目'}],issues:[]};
const commentary='Use this shape:\n```json\n'+JSON.stringify({sub_domains:[],issues:[]})+'\n```\n';
const messages=[{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:commentary}]},{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:JSON.stringify(final)}]}];
const parsed=(raw:unknown)=>{const r=parseOpenAIResponsesResponse(raw);expect(r.ok).toBe(true);if(!r.ok)throw Error(r.error.message);return r.value;};
describe('Responses final phase is task output',()=>{
 it('uses the final phase in the real Write pipeline instead of accepting a valid commentary placeholder',async()=>{
  const pm=new PromptManager({read:async(p:string)=>ok(await readFile(p,'utf8'))} as never,logger);expect((await pm.preloadAllBaseComponents()).ok).toBe(true);
  const executor=new WriteTaskExecutor({providerManager:{chat:async()=>parseOpenAIResponsesResponse({status:'completed',output:messages})} as never,promptManager:pm,responsePipeline:new ResponsePipeline(new Validator()),schemaRegistry,logger});
  const task={id:'synthetic',nodeId:'synthetic',stageId:'structure',state:'running',createdAt:1,updatedAt:1,attempt:1,payload:{concept:{type:'domain',name:{chinese:'合成领域',english:''},coreDefinition:'合成定义',parents:[],source:'define'},accumulated:{}}};
  const r=await executor.execute(task as never,new AbortController().signal,{modelSnapshot:{providerId:'fixture',model:'fixture',capabilities:DEFAULT_MODEL_CAPABILITIES},attemptReason:'initial'});expect(r.ok).toBe(true);if(r.ok)expect(r.value.phaseResult).toEqual(final);
 });
 it('does not let a combined SDK output_text override explicit final phase content',()=>{
  expect(parsed({status:'completed',output_text:commentary+JSON.stringify(final),output:messages}).content).toBe(JSON.stringify(final));
 });
 it('maps final citations to the selected final text and drops commentary citations',()=>{
  const raw={status:'completed',output_text:'commentaryFinal fact',output:[{type:'message',phase:'commentary',content:[{type:'output_text',text:'commentary',annotations:[{type:'url_citation',url:'https://example.test/intermediate',start_index:0,end_index:4}]}]},{type:'message',phase:'final_answer',content:[{type:'output_text',text:'Final fact',annotations:[{type:'url_citation',url:'https://example.test/final',start_index:0,end_index:5}]}]}]};
  const r=parsed(raw);expect(r.content).toBe('Final fact');expect(r.citations).toEqual([{url:'https://example.test/final',title:undefined,startIndex:0,endIndex:5}]);
 });
 it('keeps old relays without phase metadata compatible',()=>{
  expect(parsed({status:'completed',output_text:'SDK result',output:[{type:'message',content:[{type:'output_text',text:'old part'}]}]}).content).toBe('SDK result');
  expect(parsed({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'first'}]},{type:'message',content:[{type:'output_text',text:' second'}]}]}).content).toBe('first second');
 });
 it('selects final phase consistently after SSE aggregation with a combined output_text field',()=>{
  const events='data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output_text:commentary+JSON.stringify(final),output:messages}})+'\n\n';const r=aggregateProviderStream('openai-responses',events);expect(r.ok).toBe(true);if(r.ok)expect(parsed(r.value).content).toBe(JSON.stringify(final));
 });
});

const sse=(data:unknown)=>'data: '+JSON.stringify(data)+'\n\n';
const streamed=(events:unknown[])=>aggregateProviderStream('openai-responses',events.map(sse).join(''));
describe('Responses streamed parts keep message ownership',()=>{
 it('does not resurrect commentary-only text as a final message',()=>{
  const a=streamed([{type:'response.output_item.added',output_index:0,item:{id:'comment',type:'message',phase:'commentary',content:[]}},{type:'response.output_text.done',output_index:0,content_index:0,text:commentary},{type:'response.completed',response:{status:'completed'}}]);
  expect(a.ok).toBe(true);if(a.ok)expect(parseOpenAIResponsesResponse(a.value)).toMatchObject({ok:false,error:{code:'E207_PROVIDER_RESPONSE_UNSUPPORTED'}});
 });
 it('hydrates only the indexed final deltas instead of combining phases',()=>{
  const a=streamed([{type:'response.output_item.added',output_index:0,item:{id:'comment',type:'message',phase:'commentary',content:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:'Note'},{type:'response.output_item.added',output_index:1,item:{id:'final',type:'message',phase:'final_answer',content:[]}},{type:'response.output_text.delta',output_index:1,content_index:0,delta:'Final '},{type:'response.output_text.delta',output_index:1,content_index:0,delta:'fact'},{type:'response.completed',response:{status:'completed'}}]);
  expect(a.ok).toBe(true);if(a.ok)expect(parsed(a.value).content).toBe('Final fact');
 });
 it('keeps indexed commentary citations away from final citations',()=>{
  const a=streamed([{type:'response.output_item.added',output_index:0,item:{id:'comment',type:'message',phase:'commentary',content:[{type:'output_text',text:'Note'}]}},{type:'response.output_text.annotation.added',output_index:0,content_index:0,annotation:{type:'url_citation',url:'https://example.test/comment',start_index:0,end_index:4}},{type:'response.output_item.added',output_index:1,item:{id:'final',type:'message',phase:'final_answer',content:[{type:'output_text',text:'Final fact'}]}},{type:'response.output_text.annotation.added',output_index:1,content_index:0,annotation:{type:'url_citation',url:'https://example.test/final',start_index:0,end_index:5}},{type:'response.completed',response:{status:'completed'}}]);
  expect(a.ok).toBe(true);if(a.ok)expect(parsed(a.value).citations).toEqual([{url:'https://example.test/final',title:undefined,startIndex:0,endIndex:5}]);
 });
 it('uses item_id and content_index to preserve multiple final-part citation offsets',()=>{
  const a=streamed([{type:'response.output_item.added',output_index:2,item:{id:'final',type:'message',phase:'final_answer',content:[]}},{type:'response.output_text.done',item_id:'final',content_index:0,text:'First '},{type:'response.output_text.done',item_id:'final',content_index:1,text:'Second'},{type:'response.output_text.annotation.added',item_id:'final',content_index:1,annotation:{type:'url_citation',url:'https://example.test/second',start_index:0,end_index:6}},{type:'response.completed',response:{status:'completed'}}]);
  expect(a.ok).toBe(true);if(a.ok){expect(parsed(a.value).content).toBe('First Second');expect(parsed(a.value).citations).toEqual([{url:'https://example.test/second',title:undefined,startIndex:6,endIndex:12}]);}
 });
 it('does not trust unindexed combined text when distinct phases exist',()=>{
  const a=streamed([{type:'response.output_item.added',output_index:0,item:{type:'message',phase:'commentary',content:[]}},{type:'response.output_item.added',output_index:1,item:{type:'message',phase:'final_answer',content:[]}},{type:'response.output_text.done',text:commentary+JSON.stringify(final)},{type:'response.completed',response:{status:'completed'}}]);
  expect(a.ok).toBe(true);if(a.ok)expect(parseOpenAIResponsesResponse(a.value)).toMatchObject({ok:false,error:{code:'E207_PROVIDER_RESPONSE_UNSUPPORTED'}});
 });
 it.each(['response.failed','response.incomplete'])('never turns %s into completed task output',type=>{
  const a=streamed([{type:'response.output_item.done',output_index:0,item:messages[1]},{type,response:{status:type.slice(9)}}]);
  if(a.ok)expect(parseOpenAIResponsesResponse(a.value).ok).toBe(false);else expect(a.ok).toBe(false);
 });
});

it('hydrates a sparse streamed output index without losing final ownership',()=>{
 const a=streamed([{type:'response.output_item.added',output_index:2,item:{type:'message',phase:'final_answer',content:[]}},{type:'response.output_text.done',output_index:2,content_index:0,text:'Final sparse'},{type:'response.completed',response:{status:'completed'}}]);
 expect(a.ok).toBe(true);if(a.ok)expect(parsed(a.value).content).toBe('Final sparse');
});

it('fills empty annotations in sparse item envelopes only from that same indexed part',()=>{
 const a=streamed([{type:'response.output_item.added',output_index:1,item:{type:'message',phase:'final_answer',content:[{type:'output_text',text:'Final fact',annotations:[]}]}},{type:'response.output_text.annotation.added',output_index:1,content_index:0,annotation:{type:'url_citation',url:'https://example.test/final',start_index:0,end_index:5}},{type:'response.completed',response:{status:'completed'}}]);
 expect(a.ok).toBe(true);if(a.ok)expect(parsed(a.value).citations?.map(i=>i.url)).toEqual(['https://example.test/final']);
});
