import { resolveTaskModelSnapshot } from "./task-model-resolver";
/** 任务执行器 - 负责执行单个任务，调用 Provider 和验证输出 */

import {
  ok,
  err,
} from "../types";
import type {
  ILogger,
  TaskRecord,
  Result,
  TaskExecutionContext,
  TaskModelSnapshot,
} from "../types";
import type { SchemaRegistry } from "./schema-registry";
import type { ModelGateway } from "./model-gateway";
import type { PromptManager } from "./prompt-manager";
import type { SettingsStore } from "../data/settings-store";
import type { Validator } from "../data/validator";
import { ResponsePipeline } from "./response-pipeline";
import { TaskExecutorRegistry } from "./task-executor-registry";
import { CardsTaskExecutor } from "./cards-task-executor";
import { TagTaskExecutor } from "./tag-task-executor";
import { WriteTaskExecutor } from "./write-task-executor";
import { VerifyTaskExecutor } from "./verify-task-executor";
import { getStageRole } from "./stage-catalog";
import type { DuplicateMergeService } from "./duplicate-merge-service";
import {
  getTaskAbortError,
} from "./task-execution-support";

type TaskOutput = Record<string, unknown>;

/** TaskRunner 依赖接口 */
interface TaskRunnerDependencies {
  providerManager: ModelGateway;
  promptManager: PromptManager;
  validator: Validator;
  logger: ILogger;
  schemaRegistry: SchemaRegistry;
  settingsStore: SettingsStore;
  duplicateMergeService?: DuplicateMergeService;
}

export class TaskRunner {
  private executorRegistry: TaskExecutorRegistry;
  private logger: ILogger;
  private settingsStore: SettingsStore;
  private abortControllers: Map<string, AbortController>;

  constructor(deps: TaskRunnerDependencies) {
    this.logger = deps.logger;
    const responsePipeline = new ResponsePipeline(deps.validator);
    const tagExecutor = new TagTaskExecutor({
      providerManager: deps.providerManager,
      promptManager: deps.promptManager,
      responsePipeline,
      schemaRegistry: deps.schemaRegistry,
      logger: deps.logger,
    });
    const writeExecutor = new WriteTaskExecutor({
      providerManager: deps.providerManager,
      promptManager: deps.promptManager,
      responsePipeline,
      schemaRegistry: deps.schemaRegistry,
      logger: deps.logger,
    });
    const verifyExecutor = new VerifyTaskExecutor({
      providerManager: deps.providerManager,
      promptManager: deps.promptManager,
      responsePipeline,
      logger: deps.logger,
    });
    const cardsExecutor = new CardsTaskExecutor(deps);
    this.executorRegistry = new TaskExecutorRegistry();
    this.executorRegistry.register("cards", (task, signal, context) => cardsExecutor.execute(task as TaskRecord<"cards">, signal, context));
    this.executorRegistry.register("merge", async (task, signal, context) => {
      if (task.stageId !== "merge" || !deps.duplicateMergeService) return err("E310_INVALID_STATE", "合并稿执行器尚未就绪");
      const preview = await deps.duplicateMergeService.prepareCapturedMerge(task.payload, context.modelSnapshot, signal);
      return preview.ok ? ok({ preview: preview.value }) : preview;
    });
    this.executorRegistry.register("tag", (task, signal, attemptReason) =>
      tagExecutor.execute(task as TaskRecord<"tag">, signal, attemptReason));
    this.executorRegistry.register("write", (task, signal, attemptReason) =>
      writeExecutor.execute(task as TaskRecord<"core" | "narrative" | "structure" | "process" | "synthesis">, signal, attemptReason));
    this.executorRegistry.register("verify", (task, signal, attemptReason) =>
      verifyExecutor.execute(task as TaskRecord<"verify">, signal, attemptReason));
    this.settingsStore = deps.settingsStore;
    this.abortControllers = new Map();
    this.logger.debug("TaskRunner", "TaskRunner 初始化完成");
  }


