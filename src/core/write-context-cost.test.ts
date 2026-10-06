import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Validator } from "../data/validator";
import type { FileStorage } from "../data/file-storage";
import { DEFAULT_MODEL_CAPABILITIES, err, ok, type ChatRequest, type ConversationContinuation, type ILogger, type TaskModelSnapshot, type TaskRecord } from "../types";
import type { ModelGateway } from "./model-gateway";
import { PromptManager } from "./prompt-manager";
import { ResponsePipeline } from "./response-pipeline";
import { schemaRegistry } from "./schema-registry";
import { getWriteStageDefinitions } from "./stage-catalog";
import { buildTaskChatRequest, buildTaskMetaContext, formatSourcePackage, PROMPT_VERSION } from "./task-execution-support";
import { WriteTaskExecutor } from "./write-task-executor";
import { OPENAI_RESPONSES_ADAPTER } from "./openai-responses-adapter";

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const model: TaskModelSnapshot = {
  providerId: "fixture", model: "gpt-6.1-sol",
  providerSnapshot: { apiFormat: "openai-responses", baseUrl: "https://never-called.example/v1", apiKey: "synthetic-only", enabled: true, embeddingApiFormat: "disabled", defaultChatModel: "gpt-6.1-sol", defaultEmbedModel: "" },
  capabilities: { ...DEFAULT_MODEL_CAPABILITIES, nativeWebSearch: true, responseContinuation: true, promptCaching: true, promptCacheMode: "explicit" },
};
const sources = { items: [{ url: "https://evidence.example/original", title: "合成来源" }] };
const core = { definition: "UNIQUE_DEFINITION [证据](https://evidence.example/original)", core_questions: "UNIQUE_QUESTION", methodology: "UNIQUE_METHOD", boundaries: ["UNIQUE_BOUNDARY"] };
const narrative = { historical_genesis: "UNIQUE_HISTORY", holistic_understanding: "UNIQUE_SYNTHESIS" };
const concept = { type: "domain" as const, name: { chinese: "合成领域", english: "Synthetic" }, coreDefinition: "上下文保留测试", parents: ["上位领域"], source: "define" as const };
const continuation = (history: ConversationContinuation["history"]): ConversationContinuation => ({
  providerId: model.providerId, model: model.model, apiFormat: "openai-responses", endpoint: "openai-responses|https://never-called.example/v1", promptVersion: PROMPT_VERSION,
  responseContinuationEnabled: true, promptCachingEnabled: true, promptCacheMode: "explicit", systemPrompt: "稳定合成规则", history, sources,
});
function fixture(rejectContinuation = false) {
  const requests: ChatRequest[] = [];
  const manager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
  const gateway = { chat: async (request: ChatRequest) => {
    requests.push(request);
    if (rejectContinuation && requests.length === 1) return err("E205_PROVIDER_REQUEST_INVALID", "stored response id rejected", { rawResponse: "previous_response_id invalid" });
    const content = request.requestLabel === "core" ? core : request.requestLabel === "narrative" ? narrative : { sub_domains: [], issues: [] };
    const envelope = (request.response_format?.json_schema.schema as {properties?:Record<string,unknown>})?.properties?.result;
    return ok({ content: JSON.stringify(envelope ? {result:{stage:request.requestLabel,...content}} : content), responseId: `response-${requests.length}`, finishReason: "stop", citations: [{ url: sources.items[0].url, title: "合成来源" }] });
  } } as unknown as ModelGateway;
  const executor = new WriteTaskExecutor({ providerManager: gateway, promptManager: manager, responsePipeline: new ResponsePipeline(new Validator()), schemaRegistry, logger });
  const task = (stageId: "core" | "narrative" | "structure", accumulated: Record<string, unknown>, conversation?: ConversationContinuation): TaskRecord<typeof stageId> => ({
    id: `task-${stageId}`, nodeId: "node", workflowId: "workflow", stageId, state: "running", createdAt: 1, updatedAt: 1, attempt: 1, payload: { concept, accumulated, conversation },
  });
  return { manager, requests, task, executor };
}
const historyContent=(fields:Record<string,unknown>,stage="core")=>JSON.stringify({result:{stage,...fields}});
const latestUser = (request: ChatRequest) => [...request.messages].reverse().find(message => message.role === "user")!.content;

