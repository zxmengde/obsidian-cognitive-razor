/** 任务执行器 - 负责执行单个任务，调用 Provider 和验证输出 */

import {
  ok,
  err,
  CognitiveRazorError,
  toErr,
} from "../types";
import type {
  ILogger,
  TaskRecord,
  TaskResult,
  TaskError,
  TaskType,
  CRType,
  StandardizedConcept,
  NoteState,
  Result,
  ChatRequest,
  DefinePayload,
  TagPayload,
  WritePayload,
  AmendPayload as TypedAmendPayload,
  MergePayload as TypedMergePayload,
  IndexPayload,
  VerifyPayload,
  ImageGeneratePayload,
  AnyTaskPayload,
  TypedTaskRecord
} from "../types";
import { schemaRegistry, SchemaRegistry, WRITE_PHASES } from "./schema-registry";
import { createConceptSignature, generateSignatureText } from "./naming-utils";
import { mapStandardizeOutput } from "./standardize-mapper";
import type { ProviderManager } from "./provider-manager";
import type { PromptManager } from "./prompt-manager";
import type { UndoManager } from "./undo-manager";
import type { VectorIndex } from "./vector-index";
import type { SettingsStore } from "../data/settings-store";
import { DEFAULT_TASK_MODEL_CONFIGS } from "../data/settings-store";
import type { Validator } from "../data/validator";
import { App, MarkdownView, TFile } from "obsidian";
import { dataUrlToArrayBuffer, inferImageExtension } from "../utils/image";
import { formatCRTimestamp } from "../utils/date-utils";
import { NoteRepository } from "./note-repository";

/** 任务管线顺序 */
const TASK_PIPELINE_ORDER: TaskType[] = [
  "define",
  "tag",
  "write",
  "index",
  "verify"
];

// 本地 AmendPayload / MergePayload 已移除，使用 types.ts 中的类型安全定义
// TypedAmendPayload = AmendPayload from types.ts
// TypedMergePayload = MergePayload from types.ts


/** 类型必填字段定义 */
const TYPE_REQUIRED_FIELDS: Record<CRType, string[]> = {
  Domain: [
    "definition",
    "teleology", 
    "methodology",
    "historical_genesis",
    "boundaries",
    "sub_domains",
    "issues",
    "holistic_understanding"
  ],
  Issue: [
    "definition",
    "core_tension",
    "significance",
    "epistemic_barrier",
    "counter_intuition",
    "historical_genesis",
    "sub_issues",
    "stakeholder_perspectives",
    "boundary_conditions",
    "theories",
    "holistic_understanding"
  ],
  Theory: [
    "definition",
    "axioms",
    "sub_theories",
    "logical_structure",
    "entities",
    "mechanisms",
    "core_predictions",
    "limitations",
    "historical_genesis",
    "holistic_understanding"
  ],
  Entity: [
    "definition",
    "classification",
    "properties",
    "states",
    "constraints",
    "composition",
    "distinguishing_features",
    "examples",
    "counter_examples",
    "holistic_understanding"
  ],
  Mechanism: [
    "definition",
    "trigger_conditions",
    "operates_on",
    "causal_chain",
    "modulation",
    "inputs",
    "outputs",
    "side_effects",
    "termination_conditions",
    "holistic_understanding"
  ]
};


class InputValidator {
  private readonly MAX_INPUT_LENGTH = 10000;
  private readonly SUSPICIOUS_PATTERNS = [
    /ignore\s+previous\s+instructions/i,
    /system\s*:/i,
    /\[INST\]/i,
    /<\|im_start\|>/i
  ];

  validate(input: string): string {
    if (typeof input !== "string") {
      throw new CognitiveRazorError("E101_INVALID_INPUT", "输入必须是字符串");
    }
    if (input.length > this.MAX_INPUT_LENGTH) {
      throw new CognitiveRazorError("E101_INVALID_INPUT", `输入过长: ${input.length} 字符 (最大 ${this.MAX_INPUT_LENGTH})`, {
        length: input.length,
        maxLength: this.MAX_INPUT_LENGTH
      });
    }
    for (const pattern of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(input)) {
        throw new CognitiveRazorError("E101_INVALID_INPUT", "输入包含可疑指令，请检查后再试");
      }
    }
    const sanitized = input.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();
    return sanitized;
  }
}


/** TaskRunner 依赖接口 */
interface TaskRunnerDependencies {
  providerManager: ProviderManager;
  promptManager: PromptManager;
  validator: Validator;
  undoManager: UndoManager;
  logger: ILogger;
  vectorIndex?: VectorIndex;
  schemaRegistry?: SchemaRegistry;
  settingsStore?: SettingsStore;
  noteRepository?: NoteRepository;
  app: App;
}

/** 写入操作上下文 */
interface WriteContext {
  filePath: string;
  content: string;
  nodeId: string;
  taskId: string;
  originalContent?: string;
}

interface TaskHandler {
  taskType: TaskType;
  run: (task: TaskRecord, signal: AbortSignal) => Promise<Result<TaskResult>>;
}

/**
 * 将 TaskRecord 按 taskType 窄化为 TypedTaskRecord
 * 由于 TaskRecord 的 payload 已是 AnyTaskPayload 联合类型，
 * 通过 taskType 判别式可安全窄化。
 */
function narrowTask(task: TaskRecord): TypedTaskRecord {
  return task as TypedTaskRecord;
}

export class TaskRunner {
  private providerManager: ProviderManager;
  private promptManager: PromptManager;
  private validator: Validator;
  private undoManager: UndoManager;
  private logger: ILogger;
  private vectorIndex?: VectorIndex;
  private schemaRegistry: SchemaRegistry;
  private settingsStore?: SettingsStore;
  private abortControllers: Map<string, AbortController>;
  private inputValidator: InputValidator;
  private app: App;
  private noteRepository: NoteRepository;
  private taskHandlers: Map<TaskType, TaskHandler>;

