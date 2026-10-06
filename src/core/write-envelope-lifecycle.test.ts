import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Validator } from "../data/validator";
import { WorkflowStore } from "../data/workflow-store";
import { DEFAULT_MODEL_CAPABILITIES, err, ok, type ChatRequest, type ConversationContinuation, type TaskModelSnapshot, type TaskRecord } from "../types";
import { PromptManager } from "./prompt-manager";
import { ResponsePipeline } from "./response-pipeline";
import { schemaRegistry } from "./schema-registry";
import { getWriteStageDefinitions } from "./stage-catalog";
import { PROMPT_VERSION } from "./task-execution-support";
import { WriteTaskExecutor } from "./write-task-executor";
import { WorkflowCoordinator } from "./workflow-coordinator";
import { parseOpenAIResponsesResponse } from "./provider-response-parsers";
import { OPENAI_RESPONSES_ADAPTER } from "./openai-responses-adapter";

const log={debug(){},info(){},warn(){},error(){}};
const model:TaskModelSnapshot={providerId:"synthetic",model:"gpt-6.1-sol",providerSnapshot:{apiKey:"synthetic-only",enabled:true,apiFormat:"openai-responses",baseUrl:"https://never-called.example/v1",embeddingApiFormat:"disabled",defaultChatModel:"gpt-6.1-sol",defaultEmbedModel:""},capabilities:{...DEFAULT_MODEL_CAPABILITIES,promptCaching:true,responseContinuation:true,promptCacheMode:"implicit"}};
const concept={type:"domain" as const,name:{chinese:"合成领域",english:""},coreDefinition:"迁移与保存验证",parents:[],source:"define" as const};
const fields={core:{definition:"PRESERVED_DEFINITION",core_questions:"QUESTION",methodology:"METHOD",boundaries:["BOUNDARY"]},narrative:{historical_genesis:"HISTORY",holistic_understanding:"WHOLE"},structure:{sub_domains:[],issues:[]}};
async function fixture(mode:"ok"|"wrong-stage"|"extra"|"failed"|"cancelled"="ok"){
  const requests:ChatRequest[]=[],bodies:Record<string,unknown>[]=[],raws:string[]=[];const signal=new AbortController();
  const prompts=new PromptManager({read:async(path:string)=>ok(await readFile(path,"utf8"))} as never,log);
  const executor=new WriteTaskExecutor({promptManager:prompts,responsePipeline:new ResponsePipeline(new Validator()),schemaRegistry,logger:log,providerManager:{chat:async(request:ChatRequest)=>{
    requests.push(request);bodies.push(OPENAI_RESPONSES_ADAPTER.buildRequestBody(request));
    if(mode==="failed")return err("E206_PROVIDER_REQUEST_UNCERTAIN","synthetic unknown");
    const stage=request.requestLabel as keyof typeof fields;
    const content=JSON.stringify({result:{stage:mode==="wrong-stage"?"structure":stage,...fields[stage],...(mode==="extra"?{extra:true}:{})}});raws.push(content);
    const anchor=content.indexOf("PRESERVED_DEFINITION");
    if(mode==="cancelled")signal.abort();
    return parseOpenAIResponsesResponse({id:"resp_"+stage,model:model.model,status:"completed",usage:{input_tokens:1200,output_tokens:50,total_tokens:1250,input_tokens_details:{cached_tokens:512}},output:[{type:"reasoning",id:"rs_"+stage,summary:[],content:[],encrypted_content:"SYNTHETIC_OPAQUE_"+stage},{type:"message",id:"msg_"+stage,role:"assistant",phase:"final_answer",status:"completed",content:[{type:"output_text",text:content,annotations:[{type:"url_citation",url:"https://evidence.example/original",title:"Source",start_index:anchor<0?2:anchor,end_index:anchor<0?8:anchor+20}]}]}]});
  }} as never});
  const task=(stage:"core"|"narrative"|"structure",accumulated:Record<string,unknown>={},conversation?:ConversationContinuation):TaskRecord<typeof stage>=>({id:stage,nodeId:"n",workflowId:"w",stageId:stage,state:"running",attempt:1,createdAt:1,updatedAt:1,payload:{concept,accumulated,conversation}});
  return{executor,requests,bodies,raws,task,signal};
}

