import { err, ok, type TaskRecord, type TaskExecutionContext, type Result } from "../types";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
import { buildTaskChatRequest } from "./task-execution-support";
import { validateChatFinishReason } from "./provider-response-parsers";
import { CARDS_PROMPT_VERSION } from "./card-generation";

export class CardsTaskExecutor {
  constructor(private readonly deps: { providerManager: ModelGateway; promptManager: PromptManager }) {}
  async execute(task: TaskRecord<"cards">, signal: AbortSignal, context: TaskExecutionContext): Promise<Result<Record<string, unknown>>> {
    if (task.payload.promptVersion !== CARDS_PROMPT_VERSION) return err("E310_INVALID_STATE", "卡片提示词版本已变更，请重新生成");
    const prompt = this.deps.promptManager.build("cards", { CTX_CURRENT: task.payload.body });
    const response = await this.deps.providerManager.chat(buildTaskChatRequest("cards", prompt, context.modelSnapshot, undefined, "cards", context.attemptReason), signal);
    if (!response.ok) return response;
    if (signal.aborted) return err("E206_PROVIDER_REQUEST_UNCERTAIN", "卡片请求已中断，不追加结果");
    const finish = validateChatFinishReason(response.value.finishReason, { taskId: task.id });
    if (!finish.ok) return finish;
    const markdown = response.value.content.trim();
    let isJson = false;
    try { const parsed: unknown = JSON.parse(markdown); isJson = parsed !== null && typeof parsed === "object"; } catch { /* Markdown is not JSON. */ }
    if (!markdown || isJson || /^(?:<!doctype|<html\b|```)/i.test(markdown)) return err("E211_MODEL_SCHEMA_VIOLATION", "卡片结果为空或明显不是可追加的 Markdown 正文");
    return ok({ markdown, targetPath: task.payload.targetPath });
  }
}
