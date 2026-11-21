import type { ChatRequest } from "../types";
import {
  buildWebSearchPolicy,
  suppressChatSampling,
} from "./provider-request-builders";
import { parseAnthropicMessagesResponse } from "./provider-response-parsers";
import type {
  ProtocolAdapterMetadata,
  ProtocolWebSearchOptions,
} from "./chat-protocol-adapter";

export const ANTHROPIC_API_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;
const DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS = 16384;

export interface AnthropicRequestPlan {
  body: Record<string, unknown>;
  contentCount: number;
}

export interface AnthropicMessagesAdapter extends ProtocolAdapterMetadata {
  buildRequestPlan(request: ChatRequest, webSearch?: ProtocolWebSearchOptions): AnthropicRequestPlan;
}

interface NormalizedAnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

/** 合并连续同角色消息，满足 Anthropic Messages 的交替轮次约束。 */
function buildAnthropicMessages(messages: ChatRequest["messages"]): {
  systemText: string;
  messages: NormalizedAnthropicMessage[];
} {
  const systemParts: string[] = [];
  const turns: NormalizedAnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const trimmed = message.content.trim();
      if (trimmed) systemParts.push(trimmed);
      continue;
    }
    const last = turns[turns.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      turns.push({ role: message.role, content: message.content });
    }
  }
  return { systemText: systemParts.join("\n\n"), messages: turns };
}

function buildRequestPlan(
  request: ChatRequest,
  webSearch?: ProtocolWebSearchOptions,
): AnthropicRequestPlan {
  const { systemText: baseSystem, messages: rawTurns } = buildAnthropicMessages(request.messages);
  const policy = webSearch ? buildWebSearchPolicy(webSearch.purpose, !!request.response_format) : "";
  const policyAlreadyInSystem = !!policy && baseSystem.includes(policy);
  const systemText = policy && !policyAlreadyInSystem
    ? [baseSystem, policy].filter(Boolean).join("\n\n")
    : baseSystem;

  const caching = request.capabilities?.promptCaching === true;
  const userIndices = rawTurns.flatMap((turn, index) => (turn.role === "user" ? [index] : []));
  // Anthropic 单请求最多允许 4 个 cache_control 断点：system 占 1 个，其余留给最近的 user 轮次。
  const cacheBoundaryIndices = caching
    ? new Set(userIndices.slice(-(systemText ? 3 : 4)))
    : new Set<number>();

  const formattedMessages = rawTurns.map((turn, index) => {
    if (!cacheBoundaryIndices.has(index)) {
      return { role: turn.role, content: turn.content };
    }
    return {
      role: turn.role,
      content: [{ type: "text", text: turn.content, cache_control: { type: "ephemeral" } }],
    };
  });

  const hasBudget = request.thinkingBudget !== undefined;
  const effort = request.reasoning_effort !== undefined && request.reasoning_effort !== "none"
    ? request.reasoning_effort
    : undefined;
  const thinkingActive = suppressChatSampling(
    "anthropic-messages",
    request.model,
    request.reasoning_effort,
    request.thinkingBudget,
  );

  // Anthropic Messages 要求必填 max_tokens，且启用预算思考时必须大于 budget_tokens。
  const maxTokens = request.maxTokens !== undefined
    ? request.maxTokens
    : hasBudget
      ? Math.max(DEFAULT_ANTHROPIC_MAX_TOKENS, request.thinkingBudget! + 4096)
      : effort
        ? DEFAULT_ANTHROPIC_THINKING_MAX_TOKENS
        : DEFAULT_ANTHROPIC_MAX_TOKENS;

  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: maxTokens,
    messages: formattedMessages,
  };

  if (systemText) {
    body.system = caching
      ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
      : systemText;
  }

  if (hasBudget) {
    body.thinking = { type: "enabled", budget_tokens: request.thinkingBudget };
  } else if (effort) {
    body.thinking = { type: "adaptive" };
  }

  const outputConfig: Record<string, unknown> = {};
  if (effort) {
    outputConfig.effort = effort;
  }
  if (request.response_format) {
    outputConfig.format = {
      type: "json_schema",
      schema: request.response_format.json_schema.schema,
    };
  }
  if (Object.keys(outputConfig).length > 0) {
    body.output_config = outputConfig;
  }

  if (!thinkingActive && request.temperature !== undefined) body.temperature = request.temperature;
  if (!thinkingActive && request.topP !== undefined) body.top_p = request.topP;

  if (webSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  return { body, contentCount: formattedMessages.length };
}

export const ANTHROPIC_MESSAGES_ADAPTER: AnthropicMessagesAdapter = {
  apiFormat: "anthropic-messages",
  requestPath: "messages",
  streamProtocol: "anthropic-messages",
  authScheme: "anthropic",
  displayName: "Anthropic Messages",
  extraHeaders: { "anthropic-version": ANTHROPIC_API_VERSION },
  parseResponse: parseAnthropicMessagesResponse,
  buildRequestPlan,
};
