import { ok, toErr } from "../types";
import type {
  ConfirmedConcept,
  ILogger,
  TaskExecutionContext,
  Result,
  TaskRecord,
  WriteTaskStageId,
} from "../types";
import { buildPhaseJsonSchema, type SchemaRegistry } from "./schema-registry";
import { getWriteStageDefinition, type StageDefinition } from "./stage-catalog";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
import { ResponsePipeline } from "./response-pipeline";
import {
  buildTaskChatRequest,
  buildTaskMetaContext,
  createTaskError,
  getTaskAbortError,
  buildSourcePackage,
  formatSourcePackage,
  isInvalidResponseContinuationError,
  canUseContinuation,
  canReplayConversation,
} from "./task-execution-support";

interface WritePhaseExecution {
  task: TaskRecord<WriteTaskStageId>;
  concept: ConfirmedConcept;
  signal: AbortSignal;
  phase: StageDefinition;
  fullSchema: object;
  metaContext: string;
  accumulated: Record<string, unknown>;
  context: TaskExecutionContext;
}

export interface WriteTaskExecutorDependencies {
  providerManager: ModelGateway;
  promptManager: PromptManager;
  responsePipeline: ResponsePipeline;
  schemaRegistry: SchemaRegistry;
  logger: ILogger;
}

export class WriteTaskExecutor {
  constructor(private readonly deps: WriteTaskExecutorDependencies) {}

  async execute(
    task: TaskRecord<WriteTaskStageId>,
    signal: AbortSignal,
    context: TaskExecutionContext,
  ): Promise<Result<Record<string, unknown>>> {
    return this.executeSinglePhase(task, signal, context);
  }

  private async executeSinglePhase(
    task: TaskRecord<WriteTaskStageId>,
    signal: AbortSignal,
    context: TaskExecutionContext,
  ): Promise<Result<Record<string, unknown>>> {
    try {
      const payload = task.payload;
      const concept = payload.concept;
      if (!concept) {
        return createTaskError(task, { code: "E310_INVALID_STATE", message: "Write 任务缺少已确认概念" });
      }
      const stageId = task.stageId;
      const phase = getWriteStageDefinition(concept.type, stageId);
      if (!phase) {
        return createTaskError(task, { code: "E310_INVALID_STATE", message: `未找到 ${concept.type} 的写作阶段: ${stageId}` });
      }
      const fullSchema = this.deps.schemaRegistry.getSchema(concept.type);
      const accumulated = payload.accumulated && typeof payload.accumulated === "object" && !Array.isArray(payload.accumulated)
        ? { ...payload.accumulated }
        : {};
      const metaContext = buildTaskMetaContext(payload);
      const abortError = getTaskAbortError<Record<string, unknown>>(task, signal);
      if (abortError) return abortError;
      const phaseResult = await this.executePhase({
        task,
        concept,
        signal,
        phase,
        fullSchema,
        metaContext,
        accumulated,
        context,
      });
      if (!phaseResult.ok) return phaseResult;
      const generatedContent = Object.fromEntries(phase.fields
        .filter((field) => phaseResult.value[field] !== undefined)
        .map((field) => [field, phaseResult.value[field]]));
      const merged = { ...accumulated, ...generatedContent };
      this.deps.logger.info("WriteTaskExecutor", `写作阶段完成: ${phase.id}`, {
        taskId: task.id,
        phase: phase.id,
        fieldsGenerated: phase.fields.filter((field) => merged[field] !== undefined),
      });
      return ok({
        stageId: phase.id,
        phaseResult: generatedContent,
        accumulated: merged,
        ...(phaseResult.value.responseId ? { responseId: phaseResult.value.responseId } : {}),
        ...(typeof phaseResult.value.promptUser === "string" ? { promptUser: phaseResult.value.promptUser } : {}),
        ...(typeof phaseResult.value.responseContent === "string" ? { responseContent: phaseResult.value.responseContent } : {}),
        ...(typeof phaseResult.value.systemPrompt === "string" ? { systemPrompt: phaseResult.value.systemPrompt } : {}),
        ...(phaseResult.value.sourcePackage ? { sourcePackage: phaseResult.value.sourcePackage } : {}),
        ...(phaseResult.value.conversationInvalidated ? { conversationInvalidated: true } : {}),
      });
    } catch (error) {
      this.deps.logger.error("WriteTaskExecutor", "执行单个 write 阶段失败", error as Error, { taskId: task.id });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 write 阶段失败");
    }
  }

