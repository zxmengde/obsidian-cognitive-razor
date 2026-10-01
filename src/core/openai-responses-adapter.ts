import type { ChatRequest } from "../types";
import {
  buildResponsesInput,
  buildResponsesExplicitCacheInput,
  buildResponsesTextConfig,
  buildWebSearchPolicy,
} from "./provider-request-builders";
import { parseOpenAIResponsesResponse } from "./provider-response-parsers";
import type {
  ChatProtocolAdapter,
  ProtocolWebSearchOptions,
} from "./chat-protocol-adapter";

function buildRequestBody(
  request: ChatRequest,
  webSearch?: ProtocolWebSearchOptions,
): Record<string, unknown> {
  const { instructions: baseInstructions, input: defaultInput } = buildResponsesInput(request.messages);
  const instructions = webSearch
    ? [baseInstructions, buildWebSearchPolicy(webSearch.purpose, !!request.response_format)]
      .filter((content): content is string => !!content)
      .join("\n\n")
    : baseInstructions;

  const explicit = request.promptCacheMode === "explicit";
  const body: Record<string, unknown> = {
    model: request.model,
    input: explicit ? buildResponsesExplicitCacheInput(request.messages).input : defaultInput,
  };
  if (request.previousResponseId) body.previous_response_id = request.previousResponseId;
  if (request.promptCacheKey) body.prompt_cache_key = request.promptCacheKey;
  // Implicit caching is the server default and is supported by older models;
  // only send the GPT-5.6+ option when explicit mode or a TTL was requested.
  if (request.promptCacheMode === "explicit" || request.promptCacheTtl) {
    body.prompt_cache_options = {
      ...(request.promptCacheMode ? { mode: request.promptCacheMode } : {}),
      ...(request.promptCacheTtl ? { ttl: request.promptCacheTtl } : {}),
    };
  }
  if (instructions && !explicit) body.instructions = instructions;
  if (explicit && instructions) {
    const explicitMessages = [
      { role: "system" as const, content: instructions },
      ...request.messages.filter((message) => message.role !== "system"),
    ];
    body.input = buildResponsesExplicitCacheInput(explicitMessages).input;
  }
  if (request.reasoning_effort !== undefined) {
    body.reasoning = { effort: request.reasoning_effort };
  }
  const reasoningActive = request.reasoning_effort !== undefined && request.reasoning_effort !== "none";
  if (!reasoningActive && request.temperature !== undefined) body.temperature = request.temperature;
  if (!reasoningActive && request.topP !== undefined) body.top_p = request.topP;
  if (request.maxTokens !== undefined) body.max_output_tokens = request.maxTokens;

  const textConfig = buildResponsesTextConfig(request.response_format);
  if (textConfig) body.text = { format: textConfig };
  if (webSearch) {
    body.tools = [{ type: "web_search" }];
    // Verify/search requests require an actual search trace. Letting the
    // model choose "auto" can silently produce an uncited answer, which the
    // workflow must then reject after spending a provider call.
    body.tool_choice = "required";
  }
  return body;
}

export const OPENAI_RESPONSES_ADAPTER: ChatProtocolAdapter = {
  apiFormat: "openai-responses",
  requestPath: "responses",
  streamProtocol: "openai-responses",
  authScheme: "bearer",
  displayName: "OpenAI Responses",
  buildRequestBody,
  parseResponse: parseOpenAIResponsesResponse,
};
