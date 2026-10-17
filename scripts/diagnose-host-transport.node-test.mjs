import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(new URL('./diagnose-host-transport.js', import.meta.url), 'utf8');
const forbidden = () => { throw new Error('secret URL/key must never be accessed'); };
function fixture(type = 'renderer', flag = undefined) {
  const readKeys = []; const imports = []; let requestCalls = 0;
  const request = () => { requestCalls++; throw Error('network prohibited'); };
  const modules = {
    obsidian: { apiVersion: '1.13.1', requestUrl: request },
    electron: { net: { request, fetch: request }, get remote() { return forbidden(); }, get session() { return forbidden(); } },
    http: { request, get globalAgent() { return forbidden(); } },
    https: { request, get globalAgent() { return forbidden(); } },
  };
  const process = { type, versions: { node: '24.19.0', electron: '43.0.0' }, get argv() { return forbidden(); }, get execArgv() { return forbidden(); }, env: new Proxy({}, { get(_o, key) { readKeys.push(key); if (key !== 'NODE_USE_ENV_PROXY') forbidden(); return flag; }, ownKeys: forbidden }) };
  const context = { process, require(name) { imports.push(name); assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, fetch: request, ReadableStream: function () {}, Response: function () {} };
  Object.defineProperty(context.Response.prototype, 'body', { get: forbidden });
  const run = () => JSON.parse(runInNewContext(script, context, { timeout: 100 }));
  return { context, run, readKeys, imports, get requestCalls() { return requestCalls; } };
}
test('renderer presence never implies supported Electron net; no request or proxy secret reads', () => {
  const f = fixture('renderer', '1'); const report = f.run();
  assert.equal(report.capabilities.electronNetRequestPresent, true);
  assert.equal(report.capabilities.electronNetCandidate, false);
  assert.equal(report.proxy.nodeEnvOptInFlagEnabled, true);
  assert.equal(report.proxy.effectiveNodeProxyKnown, false);
  assert.equal(report.proxy.effectiveChromiumProxyKnown, false);
  assert.deepEqual(f.readKeys, ['NODE_USE_ENV_PROXY']);
  assert.deepEqual(f.imports, ['obsidian', 'electron', 'http', 'https']);
  assert.equal(f.requestCalls, 0);
});
test('main/utility candidate detection is observational only and does not call net', () => {
  for (const type of ['browser', 'utility']) {
    const f = fixture(type); const report = f.run();
    assert.equal(report.capabilities.electronNetCandidate, true);
    assert.equal(report.proxy.nodeEnvOptInFlagEnabled, false);
    assert.equal(f.requestCalls, 0);
  }
});
test('missing require/process emits unknown metadata, not a connectivity verdict', () => {
  const report = JSON.parse(runInNewContext(script, {}, { timeout: 100 }));
  assert.equal(report.versions.node, 'unknown');
  assert.equal(report.processType, 'unknown');
  assert.equal(report.capabilities.nodeHttpRequestPresent, false);
  assert.equal(report.proxy.nodeEnvOptInFlagKnown, false);
});
test('module/getter failures and arbitrary version text cannot leak into output', () => {
  const f = fixture('secret process text', 'secret flag value');
  f.context.process.versions.node = 'https://user:secret@proxy.invalid';
  f.context.process.versions.electron = 'secret';
  f.context.require = () => { throw Error('secret stack/path/address'); };
  const report = f.run();
  assert.equal(report.processType, 'unknown');
  assert.equal(report.versions.node, 'unknown');
  assert.equal(report.proxy.nodeEnvOptInFlagEnabled, false);
  assert.ok(!JSON.stringify(report).includes('secret'));
});
test('an inaccessible opt-in flag is unknown rather than known disabled', () => {
  const f = fixture(); f.context.process.env = new Proxy({}, { get: forbidden });
  const report = f.run();
  assert.equal(report.proxy.nodeEnvOptInFlagKnown, false);
  assert.equal(report.proxy.effectiveNodeProxyKnown, false);
});
