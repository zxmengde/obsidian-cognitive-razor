/* One-shot DevTools expression. Returns only allowlisted metadata; makes no
 * requests, reads no plugin settings, and never accesses proxy addresses.
 * Paste the complete expression into the TEST VAULT's renderer console.
 * This is a diagnostic, not a transport implementation or network probe. */
(() => {
  const get = (object, key) => {
    try { return object == null ? undefined : object[key]; } catch { return undefined; }
  };
  const version = value => typeof value === 'string' && /^\d{1,3}\.\d{1,3}(?:\.\d{1,4})?(?:-[A-Za-z0-9.-]{1,32})?$/.test(value) ? value : 'unknown';
  const load = name => {
    try { return typeof require === 'function' ? require(name) : undefined; } catch { return undefined; }
  };
  const runtime = typeof process === 'object' ? process : undefined;
  const versions = get(runtime, 'versions');
  const rawType = get(runtime, 'type');
  const processType = ['browser', 'renderer', 'utility', 'worker'].includes(rawType) ? rawType : 'unknown';
  const obsidian = load('obsidian');
  const electron = load('electron');
  const net = get(electron, 'net');
  const http = load('http');
  const https = load('https');
  const requestPresent = typeof get(net, 'request') === 'function';
  const fetchPresent = typeof get(net, 'fetch') === 'function';
  const documentedElectronNetProcess = processType === 'browser' || processType === 'utility';
  // Exactly one non-secret opt-in flag. Do not enumerate env or inspect
  // HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY, argv, agents or session config.
  const env = get(runtime, 'env');
  let flagKnown = false;
  let flagEnabled = false;
  try {
    if (env) { flagEnabled = env.NODE_USE_ENV_PROXY === '1'; flagKnown = true; }
  } catch { /* No raw error or value is returned. */ }
  return JSON.stringify({
    schema: 'cognitive-razor-host-transport-v1',
    versions: {
      node: version(get(versions, 'node')),
      electron: version(get(versions, 'electron')),
      obsidianApi: version(get(obsidian, 'apiVersion')),
    },
    processType,
    capabilities: {
      obsidianRequestUrlPresent: typeof get(obsidian, 'requestUrl') === 'function',
      nodeHttpRequestPresent: typeof get(http, 'request') === 'function',
      nodeHttpsRequestPresent: typeof get(https, 'request') === 'function',
      electronNetRequestPresent: requestPresent,
      electronNetFetchPresent: fetchPresent,
      electronNetDocumentedProcess: documentedElectronNetProcess,
      electronNetCandidate: documentedElectronNetProcess && (requestPresent || fetchPresent),
      rendererFetchPresent: processType === 'renderer' && typeof globalThis.fetch === 'function',
      readableStreamPresent: typeof globalThis.ReadableStream === 'function',
      responseBodyApiPresent: typeof globalThis.Response === 'function' && 'body' in globalThis.Response.prototype,
    },
    proxy: {
      nodeEnvOptInFlagKnown: flagKnown,
      nodeEnvOptInFlagEnabled: flagEnabled,
      effectiveNodeProxyKnown: false,
      effectiveChromiumProxyKnown: false,
    },
  }, null, 2);
})()
