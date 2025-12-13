/** 任务执行器 - 负责执行单个任务，调用 Provider 和验证输出 */

import {
  ITaskRunner,
  IProviderManager,
  IPromptManager,
  IValidator,
  IUndoManager,
  ILogger,
  IVectorIndex,
  IFileStorage,
  ISettingsStore,
  TaskRecord,
  TaskResult,
  TaskError,
  TaskType,
  CRType,
  StandardizedConcept,
  NoteState,
  Result,
  ok,
  err
} from "../types";
import { schemaRegistry, ISchemaRegistry } from "./schema-registry";
import { createConceptSignature, generateSignatureText } from "./naming-utils";
import { mapStandardizeOutput } from "./standardize-mapper";

/** 任务管线顺序 */
const TASK_PIPELINE_ORDER: TaskType[] = [
  "standardizeClassify",
  "enrich",
  "reason:new",
  "embedding",
  "ground"
];


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

  validate(input: string): Result<string> {
    if (typeof input !== "string") {
      return err("E001", "输入必须是字符串");
    }
    if (input.length > this.MAX_INPUT_LENGTH) {
      return err("E001", `输入过长: ${input.length} 字符 (最大 ${this.MAX_INPUT_LENGTH})`);
    }
    for (const pattern of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(input)) {
        return err("E001", "输入包含可疑指令，请检查后再试");
      }
    }
    const sanitized = input.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();
    return ok(sanitized);
  }
}


/** TaskRunner 依赖接口 */
interface TaskRunnerDependencies {
  providerManager: IProviderManager;
  promptManager: IPromptManager;
  validator: IValidator;
  undoManager: IUndoManager;
  logger: ILogger;
  vectorIndex?: IVectorIndex;
  fileStorage?: IFileStorage;
  schemaRegistry?: ISchemaRegistry;
  settingsStore?: ISettingsStore;
}

/** 写入操作上下文 */
interface WriteContext {
  filePath: string;
  content: string;
  nodeId: string;
  taskId: string;
  originalContent?: string;
}

export class TaskRunner implements ITaskRunner {
  private providerManager: IProviderManager;
  private promptManager: IPromptManager;
  private validator: IValidator;
  private undoManager: IUndoManager;
  private logger: ILogger;
  private vectorIndex?: IVectorIndex;
  private fileStorage?: IFileStorage;
  private schemaRegistry: ISchemaRegistry;
  private settingsStore?: ISettingsStore;
  private abortControllers: Map<string, AbortController>;
  private inputValidator: InputValidator;

  constructor(deps: TaskRunnerDependencies) {
    this.providerManager = deps.providerManager;
    this.promptManager = deps.promptManager;
    this.validator = deps.validator;
    this.undoManager = deps.undoManager;
    this.logger = deps.logger;
    this.vectorIndex = deps.vectorIndex;
    this.fileStorage = deps.fileStorage;
    // 使用注入的 SchemaRegistry 或默认单例
    this.schemaRegistry = deps.schemaRegistry || schemaRegistry;
    this.settingsStore = deps.settingsStore;
    this.abortControllers = new Map();
    this.inputValidator = new InputValidator();

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
      let result: Result<TaskResult>;

      switch (task.taskType) {
        case "standardizeClassify":
          result = await this.executeStandardizeClassify(task, abortController.signal);
          break;
        case "enrich":
          result = await this.executeEnrich(task, abortController.signal);
          break;
        case "embedding":
          result = await this.executeEmbedding(task, abortController.signal);
          break;
        case "reason:new":
          result = await this.executeReasonNew(task, abortController.signal);
          break;
        case "ground":
          result = await this.executeGround(task, abortController.signal);
          break;
        default:
          result = err("E306", `未知的任务类型: ${task.taskType}`);
      }

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

      return err("E305", "任务执行异常", error);
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
      if (originalContent === undefined && this.fileStorage) {
        const existsResult = await this.fileStorage.exists(context.filePath);
        if (existsResult) {
          const readResult = await this.fileStorage.read(context.filePath);
          if (readResult.ok) {
            originalContent = readResult.value;
          }
        }
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
      return err("E303", "创建快照失败", error);
    }
  }




