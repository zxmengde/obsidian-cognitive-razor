import { readFile } from "node:fs/promises";
import { PROMPT_VERSION, modelEndpoint } from "./task-execution-support";
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../types";
import type { ChatRequest, ConversationContinuation, ILogger, TaskExecutionContext, TaskModelSnapshot, TaskRecord } from "../types";
import type { FileStorage } from "../data/file-storage";
import { GEMINI_GENERATIVE_LANGUAGE_ADAPTER } from "./gemini-generative-language-adapter";
import { OPENAI_RESPONSES_ADAPTER } from "./openai-responses-adapter";
import { Validator } from "../data/validator";
import { PromptManager } from "./prompt-manager";
import { SchemaRegistry, buildPhaseJsonSchema } from "./schema-registry";
import { ResponsePipeline } from "./response-pipeline";
import { getWriteStageDefinitions } from "./stage-catalog";
import { WriteTaskExecutor } from "./write-task-executor";

describe("WriteTaskExecutor continuation fallback", () => {
  it("retries a rejected continuation once with accumulated fields in the prompt", async () => {
    const requests: ChatRequest[] = [];
    const chat = vi.fn(async (request: ChatRequest) => {
      requests.push(request);
      if (requests.length === 1) {
        return err("E205_PROVIDER_REQUEST_INVALID", "API 请求无效 (400)", {
          status: 400,
          rawResponse: "previous_response_id invalid",
        });
      }
      return ok({ content: "fallback output", responseId: "resp_narrative" });
    });
    const promptManager = {
      loadPhaseTemplate: vi.fn(async () => ok("phase template")),
      buildPhasedWrite: vi.fn((slots: Record<string, string>) =>
        `<system_instructions>rules</system_instructions>\n${slots.CTX_PREVIOUS}`),
    };
    const responsePipeline = {
      checkFinishReason: vi.fn(() => null),
      validate: vi.fn(async () => ok({
        historical_genesis: "history",
        holistic_understanding: "whole",
      })),
    };
    const executor = new WriteTaskExecutor({
      providerManager: { chat } as never,
      promptManager: promptManager as never,
      responsePipeline: responsePipeline as never,
      schemaRegistry: new SchemaRegistry(),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const task: TaskRecord<"narrative"> = {
      id: "task-narrative",
      nodeId: "node-1",
      workflowId: "workflow-1",
      stageId: "narrative",
      state: "running",
      createdAt: 1,
      updatedAt: 1,
      attempt: 1,
      payload: {
        concept: {
          type: "domain",
          name: { chinese: "测试领域", english: "Test Domain" },
          coreDefinition: "definition",
          source: "define",
          parents: [],
        },
        accumulated: { definition: "validated core result" },
        conversation: {
          previousResponseId: "resp_core",
          providerId: "provider",
          model: "model",
          apiFormat: "openai-responses",
          endpoint: "openai-responses|https://relay.test/v1",
          promptVersion: PROMPT_VERSION,
          responseContinuationEnabled: true,
          promptCachingEnabled: false,
        },
      },
    };
    const context: TaskExecutionContext = {
      attemptReason: "initial",
      modelSnapshot: {
        providerId: "provider",
        model: "model",
        providerSnapshot: {
          apiKey: "test-key",
          apiFormat: "openai-responses",
          embeddingApiFormat: "disabled",
          baseUrl: "https://relay.test/v1",
          defaultChatModel: "model",
          defaultEmbedModel: "",
          enabled: true,
        },
        capabilities: {
          temperature: false,
          topP: false,
          reasoning: false,
          nativeWebSearch: false,
          promptCaching: false,
          responseContinuation: true,
        },
      },
    };

    const result = await executor.execute(task, new AbortController().signal, context);

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0].previousResponseId).toBe("resp_core");
    expect(requests[1].previousResponseId).toBeUndefined();
    expect(requests[1].messages.some((message) => message.content.includes("validated core result"))).toBe(true);
    expect(result.ok && result.value).toMatchObject({
      stageId: "narrative",
      conversationInvalidated: true,
      responseId: "resp_narrative",
    });
  });
});

