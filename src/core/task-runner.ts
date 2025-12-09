/**
 * 任务执行器
 * 负责执行单个任务，包括调用 Provider、构建 Prompt、验证输出和重试逻辑
 * 
 * 遵循设计文档要求：
 * - Property 10: Snapshot Before Write - 文件写入前调用 UndoManager.createSnapshot
 * - Property 29: Task Pipeline Order - 任务管线顺序
 * - Property 30: Evergreen Downgrade on Improvement - 增量改进后降级 Evergreen 状态
 * - Property 31: Merge Flow Completeness - 合并流程完整性
 * - Property 27: Type-Specific Field Completeness - 类型字段完整性验证
 */

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
  NoteState,
  Result,
  ok,
  err
} from "../types";
import { schemaRegistry, ISchemaRegistry } from "./schema-registry";
import { createConceptSignature, generateSignatureText } from "./naming-utils";
import { mapStandardizeOutput } from "./standardize-mapper";

/**
 * 任务管线阶段定义
 * Requirements 8.1: standardizeClassify → enrich → embedding → confirm → reason:new → confirm → write → dedup
 */
export const TASK_PIPELINE_ORDER: TaskType[] = [
  "standardizeClassify",
  "enrich",
  "embedding",
  "reason:new",
  "reason:incremental",
  "reason:merge",
  "ground"
];


/**
 * 类型必填字段定义
 * Property 27: Type-Specific Field Completeness
 * Requirements 7.1-7.5
 */
export const TYPE_REQUIRED_FIELDS: Record<CRType, string[]> = {
  Domain: [
    "definition",
    "teleology", 
    "methodology",
    "historical_genesis",
    "boundaries",
    "issues",
    "holistic_understanding"
  ],
  Issue: [
    "core_tension",
    "significance",
    "historical_genesis",
    "structural_analysis",
    "stakeholder_perspectives",
    "boundary_conditions",
    "theories",
    "holistic_understanding"
  ],
  Theory: [
    "axioms",
    "argument_chain",
    "core_predictions",
    "scope_and_applicability",
    "limitations",
    "historical_development",
    "extracted_components",
    "holistic_understanding"
  ],
  Entity: [
    "definition",
    "classification",
    "properties",
    "distinguishing_features",
    "examples",
    "counter_examples",
    "holistic_understanding"
  ],
  Mechanism: [
    "definition",
    "trigger_conditions",
    "causal_chain",
    "termination_conditions",
    "inputs",
    "outputs",
    "process_description",
    "examples",
    "holistic_understanding"
  ]
};


/**
 * 扩展的 TaskRunner 依赖接口
 */
export interface TaskRunnerDependencies {
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

/**
 * 写入操作上下文
 */
export interface WriteContext {
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

    this.logger.debug("TaskRunner", "TaskRunner 初始化完成");
  }


