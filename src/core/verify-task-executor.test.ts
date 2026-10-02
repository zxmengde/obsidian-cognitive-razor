import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { ok } from "../types";
import type { ChatRequest, ILogger, TaskRecord } from "../types";
import type { ModelGateway } from "./model-gateway";
import { PromptManager } from "./prompt-manager";
import type { FileStorage } from "../data/file-storage";
import { OPENAI_RESPONSES_ADAPTER } from "./openai-responses-adapter";
import { ResponsePipeline } from "./response-pipeline";
import { Validator } from "../data/validator";
import { VerifyTaskExecutor } from "./verify-task-executor";

describe("VerifyTaskExecutor", () => {
  it.each([
    { promptCaching: false, promptCacheMode: "implicit" as const },
    { promptCaching: true, promptCacheMode: "implicit" as const },
    { promptCaching: true, promptCacheMode: "explicit" as const },
  ])("uses Markdown audit instructions after JSON writing with $promptCaching caching in $promptCacheMode mode", async ({ promptCaching, promptCacheMode }) => {
    const chat = vi.fn(async (_request: ChatRequest) => ok({ content: "## 认识论审计报告:\n总体评估: 通过", finishReason: "stop" }));
    const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
    const promptManager = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    expect((await promptManager.preloadAllTemplates()).ok).toBe(true);
    const executor = new VerifyTaskExecutor({
      providerManager: { chat } as unknown as ModelGateway,
      promptManager,
      responsePipeline: new ResponsePipeline(new Validator()), logger,
    });
    const history = [{ role: "user" as const, content: "生成写作阶段 JSON" }, { role: "assistant" as const, content: '{"summary":"已有正文"}' }];
    const task: TaskRecord<"verify"> = {
      id: "verify-after-write", nodeId: "note", stageId: "verify", state: "running", createdAt: 0, updatedAt: 0, attempt: 1,
      payload: { filePath: "note.md", currentContent: "已有正文", noteType: "entity", conversation: {
        providerId: "provider", model: "model", apiFormat: "openai-responses", endpoint: "openai-responses|https://relay.test/v1", promptVersion: "v3",
        previousResponseId: "resp_write", responseContinuationEnabled: true, promptCachingEnabled: promptCaching, promptCacheMode,
        systemPrompt: "写作规则：只输出一个符合 Schema 的 JSON 对象。", history,
      } },
    };
    const result = await executor.execute(task, new AbortController().signal, {
      attemptReason: "initial", modelSnapshot: {
        providerId: "provider", model: "model",
        providerSnapshot: { apiKey: "", apiFormat: "openai-responses", baseUrl: "https://relay.test/v1", embeddingApiFormat: "disabled", defaultChatModel: "model", defaultEmbedModel: "", enabled: true },
        capabilities: { temperature: false, topP: false, reasoning: false, structuredOutput: "json_schema", nativeWebSearch: true, promptCaching, promptCacheMode, responseContinuation: true },
      },
    });

    expect(result.ok).toBe(true);
    expect(chat).toHaveBeenCalledOnce();
    const request = chat.mock.calls[0][0];
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("只输出以下 Markdown 结构");
    expect(request.messages[0].content).not.toContain("只输出一个符合 Schema 的 JSON 对象");
    expect(request.messages.slice(1, 3)).toEqual(history);
    expect(request.response_format).toBeUndefined();
    expect(request.previousResponseId).toBe(promptCaching ? undefined : "resp_write");
    if (promptCaching) expect(request.promptCacheKey).toBeTruthy();
    else expect(request.promptCacheKey).toBeUndefined();
    expect(request.webSearch).toEqual({ purpose: "verify" });
    const body = OPENAI_RESPONSES_ADAPTER.buildRequestBody(request, request.webSearch);
    const effectiveInstructions = promptCacheMode === "explicit"
      ? (body.input as Array<{ role: string; content: string }>).find((message) => message.role === "developer")?.content
      : body.instructions;
    expect(effectiveInstructions).toContain("只输出以下 Markdown 结构");
    expect(effectiveInstructions).not.toContain("只输出一个符合 Schema 的 JSON 对象");
    expect(body.text).toBeUndefined();
    expect(body.previous_response_id).toBe(promptCaching ? undefined : "resp_write");
  });

  it("supplies real snapshot metadata through a user-customized Verify template without rewriting it", async () => {
    const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
    const custom = '<system_instructions>CUSTOM_VERIFY_POLICY<output_format>自定义输出</output_format></system_instructions>\n<context_slots>{{CTX_META}}\n{{CTX_CURRENT}}</context_slots>\n<task_instruction>保留我的审计规则</task_instruction>';
    const promptManager = new PromptManager({ read: async (path: string) => ok(path.endsWith('/operations/verify.md') ? custom : await readFile(path, 'utf8')) } as FileStorage, logger);
    expect((await promptManager.preloadAllTemplates()).ok).toBe(true);
    const chat = vi.fn(async (_request: ChatRequest) => ok({ content: '## 我的自定义报告\n正文', finishReason: 'stop' }));
    const executor = new VerifyTaskExecutor({ providerManager: { chat } as unknown as ModelGateway, promptManager, responsePipeline: new ResponsePipeline(new Validator()), logger });
    const currentContent = '---\nname: Actual name\ncruid: synthetic\ntype: mechanism\n---\n# Different fixture heading\nBody unchanged.';
    const task: TaskRecord<'verify'> = { id: 'verify-custom', nodeId: 'synthetic', stageId: 'verify', state: 'running', createdAt: 0, updatedAt: 0, attempt: 1, payload: { filePath: 'Fixture.md', noteType: 'mechanism', currentContent } };
    const result = await executor.execute(task, new AbortController().signal, { attemptReason: 'initial', modelSnapshot: { providerId: 'provider', model: 'model', capabilities: { temperature: false, topP: false, reasoning: false, structuredOutput: 'prompt', nativeWebSearch: false, promptCaching: false, responseContinuation: false } } });
    expect(result).toMatchObject({ ok: true, value: { reportText: '## 我的自定义报告\n正文' } });
    const request = chat.mock.calls[0][0];
    expect(request.messages[0].content).toContain('CUSTOM_VERIFY_POLICY');
    const user = request.messages.at(-1)!.content;
    expect(user).toContain('"name": "Actual name"');
    expect(user).not.toContain('standard_name_cn');
    expect(user).toContain(currentContent);
    expect(user).toContain('保留我的审计规则');
    expect(task.payload.currentContent).toBe(currentContent);
    expect(chat).toHaveBeenCalledOnce();
  });

  it("preserves citation positions when trimming report whitespace", async () => {
    const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
    const executor = new VerifyTaskExecutor({
      providerManager: { chat: async () => ok({ content: "\n\n结论成立。后续说明。\n", citations: [
        { url: "https://example.test/source", title: "来源", startIndex: 2, endIndex: 6 },
      ] }) } as unknown as ModelGateway,
      promptManager: { build: () => "<system_instructions>核查</system_instructions>\n核查内容" } as unknown as PromptManager,
      responsePipeline: new ResponsePipeline(new Validator()),
      logger,
    });
    const task: TaskRecord<"verify"> = {
      id: "verify", nodeId: "note", stageId: "verify", state: "running", createdAt: 0, updatedAt: 0, attempt: 1,
      payload: { filePath: "note.md", currentContent: "笔记正文", noteType: "entity" },
    };
    expect(await executor.execute(task, new AbortController().signal, {
      attemptReason: "initial", modelSnapshot: { providerId: "provider", model: "model", capabilities: {
        temperature: false, topP: false, reasoning: false, structuredOutput: "prompt",
        nativeWebSearch: false, promptCaching: false, responseContinuation: false,
      } },
    })).toMatchObject({ ok: true, value: { reportText: "结论成立 [来源](https://example.test/source)。后续说明。" } });
  });
});
