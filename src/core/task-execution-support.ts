import { err } from "../types";
import type {
  ChatRequest,
  ProviderAttemptReason,
  QueueTaskPayload,
  TaskType,
  Result,
  TaskRecord,
  TaskModelSnapshot,
  ConversationContinuation,
  SourcePackage,
  UrlCitation,
} from "../types";
import { buildJsonSchemaResponseFormat } from "./provider-request-builders";
import { buildStrictJsonSchema } from "./schema-registry";
import { splitPromptIntoMessages } from "./prompt-message-builder";
import { normalizeExternalHttpUrl } from "./url-utils";

export const PROMPT_VERSION = "v6";
export function buildPromptCacheKey(
  providerId: string,
  model: string,
  apiFormat = "unknown",
  baseUrl = "",
): string {
  let endpoint = "";
  try {
    const url = new URL(baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    endpoint = url.toString().replace(/\/+$/, "");
  } catch {
    endpoint = baseUrl.trim().replace(/\/+$/, "");
  }
  const raw = `cognitive-razor:${PROMPT_VERSION}:${providerId}:${apiFormat}:${endpoint}:${model}`;
  if (raw.length <= 64) return raw;
  // The Responses API limits this routing key to 64 characters. Keep the
  // readable prefix and add a deterministic suffix to avoid truncation
  // collisions between long provider/model identifiers.
  let hash = 2166136261;
  for (const char of raw) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const suffix = (hash >>> 0).toString(36);
  return `${raw.slice(0, 64 - suffix.length - 1)}:${suffix}`;
}

export function modelEndpoint(snapshot: TaskModelSnapshot): string {
  const provider = snapshot.providerSnapshot;
  return `${provider?.apiFormat ?? ""}|${(provider?.baseUrl ?? "").replace(/\/+$/, "")}`;
}

export function canReplayConversation(
  continuation: ConversationContinuation | undefined,
  snapshot: TaskModelSnapshot,
): boolean {
  return !!continuation
    && continuation.providerId === snapshot.providerId
    && continuation.model === snapshot.model
    && continuation.promptVersion === PROMPT_VERSION
    && continuation.apiFormat === snapshot.providerSnapshot?.apiFormat
    && continuation.endpoint === modelEndpoint(snapshot)
    && continuation.responseContinuationEnabled === (snapshot.capabilities?.responseContinuation === true)
    && continuation.promptCachingEnabled === (snapshot.capabilities?.promptCaching === true)
    && (continuation.promptCacheMode ?? "implicit") === (snapshot.capabilities?.promptCacheMode ?? "implicit");
}

/** A server continuation and locally replayable history are distinct paths. */
export function canUseContinuation(continuation: ConversationContinuation | undefined, snapshot: TaskModelSnapshot): boolean {
  return canReplayConversation(continuation, snapshot) && !!continuation?.previousResponseId &&
    snapshot.providerSnapshot?.apiFormat === "openai-responses" && snapshot.capabilities?.responseContinuation === true &&
    snapshot.capabilities.promptCaching !== true;
}

export function buildSourcePackage(citations?: UrlCitation[]): SourcePackage | undefined {
  const items: SourcePackage["items"] = [];
  const seen = new Set<string>();
  for (const citation of citations ?? []) {
    const url = normalizeExternalHttpUrl(citation.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ url, ...(citation.title?.trim() ? { title: citation.title.trim().slice(0, 240) } : {}) });
    if (items.length >= 12) break;
  }
  return items.length > 0 ? { items } : undefined;
}

export function formatSourcePackage(sources?: SourcePackage): string {
  if (!sources?.items.length) return "";
  return `<source_package>\n${sources.items.map((item, index) => `${index + 1}. ${item.title ? `${item.title} — ` : ""}${item.url}`).join("\n")}\n</source_package>`;
}

export function buildTaskMetaContext(payload: QueueTaskPayload): string {
  const concept = "concept" in payload ? payload.concept : undefined;
  const payloadType = "noteType" in payload ? payload.noteType : undefined;

  return JSON.stringify({
    standard_name_cn: concept?.name.chinese ?? "",
    type: concept?.type ?? payloadType ?? "",
    standard_name_en: concept?.name.english ?? "",
    core_definition: concept?.coreDefinition ?? "",
    parents: concept?.parents ?? [],
  }, null, 2);
}