describe("Write context keeps each authoritative field while avoiding duplicate input", () => {
  it.each(["implicit", "explicit"] as const)("keeps the full validated three-stage result and evidence with smaller %s Responses input", async mode => {
    const f = fixture(); let accumulated: Record<string, unknown> = {}; let conversation: ConversationContinuation | undefined;
    const snapshot = { ...model, capabilities: { ...model.capabilities!, promptCacheMode: mode } };
    const sizes: Array<{ stage: string; before: number; after: number }> = [];
    for (const phase of getWriteStageDefinitions("domain")) {
      const task = f.task(phase.id as "core" | "narrative" | "structure", accumulated, conversation);
      const before = { ...accumulated };
      const result = await f.executor.execute(task, new AbortController().signal, { modelSnapshot: snapshot, attemptReason: "initial" });
      expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error.message);
      const request = f.requests.at(-1)!;
      for (const [field, value] of Object.entries(before)) {
        const answers = request.messages.filter(message => message.role === "assistant").map(message => (JSON.parse(message.content).result as Record<string, unknown>));
        expect(answers.some(answer => JSON.stringify(answer[field]) === JSON.stringify(value))).toBe(true);
        if (typeof value === "string") expect(latestUser(request)).not.toContain(value);
      }
      if (conversation) expect(latestUser(request)).toContain(sources.items[0].url);
      const template = await f.manager.loadPhaseTemplate("domain", phase.id); if (!template.ok) throw new Error(template.error.message);
      const baselinePrompt = f.manager.buildPhasedWrite({ CTX_META: buildTaskMetaContext(task.payload), CTX_PREVIOUS: [Object.keys(before).length ? JSON.stringify(before, null, 2) : "", formatSourcePackage(conversation?.sources)].filter(Boolean).join("\n\n"), CONCEPT_TYPE: "domain" }, template.value) + `\n<write_stage>${phase.id}</write_stage>\n`;
      const baseline = buildTaskChatRequest("write", baselinePrompt, snapshot, request.response_format!.json_schema.schema, phase.id, "initial", conversation);
      if (!baseline.responsesInput) baseline.responsesInput = baseline.messages.filter(message => message.role !== "system").map(message => ({ role: message.role, content: message.content }));
      const body = OPENAI_RESPONSES_ADAPTER.buildRequestBody(request, { purpose: "write" });
      const baselineBody = OPENAI_RESPONSES_ADAPTER.buildRequestBody(baseline, { purpose: "write" });
      const afterSize = JSON.stringify(body.input).length, beforeSize = JSON.stringify(baselineBody.input).length;
      expect(body.text).toEqual(baselineBody.text);
      expect(body.tools).toEqual(baselineBody.tools);
      expect(afterSize).toBeLessThanOrEqual(beforeSize);
      if (conversation) expect(afterSize).toBeLessThan(beforeSize);
      sizes.push({ stage: phase.id, before: beforeSize, after: afterSize });
      accumulated = result.value.accumulated as Record<string, unknown>;
      conversation = { ...continuation([...(conversation?.history ?? []), { role: "user", content: result.value.promptUser as string }, { role: "assistant", content: result.value.responseContent as string }]), promptCacheMode: mode, systemPrompt: result.value.systemPrompt as string, previousResponseId: result.value.responseId as string };
    }
    expect(accumulated).toEqual({ ...core, ...narrative, sub_domains: [], issues: [] });
    expect(f.requests).toHaveLength(3);
    console.log("synthetic-responses-input-characters", JSON.stringify(sizes));
  });

  it("keeps missing early-stage fields when compatible history starts only in a later stage", async () => {
    const f = fixture();
    await f.executor.execute(f.task("structure", { ...core, ...narrative }, continuation([{ role: "assistant", content: historyContent(narrative,"narrative") }])), new AbortController().signal, { modelSnapshot: model, attemptReason: "initial" });
    const user = latestUser(f.requests[0]);
    expect(user).toContain(core.definition); expect(user).toContain(core.methodology);
    expect(user).not.toContain(narrative.historical_genesis); expect(user).not.toContain(narrative.holistic_understanding);
    expect(user).toContain(sources.items[0].url);
  });

  it.each(["missing", "empty", "user-only", "malformed", "old-version", "other-model", "other-provider", "other-endpoint"])("preserves full draft with %s history", async kind => {
    const f = fixture();
    let previous: ConversationContinuation | undefined = continuation([{ role: "assistant", content: historyContent(core) }]);
    if (kind === "empty") previous!.history = [];
    if (kind === "user-only") previous!.history = [{ role: "user", content: historyContent(core) }];
    if (kind === "malformed") previous!.history = [{ role: "assistant", content: "not JSON" }];
    if (kind === "old-version") previous!.promptVersion = "v5";
    if (kind === "other-model") previous!.model = "different-model";
    if (kind === "other-provider") previous!.providerId = "different-provider";
    if (kind === "other-endpoint") previous!.endpoint = "openai-responses|https://different.example/v1";
    if (kind === "missing") previous = undefined;
    await f.executor.execute(f.task("structure", core, previous), new AbortController().signal, { modelSnapshot: model, attemptReason: "initial" });
    expect(latestUser(f.requests[0])).toContain(core.definition);
    expect(latestUser(f.requests[0])).toContain(core.methodology);
    expect(f.requests).toHaveLength(1);
  });

  it("retains the current value when the latest historical field differs from it", async () => {
    const f = fixture();
    const previous = continuation([{ role: "assistant", content: historyContent(core) }, { role: "assistant", content: historyContent({...core,definition:"OLD_DIFFERENT_DEFINITION"}) }]);
    await f.executor.execute(f.task("structure", core, previous), new AbortController().signal, { modelSnapshot: model, attemptReason: "initial" });
    expect(latestUser(f.requests[0])).toContain(core.definition);
    expect(latestUser(f.requests[0])).not.toContain(core.methodology);
  });

  it("keeps an entire updated array instead of removing its historical subset", async () => {
    const f = fixture();
    const updated = { ...core, boundaries: [...core.boundaries, "ADDED_CURRENT_BOUNDARY"] };
    await f.executor.execute(f.task("structure", updated, continuation([{ role: "assistant", content: historyContent(core) }])), new AbortController().signal, { modelSnapshot: model, attemptReason: "initial" });
    expect(latestUser(f.requests[0])).toContain("UNIQUE_BOUNDARY");
    expect(latestUser(f.requests[0])).toContain("ADDED_CURRENT_BOUNDARY");
    expect(latestUser(f.requests[0])).not.toContain(core.methodology);
  });

  it("preserves unproven draft fields with a server response ID and full draft on its specific fallback", async () => {
    const f = fixture(true);
    const snapshot = { ...model, capabilities: { ...model.capabilities!, promptCaching: false } };
    const previous = { ...continuation([{ role: "assistant" as const, content: JSON.stringify(narrative) }]), promptCachingEnabled: false, previousResponseId: "old-id" };
    const result = await f.executor.execute(f.task("structure", { ...core, ...narrative }, previous), new AbortController().signal, { modelSnapshot: snapshot, attemptReason: "initial" });
    expect(result.ok).toBe(true);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0].previousResponseId).toBe("old-id");
    expect(latestUser(f.requests[0])).toContain(core.definition);
    expect(latestUser(f.requests[0])).not.toContain(narrative.historical_genesis);
    expect(f.requests[1].previousResponseId).toBeUndefined();
    expect(latestUser(f.requests[1])).toContain(core.definition);
    expect(latestUser(f.requests[1])).toContain(narrative.historical_genesis);
    expect(latestUser(f.requests[1])).toContain(sources.items[0].url);
    expect(f.requests[0].response_format).toEqual(f.requests[1].response_format);
  });
});