describe("Gemini write contents prefix", () => {
  it("replays the core request and each raw answer ahead of the next stage", async () => {
    const requests: ChatRequest[] = [];
    const answers: Record<string, string> = {
      core: JSON.stringify({ result: { stage: "core", definition: "CORE_ANSWER", core_questions: "q", methodology: "m", boundaries: ["b"] } }),
      narrative: JSON.stringify({ result: { stage: "narrative", historical_genesis: "NARRATIVE_ANSWER", holistic_understanding: "h" } }),
      structure: JSON.stringify({ result: { stage: "structure", sub_domains: [], issues: [] } }),
    };
    const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const promptManager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    const executor = new WriteTaskExecutor({
      providerManager: { chat: vi.fn(async (request: ChatRequest) => {
        requests.push(request);
        return ok({ content: answers[request.requestLabel ?? ""], finishReason: "stop" });
      }) } as never,
      promptManager,
      responsePipeline: { checkFinishReason: vi.fn(() => null), validate: vi.fn(async ({ rawOutput }: { rawOutput: string }) => ok(JSON.parse(rawOutput))) } as never,
      schemaRegistry: new SchemaRegistry(),
      logger,
    });
    const snapshot: TaskModelSnapshot = {
      providerId: "google", model: "gemini-4-argon", thinkingLevel: "high",
      providerSnapshot: {
        apiKey: "test-key", apiFormat: "gemini-generative-language", embeddingApiFormat: "disabled",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultChatModel: "gemini-4-argon", defaultEmbedModel: "", enabled: true,
      },
      capabilities: { temperature: false, topP: false, reasoning: true, nativeWebSearch: true, promptCaching: false, responseContinuation: false },
    };
    const concept = { type: "domain" as const, name: { chinese: "科学", english: "Science" }, coreDefinition: "定义", source: "define" as const, parents: [] as string[] };
    let accumulated: Record<string, unknown> = {};
    let conversation: ConversationContinuation | undefined;
    for (const stageId of ["core", "narrative", "structure"] as const) {
      const task: TaskRecord<typeof stageId> = {
        id: stageId, nodeId: "node", workflowId: "workflow", stageId, state: "running", createdAt: 1, updatedAt: 1, attempt: 1,
        payload: { concept, accumulated, conversation },
      };
      const result = await executor.execute(task, new AbortController().signal, { attemptReason: "initial", modelSnapshot: snapshot });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      accumulated = result.value.accumulated as Record<string, unknown>;
      expect(accumulated.definition).toBe("CORE_ANSWER");
      expect(accumulated).not.toHaveProperty("result");
      conversation = {
        providerId: snapshot.providerId, model: snapshot.model, apiFormat: "gemini-generative-language", endpoint: modelEndpoint(snapshot),
        promptVersion: PROMPT_VERSION, responseContinuationEnabled: false, promptCachingEnabled: false,
        history: [
          ...(conversation?.history ?? []),
          { role: "user", content: result.value.promptUser as string },
          { role: "assistant", content: result.value.responseContent as string },
        ],
      };
    }

    const [core, narrative, structure] = requests;
    expect(core.responsesInput).toBeUndefined();
    expect(core.messages.map((message) => message.role)).toEqual(["user"]);
    expect(core.messages[0].content).toContain("<knowledge_policy>");
    expect(core.messages[0].content).toContain("<web_search_policy>");
    expect(core.messages[0].content).toContain("生成 definition、core_questions、methodology、boundaries。");
    expect(core.messages[0].content).not.toContain("### 本体论");
    expect(core.messages[0].content).not.toContain("<hierarchy_rules>");
    expect(narrative.messages.slice(0, 2)).toEqual([
      core.messages[0],
      { role: "assistant", content: answers.core },
    ]);
    expect(narrative.messages.at(-1)?.content).toContain("生成 historical_genesis 与 holistic_understanding。");
    expect(narrative.messages.at(-1)?.content).toContain("`### 本体论`");
    expect(narrative.messages.at(-1)?.content).not.toContain("<knowledge_policy>");
    expect(structure.messages.slice(0, narrative.messages.length)).toEqual(narrative.messages);
    expect(structure.messages.at(-2)).toEqual({ role: "assistant", content: answers.narrative });
    expect(structure.messages.at(-1)?.content).toContain("<hierarchy_rules>");
    expect(structure.messages.at(-1)?.content).not.toContain("<knowledge_policy>");
    expect(narrative.response_format).toEqual(core.response_format);
    expect(structure.response_format).toEqual(core.response_format);
    const corePlan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(core, core.webSearch);
    const structurePlan = GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(structure, structure.webSearch);
    expect(corePlan.body.systemInstruction).toBeUndefined();
    expect(corePlan.body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "high" } });
    expect(JSON.stringify(corePlan.body)).not.toContain("thinkingBudget");
    const coreContents = corePlan.body.contents as Array<{ parts: Array<{ text: string }> }>;
    const structureContents = structurePlan.body.contents as Array<{ parts: Array<{ text: string }> }>;
    expect(structureContents[0].parts[0].text).toBe(coreContents[0].parts[0].text);
    expect(structurePlan.body.systemInstruction).toBeUndefined();
    expect(structurePlan.body.tools).toEqual([{ google_search: {} }]);
  });
});

