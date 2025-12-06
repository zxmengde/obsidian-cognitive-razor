/**
 * TaskRunner - 任务执行器
 * 
 * 负责：
 * - 执行任务流程
 * - 调用 Provider API
 * - 验证结果
 * - 写入协调
 * - 错误处理和重试
 * 
 * 验证需求：1.1, 3.1, 4.2, 7.2
 */

import {
  Result,
  ok,
  err,
  TaskRecord,
  TaskType,
  ChatRequest,
  EmbedRequest,
  CRType,
} from "../types";
import { IProviderManager } from "./provider-manager";
import { PromptManager } from "./prompt-manager";
import { Validator } from "../data/validator";
import { UndoManager } from "./undo-manager";
import { LockManager } from "./lock-manager";
import { RetryHandler, withRetry } from "./retry-handler";
import { FileStorage } from "../data/file-storage";

/**
 * 任务结果
 */
export interface TaskResult {
  /** 任务 ID */
  taskId: string;
  /** 结果数据 */
  data: Record<string, unknown>;
  /** 快照 ID（如果创建了快照） */
  snapshotId?: string;
  /** 使用的 token 数 */
  tokensUsed?: number;
}

/**
 * TaskRunner 配置
 */
export interface TaskRunnerConfig {
  /** Provider 管理器 */
  providerManager: IProviderManager;
  /** 提示词管理器 */
  promptManager: PromptManager;
  /** 验证器 */
  validator: Validator;
  /** 撤销管理器 */
  undoManager: UndoManager;
  /** 锁管理器 */
  lockManager: LockManager;
  /** 文件存储 */
  storage: FileStorage;
  /** 重试处理器 */
  retryHandler: RetryHandler;
  /** 默认 Provider ID */
  defaultProviderId: string;
  /** 默认聊天模型 */
  defaultChatModel: string;
  /** 默认嵌入模型 */
  defaultEmbedModel: string;
}

/**
 * TaskRunner 接口
 */
export interface ITaskRunner {
  /**
   * 运行任务
   */
  run(task: TaskRecord): Promise<Result<TaskResult>>;

  /**
   * 中止任务
   */
  abort(taskId: string): void;
}

/**
 * TaskRunner 实现
 */