export function buildTaskChatRequest(
  taskType: TaskType,
  prompt: string,
  modelSnapshot: TaskModelSnapshot,
  structuredSchema?: object,
  requestLabel?: string,
  attemptReason?: ProviderAttemptReason,
  conversation?: ConversationContinuation,
): ChatRequest {
  const serverContinuation = modelSnapshot.capabilities?.responseContinuation === true &&
    modelSnapshot.capabilities.promptCaching !== true && !!conversation?.previousResponseId;
  const request: ChatRequest = {
    providerId: modelSnapshot.providerId,
    providerSnapshot: modelSnapshot.providerSnapshot,
    capabilities: modelSnapshot.capabilities,
    model: modelSnapshot.model,
    requestLabel,
    attemptReason,
    messages: (() => {
      const current = splitPromptIntoMessages(prompt);
      const system = current.find((message) => message.role === "system");
      const user = current.find((message) => message.role === "user");
      // Verify changes roles and output format: its audit rules must replace
      // Write's JSON system instructions. Keep the conversation as context.
      const stableSystem = !serverContinuation && taskType !== "verify" && conversation?.systemPrompt
        ? { role: "system" as const, content: conversation.systemPrompt }
        : system;
      const phaseInstruction = !serverContinuation && conversation?.history?.length && system && stableSystem && system.content !== stableSystem.content
        ? `\n\n<phase_instructions>\n${system.content}\n</phase_instructions>`
        : "";
      return [
        ...(stableSystem ? [stableSystem] : []),
        ...(!serverContinuation ? conversation?.history ?? [] : []),
        ...(user ? [{ ...user, content: `${user.content}${phaseInstruction}` }] : []),
      ];
    })(),
    temperature: modelSnapshot.temperature,
    topP: modelSnapshot.topP,
    maxTokens: modelSnapshot.maxTokens,
    reasoning_effort: modelSnapshot.reasoningEffort,
    thinkingLevel: modelSnapshot.thinkingLevel,
    thinkingBudget: modelSnapshot.thinkingBudget,
    // Responses continuation hides prior stages from this request's prompt.
    // With explicit prompt caching that prevents the accumulated stage context
    // from becoming part of the growing cacheable prefix.
    previousResponseId: serverContinuation ? conversation?.previousResponseId : undefined,
    promptCacheKey: modelSnapshot.capabilities?.promptCaching
      ? buildPromptCacheKey(modelSnapshot.providerId, modelSnapshot.model, modelSnapshot.providerSnapshot?.apiFormat, modelSnapshot.providerSnapshot?.baseUrl)
      : undefined,
    promptCacheMode: modelSnapshot.capabilities?.promptCaching ? (modelSnapshot.capabilities.promptCacheMode ?? "implicit") : undefined,
    promptCacheTtl: modelSnapshot.capabilities?.promptCaching ? modelSnapshot.capabilities.promptCacheTtl : undefined,
  };

  if (structuredSchema && taskType !== "verify" && taskType !== "cards") {
    const schema = buildStrictJsonSchema(structuredSchema);
    request.response_format = buildJsonSchemaResponseFormat(`${taskType}_output`, schema);
  }
  if (modelSnapshot.capabilities?.nativeWebSearch && (taskType === "write" || taskType === "verify")) {
    request.webSearch = { purpose: taskType === "verify" ? "verify" : "write" };
  }

  return request;
}

export function createTaskError<T = Record<string, unknown>>(
  task: TaskRecord,
  error: { code: string; message: string; details?: unknown },
): Result<T> {
  return err(error.code, error.message, {
    taskId: task.id,
    details: error.details,
  });
}

export function getTaskAbortError<T>(task: TaskRecord, signal: AbortSignal): Result<T> | null {
  return signal.aborted
    ? err("E310_INVALID_STATE", "任务已被中断", { taskId: task.id, reason: signal.reason })
    : null;
}

/**
 * Adds a citation only when the Provider supplied a valid range in this exact
 * response. Source lists and unpositioned citations are intentionally not
 * guessed into claims.
 */
export { insertPositionedCitationLinks } from "./positioned-citations";

/** Allow a continuation fallback only when the server explicitly rejects the
 * stored response id. Uncertain transport failures must never duplicate a call. */
export function isInvalidResponseContinuationError(error: { code?: string; message?: string; details?: unknown }): boolean {
  if (error.code !== "E205_PROVIDER_REQUEST_INVALID") return false;
  const details = error.details;
  const detailRecord = details && typeof details === "object" && !Array.isArray(details)
    ? details as Record<string, unknown>
    : undefined;
  // A generic 400 may reject the schema, tools, or cache parameters. Removing
  // the continuation cannot fix those errors and must not trigger a replay.
  const raw = String(detailRecord?.rawResponse ?? "");
  const providerMessage = typeof detailRecord?.providerMessage === "string" ? detailRecord.providerMessage : "";
  const text = `${error.message ?? ""} ${raw} ${providerMessage}`;
  return /(previous[_ `-]?response[_ `-]?id|response[_ `-]?id|conversation).*(invalid|expired|not found|unknown|does not exist|不存在|无效|过期)/i.test(text)
    || /invalid\s*`?previous[_ `-]?response[_ `-]?id/i.test(text);
}