  /** 执行任务 - 验证 Provider 配置后分发到具体执行方法 */
  async run(
    task: TaskRecord,
    context?: TaskExecutionContext,
  ): Promise<Result<TaskOutput>> {
    const startTime = Date.now();
    const executionContext: TaskExecutionContext = context ?? {
      attemptReason: task.attempt > 1 ? "manual-retry" : "initial",
      modelSnapshot: this.resolveModel(task),
    };

    const providerCheck = this.validateProviderConfiguration(task, executionContext.modelSnapshot);
    if (!providerCheck.ok) {
      this.logger.error("TaskRunner", "Provider 配置验证失败", undefined, {
        taskId: task.id,
        error: providerCheck.error
      });
      return providerCheck;
    }

    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    try {
      this.logger.info("TaskRunner", `开始执行任务: ${task.id}`, {
        stageId: task.stageId,
        nodeId: task.nodeId,
      });

      let result: Result<TaskOutput> = await this.executorRegistry.execute(task, abortController.signal, executionContext);

      const abortError = getTaskAbortError<TaskOutput>(task, abortController.signal);
      if (abortError) result = abortError;

      const elapsedTime = Date.now() - startTime;

      if (result.ok) {
        this.logger.info("TaskRunner", `任务执行成功: ${task.id}`, {
          stageId: task.stageId,
          elapsedTime
        });
      } else {
        this.logger.error("TaskRunner", `任务执行失败: ${task.id}`, undefined, {
          stageId: task.stageId,
          error: result.error,
          elapsedTime
        });
      }

      return result;
    } catch (error) {
      const elapsedTime = Date.now() - startTime;

      this.logger.error("TaskRunner", `任务执行异常: ${task.id}`, error as Error, {
        stageId: task.stageId,
        elapsedTime
      });

      return err("E500_INTERNAL_ERROR", "任务执行异常", error);
    } finally {
      if (this.abortControllers.get(task.id) === abortController) {
        this.abortControllers.delete(task.id);
      }
    }
  }

  /** 中断任务执行 */
  abort(taskId: string): void {
    const abortController = this.abortControllers.get(taskId);
    if (abortController) {
      abortController.abort("task cancelled");
      this.abortControllers.delete(taskId);
      this.logger.info("TaskRunner", `任务已中断: ${taskId}`);
    }
  }







  /**
   * 验证 Provider 能力匹配
   * 
   * 遵循设计文档 A-FUNC-03：
   * 任务执行前必须找到匹配的 Provider 与 PDD 模板；
   * 缺失或能力不符时本地终止并返回可诊断错误。
   * 
   * @param task 任务记录
   * @returns 验证结果
   */
  private validateProviderConfiguration(task: TaskRecord, modelSnapshot: TaskModelSnapshot): Result<void> {
    const role = getStageRole(task.stageId);
    const providerId = modelSnapshot.providerId;
    if (!providerId) {
      return err("E401_PROVIDER_NOT_CONFIGURED", "请先配置 Provider", {
        stageId: task.stageId,
        role,
        hint: "打开设置 → Cognitive Razor → AI 服务"
      });
    }

    this.logger.debug("TaskRunner", "验证 Provider 配置", {
      taskId: task.id,
      stageId: task.stageId,
      role,
      providerId,
    });

    // The snapshot is captured at attempt start and is authoritative for the
    // whole attempt. Do not re-read mutable settings here: a user may edit or
    // remove the provider while an in-flight attempt is still running.
    if (!modelSnapshot.providerSnapshot || modelSnapshot.providerSnapshot.enabled === false) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider ${providerId} 在本次尝试开始时不可用`, {
        providerId, stageId: task.stageId, role,
      });
    }

    if (!modelSnapshot.model.trim()) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `阶段 ${task.stageId} 未配置有效模型`, {
        providerId,
        stageId: task.stageId,
        role,
      });
    }

    // 任务路径不做网络预检；协议兼容性由真实 chat/embed 请求最终验证。
    this.logger.debug("TaskRunner", "Provider 本地配置验证通过", {
      taskId: task.id,
      providerId,
    });

    return ok(undefined);
  }

  private resolveModel(task: TaskRecord): TaskModelSnapshot {
    return resolveTaskModelSnapshot(this.settingsStore.getSettings(), getStageRole(task.stageId));
  }
}
