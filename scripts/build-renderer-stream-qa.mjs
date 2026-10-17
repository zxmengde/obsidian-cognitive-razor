/** Isolated QA build: inject one read-only command without editing main.ts. */
import { build } from 'esbuild';
import builtins from 'builtin-modules';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { hostDiagnosticCommand } from './host-diagnostic-command.mjs';
import { rendererProbeCommand } from './renderer-fetch-probe.mjs';
import { transformQaProviderManager, qaRendererCommand } from './qa-renderer-transform.mjs';
const out = path.resolve(process.argv[2] || '/tmp/cognitive-razor-host-diagnostic');
await mkdir(out, { recursive: true });
const script = await readFile('scripts/diagnose-host-transport.js', 'utf8');
const original = await readFile('main.ts', 'utf8');
const marker = '    new CommandDispatcher(this).registerAllCommands();';
if (original.split(marker).length !== 2 || !original.includes('import { Plugin } from "obsidian";')) throw Error('Unexpected entry point; no build emitted');
const injected = original.replace('import { Plugin } from "obsidian";', 'import { Plugin, Modal, Notice } from "obsidian";\nimport { armQaRendererStream } from "./src/core/qa-renderer-selection";').replace(marker, marker + hostDiagnosticCommand(script) + rendererProbeCommand() + qaRendererCommand());
await build({
  entryPoints: ['main.ts'], bundle: true, format: 'cjs', target: 'es2022', minify: true,
  outfile: path.join(out, 'main.js'),
  external: ['obsidian','electron','@codemirror/autocomplete','@codemirror/collab','@codemirror/commands','@codemirror/language','@codemirror/lint','@codemirror/search','@codemirror/state','@codemirror/view','@lezer/common','@lezer/highlight','@lezer/lr',...builtins],
  alias: {'@':'./src'}, mainFields:['svelte','browser','module','main'], conditions:['svelte','browser'],
  plugins: [{ name:'qa-command-injection', setup(builder) { builder.onLoad({filter:/[/\\]provider-manager\.ts$/}, async args => ({contents:transformQaProviderManager(await readFile(args.path,'utf8')),loader:'ts',resolveDir:path.dirname(args.path)})); builder.onLoad({filter:/[/\\]main\.ts$/}, args => args.path === path.resolve('main.ts') ? {contents:injected,loader:'ts',resolveDir:process.cwd()} : undefined); } }, sveltePlugin({preprocess:sveltePreprocess(),compilerOptions:{css:'injected'}})],
});
await copyFile('styles.css', path.join(out, 'styles.css'));
const manifest = JSON.parse(await readFile('manifest.json','utf8'));
manifest.name += ' [QA renderer stream only]';
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
await writeFile(path.join(out, 'QA-README.txt'), '临时诊断构建，不是最终生产包。仅专用测试库使用。\n确认无活跃任务后替换该测试库同 ID 插件的 main.js/styles.css/manifest.json 并重载。保留原 data.json、prompts 和用户笔记；不要覆盖它们。\n在命令面板执行 Cognitive Razor: QA：只读宿主传输诊断（临时），仅回传弹窗 JSON。无需开启流式或再次调用模型。\n测试结束换回 production 构建；生产构建没有此命令。诊断命令自身不读取 provider 配置、代理地址或凭据，不发请求，不修改系统配置。\n');
await writeFile(path.join(out, 'FETCH-PROBE-README.txt'), '临时 QA 命令：QA：Fetch 无凭据连接与合成流检查（临时）。\n在专用测试库正常命令面板启动；手动输入已授权 IPv4 服务 origin，点击单次 GET。不会读取已有 provider 配置或密钥，不会读取模型列表正文。\n另一按钮启动临时127.0.0.1:18743固定合成流并用renderer fetch读取计数；只证明该宿主对本地fixture的行为。最多10秒，关闭弹窗或取消即中止。端口冲突或策略拒绝原样报告，不改端口/代理/CSP/TLS。\n仅回传白名单JSON。HEADERS_READABLE加401/403证明无鉴权响应可读，不证明带Authorization的CORS预检成功。STREAM_EOF且chunks>1、chunkSpanMs>0才支持逐块交付。FETCH_REJECTED不能细分CORS/CSP/网络原因；未捕获CSP事件也不证明无CSP限制。\n生产transport和设置不变；结束后恢复生产包。\n');
await writeFile(path.join(out, 'QA-README.txt'), await readFile('docs/RENDERER_STREAM_QA_HANDOFF.md', 'utf8'));
console.log(out);