  constructor(deps: TaskRunnerDependencies) {
    this.providerManager = deps.providerManager;
    this.promptManager = deps.promptManager;
    this.validator = deps.validator;
    this.undoManager = deps.undoManager;
    this.logger = deps.logger;
    this.vectorIndex = deps.vectorIndex;
    // 使用注入的 SchemaRegistry 或默认单例
    this.schemaRegistry = deps.schemaRegistry || schemaRegistry;
    this.settingsStore = deps.settingsStore;
    this.app = deps.app;
    this.noteRepository = deps.noteRepository ?? new NoteRepository(deps.app, deps.logger);
    this.abortControllers = new Map();
    this.inputValidator = new InputValidator();
    this.taskHandlers = new Map([
      [
        "define",
        { taskType: "define", run: (task, signal) => this.executeDefine(task, signal) }
      ],
      [
        "tag",
        { taskType: "tag", run: (task, signal) => this.executeTag(task, signal) }
      ],
      [
        "index",
        { taskType: "index", run: (task, signal) => this.executeIndex(task, signal) }
      ],
      [
        "write",
        { taskType: "write", run: (task, signal) => this.executeWrite(task, signal) }
      ],
      [
        "amend",
        { taskType: "amend", run: (task, signal) => this.executeAmend(task, signal) }
      ],
      [
        "merge",
        { taskType: "merge", run: (task, signal) => this.executeMerge(task, signal) }
      ],
      [
        "verify",
        { taskType: "verify", run: (task, signal) => this.executeVerify(task, signal) }
      ],
      [
        "image-generate",
        { taskType: "image-generate", run: (task, signal) => this.executeImageGenerate(task, signal) }
      ],
    ]);

    this.logger.debug("TaskRunner", "TaskRunner 初始化完成");
  }


