import { ok, toErr } from "../types";
import type {
  ILogger,
  TaskExecutionContext,
  Result,
  TaskRecord,
} from "../types";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
import type { SchemaRegistry } from "./schema-registry";
import { ResponsePipeline } from "./response-pipeline";
import {
  buildTaskChatRequest,
  buildTaskMetaContext,
  createTaskError,
} from "./task-execution-support";

export interface TagTaskExecutorDependencies {
  providerManager: ModelGateway;
  promptManager: PromptManager;
  responsePipeline: ResponsePipeline;
  schemaRegistry: SchemaRegistry;
  logger: ILogger;
}

export class TagTaskExecutor {
  constructor(private readonly deps: TagTaskExecutorDependencies) {}

  async execute(
    task: TaskRecord<"tag">,
    signal: AbortSignal,
    context: TaskExecutionContext,
  ): Promise<Result<Record<string, unknown>>> {
    try {
      const payload = task.payload;
      if (!payload.concept) {
        return createTaskError(task, { code: "E310_INVALID_STATE", message: "Tag 任务缺少已确认概念" });
      }

      const prompt = this.deps.promptManager.build("tag", {
        CTX_META: buildTaskMetaContext(payload),
      });
      const schema = this.deps.schemaRegistry.getTagSchema();
      const chatResult = await this.deps.providerManager.chat(
        buildTaskChatRequest("tag", prompt, context.modelSnapshot, schema, "tag", context.attemptReason),
        signal,
      );
      if (!chatResult.ok) return createTaskError(task, chatResult.error);

      const finishError = this.deps.responsePipeline.checkFinishReason(task.id, chatResult.value);
      if (finishError) return finishError;
      const validation = await this.deps.responsePipeline.validate({
        taskId: task.id,
        rawOutput: chatResult.value.content,
        schema,
      });
      if (!validation.ok) return validation;

      const data = validation.value;
      return ok({
        aliases: Array.isArray(data.aliases) ? data.aliases : [],
        tags: Array.isArray(data.tags) ? data.tags : [],
      });
    } catch (error) {
      this.deps.logger.error("TagTaskExecutor", "执行 tag 失败", error as Error, { taskId: task.id });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 tag 失败");
    }
  }
}
