/** Offline harness: only input fixtures and host boundaries are substituted. */
import type { App, Plugin, RequestUrlParam, Vault } from "obsidian";
import { FileStorage } from "../src/data/file-storage";
import { DEFAULT_SETTINGS, SettingsStore, TASK_TYPES } from "../src/data/settings-store";
import { Validator } from "../src/data/validator";
import { CardsTaskExecutor } from "../src/core/cards-task-executor";
import { CARDS_PROMPT_VERSION } from "../src/core/card-generation";
import { CreateOrchestrator } from "../src/core/create-orchestrator";
import { DuplicateMergeService } from "../src/core/duplicate-merge-service";
import type { ModelGateway } from "../src/core/model-gateway";
import { PromptManager } from "../src/core/prompt-manager";
import { ProviderManager } from "../src/core/provider-manager";
import type { ProviderTransport } from "../src/core/provider-transport";
import type { ProviderStreamRequest } from "../src/core/provider-streaming";
import { ResponsePipeline } from "../src/core/response-pipeline";
import { buildPhaseJsonSchema, schemaRegistry } from "../src/core/schema-registry";
import { getWriteStageDefinitions } from "../src/core/stage-catalog";
import { TagTaskExecutor } from "../src/core/tag-task-executor";
import { modelEndpoint, PROMPT_VERSION } from "../src/core/task-execution-support";
import { resolveTaskModelSnapshot } from "../src/core/task-model-resolver";
import { VerifyTaskExecutor } from "../src/core/verify-task-executor";
import { usesStableWriteEnvelope } from "../src/core/write-output-codec";
import { WriteTaskExecutor } from "../src/core/write-task-executor";
import { CR_TYPES, err } from "../src/types";
export { resolveTaskModelSnapshot, PROMPT_VERSION };
import type { ChatRequest, ConfirmedConcept, ConversationContinuation, CRFrontmatter, CRType, DuplicateMergeInput,
  ILogger, PluginSettings, Result, TaskExecutionContext, TaskModelSnapshot, TaskRecord, TaskType } from "../src/types";

export const logger: ILogger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

