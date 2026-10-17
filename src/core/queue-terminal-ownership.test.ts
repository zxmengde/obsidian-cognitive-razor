import {expect,it,vi,afterEach} from 'vitest';
import {TaskQueue} from "./task-queue";
import {DEFAULT_SETTINGS} from "../data/settings-store";
import {ok,err} from "../types";
const log={debug(){},info(){},warn(){},error(){}};
const qs:TaskQueue[]=[];afterEach(async()=>{vi.useRealTimers();for(const q of qs.splice(0))await q.dispose()});
function fixture(run:any,atomicWrite:any,beforeFail:any=vi.fn(async()=>undefined)){
 const settings={...structuredClone(DEFAULT_SETTINGS),concurrency:1,taskTimeoutMs:1000};
 const beforeComplete=vi.fn(async()=>ok({}));
 const q=new TaskQueue(log,{getSettings:()=>settings,subscribe:()=>()=>{}} as never,{fileStorage:{atomicWrite} as never,workflowPort:{resolve:async()=>ok({}),beforeComplete,beforeFail}});qs.push(q);q.setTaskRunner({run,abort:vi.fn()} as never);
 return{q,beforeComplete,beforeFail}
}
it.each(['checkpoint','queue-save'])('a timed-out request cannot revive during terminal %s',async boundary=>{
 vi.useFakeTimers();let finish:any;let releaseCheckpoint:any;
 const run=vi.fn(()=>new Promise(resolve=>finish=resolve));
 const beforeFail=vi.fn(async()=>{if(boundary==='checkpoint')await new Promise(resolve=>releaseCheckpoint=resolve)});
 const f=fixture(run,async(_p:string,text:string)=>JSON.parse(text).tasks.some((t:any)=>t.state==='interrupted')?err('E303_DISK_FULL','full'):ok(undefined),beforeFail);
 const result=await f.q.enqueueDurably({workflowId:'A',nodeId:'A',stageId:'tag',payload:{}});if(!result.ok)throw Error('enqueue');
 await vi.advanceTimersByTimeAsync(1001);
 if(boundary==='queue-save')expect(f.q.getTask(result.value)?.localSavePending).toBe(true);
 finish(ok({paidResult:'late success'}));await vi.advanceTimersByTimeAsync(1);
 expect(f.beforeComplete).not.toHaveBeenCalled();
 if(releaseCheckpoint){releaseCheckpoint();await vi.advanceTimersByTimeAsync(1)}
 expect(f.q.getTask(result.value)?.localSavePending).toBe(true);
 expect(beforeFail).toHaveBeenCalledOnce();
});
it('known response failure disables provider timeout before slow local beforeFail checkpoint',async()=>{
 vi.useFakeTimers();let release:any;
 const beforeFail=vi.fn(async(_task:any,error:any)=>{if(error.code==='E204_PROVIDER_ERROR')await new Promise(resolve=>release=resolve)});
 const f=fixture(vi.fn(async()=>err('E204_PROVIDER_ERROR','known rejection')),async()=>ok(undefined),beforeFail);
 const result=await f.q.enqueueDurably({workflowId:'B',nodeId:'B',stageId:'tag',payload:{}});if(!result.ok)throw Error('enqueue');
 await vi.advanceTimersByTimeAsync(1001);
 release();await vi.advanceTimersByTimeAsync(1);
 expect(beforeFail).toHaveBeenCalledOnce();
 expect(f.q.getTask(result.value)?.error?.code).toBe('E204_PROVIDER_ERROR');
});