  /** 更新笔记状态 */
  async updateNoteStatus(filePath: string, newStatus: NoteState): Promise<Result<void>> {
    if (!this.fileStorage) {
      return err("E306", "FileStorage 未配置");
    }

    try {
      const readResult = await this.fileStorage.read(filePath);
      if (!readResult.ok) {
        return readResult as Result<void>;
      }

      const content = readResult.value;
      
      // 更新 frontmatter 中的 status 字段
      const updatedContent = this.updateFrontmatterStatus(content, newStatus);
      
      const writeResult = await this.fileStorage.write(filePath, updatedContent);
      if (!writeResult.ok) {
        return writeResult;
      }

      this.logger.info("TaskRunner", `笔记状态已更新为 ${newStatus}`, { filePath });
      return ok(undefined);
    } catch (error) {
      this.logger.error("TaskRunner", "更新笔记状态失败", error as Error, { filePath });
      return err("E300", "更新笔记状态失败", error);
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
    const updatedFrontmatter = frontmatter.replace(
      /^status:\s*.*$/m,
      `status: ${newStatus}`
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
      if (this.fileStorage) {
        const deleteResult = await this.fileStorage.delete(deleteFilePath);
        if (!deleteResult.ok) {
          this.logger.error("TaskRunner", "删除被合并笔记失败", undefined, {
            deleteFilePath,
            error: deleteResult.error
          });
          return deleteResult;
        }
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
      return err("E305", "完成合并流程失败", error);
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
    // standardizeClassify(0) → enrich(1) → reason:new(2) → embedding(3) → ground(4)
    if (currentTaskType === "embedding") {
      // embedding 必须在 reason:new 之后
      return previousTaskType === "reason:new" || previousIndex <= 2;
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
      case "standardizeClassify":
        return "enrich";
      case "enrich":
        return "reason:new";
      case "reason:new":
        return "embedding";
      default:
        return null;
    }
  }


  // 任务执行方法

  /** 执行 standardizeClassify 任务 */
  private async executeStandardizeClassify(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const userInput = task.payload.userInput as string;
      const validated = this.inputValidator.validate(userInput);
      if (!validated.ok) {
        return this.createTaskError(task, validated.error!);
      }
      const sanitizedInput = validated.value;

      // 构建 prompt（CTX_INPUT）
      const slots = {
        CTX_INPUT: sanitizedInput,
        CTX_LANGUAGE: this.getLanguage()
      };

      const promptResult = this.promptManager.build(task.taskType, slots);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("standardizeClassify");

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: any = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: promptResult.value }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens
      };
      
      // 如果配置了 reasoning_effort，添加到请求中（用于 o1/o3 等推理模型）
      if (modelConfig.reasoning_effort) {
        chatRequest.reasoning_effort = modelConfig.reasoning_effort;
      }
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 使用 SchemaRegistry 的标准化 Schema 校验
      const schema = this.schemaRegistry.getStandardizeClassifySchema();
      const validationResult = await this.validator.validate(
        chatResult.value.content,
        schema,
        ["C009"]
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      // 解析结果并标准化键名
      const data = (validationResult.data as Record<string, any>) || JSON.parse(chatResult.value.content);
      const parsed = mapStandardizeOutput(data);

      return ok({
        taskId: task.id,
        state: "Completed",
        data: parsed as unknown as Record<string, unknown>
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 standardizeClassify 失败", error as Error, {
        taskId: task.id
      });
      return err("E305", "执行 standardizeClassify 失败", error);
    }
  }

  /** 执行 enrich 任务 */
  private async executeEnrich(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const metaContext = this.buildMetaContext(task.payload);
      const slots = {
        CTX_META: metaContext,
        CTX_LANGUAGE: this.getLanguage()
      };

      const promptResult = this.promptManager.build(task.taskType, slots);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("enrich");

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: any = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: promptResult.value }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens
      };
      