  private async executePhase(args: WritePhaseExecution): Promise<Result<Record<string, unknown>>> {
    const phaseSchema = buildPhaseJsonSchema(args.fullSchema, args.phase.fields);
    const previousContext = Object.keys(args.accumulated).length > 0
      ? JSON.stringify(args.accumulated, null, 2)
      : "";
    const continuation = args.task.payload.conversation;
    const canContinue = canUseContinuation(continuation, args.context.modelSnapshot);
    const canReplay = canReplayConversation(continuation, args.context.modelSnapshot);

    const templateResult = await this.deps.promptManager.loadPhaseTemplate(
      args.concept.type,
      args.phase.id,
    );
    if (!templateResult.ok) {
      return createTaskError(args.task, templateResult.error);
    }

    const sourcePackage = formatSourcePackage(continuation?.sources);
    const prompt = this.deps.promptManager.buildPhasedWrite({
      CTX_META: args.metaContext,
      CTX_PREVIOUS: [canContinue ? "" : previousContext, sourcePackage].filter(Boolean).join("\n\n"),
      CONCEPT_TYPE: args.concept.type,
    }, templateResult.value);
    const request = buildTaskChatRequest(
      "write",
      prompt,
      args.context.modelSnapshot,
      phaseSchema,
      args.phase.id,
      args.context.attemptReason,
      canReplay ? continuation : { promptCacheKey: continuation?.promptCacheKey },
    );
    let chatResult = await this.deps.providerManager.chat(request, args.signal);
    let activeRequest = request;
    let conversationInvalidated = false;
    if (!chatResult.ok && canContinue && isInvalidResponseContinuationError(chatResult.error)) {
      conversationInvalidated = true;
      const fallbackPrompt = this.deps.promptManager.buildPhasedWrite({
        CTX_META: args.metaContext,
        CTX_PREVIOUS: `${previousContext}${sourcePackage ? `\n\n${sourcePackage}` : ""}`,
        CONCEPT_TYPE: args.concept.type,
      }, templateResult.value);
      const fallbackRequest = buildTaskChatRequest(
        "write", fallbackPrompt, args.context.modelSnapshot, phaseSchema, args.phase.id,
        args.context.attemptReason, { promptCacheKey: continuation?.promptCacheKey },
      );
      activeRequest = fallbackRequest;
      chatResult = await this.deps.providerManager.chat(fallbackRequest, args.signal);
    }
    const abortError = getTaskAbortError<Record<string, unknown>>(args.task, args.signal);
    if (abortError) return abortError;
    if (!chatResult.ok) return createTaskError(args.task, chatResult.error);

    const finishError = this.deps.responsePipeline.checkFinishReason<Record<string, unknown>>(args.task.id, chatResult.value);
    if (finishError) return finishError;

    const validated = await this.deps.responsePipeline.validate<Record<string, unknown>>({
      taskId: args.task.id,
      rawOutput: chatResult.value.content,
      schema: phaseSchema,
    });
    if (!validated.ok) return validated;
    const content = Object.fromEntries(args.phase.fields
      .filter((field) => validated.value[field] !== undefined)
      .map((field) => [field, validated.value[field]]));
    return ok({
      ...content,
      ...(chatResult.value.responseId ? { responseId: chatResult.value.responseId } : {}),
      systemPrompt: activeRequest.messages.find((message) => message.role === "system")?.content,
      promptUser: [...activeRequest.messages].reverse().find((message) => message.role === "user")?.content,
      responseContent: chatResult.value.content,
      ...(buildSourcePackage(chatResult.value.citations) ? { sourcePackage: buildSourcePackage(chatResult.value.citations) } : {}),
      ...(conversationInvalidated ? { conversationInvalidated: true } : {}),
    });
  }
}
