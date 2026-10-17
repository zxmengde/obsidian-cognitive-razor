/** Real main() file lifecycle tests; only synthetic data under OS tmpdir. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { compileRuntime, main, renderCapturedRequest } from "./generate-prompts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = value => createHash("sha256").update(value).digest("hex");
let compiled, temporary, defaults, networkAttempts = 0, originalFetch;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "cognitive-razor-export-main-test-"));
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden in offline tests"); };
  compiled = await compileRuntime(); // Real esbuild/source bundle, once and serially.
  defaults = (await compiled.runtime.loadExportSettings(null)).getSettings();
});
after(async () => {
  globalThis.fetch = originalFetch;
  assert.equal(networkAttempts, 0);
  // Never delete a computed target unless it is our unique, named temp subtree.
  const target = resolve(temporary), parent = resolve(tmpdir());
  assert.ok(target.startsWith(parent + sep) && target.slice(parent.length + 1).startsWith("cognitive-razor-export-main-test-"));
  await rm(target, { recursive: true, force: true });
});
function settings(key = "synthetic-secret-not-a-real-credential") {
  return { ...structuredClone(defaults), defaultProviderId: "fixture", providers: { fixture: {
    apiKey: key, baseUrl: "https://example.test/custom/v1", apiFormat: "openai-responses", embeddingApiFormat: "disabled",
    defaultChatModel: "fixture-model", defaultEmbedModel: "", enabled: true,
    capabilities: { temperature: true, topP: true, reasoning: true, nativeWebSearch: false, promptCaching: false, responseContinuation: false },
    parameters: { temperature: 0.4, maxTokens: 3210, reasoning_effort: "high" },
  } } };
}
async function fixture(name, data = settings()) {
  const dir = join(temporary, name);
  await mkdir(dir);
  const settingsPath = join(dir, "data.json"), outputDir = join(dir, "output");
  await writeFile(settingsPath, JSON.stringify(data));
  const messages = [];
  return { dir, data, settingsPath, outputDir, compile: async () => compiled,
    log: { log: message => messages.push(message), error: message => messages.push(message) }, messages };
}
const indexFile = f => join(f.outputDir, "index.json");
test("requires an explicit settings file before creating output or compiling", async () => {
  const outputDir = join(temporary, "no-implicit-settings");
  let compiled = false;
  await assert.rejects(main({ outputDir, compile: async () => { compiled = true; throw new Error("unexpected compile"); } }), /E_EXPORT_SETTINGS_REQUIRED/);
  assert.equal(compiled, false);
  await assert.rejects(readdir(outputDir), { code: "ENOENT" });
});
const readIndex = async f => JSON.parse(await readFile(indexFile(f), "utf8"));
async function assertEmptyFailed(f, stage) {
  const index = await readIndex(f);
  assert.equal(index.status, "failed");
  assert.equal(index.failure.stage, stage);
  assert.deepEqual(index.tasks, []);
  assert.deepEqual(index.managedFiles, []);
  assert.deepEqual(await readdir(f.outputDir), ["index.json"]);
  assert.ok(!JSON.stringify(index).includes(f.data.providers.fixture.apiKey));
  return index;
}

test("real main saves exact payload bytes, Markdown, source hashes and ownership without credentials", async () => {
  const f = await fixture("success");
  // URL credentials/query must not appear in the source/config index either.
  f.data.providers.fixture.baseUrl = "https://user:password@example.test/custom/v1?private=query#fragment";
  await writeFile(f.settingsPath, JSON.stringify(f.data));
  const originalData = await readFile(f.settingsPath);
  const index = await main(f);
  assert.equal(index.status, "complete");
  assert.equal(index.tasks.length, 25);
  assert.equal(index.managedFiles.length, 50);
  assert.deepEqual(await readIndex(f), JSON.parse(JSON.stringify(index)));
  assert.equal(typeof index.sourceDigest, "string");
  // 两份未使用模板已删除；按磁盘完整清单验证，仍能检出遗漏或多导出。
  const templatePaths = (await readdir(join(ROOT, "prompts"), { recursive: true }))
    .filter(path => path.endsWith(".md"))
    .map(path => `prompts/${path.replaceAll("\\", "/")}`)
    .sort();
  assert.deepEqual(Object.keys(index.templates).sort(), templatePaths);
  assert.ok(index.sourceFiles.some(([path]) => path === "scripts/generate-prompts.mjs"));
  const store = await compiled.runtime.loadExportSettings(f.data);
  const promptManager = await compiled.runtime.createExportPromptManager(path => readFile(join(ROOT, path), "utf8"));
  const examples = compiled.runtime.createPromptExamples(store.getSettings());
  for (const task of index.tasks) {
    assert.equal(task.ok, true);
    const payload = await readFile(join(f.outputDir, task.payload), "utf8");
    const md = await readFile(join(f.outputDir, task.markdown), "utf8");
    const capture = await compiled.runtime.capturePromptExample(examples.find(example => example.id === task.id), { settingsStore: store, promptManager });
    assert.equal(payload, capture.wire.body);
    assert.equal(task.bodySha256, hash(payload));
    assert.equal(md, renderCapturedRequest(task.id, task.fixture, JSON.parse(payload)));
    assert.ok(md.includes("Schema、工具"));
    assert.ok(!payload.includes(f.data.providers.fixture.apiKey));
    assert.ok(!md.includes(f.data.providers.fixture.apiKey));
    for (const file of index.managedFiles.filter(item => item.path === task.payload || item.path === task.markdown)) {
      assert.equal(file.sha256, hash(await readFile(join(f.outputDir, file.path))));
    }
  }
  const serializedIndex = JSON.stringify(index);
  for (const privateText of [f.data.providers.fixture.apiKey, "password", "private=query", "#fragment"]) assert.ok(!serializedIndex.includes(privateText));
  assert.deepEqual(await readFile(f.settingsPath), originalData);
  assert.ok(!(await readdir(f.outputDir)).some(path => path.startsWith(".prompt-export")));
});

test("compile failure invalidates old success before compile and removes only recorded output", async () => {
  const f = await fixture("compile-failure");
  await main(f);
  await main({ ...f, compile: async () => {
    assert.equal((await readIndex(f)).status, "running");
    throw new Error(`private compiler detail: ${f.data.providers.fixture.apiKey}`);
  } });
  const index = await assertEmptyFailed(f, "compile");
  assert.equal(index.failure.code, "E_EXPORT_FAILED");
  assert.ok(!f.messages.join("\n").includes(f.data.providers.fixture.apiKey));
});

test("malformed settings JSON invalidates old payloads and sanitizes parser errors", async () => {
  const f = await fixture("settings-json-failure");
  await main(f);
  await writeFile(f.settingsPath, `{"apiKey":"${f.data.providers.fixture.apiKey}", invalid`);
  await main(f);
  assert.equal((await assertEmptyFailed(f, "settings")).failure.code, "E_EXPORT_SETTINGS_JSON");
});

test("invalid production settings fail before capture instead of leaving prior successes", async () => {
  const f = await fixture("settings-validation-failure");
  await main(f);
  f.data.taskModels.write = {};
  await writeFile(f.settingsPath, JSON.stringify(f.data));
  await main(f);
  assert.equal((await assertEmptyFailed(f, "settings")).failure.code, "E101_INVALID_INPUT");
});

test("actual missing template files invalidate previously generated successes", async () => {
  const f = await fixture("templates-failure");
  await main(f);
  await main({ ...f, templateRoot: join(f.dir, "missing-templates") });
  await assertEmptyFailed(f, "templates");
});

test("modified files, unrelated files and out-of-directory manifest entries are preserved", async () => {
  const f = await fixture("preservation");
  const index = await main(f);
  await writeFile(join(f.outputDir, "prompt-define.md"), "user edited this file");
  await writeFile(join(f.outputDir, "keep.txt"), "not a generated artifact");
  await writeFile(join(f.dir, "prompt-outside.md"), "outside output");
  index.managedFiles.push({ path: "../prompt-outside.md", sha256: hash("outside output") },
    { path: "keep.txt", sha256: hash("not a generated artifact") },
    { path: resolve(f.dir, "prompt-outside.md"), sha256: hash("outside output") });
  await writeFile(indexFile(f), JSON.stringify(index));
  const failed = await main({ ...f, compile: async () => { throw new Error("offline compile failure"); } });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.preservedArtifacts, ["prompt-define.md"]);
  assert.equal(await readFile(join(f.outputDir, "prompt-define.md"), "utf8"), "user edited this file");
  assert.equal(await readFile(join(f.outputDir, "keep.txt"), "utf8"), "not a generated artifact");
  assert.equal(await readFile(join(f.dir, "prompt-outside.md"), "utf8"), "outside output");
  assert.deepEqual((await readdir(f.outputDir)).sort(), ["index.json", "keep.txt", "prompt-define.md"]);
});

test("foreign filename collision fails that pair without deleting or overwriting the foreign file", async () => {
  const f = await fixture("collision");
  await mkdir(f.outputDir);
  await writeFile(join(f.outputDir, "prompt-define.md"), "foreign document");
  const index = await main(f);
  assert.equal(index.status, "failed");
  assert.equal(index.tasks.filter(task => task.ok).length, 24);
  assert.equal(index.tasks.find(task => task.id === "define").error, "E_EXPORT_OUTPUT_COLLISION");
  assert.ok(index.preservedArtifacts.includes("prompt-define.md"));
  assert.equal(await readFile(join(f.outputDir, "prompt-define.md"), "utf8"), "foreign document");
  assert.ok(!(await readdir(f.outputDir)).includes("api-payload-define.json"));
  // A subsequent all-task configuration failure cleans the 24 owned pairs.
  await writeFile(f.settingsPath, JSON.stringify({ ...defaults, providers: {} }));
  const failed = await main(f);
  assert.equal(failed.tasks.filter(task => task.ok).length, 0);
  assert.deepEqual(failed.managedFiles, []);
  assert.deepEqual((await readdir(f.outputDir)).sort(), ["index.json", "prompt-define.md"]);
});

test("a foreign index is not silently replaced", async () => {
  const f = await fixture("foreign-index");
  await mkdir(f.outputDir);
  const text = '{"userDocument":true}';
  await writeFile(indexFile(f), text);
  await assert.rejects(main(f), /E_EXPORT_OUTPUT_COLLISION/);
  assert.equal(await readFile(indexFile(f), "utf8"), text);
  assert.deepEqual(await readdir(f.outputDir), ["index.json"]);
});

test("short credentials are replaced as well, without rejecting incidental prose characters", async () => {
  for (const key of ["q7!", "a"]) {
    const f = await fixture(`short-${key === "a" ? "letter" : "token"}`, settings(key));
    const index = await main(f);
    assert.equal(index.status, "complete");
    const store = await compiled.runtime.loadExportSettings(f.data);
    assert.equal(store.getSettings().providers.fixture.apiKey, "offline-auth-omitted");
    for (const file of ["index.json", ...index.managedFiles.map(item => item.path)]) {
      const text = await readFile(join(f.outputDir, file), "utf8");
      assert.ok(!text.includes(`Bearer ${key}`));
      assert.ok(!text.includes(`"apiKey":"${key}"`));
      assert.ok(!text.includes("offline-auth-omitted"));
      if (key.length > 1) assert.ok(!text.includes(key));
    }
  }
});

test("a short credential accidentally present in a custom template is rejected before file writes", async () => {
  const f = await fixture("short-template", settings("q7!"));
  await main(f);
  const templateRoot = join(f.dir, "custom");
  await cp(join(ROOT, "prompts"), join(templateRoot, "prompts"), { recursive: true });
  const template = join(templateRoot, "prompts/base/operations/define.md");
  await writeFile(template, (await readFile(template, "utf8")).replace("</", "Authorization: Bearer q7!\n</"));
  const index = await main({ ...f, templateRoot });
  assert.equal(index.status, "failed");
  assert.equal(index.failure, undefined, `Unexpected startup/final failure: ${JSON.stringify(index.failure)}`);
  assert.equal(index.tasks.find(task => task.id === "define").error, "E_EXPORT_CREDENTIAL_DETECTED");
  assert.ok(!(await readdir(f.outputDir)).includes("api-payload-define.json"));
  assert.ok(!(await readdir(f.outputDir)).includes("prompt-define.md"));
  for (const file of ["index.json", ...index.managedFiles.map(item => item.path)]) assert.ok(!(await readFile(join(f.outputDir, file), "utf8")).includes("q7!"));
});

test("credential rejection in final metadata removes already captured pairs and writes a safe failed index", async () => {
  const f = await fixture("metadata-secret");
  const runtime = { ...compiled.runtime, createExportPromptManager: async readPrompt => {
    // Still uses real disk loading; a sensitive path is deliberately injected
    // only in this isolated callback to exercise final-index guard/cleanup.
    await readPrompt(`prompts/${f.data.providers.fixture.apiKey}.md`);
    return compiled.runtime.createExportPromptManager(readPrompt);
  } };
  const templateRoot = join(f.dir, "custom");
  await cp(join(ROOT, "prompts"), join(templateRoot, "prompts"), { recursive: true });
  await writeFile(join(templateRoot, `prompts/${f.data.providers.fixture.apiKey}.md`), "fixture");
  await main({ ...f, templateRoot, compile: async () => ({ ...compiled, runtime }) });
  const index = await assertEmptyFailed(f, "index");
  assert.equal(index.failure.code, "E_EXPORT_CREDENTIAL_DETECTED");
});
