import { ok, toErr } from "../types";
import type {
  ILogger,
  TaskExecutionContext,
  Result,
  TaskRecord,
  SourcePackage,
} from "../types";
import type { ModelGateway } from "./model-gateway";
import { insertContextBeforeTask, type PromptManager } from "./prompt-manager";
import { repairLatexText } from "./latex-repair";
import { buildVerifyMetaContext } from "./verify-metadata";
import { stripVerifyReport } from "./semantic-index-text";
import { ResponsePipeline } from "./response-pipeline";
import {
  buildTaskChatRequest,
  createTaskError,
  getTaskAbortError,
  buildSourcePackage,
  formatSourcePackage,
  insertPositionedCitationLinks,
} from "./task-execution-support";

export interface VerifyTaskExecutorDependencies {
  providerManager: ModelGateway;
  promptManager: PromptManager;
  responsePipeline: ResponsePipeline;
  logger: ILogger;
}

export class VerifyTaskExecutor {
  constructor(private readonly deps: VerifyTaskExecutorDependencies) {}

  async execute(
    task: TaskRecord<"verify">,
    signal: AbortSignal,
    context: TaskExecutionContext,
  ): Promise<Result<Record<string, unknown>>> {
    try {
      const payload = task.payload;
      if (!payload.currentContent) {
        return createTaskError(task, { code: "E102_MISSING_FIELD", message: "缺少待验证内容 (currentContent)" });
      }

      const metaContext = buildVerifyMetaContext(payload);
      const prompt = this.deps.promptManager.build("verify", {
        CTX_META: metaContext,
        CTX_CURRENT: stripVerifyReport(payload.currentContent),
      });
      const reportResult = await this.requestNativeReport(task, prompt, signal, context);
      if (!reportResult.ok) return reportResult;

      this.deps.logger.info("VerifyTaskExecutor", `Verify 任务完成: ${task.id}`, {
        reportLength: reportResult.value.reportText.length,
      });
      return ok({
        reportText: reportResult.value.reportText,
        ...(reportResult.value.responseId ? { responseId: reportResult.value.responseId } : {}),
        ...(typeof reportResult.value.promptUser === "string" ? { promptUser: reportResult.value.promptUser } : {}),
        ...(typeof reportResult.value.systemPrompt === "string" ? { systemPrompt: reportResult.value.systemPrompt } : {}),
        ...(typeof reportResult.value.responseContent === "string" ? { responseContent: reportResult.value.responseContent } : {}),
        ...(reportResult.value.sourcePackage ? { sourcePackage: reportResult.value.sourcePackage } : {}),
      });
    } catch (error) {
      this.deps.logger.error("VerifyTaskExecutor", "执行 verify 失败", error as Error, {
        taskId: task.id,
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 verify 失败");
    }
  }

  private async requestNativeReport(
    task: TaskRecord<"verify">,
    prompt: string,
    signal: AbortSignal,
    context: TaskExecutionContext,
  ): Promise<Result<{ reportText: string; responseId?: string; promptUser?: string; responseContent?: string; systemPrompt?: string; sourcePackage?: SourcePackage }>> {
    // Verify 统一不继承 Write 对话历史；若前序写作沉淀了来源清单，仅附带来源包供核查参考。
    const continuation = task.payload.conversation;
    const sourcePackage = formatSourcePackage(continuation?.sources);
    const verifyPrompt = sourcePackage ? insertContextBeforeTask(prompt, sourcePackage) : prompt;
    const request = buildTaskChatRequest("verify", verifyPrompt, context.modelSnapshot, undefined, "verify:report", context.attemptReason);
    const chatResult = await this.deps.providerManager.chat(request, signal);
    const activeRequest = request;
    const abortError = getTaskAbortError<{ reportText: string; responseId?: string; sourcePackage?: SourcePackage }>(task, signal);
    if (abortError) return abortError;
    if (!chatResult.ok) return createTaskError(task, chatResult.error);

    const finishError = this.deps.responsePipeline.checkFinishReason<{ reportText: string; responseId?: string; sourcePackage?: SourcePackage }>(task.id, chatResult.value);
    if (finishError) return finishError;
    const reportText = chatResult.value.content.trim();
    if (!reportText) {
      return createTaskError(task, {
        code: "E102_MISSING_FIELD",
        message: "Verify 报告内容为空",
      });
    }
    const withCitations = insertPositionedCitationLinks(chatResult.value.content, chatResult.value.citations).trim();
    return ok({
      reportText: repairLatexText(withCitations).text,
      responseId: chatResult.value.responseId,
      promptUser: [...activeRequest.messages].reverse().find((message) => message.role === "user")?.content,
      systemPrompt: activeRequest.messages.find((message) => message.role === "system")?.content,
      responseContent: chatResult.value.content,
      sourcePackage: buildSourcePackage(chatResult.value.citations),
    });
  }

}
