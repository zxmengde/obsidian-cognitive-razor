import type { ChatRequest } from "../types";
import {
  buildGeminiContents,
  buildGeminiGenerationConfig,
  buildWebSearchPolicy,
} from "./provider-request-builders";
import { parseGeminiGenerateResponse } from "./provider-response-parsers";
import type {
  ProtocolAdapterMetadata,
  ProtocolWebSearchOptions,
} from "./chat-protocol-adapter";

export interface GeminiRequestPlan {
  body: Record<string, unknown>;
  contentCount: number;
}

export interface GeminiGenerativeLanguageAdapter extends ProtocolAdapterMetadata {
  buildRequestPath(model: string): string;
  buildRequestPlan(request: ChatRequest, webSearch?: ProtocolWebSearchOptions): GeminiRequestPlan;
}

function buildRequestPath(model: string): string {
  return `models/${encodeURIComponent(model)}:generateContent`;
}

function buildRequestPlan(
  request: ChatRequest,
  webSearch?: ProtocolWebSearchOptions,
): GeminiRequestPlan {
  const messages = webSearch
    ? [...request.messages, {
      role: "system" as const,
      content: buildWebSearchPolicy(webSearch.purpose, !!request.response_format),
    }]
    : request.messages;
  const { systemInstruction, contents } = buildGeminiContents(messages);
  const generationConfig = buildGeminiGenerationConfig(request);
  const body: Record<string, unknown> = { contents };

  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
  if (webSearch) body.tools = [{ google_search: {} }];
  return { body, contentCount: contents.length };
}

export const GEMINI_GENERATIVE_LANGUAGE_ADAPTER: GeminiGenerativeLanguageAdapter = {
  apiFormat: "gemini-generative-language",
  requestPath: "models/{model}:generateContent",
  streamProtocol: "gemini-generative-language",
  authScheme: "gemini",
  displayName: "Gemini Generative Language",
  parseResponse: parseGeminiGenerateResponse,
  buildRequestPath,
  buildRequestPlan,
};
