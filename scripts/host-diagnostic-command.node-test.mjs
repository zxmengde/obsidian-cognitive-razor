import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { hostDiagnosticCommand } from './host-diagnostic-command.mjs';
const script = readFileSync(new URL('./diagnose-host-transport.js', import.meta.url), 'utf8');
test('QA command registers lazily and shows only read-only JSON with no provider or request access', () => {
  let command; let modal; let flagReads = 0; let requests = 0;
  const request = () => { requests++; throw Error('No requests allowed'); };
  const plugin = { app: {}, addCommand(value) { command = value; }, get settingsStore() { throw Error('No provider settings allowed'); } };
  class Modal {
    constructor(app) { assert.equal(app, plugin.app); modal = this; this.titleEl = {}; this.elements = []; this.contentEl = { createEl: (tag, options) => { const el = {tag,options,style:{},setAttribute(){},focus(){},select(){}}; this.elements.push(el); return el; } }; }
    open() { this.opened = true; }
  }
  runInNewContext(`(function(){${hostDiagnosticCommand(script)}}).call(plugin)`, { plugin, Modal, process:{type:'renderer',versions:{node:'24.19.0',electron:'43.0.0'},env:{get NODE_USE_ENV_PROXY(){ flagReads++;return '1'; }}}, require(name){ assert.ok(['obsidian','electron','http','https'].includes(name));return name==='obsidian'?{apiVersion:'1.13.1',requestUrl:request}:{request}; } }, {timeout:100});
  assert.equal(flagReads,0); assert.equal(modal,undefined);
  command.callback();
  const area=modal.elements.find(el=>el.tag==='textarea');
  assert.equal(area.readOnly,true); assert.equal(modal.opened,true);
  assert.equal(JSON.parse(area.value).processType,'renderer');
  assert.equal(flagReads,1); assert.equal(requests,0);
  assert.equal(command.id,'qa-read-only-host-transport');
});