describe("default implicit write cache requests", () => {
  for (const apiFormat of ["gemini-generative-language", "openai-responses"] as const) {
    it.each(["domain", "issue", "theory", "entity", "mechanism"] as const)(`${apiFormat} preserves the complete %s input prefix and format across stages`, async type => {
      const registry = new SchemaRegistry();
      const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
      const manager = new PromptManager({ read: async path => ok(await readFile(path, "utf8")) } as FileStorage, logger);
      const snapshot: TaskModelSnapshot = {
        providerId: "synthetic", model: apiFormat === "openai-responses" ? "gpt-6.1-sol" : "gemini-4-argon",
        providerSnapshot: { apiFormat, apiKey: "synthetic", enabled: true, embeddingApiFormat: "disabled", defaultChatModel: "", defaultEmbedModel: "" },
        capabilities: { temperature: false, topP: false, reasoning: true, nativeWebSearch: true, promptCaching: false, responseContinuation: false },
      };
      const sample = (schema: unknown): unknown => {
        const value = schema as { type?: string; anyOf?: unknown[]; enum?: unknown[]; properties?: Record<string, unknown> };
        if (value.anyOf) return sample(value.anyOf[0]);
        if (value.enum) return value.enum[0];
        if (value.type === "array") return [];
        if (value.type === "object") return Object.fromEntries(Object.entries(value.properties ?? {}).map(([key, child]) => [key, sample(child)]));
        if (value.type === "number") return 1;
        return "已验证的合成内容";
      };
      const bodies: Record<string, unknown>[] = [];
      const executor = new WriteTaskExecutor({
        promptManager: manager, schemaRegistry: registry, logger, responsePipeline: new ResponsePipeline(new Validator()),
        providerManager: { chat: async (request: ChatRequest) => {
          bodies.push(apiFormat === "openai-responses"
            ? OPENAI_RESPONSES_ADAPTER.buildRequestBody(request, request.webSearch)
            : GEMINI_GENERATIVE_LANGUAGE_ADAPTER.buildRequestPlan(request, request.webSearch).body);
          const stage = getWriteStageDefinitions(type).find(stage => stage.id === request.requestLabel)!;
          const fields = sample(buildPhaseJsonSchema(registry.getSchema(type), stage.fields)) as Record<string, unknown>;
          return ok({ content: JSON.stringify({ result: { stage: stage.id, ...fields } }), finishReason: "stop" });
        } } as never,
      });
      let accumulated: Record<string, unknown> = {};
      let conversation: ConversationContinuation | undefined;
      for (const stage of getWriteStageDefinitions(type)) {
        const task = { id: stage.id, nodeId: "synthetic", stageId: stage.id, state: "running", createdAt: 1, updatedAt: 1, attempt: 1,
          payload: { concept: { type, name: { chinese: "合成对象", english: "" }, coreDefinition: "合成定义", parents: [], source: "define" }, accumulated, conversation } } as TaskRecord<"write">;
        const result = await executor.execute(task, new AbortController().signal, { attemptReason: "initial", modelSnapshot: snapshot });
        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.error.message);
        accumulated = result.value.accumulated as Record<string, unknown>;
        expect(Object.keys(result.value.phaseResult as object).sort()).toEqual([...stage.fields].sort());
        conversation = { providerId: snapshot.providerId, model: snapshot.model, apiFormat, endpoint: modelEndpoint(snapshot), promptVersion: PROMPT_VERSION,
          promptCachingEnabled: false, responseContinuationEnabled: false, systemPrompt: result.value.systemPrompt as string | undefined,
          history: [...conversation?.history ?? [], { role: "user", content: result.value.promptUser as string }, { role: "assistant", content: result.value.responseContent as string }] };
      }
      const key = apiFormat === "openai-responses" ? "input" : "contents";
      for (let index = 0; index < bodies.length; index++) {
        const body = bodies[index];
        expect(body.prompt_cache_options).toBeUndefined();
        expect(body.cachedContent).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
        const { [key]: input, ...fixed } = body;
        const { [key]: _firstInput, ...firstFixed } = bodies[0];
        expect(Array.isArray(_firstInput)).toBe(true);
        expect(fixed).toEqual(firstFixed);
        if (index > 0) {
          const prior = bodies[index - 1][key] as unknown[];
          expect((input as unknown[]).slice(0, prior.length)).toEqual(prior);
        }
      }
    });
  }
});