describe("production stable Write lifecycle",()=>{
  it("serializes and reloads raw native envelopes while keeping business fields flat, citations intact and covered draft omitted",async()=>{
    const f=await fixture(),files=new Map<string,string>();
    const storage={listFiles:async()=>ok([...files.keys()]),read:async(p:string)=>ok(files.get(p)!),exists:async(p:string)=>files.has(p),atomicWrite:async(p:string,v:string)=>{files.set(p,v);return ok(undefined);}};
    const reload=async()=>{const s=new WorkflowStore(storage as never,log);await s.initialize();return s;};let store=await reload();
    expect((await store.create({version:"7.0.0",workflowId:"w",kind:"create",state:"active",nodeId:"n",type:"domain",filePath:"Synthetic.md",noteTitle:"合成领域",parents:[],concept:{name:concept.name,coreDefinition:concept.coreDefinition},autoVerify:false,accumulated:{},noteCreated:false,appliedStageIds:[],createdAt:1,updatedAt:1} as never)).ok).toBe(true);
    for(const stage of getWriteStageDefinitions("domain")){
      const coordinator=new WorkflowCoordinator({workflowStore:store,settingsStore:{getSettings:()=>({verifyReportPresentation:"expanded"})}} as never);
      const payload=await coordinator.queuePort.resolve({workflowId:"w",stageId:stage.id} as never);expect(payload.ok).toBe(true);if(!payload.ok)throw Error(payload.error.message);
      const result=await f.executor.execute({...f.task(stage.id as keyof typeof fields),payload:payload.value as TaskRecord<"core">["payload"]},f.signal.signal,{modelSnapshot:model,attemptReason:"initial"});
      expect(result.ok).toBe(true);if(!result.ok)throw Error(result.error.message);
      expect(result.value.phaseResult).toEqual(fields[stage.id as keyof typeof fields]);expect(result.value.responseContent).toBe(f.raws.at(-1));
      expect(result.value.sourcePackage).toEqual({items:[{url:"https://evidence.example/original",title:"Source"}]});
      expect(result.value.responsesOutput).toBeDefined();
      if(stage.id==="core"){
        const native=result.value.responsesOutput as Array<{type:string;content?:Array<{text:string;annotations:Array<{start_index:number;end_index:number}>}>}>;
        const part=native.find(item=>item.type==="message")!.content![0];const cite=part.annotations[0];
        expect(part.text).toBe(f.raws[0]);expect(cite.start_index).toBe(f.raws[0].indexOf("PRESERVED_DEFINITION"));
        expect(part.text.slice(cite.start_index,cite.end_index)).toBe("PRESERVED_DEFINITION");
      }
      const save=(coordinator as unknown as {persistPendingStageResult:(artifact:unknown,stage:string,result:unknown,context:unknown)=>Promise<{ok:boolean}>}).persistPendingStageResult;
      expect((await save.call(coordinator,store.get("w"),stage.id,result.value,{modelSnapshot:model,attemptReason:"initial"})).ok).toBe(true);
      store=await reload();const artifact=store.get("w")!;
      expect(artifact.conversation?.promptVersion).toBe(PROMPT_VERSION);
      expect(artifact.conversation?.history?.at(-1)?.content).toBe(f.raws.at(-1));
      expect(artifact.conversation?.responsesOutputHistory?.length).toBe(f.requests.length);
      if(stage.id!=="core")expect([...f.requests.at(-1)!.messages].reverse().find(m=>m.role==="user")!.content).not.toContain("PRESERVED_DEFINITION");
    }
    expect(store.get("w")!.accumulated).toEqual({...fields.core,...fields.narrative,...fields.structure});
    expect(f.requests).toHaveLength(3);expect(Array.isArray(f.bodies[0].input)).toBe(true);expect(f.requests[0].response_format).toEqual(f.requests[1].response_format);expect(f.requests[1].response_format).toEqual(f.requests[2].response_format);
    expect(f.requests[1].responsesInput?.some(item=>item.type==="reasoning")).toBe(true);
    expect(f.requests.every(r=>!r.previousResponseId)).toBe(true);
  });

  it.each(["wrong-stage","extra","failed","cancelled"] as const)("%s cannot produce a stage result or trigger a repair request",async mode=>{
    const f=await fixture(mode);const result=await f.executor.execute(f.task("core"),f.signal.signal,{modelSnapshot:model,attemptReason:"initial"});
    expect(result.ok).toBe(false);expect(f.requests).toHaveLength(1);
  });

  it("isolates old v8 text/native/responseID and keeps its authoritative draft for the next phase",async()=>{
    const f=await fixture();const previous:ConversationContinuation={providerId:model.providerId,model:model.model,apiFormat:"openai-responses",endpoint:"openai-responses|https://never-called.example/v1",promptVersion:"v8",responseContinuationEnabled:true,promptCachingEnabled:true,promptCacheMode:"implicit",previousResponseId:"old-id",systemPrompt:"OLD_SYSTEM",history:[{role:"user",content:"OLD_USER"},{role:"assistant",content:JSON.stringify(fields.core)}]};
    const result=await f.executor.execute(f.task("narrative",fields.core,previous),f.signal.signal,{modelSnapshot:model,attemptReason:"initial"});
    expect(result.ok).toBe(true);expect(f.requests).toHaveLength(1);expect(f.requests[0].previousResponseId).toBeUndefined();expect(f.requests[0].responsesInput).toEqual([{role:"user",content:f.requests[0].messages.find(message=>message.role==="user")!.content}]);
    const text=f.requests[0].messages.map(m=>m.content).join("\n");expect(text).not.toContain("OLD_SYSTEM");expect(text).not.toContain("OLD_USER");expect(text).toContain("PRESERVED_DEFINITION");
    expect(result.ok&&result.value.accumulated).toEqual({...fields.core,...fields.narrative});
  });

  it.each(["provider","model","endpoint"] as const)("a changed %s retains the entire prefetched draft rather than replaying incompatible envelopes",async changed=>{
    const f=await fixture();const previous:ConversationContinuation={providerId:model.providerId,model:model.model,apiFormat:"openai-responses",endpoint:"openai-responses|https://never-called.example/v1",promptVersion:PROMPT_VERSION,responseContinuationEnabled:true,promptCachingEnabled:true,promptCacheMode:"implicit",systemPrompt:"OLD_BOUND_SYSTEM",history:[{role:"user",content:"OLD_BOUND_USER"},{role:"assistant",content:JSON.stringify({result:{stage:"core",...fields.core}})}]};
    if(changed==="provider")previous.providerId="different-provider";
    if(changed==="model")previous.model="different-model";
    if(changed==="endpoint")previous.endpoint="openai-responses|https://different.example/v1";
    const result=await f.executor.execute(f.task("narrative",fields.core,previous),f.signal.signal,{modelSnapshot:model,attemptReason:"initial"});
    expect(result.ok).toBe(true);const text=f.requests[0].messages.map(m=>m.content).join("\n");expect(text).toContain(fields.core.definition);expect(text).not.toContain("OLD_BOUND_USER");expect(text).not.toContain("OLD_BOUND_SYSTEM");expect(f.requests[0].responsesInput).toEqual([{role:"user",content:f.requests[0].messages.find(message=>message.role==="user")!.content}]);
  });
});
