import type {
  ChatRequest,
} from "../types";
import { parseOpenAIChatResponse } from "./provider-response-parsers";
import type { ChatProtocolAdapter } from "./chat-protocol-adapter";

function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
  };
  const reasoningActive = request.reasoning_effort !== undefined && request.reasoning_effort !== "none";
  if (!reasoningActive && request.temperature !== undefined) body.temperature = request.temperature;
  if (!reasoningActive && request.topP !== undefined) body.top_p = request.topP;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.reasoning_effort !== undefined) body.reasoning_effort = request.reasoning_effort;
  if (request.response_format) body.response_format = request.response_format;
  return body;
}

export const OPENAI_CHAT_COMPLETIONS_ADAPTER: ChatProtocolAdapter = {
  apiFormat: "openai-chat-completions",
  requestPath: "chat/completions",
  streamProtocol: "openai-chat-completions",
  authScheme: "bearer",
  displayName: "OpenAI Chat Completions",
  buildRequestBody,
  parseResponse: parseOpenAIChatResponse,
};