  /**
   * 执行任务
   * 
   * 遵循 A-FUNC-03：任务执行前必须验证 Provider 能力匹配
   */
  async run(task: TaskRecord): Promise<Result<TaskResult>> {
    const startTime = Date.now();
    
    try {
      this.logger.info("TaskRunner", `开始执行任务: ${task.id}`, {
        taskType: task.taskType,
        nodeId: task.nodeId,
        attempt: task.attempt
      });

      // A-FUNC-03: 验证 Provider 能力匹配
      const capabilityCheck = await this.validateProviderCapability(task);
      if (!capabilityCheck.ok) {
        this.logger.error("TaskRunner", "Provider 能力验证失败", undefined, {
          taskId: task.id,
          error: capabilityCheck.error
        });
        return capabilityCheck as Result<TaskResult>;
      }

      // 创建 AbortController
      const abortController = new AbortController();
      this.abortControllers.set(task.id, abortController);

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
        case "reason:incremental":
          result = await this.executeReasonIncremental(task, abortController.signal);
          break;
        case "reason:merge":
          result = await this.executeReasonMerge(task, abortController.signal);
          break;
        case "ground":
          result = await this.executeGround(task, abortController.signal);
          break;
        default:
          result = err("E304", `未知的任务类型: ${task.taskType}`);
      }

      // 清理 AbortController
      this.abortControllers.delete(task.id);

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

      return err("E304", "任务执行异常", error);
    }
  }

  /**
   * 中断任务执行
   */
  abort(taskId: string): void {
    const abortController = this.abortControllers.get(taskId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(taskId);
      this.logger.info("TaskRunner", `任务已中断: ${taskId}`);
    }
  }


  // ============================================================================
  // Property 10: Snapshot Before Write
  // 文件写入前调用 UndoManager.createSnapshot
  // Requirements 2.6, 8.5
  // ============================================================================

  /**
   * 创建写入前快照
   * 
   * Property 10: Snapshot Before Write
   * For any file write operation performed by TaskRunner, a snapshot SHALL exist
   * in UndoManager before the write completes.
   * 
   * @param context 写入上下文
   * @returns 快照 ID 或错误
   */
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


  // ============================================================================
  // Property 27: Type-Specific Field Completeness
  // 验证生成内容包含类型所需的所有必填字段
  // Requirements 7.1, 7.2, 7.3, 7.4, 7.5
  // ============================================================================

  /**
   * 验证类型字段完整性
   * 
   * Property 27: Type-Specific Field Completeness
   * For any generated content of a specific CRType, all required fields for that
   * type SHALL be present.
   * 
   * @param data 生成的数据
   * @param type 知识类型
   * @returns 验证结果
   */
  validateTypeFieldCompleteness(data: Record<string, unknown>, type: CRType): Result<void> {
    const requiredFields = TYPE_REQUIRED_FIELDS[type];
    if (!requiredFields) {
      return err("E007", `未知的知识类型: ${type}`);
    }

    const missingFields: string[] = [];

    for (const field of requiredFields) {
      const value = data[field];
      if (value === undefined || value === null) {
        missingFields.push(field);
      } else if (typeof value === "string" && value.trim() === "") {
        missingFields.push(field);
      } else if (Array.isArray(value)) {
        // 特殊检查：某些数组字段有最小长度要求
        if (field === "axioms" && value.length < 1) {
          missingFields.push(`${field} (至少需要 1 个元素)`);
        } else if (field === "argument_chain" && value.length < 1) {
          missingFields.push(`${field} (至少需要 1 个元素)`);
        } else if (field === "causal_chain" && value.length < 2) {
          missingFields.push(`${field} (至少需要 2 个元素)`);
        }
      }
    }

    if (missingFields.length > 0) {
      return err(
        "E003",
        `类型 ${type} 缺少必填字段: ${missingFields.join(", ")}`,
        { type, missingFields }
      );
    }

    // 特殊验证：Issue 的 core_tension 必须匹配 "X vs Y" 格式
    if (type === "Issue" && data.core_tension) {
      const coreTension = data.core_tension as string;
      if (!/^.+ vs .+$/.test(coreTension)) {
        return err(
          "E010",
          `Issue 的 core_tension 必须匹配 "X vs Y" 格式，当前值: ${coreTension}`,
          { field: "core_tension", value: coreTension }
        );
      }
    }

    // 特殊验证：Entity 的 classification 必须包含 genus 和 differentia
    if (type === "Entity" && data.classification) {
      const classification = data.classification as Record<string, unknown>;
      if (!classification.genus || !classification.differentia) {
        return err(
          "E004",
          "Entity 的 classification 必须包含 genus 和 differentia",
          { field: "classification", value: classification }
        );
      }
    }

    return ok(undefined);
  }


  // ============================================================================
  // Property 30: Evergreen Downgrade on Improvement
  // 增量改进后将 Evergreen 状态改为 Draft
  // Requirements 8.3
  // ============================================================================

  /**
   * 处理 Evergreen 降级
   * 
   * Property 30: Evergreen Downgrade on Improvement
   * For any Evergreen note that undergoes incremental improvement, the note status
   * SHALL be changed to Draft after the improvement is applied.
   * 
   * @param currentStatus 当前笔记状态
   * @returns 新的笔记状态
   */
  handleEvergreenDowngrade(currentStatus: NoteState): NoteState {
    if (currentStatus === "Evergreen") {
      this.logger.info("TaskRunner", "Evergreen 笔记增量改进后降级为 Draft");
      return "Draft";
    }
    return currentStatus;
  }

  /**
   * 更新笔记状态（用于增量改进后的降级）
   * 
   * @param filePath 文件路径
   * @param newStatus 新状态
   * @returns 更新结果
   */
  async updateNoteStatus(filePath: string, newStatus: NoteState): Promise<Result<void>> {
    if (!this.fileStorage) {
      return err("E304", "FileStorage 未配置");
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

  /**
   * 更新 frontmatter 中的 status 字段
   */
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


  // ============================================================================
  // Property 31: Merge Flow Completeness
  // 合并完成后删除被合并笔记，更新向量索引
  // Requirements 8.4
  // ============================================================================

  /**
   * 完成合并流程
   * 
   * Property 31: Merge Flow Completeness
   * For any completed merge operation, the merged note SHALL be deleted and the
   * vector index SHALL be updated to remove the merged entry.
   * 
   * @param keepNodeId 保留的节点 ID
   * @param deleteNodeId 要删除的节点 ID
   * @param deleteFilePath 要删除的文件路径
   * @returns 完成结果
   */
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
      return err("E304", "完成合并流程失败", error);
    }
  }


  // ============================================================================
  // Property 29: Task Pipeline Order
  // 任务管线顺序验证
  // Requirements 8.1
  // ============================================================================

  /**
   * 验证任务管线顺序
   * 
   * Property 29: Task Pipeline Order
   * For any new concept creation, tasks SHALL execute in order:
   * standardizeClassify → enrich → embedding → (user confirmation) → reason:new →
   * (user confirmation) → write → dedup detection.
   * 
   * @param previousTaskType 前一个任务类型
   * @param currentTaskType 当前任务类型
   * @returns 是否符合管线顺序
   */
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

    // 特殊情况：reason:incremental 和 reason:merge 可以独立执行
    if (currentTaskType === "reason:incremental" || currentTaskType === "reason:merge") {
      return true;
    }

    // 对于新概念创建流程，验证顺序
    // standardizeClassify(0) → enrich(1) → embedding(2) → reason:new(3)
    if (currentTaskType === "reason:new") {
      // reason:new 必须在 embedding 之后
      return previousTaskType === "embedding" || previousIndex <= 2;
    }

    // 一般情况：当前任务索引应该大于等于前一个任务索引
    return currentIndex >= previousIndex;
  }

  /**
   * 获取任务管线中的下一个任务类型
   * 
   * @param currentTaskType 当前任务类型
   * @returns 下一个任务类型或 null
   */
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
        return "embedding";
      case "embedding":
        return "reason:new";
      default:
        return null;
    }
  }


  // ============================================================================
  // 任务类型执行方法
  // ============================================================================

  /**
   * 执行 standardizeClassify 任务
   */
  private async executeStandardizeClassify(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const userInput = task.payload.userInput as string;

      // 构建 prompt（CTX_INPUT）
      const slots = {
        CTX_INPUT: userInput,
        previous_errors: this.formatErrorHistory(task.errors)
      };

      const promptResult = this.promptManager.build(task.taskType, slots);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 调用 LLM
      const chatResult = await this.providerManager.chat({
        providerId: task.providerRef || "default",
        model: "gpt-4o",
        messages: [
          { role: "user", content: promptResult.value }
        ]
      });

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
      return err("E304", "执行 standardizeClassify 失败", error);
    }
  }

  /**
   * 执行 enrich 任务
   */
  private async executeEnrich(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const metaContext = this.buildMetaContext(task.payload);
      const slots = {
        CTX_META: metaContext,
        previous_errors: this.formatErrorHistory(task.errors)
      };

      const promptResult = this.promptManager.build(task.taskType, slots);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 调用 LLM
      const chatResult = await this.providerManager.chat({
        providerId: task.providerRef || "default",
        model: "gpt-4o",
        messages: [
          { role: "user", content: promptResult.value }
        ]
      });

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
      return err("E304", "执行 enrich 失败", error);
    }
  }


  /**
   * 执行 embedding 任务
   */
  private async executeEmbedding(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 优先使用上游生成的签名文本；否则基于标准化结果构建
      let text = task.payload.text as string | undefined;

      if (!text) {
        const standardized = task.payload.standardizedData as any;
        if (!standardized) {
          return this.createTaskError(task, { code: "E001", message: "缺少标准化数据，无法生成嵌入文本" });
        }

        const signature = createConceptSignature(
          {
            standardName: standardized.standardName,
            aliases: standardized.aliases || [],
            coreDefinition: standardized.coreDefinition
          },
          standardized.primaryType as CRType,
          (task.payload.namingTemplate as string) || "{{chinese}} ({{english}})"
        );
        text = generateSignatureText(signature);
      }

      // 调用 Embedding API（支持用户配置的向量维度）
      const embeddingDimension = this.settingsStore?.getSettings().embeddingDimension || 1536;
      const embedResult = await this.providerManager.embed({
        providerId: task.providerRef || "default",
        model: "text-embedding-3-small",
        input: text,
        dimensions: embeddingDimension
      });

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
      return err("E304", "执行 embedding 失败", error);
    }
  }

  /**
   * 执行 reason:new 任务
   * 包含 Property 10 (Snapshot Before Write) 和 Property 27 (Type Field Completeness)
   */
  private async executeReasonNew(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const conceptType = (task.payload.conceptType as CRType) || "Entity";
      const schema = this.getSchema(conceptType);

      const slots = {
        CTX_META: this.buildMetaContext(task.payload),
        CTX_VAULT: this.buildVaultIndexContext(conceptType),
        CTX_SCHEMA: JSON.stringify(schema, null, 2),
        previous_errors: this.formatErrorHistory(task.errors)
      };

      // 传递 conceptType 以选择正确的模板（reason-domain, reason-issue 等）
      const promptResult = this.promptManager.build(task.taskType, slots, conceptType);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 调用 LLM
      const chatResult = await this.providerManager.chat({
        providerId: task.providerRef || "default",
        model: "gpt-4o",
        messages: [
          { role: "user", content: promptResult.value }
        ],
        maxTokens: 4000
      });

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

      // Property 27: 验证类型字段完整性
      const fieldValidation = this.validateTypeFieldCompleteness(data, conceptType);
      if (!fieldValidation.ok) {
        return this.createTaskError(task, fieldValidation.error!);
      }

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
      return err("E304", "执行 reason:new 失败", error);
    }
  }


  /**
   * 执行 reason:incremental 任务
   * 包含 Property 10 (Snapshot Before Write) 和 Property 30 (Evergreen Downgrade)
   */
  private async executeReasonIncremental(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      const currentContent = task.payload.currentContent as string;
      const currentStatus = task.payload.currentStatus as NoteState | undefined;
      const conceptType = (task.payload.conceptType as CRType) || (task.payload.noteType as CRType);
      const schema = this.getSchema(conceptType || "Entity");

      const slots = {
        CTX_META: this.buildMetaContext(task.payload),
        CTX_VAULT: this.buildVaultIndexContext(conceptType),
        CTX_SCHEMA: JSON.stringify(schema, null, 2),
        CTX_CURRENT: currentContent,
        CTX_INTENT: task.payload.userIntent as string,
        previous_errors: this.formatErrorHistory(task.errors)
      };

      const promptResult = this.promptManager.build(task.taskType, slots, conceptType);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 调用 LLM
      const chatResult = await this.providerManager.chat({
        providerId: task.providerRef || "default",
        model: "gpt-4o",
        messages: [
          { role: "user", content: promptResult.value }
        ],
        maxTokens: 4000
      });

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 修复：同时输出 newContent 和 improved_content 以兼容不同消费者
      const resultData: Record<string, unknown> = {
        newContent: chatResult.value.content,
        improved_content: chatResult.value.content // 兼容 IncrementalImproveHandler
      };

      // Property 10: 创建快照（写入前）
      if (task.payload.filePath) {
        const snapshotResult = await this.createSnapshotBeforeWrite({
          filePath: task.payload.filePath as string,
          content: chatResult.value.content,
          nodeId: task.nodeId,
          taskId: task.id,
          originalContent: currentContent
        });

        if (snapshotResult.ok) {
          resultData.snapshotId = snapshotResult.value;
        }
      }

      // Property 30: Evergreen 降级
      if (currentStatus) {
        const newStatus = this.handleEvergreenDowngrade(currentStatus);
        if (newStatus !== currentStatus) {
          resultData.statusDowngraded = true;
          resultData.newStatus = newStatus;
          resultData.previousStatus = currentStatus;
        }
      }

      return ok({
        taskId: task.id,
        state: "Completed",
        data: resultData
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 reason:incremental 失败", error as Error, {
        taskId: task.id
      });
      return err("E304", "执行 reason:incremental 失败", error);
    }
  }

  /**
   * 执行 reason:merge 任务
   * 包含 Property 10 (Snapshot Before Write) 和 Property 31 (Merge Flow Completeness)
   * 
   * 修复：统一数据契约，支持 noteA/noteB.content 格式（来自 MergeHandler）
   * 输出结构化字段：merged_name, content, merge_rationale 等
   */
  private async executeReasonMerge(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 兼容两种输入格式：contentA/contentB 或 noteA/noteB.content
      const noteA = task.payload.noteA as { nodeId: string; name: string; path: string; content: string } | undefined;
      const noteB = task.payload.noteB as { nodeId: string; name: string; path: string; content: string } | undefined;
      const contentA = (task.payload.contentA as string) || noteA?.content || "";
      const contentB = (task.payload.contentB as string) || noteB?.content || "";
      
      if (!contentA || !contentB) {
        return this.createTaskError(task, { code: "E001", message: "缺少合并内容：需要 contentA/contentB 或 noteA/noteB.content" });
      }

      const conceptType = (task.payload.type as CRType) || "Entity";
      const schema = this.getSchema(conceptType);

      const slots = {
        CTX_META: this.buildMetaContext(task.payload),
        CTX_VAULT: this.buildVaultIndexContext(conceptType),
        CTX_SCHEMA: JSON.stringify(schema, null, 2),
        CTX_NOTE_A: contentA,
        CTX_NOTE_B: contentB,
        previous_errors: this.formatErrorHistory(task.errors)
      };

      const promptResult = this.promptManager.build(task.taskType, slots, conceptType);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 调用 LLM
      const chatResult = await this.providerManager.chat({
        providerId: task.providerRef || "default",
        model: "gpt-4o",
        messages: [
          { role: "user", content: promptResult.value }
        ],
        maxTokens: 4000
      });

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 解析 LLM 返回的结构化内容
      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(chatResult.value.content);
      } catch {
        // 如果不是 JSON，包装为结构化格式
        parsedContent = { content: chatResult.value.content };
      }

      // 构建结构化的合并结果
      const resultData: Record<string, unknown> = {
        // 结构化字段（供 MergeHandler 预览使用）
        merged_name: parsedContent.merged_name || {
          chinese: noteA?.name || task.payload.nameA || "合并后的概念",
          english: ""
        },
        content: parsedContent,
        merge_rationale: parsedContent.merge_rationale || "AI 自动合并",
        preserved_from_a: parsedContent.preserved_from_a || [],
        preserved_from_b: parsedContent.preserved_from_b || [],
        conflicts_resolved: parsedContent.conflicts_resolved || [],
        // 兼容旧格式
        mergedContent: chatResult.value.content
      };

      // Property 10: 创建快照（写入前）- 为保留的笔记创建快照
      const filePath = (task.payload.filePath as string) || noteA?.path;
      if (filePath) {
        const snapshotResult = await this.createSnapshotBeforeWrite({
          filePath,
          content: chatResult.value.content,
          nodeId: task.nodeId,
          taskId: task.id,
          originalContent: contentA
        });

        if (snapshotResult.ok) {
          resultData.snapshotId = snapshotResult.value;
        }
      }

      // Property 31: 记录合并信息，供后续完成合并流程使用
      resultData.keepNodeId = task.payload.keepNodeId || noteA?.nodeId;
      resultData.deleteNodeId = task.payload.deleteNodeId || noteB?.nodeId;
      resultData.deleteFilePath = task.payload.deleteFilePath || noteB?.path;
      resultData.mergeFlowPending = true;

      return ok({
        taskId: task.id,
        state: "Completed",
        data: resultData
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 reason:merge 失败", error as Error, {
        taskId: task.id
      });
      return err("E304", "执行 reason:merge 失败", error);
    }
  }


  /**
   * 执行 ground 任务（事实核查）
   * 
   * 遵循设计文档 A-FUNC-05：可选 ground 阶段
   * 输出结构化的验证结果：overall_assessment, issues, recommendations
   */
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
        previous_errors: this.formatErrorHistory(task.errors)
      };

      const promptResult = this.promptManager.build(task.taskType, slots, conceptType);
      if (!promptResult.ok) {
        return this.createTaskError(task, promptResult.error!);
      }

      // 调用 LLM
      const chatResult = await this.providerManager.chat({
        providerId: task.providerRef || "default",
        model: "gpt-4o",
        messages: [
          { role: "user", content: promptResult.value }
        ],
        maxTokens: 2000
      });

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
      return err("E304", "执行 ground 失败", error);
    }
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 格式化错误历史
   */
  private formatErrorHistory(errors?: TaskError[]): string {
    if (!errors || errors.length === 0) {
      return "No previous errors";
    }

    return errors.map((error, index) => 
      `Attempt ${error.attempt}: [${error.code}] ${error.message}`
    ).join("\n");
  }

  /**
   * 构建 CTX_META 上下文字符串
   */
  private buildMetaContext(payload: Record<string, unknown>): string {
    const standardized = payload.standardizedData as Record<string, any> | undefined;
    const enriched = payload.enrichedData as Record<string, any> | undefined;

    const meta = {
      standardName: standardized?.standardName,
      aliases: standardized?.aliases,
      primaryType: standardized?.primaryType || payload.conceptType,
      coreDefinition: standardized?.coreDefinition || payload.coreDefinition,
      tags: enriched?.tags || [],
      nodeId: payload.nodeId
    };

    return JSON.stringify(meta, null, 2);
  }

  /**
   * 构建 CTX_VAULT 占位（简单占位，可扩展为真实索引摘要）
   */
  private buildVaultIndexContext(type?: CRType): string {
    if (!this.vectorIndex || !type) {
      return "";
    }

    const stats = this.vectorIndex.getStats();
    const count = (stats.byType as Record<string, number>)[type] || 0;
    return `Existing ${type} count: ${count}`;
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
   * 遵循设计文档 R-PDD-02：
   * 使用 SchemaRegistry 根据目标类型动态获取校验规则
   * 
   * @param conceptType 知识类型
   * @returns 校验规则代码列表（C001-C016）
   */
  private getValidationRules(conceptType: string): string[] {
    // 验证类型是否有效
    if (!this.schemaRegistry.isValidType(conceptType)) {
      this.logger.warn("TaskRunner", `未知的知识类型: ${conceptType}，使用默认规则`);
      return ["C010", "C011", "C012"]; // 通用规则
    }

    // 从 SchemaRegistry 获取类型特定的校验规则
    const rules = this.schemaRegistry.getValidationRules(conceptType as CRType);
    this.logger.debug("TaskRunner", `获取校验规则: ${conceptType}`, { rules });
    return rules;
  }

  /**
   * 获取 Schema
   * 
   * 遵循设计文档 R-PDD-02：
   * CTX_SCHEMA 由 SchemaRegistry 根据目标类型动态生成，
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
      case "reason:incremental":
      case "reason:merge":
      case "ground":
      default:
        return "chat";
    }
  }
}