const PARAMETER_KEYS = ["temperature", "topP", "reasoning_effort", "maxTokens", "embeddingDimension", "thinkingLevel", "thinkingBudget"];
const CAPABILITY_KEYS = ["temperature", "topP", "reasoning", "nativeWebSearch", "promptCaching", "promptCacheMode", "promptCacheTtl", "responseContinuation"];
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function select(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const input = record(value);
  return Object.fromEntries(keys.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
}
function projectOptions(value: unknown, keys: readonly string[], rejectUnknown = false): unknown {
  // Preserve invalid shapes for SettingsStore to reject; do not turn them into {}.
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const result = select(value, keys);
  if (rejectUnknown) for (const key of Object.keys(value)) {
    if (!keys.includes(key)) result[key] = null; // Retain the invalid key, never its possibly sensitive value.
  }
  return result;
}

/** 导出器只接收请求相关字段，使用与插件相同的设置校验，不传递实际凭据。 */
export async function loadExportSettings(raw: unknown): Promise<SettingsStore> {
  const input = record(raw);
  const providers = Object.fromEntries(Object.entries(record(input.providers)).map(([id, value]) => {
    const provider = record(value);
    return [id, {
      ...select(provider, ["baseUrl", "apiFormat", "embeddingApiFormat", "defaultChatModel", "defaultEmbedModel", "enabled"]),
      apiKey: typeof provider.apiKey === "string" ? (provider.apiKey.trim() ? "offline-auth-omitted" : "") : provider.apiKey,
      ...(provider.capabilities === undefined ? {} : { capabilities: projectOptions(provider.capabilities, CAPABILITY_KEYS) }),
      ...(provider.parameters === undefined ? {} : { parameters: projectOptions(provider.parameters, PARAMETER_KEYS) }),
    }];
  }));
  const taskInput = record(input.taskModels);
  const taskModels = Object.fromEntries(TASK_TYPES.filter(type => Object.hasOwn(taskInput, type)).map(type => {
    const value = taskInput[type];
    // 保留无效输入形状，由同一设置校验器拒绝。
    if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return [type, value];
    const task = record(value);
    return [type, {
      ...select(task, ["providerId", "model"]),
      ...(task.capabilities === undefined ? {} : { capabilities: projectOptions(task.capabilities, CAPABILITY_KEYS) }),
      ...(task.parameters === undefined ? {} : { parameters: projectOptions(task.parameters, PARAMETER_KEYS, true) }),
    }];
  }));
  const projected = raw === null ? null : {
    ...structuredClone(DEFAULT_SETTINGS),
    ...select(input, ["defaultProviderId", "providerTimeoutMs", "providerMaxAttempts", "enableStreamingKeepalive", "streamingTransport"]),
    // Required request containers/scalars must retain invalid/missing shapes,
    // rather than acquire a valid default during the privacy projection.
    defaultProviderId: input.defaultProviderId,
    providers: input.providers !== null && typeof input.providers === "object" && !Array.isArray(input.providers) ? providers : input.providers,
    taskModels: input.taskModels !== null && typeof input.taskModels === "object" && !Array.isArray(input.taskModels) ? taskModels : input.taskModels,
  };
  const store = new SettingsStore({ loadData: async () => projected, saveData: forbidden } as unknown as Plugin, logger);
  const result = await store.loadSettings();
  if (!result.ok) throw new Error(`本地请求设置无效 (${result.error.code})；未生成替代模型配置。`);
  return store;
}

function forbidden(): never { throw new Error("Offline prompt export cannot access notes, write plugin data, or send network requests"); }
function blocked<T>(): T { return new Proxy({}, { get: forbidden }) as T; }

export async function createExportPromptManager(readPrompt: (path: string) => Promise<string>): Promise<PromptManager> {
  const storage = new FileStorage({ adapter: { read: async (path: string) => {
    if (!path.startsWith("prompts/") || path.split("/").includes("..")) forbidden();
    return readPrompt(path);
  } } } as unknown as Vault);
  const manager = new PromptManager(storage, logger, "prompts");
  for (const load of [() => manager.preloadAllBaseComponents(), () => manager.preloadAllTemplates()]) {
    const result = await load();
    if (!result.ok) throw new Error(`磁盘提示词加载失败 (${result.error.code})`);
  }
  return manager;
}

export interface WireCapture {
  url: string;
  method: string;
  body: string;
  streaming: boolean;
  transport?: string;
  timeoutMs: number;
}

/** Stop at the last production boundary; deliberately return no model response.
 * Do not store headers, authentication or an upstream response in this object. */
export class CaptureTransport implements ProviderTransport {
  readonly captures: WireCapture[] = [];
  dispatchAttempts = 0;
  async requestJson(params: RequestUrlParam, timeoutMs: number): Promise<never> {
    this.capture({ url: params.url, method: params.method ?? "POST", body: String(params.body ?? ""), streaming: false, timeoutMs });
  }
  async requestStream(input: ProviderStreamRequest): Promise<never> {
    this.capture({ url: input.url, method: "POST", body: input.body, streaming: true, transport: input.transport, timeoutMs: input.timeoutMs });
  }
  private capture(value: WireCapture): never {
    this.dispatchAttempts++;
    if (this.captures.length) throw new Error("Offline export unexpectedly attempted a second dispatch");
    this.captures.push(value);
    throw new Error("OFFLINE_PROMPT_CAPTURE_COMPLETE");
  }
  dispose(): void {}
}

export interface PromptExample {
  id: string;
  taskType: Exclude<TaskType, "index">;
  input?: string;
  task?: TaskRecord;
  merge?: DuplicateMergeInput;
  historyType?: CRType;
  fixture: string;
}

const NAMES: Record<CRType, [string, string]> = {
  domain: ["量子信息科学", "Quantum Information Science"], issue: ["测量问题", "Measurement Problem"],
  theory: ["哥本哈根诠释", "Copenhagen Interpretation"], entity: ["量子纠缠", "Quantum Entanglement"],
  mechanism: ["波函数坍缩", "Wave Function Collapse"],
};
function concept(type: CRType): ConfirmedConcept {
  return { type, name: { chinese: NAMES[type][0], english: NAMES[type][1] },
    coreDefinition: "这是离线示例的核心定义，不是模型输出或学术判断。", source: "define", parents: ["[[示例父概念]]"] };
}
function task<T extends TaskRecord>(stageId: T["stageId"], payload: T["payload"]): T {
  return { id: `fixture-${stageId}`, nodeId: "fixture-node", workflowId: "fixture-workflow", stageId, payload,
    state: "running", createdAt: 0, updatedAt: 0, attempt: 1 } as T;
}
/** Schema-shaped synthetic draft, only used as explicitly labelled input data. */
function sample(schema: unknown): unknown {
  const s = record(schema);
  if (Array.isArray(s.anyOf)) return sample(s.anyOf[0]);
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.type === "object") return Object.fromEntries(Object.entries(record(s.properties)).map(([key, child]) => [key, sample(child)]));
  if (s.type === "array") return [];
  if (s.type === "boolean") return true;
  if (s.type === "number" || s.type === "integer") return typeof s.minimum === "number" ? s.minimum : 1;
  return "离线上下文示例，不是真实模型回答";
}
function noteSnapshot(id: string, title: string) {
  const frontmatter: CRFrontmatter = { cruid: id, type: "entity", name: title, status: "draft", created: "2026-01-01 00:00:00",
    updated: "2026-01-01 00:00:00", aliases: [], tags: [], parents: ["[[示例父概念]]"] };
  return { nodeId: id, path: `fixture/${title}.md`, content: `---\ncruid: ${id}\ntype: entity\nname: ${title}\nstatus: draft\nparents: ["[[示例父概念]]"]\n---\n\n## 定义\n这是离线示例正文。`, contentHash: `fixture-hash-${id}`, frontmatter };
}

