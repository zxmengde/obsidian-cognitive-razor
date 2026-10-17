/** QA-only; serialized into the temporary command, never imported by production. */
export async function rendererFetchProbe(kind, input, env) {
  const result = { schema: 'renderer-fetch-probe-v1', kind, transport: 'renderer-fetch', status: null, readable: false, chunks: 0, bytes: 0, outcome: 'NOT_STARTED', cspViolationObserved: false, phase: 'before-response', requestOutcome: 'not-dispatched' };
  const authShape = kind === 'models-auth-shape';
  if (authShape && env.syntheticStreamPassed !== true) { result.outcome = 'STREAM_GATE_REQUIRED'; return result; }
  let url;
  if (kind === 'models' || authShape) {
    try {
      const parsed = new URL(input);
      const parts = parsed.hostname.split('.');
      if (!['http:', 'https:'].includes(parsed.protocol) || parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255) || parsed.username || parsed.password || parsed.search || parsed.hash || !['/', '/v1/models'].includes(parsed.pathname)) throw Error();
      url = parsed.origin + '/v1/models';
    } catch { result.outcome = 'INVALID_IP_ORIGIN'; return result; }
  } else if (kind !== 'synthetic-stream') { result.outcome = 'INVALID_CASE'; return result; }
  if (typeof env.fetch !== 'function') { result.outcome = 'FETCH_UNAVAILABLE'; return result; }
  const controller = new AbortController();
  let timedOut = false; let idleTimedOut = false; let idleTimer; let server; let reader; let chunksTimer; let setupResolve;
  const started = Date.now();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); setupResolve?.(false); }, 10000);
  const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { idleTimedOut = true; controller.abort(); }, 2000); };
  const cancel = () => { controller.abort(); setupResolve?.(false); };
  env.signal?.addEventListener('abort', cancel, { once: true });
  if (env.signal?.aborted) cancel();
  const policy = event => { if (url && event.effectiveDirective === 'connect-src' && (event.blockedURI === url || event.blockedURI === new URL(url).origin)) result.cspViolationObserved = true; };
  env.events?.addEventListener('securitypolicyviolation', policy);
  try {
    if (controller.signal.aborted) { result.outcome = 'CANCELLED'; return result; }
    if (kind === 'synthetic-stream') {
      // One fixed loopback endpoint, synthetic bytes only, never a forwarding proxy.
      const http = env.http;
      if (typeof http?.createServer !== 'function') { result.outcome = 'FIXTURE_UNAVAILABLE'; return result; }
      let served = false;
      server = http.createServer((request, response) => {
        if (request.url !== '/qa-stream' || request.method !== 'GET' || served) { response.writeHead(404); response.end(); return; }
        served = true;
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        response.flushHeaders();
        let count = 0;
        chunksTimer = setInterval(() => { response.write(': synthetic\n\n'); if (++count === 4) { clearInterval(chunksTimer); response.end(); } }, 500);
        response.on('close', () => clearInterval(chunksTimer));
      });
      const listening = await new Promise(resolve => { setupResolve = resolve; server.once('error', () => resolve(false)); server.listen(18743, '127.0.0.1', () => resolve(true)); });
      setupResolve = undefined;
      if (!listening) { result.outcome = controller.signal.aborted ? (idleTimedOut ? 'IDLE_TIMEOUT' : timedOut ? 'TIMEOUT' : 'CANCELLED') : 'FIXTURE_START_FAILED'; return result; }
      url = 'http://127.0.0.1:18743/qa-stream';
    }
    if (controller.signal.aborted) { result.outcome = idleTimedOut ? 'IDLE_TIMEOUT' : timedOut ? 'TIMEOUT' : 'CANCELLED'; return result; }
    result.requestOutcome = 'unknown-after-dispatch';
    resetIdle();
    const response = await env.fetch(url, { ...(authShape ? { headers: { Authorization: 'Bearer cognitive-razor-invalid-qa-placeholder', 'Content-Type': 'application/json' } } : {}), method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
    if (controller.signal.aborted) { await response.body?.cancel(); result.outcome = idleTimedOut ? 'IDLE_TIMEOUT' : timedOut ? 'TIMEOUT' : 'CANCELLED'; return result; }
    result.requestOutcome = 'response-received'; result.phase = 'after-response'; resetIdle();
    result.status = response.status;
    result.readable = response.type !== 'opaque' && response.type !== 'opaqueredirect' && response.status > 0;
    if (kind === 'models' || authShape) {
      // Never read text/json/arrayBuffer/reader: only cancel unused body.
      await response.body?.cancel();
      result.outcome = result.readable ? 'HEADERS_READABLE' : 'UNREADABLE_RESPONSE';
    } else {
      if (!result.readable || response.status !== 200 || !response.body) { result.outcome = 'UNREADABLE_RESPONSE'; return result; }
      reader = response.body.getReader();
      let firstChunkAt = null; let lastChunkAt = null;
      while (!controller.signal.aborted) {
        const part = await reader.read();
        if (controller.signal.aborted) break;
        if (part.done) { result.outcome = 'STREAM_EOF'; break; }
        if (!part.value.byteLength) continue;
        resetIdle();
        result.chunks++; result.bytes += part.value.byteLength;
        firstChunkAt ??= Date.now(); lastChunkAt = Date.now();
        if (result.bytes > 65536) { result.outcome = 'SIZE_LIMIT'; controller.abort(); break; }
      }
      result.chunkSpanMs = firstChunkAt === null ? 0 : lastChunkAt - firstChunkAt;
    }
    if (controller.signal.aborted && result.outcome !== 'SIZE_LIMIT') result.outcome = idleTimedOut ? 'IDLE_TIMEOUT' : timedOut ? 'TIMEOUT' : 'CANCELLED';
  } catch {
    result.outcome = controller.signal.aborted ? (idleTimedOut ? 'IDLE_TIMEOUT' : timedOut ? 'TIMEOUT' : 'CANCELLED') : (reader ? 'READ_FAILED' : 'FETCH_REJECTED');
  } finally {
    clearTimeout(timer); clearTimeout(idleTimer); clearInterval(chunksTimer);
    controller.abort();
    env.signal?.removeEventListener('abort', cancel);
    env.events?.removeEventListener('securitypolicyviolation', policy);
    if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    if (server) { server.closeAllConnections?.(); server.close(); }
    result.durationMs = Date.now() - started;
  }
  return result;
}

export function rendererProbeCommand() {
  return `
    this.addCommand({ id: 'qa-renderer-fetch-probe', name: 'QA：Fetch 无凭据连接与合成流检查（临时）', callback: () => {
      const probe = ${rendererFetchProbe.toString()};
      const modal = new Modal(this.app); let active = null; let syntheticStreamPassed = false;
      modal.titleEl.textContent = 'QA：Fetch 无凭据检查';
      modal.contentEl.createEl('p', {text:'手动输入已授权服务的 http(s)://IPv4:端口。只 GET /v1/models，不读取设置、密钥或响应正文。401/403 可证明响应可读，不证明模型调用可用。合成流通过后可手动发送固定无效占位 Authorization 与 JSON 类型头；不会读取真实密钥或发推理请求。合成流仅访问临时 127.0.0.1:18743；若策略拒绝则停止，不绕过。'});
      const input = modal.contentEl.createEl('input'); input.placeholder = 'http://IPv4:端口'; input.type = 'text'; input.style.width = '100%';
      const models = modal.contentEl.createEl('button', {text:'单次无鉴权 GET /v1/models'});
      const synthetic = modal.contentEl.createEl('button', {text:'单次合成流（本机 fixture）'});
      const auth = modal.contentEl.createEl('button', {text:'合成流通过后：无效占位 Authorization 检查'}); auth.disabled = true;
      const cancel = modal.contentEl.createEl('button', {text:'取消当前检查'});
      const area = modal.contentEl.createEl('textarea'); area.readOnly = true; area.rows = 18; area.style.width = '100%';
      const run = async kind => {
        if (active || (kind === 'models-auth-shape' && !syntheticStreamPassed)) return; active = new AbortController(); models.disabled = synthetic.disabled = auth.disabled = true;
        area.value = '检查中，总计最多 10 秒，空闲最多 2 秒';
        let http; if (kind === 'synthetic-stream') { try { http = require('node:http'); } catch {} }
        try { const result = await probe(kind, input.value, {fetch: window.fetch?.bind(window), http, signal: active.signal, events: window, syntheticStreamPassed});
          if (kind === 'synthetic-stream') syntheticStreamPassed = result.outcome === 'STREAM_EOF' && result.chunks > 1 && result.chunkSpanMs > 0;
          area.value = JSON.stringify(result, null, 2); }
        finally { active = null; models.disabled = synthetic.disabled = false; auth.disabled = !syntheticStreamPassed; }
      };
      models.onclick = () => void run('models'); synthetic.onclick = () => void run('synthetic-stream');
      auth.onclick = () => void run('models-auth-shape');
      cancel.onclick = () => active?.abort(); modal.onClose = () => active?.abort(); modal.open();
    }});`;
}
