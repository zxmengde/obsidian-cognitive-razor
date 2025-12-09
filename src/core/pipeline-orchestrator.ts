/**
 * 任务管线编排器
 *
 * 负责协调任务链的执行，包括用户确认步骤
 *
 * 遵循设计文档 A-FUNC-05：
 * 任务链遵循固定顺序：standardizeClassify → enrich → embedding → 确认创建 → reason:new → 确认写入 → 去重检测
 * （现需求调整：standardize/enrich 流程自动确认创建与写入）
 *
 * 当前实现：标准创建/丰富流程自动执行写入，不生成撤销快照
 */

import {
  ITaskQueue,
  ITaskRunner,
  IDuplicateManager,
  ILogger,
  IFileStorage,
  IVectorIndex,
  IUndoManager,
  IPromptManager,
  IProviderManager,
  TaskRecord,
  TaskType,
  CRType,
  CRFrontmatter,
  NoteState,
  DuplicatePair,
  PluginSettings,
  StandardizedConcept,
  Result,
  ok,
  err
} from "../types";
import { App, TFile } from "obsidian";
import { generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { createConceptSignature, generateFilePath } from "./naming-utils";
import { FieldDescription, schemaRegistry } from "./schema-registry";
import { mapStandardizeOutput } from "./standardize-mapper";

/**
 * 管线阶段
 */
export type PipelineStage =
  | "idle"                    // 空闲
  | "standardizing"           // 标准化中
  | "enriching"               // 丰富中
  | "embedding"               // 嵌入中
  | "awaiting_create_confirm" // 等待创建确认
  | "reasoning"               // 推理中
  | "grounding"               // Ground 校验中
  | "awaiting_write_confirm"  // 等待写入确认
  | "writing"                 // 写入中
  | "deduplicating"           // 去重中
  | "completed"               // 完成
  | "failed";                 // 失败

/**
 * 管线上下文
 */
export interface PipelineContext {
  /** 管线类型：创建 / 增量改进 / 合并 */
  kind: "create" | "incremental" | "merge";
  /** 管线 ID */
  pipelineId: string;
  /** 节点 ID */
  nodeId: string;
  /** 知识类型 */
  type: CRType;
  /** 当前阶段 */
  stage: PipelineStage;
  /** 用户输入 */
  userInput: string;
  /** 标准化结果 */
  standardizedData?: StandardizedConcept;
  /** 丰富结果（别名和标签） */
  enrichedData?: {
    aliases: string[];
    tags: string[];
  };
  /** 嵌入向量 */
  embedding?: number[];
  /** 生成的内容 */
  generatedContent?: unknown;
  /** 写入前的原始内容（增量/合并预览使用） */
  previousContent?: string;
  /** 待写入的新内容（增量/合并预览使用） */
  newContent?: string;
  /** 文件路径 */
  filePath?: string;
  /** Ground 结果 */
  groundingResult?: Record<string, unknown>;
  /** 增量/合并特有字段 */
  mergePairId?: string;
  deleteFilePath?: string;
  deleteNodeId?: string;
  deleteContent?: string;
  currentStatus?: string;
  /** 快照 ID */
  snapshotId?: string;
  /** 是否跳过快照/撤销记录（enrich 流程自动执行时使用） */
  skipSnapshots?: boolean;
  /** 错误信息 */
  error?: { code: string; message: string };
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 管线事件类型
 */
export type PipelineEventType =
  | "stage_changed"
  | "task_completed"
  | "task_failed"
  | "confirmation_required"
  | "pipeline_completed"
  | "pipeline_failed";

/**
 * 管线事件
 */
export interface PipelineEvent {
  type: PipelineEventType;
  pipelineId: string;
  stage: PipelineStage;
  context: PipelineContext;
  timestamp: string;
}

/**
 * 管线事件监听器
 */
export type PipelineEventListener = (event: PipelineEvent) => void;

/**
 * 管线编排器依赖
 */
export interface PipelineOrchestratorDependencies {
  app: App;
  taskQueue: ITaskQueue;
  taskRunner: ITaskRunner;
  duplicateManager: IDuplicateManager;
  logger: ILogger;
  fileStorage: IFileStorage;
  vectorIndex: IVectorIndex;
  undoManager: IUndoManager;
  promptManager?: IPromptManager;
  providerManager?: IProviderManager;
  getSettings: () => PluginSettings;
}

/**
 * 管线编排器接口
 */
export interface IPipelineOrchestrator {
  /** 启动新概念创建管线 */
  startCreatePipeline(userInput: string, type?: CRType): Result<string>;

  /** 直接标准化（不入队，用于 UI 交互） */
  standardizeDirect(userInput: string): Promise<Result<StandardizedConcept>>;

  /** 使用已标准化数据启动创建管线（跳过标准化阶段） */
  startCreatePipelineWithStandardized(
    standardizedData: StandardizedConcept,
    selectedType: CRType
  ): Result<string>;

  /** 启动增量改进管线 */
  startIncrementalPipeline(params: {
    nodeId: string;
    filePath: string;
    noteType: CRType;
    currentContent: string;
    userIntent: string;
    currentStatus?: NoteState;
  }): Result<string>;

  /** 启动合并管线 */
  startMergePipeline(pair: DuplicatePair): Promise<Result<string>>;
  
  /** 确认创建（在 embedding 之后） */
  confirmCreate(pipelineId: string): Promise<Result<void>>;

  /** 更新标准化结果（用户编辑/类型歧义选择） */
  updateStandardizedData(
    pipelineId: string,
    updates: Partial<PipelineContext["standardizedData"]>
  ): Result<PipelineContext>;
  
  /** 确认写入（在 reason:new 之后） */
  confirmWrite(pipelineId: string): Promise<Result<void>>;

  /** 构建写入预览（返回当前内容与即将写入的内容） */
  buildWritePreview(pipelineId: string): Promise<Result<{
    targetPath: string;
    newContent: string;
    previousContent: string;
  }>>;
  
  /** 取消管线 */
  cancelPipeline(pipelineId: string): Result<void>;
  
  /** 获取管线上下文 */
  getContext(pipelineId: string): PipelineContext | undefined;
  
  /** 获取所有活跃管线 */
  getActivePipelines(): PipelineContext[];
  
  /** 订阅管线事件 */
  subscribe(listener: PipelineEventListener): () => void;
}

export class PipelineOrchestrator implements IPipelineOrchestrator {
  private app: App;
  private taskQueue: ITaskQueue;
  private taskRunner: ITaskRunner;
  private duplicateManager: IDuplicateManager;
  private logger: ILogger;
  private fileStorage: IFileStorage;
  private vectorIndex: IVectorIndex;
  private undoManager: IUndoManager;
  private promptManager?: IPromptManager;
  private providerManager?: IProviderManager;
  private getSettings: () => PluginSettings;
  
  private pipelines: Map<string, PipelineContext>;
  private listeners: PipelineEventListener[];
  private taskToPipeline: Map<string, string>; // taskId -> pipelineId

  constructor(deps: PipelineOrchestratorDependencies) {
    this.app = deps.app;
    this.taskQueue = deps.taskQueue;
    this.taskRunner = deps.taskRunner;
    this.duplicateManager = deps.duplicateManager;
    this.logger = deps.logger;
    this.fileStorage = deps.fileStorage;
    this.vectorIndex = deps.vectorIndex;
    this.undoManager = deps.undoManager;
    this.promptManager = deps.promptManager;
    this.providerManager = deps.providerManager;
    this.getSettings = deps.getSettings;
    
    this.pipelines = new Map();
    this.listeners = [];
    this.taskToPipeline = new Map();

    // 订阅任务队列事件
    this.subscribeToTaskQueue();

    this.logger.debug("PipelineOrchestrator", "管线编排器初始化完成");
  }

  /**
   * 前置校验：检查 Provider 和模板是否可用
   * 遵循 A-FUNC-03：任务执行前必须找到匹配的 Provider 与 PDD 模板
   * 
   * @param taskType 任务类型
   * @param conceptType 知识类型（可选，用于 reason:new 任务）
   * @returns 校验结果
   */
  private validatePrerequisites(taskType: TaskType, conceptType?: CRType): Result<void> {
    const settings = this.getSettings();
    
    // 1. 检查 Provider 是否配置
    const providerId = this.getProviderIdForTask(taskType);
    if (!providerId) {
      this.logger.error("PipelineOrchestrator", "Provider 未配置", undefined, {
        taskType,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E304", `任务 ${taskType} 未配置 Provider，请在设置中配置 Provider`);
    }

    // 检查 Provider 是否存在且启用
    const providerConfig = settings.providers[providerId];
    if (!providerConfig) {
      this.logger.error("PipelineOrchestrator", "Provider 不存在", undefined, {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E304", `Provider "${providerId}" 不存在，请在设置中重新配置`);
    }

    if (!providerConfig.enabled) {
      this.logger.error("PipelineOrchestrator", "Provider 已禁用", undefined, {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E304", `Provider "${providerId}" 已禁用，请在设置中启用`);
    }

    if (!providerConfig.apiKey) {
      this.logger.error("PipelineOrchestrator", "Provider API Key 未配置", undefined, {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E103", `Provider "${providerId}" 的 API Key 未配置`);
    }

    // 2. 检查模板是否已加载（如果有 PromptManager）
    if (this.promptManager) {
      const templateId = this.promptManager.resolveTemplateId(taskType, conceptType);
      if (!this.promptManager.hasTemplate(templateId)) {
        this.logger.error("PipelineOrchestrator", "模板未加载", undefined, {
          taskType,
          templateId,
          event: "PREREQUISITE_CHECK_FAILED"
        });
        return err("E002", `模板 "${templateId}" 未加载，请检查 prompts 目录`);
      }
    }

    this.logger.debug("PipelineOrchestrator", "前置校验通过", {
      taskType,
      providerId,
      event: "PREREQUISITE_CHECK_PASSED"
    });

    return ok(undefined);
  }

  /**
   * 启动新概念创建管线
   * 
   * 遵循 A-FUNC-05：任务链从 standardizeClassify 开始
   * 遵循 A-FUNC-03：入队前进行 Provider/模板前置校验
   */
  startCreatePipeline(userInput: string, type?: CRType): Result<string> {
    try {
      // A-FUNC-03: 前置校验 - 检查 Provider 和模板是否可用
      const prerequisiteCheck = this.validatePrerequisites("standardizeClassify");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<string>;
      }

      const pipelineId = this.generatePipelineId();
      const nodeId = this.generateNodeId();
      const now = new Date().toISOString();

      const context: PipelineContext = {
        kind: "create",
        pipelineId,
        nodeId,
        type: type || "Entity", // 默认类型，会在标准化后更新
        stage: "standardizing",
        userInput,
        skipSnapshots: true,
        createdAt: now,
        updatedAt: now
      };

      this.pipelines.set(pipelineId, context);

      this.logger.info("PipelineOrchestrator", `启动创建管线: ${pipelineId}`, {
        nodeId,
        userInput: userInput.substring(0, 50)
      });

      // 创建 standardizeClassify 任务
      const taskResult = this.taskQueue.enqueue({
        nodeId,
        taskType: "standardizeClassify",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("standardizeClassify"),
        payload: {
          userInput,
          pipelineId
        }
      });

      if (!taskResult.ok) {
        this.pipelines.delete(pipelineId);
        return err("E304", `创建任务失败: ${taskResult.error.message}`);
      }

      // 记录任务到管线的映射
      this.taskToPipeline.set(taskResult.value, pipelineId);

      // 发布事件
      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "standardizing",
        context,
        timestamp: now
      });

      return ok(pipelineId);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "启动管线失败", error as Error);
      return err("E304", "启动管线失败", error);
    }
  }

  /**
   * 直接标准化（不入队）
   * 
   * 遵循 Requirements 4.1, 4.2：
   * - 直接调用 ProviderManager.chat，不进入任务队列
   * - 立即返回结果给 UI 用于用户确认
   * 
   * @param userInput 用户输入的概念
   * @returns 标准化结果
   */
  async standardizeDirect(userInput: string): Promise<Result<StandardizedConcept>> {
    try {
      // 前置校验
      const prerequisiteCheck = this.validatePrerequisites("standardizeClassify");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<StandardizedConcept>;
      }

      if (!this.providerManager) {
        return err("E304", "ProviderManager 未初始化");
      }

      if (!this.promptManager) {
        return err("E304", "PromptManager 未初始化");
      }

      this.logger.info("PipelineOrchestrator", "开始直接标准化", {
        userInput: userInput.substring(0, 50),
        event: "STANDARDIZE_DIRECT_START"
      });

      // 获取 Provider 配置
      const settings = this.getSettings();
      const taskConfig = settings.taskModels["standardizeClassify"];
      const providerId = taskConfig.providerId;

      // 构建 prompt
      const promptResult = this.promptManager.build(
        "standardizeClassify",
        { CTX_INPUT: userInput }
      );

      if (!promptResult.ok) {
        return err(promptResult.error.code, promptResult.error.message);
      }

      // 直接调用 API
      const chatResult = await this.providerManager.chat({
        providerId,
        model: taskConfig.model,
        messages: [
          { role: "system", content: promptResult.value },
          { role: "user", content: userInput }
        ],
        temperature: taskConfig.temperature,
        topP: taskConfig.topP,
        maxTokens: taskConfig.maxTokens
      });

      if (!chatResult.ok) {
        this.logger.error("PipelineOrchestrator", "标准化 API 调用失败", undefined, {
          errorCode: chatResult.error.code,
          errorMessage: chatResult.error.message,
          event: "STANDARDIZE_DIRECT_ERROR"
        });
        return err(chatResult.error.code, chatResult.error.message);
      }

      // 解析响应
      try {
        const content = chatResult.value.content.trim();
        // 尝试提取 JSON（可能被 markdown 代码块包裹）
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : content;
        const rawParsed = JSON.parse(jsonStr);

        // 转换字段名：API 返回下划线命名，需要转换为驼峰式
        const parsed: StandardizedConcept = mapStandardizeOutput(rawParsed);

        this.logger.info("PipelineOrchestrator", "直接标准化完成", {
          primaryType: parsed.primaryType,
          event: "STANDARDIZE_DIRECT_SUCCESS"
        });

        return ok(parsed);
      } catch (parseError) {
        this.logger.error("PipelineOrchestrator", "解析标准化结果失败", parseError as Error, {
          response: chatResult.value.content.substring(0, 200),
          event: "STANDARDIZE_DIRECT_PARSE_ERROR"
        });
        return err("E100", "解析标准化结果失败", parseError);
      }
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "直接标准化失败", error as Error);
      return err("E304", "直接标准化失败", error);
    }
  }

  /**
   * 使用已标准化数据启动创建管线（跳过标准化阶段）
   * 
   * 遵循 Requirements 4.3：
   * - 跳过标准化阶段，直接从 enrich 开始
   * - 用户已通过 standardizeDirect 获得标准化结果并选择了类型
   * 
   * @param standardizedData 标准化数据
   * @param selectedType 用户选择的类型
   * @returns 管线 ID
   */
  startCreatePipelineWithStandardized(
    standardizedData: StandardizedConcept,
    selectedType: CRType
  ): Result<string> {
    try {
      // 前置校验 enrich 任务
      const prerequisiteCheck = this.validatePrerequisites("enrich");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<string>;
      }

      const pipelineId = this.generatePipelineId();
      const nodeId = this.generateNodeId();
      const now = new Date().toISOString();

      // 创建管线上下文，直接设置标准化数据
      const context: PipelineContext = {
        kind: "create",
        pipelineId,
        nodeId,
        type: selectedType,
        stage: "enriching", // 直接进入 enriching 阶段
        userInput: standardizedData.standardNames[selectedType].chinese,
        skipSnapshots: true,
        standardizedData: {
          standardNames: standardizedData.standardNames,
          typeConfidences: standardizedData.typeConfidences,
          primaryType: selectedType,
          coreDefinition: standardizedData.coreDefinition
        },
        createdAt: now,
        updatedAt: now
      };

      this.pipelines.set(pipelineId, context);

      this.logger.info("PipelineOrchestrator", `启动创建管线（跳过标准化）: ${pipelineId}`, {
        nodeId,
        selectedType,
        chinese: standardizedData.standardNames[selectedType].chinese
      });

      // 创建 enrich 任务
      const taskResult = this.taskQueue.enqueue({
        nodeId,
        taskType: "enrich",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("enrich"),
        payload: {
          pipelineId,
          standardizedData: context.standardizedData,
          conceptType: selectedType
        }
      });

      if (!taskResult.ok) {
        this.pipelines.delete(pipelineId);
        return err("E304", `创建任务失败: ${taskResult.error.message}`);
      }

      // 记录任务到管线的映射
      this.taskToPipeline.set(taskResult.value, pipelineId);

      // 发布事件
      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "enriching",
        context,
        timestamp: now
      });

      return ok(pipelineId);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "启动管线失败", error as Error);
      return err("E304", "启动管线失败", error);
    }
  }

  private async confirmCreateWrite(context: PipelineContext): Promise<Result<void>> {
    const composed = await this.composeWriteContent(context);
    if (!composed.ok) {
      context.stage = "failed";
      context.error = { code: composed.error.code, message: composed.error.message };
      return composed as Result<void>;
    }

    const { targetPath, previousContent, newContent } = composed.value;
    context.filePath = targetPath;

    if (!context.skipSnapshots) {
      const snapshotResult = await this.undoManager.createSnapshot(
        targetPath,
        previousContent,
        context.pipelineId,
        context.nodeId
      );
      if (snapshotResult.ok) {
        context.snapshotId = snapshotResult.value;
      }
    }

    await this.atomicWriteVault(targetPath, newContent);

    this.logger.info("PipelineOrchestrator", `文件已写入 (Stub → Draft): ${targetPath}`, {
      pipelineId: context.pipelineId,
      fileSize: newContent.length,
      hasSnapshot: !!context.snapshotId,
      statusTransition: "Stub → Draft"
    });

    if (context.embedding && context.standardizedData) {
      const signature = createConceptSignature(
        {
          standardName: context.standardizedData.standardNames[context.type],
          aliases: context.enrichedData?.aliases || [],
          coreDefinition: context.standardizedData.coreDefinition
        },
        context.type,
        this.getSettings().namingTemplate
      );
      await this.vectorIndex.upsert({
        uid: context.nodeId,
        type: context.type,
        name: signature.standardName,
        path: targetPath,
        embedding: context.embedding,
        updated: new Date().toISOString()
      });
    }

    context.stage = "deduplicating";
    context.updatedAt = new Date().toISOString();
    if (context.embedding) {
      await this.duplicateManager.detect(
        context.nodeId,
        context.type,
        context.embedding
      );
    }

    context.stage = "completed";
    context.updatedAt = new Date().toISOString();
    this.publishEvent({
      type: "pipeline_completed",
      pipelineId: context.pipelineId,
      stage: "completed",
      context,
      timestamp: context.updatedAt
    });

    return ok(undefined);
  }

  private async confirmIncrementalWrite(context: PipelineContext): Promise<Result<void>> {
    const composed = await this.composeWriteContent(context);
    if (!composed.ok) {
      context.stage = "failed";
      context.error = { code: composed.error.code, message: composed.error.message };
      return composed as Result<void>;
    }

    const { targetPath, previousContent, newContent } = composed.value;
    context.filePath = targetPath;

    if (!context.skipSnapshots) {
      const snapshotResult = await this.undoManager.createSnapshot(
        targetPath,
        previousContent,
        context.pipelineId,
        context.nodeId
      );
      if (snapshotResult.ok) {
        context.snapshotId = snapshotResult.value;
      }
    }

    await this.atomicWriteVault(targetPath, newContent);

    // 更新向量索引并去重（复用已有向量）
    const entry = this.vectorIndex.getEntry(context.nodeId);
    if (entry) {
      const updatedEntry = { ...entry, path: targetPath, updated: new Date().toISOString() };
      await this.vectorIndex.upsert(updatedEntry);
      await this.duplicateManager.detect(context.nodeId, entry.type, entry.embedding);
    }

    context.stage = "completed";
    context.updatedAt = new Date().toISOString();
    this.publishEvent({
      type: "pipeline_completed",
      pipelineId: context.pipelineId,
      stage: "completed",
      context,
      timestamp: context.updatedAt
    });

    return ok(undefined);
  }

  private async confirmMergeWrite(context: PipelineContext): Promise<Result<void>> {
    const composed = await this.composeWriteContent(context);
    if (!composed.ok) {
      context.stage = "failed";
      context.error = { code: composed.error.code, message: composed.error.message };
      return composed as Result<void>;
    }

    const { targetPath, previousContent, newContent } = composed.value;
    context.filePath = targetPath;

    if (!context.skipSnapshots) {
      const snapshotResult = await this.undoManager.createSnapshot(
        targetPath,
        previousContent,
        context.pipelineId,
        context.nodeId
      );
      if (snapshotResult.ok) {
        context.snapshotId = snapshotResult.value;
      }
    }

    // 为被删除笔记创建快照
    if (context.deleteFilePath && context.deleteContent && !context.skipSnapshots) {
      await this.undoManager.createSnapshot(
        context.deleteFilePath,
        context.deleteContent,
        `merge-delete-${context.mergePairId ?? context.pipelineId}`,
        context.deleteNodeId
      );
    }

    await this.atomicWriteVault(targetPath, newContent);

    // 删除被合并的笔记
    if (context.deleteFilePath) {
      const fileB = this.app.vault.getAbstractFileByPath(context.deleteFilePath);
      if (fileB && fileB instanceof TFile) {
        await this.app.vault.delete(fileB);
      }
    }

    // 向量索引同步
    if (context.deleteNodeId) {
      await this.vectorIndex.delete(context.deleteNodeId);
    }
    const entry = this.vectorIndex.getEntry(context.nodeId);
    if (entry) {
      const updatedEntry = { ...entry, path: targetPath, updated: new Date().toISOString() };
      await this.vectorIndex.upsert(updatedEntry);
      await this.duplicateManager.detect(context.nodeId, entry.type, entry.embedding);
    }

    // 去重记录清理
    if (context.mergePairId) {
      await this.duplicateManager.removePair(context.mergePairId);
    }

    context.stage = "completed";
    context.updatedAt = new Date().toISOString();
    this.publishEvent({
      type: "pipeline_completed",
      pipelineId: context.pipelineId,
      stage: "completed",
      context,
      timestamp: context.updatedAt
    });

    return ok(undefined);
  }

  /**
   * 处理增量改进完成
   */
  private async handleReasonIncrementalCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    const improved = result?.newContent || result?.improved_content;

    if (!improved) {
      context.stage = "failed";
      context.error = { code: "E304", message: "增量改进结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
      return;
    }

    context.newContent = improved as string;
    context.generatedContent = result;
    context.updatedAt = new Date().toISOString();

    const settings = this.getSettings();
    if (settings.enableGrounding) {
      context.stage = "grounding";
      const taskResult = this.taskQueue.enqueue({
        nodeId: context.nodeId,
        taskType: "ground",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("ground"),
        payload: {
          pipelineId: context.pipelineId,
          currentContent: improved,
          conceptType: context.type
        }
      });

      if (!taskResult.ok) {
        context.stage = "failed";
        context.error = { code: "E304", message: taskResult.error.message };
        return;
      }

      this.taskToPipeline.set(taskResult.value, context.pipelineId);
      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "grounding",
        context,
        timestamp: context.updatedAt
      });
    } else {
      this.transitionToAwaitingWriteConfirm(context);
    }
  }

  /**
   * 处理合并完成
   */
  private async handleReasonMergeCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const mergeResult = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    if (!mergeResult) {
      context.stage = "failed";
      context.error = { code: "E304", message: "合并结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const mergedContent = this.buildMergedContent(
      mergeResult,
      context.previousContent || "",
      context.type
    );

    if (!mergedContent.ok) {
      context.stage = "failed";
      context.error = { code: mergedContent.error.code, message: mergedContent.error.message };
      return;
    }

    context.newContent = mergedContent.value;
    context.generatedContent = mergeResult;
    context.updatedAt = new Date().toISOString();

    const settings = this.getSettings();
    if (settings.enableGrounding) {
      context.stage = "grounding";
      const taskResult = this.taskQueue.enqueue({
        nodeId: context.nodeId,
        taskType: "ground",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("ground"),
        payload: {
          pipelineId: context.pipelineId,
          currentContent: mergedContent.value,
          conceptType: context.type
        }
      });

      if (!taskResult.ok) {
        context.stage = "failed";
        context.error = { code: "E304", message: taskResult.error.message };
        return;
      }

      this.taskToPipeline.set(taskResult.value, context.pipelineId);
      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "grounding",
        context,
        timestamp: context.updatedAt
      });
    } else {
      this.transitionToAwaitingWriteConfirm(context);
    }
  }

  /**
   * 启动增量改进管线
   * 遵循 A-FUNC-03：入队前进行 Provider/模板前置校验
   */
  startIncrementalPipeline(params: {
    nodeId: string;
    filePath: string;
    noteType: CRType;
    currentContent: string;
    userIntent: string;
    currentStatus?: NoteState;
  }): Result<string> {
    try {
      // A-FUNC-03: 前置校验 - 检查 Provider 和模板是否可用
      const prerequisiteCheck = this.validatePrerequisites("reason:incremental");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<string>;
      }

      const pipelineId = this.generatePipelineId();
      const now = new Date().toISOString();

      const context: PipelineContext = {
        kind: "incremental",
        pipelineId,
        nodeId: params.nodeId,
        type: params.noteType,
        stage: "reasoning",
        userInput: params.userIntent,
        previousContent: params.currentContent,
        filePath: params.filePath,
        currentStatus: params.currentStatus,
        createdAt: now,
        updatedAt: now
      };

      this.pipelines.set(pipelineId, context);

      const taskResult = this.taskQueue.enqueue({
        nodeId: params.nodeId,
        taskType: "reason:incremental",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("reason:incremental"),
        payload: {
          pipelineId,
          filePath: params.filePath,
          currentContent: params.currentContent,
          conceptType: params.noteType,
          userIntent: params.userIntent,
          currentStatus: params.currentStatus
        }
      });

      if (!taskResult.ok) {
        this.pipelines.delete(pipelineId);
        return err("E304", `创建增量任务失败: ${taskResult.error.message}`);
      }

      this.taskToPipeline.set(taskResult.value, pipelineId);

      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "reasoning",
        context,
        timestamp: now
      });

      return ok(pipelineId);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "启动增量管线失败", error as Error);
      return err("E304", "启动增量管线失败", error);
    }
  }

  /**
   * 启动合并管线
   * 遵循 A-FUNC-03：入队前进行 Provider/模板前置校验
   */
  async startMergePipeline(pair: DuplicatePair): Promise<Result<string>> {
    try {
      // A-FUNC-03: 前置校验 - 检查 Provider 和模板是否可用
      const prerequisiteCheck = this.validatePrerequisites("reason:merge");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<string>;
      }

      const pipelineId = this.generatePipelineId();
      const now = new Date().toISOString();

      const fileA = this.app.vault.getAbstractFileByPath(pair.noteA.path);
      const fileB = this.app.vault.getAbstractFileByPath(pair.noteB.path);
      if (!fileA || !(fileA instanceof TFile)) {
        return err("E304", `文件不存在: ${pair.noteA.path}`);
      }
      if (!fileB || !(fileB instanceof TFile)) {
        return err("E304", `文件不存在: ${pair.noteB.path}`);
      }

      const contentA = await this.app.vault.read(fileA);
      const contentB = await this.app.vault.read(fileB);

      const statusResult = await this.duplicateManager.updateStatus(pair.id, "merging");
      if (!statusResult.ok) {
        return err(statusResult.error.code, statusResult.error.message, statusResult.error.details);
      }

      const context: PipelineContext = {
        kind: "merge",
        pipelineId,
        nodeId: pair.noteA.nodeId,
        type: pair.type,
        stage: "reasoning",
        userInput: `${pair.noteA.name} <- ${pair.noteB.name}`,
        previousContent: contentA,
        filePath: pair.noteA.path,
        mergePairId: pair.id,
        deleteFilePath: pair.noteB.path,
        deleteNodeId: pair.noteB.nodeId,
        deleteContent: contentB,
        createdAt: now,
        updatedAt: now
      };

      this.pipelines.set(pipelineId, context);

      const taskResult = this.taskQueue.enqueue({
        nodeId: pair.noteA.nodeId,
        taskType: "reason:merge",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("reason:merge"),
        payload: {
          pipelineId,
          pairId: pair.id,
          noteA: { ...pair.noteA, content: contentA },
          noteB: { ...pair.noteB, content: contentB },
          type: pair.type,
          similarity: pair.similarity
        }
      });

      if (!taskResult.ok) {
        this.pipelines.delete(pipelineId);
        await this.duplicateManager.updateStatus(pair.id, "pending");
        return err("E304", `创建合并任务失败: ${taskResult.error.message}`);
      }

      this.taskToPipeline.set(taskResult.value, pipelineId);

      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "reasoning",
        context,
        timestamp: now
      });

      return ok(pipelineId);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "启动合并管线失败", error as Error);
      return err("E304", "启动合并管线失败", error);
    }
  }

  /**
   * 确认创建（在 embedding 之后）
   * 
   * 遵循 A-FUNC-05：确认创建后先生成 Stub，再执行 reason:new
   * 遵循 A-UCD-03：写入需显式确认
   * 遵循设计文档：Stub 状态仅含 frontmatter，后续 reason:new 完成后转为 Draft
   */
  async confirmCreate(pipelineId: string): Promise<Result<void>> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E304", `管线不存在: ${pipelineId}`);
    }

    if (context.stage !== "awaiting_create_confirm") {
      return err("E304", `管线状态不正确: ${context.stage}，期望: awaiting_create_confirm`);
    }

    try {
      this.logger.info("PipelineOrchestrator", `用户确认创建: ${pipelineId}`);

      // 1. 生成 Stub 文件（仅含 frontmatter，NoteState: Stub）
      const stubResult = await this.createStubFile(context);
      if (!stubResult.ok) {
        context.stage = "failed";
        context.error = { code: stubResult.error.code, message: stubResult.error.message };
        return stubResult as Result<void>;
      }

      // 2. 更新阶段为 reasoning
      context.stage = "reasoning";
      context.updatedAt = new Date().toISOString();

      // 3. 创建 reason:new 任务
      const taskResult = this.taskQueue.enqueue({
        nodeId: context.nodeId,
        taskType: "reason:new",
        state: "Pending",
        attempt: 0,
        maxAttempts: 3,
        providerRef: this.getProviderIdForTask("reason:new"),
        payload: {
          pipelineId,
          standardizedData: context.standardizedData,
          conceptType: context.type,
          coreDefinition: context.standardizedData?.coreDefinition,
          enrichedData: context.enrichedData,
          embedding: context.embedding,
          filePath: context.filePath, // 传递 Stub 文件路径
          skipSnapshot: context.skipSnapshots
        }
      });

      if (!taskResult.ok) {
        context.stage = "failed";
        context.error = { code: "E304", message: taskResult.error.message };
        return err("E304", `创建任务失败: ${taskResult.error.message}`);
      }

      this.taskToPipeline.set(taskResult.value, pipelineId);

      // 发布事件
      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "reasoning",
        context,
        timestamp: context.updatedAt
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "确认创建失败", error as Error);
      return err("E304", "确认创建失败", error);
    }
  }

  /**
   * 创建 Stub 文件
   * 
   * 遵循设计文档 A-FUNC-05：确认创建后先落地仅含 frontmatter 的 Stub
   * Stub 状态表示占位符，仅有 frontmatter，无正文内容
   */
  private async createStubFile(context: PipelineContext): Promise<Result<string>> {
    try {
      if (!context.standardizedData) {
        return err("E304", "缺少标准化数据，无法创建 Stub");
      }

      const settings = this.getSettings();
      const signature = createConceptSignature(
        {
          standardName: context.standardizedData.standardNames[context.type],
          aliases: context.enrichedData?.aliases || [],
          coreDefinition: context.standardizedData.coreDefinition
        },
        context.type,
        settings.namingTemplate
      );

      // 生成目标路径
      const targetPath = generateFilePath(
        signature.standardName,
        settings.directoryScheme,
        context.type
      );
      context.filePath = targetPath;

      // 确保目录存在
      await this.ensureVaultDir(targetPath);

      // 创建快照（空内容，因为是新文件）
      if (!context.skipSnapshots) {
        const snapshotResult = await this.undoManager.createSnapshot(
          targetPath,
          "", // 新文件，原始内容为空
          `stub-${context.pipelineId}`,
          context.nodeId
        );
        if (snapshotResult.ok) {
          context.snapshotId = snapshotResult.value;
        }
      }

      // 生成仅含 frontmatter 的 Stub 内容
      const frontmatter = generateFrontmatter({
        uid: context.nodeId,
        type: context.type,
        status: "Stub", // Stub 状态
        aliases: context.enrichedData?.aliases,
        tags: context.enrichedData?.tags
      });
      const stubContent = generateMarkdownContent(frontmatter, ""); // 无正文

      // 原子写入 Stub 文件
      await this.atomicWriteVault(targetPath, stubContent);

      this.logger.info("PipelineOrchestrator", `Stub 文件已创建: ${targetPath}`, {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId,
        status: "Stub"
      });

      return ok(targetPath);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "创建 Stub 文件失败", error as Error);
      return err("E304", "创建 Stub 文件失败", error);
    }
  }

  /**
   * 用户更新标准化结果 / 类型选择
   * 支持类型歧义确认与别名/名称校正
   */
  updateStandardizedData(
    pipelineId: string,
    updates: Partial<PipelineContext["standardizedData"]>
  ): Result<PipelineContext> {
    const edits = updates || {};
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E304", `管线不存在: ${pipelineId}`);
    }

    if (!context.standardizedData) {
      return err("E304", "标准化结果尚未生成，无法更新");
    }

    // 合并名称、别名、类型
    const merged: NonNullable<PipelineContext["standardizedData"]> = {
      ...context.standardizedData,
      ...edits,
      standardNames: {
        ...context.standardizedData.standardNames,
        ...(edits.standardNames || {})
      },
      typeConfidences: edits.typeConfidences ?? context.standardizedData.typeConfidences ?? {}
    };

    // 设置主要类型（优先用户选择）
    if (edits.primaryType) {
      merged.primaryType = edits.primaryType as CRType;
      context.type = edits.primaryType as CRType;
    } else if (merged.typeConfidences) {
      const primaryType = Object.entries(merged.typeConfidences)
        .sort(([, a], [, b]) => b - a)[0]?.[0] as CRType | undefined;
      if (primaryType) {
        merged.primaryType = primaryType;
        context.type = primaryType;
      }
    }

    context.standardizedData = merged;
    context.updatedAt = new Date().toISOString();

    this.publishEvent({
      type: "stage_changed",
      pipelineId,
      stage: context.stage,
      context,
      timestamp: context.updatedAt
    });

    return ok(context);
  }

  /**
   * 确认写入（在 reason:new 之后）
   * 
   * 遵循 A-FUNC-05：确认写入后执行去重检测，Stub → Draft 状态转换
   * 遵循 A-UCD-03：写入需显式确认，确认后提供撤销
   * 遵循 A-NF-02：使用原子写入确保数据完整性
   * 遵循 Requirements 2.7-2.8：创建快照并使用原子写入
   */
  async confirmWrite(pipelineId: string): Promise<Result<void>> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E304", `管线不存在: ${pipelineId}`);
    }

    if (context.stage !== "awaiting_write_confirm") {
      return err("E304", `管线状态不正确: ${context.stage}，期望: awaiting_write_confirm`);
    }

    try {
      context.stage = "writing";
      context.updatedAt = new Date().toISOString();

      this.logger.info("PipelineOrchestrator", `用户确认写入: ${pipelineId}`);

      if (context.kind === "create") {
        return await this.confirmCreateWrite(context);
      }
      if (context.kind === "incremental") {
        return await this.confirmIncrementalWrite(context);
      }
      if (context.kind === "merge") {
        return await this.confirmMergeWrite(context);
      }

      return err("E304", "未知的管线类型");
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "确认写入失败", error as Error);
      context.stage = "failed";
      context.error = { code: "E304", message: String(error) };
      return err("E304", "确认写入失败", error);
    }
  }

  /**
   * 构建写入预览内容（不落盘）
   */
  async buildWritePreview(pipelineId: string): Promise<Result<{
    targetPath: string;
    newContent: string;
    previousContent: string;
  }>> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E304", `管线不存在: ${pipelineId}`);
    }

    if (!["awaiting_write_confirm", "writing", "deduplicating"].includes(context.stage)) {
      return err("E304", `当前阶段不支持预览: ${context.stage}`);
    }

    return this.composeWriteContent(context);
  }

  /**
   * 取消管线
   */
  cancelPipeline(pipelineId: string): Result<void> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E304", `管线不存在: ${pipelineId}`);
    }

    // 取消所有关联的任务
    for (const [taskId, pid] of this.taskToPipeline.entries()) {
      if (pid === pipelineId) {
        this.taskQueue.cancel(taskId);
        this.taskToPipeline.delete(taskId);
      }
    }

    // 更新状态
    context.stage = "failed";
    context.error = { code: "E304", message: "用户取消" };
    context.updatedAt = new Date().toISOString();

    this.logger.info("PipelineOrchestrator", `管线已取消: ${pipelineId}`);

    return ok(undefined);
  }

  /**
   * 获取管线上下文
   */
  getContext(pipelineId: string): PipelineContext | undefined {
    return this.pipelines.get(pipelineId);
  }

  /**
   * 获取所有活跃管线
   */
  getActivePipelines(): PipelineContext[] {
    return Array.from(this.pipelines.values()).filter(
      ctx => ctx.stage !== "completed" && ctx.stage !== "failed"
    );
  }

  /**
   * 订阅管线事件
   */
  subscribe(listener: PipelineEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 订阅任务队列事件
   */
  private subscribeToTaskQueue(): void {
    this.taskQueue.subscribe((event) => {
      if (event.type === "task-completed" && event.taskId) {
        this.handleTaskCompleted(event.taskId);
      } else if (event.type === "task-failed" && event.taskId) {
        this.handleTaskFailed(event.taskId);
      }
    });
  }

  /**
   * 处理任务完成
   */
  private async handleTaskCompleted(taskId: string): Promise<void> {
    const pipelineId = this.taskToPipeline.get(taskId);
    if (!pipelineId) return;

    const context = this.pipelines.get(pipelineId);
    if (!context) return;

    const task = this.taskQueue.getTask(taskId);
    if (!task) return;

    this.logger.debug("PipelineOrchestrator", `任务完成: ${taskId}`, {
      pipelineId,
      taskType: task.taskType
    });

    // 根据任务类型更新管线状态并触发下一步
    switch (task.taskType) {
      case "standardizeClassify":
        await this.handleStandardizeCompleted(context, task);
        break;
      case "enrich":
        await this.handleEnrichCompleted(context, task);
        break;
      case "embedding":
        await this.handleEmbeddingCompleted(context, task);
        break;
      case "reason:new":
        await this.handleReasonNewCompleted(context, task);
        break;
      case "reason:incremental":
        await this.handleReasonIncrementalCompleted(context, task);
        break;
      case "reason:merge":
        await this.handleReasonMergeCompleted(context, task);
        break;
      case "ground":
        await this.handleGroundCompleted(context, task);
        break;
    }
  }

  /**
   * 处理 Ground 任务完成
   * 
   * Ground 完成后进入等待写入确认阶段（需要用户确认）
   * 如果 Ground 发现严重问题，记录到上下文中供用户参考
   */
  private async handleGroundCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    
    if (result) {
      context.groundingResult = result;
      // 记录 Ground 结果到上下文（供 UI 展示）
      // 使用 generatedContent 的扩展字段存储 grounding 结果
      if (context.generatedContent && typeof context.generatedContent === "object") {
        (context.generatedContent as Record<string, unknown>)._groundingResult = {
          overall_assessment: result.overall_assessment,
          confidence_score: result.confidence_score,
          issues: result.issues,
          recommendations: result.recommendations,
          requires_human_review: result.requires_human_review
        };
      }

      this.logger.info("PipelineOrchestrator", `Ground 完成: ${context.pipelineId}`, {
        overall_assessment: result.overall_assessment,
        issueCount: Array.isArray(result.issues) ? result.issues.length : 0
      });
    }

    // Ground 完成后进入等待写入确认阶段（需要用户确认）
    this.transitionToAwaitingWriteConfirm(context);
  }

  /**
   * 处理标准化完成
   */
  private async handleStandardizeCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as PipelineContext["standardizedData"];
    if (!result) {
      context.stage = "failed";
      context.error = { code: "E304", message: "标准化结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
      return;
    }

    context.standardizedData = result;
    // 更新类型（使用 primaryType 或置信度最高的）
    if (result.primaryType) {
      context.type = result.primaryType as CRType;
    } else if (result.typeConfidences) {
      const primaryType = Object.entries(result.typeConfidences)
        .sort(([, a], [, b]) => b - a)[0][0] as CRType;
      context.type = primaryType;
    }

    // 进入 enrich 阶段
    context.stage = "enriching";
    context.updatedAt = new Date().toISOString();

    // 创建 enrich 任务
    const taskResult = this.taskQueue.enqueue({
      nodeId: context.nodeId,
      taskType: "enrich",
      state: "Pending",
      attempt: 0,
      maxAttempts: 3,
      providerRef: this.getProviderIdForTask("enrich"),
      payload: {
        pipelineId: context.pipelineId,
        standardizedData: context.standardizedData,
        conceptType: context.type
      }
    });

    if (taskResult.ok) {
      this.taskToPipeline.set(taskResult.value, context.pipelineId);
    }

    this.publishEvent({
      type: "stage_changed",
      pipelineId: context.pipelineId,
      stage: "enriching",
      context,
      timestamp: context.updatedAt
    });
  }

  /**
   * 处理丰富完成
   */
  private async handleEnrichCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as PipelineContext["enrichedData"];
    if (!result) {
      context.stage = "failed";
      context.error = { code: "E304", message: "丰富结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
      return;
    }

    context.enrichedData = result;

    // 进入 embedding 阶段
    context.stage = "embedding";
    context.updatedAt = new Date().toISOString();

    // 构建嵌入文本
    const embeddingText = this.buildEmbeddingText(context);

    // 创建 embedding 任务
    const taskResult = this.taskQueue.enqueue({
      nodeId: context.nodeId,
      taskType: "embedding",
      state: "Pending",
      attempt: 0,
      maxAttempts: 3,
      providerRef: this.getProviderIdForTask("embedding"),
      payload: {
        pipelineId: context.pipelineId,
        text: embeddingText,
        standardizedData: context.standardizedData,
        namingTemplate: this.getSettings().namingTemplate
      }
    });

    if (taskResult.ok) {
      this.taskToPipeline.set(taskResult.value, context.pipelineId);
    }

    this.publishEvent({
      type: "stage_changed",
      pipelineId: context.pipelineId,
      stage: "embedding",
      context,
      timestamp: context.updatedAt
    });
  }

  /**
   * 处理嵌入完成
   */
  private async handleEmbeddingCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    if (result?.embedding) {
      context.embedding = result.embedding as number[];
    } else {
      context.stage = "failed";
      context.error = { code: "E304", message: "嵌入结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 进入等待创建确认阶段（自动确认，无需 UI）
    context.stage = "awaiting_create_confirm";
    context.updatedAt = new Date().toISOString();

    this.logger.info("PipelineOrchestrator", `自动确认创建并生成内容: ${context.pipelineId}`);
    const confirmResult = await this.confirmCreate(context.pipelineId);
    if (!confirmResult.ok) {
      context.stage = "failed";
      context.error = { code: confirmResult.error.code, message: confirmResult.error.message };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 处理 reason:new 完成
   * 
   * 遵循 A-FUNC-05：reason:new 完成后可选执行 ground 阶段
   * 修改：reason:new 任务无需用户确认，直接写入
   */
  private async handleReasonNewCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    if (result?.content) {
      context.generatedContent = result.content as unknown as Record<string, unknown>;
    } else if (result) {
      // 如果没有 content 字段，整个 result 就是内容
      context.generatedContent = result;
    }
    if (result?.snapshotId) {
      context.snapshotId = result.snapshotId as string;
    }

    // 生成文件路径（如果 Stub 阶段未生成）
    if (!context.filePath && context.standardizedData) {
      const fileName = this.sanitizeFileName(context.standardizedData.standardNames[context.type].chinese);
      context.filePath = `${fileName}.md`;
    }

    // 检查是否启用 Ground 阶段
    const settings = this.getSettings();
    if (settings.enableGrounding) {
      // 启用 Ground：创建 ground 任务（Ground 完成后需要用户确认）
      await this.startGroundTask(context);
    } else {
      // 未启用 Ground：直接写入，无需用户确认
      await this.autoConfirmWrite(context);
    }
  }

  /**
   * 启动 Ground 任务
   * 
   * 遵循 A-FUNC-05：可选 ground 阶段，在 reason:new 与写入之间
   */
  private async startGroundTask(context: PipelineContext): Promise<void> {
    context.stage = "reasoning"; // 复用 reasoning 阶段表示 ground 进行中
    context.updatedAt = new Date().toISOString();

    this.logger.info("PipelineOrchestrator", `启动 Ground 任务: ${context.pipelineId}`);

    // 将生成的内容转换为字符串用于验证
    const contentToVerify = typeof context.generatedContent === "string"
      ? context.generatedContent
      : JSON.stringify(context.generatedContent, null, 2);

    const taskResult = this.taskQueue.enqueue({
      nodeId: context.nodeId,
      taskType: "ground",
      state: "Pending",
      attempt: 0,
      maxAttempts: 3,
      providerRef: this.getProviderIdForTask("ground"),
      payload: {
        pipelineId: context.pipelineId,
        currentContent: contentToVerify,
        conceptType: context.type,
        standardizedData: context.standardizedData
      }
    });

    if (taskResult.ok) {
      this.taskToPipeline.set(taskResult.value, context.pipelineId);
    } else {
      // Ground 任务创建失败，跳过 Ground 直接进入写入确认
      this.logger.warn("PipelineOrchestrator", `Ground 任务创建失败，跳过: ${context.pipelineId}`);
      this.transitionToAwaitingWriteConfirm(context);
    }
  }

  /**
   * 转换到等待写入确认阶段
   */
  private transitionToAwaitingWriteConfirm(context: PipelineContext): void {
    context.stage = "awaiting_write_confirm";
    context.updatedAt = new Date().toISOString();

    // 发布确认请求事件
    this.publishEvent({
      type: "confirmation_required",
      pipelineId: context.pipelineId,
      stage: "awaiting_write_confirm",
      context,
      timestamp: context.updatedAt
    });

    this.logger.info("PipelineOrchestrator", `等待用户确认写入: ${context.pipelineId}`);
  }

  /**
   * 自动确认写入（无需用户确认）
   * 用于 reason:new 和 enrich 任务完成后的自动写入
   */
  private async autoConfirmWrite(context: PipelineContext): Promise<void> {
    this.logger.info("PipelineOrchestrator", `自动写入（无需确认）: ${context.pipelineId}`);

    // 直接进入写入确认阶段，避免 UI 交互
    context.stage = "awaiting_write_confirm";
    context.updatedAt = new Date().toISOString();

    // 直接调用 confirmWrite 逻辑
    const writeResult = await this.confirmWrite(context.pipelineId);

    if (!writeResult.ok) {
      context.stage = "failed";
      context.error = { code: writeResult.error.code, message: writeResult.error.message };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 处理任务失败
   */
  private handleTaskFailed(taskId: string): void {
    const pipelineId = this.taskToPipeline.get(taskId);
    if (!pipelineId) return;

    const context = this.pipelines.get(pipelineId);
    if (!context) return;

    const task = this.taskQueue.getTask(taskId);

    context.stage = "failed";
    context.error = {
      code: task?.errors?.[0]?.code || "E304",
      message: task?.errors?.[0]?.message || "任务执行失败"
    };
    context.updatedAt = new Date().toISOString();

    this.publishEvent({
      type: "pipeline_failed",
      pipelineId,
      stage: "failed",
      context,
      timestamp: context.updatedAt
    });

    this.logger.error("PipelineOrchestrator", `管线失败: ${pipelineId}`, undefined, {
      taskId,
      error: context.error
    });
  }

  /**
   * 构建嵌入文本
   * 
   * 遵循设计文档 A-FUNC-04：概念签名 = 名称 + 核心定义 + 类型
   */
  private buildEmbeddingText(context: PipelineContext): string {
    const parts: string[] = [];

    if (context.standardizedData) {
      const currentName = context.standardizedData.standardNames[context.type];
      parts.push(currentName.chinese);
      parts.push(currentName.english);
      if (context.standardizedData.coreDefinition) {
        parts.push(context.standardizedData.coreDefinition);
      }
    }

    parts.push(`类型: ${context.type}`);

    if (context.enrichedData?.tags) {
      parts.push(`标签: ${context.enrichedData.tags.join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * 清理文件名
   */
  private sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "-");
  }

  /**
   * Vault 原子写入
   */
  private async atomicWriteVault(path: string, content: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const temp = `${path}.tmp`;
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) {
      const exists = await adapter.exists(dir);
      if (!exists) {
        await adapter.mkdir(dir);
      }
    }
    await adapter.write(temp, content);
    const verify = await adapter.read(temp);
    if (verify !== content) {
      await adapter.remove(temp);
      throw new Error("写入校验失败");
    }
    if (await adapter.exists(path)) {
      await adapter.remove(path);
    }
    await adapter.rename(temp, path);
  }

  /**
   * 确保 Vault 目录存在
   */
  private async ensureVaultDir(targetPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const parts = targetPath.split("/").slice(0, -1);
    if (parts.length === 0) return;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const exists = await adapter.exists(current);
      if (!exists) {
        await adapter.mkdir(current);
      }
    }
  }

  /**
   * 将生成的结构化内容渲染为 Markdown
   * 根据用户语言设置使用中文或英文标题
   * 注意：文件名已包含中英文，无需在内容中重复
   */
  private renderContentToMarkdown(context: PipelineContext, standardName: string): string {
    const lines: string[] = [];
    const settings = this.getSettings();
    const language = settings.language || "zh";
    
    // 根据语言设置选择标题（文件名已包含中英文，无需重复）
    if (language === "zh") {
      // 中文环境：使用中文标题
      lines.push(`# ${standardName}`);
    } else {
      // 英文环境：使用英文标题
      const english = context.standardizedData?.standardNames[context.type].english;
      lines.push(`# ${english || standardName}`);
    }
    lines.push("");

    let content: unknown = context.generatedContent;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        // 保留原始字符串
      }
    }

    if (content && typeof content === "object") {
      const descriptors: FieldDescription[] = schemaRegistry.getFieldDescriptions(context.type);
      for (const desc of descriptors) {
        const value = (content as Record<string, unknown>)[desc.name];
        if (value === undefined) continue;
        lines.push(`## ${desc.name}`);
        lines.push(this.renderValue(value));
        lines.push("");
      }
    } else if (typeof content === "string") {
      lines.push(content);
    }

    return lines.join("\n");
  }

  private renderValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map(v => `- ${this.renderValue(v)}`).join("\n");
    }
    if (typeof value === "object" && value !== null) {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `- **${k}**: ${this.renderValue(v)}`)
        .join("\n");
    }
    return String(value);
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string): CRFrontmatter | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) {
      return null;
    }

    const frontmatterText = match[1];
    const lines = frontmatterText.split("\n");
    const frontmatter: Partial<CRFrontmatter> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      switch (key) {
        case "uid":
          frontmatter.uid = value;
          break;
        case "type":
          frontmatter.type = value as CRType;
          break;
        case "status":
          frontmatter.status = value as NoteState;
          break;
        case "created":
          frontmatter.created = value;
          break;
        case "updated":
          frontmatter.updated = value;
          break;
        case "aliases":
          // 简化：不解析 aliases 列表，保持原值
          break;
      }
    }

    return frontmatter.uid && frontmatter.type && frontmatter.status
      ? (frontmatter as CRFrontmatter)
      : null;
  }

  private buildFrontmatterString(frontmatter: CRFrontmatter): string {
    const lines = [
      "---",
      `uid: ${frontmatter.uid}`,
      `type: ${frontmatter.type}`,
      `status: ${frontmatter.status}`,
      `created: ${frontmatter.created}`,
      `updated: ${frontmatter.updated}`,
    ];

    if (frontmatter.aliases && frontmatter.aliases.length > 0) {
      lines.push("aliases:");
      frontmatter.aliases.forEach(alias => lines.push(`  - ${alias}`));
    }

    if (frontmatter.tags && frontmatter.tags.length > 0) {
      lines.push("tags:");
      frontmatter.tags.forEach(tag => lines.push(`  - ${tag}`));
    }

    lines.push("---");
    return lines.join("\n");
  }

  private buildMergeBody(
    mergedName: { chinese?: string; english?: string },
    content: Record<string, unknown>,
    type: CRType,
    mergeResult: Record<string, unknown>
  ): string {
    const sections: string[] = [];
    const settings = this.getSettings();
    const language = settings.language || "zh";
    const cn = mergedName.chinese || "合并后的概念";
    const en = mergedName.english || "";

    // 根据语言设置选择标题（文件名已包含中英文，无需重复）
    if (language === "zh") {
      // 中文环境：使用中文标题
      sections.push(`# ${cn}`);
    } else {
      // 英文环境：使用英文标题
      sections.push(`# ${en || cn}`);
    }
    sections.push("");

    const rationale = mergeResult.merge_rationale as string;
    if (rationale) {
      sections.push("## 合并说明");
      sections.push(rationale);
      sections.push("");
    }

    if (content.core_definition) {
      sections.push("## 核心定义");
      sections.push(String(content.core_definition));
      sections.push("");
    }

    sections.push(this.buildTypeSpecificContent(content, type));

    const preservedA = mergeResult.preserved_from_a as string[] | undefined;
    const preservedB = mergeResult.preserved_from_b as string[] | undefined;
    if ((preservedA && preservedA.length > 0) || (preservedB && preservedB.length > 0)) {
      sections.push("## 整合的见解");
      if (preservedA && preservedA.length > 0) {
        sections.push("### 来自概念 A");
        preservedA.forEach(insight => sections.push(`- ${insight}`));
      }
      if (preservedB && preservedB.length > 0) {
        sections.push("### 来自概念 B");
        preservedB.forEach(insight => sections.push(`- ${insight}`));
      }
      sections.push("");
    }

    return sections.join("\n");
  }

  private buildTypeSpecificContent(content: Record<string, unknown>, type: CRType): string {
    const sections: string[] = [];
    switch (type) {
      case "Theory":
        if (content.axioms) {
          sections.push("## 公理");
          (content.axioms as string[]).forEach(a => sections.push(`- ${a}`));
          sections.push("");
        }
        break;
      case "Issue":
        if (content.core_tension) {
          sections.push("## 核心张力");
          sections.push(String(content.core_tension));
          sections.push("");
        }
        break;
      case "Mechanism":
        if (content.causal_chain) {
          sections.push("## 因果链");
          (content.causal_chain as string[]).forEach(c => sections.push(`- ${c}`));
          sections.push("");
        }
        break;
      case "Entity":
        if (content.definition) {
          sections.push("## 定义");
          sections.push(String(content.definition));
          sections.push("");
        }
        break;
      case "Domain":
        if (content.boundaries) {
          sections.push("## 边界");
          (content.boundaries as string[]).forEach(b => sections.push(`- ${b}`));
          sections.push("");
        }
        break;
    }
    return sections.join("\n");
  }

  private buildMergedContent(
    mergeResult: Record<string, unknown>,
    previousContent: string,
    type: CRType
  ): Result<string> {
    const frontmatter = this.parseFrontmatter(previousContent);
    if (!frontmatter) {
      return err("E304", "无法解析原始笔记的 frontmatter");
    }

    const mergedName = (mergeResult.merged_name as { chinese?: string; english?: string }) || {};
    const content = mergeResult.content as Record<string, unknown> | undefined;
    if (!content) {
      return err("E304", "合并结果缺少内容信息");
    }

    const updatedFrontmatter: CRFrontmatter = {
      ...frontmatter,
      updated: new Date().toISOString()
    };

    const fmStr = this.buildFrontmatterString(updatedFrontmatter);
    const body = this.buildMergeBody(mergedName, content, type, mergeResult);

    return ok(`${fmStr}\n\n${body}`);
  }


  /**
   * 组装写入内容（供预览与实际写入复用）
   */
  private async composeWriteContent(context: PipelineContext): Promise<Result<{
    targetPath: string;
    previousContent: string;
    newContent: string;
  }>> {
    if (context.kind === "create") {
      if (!context.standardizedData || !context.generatedContent) {
        return err("E304", "缺少生成内容或标准化数据");
      }

      const settings = this.getSettings();
      const signature = createConceptSignature(
        {
          standardName: context.standardizedData.standardNames[context.type],
          aliases: context.enrichedData?.aliases || [],
          coreDefinition: context.standardizedData.coreDefinition
        },
        context.type,
        settings.namingTemplate
      );

      const targetPath = context.filePath || generateFilePath(
        signature.standardName,
        settings.directoryScheme,
        context.type
      );

      await this.ensureVaultDir(targetPath);

      const adapter = this.app.vault.adapter;
      const previousContent = (await adapter.exists(targetPath))
        ? await adapter.read(targetPath)
        : "";

      const markdownBody = this.renderContentToMarkdown(
        context,
        signature.standardName
      );

      const frontmatter = generateFrontmatter({
        uid: context.nodeId,
        type: context.type,
        status: "Draft",
        aliases: context.enrichedData?.aliases,
        tags: context.enrichedData?.tags
      });

      const fullContent = generateMarkdownContent(frontmatter, markdownBody);

      return ok({
        targetPath,
        previousContent,
        newContent: fullContent
      });
    }

    if (context.kind === "incremental" || context.kind === "merge") {
      if (!context.filePath) {
        return err("E304", "缺少文件路径");
      }
      if (context.previousContent === undefined || context.newContent === undefined) {
        return err("E304", "缺少预览内容");
      }

      await this.ensureVaultDir(context.filePath);

      return ok({
        targetPath: context.filePath,
        previousContent: context.previousContent,
        newContent: context.newContent
      });
    }

    return err("E304", "未知的管线类型");
  }

  /**
   * 获取任务的 Provider ID
   * 
   * 遵循设计文档 A-FUNC-03：任务执行前必须找到匹配的 Provider
   * 
   * @param taskType 任务类型
   * @returns Provider ID
   */
  private getProviderIdForTask(taskType: TaskType): string {
    const settings = this.getSettings();
    
    // 从 taskModels 配置中获取 Provider ID
    const taskModel = settings.taskModels[taskType];
    if (taskModel && taskModel.providerId) {
      return taskModel.providerId;
    }
    
    // 如果任务模型未配置 Provider，使用默认 Provider
    if (settings.defaultProviderId) {
      return settings.defaultProviderId;
    }
    
    // 如果没有默认 Provider，返回空字符串（会在 TaskRunner 中报错）
    this.logger.warn("PipelineOrchestrator", `任务 ${taskType} 未配置 Provider，且没有默认 Provider`);
    return "";
  }

  /**
   * 生成管线 ID
   */
  private generatePipelineId(): string {
    return `pipeline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 生成节点 ID (UUID v4)
   */
  private generateNodeId(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 发布事件
   */
  private publishEvent(event: PipelineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error("PipelineOrchestrator", "事件监听器执行失败", error as Error);
      }
    }
  }
}
