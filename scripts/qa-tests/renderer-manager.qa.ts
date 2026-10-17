import { afterEach, expect, it, vi } from 'vitest';
import { ProviderManager } from '../../src/core/provider-manager';
import { armQaRendererStream } from '../../src/core/qa-renderer-selection';
import type { SettingsStore } from '../../src/data/settings-store';
import type { ILogger } from '../../src/types';
const logger:ILogger={debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()};
const settings={getSettings:()=>({enableStreamingKeepalive:false,providerTimeoutMs:5000,providerMaxAttempts:3,providers:{test:{apiKey:'synthetic-only',baseUrl:'https://example.test/v1',apiFormat:'openai-responses',enabled:true,enableWebSearch:false}}})} as unknown as SettingsStore;
const request={providerId:'test',model:'synthetic',messages:[{role:'user' as const,content:'synthetic'}]};
const body=(text:string)=>({status:200,type:'cors',headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(text));c.close();}})}) as Response;
afterEach(()=>vi.unstubAllGlobals());
it('unarmed manager dispatches no network request',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const manager=new ProviderManager(settings,logger);expect(await manager.chat(request)).toMatchObject({ok:false,error:{code:'E310_INVALID_STATE'}});expect(fetch).not.toHaveBeenCalled();manager.dispose();});
it('explicit one-shot forces POST stream despite stored streaming off, uses configured auth and shared parser',async()=>{
 const fetch=vi.fn(async()=>body('data: {"type":"response.output_text.delta","delta":"complete"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'));vi.stubGlobal('fetch',fetch);
 const manager=new ProviderManager(settings,logger);expect(armQaRendererStream()).toBe(true);expect(await manager.chat(request)).toMatchObject({ok:true,value:{content:'complete'}});
 expect(fetch).toHaveBeenCalledOnce();const args=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(args[1].method).toBe('POST');expect(JSON.parse(args[1].body as string).stream).toBe(true);expect(args[1].headers).toMatchObject({Authorization:'Bearer synthetic-only'});
 expect(await manager.chat(request)).toMatchObject({ok:false,error:{code:'E310_INVALID_STATE'}});expect(fetch).toHaveBeenCalledOnce();manager.dispose();
});
it('explicit retryable server_error never automatically sends a second request in QA',async()=>{const fetch=vi.fn(async()=>body('data: {"type":"response.failed","response":{"error":{"code":"server_error"}}}\n\n'));vi.stubGlobal('fetch',fetch);const manager=new ProviderManager(settings,logger);armQaRendererStream();expect(await manager.chat(request)).toMatchObject({ok:false,error:{code:'E204_PROVIDER_ERROR'}});expect(fetch).toHaveBeenCalledOnce();manager.dispose();});
it('CORS-style rejection is E206 with renderer label and no raw error or fallback',async()=>{const fetch=vi.fn(async()=>{throw new TypeError('secret raw URL');});vi.stubGlobal('fetch',fetch);const manager=new ProviderManager(settings,logger);armQaRendererStream();const result=await manager.chat(request);expect(result).toMatchObject({ok:false,error:{code:'E206_PROVIDER_REQUEST_UNCERTAIN',details:{transport:'renderer-fetch',phase:'before-response'}}});expect(JSON.stringify(result)).not.toContain('secret');expect(fetch).toHaveBeenCalledOnce();manager.dispose();});
it('body read failure after response stays E206 and does not resend',async()=>{
 const fetch=vi.fn(async()=>({status:200,type:'cors',headers:new Headers(),body:new ReadableStream({start(c){c.error(Error('secret body'));}})}) as Response);vi.stubGlobal('fetch',fetch);
 const manager=new ProviderManager(settings,logger);armQaRendererStream();expect(await manager.chat(request)).toMatchObject({ok:false,error:{code:'E206_PROVIDER_REQUEST_UNCERTAIN',details:{phase:'after-response',transport:'renderer-fetch'}}});expect(fetch).toHaveBeenCalledOnce();manager.dispose();
});
it('cancellation during dispatch returns E206 without fallback or a second dispatch',async()=>{
 const fetch=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetch);const manager=new ProviderManager(settings,logger);const c=new AbortController();armQaRendererStream();const pending=manager.chat(request,c.signal);c.abort();expect(await pending).toMatchObject({ok:false,error:{code:'E206_PROVIDER_REQUEST_UNCERTAIN'}});expect(fetch).toHaveBeenCalledOnce();manager.dispose();
});
it('HTTP error status is retained but raw body is excluded from QA diagnostics',async()=>{
 const r=body('private upstream body');Object.defineProperty(r,'status',{value:401});const fetch=vi.fn(async()=>r);vi.stubGlobal('fetch',fetch);const manager=new ProviderManager(settings,logger);armQaRendererStream();const result=await manager.chat(request);expect(result).toMatchObject({ok:false,error:{code:'E203_INVALID_API_KEY',details:{status:401}}});expect(JSON.stringify(result)).not.toContain('private upstream body');expect(fetch).toHaveBeenCalledOnce();manager.dispose();
});
