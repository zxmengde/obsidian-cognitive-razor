import { PROMPT_VERSION } from "./task-execution-support";
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../types";
import type { ChatRequest, TaskExecutionContext, TaskRecord } from "../types";
import { SchemaRegistry } from "./schema-registry";
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
