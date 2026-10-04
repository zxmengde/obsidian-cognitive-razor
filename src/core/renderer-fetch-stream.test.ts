import { afterEach, expect, it, vi } from "vitest";
import { createRendererStreamRequester, RendererStreamTimeoutError } from "./renderer-fetch-stream";
import { aggregateProviderStream, ProviderStreamAbortError, ProviderStreamNetworkError } from "./provider-streaming";
import { ObsidianProviderTransport } from "./provider-transport";
const input = { protocol: "openai-responses" as const, url: "https://example.test/v1/responses", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: '{"stream":true}', timeoutMs: 1000 };
const encode = (s: string) => new TextEncoder().encode(s);
function response(body: ReadableStream<Uint8Array>, status=200) { return { status, type:"cors", headers:new Headers({"content-type":"text/event-stream"}), body } as Response; }
afterEach(()=>vi.useRealTimers());
it("posts once and decodes split UTF8 and SSE through the existing aggregator",async()=>{
 const text='data: {"type":"response.output_text.delta","delta":"中文"}\n\ndata: {"type":"response.completed","response":{"id":"synthetic","status":"completed"}}\n\n';
 const bytes=encode(text);const fetcher=vi.fn(async()=>response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}})));
 const result=await createRendererStreamRequester(fetcher)(input);
 expect(result.body).toBe(text);expect(aggregateProviderStream("openai-responses",result.body)).toMatchObject({ok:true,value:{output_text:"中文",status:"completed"}});
 expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]).toBeDefined();
 const opts=vi.mocked(fetcher).mock.calls[0] as unknown as [string,RequestInit];
 expect(opts[1]).toMatchObject({method:"POST",body:input.body,headers:{Authorization:"Bearer synthetic"},mode:"cors",credentials:"omit",redirect:"error"});
});
it("pre-cancel performs zero dispatch",async()=>{const c=new AbortController();c.abort();const f=vi.fn();await expect(createRendererStreamRequester(f)({...input,signal:c.signal})).rejects.toBeInstanceOf(ProviderStreamAbortError);expect(f).not.toHaveBeenCalled();});
it("active cancellation settles despite uncooperative fetch and ignores late headers",async()=>{
 let finish!:(r:Response)=>void;const cancel=vi.fn();const c=new AbortController();const f=vi.fn(()=>new Promise<Response>(r=>finish=r));
 const p=createRendererStreamRequester(f)({...input,signal:c.signal});const check=expect(p).rejects.toBeInstanceOf(ProviderStreamAbortError);c.abort();await check;
 finish({body:{cancel},status:200} as unknown as Response);await Promise.resolve();expect(cancel).toHaveBeenCalledOnce();expect(f).toHaveBeenCalledOnce();
});
it("body read failure rejects safe after-response error without returning partial content",async()=>{
 const f=vi.fn(async()=>response(new ReadableStream({start(c){c.enqueue(encode('private partial'));},pull(c){c.error(Error('secret URL'));}})));
 const e=await createRendererStreamRequester(f)(input).catch(e=>e as ProviderStreamNetworkError);expect(e).toBeInstanceOf(ProviderStreamNetworkError);expect(e).toMatchObject({phase:"after-response",message:"READ_FAILED"});expect(JSON.stringify(e)).not.toContain("secret");expect(f).toHaveBeenCalledOnce();
});
it.each([false,true])("idle timeout handles headers received=%s",async(headers)=>{
 vi.useFakeTimers();const f=vi.fn(()=>headers?Promise.resolve(response(new ReadableStream())):new Promise<Response>(()=>{}));
 const p=createRendererStreamRequester(f,{totalTimeoutMs:2000})(input);const check=expect(p).rejects.toMatchObject({timeoutKind:"idle",phase:headers?"after-response":"before-response"});await vi.advanceTimersByTimeAsync(1001);await check;expect(f).toHaveBeenCalledOnce();
});
it("nonempty heartbeat extends idle but total deadline still wins",async()=>{
 vi.useFakeTimers();let c!:ReadableStreamDefaultController<Uint8Array>;
 const f=vi.fn(async()=>response(new ReadableStream({start(controller){c=controller;}})));
 const p=createRendererStreamRequester(f,{totalTimeoutMs:2500})(input);const check=expect(p).rejects.toMatchObject({timeoutKind:"total",phase:"after-response"});
 await vi.advanceTimersByTimeAsync(0);for(let n=0;n<3;n++){await vi.advanceTimersByTimeAsync(700);c.enqueue(encode(': heartbeat\n\n'));await vi.advanceTimersByTimeAsync(0);}await vi.advanceTimersByTimeAsync(401);await check;expect(f).toHaveBeenCalledOnce();
});
it("honors a 3600-second request limit beyond the former 600-second deadline", async () => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn(async () => response(new ReadableStream({ start(controller) { stream = controller; } })));
  let failure: unknown;
  const pending = createRendererStreamRequester(fetcher)({ ...input, timeoutMs: 3_600_000 });
  void pending.catch(error => { failure = error; });

  await vi.advanceTimersByTimeAsync(600_001);
  expect(failure).toBeUndefined();
  stream.enqueue(encode('data: {"type":"response.completed","response":{"status":"completed","output_text":"complete"}}\n\n'));
  stream.close();

  const result = await pending;
  expect(aggregateProviderStream("openai-responses", result.body)).toMatchObject({ ok: true, value: { output_text: "complete" } });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([60_000, 3_600_000])("uses the configured total deadline of %i ms even with heartbeats", async (timeoutMs) => {
  vi.useFakeTimers();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn(async () => response(new ReadableStream({ start(controller) { stream = controller; } })));
  const pending = createRendererStreamRequester(fetcher)({ ...input, timeoutMs });
  const check = expect(pending).rejects.toMatchObject({ timeoutKind: "total", timeoutMs, phase: "after-response" });

  await vi.advanceTimersByTimeAsync(timeoutMs - 1);
  stream.enqueue(encode(": heartbeat\n\n"));
  await vi.advanceTimersByTimeAsync(1);

  await check;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("rejects late terminal bytes after the configured total deadline even when the reader ignores cancellation", async () => {
  vi.useFakeTimers();
  let finishRead!: (part: ReadableStreamReadResult<Uint8Array>) => void;
  const reader = {
    read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(resolve => { finishRead = resolve; })),
    cancel: vi.fn(async () => undefined),
    releaseLock: vi.fn(),
  };
  const body = { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
  const fetcher = vi.fn(async () => response(body));
  const succeeded = vi.fn();
  const pending = createRendererStreamRequester(fetcher)({ ...input, timeoutMs: 3_600_000 });
  void pending.then(succeeded, () => undefined);
  const check = expect(pending).rejects.toMatchObject({ timeoutKind: "total", timeoutMs: 3_600_000, phase: "after-response" });

  await vi.advanceTimersByTimeAsync(3_600_000);
  await check;
  expect(reader.cancel).toHaveBeenCalledOnce();
  finishRead({ done: false, value: encode('data: {"type":"response.completed","response":{"status":"completed","output_text":"late"}}\n\n') });
  await vi.advanceTimersByTimeAsync(0);

  expect(succeeded).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(reader.releaseLock).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("empty chunks do not extend idle",async()=>{
 vi.useFakeTimers();let c!:ReadableStreamDefaultController<Uint8Array>;const f=vi.fn(async()=>response(new ReadableStream({start(x){c=x;}})));
 const p=createRendererStreamRequester(f)(input);const check=expect(p).rejects.toBeInstanceOf(RendererStreamTimeoutError);await vi.advanceTimersByTimeAsync(700);c.enqueue(new Uint8Array());await vi.advanceTimersByTimeAsync(301);await check;
});
it("enforces size bound and never returns partial answer",async()=>{
 const f=vi.fn(async()=>response(new ReadableStream({start(c){c.enqueue(encode('too long'));c.close();}})));
 await expect(createRendererStreamRequester(f,{maxBytes:2})(input)).rejects.toMatchObject({message:"STREAM_SIZE_LIMIT"});expect(f).toHaveBeenCalledOnce();
});
it("dispose aborts the selected adapter",async()=>{
 const f=vi.fn(()=>new Promise<Response>(()=>{}));const transport=new ObsidianProviderTransport(createRendererStreamRequester(f));const p=transport.requestStream(input);const check=expect(p).rejects.toBeInstanceOf(ProviderStreamAbortError);transport.dispose();await check;expect(f).toHaveBeenCalledOnce();
});
it("rejects browser-owned headers before fetch without silently dropping them",async()=>{const f=vi.fn();await expect(createRendererStreamRequester(f)({...input,headers:{Connection:"keep-alive"}})).rejects.toBeInstanceOf(ProviderStreamNetworkError);expect(f).not.toHaveBeenCalled();});
it("EOF with no protocol completion remains uncertain in the existing parser",async()=>{
 const f=vi.fn(async()=>response(new ReadableStream({start(c){c.enqueue(encode('data: {"type":"response.output_text.delta","delta":"partial"}\n\n'));c.close();}})));
 const r=await createRendererStreamRequester(f)(input);expect(aggregateProviderStream("openai-responses",r.body)).toMatchObject({ok:false,error:{code:"E206_PROVIDER_REQUEST_UNCERTAIN"}});expect(f).toHaveBeenCalledOnce();
});

it("records relative chunk timing and byte counts without persisting body in diagnostics", async () => {
  vi.useFakeTimers(); let c!: ReadableStreamDefaultController<Uint8Array>;
  const f = vi.fn(async () => response(new ReadableStream({ start(controller) { c = controller; } })));
  const pending = createRendererStreamRequester(f)(input); await vi.advanceTimersByTimeAsync(100);
  c.enqueue(encode(": heartbeat\n\n")); await vi.advanceTimersByTimeAsync(400); c.enqueue(encode(": heartbeat\n\n")); await vi.advanceTimersByTimeAsync(0); c.close();
  const r = await pending; expect(r.diagnostics).toEqual({ chunkCount: 2, byteCount: 26, firstResponseMs: 0, firstChunkMs: 100, chunkSpanMs: 400, maxChunkGapMs: 400 });
});

it("accepts proxy-style split BOM/CRLF SSE with retry metadata without reconnecting", async () => {
  const text = '\uFEFFretry: 1500\r\n: heartbeat\r\nevent: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"完整"}\r\n\r\nevent: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n';
  const bytes = encode(text); const f = vi.fn(async () => response(new ReadableStream({ start(c) { for (let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3)); c.close(); } })));
  const r = await createRendererStreamRequester(f)(input);
  expect(aggregateProviderStream("openai-responses",r.body)).toMatchObject({ok:true,value:{output_text:"完整"}}); expect(f).toHaveBeenCalledOnce();
});

it("times out when upstream heartbeats are buffered and no bytes reach the reader", async () => {
  vi.useFakeTimers(); let upstreamWrites = 0;
  const upstream = setInterval(() => upstreamWrites++, 200);
  const f = vi.fn(async () => response(new ReadableStream()));
  const pending = createRendererStreamRequester(f, { totalTimeoutMs: 2000 })(input);
  const check = expect(pending).rejects.toMatchObject({ timeoutKind:"idle",phase:"after-response" });
  await vi.advanceTimersByTimeAsync(1001); await check; clearInterval(upstream);
  expect(upstreamWrites).toBe(5); expect(f).toHaveBeenCalledOnce();
});

it("accepts authoritative Responses completion before a later proxy disconnect", async () => {
  const f = vi.fn(async () => response(new ReadableStream({ start(c) { c.enqueue(encode('data: {"type":"response.completed","response":{"status":"completed","output_text":"already complete"}}\n\n')); }, pull(c) { c.error(Error("synthetic proxy disconnect")); } })));
  const result = await createRendererStreamRequester(f)(input);
  expect(aggregateProviderStream("openai-responses", result.body)).toMatchObject({ ok: true, value: { output_text: "already complete", status: "completed" } });
  expect(f).toHaveBeenCalledOnce();
});