  /** 执行任务 - 验证 Provider 能力后分发到具体执行方法 */
  async run(task: TaskRecord): Promise<Result<TaskResult>> {
    const startTime = Date.now();
    
    const capabilityCheck = await this.validateProviderCapability(task);
    if (!capabilityCheck.ok) {
      this.logger.error("TaskRunner", "Provider 能力验证失败", undefined, {
        taskId: task.id,
        error: capabilityCheck.error
      });
      return capabilityCheck as Result<TaskResult>;
    }

    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    try {
      this.logger.info("TaskRunner", `开始执行任务: ${task.id}`, {
        taskType: task.taskType,
        nodeId: task.nodeId,
        attempt: task.attempt
      });

      // 根据任务类型分发
      const handler = this.taskHandlers.get(task.taskType);
      const result = handler
        ? await handler.run(task, abortController.signal)
        : err("E310_INVALID_STATE", `未知的任务类型: ${task.taskType}`);

      const elapsedTime = Date.now() - startTime;

      if (result.ok) {
        this.logger.info("TaskRunner", `任务执行成功: ${task.id}`, {
          taskType: task.taskType,
          elapsedTime
        });
      } else {
        this.logger.error("TaskRunner", `任务执行失败: ${task.id}`, undefined, {
          taskType: task.taskType,
          error: result.error,
          elapsedTime
        });
      }

      return result;
    } catch (error) {
      const elapsedTime = Date.now() - startTime;
      
      this.logger.error("TaskRunner", `任务执行异常: ${task.id}`, error as Error, {
        taskType: task.taskType,
        elapsedTime
      });

      return err("E500_INTERNAL_ERROR", "任务执行异常", error);
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  /** 中断任务执行 */
  abort(taskId: string): void {
    const abortController = this.abortControllers.get(taskId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(taskId);
      this.logger.info("TaskRunner", `任务已中断: ${taskId}`);
    }
  }


  /** 创建写入前快照 */
  async createSnapshotBeforeWrite(context: WriteContext): Promise<Result<string>> {
    try {
      this.logger.debug("TaskRunner", "创建写入前快照", {
        filePath: context.filePath,
        nodeId: context.nodeId,
        taskId: context.taskId
      });

      // 获取原始内容（如果未提供）
      let originalContent = context.originalContent;
      if (originalContent === undefined) {
        const existing = await this.noteRepository.readByPathIfExists(context.filePath);
        originalContent = existing ?? "";
      }

      // 如果文件不存在，使用空字符串作为原始内容
      if (originalContent === undefined) {
        originalContent = "";
      }

      // 创建快照
      const snapshotResult = await this.undoManager.createSnapshot(
        context.filePath,
        originalContent,
        context.taskId,
        context.nodeId
      );

      if (!snapshotResult.ok) {
        this.logger.error("TaskRunner", "创建快照失败", undefined, {
          filePath: context.filePath,
          error: snapshotResult.error
        });
        return snapshotResult;
      }

      this.logger.info("TaskRunner", `快照已创建: ${snapshotResult.value}`, {
        filePath: context.filePath,
        nodeId: context.nodeId,
        taskId: context.taskId
      });

      return snapshotResult;
    } catch (error) {
      this.logger.error("TaskRunner", "创建快照异常", error as Error, {
        filePath: context.filePath
      });
      return err("E304_SNAPSHOT_FAILED", "创建快照失败", error);
    }
  }




  /** 更新笔记状态 */
  async updateNoteStatus(filePath: string, newStatus: NoteState): Promise<Result<void>> {
    try {
      const content = await this.noteRepository.readByPathIfExists(filePath);
      if (content === null) {
        return err("E301_FILE_NOT_FOUND", `目标文件不存在: ${filePath}`, { filePath });
      }
      
      // 更新 frontmatter 中的 status 字段
      const updatedContent = this.updateFrontmatterStatus(content, newStatus);
      
      await this.noteRepository.writeAtomic(filePath, updatedContent);

      this.logger.info("TaskRunner", `笔记状态已更新为 ${newStatus}`, { filePath });
      return ok(undefined);
    } catch (error) {
      this.logger.error("TaskRunner", "更新笔记状态失败", error as Error, { filePath });
      return err("E302_PERMISSION_DENIED", "更新笔记状态失败", error);
    }
  }

  /** 更新 frontmatter 中的 status 字段 */
  private updateFrontmatterStatus(content: string, newStatus: NoteState): string {
    // 匹配 YAML frontmatter
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
      return content;
    }

    const frontmatter = match[1];
    const withStatus = frontmatter.replace(
      /^status:\s*.*$/m,
      `status: ${newStatus}`
    );
    const now = formatCRTimestamp();
    const updatedFrontmatter = withStatus.replace(
      /^updated:\s*.*$/m,
      `updated: ${now}`
    );

    return content.replace(frontmatterRegex, `---\n${updatedFrontmatter}\n---`);
  }


  /** 完成合并流程 - 删除被合并笔记并更新向量索引 */
  async completeMergeFlow(
    keepNodeId: string,
    deleteNodeId: string,
    deleteFilePath: string
  ): Promise<Result<void>> {
    try {
      this.logger.info("TaskRunner", "开始完成合并流程", {
        keepNodeId,
        deleteNodeId,
        deleteFilePath
      });

      // 1. 删除被合并的笔记文件
      const deleted = await this.noteRepository.deleteByPathIfExists(deleteFilePath);
      if (!deleted) {
        this.logger.warn("TaskRunner", "被合并笔记不存在，跳过删除", { deleteFilePath });
      } else {
        this.logger.info("TaskRunner", `已删除被合并笔记: ${deleteFilePath}`);
      }

      // 2. 从向量索引中移除被合并的条目
      if (this.vectorIndex) {
        const deleteIndexResult = await this.vectorIndex.delete(deleteNodeId);
        if (!deleteIndexResult.ok) {
          this.logger.warn("TaskRunner", "从向量索引移除条目失败", {
            deleteNodeId,
            error: deleteIndexResult.error
          });
          // 不阻断流程，继续执行
        } else {
          this.logger.info("TaskRunner", `已从向量索引移除: ${deleteNodeId}`);
        }
      }

      this.logger.info("TaskRunner", "合并流程完成", {
        keepNodeId,
        deleteNodeId
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error("TaskRunner", "完成合并流程失败", error as Error, {
        keepNodeId,
        deleteNodeId
      });
      return err("E500_INTERNAL_ERROR", "完成合并流程失败", error);
    }
  }


  /** 验证任务管线顺序 */
  validatePipelineOrder(previousTaskType: TaskType | null, currentTaskType: TaskType): boolean {
    // 如果没有前一个任务，任何任务都可以开始
    if (previousTaskType === null) {
      return true;
    }

    const previousIndex = TASK_PIPELINE_ORDER.indexOf(previousTaskType);
    const currentIndex = TASK_PIPELINE_ORDER.indexOf(currentTaskType);

    // 如果任务类型不在管线中，允许执行
    if (previousIndex === -1 || currentIndex === -1) {
      return true;
    }

    // 对于新概念创建流程，验证顺序
    // define(0) → tag(1) → write(2) → index(3) → verify(4)
    if (currentTaskType === "index") {
      // index 必须在 write 之后
      return previousTaskType === "write" || previousIndex <= 2;
    }

    // 一般情况：当前任务索引应该大于等于前一个任务索引
    return currentIndex >= previousIndex;
  }

  /** 获取任务管线中的下一个任务类型 */
  getNextPipelineTask(currentTaskType: TaskType): TaskType | null {
    const currentIndex = TASK_PIPELINE_ORDER.indexOf(currentTaskType);
    
    if (currentIndex === -1 || currentIndex >= TASK_PIPELINE_ORDER.length - 1) {
      return null;
    }

    // 新概念创建流程的下一步
    switch (currentTaskType) {
      case "define":
        return "tag";
      case "tag":
        return "write";
      case "write":
        return "index";
      default:
        return null;
    }
  }


  // 任务执行方法

  /** 执行 define 任务 */
  private async executeDefine(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 DefinePayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "define") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 define" });
      }
      const payload = typed.payload;
      const sanitizedInput = this.inputValidator.validate(payload.userInput);

      // 构建 prompt（CTX_INPUT）
      const slots = {
        CTX_INPUT: sanitizedInput,
        CTX_LANGUAGE: this.getLanguage()
      };

      const prompt = this.promptManager.build(task.taskType, slots);

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("define", task.providerRef);

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: ChatRequest = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens,
        reasoning_effort: modelConfig.reasoning_effort
      };
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 使用 SchemaRegistry 的定义 Schema 校验
      const schema = this.schemaRegistry.getDefineSchema();
      const validationResult = await this.validator.validate(
        chatResult.value.content,
        schema,
        ["C009"]
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      // 解析结果并标准化键名
      const data = (validationResult.data as Record<string, unknown>) || JSON.parse(chatResult.value.content);
      const parsed = mapStandardizeOutput(data);

      return ok({
        taskId: task.id,
        state: "Completed",
        data: parsed as unknown as Record<string, unknown>
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 define 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 define 失败");
    }
  }

  /** 执行 tag 任务 */
  private async executeTag(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 TagPayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "tag") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 tag" });
      }
      const payload = typed.payload;
      const metaContext = this.buildMetaContext(payload);
      const slots = {
        CTX_META: metaContext,
        CTX_LANGUAGE: this.getLanguage()
      };

      const prompt = this.promptManager.build(task.taskType, slots);

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("tag", task.providerRef);

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: ChatRequest = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens,
        reasoning_effort: modelConfig.reasoning_effort
      };
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 验证输出
      const schema = {
        type: "object",
        properties: {
          aliases: { type: "array" },
          tags: { type: "array" }
        },
        required: ["aliases", "tags"]
      };

      const validationResult = await this.validator.validate(
        chatResult.value.content,
        schema,
        []
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      // 解析结果
      const data = (validationResult.data as Record<string, unknown>) || JSON.parse(chatResult.value.content);
      const parsed = {
        aliases: Array.isArray(data.aliases) ? data.aliases : [],
        tags: Array.isArray(data.tags) ? data.tags : []
      };

      return ok({
        taskId: task.id,
        state: "Completed",
        data: parsed
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 tag 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 tag 失败");
    }
  }


  /** 执行 index 任务 */
  private async executeIndex(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 IndexPayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "index") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 index" });
      }
      const payload = typed.payload;

      // 优先使用上游生成的签名文本；否则基于标准化结果构建
      let text = payload.text;