      // 如果配置了 reasoning_effort，添加到请求中
      if (modelConfig.reasoning_effort) {
        chatRequest.reasoning_effort = modelConfig.reasoning_effort;
      }
      
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
      const data = (validationResult.data as Record<string, any>) || JSON.parse(chatResult.value.content);
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
      this.logger.error("TaskRunner", "执行 enrich 失败", error as Error, {
        taskId: task.id
      });
      return err("E305", "执行 enrich 失败", error);
    }
  }


  /** 执行 embedding 任务 */
  private async executeEmbedding(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 优先使用上游生成的签名文本；否则基于标准化结果构建
      let text = task.payload.text as string | undefined;

      if (!text) {
        const standardized = task.payload.standardizedData as StandardizedConcept | undefined;
        if (!standardized) {
          return this.createTaskError(task, { code: "E001", message: "缺少标准化数据，无法生成嵌入文本" });
        }

        const primaryType = (standardized.primaryType || task.payload.conceptType || "Entity") as CRType;
        const currentName = standardized.standardNames?.[primaryType];
        if (!currentName) {
          return this.createTaskError(task, { code: "E001", message: "标准化名称缺失，无法生成嵌入文本" });
        }

        const signature = createConceptSignature(
          {
            standardName: currentName,
            aliases: Array.isArray((task.payload as any).aliases) ? (task.payload as any).aliases : [],
            coreDefinition: standardized.coreDefinition
          },
          primaryType,
          (task.payload.namingTemplate as string) || "{{chinese}} ({{english}})"
        );
        text = generateSignatureText(signature);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("embedding");

      // 调用 Embedding API（使用用户配置的模型和向量维度）
      const embeddingDimension = this.settingsStore?.getSettings().embeddingDimension || 1536;
      const embedResult = await this.providerManager.embed({
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
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
      this.logger.error("TaskRunner", "执行 embedding 失败", error as Error, {
        taskId: task.id
      });
      return err("E305", "执行 embedding 失败", error);
    }
  }

  /** 执行 reason:new 任务 */
  private async executeReasonNew(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const conceptType = (task.payload.conceptType as CRType) || "Entity";
      const schema = this.getSchema(conceptType);
      const sources = typeof task.payload.sources === "string" ? task.payload.sources : "";

      const slots = {
        CTX_META: this.buildMetaContext(task.payload),
        CTX_SOURCES: sources,
        CTX_LANGUAGE: this.getLanguage()
      };

      // 传递 conceptType 以选择正确的模板（reason-domain, reason-issue 等）
      const promptResult = this.promptManager.build(task.taskType, slots, conceptType);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("reason:new");

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: any = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: promptResult.value }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens
      };
      
      // 如果配置了 reasoning_effort，添加到请求中
      if (modelConfig.reasoning_effort) {
        chatRequest.reasoning_effort = modelConfig.reasoning_effort;
      }
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 使用 SchemaRegistry 获取验证规则和 Schema
      const rules = this.getValidationRules(conceptType);

      const validationResult = await this.validator.validate(
        chatResult.value.content,
        schema,
        rules
      );

      if (!validationResult.valid) {
        return this.createValidationError(task, validationResult.errors!);
      }

      // 解析结果
      const data = (validationResult.data as Record<string, unknown>) || JSON.parse(chatResult.value.content);

      // Property 10: 创建快照（写入前）
      const skipSnapshot = task.payload.skipSnapshot === true;
      if (task.payload.filePath && !skipSnapshot) {
        const snapshotResult = await this.createSnapshotBeforeWrite({
          filePath: task.payload.filePath as string,
          content: "", // 新文件，原始内容为空
          nodeId: task.nodeId,
          taskId: task.id,
          originalContent: task.payload.originalContent as string || ""
        });

        if (snapshotResult.ok) {
          data.snapshotId = snapshotResult.value;
        }
      }

      return ok({
        taskId: task.id,
        state: "Completed",
        data
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 reason:new 失败", error as Error, {
        taskId: task.id
      });
      return err("E305", "执行 reason:new 失败", error);
    }
  }





  /** 执行 ground 任务（事实核查） */
  private async executeGround(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const currentContent = task.payload.currentContent as string;
      if (!currentContent) {
        return this.createTaskError(task, { code: "E001", message: "缺少待验证内容 (currentContent)" });
      }

      const conceptType = (task.payload.conceptType as CRType) || (task.payload.noteType as CRType) || "Entity";

      // 构建上下文槽位
      const slots = {
        CTX_META: this.buildMetaContext(task.payload),
        CTX_CURRENT: currentContent,
        CTX_SOURCES: task.payload.sources as string || "",
        CTX_LANGUAGE: this.getLanguage()
      };

      const promptResult = this.promptManager.build(task.taskType, slots, conceptType);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 获取任务模型配置
      const modelConfig = this.getTaskModelConfig("ground");

      // 调用 LLM（使用用户配置的模型）
      const chatRequest: any = {
        providerId: task.providerRef || modelConfig.providerId,
        model: modelConfig.model,
        messages: [
          { role: "user", content: promptResult.value }
        ],
        temperature: modelConfig.temperature,
        topP: modelConfig.topP,
        maxTokens: modelConfig.maxTokens
      };
      
      // 如果配置了 reasoning_effort，添加到请求中
      if (modelConfig.reasoning_effort) {
        chatRequest.reasoning_effort = modelConfig.reasoning_effort;
      }
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 解析验证结果
      let groundingResult: Record<string, unknown>;
      try {
        groundingResult = JSON.parse(chatResult.value.content);
      } catch {
        // 如果解析失败，构建默认结构
        groundingResult = {
          overall_assessment: "needs_review",
          confidence_score: 0.5,
          issues: [],
          recommendations: ["无法解析验证结果，建议人工审核"],
          requires_human_review: true
        };
      }

      // 确保必要字段存在
      const resultData: Record<string, unknown> = {
        overall_assessment: groundingResult.overall_assessment || "needs_review",
        confidence_score: groundingResult.confidence_score || 0.5,
        issues: groundingResult.issues || [],
        verified_claims: groundingResult.verified_claims || [],
        recommendations: groundingResult.recommendations || [],
        requires_human_review: groundingResult.requires_human_review ?? true
      };

      this.logger.info("TaskRunner", `Ground 任务完成: ${task.id}`, {
        overall_assessment: resultData.overall_assessment,
        issueCount: (resultData.issues as unknown[]).length
      });

      return ok({
        taskId: task.id,
        state: "Completed",
        data: resultData
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 ground 失败", error as Error, {
        taskId: task.id
      });
      return err("E305", "执行 ground 失败", error);
    }
  }

  // 辅助方法

  /** 获取任务模型配置 */
  private getTaskModelConfig(taskType: TaskType): {
    providerId: string;
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    reasoning_effort?: "low" | "medium" | "high";
  } {
    const settings = this.settingsStore?.getSettings();
    const taskConfig = settings?.taskModels?.[taskType];
    
    // 默认配置
    const defaults: Record<TaskType, { model: string; temperature?: number }> = {
      "standardizeClassify": { model: "gpt-4o", temperature: 0.3 },
      "enrich": { model: "gpt-4o", temperature: 0.5 },
      "embedding": { model: "text-embedding-3-small" },
      "reason:new": { model: "gpt-4o", temperature: 0.7 },
      "ground": { model: "gpt-4o", temperature: 0.3 }
    };

    const defaultConfig = defaults[taskType] || { model: "gpt-4o" };

    return {
      providerId: taskConfig?.providerId || settings?.defaultProviderId || "default",
      model: taskConfig?.model || defaultConfig.model,
      temperature: taskConfig?.temperature ?? defaultConfig.temperature,
      topP: taskConfig?.topP,
      maxTokens: taskConfig?.maxTokens,
      reasoning_effort: taskConfig?.reasoning_effort
    };
  }

  /** 构建 CTX_META 上下文字符串 */
  private buildMetaContext(payload: Record<string, unknown>): string {
    const standardized = payload.standardizedData as StandardizedConcept | undefined;
    const primaryType = (standardized?.primaryType || payload.conceptType) as CRType | undefined;
    const standardNames = standardized?.standardNames;
    const selectedName = primaryType && standardNames ? standardNames[primaryType] : undefined;

    // 简化的元数据格式
    const meta: Record<string, unknown> = {
      Type: primaryType || "",
      standard_name_cn: selectedName?.chinese || "",
      standard_name_en: selectedName?.english || ""
    };

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
    const providerId = task.providerRef || "default";

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
        return err("E201", "尚未配置任何 AI Provider。请在设置中配置至少一个 Provider（如 OpenAI）后再使用此功能。", {
          providerId,
          taskType: task.taskType,
          hint: "打开设置 → Cognitive Razor → Providers 进行配置"
        });
      }
      
      // 如果配置了 Provider 但指定的不存在，建议使用已配置的
      const availableIds = configuredProviders.map(p => p.id).join(", ");
      return err("E201", `Provider "${providerId}" 不存在。可用的 Provider: ${availableIds}`, {
        providerId,
        taskType: task.taskType,
        availableProviders: availableIds
      });
    }

    // 检查 Provider 可用性和能力
    const availabilityResult = await this.providerManager.checkAvailability(providerId);
    
    if (!availabilityResult.ok) {
      return err("E201", `Provider 不可用: ${availabilityResult.error.message}`, {
        providerId,
        taskType: task.taskType
      });
    }

    const capabilities = availabilityResult.value;

    // 验证能力匹配
    if (requiredCapability === "chat" && !capabilities.chat) {
      return err("E201", `Provider ${providerId} 不支持聊天能力`, {
        providerId,
        requiredCapability,
        availableCapabilities: capabilities
      });
    }

    if (requiredCapability === "embedding" && !capabilities.embedding) {
      return err("E201", `Provider ${providerId} 不支持嵌入能力`, {
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
  private getRequiredCapability(taskType: TaskType): "chat" | "embedding" {
    switch (taskType) {
      case "embedding":
        return "embedding";
      case "standardizeClassify":
      case "enrich":
      case "reason:new":
      case "ground":
      default:
        return "chat";
    }
  }
}
