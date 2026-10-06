/** Explicit renderer transport; never selected by runtime failure or provider guessing. */
import { createResponsesStreamCompletionTracker, ProviderStreamAbortError, ProviderStreamNetworkError, ProviderStreamTimeoutError, readProviderStreamUsage } from "./provider-streaming";
import type { ProviderStreamDiagnostics, ProviderStreamPhase, ProviderStreamRequester, ProviderStreamResponse } from "./provider-streaming";
import type { ProviderTokenUsage } from "./provider-token-usage";

/** Optional diagnostics contain no request, headers, response text or opaque state. */
export interface RendererStreamObservation {
  /** Reader lifecycle only: a completed reader does not prove model success. */
  stage: "headers" | "progress" | "completed" | "failed";
  phase: ProviderStreamPhase;
  httpStatus: number | null;
  responseContentType: "text/event-stream" | "application/json" | "application/x-ndjson" | "unknown";
  framing: "SSE" | "JSON" | "unknown";
  elapsedMs: number;
  diagnostics: Omit<ProviderStreamDiagnostics, "firstResponseMs"> & { firstResponseMs: number | null };
  timeoutKind?: "idle" | "total";
  /** A partial stream can report usage without proving the final request outcome. */
  observedUsage?: ProviderTokenUsage;
}

export class RendererStreamTimeoutError extends ProviderStreamTimeoutError {
  constructor(ms: number, phase: ProviderStreamPhase, readonly timeoutKind: "idle" | "total") { super(ms, phase); }
}

export function createRendererStreamRequester(
  fetcher: typeof window.fetch,
  limits: { totalTimeoutMs?: number; maxBytes?: number; onEvidence?: (value: RendererStreamObservation) => void } = {},
): ProviderStreamRequester {
  return (input) => new Promise<ProviderStreamResponse>((resolve, reject) => {
    if (input.signal?.aborted) { reject(new ProviderStreamAbortError("cancelled")); return; }
    const controller = new AbortController();
    const startedAt = Date.now();
    let firstResponseMs = 0; let firstChunkMs: number | null = null; let lastChunkMs = 0; let maxChunkGapMs = 0; let chunkCount = 0;
    let phase: ProviderStreamPhase = "before-response";
    let httpStatus: number | null = null;
    let responseContentType: RendererStreamObservation["responseContentType"] = "unknown";
    let body = ""; let bytes = 0;
    const observe = (stage: RendererStreamObservation["stage"], error?: Error) => {
      if (!limits.onEvidence) return;
      try {
      let framing: RendererStreamObservation["framing"] = "unknown";
      if (/^\s*(?:data|event|id|retry):|^\s*:/m.test(body)) framing = "SSE";
      else if (stage === "completed") { try { JSON.parse(body); framing = "JSON"; } catch { /* Unknown framing stays unknown. */ } }
      const value: RendererStreamObservation = {
        stage, phase, httpStatus, responseContentType, framing, elapsedMs: Date.now() - startedAt,
        diagnostics: { chunkCount, byteCount: bytes, firstResponseMs: httpStatus === null ? null : firstResponseMs, firstChunkMs, chunkSpanMs: firstChunkMs === null ? 0 : lastChunkMs - firstChunkMs, maxChunkGapMs },
        ...(error instanceof RendererStreamTimeoutError ? { timeoutKind: error.timeoutKind } : {}),
        ...(stage === "failed" && input.protocol && httpStatus !== null && httpStatus >= 200 && httpStatus < 300 && framing === "SSE"
          ? { observedUsage: readProviderStreamUsage(input.protocol, body) } : {}),
      };
      limits.onEvidence(value);
      } catch { /* Observation cannot change timeout, bytes, completion or retry semantics. */ }
    };
    let settled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let total: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(idle); clearTimeout(total); input.signal?.removeEventListener("abort", abort); };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; cleanup(); observe("failed", error); controller.abort();
      void reader?.cancel().catch(() => undefined);
      reject(error);
    };
    const abort = () => fail(new ProviderStreamAbortError("cancelled"));
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => fail(new RendererStreamTimeoutError(input.timeoutMs, phase, "idle")), input.timeoutMs);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) { abort(); return; }
    void (async () => {
      try {
        const url = new URL(input.url);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error();
        // Browser-owned headers must not silently disappear. Never copy Node's
        // Connection/Accept-Encoding defaults into a renderer request.
        const forbidden = /^(?:accept-charset|accept-encoding|access-control-request-.*|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|set-cookie|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*)$/i;
        if (Object.keys(input.headers).some(key => forbidden.test(key))) throw Error();
        resetIdle();
        // Production requests use the configured network limit. An explicit
        // override is reserved for bounded probes and adapter tests.
        const totalMs = limits.totalTimeoutMs ?? input.timeoutMs;
        total = setTimeout(() => fail(new RendererStreamTimeoutError(totalMs, phase, "total")), totalMs);
        const response = await fetcher(input.url, {
          method: "POST", headers: { ...input.headers, Accept: "text/event-stream" }, body: input.body,
          mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        });
        if (settled) { void response.body?.cancel().catch(() => undefined); return; }
        firstResponseMs = Date.now() - startedAt;
        phase = "after-response"; resetIdle();
        httpStatus = response.status;
        if (limits.onEvidence) {
          try {
            const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
            if (mime === "text/event-stream" || mime === "application/json" || mime === "application/x-ndjson") responseContentType = mime;
          } catch { /* Additional MIME observation must not affect the request. */ }
        }
        observe("headers");
        if (response.type === "opaque" || response.type === "opaqueredirect" || response.status === 0 || !response.body) throw Error();
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const terminal = createResponsesStreamCompletionTracker(input.protocol);
        let terminalReached = false;
        while (!settled) {
          const part = await reader.read();
          if (settled) return;
          if (part.done) break;
          if (!part.value.byteLength) continue;
          const chunkMs = Date.now() - startedAt;
          if (firstChunkMs !== null) maxChunkGapMs = Math.max(maxChunkGapMs, chunkMs - lastChunkMs);
          firstChunkMs ??= chunkMs; lastChunkMs = chunkMs; chunkCount++;
          bytes += part.value.byteLength;
          if (bytes > (limits.maxBytes ?? 8 * 1024 * 1024)) { fail(new ProviderStreamNetworkError(phase, "STREAM_SIZE_LIMIT")); return; }
          resetIdle();
          const text = decoder.decode(part.value, { stream: true });
          body += text;
          observe("progress");
          const end = terminal?.(text);
          if (end !== undefined && response.status >= 200 && response.status < 300) {
            terminalReached = true;
            body = body.slice(0, end);
            void reader.cancel().catch(() => undefined);
            break;
          }
        }
        if (settled) return;
        // A terminal boundary already ends in a complete UTF-8 frame.
        // Otherwise preserve the ordinary EOF decoder flush.
        if (!terminalReached) body += decoder.decode();
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        settled = true; cleanup(); observe("completed");
        if (terminalReached) controller.abort();
        resolve({ status: response.status, headers, body, diagnostics: { chunkCount, byteCount: bytes, firstResponseMs, firstChunkMs, chunkSpanMs: firstChunkMs === null ? 0 : lastChunkMs - firstChunkMs, maxChunkGapMs } });
      } catch {
        fail(new ProviderStreamNetworkError(phase, phase === "before-response" ? "FETCH_REJECTED" : "READ_FAILED"));
      } finally {
        try { reader?.releaseLock(); } catch { /* Pending read settles after abort. */ }
      }
    })();
  });
}
