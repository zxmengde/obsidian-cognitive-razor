import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ok, type TaskRecord, type ChatRequest, type TaskExecutionContext } from "../types";
import type { FileStorage } from "../data/file-storage";
import { PromptManager } from "./prompt-manager";
import { CardsTaskExecutor } from "./cards-task-executor";
import type { ModelGateway } from "./model-gateway";
import { CARDS_PROMPT_VERSION } from "./card-generation";

async function setup(content: string, finishReason = "stop") {
  const prompts = new PromptManager({ read: async (path: string) => ok(await readFile(path, "utf8")) } as FileStorage,
    { debug() {}, info() {}, warn() {}, error() {} });
  expect((await prompts.preloadAllTemplates()).ok).toBe(true);
  const chat = vi.fn(async (_request: ChatRequest) => ok({ content, finishReason }));
  const executor = new CardsTaskExecutor({ promptManager: prompts, providerManager: { chat } as unknown as ModelGateway });
  const task: TaskRecord<"cards"> = { id: "cards", nodeId: "node", stageId: "cards", state: "running", createdAt: 0, updatedAt: 0, attempt: 1,
    payload: { filePath: "a.md", targetPath: "b.md", body: "知识".repeat(7000), noteType: "entity", promptVersion: CARDS_PROMPT_VERSION } };
  const context: TaskExecutionContext = { attemptReason: "initial", modelSnapshot: { providerId: "cards-provider", model: "cards-model", maxTokens: 2048,
    capabilities: { nativeWebSearch: true, responseContinuation: true, promptCaching: false, temperature: false, topP: false, reasoning: false } } };
  return { executor, task, context, chat };
}

describe("cards executor", () => {
  it("sends complete body with the independent model and no Verify search, schema, or history", async () => {
    const f = await setup("## 问题\n答案\n\n|问|答|\n|---|---|\n|一|二|\n\n概念是==关系==。");
    expect((await f.executor.execute(f.task, new AbortController().signal, f.context)).ok).toBe(true);
    const request = f.chat.mock.calls[0][0];
    expect(request).toMatchObject({ providerId: "cards-provider", model: "cards-model", maxTokens: 2048 });
    expect(request.messages).toHaveLength(2);
    expect(request.messages[1].content).toContain("知识".repeat(7000));
    expect(request.webSearch).toBeUndefined(); expect(request.response_format).toBeUndefined(); expect(request.previousResponseId).toBeUndefined();
  });
  it("accepts a Markdown link at the start instead of treating it as JSON", async () => {
    const f = await setup("[背景](https://example.test)\n\n## 问题\n答案");
    expect((await f.executor.execute(f.task, new AbortController().signal, f.context)).ok).toBe(true);
  });
  it.each(["length", "content_filter"])("rejects incomplete results (%s)", async (reason) => {
    const f = await setup("## 部分结果\n不能追加", reason);
    expect((await f.executor.execute(f.task, new AbortController().signal, f.context)).ok).toBe(false);
  });
  it.each(["", "{\"cards\":[]}", "[]", "<!doctype html><html>error</html>", "```markdown\n## q\na\n```"])("rejects empty or clearly non-Markdown output: %s", async (content) => {
    const f = await setup(content);
    expect((await f.executor.execute(f.task, new AbortController().signal, f.context)).ok).toBe(false);
  });
});
