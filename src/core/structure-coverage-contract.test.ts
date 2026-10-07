import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PromptManager } from "./prompt-manager";
import { schemaRegistry, buildPhaseJsonSchema } from "./schema-registry";
import { getWriteStageDefinition } from "./stage-catalog";
import { buildTaskChatRequest } from "./task-execution-support";
import { DEFAULT_MODEL_CAPABILITIES, ok, type ILogger, type TaskModelSnapshot, type TaskRecord } from "../types";
import type { FileStorage } from "../data/file-storage";
import { WriteTaskExecutor } from "./write-task-executor";
import { ResponsePipeline } from "./response-pipeline";
import { Validator } from "../data/validator";
import { ContentRenderer } from "./content-renderer";
import type { ModelGateway } from "./model-gateway";
const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };

describe("structure coverage contract", () => {
  it("keeps composition hierarchical and related lists separate in runtime prompts and schemas", async () => {
    const manager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    const entity = await manager.loadPhaseTemplate("entity", "synthesis");
    expect(entity.ok).toBe(true);
    if (entity.ok) expect(entity.value).toContain("仅适用于父子层级划分");
    const entitySchema = schemaRegistry.getSchema("entity");
    const parts = entitySchema.properties?.composition?.properties?.has_parts?.description;
    expect(parts).toContain("直接构成性部分");
    expect(parts).toContain("并集等于父实体的组成范围");
    for (const [type, field] of [["domain", "issues"], ["issue", "theories"], ["theory", "entities"]] as const) {
      const description = (schemaRegistry.getSchema(type).properties?.[field] as { description: string }).description;
      expect(description).not.toContain("并集等于输入确定的");
    }
    expect(schemaRegistry.getSchema("theory").properties?.sub_theories?.description).toContain("有依据的理论子项");
    expect((await manager.preloadAllTemplates()).ok).toBe(true);
    expect(manager.build("verify", { CTX_META: "合成元数据", CTX_CURRENT: "合成正文" })).toContain("其他关联数组按字段关系核查");
    expect(manager.build("verify", { CTX_META: "合成元数据", CTX_CURRENT: "合成正文" })).toContain("父子分类按父项边界核查覆盖");
    expect(manager.build("verify", { CTX_META: "合成元数据", CTX_CURRENT: "合成正文" })).toContain("各部分范围并集等于父实体组成范围及交叉");
    expect(manager.build("define", { CTX_INPUT: "合成对象" })).not.toMatch(/博弈论|量子力学|神经突触/);
    for (const type of ["domain", "issue", "theory", "entity", "mechanism"] as const) {
      expect(JSON.stringify(schemaRegistry.getSchema(type))).not.toMatch(/例如|主要/);
    }
    const domainCore = await manager.loadPhaseTemplate("domain", "core");
    expect(domainCore.ok && domainCore.value).toContain("该领域采用的证据类型");
  });
  it.each(["domain", "issue", "theory"] as const)("sends the unified structure task and field-specific %s strict schema", async type => {
    const manager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    expect((await manager.preloadAllBaseComponents()).ok).toBe(true);
    const loaded = await manager.loadPhaseTemplate(type, "structure"); expect(loaded.ok).toBe(true); if (!loaded.ok) return;
    const prompt = manager.buildPhasedWrite({ CTX_META: "合成上下文", CTX_PREVIOUS: "合成已验证草稿", CONCEPT_TYPE: type }, loaded.value);
    const schema = buildPhaseJsonSchema(schemaRegistry.getSchema(type), getWriteStageDefinition(type, "structure")!.fields);
    const request = buildTaskChatRequest("write", prompt, { providerId: "test", model: "fixture", capabilities: DEFAULT_MODEL_CAPABILITIES }, schema, "structure");
    expect(request.messages[0].content).toContain("只写证据支持或可高置信确认");
    const system = request.messages[0].content;
    expect(system).toContain("子项范围的并集等于父项范围");
    expect(system).toContain("不为便于划分而缩小");
    expect(system).toContain("只列直属下一层");
    expect(system).toContain("同层使用一致的划分依据和相当的粒度");
    expect(system).toContain("交叉说明范围与归属规则");
    expect(system.match(/<hierarchy_rules>/g)).toHaveLength(1);
    expect(system).toContain("关联数组按字段要求列有据项");
    expect(request.messages.at(-1)?.content).toContain("层级子项遵守 hierarchy_rules");
    expect(request.messages.at(-1)?.content).toContain("合成上下文");
    expect(prompt).not.toContain("彼此尽量少重叠");
    expect(prompt).not.toContain("不能确认时省略该项");
    expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema: { additionalProperties: false } } });
    for (const field of type === "domain" ? ["sub_domains", "issues"] : type === "issue" ? ["sub_issues", "theories"] : ["sub_theories", "entities", "mechanisms"]) {
      const array = schema.properties![field] as { description: string; minItems?: number; maxItems?: number; uniqueItems?: boolean };
      expect(array.description).not.toMatch(/覆盖充分|预设固定|代表性|低重叠/);
      expect(array.minItems).toBeUndefined(); expect(array.maxItems).toBeUndefined(); expect(array.uniqueItems).toBeUndefined();
    }
  });
  it.each([["v5", false], ["v5", true], ["v6", false], ["v6", true], ["v7", false], ["v7", true], ["v8", false], ["v8", true], ["v9", false], ["v9", true]] as const)("excludes persisted %s system/history/response ID from the actual new request (cache=%s)", async (version, caching) => {
    const manager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    let sent: Parameters<ModelGateway["chat"]>[0] | undefined;
    const gateway = { chat: async (request: Parameters<ModelGateway["chat"]>[0]) => { sent = request; return ok({ content: JSON.stringify({ sub_domains: [], issues: [] }), finishReason: "stop" }); } } as unknown as ModelGateway;
    const executor = new WriteTaskExecutor({ providerManager: gateway, promptManager: manager, responsePipeline: new ResponsePipeline(new Validator()), schemaRegistry, logger });
    const model: TaskModelSnapshot = { providerId: "fixture", model: "fixture", providerSnapshot: { apiFormat: "openai-responses", baseUrl: "https://example.invalid/v1" } as TaskModelSnapshot["providerSnapshot"], capabilities: { responseContinuation: true, promptCaching: caching, promptCacheMode: "explicit" } as TaskModelSnapshot["capabilities"] };
    const task: TaskRecord<"structure"> = { id: "fixture", nodeId: "fixture", stageId: "structure", state: "running", createdAt: 1, updatedAt: 1, attempt: 1, payload: { concept: { type: "domain", name: { chinese: "合成节点", english: "" }, coreDefinition: "仅用于构造测试", source: "define", parents: [] }, accumulated: { definition: "旧的已验证草稿仍是数据" }, conversation: { providerId: "fixture", model: "fixture", apiFormat: "openai-responses", endpoint: "openai-responses|https://example.invalid/v1", promptVersion: version, responseContinuationEnabled: true, promptCachingEnabled: caching, promptCacheMode: "explicit", promptCacheKey: "old-v5-key", previousResponseId: "old-v5-response", systemPrompt: "OLD_SYSTEM_MARKER", history: [{ role: "user", content: "OLD_HISTORY_MARKER" }] } } };
    expect((await executor.execute(task, new AbortController().signal, { modelSnapshot: model, attemptReason: "initial" })).ok).toBe(true);
    expect(sent?.previousResponseId).toBeUndefined(); expect(sent?.promptCacheKey).not.toBe("old-v5-key");
    expect(JSON.stringify(sent?.messages)).not.toContain("OLD_SYSTEM_MARKER"); expect(JSON.stringify(sent?.messages)).not.toContain("OLD_HISTORY_MARKER");
    expect(JSON.stringify(sent?.messages)).toContain("子项范围的并集等于父项范围"); expect(JSON.stringify(sent?.messages)).toContain("旧的已验证草稿仍是数据");
  });
  it.each([0, 1, 208])("retains %s valid entries through schema validation and note rendering", async count => {
    const entries = Array.from({ length: count }, (_, index) => ({ name: index === 207 ? "候选0" : `候选${index}`, description: index > 204 ? "合理相近或交叉的合成候选" : "合成关系说明" }));
    const content = { sub_domains: entries, issues: [] };
    const schema = buildPhaseJsonSchema(schemaRegistry.getSchema("domain"), ["sub_domains", "issues"]);
    expect((await new Validator().validate(JSON.stringify(content), schema)).valid).toBe(true);
    const body = new ContentRenderer().renderStructuredContentMarkdown({ type: "domain", content, language: "zh", directoryScheme: { domain: "domains", issue: "issues", theory: "theories", entity: "entities", mechanism: "mechanisms" } });
    expect((body.match(/^- \[\[/gm) ?? []).length).toBe(count);
  });
  it("keeps a real theory with unclear status and preserves its explanation", async () => {
    const content = { sub_issues: [], stakeholder_perspectives: [], theories: [{ name: "合成已知理论", status: "unclear", brief: "已知存在，学术地位依据不足" }] };
    const schema = buildPhaseJsonSchema(schemaRegistry.getSchema("issue"), ["sub_issues", "stakeholder_perspectives", "theories"]);
    expect((await new Validator().validate(JSON.stringify(content), schema)).valid).toBe(true);
    const body = new ContentRenderer().renderStructuredContentMarkdown({ type: "issue", content, language: "zh", directoryScheme: { domain: "domains", issue: "issues", theory: "theories", entity: "entities", mechanism: "mechanisms" } });
    expect(body).toContain("合成已知理论"); expect(body).toContain("已知存在，学术地位依据不足");
  });
  it("requires a new runtime PromptManager to read changed disk templates", async () => {
    const before = await readFile("prompts/phases/domain/structure.md", "utf8"); let disk = before.replace("生成本次 Schema", "CACHE_BEFORE 生成本次 Schema");
    const storage = { read: async (path: string) => ok(path === "prompts/phases/domain/structure.md" ? disk : await readFile(path, "utf8")) } as FileStorage;
    const manager = new PromptManager(storage, logger);
    const first = await manager.loadPhaseTemplate("domain", "structure"); expect(first.ok && first.value).toContain("CACHE_BEFORE");
    disk = before.replace("生成本次 Schema", "CACHE_AFTER 生成本次 Schema");
    const cached = await manager.loadPhaseTemplate("domain", "structure"); expect(cached.ok && cached.value).toContain("CACHE_BEFORE");
    const reload = new PromptManager(storage, logger); expect((await reload.preloadAllBaseComponents()).ok).toBe(true);
    const fresh = await reload.loadPhaseTemplate("domain", "structure"); expect(fresh.ok && fresh.value).toContain("CACHE_AFTER");
    if (fresh.ok) {
      const prompt = reload.buildPhasedWrite({ CTX_META: "合成上下文", CTX_PREVIOUS: "", CONCEPT_TYPE: "domain" }, fresh.value);
      expect(buildTaskChatRequest("write", prompt, { providerId: "fixture", model: "fixture", capabilities: DEFAULT_MODEL_CAPABILITIES }).messages.at(-1)?.content).toContain("CACHE_AFTER");
    }
  });
  it("reloads a changed shared policy for newly created tasks", async () => {
    const original = await readFile("prompts/base/write-policy.md", "utf8");
    let policy = original.replace("<hierarchy_rules>", "<hierarchy_rules>\nPOLICY_BEFORE");
    const storage = { read: async (path: string) => ok(path === "prompts/base/write-policy.md" ? policy : await readFile(path, "utf8")) } as FileStorage;
    const manager = new PromptManager(storage, logger);
    const first = await manager.loadPhaseTemplate("domain", "structure");
    expect(first.ok && first.value).toContain("POLICY_BEFORE");
    policy = original.replace("<hierarchy_rules>", "<hierarchy_rules>\nPOLICY_AFTER");
    const cached = await manager.loadPhaseTemplate("domain", "structure");
    expect(cached.ok && cached.value).toContain("POLICY_BEFORE");
    const fresh = await new PromptManager(storage, logger).loadPhaseTemplate("domain", "structure");
    expect(fresh.ok && fresh.value).toContain("POLICY_AFTER");
  });
});