function historyFixture(snapshot: TaskModelSnapshot, type: CRType): ConversationContinuation {
  const stage = getWriteStageDefinitions(type)[0];
  const fields = sample(buildPhaseJsonSchema(schemaRegistry.getSchema(type), stage.fields));
  const answer = JSON.stringify(usesStableWriteEnvelope(snapshot) ? { result: { stage: stage.id, ...record(fields) } } : fields);
  return {
    providerId: snapshot.providerId, model: snapshot.model, apiFormat: snapshot.providerSnapshot?.apiFormat,
    endpoint: modelEndpoint(snapshot), promptVersion: PROMPT_VERSION,
    responseContinuationEnabled: snapshot.capabilities.responseContinuation,
    promptCachingEnabled: snapshot.capabilities.promptCaching, promptCacheMode: snapshot.capabilities.promptCacheMode ?? "implicit",
    previousResponseId: "fixture_response_id_not_from_upstream",
    history: [{ role: "user", content: "明确标注的离线历史输入 fixture" }, { role: "assistant", content: answer }],
    sources: { items: [{ url: "https://example.test/fixture-source", title: "离线来源 fixture，不是真实证据" }] },
  };
}

export function createPromptExamples(settings: PluginSettings): PromptExample[] {
  const entity = concept("entity");
  const canonical = noteSnapshot("fixture-canonical", "量子纠缠");
  const redundant = noteSnapshot("fixture-redundant", "纠缠状态");
  const verifyPayload = { filePath: canonical.path, currentContent: canonical.content, noteType: "entity" as const, concept: entity };
  const examples: PromptExample[] = [
    { id: "define", taskType: "define", input: "量子纠缠", fixture: "概念输入为示例" },
    { id: "tag", taskType: "tag", task: task("tag", { concept: entity }), fixture: "概念、核心定义和父项为示例" },
    { id: "verify", taskType: "verify", task: task("verify", verifyPayload), fixture: "笔记及 frontmatter 为示例" },
    { id: "merge", taskType: "merge", merge: { pairId: "fixture-pair", type: "entity", similarity: 0.93, canonical, redundant,
      linkRepairPlan: { entries: [], replacementCount: 0, skipped: [] } }, fixture: "两个已捕获笔记快照为示例" },
    { id: "cards", taskType: "cards", task: task("cards", { filePath: canonical.path, targetPath: "fixture/cards.md",
      body: "## 定义\n这是已捕获的离线笔记正文示例。", noteType: "entity", promptVersion: CARDS_PROMPT_VERSION }), fixture: "卡片正文快照和目标路径为示例" },
  ];
  const writeModel = resolveTaskModelSnapshot(settings, "write");
  for (const type of CR_TYPES) {
    const accumulated: Record<string, unknown> = {};
    const stages = getWriteStageDefinitions(type);
    for (const stage of stages) {
      examples.push({ id: `write-${type}-${stage.id}`, taskType: "write",
        task: task(stage.id, { concept: concept(type), accumulated: { ...accumulated } }), fixture: "概念和累积草稿为示例；没有历史 response ID" });
      Object.assign(accumulated, sample(buildPhaseJsonSchema(schemaRegistry.getSchema(type), stage.fields)));
    }
    const next = stages[1];
    if (next) examples.push({ id: `write-${type}-${next.id}-history-fixture`, taskType: "write",
      historyType: type,
      task: task(next.id, { concept: concept(type), accumulated: sample(buildPhaseJsonSchema(schemaRegistry.getSchema(type), stages[0].fields)) as Record<string, unknown>,
        conversation: historyFixture(writeModel, type) }), fixture: "历史、来源包及 response ID 都是离线 fixture；不表示真实续接或缓存命中" });
  }
  examples.push({ id: "verify-history-fixture", taskType: "verify", historyType: "entity", task: task("verify", { ...verifyPayload,
    conversation: historyFixture(writeModel, "entity") }),
    fixture: "笔记、历史、来源包及 response ID 都是离线 fixture；不表示真实续接或搜索证据" });
  return examples;
}

