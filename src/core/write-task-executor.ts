import { ok, toErr } from "../types";
import type {
  ConfirmedConcept,
  ILogger,
  TaskExecutionContext,
  Result,
  TaskRecord,
  WriteTaskStageId,
  ConversationContinuation,
  CRType,
} from "../types";
import { buildPhaseJsonSchema, type SchemaRegistry } from "./schema-registry";
import { getWriteStageDefinition, type StageDefinition } from "./stage-catalog";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
import { ResponsePipeline } from "./response-pipeline";
import { buildStableWriteSchema, decodeWriteEnvelope, usesStableWriteEnvelope } from "./write-output-codec";
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

/** Keep the durable draft authoritative. Only omit a field when its exact
 * current value is already in the compatible assistant history being sent. */
async function uncoveredDraftFields(
  accumulated: Record<string, unknown>,
  history: ConversationContinuation["history"],
  envelope: { type: CRType; fullSchema: object; pipeline: ResponsePipeline; taskId: string } | undefined,
): Promise<Record<string, unknown>> {
  const latest = new Map<string, unknown>();
  for (const message of history ?? []) {
    if (message.role !== "assistant") continue;
    try {
      let value: unknown = JSON.parse(message.content);
      if (envelope) {
        const decoded = decodeWriteEnvelope(message.content, envelope.type);
        if (!decoded.ok) return accumulated;
        const phase = getWriteStageDefinition(envelope.type, decoded.value.stageId)!;
        const validated = await envelope.pipeline.validate<Record<string, unknown>>({
          taskId: envelope.taskId,
          rawOutput: JSON.stringify(decoded.value.fields),
          schema: buildPhaseJsonSchema(envelope.fullSchema, phase.fields),
        });
        if (!validated.ok) return accumulated;
        value = validated.value;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return accumulated;
      for (const [field, content] of Object.entries(value)) latest.set(field, content);
    } catch {
      // A repaired/legacy response cannot prove exact field coverage.
      return accumulated;
    }
  }
  return Object.fromEntries(Object.entries(accumulated).filter(([field, value]) =>
    !latest.has(field) || JSON.stringify(value) !== JSON.stringify(latest.get(field))));
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
        ...(phaseResult.value.responsesOutput ? { responsesOutput: phaseResult.value.responsesOutput } : {}),
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
    const stableEnvelope = usesStableWriteEnvelope(args.context.modelSnapshot);
    const wireSchema = stableEnvelope ? buildStableWriteSchema(args.concept.type, args.fullSchema) : phaseSchema;
    const previousContext = Object.keys(args.accumulated).length > 0
      ? JSON.stringify(args.accumulated, null, 2)
      : "";
    const continuation = args.task.payload.conversation;
    const canContinue = canUseContinuation(continuation, args.context.modelSnapshot);
    const canReplay = canReplayConversation(continuation, args.context.modelSnapshot);
    const uncovered = canReplay
      ? await uncoveredDraftFields(args.accumulated, continuation?.history, stableEnvelope
        ? { type: args.concept.type, fullSchema: args.fullSchema, pipeline: this.deps.responsePipeline, taskId: args.task.id } : undefined)
      : args.accumulated;
    const uncoveredContext = Object.keys(uncovered).length > 0 ? JSON.stringify(uncovered, null, 2) : "";

    const templateResult = await this.deps.promptManager.loadPhaseTemplate(
      args.concept.type,
      args.phase.id,
    );
    if (!templateResult.ok) {
      return createTaskError(args.task, templateResult.error);
    }

    const sourcePackage = formatSourcePackage(continuation?.sources);
    let prompt = this.deps.promptManager.buildPhasedWrite({
      CTX_META: args.metaContext,
      CTX_PREVIOUS: [uncoveredContext, sourcePackage].filter(Boolean).join("\n\n"),
      CONCEPT_TYPE: args.concept.type,
    }, templateResult.value);
    if (stableEnvelope) prompt += `\n<write_stage>${args.phase.id}</write_stage>\n`;
    const request = buildTaskChatRequest(
      "write",
      prompt,
      args.context.modelSnapshot,
      wireSchema,
      args.phase.id,
      args.context.attemptReason,
      canReplay ? continuation : { promptCacheKey: continuation?.promptCacheKey },
    );
    // Use the same standard message representation from the first turn onward
    // on the validated envelope path. Native replay already supplies its items.
    if (stableEnvelope && !request.responsesInput) {
      request.responsesInput = request.messages
        .filter(message => message.role !== "system")
        .map(message => ({ role: message.role, content: message.content }));
    }
    const cancelledBeforeRequest = getTaskAbortError<Record<string, unknown>>(args.task, args.signal);
    if (cancelledBeforeRequest) return cancelledBeforeRequest;
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
        "write", fallbackPrompt, args.context.modelSnapshot, wireSchema, args.phase.id,
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

    let rawPhaseOutput = chatResult.value.content;
    if (stableEnvelope) {
      const decoded = decodeWriteEnvelope(rawPhaseOutput, args.concept.type, args.phase.id);
      if (!decoded.ok) return createTaskError(args.task, decoded.error);
      rawPhaseOutput = JSON.stringify(decoded.value.fields);
    }
    const validated = await this.deps.responsePipeline.validate<Record<string, unknown>>({
      taskId: args.task.id,
      rawOutput: rawPhaseOutput,
      schema: phaseSchema,
    });
    if (!validated.ok) return validated;
    const content = Object.fromEntries(args.phase.fields
      .filter((field) => validated.value[field] !== undefined)
      .map((field) => [field, validated.value[field]]));
    return ok({
      ...content,
      // Opaque state is model-specific. Unknown/aliased reported models keep
      // the complete text fallback rather than guessing replay compatibility.
      ...(chatResult.value.responsesOutput && chatResult.value.reportedModel === args.context.modelSnapshot.model
        ? { responsesOutput: chatResult.value.responsesOutput } : {}),
      ...(chatResult.value.responseId ? { responseId: chatResult.value.responseId } : {}),
      systemPrompt: activeRequest.messages.find((message) => message.role === "system")?.content,
      promptUser: [...activeRequest.messages].reverse().find((message) => message.role === "user")?.content,
      responseContent: chatResult.value.content,
      ...(buildSourcePackage(chatResult.value.citations) ? { sourcePackage: buildSourcePackage(chatResult.value.citations) } : {}),
      ...(conversationInvalidated ? { conversationInvalidated: true } : {}),
    });
  }
}