export class TaskRunner implements ITaskRunner {
  private config: TaskRunnerConfig;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config: TaskRunnerConfig) {
    this.config = config;
  }

  /**
   * 运行任务
   */
  async run(task: TaskRecord): Promise<Result<TaskResult>> {
    // 创建 AbortController 用于中止任务
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    try {
      // 获取锁
      const lockResult = this.config.lockManager.acquireNodeLock(
        task.nodeId,
        task.id
      );
      if (!lockResult.ok) {
        return lockResult;
      }

      // 根据任务类型执行
      let result: Result<TaskResult>;
      switch (task.taskType) {
        case "standardizeClassify":
          result = await this.runStandardizeClassify(task);
          break;
        case "enrich":
          result = await this.runEnrich(task);
          break;
        case "embedding":
          result = await this.runEmbedding(task);
          break;
        case "reason:new":
        case "reason:incremental":
        case "reason:merge":
          result = await this.runReasoning(task);
          break;
        default:
          result = err(
            "UNKNOWN_TASK_TYPE",
            `未知的任务类型: ${task.taskType}`,
            { taskType: task.taskType }
          );
      }

      return result;
    } finally {
      // 清理 AbortController
      this.abortControllers.delete(task.id);

      // 释放锁
      this.config.lockManager.releaseNodeLock(task.nodeId, task.id);
    }
  }

  /**
   * 中止任务
   */
  abort(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
  }

  /**
   * 执行标准化和分类任务
   */
  private async runStandardizeClassify(
    task: TaskRecord
  ): Promise<Result<TaskResult>> {
    const { payload } = task;
    const conceptDescription = payload.conceptDescription as string;

    if (!conceptDescription) {
      return err(
        "MISSING_PAYLOAD",
        "缺少必需的 payload 字段: conceptDescription"
      );
    }

    // 使用重试包装器
    return withRetry(
      async (attempt, errorHistory) => {
        // 渲染提示词
        const promptResult = this.config.promptManager.render(
          "standardizeClassify",
          {
            concept_description: conceptDescription,
            error_history: this.config.retryHandler.buildErrorHistoryPrompt(errorHistory),
          }
        );

        if (!promptResult.ok) {
          return promptResult;
        }

        // 调用 Provider
        const providerId = task.providerRef || this.config.defaultProviderId;
        const chatRequest: ChatRequest = {
          providerId,
          model: this.config.defaultChatModel,
          messages: [
            {
              role: "user",
              content: promptResult.value,
            },
          ],
          temperature: 0.7,
        };

        const chatResult = await this.config.providerManager.chat(chatRequest);
        if (!chatResult.ok) {
          return chatResult;
        }

        // 验证 JSON
        const jsonResult = this.config.validator.validateJSON(
          chatResult.value.content
        );
        if (!jsonResult.ok) {
          return jsonResult;
        }

        // 验证标准化输出
        const validationResult = this.config.validator.validateStandardizeOutput(
          jsonResult.value
        );
        if (!validationResult.valid) {
          const firstError = validationResult.errors[0];
          return err(
            firstError.code,
            firstError.message,
            { errors: validationResult.errors }
          );
        }

        // 返回结果
        return ok({
          taskId: task.id,
          data: validationResult.data as Record<string, unknown>,
          tokensUsed: chatResult.value.tokensUsed,
        });
      },
      this.config.retryHandler,
      task.maxAttempts
    );
  }

  /**
   * 执行内容生成任务
   */
  private async runEnrich(task: TaskRecord): Promise<Result<TaskResult>> {
    const { payload } = task;
    const conceptName = payload.conceptName as string;
    const conceptType = payload.conceptType as CRType;
    const coreDefinition = payload.coreDefinition as string;

    if (!conceptName || !conceptType || !coreDefinition) {
      return err(
        "MISSING_PAYLOAD",
        "缺少必需的 payload 字段: conceptName, conceptType, coreDefinition"
      );
    }

    // 使用重试包装器
    return withRetry(
      async (attempt, errorHistory) => {
        // 渲染提示词
        const promptResult = this.config.promptManager.render("enrich", {
          concept_name: conceptName,
          concept_type: conceptType,
          core_definition: coreDefinition,
          error_history: this.config.retryHandler.buildErrorHistoryPrompt(errorHistory),
        });

        if (!promptResult.ok) {
          return promptResult;
        }

        // 调用 Provider
        const providerId = task.providerRef || this.config.defaultProviderId;
        const chatRequest: ChatRequest = {
          providerId,
          model: this.config.defaultChatModel,
          messages: [
            {
              role: "user",
              content: promptResult.value,
            },
          ],
          temperature: 0.7,
        };

        const chatResult = await this.config.providerManager.chat(chatRequest);
        if (!chatResult.ok) {
          return chatResult;
        }

        // 验证 JSON
        const jsonResult = this.config.validator.validateJSON(
          chatResult.value.content
        );
        if (!jsonResult.ok) {
          return jsonResult;
        }

        // 验证内容生成输出
        const validationResult = this.config.validator.validateEnrichOutput(
          jsonResult.value,
          conceptType
        );
        if (!validationResult.valid) {
          const firstError = validationResult.errors[0];
          return err(
            firstError.code,
            firstError.message,
            { errors: validationResult.errors }
          );
        }

        // 返回结果
        return ok({
          taskId: task.id,
          data: validationResult.data as Record<string, unknown>,
          tokensUsed: chatResult.value.tokensUsed,
        });
      },
      this.config.retryHandler,
      task.maxAttempts
    );
  }

  /**
   * 执行嵌入生成任务
   */
  private async runEmbedding(task: TaskRecord): Promise<Result<TaskResult>> {
    const { payload } = task;
    const text = payload.text as string;

    if (!text) {
      return err("MISSING_PAYLOAD", "缺少必需的 payload 字段: text");
    }

    // 使用重试包装器（仅针对 API 错误）
    return withRetry(
      async () => {
        // 调用 Provider
        const providerId = task.providerRef || this.config.defaultProviderId;
        const embedRequest: EmbedRequest = {
          providerId,
          model: this.config.defaultEmbedModel,
          input: text,
        };

        const embedResult = await this.config.providerManager.embed(embedRequest);
        if (!embedResult.ok) {
          return embedResult;
        }

        // 返回结果
        return ok({
          taskId: task.id,
          data: {
            embedding: embedResult.value.embedding,
          },
          tokensUsed: embedResult.value.tokensUsed,
        });
      },
      this.config.retryHandler,
      task.maxAttempts
    );
  }

  /**
   * 执行推理任务
   */
  private async runReasoning(task: TaskRecord): Promise<Result<TaskResult>> {
    const { payload, taskType } = task;

    // 根据推理类型选择提示词模板
    let promptId: string;
    let slots: Record<string, string>;

    switch (taskType) {
      case "reason:new":
        promptId = this.getReasoningPromptId(payload.conceptType as CRType);
        slots = this.convertPayloadToSlots(payload);
        break;
      case "reason:incremental":
        promptId = "reason-incremental";
        slots = this.convertPayloadToSlots(payload);
        break;
      case "reason:merge":
        promptId = "reason-merge";
        slots = this.prepareMergeSlots(payload);
        break;
      default:
        return err("UNKNOWN_TASK_TYPE", `未知的推理任务类型: ${taskType}`);
    }

    // 使用重试包装器
    return withRetry(
      async (attempt, errorHistory) => {
        // 渲染提示词
        const promptResult = this.config.promptManager.render(promptId, {
          ...slots,
          error_history: this.config.retryHandler.buildErrorHistoryPrompt(errorHistory),
        });

        if (!promptResult.ok) {
          return promptResult;
        }

        // 调用 Provider
        const providerId = task.providerRef || this.config.defaultProviderId;
        const chatRequest: ChatRequest = {
          providerId,
          model: this.config.defaultChatModel,
          messages: [
            {
              role: "user",
              content: promptResult.value,
            },
          ],
          temperature: 0.7,
        };

        const chatResult = await this.config.providerManager.chat(chatRequest);
        if (!chatResult.ok) {
          return chatResult;
        }

        // 验证 JSON
        const jsonResult = this.config.validator.validateJSON(
          chatResult.value.content
        );
        if (!jsonResult.ok) {
          return jsonResult;
        }

        // 如果是内容生成，验证输出
        if (taskType === "reason:new" && payload.conceptType) {
          const validationResult = this.config.validator.validateEnrichOutput(
            jsonResult.value,
            payload.conceptType as CRType
          );
          if (!validationResult.valid) {
            const firstError = validationResult.errors[0];
            return err(
              firstError.code,
              firstError.message,
              { errors: validationResult.errors }
            );
          }
        }

        // 返回结果
        return ok({
          taskId: task.id,
          data: jsonResult.value as Record<string, unknown>,
          tokensUsed: chatResult.value.tokensUsed,
        });
      },
      this.config.retryHandler,
      task.maxAttempts
    );
  }

  /**
   * 根据概念类型获取推理提示词 ID
   */
  private getReasoningPromptId(type: CRType): string {
    switch (type) {
      case "Domain":
        return "reason-domain";
      case "Issue":
        return "reason-issue";
      case "Theory":
        return "reason-theory";
      case "Entity":
        return "reason-entity";
      case "Mechanism":
        return "reason-mechanism";
      default:
        return "reason-domain";
    }
  }

  /**
   * 将 payload 转换为槽位值
   */
  private convertPayloadToSlots(
    payload: Record<string, unknown>
  ): Record<string, string> {
    const slots: Record<string, string> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "string") {
        slots[key] = value;
      } else if (value !== null && value !== undefined) {
        slots[key] = JSON.stringify(value);
      }
    }

    return slots;
  }

  /**
   * 准备合并任务的槽位值
   */
  private prepareMergeSlots(
    payload: Record<string, unknown>
  ): Record<string, string> {
    const noteA = payload.noteA as any;
    const noteB = payload.noteB as any;
    const similarity = payload.similarity as number;

    return {
      uid_a: noteA.nodeId,
      name_a: noteA.name,
      content_a: noteA.content,
      uid_b: noteB.nodeId,
      name_b: noteB.name,
      content_b: noteB.content,
      similarity: similarity.toFixed(2),
    };
  }
}