export interface ExampleDependencies {
  settingsStore: SettingsStore;
  promptManager: PromptManager;
  providerManager: ModelGateway;
}

/** Dispatch through product entry points. No schema, slots or wire assembly here. */
export async function executePromptExample(example: PromptExample, deps: ExampleDependencies): Promise<Result<unknown>> {
  const validator = new Validator();
  const shared = { ...deps, logger, schemaRegistry, responsePipeline: new ResponsePipeline(validator) };
  const signal = new AbortController().signal;
  const context: TaskExecutionContext = { attemptReason: "initial", modelSnapshot: resolveTaskModelSnapshot(deps.settingsStore.getSettings(), example.taskType) };
  switch (example.taskType) {
    case "define": return new CreateOrchestrator({ ...shared, validator, workflowCoordinator: blocked() }).defineDirect(example.input!, signal);
    case "tag": return new TagTaskExecutor(shared).execute(example.task as TaskRecord<"tag">, signal, context);
    case "write": return new WriteTaskExecutor(shared).execute(example.task as TaskRecord<"write">, signal, context);
    case "verify": return new VerifyTaskExecutor(shared).execute(example.task as TaskRecord<"verify">, signal, context);
    case "cards": return new CardsTaskExecutor(shared).execute(example.task as TaskRecord<"cards">, signal, context);
    case "merge": return new DuplicateMergeService({ ...shared, app: blocked<App>(), fileStorage: blocked(), noteRepository: blocked(),
      cruidCache: blocked(), duplicateManager: blocked(), reindex: forbidden }).prepareCapturedMerge(example.merge!, context.modelSnapshot, signal);
  }
}

/** Historical system/user turns must also come from the real Write executor.
 * Only the assistant content and server ID are synthetic context fixtures. */
export async function preparePromptExample(example: PromptExample, deps: Omit<ExampleDependencies, "providerManager">): Promise<PromptExample> {
  if (!example.historyType) return example;
  const prepared = structuredClone(example);
  const stage = getWriteStageDefinitions(example.historyType)[0];
  let historical: ChatRequest | undefined;
  const gateway: ModelGateway = { chat: async value => { historical = value; return err("E310_INVALID_STATE", "offline history fixture"); },
    embed: forbidden, probe: forbidden };
  await executePromptExample({ id: "history-input-fixture", taskType: "write", fixture: "history input fixture",
    task: task(stage.id, { concept: concept(example.historyType), accumulated: {} }) }, { ...deps, providerManager: gateway });
  if (!historical) throw new Error("无法通过生产 Write 入口生成历史提示词 fixture");
  const payload = prepared.task!.payload;
  if (!("conversation" in payload) || !payload.conversation) throw new Error("Missing history fixture context");
  payload.conversation.systemPrompt = historical.messages.find(message => message.role === "system")?.content;
  const user = historical.messages.find(message => message.role === "user");
  if (!user) throw new Error("Missing production history user prompt");
  payload.conversation.history![0].content = user.content;
  return prepared;
}

export async function capturePromptExample(example: PromptExample, deps: Omit<ExampleDependencies, "providerManager">) {
  const prepared = await preparePromptExample(example, deps);
  const transport = new CaptureTransport();
  const manager = new ProviderManager(deps.settingsStore, logger, undefined, undefined, undefined, transport);
  let request: ChatRequest | undefined;
  const gateway = { chat: async (value: ChatRequest, signal?: AbortSignal) => { request = value; return manager.chat(value, signal); },
    embed: forbidden, probe: forbidden } satisfies ModelGateway;
  try {
    const result = await executePromptExample(prepared, { ...deps, providerManager: gateway });
    if (transport.captures.length !== 1 || transport.dispatchAttempts !== 1) throw new Error(`未到达唯一生产发送边界 (${result.ok ? "unexpected-success" : result.error.code})`);
    if (result.ok) throw new Error("Offline export unexpectedly received a model result");
    return { wire: transport.captures[0], request: request!, stoppedBeforeNetwork: true as const };
  } finally { manager.dispose(); }
}
