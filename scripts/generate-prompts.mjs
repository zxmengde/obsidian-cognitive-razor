/** Export requests through the product executors and an offline transport. 
 * node scripts/generate-prompts.mjs --settings <fixture.json> --output <directory>
*/
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, unlink, open, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "tmp/prompts");
const digest = text => createHash("sha256").update(text).digest("hex");
function git(...args) {
  try { return execFileSync("git", ["-c", `safe.directory=${ROOT.replaceAll("\\", "/")}`, "--no-optional-locks", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}
async function optionalFile(path) {
  try { return await readFile(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function safeUrl(value) {
  const url = new URL(value);
  url.username = ""; url.password = ""; url.search = ""; url.hash = "";
  return url.toString();
}
function settingsSummary(runtime, settings, taskType) {
  const snapshot = runtime.resolveTaskModelSnapshot(settings, taskType);
  const { providerSnapshot, ...summary } = snapshot;
  return { ...summary, apiFormat: providerSnapshot?.apiFormat, providerEnabled: providerSnapshot?.enabled,
    authentication: "omitted; real credentials are never given to the export harness",
    ...(providerSnapshot?.baseUrl ? { endpointWithoutCredentialsOrQuery: safeUrl(providerSnapshot.baseUrl) } : {}) };
}

/** Display sections come from captured wire fields, never a parallel renderer. */
export function renderCapturedRequest(id, fixture, body) {
  const sections = [];
  function text(label, value) {
    if (typeof value === "string") sections.push(`### ${label}\n\n${value}`);
    else if (Array.isArray(value)) value.forEach((item, i) => {
      if (typeof item === "string") text(`${label}[${i}]`, item);
      else if (item && typeof item === "object") {
        if (typeof item.text === "string") text(`${label}[${i}].text`, item.text);
        else if (item.content !== undefined) text(`${label}[${i}] (${item.role ?? item.type ?? "item"}).content`, item.content);
        else if (item.parts !== undefined) text(`${label}[${i}] (${item.role ?? "item"}).parts`, item.parts);
        else sections.push(`### ${label}[${i}]\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``);
      }
    });
    else if (value?.parts) text(`${label}.parts`, value.parts);
    else if (value !== undefined) sections.push(`### ${label}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
  }
  for (const field of ["instructions", "messages", "input", "systemInstruction", "contents"]) {
    if (body[field] !== undefined) text(field, body[field]);
  }
  const controls = Object.fromEntries(Object.entries(body).filter(([key]) => !["instructions", "messages", "input", "systemInstruction", "contents"].includes(key)));
  return `# ${id} — 生产发送边界的离线截获\n\n${fixture}\n\n未发送网络请求；没有模型回答、缓存命中或服务端续接验证。认证信息省略。\n\n${sections.join("\n\n")}\n\n### Schema、工具和其它实际请求字段\n\n\`\`\`json\n${JSON.stringify(controls, null, 2)}\n\`\`\`\n\n原始请求正文：[api-payload-${id}.json](api-payload-${id}.json)\n`;
}

export async function compileRuntime() {
  // Dependency loading is inside main's invalidated-output failure boundary.
  const { build } = await import("esbuild");
  const temporary = join(tmpdir(), `cognitive-razor-prompt-export-${randomUUID()}.mjs`);
  const result = await build({ entryPoints: [join(ROOT, "scripts/prompt-export-runtime.ts")], bundle: true, platform: "node", format: "esm",
    target: "es2022", write: false, metafile: true, logLevel: "silent", alias: { obsidian: join(ROOT, "__mocks__/obsidian.ts") },
    banner: { js: 'import { createRequire as __exportCreateRequire } from "node:module"; const require = __exportCreateRequire(import.meta.url);' } });
  const sourceFiles = Object.keys(result.metafile.inputs).filter(path => /^(src|scripts|__mocks__)[/\\]/.test(path)).sort();
  const sources = [];
  for (const path of sourceFiles) sources.push([path.replaceAll("\\", "/"), digest(await readFile(join(ROOT, path)))]);
  sources.push(["scripts/generate-prompts.mjs", digest(await readFile(fileURLToPath(import.meta.url)))]);
  await writeFile(temporary, result.outputFiles[0].text);
  try { return { runtime: await import(pathToFileURL(temporary).href), sourceDigest: digest(JSON.stringify(sources)), sourceFiles: sources }; }
  finally { await unlink(temporary); }
}

const GENERATOR = "cognitive-razor-prompt-export/v1";
const CAPTURE_MODE = "offline production transport capture; no upstream response or delivery";
const artifactName = /^(?:api-payload-[a-z][a-z0-9-]*\.json|prompt-[a-z][a-z0-9-]*\.md)$/;
class ExportFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function errorCode(error) {
  // Never publish raw compiler, filesystem, provider or parser messages.
  return error instanceof ExportFailure ? error.code : /\bE\d{3}_[A-Z_]{1,60}\b/.exec(String(error?.message))?.[0] ?? "E_EXPORT_FAILED";
}
function credentialGuard(text, secrets) {
  for (const secret of secrets) {
    if (secret.length >= 8 && (text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1)))) throw new ExportFailure("E_EXPORT_CREDENTIAL_DETECTED");
    // A one-character key naturally occurs in prose/JSON. Detect it in auth
    // contexts rather than reject every incidental occurrence of that letter.
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:Bearer\\s+|(?:api[_-]?key|authorization|x-api-key)[\\s"'\\\\:=]+(?:Bearer\\s+)?)["']?${escaped}(?=[\\s"'\\\\,;}]|$)`, "i").test(text)) {
      throw new ExportFailure("E_EXPORT_CREDENTIAL_DETECTED");
    }
  }
}
function ownedArtifacts(index) {
  const valid = item => item && artifactName.test(item.path) && /^[a-f0-9]{64}$/.test(item.sha256);
  return index?.generator === GENERATOR ? (Array.isArray(index.managedFiles) ? index.managedFiles : []).filter(valid) : [];
}
async function cleanOwned(outputDir, files, preserved) {
  for (const file of files) {
    const bytes = await optionalFile(join(outputDir, file.path));
    if (bytes && digest(bytes) === file.sha256) await unlink(join(outputDir, file.path));
    else if (bytes) preserved.add(file.path);
  }
}
async function writeIndex(outputDir, index) {
  const temporary = join(outputDir, `.prompt-export-index-${index.runId}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(index, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, join(outputDir, "index.json"));
  } finally {
    try { await unlink(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

/** 导出必须指定设置文件，避免隐式读取日常库配置。 */
export async function main({ outputDir = OUTPUT_DIR, settingsPath, templateRoot = ROOT,
  compile = compileRuntime, log = console } = {}) {
  if (!settingsPath) throw new ExportFailure("E_EXPORT_SETTINGS_REQUIRED");
  await mkdir(outputDir, { recursive: true });
  const lockPath = join(outputDir, ".prompt-export.lock");
  const lock = await open(lockPath, "wx"); // Do not race another export's ownership/index.
  const base = { generator: GENERATOR, runId: randomUUID(), generatedAt: new Date().toISOString(), captureMode: CAPTURE_MODE };
  let stage = "invalidate", ownsIndex = false, managedFiles = [];
  const preserved = new Set();
  try {
    const previousBytes = await optionalFile(join(outputDir, "index.json"));
    let previous;
    try { previous = previousBytes && JSON.parse(previousBytes.toString("utf8")); }
    catch { throw new ExportFailure("E_EXPORT_OUTPUT_COLLISION"); }
    if (previousBytes && previous?.generator !== GENERATOR) throw new ExportFailure("E_EXPORT_OUTPUT_COLLISION");
    managedFiles = ownedArtifacts(previous);
    await writeIndex(outputDir, { ...base, status: "running", managedFiles, tasks: [] });
    ownsIndex = true;
    await cleanOwned(outputDir, managedFiles, preserved);
    managedFiles = [];
    stage = "compile";
    const { runtime, sourceDigest, sourceFiles } = await compile();
    stage = "settings";
    const data = await optionalFile(settingsPath);
    let raw;
    try { raw = data === null ? null : JSON.parse(data.toString("utf8")); }
    catch { throw new ExportFailure("E_EXPORT_SETTINGS_JSON"); }
    const secrets = Object.values(raw?.providers ?? {}).flatMap(p => typeof p?.apiKey === "string" ? [p.apiKey, p.apiKey.trim()] : []).filter(Boolean);
    const settingsStore = await runtime.loadExportSettings(raw);
    raw = undefined;
    const settings = settingsStore.getSettings();
    const templates = new Map();
    stage = "templates";
    const promptManager = await runtime.createExportPromptManager(async relative => {
      const content = await readFile(join(templateRoot, relative), "utf8");
      templates.set(relative, digest(content));
      return content;
    });
    stage = "provenance";
    const bundle = await optionalFile(join(ROOT, "main.js"));
    const examples = runtime.createPromptExamples(settings);
    const provenance = {
      gitHead: git("rev-parse", "HEAD"), workingTree: git("status", "--short"),
      promptVersion: runtime.PROMPT_VERSION, sourceDigest, sourceFiles,
      installedMainJsSha256: bundle === null ? null : digest(bundle),
      runtimeVersion: "current source compiled for this export; installed/loaded main.js equivalence is not verified",
      settingsSource: data === null ? "specified settings file absent; production defaults" : "explicit settings file; request fields only; credentials excluded",
      settings: Object.fromEntries([...new Set(examples.map(example => example.taskType))].map(type => [type, settingsSummary(runtime, settings, type)])),
      streaming: { enabled: settings.enableStreamingKeepalive, transport: settings.streamingTransport, timeoutMs: settings.providerTimeoutMs },
      limitations: ["No upstream call, model answer, search execution, cache hit or real continuation is asserted.",
        "History examples contain labelled fixture history, source URLs and response IDs, never real upstream state.",
        "Exports represent new attempts under current disk settings; active attempts/local result replay and workflow input/history snapshots can differ.",
        "The installed Obsidian runtime may retain older code or cached templates; this command never reloads it.",
        "Index/embedding is not a prompt task and is not exported."],
    };
    credentialGuard(JSON.stringify(provenance), secrets);
    stage = "capture";
    const tasks = [];
    for (const example of examples) {
      const start = managedFiles.length;
      try {
        if (!/^[a-z][a-z0-9-]*$/.test(example.id)) throw new ExportFailure("E_EXPORT_ARTIFACT_NAME");
        const capture = await runtime.capturePromptExample(example, { settingsStore, promptManager });
        const body = JSON.parse(capture.wire.body);
        const markdown = renderCapturedRequest(example.id, example.fixture, body);
        const task = { id: example.id, taskType: example.taskType, fixture: example.fixture, ok: true,
          method: capture.wire.method, endpointWithoutCredentialsOrQuery: safeUrl(capture.wire.url),
          streaming: capture.wire.streaming, transport: capture.wire.transport, bodySha256: digest(capture.wire.body),
          payload: `api-payload-${example.id}.json`, markdown: `prompt-${example.id}.md` };
        for (const text of [capture.wire.body, markdown, JSON.stringify(task)]) credentialGuard(text, secrets);
        for (const [path, text] of [[task.payload, capture.wire.body], [task.markdown, markdown]]) {
          // Existing unowned/edited files must never be overwritten or deleted.
          let file;
          try { file = await open(join(outputDir, path), "wx"); }
          catch (error) { if (error.code === "EEXIST") { preserved.add(path); throw new ExportFailure("E_EXPORT_OUTPUT_COLLISION"); } throw error; }
          try { await file.writeFile(text, "utf8"); }
          catch (error) { await file.close(); await unlink(join(outputDir, path)); throw error; }
          await file.close();
          managedFiles.push({ path, sha256: digest(text) });
        }
        // Persist ownership per pair so a crash cannot leave a stale success index.
        await writeIndex(outputDir, { ...base, status: "running", managedFiles, tasks: [] });
        tasks.push(task);
        log.log(`✓ ${example.id}`);
      } catch (error) {
        await cleanOwned(outputDir, managedFiles.splice(start), preserved);
        tasks.push({ id: example.id, taskType: example.taskType, fixture: example.fixture, ok: false, error: errorCode(error) });
        log.error(`✗ ${example.id}: ${errorCode(error)}`);
      }
    }
    stage = "index";
    const failed = tasks.filter(task => !task.ok).length;
    const index = { ...base, ...provenance, status: failed ? "failed" : "complete", templates: Object.fromEntries([...templates].sort()),
      managedFiles, preservedArtifacts: [...preserved].sort(), tasks };
    credentialGuard(JSON.stringify(index), secrets);
    await writeIndex(outputDir, index);
    log.log(`输出：${outputDir}；${tasks.length - failed} 成功，${failed} 失败；网络请求 0`);
    return index;
  } catch (error) {
    if (!ownsIndex) throw error; // A foreign index is never replaced.
    await cleanOwned(outputDir, managedFiles, preserved);
    const index = { ...base, status: "failed", failure: { stage, code: errorCode(error) },
      managedFiles: [], preservedArtifacts: [...preserved].sort(), tasks: [] };
    await writeIndex(outputDir, index);
    log.error(`离线导出失败 (${stage}/${errorCode(error)})；未发网络请求。`);
    return index;
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [settingsFlag, settingsPath, outputFlag, outputDir] = process.argv.slice(2);
  if (process.argv.length !== 6 || settingsFlag !== "--settings" || !settingsPath || outputFlag !== "--output" || !outputDir) {
    console.error("用法：node scripts/generate-prompts.mjs --settings <合成配置文件> --output <输出目录>"); process.exitCode = 1;
  }
  else main({ settingsPath: resolve(settingsPath), outputDir: resolve(outputDir) }).then(index => { if (index.status !== "complete") process.exitCode = 1; })
    .catch(() => { console.error("离线导出失败；请检查输出目录权限或已有文件冲突。未发网络请求，错误详情不会输出凭据。"); process.exitCode = 1; });
}