      if (!text) {
        const standardized = payload.standardizedData;
        if (!standardized) {
          return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "缺少标准化数据，无法生成嵌入文本" });
        }

        const primaryType = (standardized.primaryType || payload.conceptType || "Entity") as CRType;
        const currentName = standardized.standardNames?.[primaryType];
        if (!currentName) {
          return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "标准化名称缺失，无法生成嵌入文本" });
        }

        const signature = createConceptSignature(
          {
            standardName: currentName,
            aliases: Array.isArray(payload.aliases) ? payload.aliases : [],
            coreDefinition: standardized.coreDefinition
          },
          primaryType,
          payload.namingTemplate || "{{chinese}} ({{english}})"
        );
        text = generateSignatureText(signature);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("index", task.providerRef);

      // 调用 Embedding API（使用用户配置的模型和向量维度）
      const embeddingDimension = this.vectorIndex?.getEmbeddingDimension()
        ?? modelConfig.embeddingDimension
        ?? this.settingsStore?.getSettings().embeddingDimension
        ?? 1536;
      const embeddingModel = this.vectorIndex?.getEmbeddingModel() ?? modelConfig.model;
      const embedResult = await this.providerManager.embed({
        providerId: task.providerRef || modelConfig.providerId,
        model: embeddingModel,
        input: text,
        dimensions: embeddingDimension
      }, signal);

      if (!embedResult.ok) {
        return this.createTaskError(task, embedResult.error!);
      }

      return ok({
        taskId: task.id,
        state: "Completed",
        data: {
          embedding: embedResult.value.embedding,
          tokensUsed: embedResult.value.tokensUsed,
          text
        }
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 index 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 index 失败");
    }
  }

  /** 执行 write 任务（分阶段 Chain-of-Fields） */
  private async executeWrite(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 WritePayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "write") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 write" });
      }
      const payload = typed.payload;
      const conceptType = (payload.conceptType || "Entity") as CRType;
      const fullSchema = this.getSchema(conceptType);
      const sources = typeof payload.sources === "string" ? payload.sources : "";
      const metaContext = this.buildMetaContext(payload);
      const language = this.getLanguage();

      // 获取分阶段配置
      const phases = WRITE_PHASES[conceptType];
      if (!phases || phases.length === 0) {
        // 回退到旧的一次性生成
        return this.executeWriteLegacy(task, signal);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("write", task.providerRef);

      // 累积已生成的字段
      const accumulated: Record<string, unknown> = {};

      this.logger.info("TaskRunner", `开始分阶段 Write: ${conceptType}`, {
        taskId: task.id,
        phaseCount: phases.length
      });

      // 逐阶段调用 LLM
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];

        // 检查中断信号
        if (signal.aborted) {
          return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务已被中断" });
        }

        // 构建本阶段的 schema 片段
        const phaseSchema = this.buildPhaseSchema(fullSchema, phase.fields);

        // 构建已生成内容的上下文
        const previousContext = Object.keys(accumulated).length > 0
          ? JSON.stringify(accumulated, null, 2)
          : "";

        // 构建分阶段 prompt
        const prompt = this.promptManager.buildPhasedWrite({
          CTX_META: metaContext,
          CTX_PREVIOUS: previousContext,
          CTX_SOURCES: sources,
          CTX_LANGUAGE: language,
          CONCEPT_TYPE: conceptType,
          PHASE_SCHEMA: phaseSchema,
          PHASE_FOCUS: phase.focusInstruction
        });

        // 调用 LLM
        const chatResult = await this.providerManager.chat({
          providerId: task.providerRef || modelConfig.providerId,
          model: modelConfig.model,
          messages: [{ role: "user", content: prompt }],
          temperature: modelConfig.temperature,
          topP: modelConfig.topP,
          maxTokens: modelConfig.maxTokens,
          reasoning_effort: modelConfig.reasoning_effort
        }, signal);

        if (!chatResult.ok) {
          return this.createTaskError(task, chatResult.error!);
        }

        // 验证本阶段输出（仅验证本阶段的字段）
        const phaseValidationSchema = this.buildPhaseValidationSchema(fullSchema, phase.fields);
        const validationResult = await this.validator.validate(
          chatResult.value.content,
          phaseValidationSchema,
          []
        );

        if (!validationResult.valid) {
          this.logger.warn("TaskRunner", `阶段 ${phase.id} 验证失败，尝试解析原始内容`, {
            taskId: task.id,
            phase: phase.id,
            errors: validationResult.errors
          });
          // 尝试直接解析 JSON
          try {
            const content = chatResult.value.content.trim();
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : content;
            const parsed = JSON.parse(jsonStr);
            // 仅提取本阶段的字段
            for (const field of phase.fields) {
              if (parsed[field] !== undefined) {
                accumulated[field] = parsed[field];
              }
            }
          } catch {
            return this.createValidationError(task, validationResult.errors!);
          }
        } else {
          // 合并本阶段结果到累积数据
          const phaseData = (validationResult.data as Record<string, unknown>) || {};
          for (const field of phase.fields) {
            if (phaseData[field] !== undefined) {
              accumulated[field] = phaseData[field];
            }
          }
        }

        this.logger.info("TaskRunner", `阶段 ${phase.id} 完成`, {
          taskId: task.id,
          phase: phase.id,
          phaseIndex: i + 1,
          totalPhases: phases.length,
          fieldsGenerated: phase.fields.filter(f => accumulated[f] !== undefined)
        });
      }

      // 创建快照（写入前）
      const skipSnapshot = payload.skipSnapshot === true;
      if (payload.filePath && !skipSnapshot) {
        const snapshotResult = await this.createSnapshotBeforeWrite({
          filePath: payload.filePath,
          content: "",
          nodeId: task.nodeId,
          taskId: task.id,
          originalContent: payload.originalContent || ""
        });
        if (snapshotResult.ok) {
          accumulated.snapshotId = snapshotResult.value;
        }
      }

      return ok({
        taskId: task.id,
        state: "Completed",
        data: accumulated
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 write 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 write 失败");
    }
  }

  /** 旧版一次性 Write（回退路径） */
  private async executeWriteLegacy(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    const typed = narrowTask(task);
    if (typed.taskType !== "write") {
      return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配" });
    }
    const payload = typed.payload;
    const conceptType = payload.conceptType || "Entity";
    const schema = this.getSchema(conceptType);
    const sources = typeof payload.sources === "string" ? payload.sources : "";

    const slots = {
      CTX_META: this.buildMetaContext(payload),
      CTX_SOURCES: sources,
      CTX_LANGUAGE: this.getLanguage()
    };

    const prompt = this.promptManager.build(task.taskType, slots, conceptType);
    const modelConfig = this.getTaskModelConfig("write", task.providerRef);

    const chatResult = await this.providerManager.chat({
      providerId: task.providerRef || modelConfig.providerId,
      model: modelConfig.model,
      messages: [{ role: "user", content: prompt }],
      temperature: modelConfig.temperature,
      topP: modelConfig.topP,
      maxTokens: modelConfig.maxTokens,
      reasoning_effort: modelConfig.reasoning_effort
    }, signal);

    if (!chatResult.ok) {
      return this.createTaskError(task, chatResult.error!);
    }

    const validationResult = await this.validator.validate(
      chatResult.value.content, schema, []
    );

    if (!validationResult.valid) {
      return this.createValidationError(task, validationResult.errors!);
    }

    const data = (validationResult.data as Record<string, unknown>) || JSON.parse(chatResult.value.content);

    const skipSnapshot = payload.skipSnapshot === true;
    if (payload.filePath && !skipSnapshot) {
      const snapshotResult = await this.createSnapshotBeforeWrite({
        filePath: payload.filePath,
        content: "",
        nodeId: task.nodeId,
        taskId: task.id,
        originalContent: payload.originalContent || ""
      });
      if (snapshotResult.ok) {
        data.snapshotId = snapshotResult.value;
      }
    }

    return ok({ taskId: task.id, state: "Completed", data });
  }

  /**
   * 构建阶段 Schema 描述（用于 prompt 中的 PHASE_SCHEMA 槽位）
   * 生成人类可读的字段描述，而非完整 JSON Schema
   */
  private buildPhaseSchema(fullSchema: object, fields: string[]): string {
    const properties = (fullSchema as Record<string, unknown>).properties as Record<string, Record<string, unknown>> | undefined;
    if (!properties) return fields.map(f => `"${f}": "..."`).join(",\n");

    const lines: string[] = ["{"];
    for (const field of fields) {
      const prop = properties[field];
      if (!prop) {
        lines.push(`  "${field}": "..."`);
        continue;
      }
      const desc = prop.description || field;
      const type = prop.type || "string";

      if (type === "array" && prop.items) {
        const items = prop.items as Record<string, unknown>;
        if (items.type === "object" && items.properties) {
          const subProps = items.properties as Record<string, Record<string, unknown>>;
          const subFields = Object.keys(subProps).map(k => `"${k}": "${subProps[k].description || k}"`).join(", ");
          lines.push(`  "${field}": [{ ${subFields} }, ...]  // ${desc}`);
        } else {
          lines.push(`  "${field}": ["...", ...]  // ${desc}`);
        }
      } else if (type === "object" && prop.properties) {
        const subProps = prop.properties as Record<string, Record<string, unknown>>;
        const subFields = Object.keys(subProps).map(k => `"${k}": "${subProps[k].description || k}"`).join(", ");
        lines.push(`  "${field}": { ${subFields} }  // ${desc}`);
      } else {
        lines.push(`  "${field}": "..."  // ${desc}`);
      }
    }
    lines.push("}");
    return lines.join("\n");
  }

  /**
   * 构建阶段验证 Schema（仅包含本阶段字段的 JSON Schema）
   */
  private buildPhaseValidationSchema(fullSchema: object, fields: string[]): object {
    const full = fullSchema as Record<string, unknown>;
    const properties = full.properties as Record<string, unknown> | undefined;
    if (!properties) {
      return { type: "object", required: fields, properties: {} };
    }

    const phaseProperties: Record<string, unknown> = {};
    for (const field of fields) {
      if (properties[field]) {
        phaseProperties[field] = properties[field];
      }
    }

    return {
      type: "object",
      required: fields,
      properties: phaseProperties
    };
  }


  /** 执行 amend 任务（修订） */
  private async executeAmend(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 AmendPayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "amend") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 amend" });
      }
      const payload = typed.payload;
      if (!payload.currentContent || !payload.instruction) {
        return this.createTaskError(task, { code: "E102_MISSING_FIELD", message: "修订任务载荷缺失必要字段" });
      }

      const conceptType = payload.conceptType || "Entity";
      const slots = {
        CTX_CURRENT: payload.currentContent,
        USER_INSTRUCTION: payload.instruction,
        CONCEPT_TYPE: conceptType,
        CTX_LANGUAGE: this.getLanguage()
      };

      const prompt = this.promptManager.build("amend", slots, conceptType);
      const modelConfig = this.getTaskModelConfig("amend", task.providerRef);

      const chatRequest: ChatRequest = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens,
        reasoning_effort: modelConfig.reasoning_effort
      };

      const chatResult = await this.providerManager.chat(chatRequest, signal);
      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      const amendOutputSchema = {
        type: "object",
        properties: {
          content: { type: "object" },
          changes_summary: { type: "string" },
          preserved_sections: { type: "array" },
          enhanced_sections: { type: "array" }
        },
        required: ["content"]
      };

      const validationResult = await this.validator.validate(
        chatResult.value.content,
        amendOutputSchema,
        []
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      const parsed = (validationResult.data || {}) as Record<string, unknown>;
      const rawContent = parsed.content;
      if (!rawContent || typeof rawContent !== "object" || Array.isArray(rawContent)) {
        return this.createTaskError(task, { code: "E211_MODEL_SCHEMA_VIOLATION", message: "修订结果缺少有效的 content 对象" });
      }

      const schema = this.getSchema(conceptType);
      const rules = this.getValidationRules(conceptType);
      const contentValidation = await this.validator.validate(
        JSON.stringify(rawContent),
        schema,
        rules,
        { type: conceptType }
      );

      if (!contentValidation.valid) {
        return this.createValidationError(task, contentValidation.errors!);
      }

      return ok({
        taskId: task.id,
        state: "Completed",
        data: (contentValidation.data || {}) as Record<string, unknown>
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 amend 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 amend 失败");
    }
  }

  /** 执行 merge 任务（合并） */
  private async executeMerge(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 MergePayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "merge") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 merge" });
      }
      const payload = typed.payload;
      if (!payload.keepContent || !payload.deleteContent || !payload.keepName || !payload.deleteName) {
        return this.createTaskError(task, { code: "E102_MISSING_FIELD", message: "合并任务载荷缺失必要字段" });
      }

      const conceptType = payload.conceptType || "Entity";
      const instruction = payload.finalFileName
        ? `合并这两个 ${conceptType} 类型的概念笔记，最终文件名为 "${payload.finalFileName}"`
        : `合并这两个 ${conceptType} 类型的概念笔记`;

      const slots: Record<string, string> = {
        SOURCE_A_NAME: payload.keepName,
        CTX_SOURCE_A: payload.keepContent,
        SOURCE_B_NAME: payload.deleteName,
        CTX_SOURCE_B: payload.deleteContent,
        USER_INSTRUCTION: instruction,
        CONCEPT_TYPE: conceptType,
        CTX_LANGUAGE: this.getLanguage()
      };

      const prompt = this.promptManager.build("merge", slots, conceptType);
      const modelConfig = this.getTaskModelConfig("merge", task.providerRef);

      const chatRequest: ChatRequest = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [{ role: "user", content: prompt }],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens,
        reasoning_effort: modelConfig.reasoning_effort
      };

      const chatResult = await this.providerManager.chat(chatRequest, signal);
      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      const mergeOutputSchema = {
        type: "object",
        properties: {
          merged_name: { type: "object" },
          merge_rationale: { type: "string" },
          content: { type: "object" },
          preserved_from_a: { type: "array" },
          preserved_from_b: { type: "array" }
        },
        required: ["merged_name", "merge_rationale", "content", "preserved_from_a", "preserved_from_b"]
      };

      const validationResult = await this.validator.validate(
        chatResult.value.content,
        mergeOutputSchema,
        []
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      const parsed = (validationResult.data || {}) as Record<string, unknown>;
      const rawContent = parsed.content;
      if (!rawContent || typeof rawContent !== "object" || Array.isArray(rawContent)) {
        return this.createTaskError(task, { code: "E211_MODEL_SCHEMA_VIOLATION", message: "合并结果缺少有效的 content 对象" });
      }

      const schema = this.getSchema(conceptType);
      const rules = this.getValidationRules(conceptType);
      const contentValidation = await this.validator.validate(
        JSON.stringify(rawContent),
        schema,
        rules,
        { type: conceptType }
      );

      if (!contentValidation.valid) {
        return this.createValidationError(task, contentValidation.errors!);
      }

      const mergeResult = {
        ...parsed,
        content: (contentValidation.data || {}) as Record<string, unknown>
      };

      return ok({
        taskId: task.id,
        state: "Completed",
        data: mergeResult as Record<string, unknown>
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 merge 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 merge 失败");
    }
  }




  /** 执行 verify 任务（校验） */
  private async executeVerify(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 VerifyPayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "verify") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 verify" });
      }
      const payload = typed.payload;
      if (!payload.currentContent) {
        return this.createTaskError(task, { code: "E102_MISSING_FIELD", message: "缺少待验证内容 (currentContent)" });
      }

      const conceptType = payload.conceptType || payload.noteType || "Entity";

      // 构建上下文槽位
      const slots = {
        CTX_META: this.buildMetaContext(payload),
        CTX_CURRENT: payload.currentContent,
        CTX_SOURCES: payload.sources || "",
        CTX_LANGUAGE: this.getLanguage()
      };

      const prompt = this.promptManager.build(task.taskType, slots, conceptType);

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("verify", task.providerRef);

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: ChatRequest = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens,
        reasoning_effort: modelConfig.reasoning_effort
      };
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      const verifyOutputSchema = {
        type: "object",
        required: [
          "overall_assessment",
          "confidence_score",
          "issues",
          "verified_claims",
          "recommendations",
          "requires_human_review"
        ],
        properties: {
          overall_assessment: { type: "string" },
          confidence_score: { type: "number" },
          issues: { type: "array" },
          verified_claims: { type: "array" },
          recommendations: { type: "array" },
          requires_human_review: { type: "boolean" }
        }
      };

      const validationResult = await this.validator.validate(
        chatResult.value.content,
        verifyOutputSchema,
        []
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      const resultData = (validationResult.data || {}) as Record<string, unknown>;

      this.logger.info("TaskRunner", `Verify 任务完成: ${task.id}`, {
        overall_assessment: resultData.overall_assessment,
        issueCount: (resultData.issues as unknown[]).length
      });

      return ok({
        taskId: task.id,
        state: "Completed",
        data: resultData
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 verify 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 verify 失败");
    }
  }

  /** 执行图片生成任务 */
  private async executeImageGenerate(
    task: TaskRecord,
    signal?: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      if (!this.settingsStore) {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "设置未初始化" });
      }
      // 通过 taskType 判别式窄化，安全访问 ImageGeneratePayload 字段
      const typed = narrowTask(task);
      if (typed.taskType !== "image-generate") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 image-generate" });
      }
      const payload = typed.payload;
      if (!payload.userPrompt || !payload.filePath) {
        return this.createTaskError(task, { code: "E102_MISSING_FIELD", message: "图片生成任务载荷缺失必要字段" });
      }

      const settings = this.settingsStore.getSettings();
      const promptSlots = {
        USER_PROMPT: payload.userPrompt,
        CONTEXT_BEFORE: payload.contextBefore ?? "",
        CONTEXT_AFTER: payload.contextAfter ?? "",
        CONCEPT_TYPE: payload.frontmatter?.type ?? "",
        CONCEPT_NAME: payload.frontmatter?.name ?? "",
        CTX_LANGUAGE: this.getLanguage()
      };

      let promptTemplate: string;
      try {
        promptTemplate = this.promptManager.build("image-generate", promptSlots);
      } catch (error) {
        return toErr(error, "E500_INTERNAL_ERROR", "构建图片提示词失败");
      }

      const promptModelConfig = this.getTaskModelConfig("write", task.providerRef);
      if (!promptModelConfig.providerId) {
        return this.createTaskError(task, { code: "E401_PROVIDER_NOT_CONFIGURED", message: "请先配置 Provider" });
      }

      const promptRequest: ChatRequest = {
        providerId: task.providerRef || promptModelConfig.providerId,
        model: promptModelConfig.model,
        messages: [{ role: "user", content: promptTemplate }],
        temperature: promptModelConfig.temperature,
        topP: promptModelConfig.topP,
        maxTokens: promptModelConfig.maxTokens,
        reasoning_effort: promptModelConfig.reasoning_effort
      };

      const promptResult = await this.providerManager.chat(promptRequest, signal);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      const promptSchema = {
        type: "object",
        required: ["prompt", "altText"],
        properties: {
          prompt: { type: "string" },
          altText: { type: "string" },
          styleHints: { type: "array" },
          negativePrompt: { type: "string" }
        }
      };

      const promptValidation = await this.validator.validate(
        promptResult.value.content,
        promptSchema,
        []
      );

      if (!promptValidation.valid) {
        return this.createValidationError(task, promptValidation.errors!);
      }

      const promptData = (promptValidation.data || {}) as {
        prompt?: string;
        altText?: string;
      };

      if (!promptData.prompt) {
        return this.createTaskError(task, { code: "E211_MODEL_SCHEMA_VIOLATION", message: "图片提示词缺失" });
      }

      const imageModelConfig = this.getTaskModelConfig("image-generate", task.providerRef);
      if (!imageModelConfig.providerId) {
        return this.createTaskError(task, { code: "E401_PROVIDER_NOT_CONFIGURED", message: "请先配置 Provider" });
      }

      const imageResult = await this.providerManager.generateImage(
        {
          providerId: imageModelConfig.providerId,
          model: imageModelConfig.model,
          prompt: promptData.prompt,
          size: settings.imageGeneration.defaultSize,
          quality: settings.imageGeneration.defaultQuality,
          style: settings.imageGeneration.defaultStyle
        },
        signal
      );

      if (!imageResult.ok) {
        return this.createTaskError(task, imageResult.error);
      }

      const binaryResult = dataUrlToArrayBuffer(imageResult.value.imageUrl);
      if (!binaryResult.ok) {
        return this.createTaskError(task, binaryResult.error);
      }

      const file = this.noteRepository.getFileByPath(payload.filePath);
      if (!file) {
        return this.createTaskError(task, { code: "E301_FILE_NOT_FOUND", message: "目标文件不存在" });
      }

      const currentContent = await this.noteRepository.read(file);

      const ext = inferImageExtension(imageResult.value.imageUrl);
      const attachmentPath = this.noteRepository.getAvailablePathForAttachment(
        `generated-image.${ext}`,
        payload.filePath
      );

      await this.noteRepository.createBinary(attachmentPath, binaryResult.value);

      const altText = promptData.altText || imageResult.value.altText || payload.userPrompt;
      const markdown = `![${altText}](${attachmentPath})\n`;
      await this.insertImageReference(file, currentContent, markdown, payload.cursorPosition);

      return ok({
        taskId: task.id,
        state: "Completed",
        data: {
          localPath: attachmentPath,
          imageUrl: imageResult.value.imageUrl,
          revisedPrompt: imageResult.value.revisedPrompt,
          altText
        }
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 image-generate 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 image-generate 失败");
    }
  }

  private async insertImageReference(
    file: TFile,
    originalContent: string,
    markdown: string,
    cursor: { line: number; ch: number }
  ): Promise<void> {
    // 尝试使用当前编辑器插入，若无则回退为直接写入
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file && activeView.file.path === file.path) {
      const editor = activeView.editor;
      editor.replaceRange(markdown, cursor);
      await this.noteRepository.modify(file, editor.getValue());
      return;
    }

    const lines = originalContent.split("\n");
    const lineIndex = Math.min(Math.max(cursor.line ?? lines.length, 0), lines.length);
    if (lineIndex >= lines.length) {
      lines.push("");
    }
    const targetLine = lines[lineIndex] ?? "";
    const ch = Math.min(Math.max(cursor.ch ?? targetLine.length, 0), targetLine.length);
    const updatedLine = `${targetLine.slice(0, ch)}${markdown}${targetLine.slice(ch)}`;
    lines[lineIndex] = updatedLine;
    const nextContent = lines.join("\n");
    await this.noteRepository.modify(file, nextContent);
  }

  // 辅助方法

  /** 获取任务模型配置 */
  private getTaskModelConfig(taskType: TaskType, providerRef?: string): {
    providerId: string;
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    reasoning_effort?: "low" | "medium" | "high";
    embeddingDimension?: number;
  } {
    const settings = this.settingsStore?.getSettings();
    const taskConfig = settings?.taskModels?.[taskType];
    
    // 从 SSOT 默认配置获取回退值（DRY：消除与 settings-store.ts 的重复）
    const defaultConfig = DEFAULT_TASK_MODEL_CONFIGS[taskType];

    return {
      providerId: taskConfig?.providerId || providerRef || settings?.defaultProviderId || "",
      model: taskConfig?.model || defaultConfig.model,
      temperature: taskConfig?.temperature ?? defaultConfig.temperature,
      topP: taskConfig?.topP ?? defaultConfig.topP,
      maxTokens: taskConfig?.maxTokens,
      reasoning_effort: taskConfig?.reasoning_effort,
      embeddingDimension: taskConfig?.embeddingDimension ?? defaultConfig.embeddingDimension
    };
  }

  /** 构建 CTX_META 上下文字符串（丰富版） */
  private buildMetaContext(payload: AnyTaskPayload): string {
    const standardized = ("standardizedData" in payload) ? payload.standardizedData as StandardizedConcept | undefined : undefined;
    const primaryType = (standardized?.primaryType || (("conceptType" in payload) ? payload.conceptType : undefined)) as CRType | undefined;
    const standardNames = standardized?.standardNames;
    const selectedName = primaryType && standardNames ? standardNames[primaryType] : undefined;

    // 丰富的元数据格式：包含核心定义、别名、标签等上下文
    const meta: Record<string, unknown> = {
      Type: primaryType || "",
      standard_name_cn: selectedName?.chinese || "",
      standard_name_en: selectedName?.english || ""
    };

    // 注入核心定义（Define 阶段已生成）
    if (standardized?.coreDefinition) {
      meta.core_definition = standardized.coreDefinition;
    }
    if ("coreDefinition" in payload && typeof payload.coreDefinition === "string" && payload.coreDefinition) {
      meta.core_definition = payload.coreDefinition;
    }

    // 注入别名和标签（Tag 阶段已生成）
    if ("enrichedData" in payload && payload.enrichedData) {
      const enriched = payload.enrichedData as { aliases?: string[]; tags?: string[] };
      if (enriched.aliases?.length) {
        meta.aliases = enriched.aliases;
      }
      if (enriched.tags?.length) {
        meta.tags = enriched.tags;
      }
    }

    // 注入用户输入
    if ("userInput" in payload && typeof payload.userInput === "string" && payload.userInput) {
      meta.user_input = payload.userInput;
    }

    return JSON.stringify(meta, null, 2);
  }

  /**
   * 获取 CTX_LANGUAGE 值
   */
  private getLanguage(): string {
    const settings = this.settingsStore?.getSettings();
    return settings?.language === "en" ? "English" : "Chinese";
  }



  /**
   * 创建任务错误结果
   */
  private createTaskError(task: TaskRecord, error: { code: string; message: string; details?: unknown }): Result<TaskResult> {
    return err(error.code, error.message, {
      taskId: task.id,
      details: error.details
    });
  }

  /**
   * 创建验证错误结果
   */
  private createValidationError(task: TaskRecord, errors: Array<{ code: string; message: string }>): Result<TaskResult> {
    const firstError = errors[0];

    return err(firstError.code, firstError.message, {
      taskId: task.id,
      validationErrors: errors
    });
  }

  /**
   * 获取验证规则
   * 
   * 简化版本：返回空数组，不再使用业务规则校验
   * 
   * @param _conceptType 知识类型（未使用）
   * @returns 空数组
   */
  private getValidationRules(_conceptType: string): string[] {
    // 简化版本：不再使用业务规则校验
    return [];
  }

  /**
   * 获取 Schema
   * 
   * 从 SchemaRegistry 根据目标类型获取完整的 JSON Schema，
   * 包含字段定义、类型约束和必填标记
   * 
   * @param conceptType 知识类型
   * @returns 完整的 JSON Schema
   */
  private getSchema(conceptType: string): object {
    // 验证类型是否有效
    if (!this.schemaRegistry.isValidType(conceptType)) {
      this.logger.warn("TaskRunner", `未知的知识类型: ${conceptType}，使用基础 Schema`);
      return {
        type: "object",
        properties: {
          holistic_understanding: { type: "string", minLength: 10 }
        },
        required: ["holistic_understanding"]
      };
    }

    // 从 SchemaRegistry 获取完整的 JSON Schema
    const schema = this.schemaRegistry.getSchema(conceptType as CRType);
    this.logger.debug("TaskRunner", `获取 Schema: ${conceptType}`, { 
      requiredFields: (schema as Record<string, unknown>).required 
    });
    return schema;
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
  private async validateProviderCapability(task: TaskRecord): Promise<Result<void>> {
    const modelConfig = this.getTaskModelConfig(task.taskType, task.providerRef);
    const providerId = modelConfig.providerId;
    if (!providerId) {
      return err("E401_PROVIDER_NOT_CONFIGURED", "请先配置 Provider", {
        taskType: task.taskType,
        hint: "打开设置 → Cognitive Razor → Providers 进行配置"
      });
    }

    // 获取任务所需的能力
    const requiredCapability = this.getRequiredCapability(task.taskType);

    this.logger.debug("TaskRunner", "验证 Provider 能力", {
      taskId: task.id,
      taskType: task.taskType,
      providerId,
      requiredCapability
    });

    // 检查 Provider 是否存在
    const configuredProviders = this.providerManager.getConfiguredProviders();
    const providerExists = configuredProviders.some(p => p.id === providerId);
    
    if (!providerExists) {
      // 如果没有配置任何 Provider，返回友好的错误消息
      if (configuredProviders.length === 0) {
        return err("E401_PROVIDER_NOT_CONFIGURED", "尚未配置任何 AI Provider。请在设置中配置至少一个 Provider（如 OpenAI）后再使用此功能。", {
          providerId,
          taskType: task.taskType,
          hint: "打开设置 → Cognitive Razor → Providers 进行配置"
        });
      }
      
      // 如果配置了 Provider 但指定的不存在，建议使用已配置的
      const availableIds = configuredProviders.map(p => p.id).join(", ");
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 不存在。可用的 Provider: ${availableIds}`, {
        providerId,
        taskType: task.taskType,
        availableProviders: availableIds
      });
    }

    // 检查 Provider 可用性和能力
    const availabilityResult = await this.providerManager.checkAvailability(providerId);
    
    if (!availabilityResult.ok) {
      return err(availabilityResult.error.code, `Provider 不可用: ${availabilityResult.error.message}`, {
        providerId,
        taskType: task.taskType,
        availabilityError: availabilityResult.error,
      });
    }

    const capabilities = availabilityResult.value;

    // 验证能力匹配
    if (requiredCapability === "chat" && !capabilities.chat) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider ${providerId} 不支持聊天能力`, {
        providerId,
        requiredCapability,
        availableCapabilities: capabilities
      });
    }

    if (requiredCapability === "embedding" && !capabilities.embedding) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider ${providerId} 不支持嵌入能力`, {
        providerId,
        requiredCapability,
        availableCapabilities: capabilities
      });
    }

    if (requiredCapability === "image" && !capabilities.image) {
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider ${providerId} 不支持图片生成能力`, {
        providerId,
        requiredCapability,
        availableCapabilities: capabilities
      });
    }

    this.logger.debug("TaskRunner", "Provider 能力验证通过", {
      taskId: task.id,
      providerId,
      requiredCapability
    });

    return ok(undefined);
  }

  /**
   * 获取任务所需的能力
   * 
   * @param taskType 任务类型
   * @returns 所需能力类型
   */
  private getRequiredCapability(taskType: TaskType): "chat" | "embedding" | "image" {
    switch (taskType) {
      case "index":
        return "embedding";
      case "image-generate":
        return "image";
      case "define":
      case "tag":
      case "write":
      case "amend":
      case "merge":
      case "verify":
      default:
        return "chat";
    }
  }
}
