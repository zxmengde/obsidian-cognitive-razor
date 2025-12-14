
import {
  ILogger,
  TaskRecord,
  TaskType,
  CRType,
  CRFrontmatter,
  NoteState,
  DuplicatePair,
  PluginSettings,
  PipelineContext,
  PipelineStage,
  StandardizedConcept,
  Result,
  ok,
  err,
  toErr
} from "../types";
import { App, TFile } from "obsidian";
import YAML from "yaml";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { createConceptSignature, generateFilePath } from "./naming-utils";
import { FieldDescription, schemaRegistry } from "./schema-registry";
import { mapStandardizeOutput } from "./standardize-mapper";
import { generateUUID } from "../data/validators";
import { formatCRTimestamp } from "../utils/date-utils";
import type { CruidCache } from "./cruid-cache";
import type { TaskQueue } from "./task-queue";
import type { TaskRunner } from "./task-runner";
import type { DuplicateManager } from "./duplicate-manager";
import type { FileStorage } from "../data/file-storage";
import type { VectorIndex } from "./vector-index";
import type { UndoManager } from "./undo-manager";
import type { PromptManager } from "./prompt-manager";
import type { ProviderManager } from "./provider-manager";

/**
 * 管线事件类型
 */
type PipelineEventType =
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
type PipelineEventListener = (event: PipelineEvent) => void;

/**
 * 管线编排器依赖
 */
interface PipelineOrchestratorDependencies {
  app: App;
  taskQueue: TaskQueue;
  taskRunner: TaskRunner;
  duplicateManager: DuplicateManager;
  logger: ILogger;
  fileStorage: FileStorage;
  vectorIndex: VectorIndex;
  undoManager: UndoManager;
  promptManager?: PromptManager;
  providerManager?: ProviderManager;
  cruidCache?: CruidCache;
  getSettings: () => PluginSettings;
}

/** 创建管线预设选项（用于 Deepen） */
interface CreatePresetOptions {
  parents?: string[];
  parentUid?: string;
  parentType?: CRType;
  targetPathOverride?: string;
  sources?: string;
}

export class PipelineOrchestrator {
  private app: App;
  private taskQueue: TaskQueue;
  private taskRunner: TaskRunner;
  private duplicateManager: DuplicateManager;
  private logger: ILogger;
  private fileStorage: FileStorage;
  private vectorIndex: VectorIndex;
  private undoManager: UndoManager;
  private promptManager?: PromptManager;
  private providerManager?: ProviderManager;
  private cruidCache?: CruidCache;
  private getSettings: () => PluginSettings;
  
  private pipelines: Map<string, PipelineContext>;
  private listeners: PipelineEventListener[];
  private taskToPipeline: Map<string, string>; // taskId -> pipelineId
  private unsubscribeQueue?: () => void;

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
    this.cruidCache = deps.cruidCache;
    this.getSettings = deps.getSettings;
    
    this.pipelines = new Map();
    this.listeners = [];
    this.taskToPipeline = new Map();

    // 订阅任务队列事件
    this.subscribeToTaskQueue();

    this.logger.debug("PipelineOrchestrator", "管线编排器初始化完成");
  }

  /**
   * 检查是否存在同类型同名的笔记
   * 
   * 遵循 G-02 语义唯一性公理：防止创建重复概念
   * 
   * @param standardizedData 标准化数据
   * @param type 知识类型
   * @returns 检查结果
   */
  private checkDuplicateByName(
    standardizedData: StandardizedConcept,
    type: CRType,
    targetPathOverride?: string
  ): Result<void> {
    const settings = this.getSettings();
    const normalizedOverride = targetPathOverride && targetPathOverride.trim().length > 0
      ? (targetPathOverride.endsWith(".md") ? targetPathOverride : `${targetPathOverride}.md`)
      : undefined;
    const signature = createConceptSignature(
      {
        standardName: standardizedData.standardNames[type],
        aliases: [],
        coreDefinition: standardizedData.coreDefinition
      },
      type,
      settings.namingTemplate
    );

    // 生成目标文件路径（Deepen 允许传入预设路径，以保证与父笔记链接一致）
    const targetPath = normalizedOverride
      ? normalizedOverride
      : generateFilePath(
        signature.standardName,
        settings.directoryScheme,
        type
      );

    // 检查文件是否已存在
    const file = this.app.vault.getAbstractFileByPath(targetPath);
    if (file) {
      this.logger.warn("PipelineOrchestrator", "检测到同类型同名笔记", {
        type,
        name: signature.standardName,
        path: targetPath,
        event: "DUPLICATE_NAME_DETECTED"
      });

      return err(
        "E400",
        `已存在同类型同名的笔记：${signature.standardName}\n路径：${targetPath}\n\n请修改概念名称或检查是否为重复创建。`,
        {
          type,
          name: signature.standardName,
          path: targetPath
        }
      );
    }

    return ok(undefined);
  }

  /**
   * 前置校验：检查 Provider 和模板是否可用
   * 遵循 A-FUNC-03：任务执行前必须找到匹配的 Provider 与 PDD 模板
   * 
   * @param taskType 任务类型
   * @param conceptType 知识类型（可选，用于 write 任务）
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
   * 修改：define 不进入队列，使用 standardizeDirect 直接执行
   * 此方法已废弃，保留以兼容旧代码
   */
  startCreatePipeline(userInput: string, type?: CRType): Result<string> {
    this.logger.warn("PipelineOrchestrator", "startCreatePipeline 已废弃，请使用 standardizeDirect + startCreatePipelineWithStandardized");
    
    // 返回错误，强制使用新流程
    return err("E306", "请使用 standardizeDirect 方法进行标准化，然后使用 startCreatePipelineWithStandardized 创建管线");
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
      const prerequisiteCheck = this.validatePrerequisites("define");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<StandardizedConcept>;
      }

      // 基础输入校验与清理，防止超长或恶意指令
      const suspicious = [/ignore\s+previous\s+instructions/i, /system\s*:/i, /\[INST\]/i, /<\|im_start\|>/i];
      if (typeof userInput !== "string" || userInput.trim().length === 0) {
        return err("E001", "输入不能为空");
      }
      if (userInput.length > 10000) {
        return err("E001", "输入过长，请缩短后重试（最大 10000 字符）");
      }
      for (const pattern of suspicious) {
        if (pattern.test(userInput)) {
          return err("E001", "输入包含可疑指令，请检查后重试");
        }
      }
      const sanitizedInput = userInput.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();

      if (!this.providerManager) {
        return err("E306", "ProviderManager 未初始化");
      }

      if (!this.promptManager) {
        return err("E306", "PromptManager 未初始化");
      }

      this.logger.info("PipelineOrchestrator", "开始直接标准化", {
        userInput: userInput.substring(0, 50),
        event: "STANDARDIZE_DIRECT_START"
      });

      // 获取 Provider 配置
      const settings = this.getSettings();
      const taskConfig = settings.taskModels["define"];
      const providerId = taskConfig.providerId;

      // 构建 prompt
      let prompt: string;
      try {
        prompt = this.promptManager.build("define", { CTX_INPUT: sanitizedInput });
      } catch (error) {
        this.logger.error("PipelineOrchestrator", "构建标准化提示词失败", error as Error, {
          event: "STANDARDIZE_DIRECT_ERROR"
        });
        return toErr(error, "E002", "构建标准化提示词失败");
      }

      // 直接调用 API
      const chatResult = await this.providerManager.chat({
        providerId,
        model: taskConfig.model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: sanitizedInput }
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
      return err("E305", "直接标准化失败", error);
    }
  }

  /**
   * 使用已标准化数据启动创建管线（跳过标准化阶段）
   * 
   * 遵循 Requirements 4.3：
   * - 跳过标准化阶段，直接从 tag 开始
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
    return this.startCreatePipelineWithPreset(standardizedData, selectedType);
  }

  /**
   * 使用预设名称/路径/父级信息启动创建管线（Deepen）
   * 
   * 复用 Create 管线，但允许外部指定目标路径与父子关系，确保与父笔记中的 [[链接]] 保持一致。
   */
  startCreatePipelineWithPreset(
    standardizedData: StandardizedConcept,
    selectedType: CRType,
    options?: CreatePresetOptions
  ): Result<string> {
    try {
      // 前置校验 tag 任务
      const prerequisiteCheck = this.validatePrerequisites("tag");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<string>;
      }

      // 在 tag 之前检查重复名称/路径，避免浪费 API 调用
      const duplicateCheck = this.checkDuplicateByName(
        standardizedData,
        selectedType,
        options?.targetPathOverride
      );
      if (!duplicateCheck.ok) {
        this.logger.warn("PipelineOrchestrator", "重复名称检查失败，管线未启动", {
          type: selectedType,
          error: duplicateCheck.error,
          targetPathOverride: options?.targetPathOverride
        });
        return duplicateCheck as Result<string>;
      }

      const pipelineId = this.generatePipelineId();
      const nodeId = this.generateNodeId();
      const now = formatCRTimestamp();

      // 创建管线上下文，直接设置标准化数据
      const context: PipelineContext = {
        kind: "create",
        pipelineId,
        nodeId,
        type: selectedType,
        stage: "tagging", // 直接进入 tagging 阶段
        userInput: standardizedData.standardNames[selectedType].chinese,
        standardizedData: {
          standardNames: standardizedData.standardNames,
          typeConfidences: standardizedData.typeConfidences,
          primaryType: selectedType,
          coreDefinition: standardizedData.coreDefinition
        },
        parents: options?.parents,
        parentUid: options?.parentUid,
        parentType: options?.parentType,
        targetPathOverride: options?.targetPathOverride,
        sources: options?.sources,
        filePath: options?.targetPathOverride,
        createdAt: now,
        updatedAt: now
      };

      this.pipelines.set(pipelineId, context);

      this.logger.info("PipelineOrchestrator", `启动创建管线（预设）: ${pipelineId}`, {
        nodeId,
        selectedType,
        chinese: standardizedData.standardNames[selectedType].chinese,
        targetPathOverride: options?.targetPathOverride,
        parents: options?.parents
      });

      // 创建 tag 任务
      const settings = this.getSettings();
      let taskId: string;
      try {
        taskId = this.taskQueue.enqueue({
          nodeId,
          taskType: "tag",
          state: "Pending",
          attempt: 0,
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("tag"),
          payload: {
            pipelineId,
            standardizedData: context.standardizedData,
            conceptType: selectedType,
            userInput: context.userInput
          }
        });
      } catch (error) {
        this.pipelines.delete(pipelineId);
        return toErr(error, "E305", "创建任务失败") as Result<string>;
      }

      // 记录任务到管线的映射
      this.taskToPipeline.set(taskId, pipelineId);

      // 发布事件
      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "tagging",
        context,
        timestamp: now
      });

      return ok(pipelineId);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "启动管线失败", error as Error);
      return err("E305", "启动管线失败", error);
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

    // 创建流程不保存快照（仅增量改进和合并时保存）

    await this.atomicWriteVault(targetPath, newContent);

    this.logger.info("PipelineOrchestrator", `文件已写入 (Stub → Draft): ${targetPath}`, {
      pipelineId: context.pipelineId,
      fileSize: newContent.length,
      hasSnapshot: !!context.snapshotId,
      statusTransition: "Stub → Draft"
    });

     if (context.embedding) {
       await this.vectorIndex.upsert({
         uid: context.nodeId,
         type: context.type,
         embedding: context.embedding,
         updated: formatCRTimestamp()
       });
     }

    context.stage = "checking_duplicates";
    context.updatedAt = formatCRTimestamp();
    if (context.embedding) {
      await this.duplicateManager.detect(
        context.nodeId,
        context.type,
        context.embedding
      );
    }

    context.stage = "completed";
    context.updatedAt = formatCRTimestamp();
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

    // 增量改进：保存快照
    const snapshotResult = await this.undoManager.createSnapshot(
      targetPath,
      previousContent,
      context.pipelineId,
      context.nodeId
    );
    if (snapshotResult.ok) {
      context.snapshotId = snapshotResult.value;
    }

    await this.atomicWriteVault(targetPath, newContent);

     // 更新向量索引并去重（复用已有向量）
     const entry = this.vectorIndex.getEntry(context.nodeId);
     if (entry) {
       const updatedEntry = { ...entry, updated: formatCRTimestamp() };
       await this.vectorIndex.upsert(updatedEntry);
       await this.duplicateManager.detect(context.nodeId, entry.type, entry.embedding);
     }

    context.stage = "completed";
    context.updatedAt = formatCRTimestamp();
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

    // 注意：快照已在 executeMergePipeline 中创建，此处不再重复创建
    // 如果快照尚未创建（兼容旧流程），则创建快照
    if (!context.snapshotId) {
      const snapshotResult = await this.undoManager.createSnapshot(
        targetPath,
        previousContent,
        context.pipelineId,
        context.nodeId
      );
      if (snapshotResult.ok) {
        context.snapshotId = snapshotResult.value;
      }

      // 为被删除笔记创建快照
      if (context.deleteFilePath && context.deleteContent) {
        await this.undoManager.createSnapshot(
          context.deleteFilePath,
          context.deleteContent,
          `merge-delete-${context.mergePairId ?? context.pipelineId}`,
          context.deleteNodeId
        );
      }
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
       const updatedEntry = { ...entry, updated: formatCRTimestamp() };
       await this.vectorIndex.upsert(updatedEntry);
       await this.duplicateManager.detect(context.nodeId, entry.type, entry.embedding);
     }

    // 去重记录清理
    if (context.mergePairId) {
      await this.duplicateManager.completeMerge(context.mergePairId, context.nodeId);
    }

    context.stage = "completed";
    context.updatedAt = formatCRTimestamp();
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
      context.error = { code: "E306", message: "增量改进结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
      return;
    }

    context.newContent = improved as string;
    context.generatedContent = result;
    context.updatedAt = formatCRTimestamp();

    const settings = this.getSettings();
    if (settings.enableGrounding) {
      context.stage = "verifying";
      let verifyTaskId: string;
      try {
        verifyTaskId = this.taskQueue.enqueue({
          nodeId: context.nodeId,
          taskType: "verify",
          state: "Pending",
          attempt: 0,
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("verify"),
          payload: {
            pipelineId: context.pipelineId,
            currentContent: improved,
            conceptType: context.type
          }
        });
      } catch (error) {
        const converted = toErr(error, "E305", "Verify 任务创建失败");
        context.stage = "failed";
        context.error = { code: converted.error.code, message: converted.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      this.taskToPipeline.set(verifyTaskId, context.pipelineId);
      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "verifying",
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
      context.error = { code: "E306", message: "合并结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
      return;
    }

    const mergedContent = this.buildMergedContent(
      mergeResult,
      context.previousContent || "",
      context.type,
      context.deleteNoteName || ""
    );

    if (!mergedContent.ok) {
      context.stage = "failed";
      context.error = { code: mergedContent.error.code, message: mergedContent.error.message };
      return;
    }

    context.newContent = mergedContent.value;
    context.generatedContent = mergeResult;
    context.updatedAt = formatCRTimestamp();

    const settings = this.getSettings();
    if (settings.enableGrounding) {
      context.stage = "verifying";
      let verifyTaskId: string;
      try {
        verifyTaskId = this.taskQueue.enqueue({
          nodeId: context.nodeId,
          taskType: "verify",
          state: "Pending",
          attempt: 0,
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("verify"),
          payload: {
            pipelineId: context.pipelineId,
            currentContent: mergedContent.value,
            conceptType: context.type
          }
        });
      } catch (error) {
        const converted = toErr(error, "E305", "Verify 任务创建失败");
        context.stage = "failed";
        context.error = { code: converted.error.code, message: converted.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      this.taskToPipeline.set(verifyTaskId, context.pipelineId);
      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "verifying",
        context,
        timestamp: context.updatedAt
      });
    } else {
      this.transitionToAwaitingWriteConfirm(context);
    }
  }

  /**
   * 启动合并管线
   * 
   * 遵循 SSOT 6.3：Merge 流程
   * - 用户从重复对列表进入 merge，对 A/B 选择主笔记
   * - 创建快照：A、B 各一份
   * - 生成合并候选（正文 + frontmatter）
   * - 进入确认阶段：DiffView 确认后落盘
   * 
   * @param pair 重复对
   * @param keepNodeId 保留的笔记 nodeId
   * @param finalFileName 合并后的文件名（不含扩展名）
   * @returns 管线 ID
   */
  startMergePipeline(
    pair: DuplicatePair,
    keepNodeId: string,
    finalFileName: string
  ): Result<string> {
    // 确定主笔记和被删除笔记
    const isKeepA = keepNodeId === pair.nodeIdA;
    const keepId = isKeepA ? pair.nodeIdA : pair.nodeIdB;
    const deleteId = isKeepA ? pair.nodeIdB : pair.nodeIdA;

    const nameA = this.cruidCache?.getName(pair.nodeIdA) || pair.nodeIdA;
    const nameB = this.cruidCache?.getName(pair.nodeIdB) || pair.nodeIdB;

    const keepPath = this.cruidCache?.getPath(keepId);
    const deletePath = this.cruidCache?.getPath(deleteId);
    if (!keepPath || !deletePath) {
      return err("E306", "无法定位合并笔记文件（可能已被移动或删除）", {
        keepNodeId: keepId,
        deleteNodeId: deleteId,
        keepPath: keepPath || null,
        deletePath: deletePath || null
      });
    }

    const keepNote = { nodeId: keepId, name: this.cruidCache?.getName(keepId) || keepId, path: keepPath };
    const deleteNote = { nodeId: deleteId, name: this.cruidCache?.getName(deleteId) || deleteId, path: deletePath };

    // 前置校验
    const prereqResult = this.validatePrerequisites("write", pair.type);
    if (!prereqResult.ok) {
      return prereqResult as Result<string>;
    }

    const pipelineId = generateUUID();
    const now = formatCRTimestamp();

    const context: PipelineContext = {
      kind: "merge",
      pipelineId,
      nodeId: keepNote.nodeId,
      type: pair.type,
      stage: "idle",
      userInput: `合并 ${nameA} 和 ${nameB}`,
      mergePairId: pair.id,
      deleteFilePath: deleteNote.path,
      deleteNoteName: deleteNote.name,
      deleteNodeId: deleteNote.nodeId,
      createdAt: now,
      updatedAt: now
    };

    this.pipelines.set(pipelineId, context);

    this.logger.info("PipelineOrchestrator", `启动合并管线: ${pipelineId}`, {
      keepNodeId,
      deleteNodeId: deleteNote.nodeId,
      pairId: pair.id,
      finalFileName
    });

    // 异步执行合并流程
    void this.executeMergePipeline(context, pair, keepNote, deleteNote, finalFileName);

    return ok(pipelineId);
  }

  /**
   * 执行合并管线
   */
  private async executeMergePipeline(
    context: PipelineContext,
    pair: DuplicatePair,
    keepNote: { nodeId: string; name: string; path: string },
    deleteNote: { nodeId: string; name: string; path: string },
    finalFileName: string
  ): Promise<void> {
    try {
      // 1. 读取两篇笔记内容
      const keepFile = this.app.vault.getAbstractFileByPath(keepNote.path);
      const deleteFile = this.app.vault.getAbstractFileByPath(deleteNote.path);

      if (!keepFile || !(keepFile instanceof TFile)) {
        context.stage = "failed";
        context.error = { code: "E306", message: `主笔记不存在: ${keepNote.path}` };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      if (!deleteFile || !(deleteFile instanceof TFile)) {
        context.stage = "failed";
        context.error = { code: "E306", message: `被合并笔记不存在: ${deleteNote.path}` };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      const keepContent = await this.app.vault.read(keepFile);
      const deleteContent = await this.app.vault.read(deleteFile);

      context.previousContent = keepContent;
      context.deleteContent = deleteContent;
      context.filePath = keepNote.path;

      // 2. 创建双快照（SSOT 要求）
      context.stage = "saving";
      context.updatedAt = formatCRTimestamp();

      const keepSnapshotResult = await this.undoManager.createSnapshot(
        keepNote.path,
        keepContent,
        context.pipelineId,
        keepNote.nodeId
      );
      if (keepSnapshotResult.ok) {
        context.snapshotId = keepSnapshotResult.value;
      }

      await this.undoManager.createSnapshot(
        deleteNote.path,
        deleteContent,
        `merge-delete-${context.pipelineId}`,
        deleteNote.nodeId
      );

      this.logger.info("PipelineOrchestrator", "合并快照已创建", {
        pipelineId: context.pipelineId,
        keepSnapshotId: context.snapshotId
      });

      // 3. 调用 LLM 生成合并内容
      context.stage = "saving";
      context.updatedAt = formatCRTimestamp();

      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "writing",
        context,
        timestamp: context.updatedAt
      });

      // 构建 merge prompt 并调用 LLM
      const mergeResult = await this.generateMergeContent(
        context,
        keepNote.name,
        deleteNote.name,
        keepContent,
        deleteContent,
        pair.type,
        finalFileName
      );

      if (!mergeResult.ok) {
        context.stage = "failed";
        context.error = { code: mergeResult.error.code, message: mergeResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      context.generatedContent = mergeResult.value;
      context.newContent = mergeResult.value.finalContent;

      // 4. 进入等待确认阶段
      context.stage = "review_changes";
      context.updatedAt = formatCRTimestamp();

      this.publishEvent({
        type: "confirmation_required",
        pipelineId: context.pipelineId,
        stage: "review_changes",
        context,
        timestamp: context.updatedAt
      });

    } catch (error) {
      this.logger.error("PipelineOrchestrator", "合并管线执行失败", error as Error, {
        pipelineId: context.pipelineId
      });
      context.stage = "failed";
      context.error = { code: "E305", message: String(error) };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
    }
  }

  /**
   * 生成合并内容
   * 
   * 遵循 SSOT 5.4.4：使用 PromptManager.buildOperation 构建 merge prompt
   */
  private async generateMergeContent(
    context: PipelineContext,
    keepNoteName: string,
    deleteNoteName: string,
    keepContent: string,
    deleteContent: string,
    type: CRType,
    finalFileName: string
  ): Promise<Result<{ mergeResult: Record<string, unknown>; finalContent: string }>> {
    if (!this.promptManager || !this.providerManager) {
      return err("E306", "PromptManager 或 ProviderManager 未初始化");
    }

    const settings = this.getSettings();
    const language = settings.language === "en" ? "English" : "Chinese";

    // 构建 merge prompt（遵循 SSOT 5.4.4 槽位契约）
    const slots: Record<string, string> = {
      SOURCE_A_NAME: keepNoteName,
      CTX_SOURCE_A: keepContent,
      SOURCE_B_NAME: deleteNoteName,
      CTX_SOURCE_B: deleteContent,
      USER_INSTRUCTION: `合并这两个 ${type} 类型的概念笔记，最终文件名为 "${finalFileName}"`,
      CONCEPT_TYPE: type,
      CTX_LANGUAGE: language
    };

    // 使用 buildOperation 构建 merge prompt
    let promptContent: string;
    try {
      promptContent = this.promptManager.buildOperation("merge", slots);
    } catch (error) {
      // 如果 merge 模板不可用或构建失败，使用简化的合并 prompt
      this.logger.warn("PipelineOrchestrator", "merge 模板不可用，使用简化 prompt", {
        pipelineId: context.pipelineId,
        error
      });

      promptContent = this.buildSimpleMergePrompt(
        keepNoteName,
        deleteNoteName,
        keepContent,
        deleteContent,
        type,
        language
      );
    }

    // 获取任务模型配置
    const taskConfig = settings.taskModels?.["write"];
    const providerId = taskConfig?.providerId || settings.defaultProviderId || "default";
    const model = taskConfig?.model || "gpt-4o";

    // 调用 LLM
    const chatResult = await this.providerManager.chat({
      providerId,
      model,
      messages: [{ role: "user", content: promptContent }],
      temperature: taskConfig?.temperature ?? 0.7,
      maxTokens: taskConfig?.maxTokens
    });

    if (!chatResult.ok) {
      return chatResult as Result<{ mergeResult: Record<string, unknown>; finalContent: string }>;
    }

    // 解析 LLM 输出
    let mergeResult: Record<string, unknown>;
    try {
      // 尝试提取 JSON（处理可能的 markdown code fence）
      let jsonStr = chatResult.value.content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      mergeResult = JSON.parse(jsonStr);
    } catch (parseError) {
      this.logger.error("PipelineOrchestrator", "解析合并结果失败", parseError as Error, {
        pipelineId: context.pipelineId,
        rawContent: chatResult.value.content.substring(0, 500)
      });
      return err("E306", "解析合并结果失败，LLM 输出格式不正确");
    }

    // 构建最终内容
    const buildResult = this.buildMergedContent(
      mergeResult,
      context.previousContent || "",
      type,
      deleteNoteName
    );

    if (!buildResult.ok) {
      return buildResult as Result<{ mergeResult: Record<string, unknown>; finalContent: string }>;
    }

    return ok({
      mergeResult,
      finalContent: buildResult.value
    });
  }

  /**
   * 构建简化的合并 prompt
   */
  private buildSimpleMergePrompt(
    keepNoteName: string,
    deleteNoteName: string,
    keepContent: string,
    deleteContent: string,
    type: CRType,
    language: string
  ): string {
    return `你是一个知识合并专家。请将以下两个 ${type} 类型的概念笔记合并为一个统一的知识节点。

**源笔记 A（主笔记）：${keepNoteName}**
\`\`\`
${keepContent}
\`\`\`

**源笔记 B（被合并笔记）：${deleteNoteName}**
\`\`\`
${deleteContent}
\`\`\`

**要求**：
1. 保留两个笔记中的所有关键信息
2. 消除重复和冗余
3. 使用 ${language} 作为主要语言
4. 将被合并笔记的名称添加到 aliases 中

**输出格式**：纯 JSON，不使用 markdown 代码块
{
  "merged_name": { "chinese": "...", "english": "..." },
  "merge_rationale": "合并理由说明",
  "content": { ... 按照 ${type} 类型的结构组织内容 ... },
  "preserved_from_a": ["从笔记A保留的信息点"],
  "preserved_from_b": ["从笔记B保留的信息点"]
}`;
  }

  /**
   * 启动增量改进管线
   * 
   * 遵循 SSOT 6.4：Incremental Edit 流程
   * - 用户从 Workbench 选择目标笔记与改写指令
   * - 创建快照（目标笔记）
   * - 生成候选改写（正文 + frontmatter）
   * - 进入确认阶段：DiffView 确认后落盘
   * 
   * @param filePath 目标笔记路径
   * @param instruction 改写指令
   * @returns 管线 ID
   */
  startIncrementalPipeline(
    filePath: string,
    instruction: string
  ): Result<string> {
    // 前置校验
    const prereqResult = this.validatePrerequisites("write");
    if (!prereqResult.ok) {
      return prereqResult as Result<string>;
    }

    // 获取文件
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      return err("E306", `文件不存在: ${filePath}`);
    }

    const pipelineId = generateUUID();
    const now = formatCRTimestamp();

    // 从文件路径提取 nodeId（如果有 frontmatter 中的 cruid）
    const nodeId = generateUUID(); // 临时 ID，后续从 frontmatter 读取

    const context: PipelineContext = {
      kind: "incremental",
      pipelineId,
      nodeId,
      type: "Entity", // 临时类型，后续从 frontmatter 读取
      stage: "idle",
      userInput: instruction,
      filePath,
      createdAt: now,
      updatedAt: now
    };

    this.pipelines.set(pipelineId, context);

    this.logger.info("PipelineOrchestrator", `启动增量改进管线: ${pipelineId}`, {
      filePath,
      instruction: instruction.substring(0, 100)
    });

    // 异步执行增量改进流程
    void this.executeIncrementalPipeline(context, file, instruction);

    return ok(pipelineId);
  }

  /**
   * 执行增量改进管线
   */
  private async executeIncrementalPipeline(
    context: PipelineContext,
    file: TFile,
    instruction: string
  ): Promise<void> {
    try {
      // 1. 读取笔记内容
      const content = await this.app.vault.read(file);
      context.previousContent = content;

      // 2. 解析 frontmatter 获取 nodeId 和 type
      const frontmatter = this.parseSimpleFrontmatter(content);
      const extractedUid = (frontmatter.cruid ?? frontmatter.crUid) as string | undefined;
      if (extractedUid) {
        context.nodeId = extractedUid;
      }
      if (frontmatter.type) {
        context.type = frontmatter.type as CRType;
      }

      // 3. 创建快照（SSOT 要求）
      const snapshotResult = await this.undoManager.createSnapshot(
        context.filePath!,
        content,
        context.pipelineId,
        context.nodeId
      );
      if (snapshotResult.ok) {
        context.snapshotId = snapshotResult.value;
      }

      this.logger.info("PipelineOrchestrator", "增量改进快照已创建", {
        pipelineId: context.pipelineId,
        snapshotId: context.snapshotId
      });

      // 4. 调用 LLM 生成改进内容
      context.stage = "writing";
      context.updatedAt = formatCRTimestamp();

      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "writing",
        context,
        timestamp: context.updatedAt
      });

      const improveResult = await this.generateIncrementalContent(
        context,
        content,
        instruction
      );

      if (!improveResult.ok) {
        context.stage = "failed";
        context.error = { code: improveResult.error.code, message: improveResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      context.generatedContent = improveResult.value;
      context.newContent = improveResult.value.finalContent;

      // 5. 进入等待确认阶段
      context.stage = "review_changes";
      context.updatedAt = formatCRTimestamp();

      this.publishEvent({
        type: "confirmation_required",
        pipelineId: context.pipelineId,
        stage: "review_changes",
        context,
        timestamp: context.updatedAt
      });

    } catch (error) {
      this.logger.error("PipelineOrchestrator", "增量改进管线执行失败", error as Error, {
        pipelineId: context.pipelineId
      });
      context.stage = "failed";
      context.error = { code: "E305", message: String(error) };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
    }
  }

  /**
   * 生成增量改进内容
   */
  private async generateIncrementalContent(
    context: PipelineContext,
    currentContent: string,
    instruction: string
  ): Promise<Result<{ improveResult: Record<string, unknown>; finalContent: string }>> {
    if (!this.providerManager) {
      return err("E306", "ProviderManager 未初始化");
    }

    const settings = this.getSettings();
    const language = settings.language === "en" ? "English" : "Chinese";

    // 构建增量改进 prompt（优先使用操作模板，失败则回退到简化 prompt）
    let promptContent = this.buildIncrementalPrompt(
      currentContent,
      instruction,
      context.type,
      language
    );

    if (this.promptManager) {
      const slots: Record<string, string> = {
        CTX_CURRENT: currentContent,
        USER_INSTRUCTION: instruction,
        CONCEPT_TYPE: context.type,
        CTX_LANGUAGE: language
      };

      try {
        promptContent = this.promptManager.buildOperation("incremental", slots);
      } catch (error) {
        this.logger.warn("PipelineOrchestrator", "incremental 模板不可用，使用简化 prompt", {
          pipelineId: context.pipelineId,
          error
        });
      }
    }

    // 获取任务模型配置
    const taskConfig = settings.taskModels?.["write"];
    const providerId = taskConfig?.providerId || settings.defaultProviderId || "default";
    const model = taskConfig?.model || "gpt-4o";

    // 调用 LLM
    const chatResult = await this.providerManager.chat({
      providerId,
      model,
      messages: [{ role: "user", content: promptContent }],
      temperature: taskConfig?.temperature ?? 0.7,
      maxTokens: taskConfig?.maxTokens
    });

    if (!chatResult.ok) {
      return chatResult as Result<{ improveResult: Record<string, unknown>; finalContent: string }>;
    }

    // 解析 LLM 输出
    let improveResult: Record<string, unknown>;
    try {
      let jsonStr = chatResult.value.content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      improveResult = JSON.parse(jsonStr);
    } catch (parseError) {
      // 如果无法解析为 JSON，直接使用原始内容作为改进后的内容
      this.logger.warn("PipelineOrchestrator", "无法解析增量改进结果为 JSON，使用原始输出", {
        pipelineId: context.pipelineId
      });
      
      // 尝试提取 markdown 内容
      const content = chatResult.value.content.trim();
      return ok({
        improveResult: { improved_content: content },
        finalContent: content
      });
    }

    // 构建最终内容
    const finalContent = (improveResult.improved_content as string) || 
                         (improveResult.newContent as string) ||
                         chatResult.value.content;

    return ok({
      improveResult,
      finalContent
    });
  }

  /**
   * 构建增量改进 prompt
   */
  private buildIncrementalPrompt(
    currentContent: string,
    instruction: string,
    type: CRType,
    language: string
  ): string {
    return `你是一个知识改进专家。请根据用户指令改进以下 ${type} 类型的概念笔记。

**当前笔记内容**：
\`\`\`
${currentContent}
\`\`\`

**用户指令**：${instruction}

**要求**：
1. 保留原笔记中所有有效内容
2. 根据用户指令进行针对性改进
3. 使用 ${language} 作为主要语言
4. 保持原有的 frontmatter 格式和字段
5. 改进后的内容必须是原内容的超集

**输出格式**：纯 JSON，不使用 markdown 代码块
{
  "improved_content": "完整的改进后笔记内容（包含 frontmatter）",
  "changes_summary": "改进内容摘要",
  "preserved_sections": ["保留的章节列表"],
  "enhanced_sections": ["增强的章节列表"]
}`;
  }

  /**
   * 简单解析 frontmatter（用于增量改进）
   */
  private parseSimpleFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return {};
    }

    const frontmatterStr = match[1];
    const result: Record<string, unknown> = {};

    // 简单解析 YAML
    const lines = frontmatterStr.split("\n");
    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        let value: unknown = line.substring(colonIndex + 1).trim();
        
        // 处理引号
        if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * 确认创建（在 embedding 之后）
   * 
   * 遵循 A-FUNC-05：确认创建后先生成 Stub，再执行 write
   * 遵循 A-UCD-03：写入需显式确认
   * 遵循设计文档：Stub 状态仅含 frontmatter，后续 write 完成后转为 Draft
   */
  async confirmCreate(pipelineId: string): Promise<Result<void>> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E307", `管线不存在: ${pipelineId}`);
    }

    if (context.stage !== "review_draft") {
      return err("E306", `管线状态不正确: ${context.stage}，期望: review_draft`);
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

      // 2. 更新阶段为 writing
      context.stage = "writing";
      context.updatedAt = formatCRTimestamp();

      // 3. 创建 write 任务
      const settings = this.getSettings();
      let taskId: string;
      try {
        taskId = this.taskQueue.enqueue({
          nodeId: context.nodeId,
          taskType: "write",
          state: "Pending",
          attempt: 0,
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("write"),
          payload: {
            pipelineId,
            standardizedData: context.standardizedData,
            conceptType: context.type,
            coreDefinition: context.standardizedData?.coreDefinition,
            enrichedData: context.enrichedData,
            embedding: context.embedding,
            filePath: context.filePath,
            skipSnapshot: true,
            userInput: context.userInput,
            sources: context.sources
          }
        });
      } catch (error) {
        context.stage = "failed";
        const converted = toErr(error, "E305", "创建任务失败");
        context.error = { code: converted.error.code, message: converted.error.message };
        return converted as Result<void>;
      }

      this.taskToPipeline.set(taskId, pipelineId);

      // 发布事件
      this.publishEvent({
        type: "stage_changed",
        pipelineId,
        stage: "writing",
        context,
        timestamp: context.updatedAt
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "确认创建失败", error as Error);
      return err("E305", "确认创建失败", error);
    }
  }

  /**
   * 解析创建目标路径与名称（支持 Deepen 预设路径）
   */
  private resolveCreateTarget(
    context: PipelineContext,
    signatureStandardName: string
  ): { targetPath: string; targetName: string } {
    const settings = this.getSettings();
    const hasOverride = !!context.targetPathOverride && context.targetPathOverride.trim().length > 0;

    const targetPath = hasOverride
      ? (context.targetPathOverride!.endsWith(".md")
        ? context.targetPathOverride!
        : `${context.targetPathOverride!}.md`)
      : (context.filePath || generateFilePath(
        signatureStandardName,
        settings.directoryScheme,
        context.type
      ));

    const targetName = hasOverride
      ? (targetPath.split("/").pop() || signatureStandardName).replace(/\.md$/i, "") || signatureStandardName
      : signatureStandardName;

    return { targetPath, targetName };
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
        return err("E306", "缺少标准化数据，无法创建 Stub");
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

      // 生成目标路径（Deepen 支持传入覆盖路径）
      const { targetPath, targetName } = this.resolveCreateTarget(context, signature.standardName);
      context.filePath = targetPath;

      // 确保目录存在
      await this.ensureVaultDir(targetPath);

      // 创建流程不保存快照（仅增量改进和合并时保存）

      // 生成仅含 frontmatter 的 Stub 内容
      const frontmatter = generateFrontmatter({
        cruid: context.nodeId,
        type: context.type,
        name: targetName,
        parents: context.parents ?? [],
        status: "Stub", // Stub 状态
        aliases: context.enrichedData?.aliases,
        tags: context.enrichedData?.tags,
        parentUid: context.parentUid,
        parentType: context.parentType
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
      return err("E300", "创建 Stub 文件失败", error);
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
      return err("E307", `管线不存在: ${pipelineId}`);
    }

    if (!context.standardizedData) {
      return err("E306", "标准化结果尚未生成，无法更新");
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
    context.updatedAt = formatCRTimestamp();

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
   * 确认写入（在 write 之后）
   * 
   * 遵循 A-FUNC-05：确认写入后执行去重检测，Stub → Draft 状态转换
   * 遵循 A-UCD-03：写入需显式确认，确认后提供撤销
   * 遵循 A-NF-02：使用原子写入确保数据完整性
   * 遵循 Requirements 2.7-2.8：创建快照并使用原子写入
   */
  async confirmWrite(pipelineId: string): Promise<Result<void>> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E307", `管线不存在: ${pipelineId}`);
    }

    if (context.stage !== "review_changes") {
      return err("E306", `管线状态不正确: ${context.stage}，期望: review_changes`);
    }

    try {
      context.stage = "writing";
      context.updatedAt = formatCRTimestamp();

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

      return err("E306", "未知的管线类型");
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "确认写入失败", error as Error);
      context.stage = "failed";
      context.error = { code: "E305", message: String(error) };
      return err("E305", "确认写入失败", error);
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
      return err("E307", `管线不存在: ${pipelineId}`);
    }

    if (!["review_changes", "saving", "checking_duplicates"].includes(context.stage)) {
      return err("E306", `当前阶段不支持预览: ${context.stage}`);
    }

    return this.composeWriteContent(context);
  }

  /**
   * 取消管线
   */
  cancelPipeline(pipelineId: string): Result<void> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E307", `管线不存在: ${pipelineId}`);
    }

    // 取消所有关联的任务
    for (const [taskId, pid] of this.taskToPipeline.entries()) {
      if (pid === pipelineId) {
        try {
          this.taskQueue.cancel(taskId);
        } catch (error) {
          this.logger.warn("PipelineOrchestrator", `取消任务失败: ${taskId}`, {
            pipelineId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        this.taskToPipeline.delete(taskId);
      }
    }

    // 更新状态
    context.stage = "failed";
    context.error = { code: "E306", message: "用户取消" };
    context.updatedAt = formatCRTimestamp();

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
    this.unsubscribeQueue?.();
    this.unsubscribeQueue = this.taskQueue.subscribe((event) => {
      if (event.type === "task-completed" && event.taskId) {
        this.handleTaskCompleted(event.taskId);
      } else if (event.type === "task-failed" && event.taskId) {
        this.handleTaskFailed(event.taskId);
      }
    });
  }

  /**
   * 释放订阅（用于插件卸载）
   */
  public dispose(): void {
    if (this.unsubscribeQueue) {
      this.unsubscribeQueue();
      this.unsubscribeQueue = undefined;
    }
  }

  /**
   * 处理任务完成
   */
  private async handleTaskCompleted(taskId: string): Promise<void> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) return;

    const pipelineId =
      this.taskToPipeline.get(taskId) ||
      (typeof (task.payload as Record<string, unknown>)?.pipelineId === "string"
        ? ((task.payload as Record<string, unknown>).pipelineId as string)
        : undefined);
    if (!pipelineId) return;

    if (!this.taskToPipeline.has(taskId)) {
      this.taskToPipeline.set(taskId, pipelineId);
    }

    const context = this.pipelines.get(pipelineId);
    if (!context) return;

    this.logger.debug("PipelineOrchestrator", `任务完成: ${taskId}`, {
      pipelineId,
      taskType: task.taskType
    });

    // 根据任务类型更新管线状态并触发下一步
    switch (task.taskType) {
      case "define":
        await this.handleStandardizeCompleted(context, task);
        break;
      case "tag":
        await this.handleTagCompleted(context, task);
        break;
      case "index":
        await this.handleIndexCompleted(context, task);
        break;
      case "write":
        await this.handleWriteCompleted(context, task);
        break;
      case "verify":
        await this.handleVerifyCompleted(context, task);
        break;
    }
  }

  /**
   * 处理 Verify 任务完成
   * 
   * Verify 完成后进入等待写入确认阶段（需要用户确认）
   * 如果 Verify 发现严重问题，记录到上下文中供用户参考
   */
  private async handleVerifyCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    
    if (result) {
      context.groundingResult = result;
      // 记录 Verify 结果到上下文（供 UI 展示）
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

      this.logger.info("PipelineOrchestrator", `Verify 完成: ${context.pipelineId}`, {
        overall_assessment: result.overall_assessment,
        issueCount: Array.isArray(result.issues) ? result.issues.length : 0
      });
    }

    // Verify 完成后进入等待写入确认阶段（需要用户确认）
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
      context.error = { code: "E306", message: "标准化结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
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
      result.primaryType = primaryType;
    }

    // 进入 tag 阶段
    context.stage = "tagging";
    context.updatedAt = formatCRTimestamp();

    // 创建 tag 任务
    const settings = this.getSettings();
    let tagTaskId: string;
    try {
      tagTaskId = this.taskQueue.enqueue({
        nodeId: context.nodeId,
        taskType: "tag",
        state: "Pending",
        attempt: 0,
        maxAttempts: settings.maxRetryAttempts,
        providerRef: this.getProviderIdForTask("tag"),
        payload: {
          pipelineId: context.pipelineId,
          standardizedData: context.standardizedData,
          conceptType: context.type,
          userInput: context.userInput
        }
      });
    } catch (error) {
      const converted = toErr(error, "E305", "创建 tag 任务失败");
      context.stage = "failed";
      context.error = { code: converted.error.code, message: converted.error.message };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    this.taskToPipeline.set(tagTaskId, context.pipelineId);

    this.publishEvent({
      type: "stage_changed",
      pipelineId: context.pipelineId,
      stage: "tagging",
      context,
      timestamp: context.updatedAt
    });
  }

  /**
   * 处理丰富完成
   * 
   * tag 完成后直接进入等待创建确认阶段
   * index 将在 write 完成后执行
   */
  private async handleTagCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as PipelineContext["enrichedData"];
    if (!result) {
      context.stage = "failed";
      context.error = { code: "E306", message: "丰富结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
      return;
    }

    context.enrichedData = result;

    // 注意：重复名称检查已移至 startCreatePipelineWithStandardized 中
    // 在 tag 之前进行检查，避免浪费 API 调用

    // 进入等待创建确认阶段（自动确认）
    context.stage = "review_draft";
    context.updatedAt = formatCRTimestamp();

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
        timestamp: formatCRTimestamp()
      });
    }
  }

  /**
   * 处理嵌入完成
   * 
   * 注意：此方法已废弃，embedding 现在直接执行不进入队列
   * 保留此方法以防万一有遗留的 embedding 任务
   */
  private async handleIndexCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    this.logger.warn("PipelineOrchestrator", "收到 embedding 任务完成事件（不应该发生）", {
      pipelineId: context.pipelineId,
      taskId: task.id
    });

    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    if (result?.embedding) {
      context.embedding = result.embedding as number[];
    } else {
      context.stage = "failed";
      context.error = { code: "E306", message: "嵌入结果缺失" };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
      return;
    }

    // 进入等待创建确认阶段（自动确认，无需 UI）
    context.stage = "review_draft";
    context.updatedAt = formatCRTimestamp();

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
        timestamp: formatCRTimestamp()
      });
    }
  }

  /**
   * 处理 write 完成
   * 
   * write 完成后执行 index，然后可选执行 verify 阶段或直接写入
   */
  private async handleWriteCompleted(
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

    // write 完成后，执行 index
    context.stage = "indexing";
    context.updatedAt = formatCRTimestamp();

    this.publishEvent({
      type: "stage_changed",
      pipelineId: context.pipelineId,
      stage: "indexing",
      context,
      timestamp: context.updatedAt
    });

    // 直接执行 embedding（不进入队列）
    await this.executeEmbeddingDirect(context);
  }

  /**
   * 启动 Verify 任务
   * 
   * 遵循 A-FUNC-05：可选 verify 阶段，在 write 与写入之间
   */
  private async startVerifyTask(context: PipelineContext): Promise<void> {
    context.stage = "verifying"; // Verify 执行中
    context.updatedAt = formatCRTimestamp();

    this.logger.info("PipelineOrchestrator", `启动 Verify 任务: ${context.pipelineId}`);

    // 将生成的内容转换为字符串用于验证
    const contentToVerify = typeof context.generatedContent === "string"
      ? context.generatedContent
      : JSON.stringify(context.generatedContent, null, 2);

    const settings = this.getSettings();
    try {
      const taskId = this.taskQueue.enqueue({
        nodeId: context.nodeId,
        taskType: "verify",
        state: "Pending",
        attempt: 0,
        maxAttempts: settings.maxRetryAttempts,
        providerRef: this.getProviderIdForTask("verify"),
        payload: {
          pipelineId: context.pipelineId,
          currentContent: contentToVerify,
          conceptType: context.type,
          standardizedData: context.standardizedData
        }
      });
      this.taskToPipeline.set(taskId, context.pipelineId);
    } catch (error) {
      const converted = toErr(error, "E305", "Verify 任务创建失败");
      this.logger.warn("PipelineOrchestrator", `Verify 任务创建失败，跳过: ${context.pipelineId}`, {
        error: converted.error
      });
      this.transitionToAwaitingWriteConfirm(context);
    }
  }

  /**
   * 转换到等待写入确认阶段
   */
  private transitionToAwaitingWriteConfirm(context: PipelineContext): void {
    context.stage = "review_changes";
    context.updatedAt = formatCRTimestamp();

    // 发布确认请求事件
    this.publishEvent({
      type: "confirmation_required",
      pipelineId: context.pipelineId,
      stage: "review_changes",
      context,
      timestamp: context.updatedAt
    });

    this.logger.info("PipelineOrchestrator", `等待用户确认写入: ${context.pipelineId}`);
  }

  /**
   * 自动确认写入（无需用户确认）
   * 用于 write 和 tag 任务完成后的自动写入
   */
  private async autoConfirmWrite(context: PipelineContext): Promise<void> {
    this.logger.info("PipelineOrchestrator", `自动写入（无需确认）: ${context.pipelineId}`);

    // 直接进入写入确认阶段，避免 UI 交互
    context.stage = "review_changes";
    context.updatedAt = formatCRTimestamp();

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
        timestamp: formatCRTimestamp()
      });
    }
  }

  /**
   * 处理任务失败
   */
  private handleTaskFailed(taskId: string): void {
    const task = this.taskQueue.getTask(taskId);
    const pipelineId =
      this.taskToPipeline.get(taskId) ||
      (typeof (task?.payload as Record<string, unknown>)?.pipelineId === "string"
        ? ((task!.payload as Record<string, unknown>).pipelineId as string)
        : undefined);
    if (!pipelineId) return;

    if (!this.taskToPipeline.has(taskId)) {
      this.taskToPipeline.set(taskId, pipelineId);
    }

    const context = this.pipelines.get(pipelineId);
    if (!context) return;

    context.stage = "failed";
    context.error = {
      code: task?.errors?.[0]?.code || "E305",
      message: task?.errors?.[0]?.message || "任务执行失败"
    };
    context.updatedAt = formatCRTimestamp();

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
   * 
   * 静默更新策略（State Preservation）：
   * - 对于已存在的文件，使用 vault.modify 进行原地更新，避免触发文件删除事件
   * - 这确保用户当前打开的标签页不会因为文件被删除而跳转到其他文件
   * - 对于新文件，使用临时文件 + rename 的原子写入方式
   */
  private async atomicWriteVault(path: string, content: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    
    // 检查文件是否已存在
    const existingFile = this.app.vault.getAbstractFileByPath(path);
    
    if (existingFile && existingFile instanceof TFile) {
      // 文件已存在：使用 vault.modify 进行静默更新
      // 这不会触发文件删除事件，保持用户当前的编辑器焦点
      await this.app.vault.modify(existingFile, content);
      this.logger.debug("PipelineOrchestrator", "静默更新已存在文件", { path });
      return;
    }
    
    // 文件不存在：使用临时文件 + rename 的原子写入方式
    const temp = `${path}.tmp`;
    try {
      await this.ensureVaultDir(path);
      await adapter.write(temp, content);
      const verify = await adapter.read(temp);
      if (verify !== content) {
        throw new Error("写入校验失败");
      }
      await adapter.rename(temp, path);
      this.logger.debug("PipelineOrchestrator", "原子写入新文件", { path });
    } catch (error) {
      try {
        if (await adapter.exists(temp)) {
          await adapter.remove(temp);
        }
      } catch (cleanupError) {
        this.logger.warn("PipelineOrchestrator", "清理临时文件失败", {
          temp,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
      throw error;
    }
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
        lines.push(`## ${this.getFieldHeading(desc, language)}`);
        lines.push(this.renderValue(value));
        lines.push("");
      }
    } else if (typeof content === "string") {
      lines.push(content);
    }

    return lines.join("\n");
  }

  private getFieldHeading(desc: FieldDescription, language: string): string {
    if (language === "zh") {
      return desc.description || desc.name;
    }
    return desc.name;
  }

  private renderValue(value: unknown, fieldName?: string): string {
    if (Array.isArray(value)) {
      // 检查是否是对象数组
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        const firstItem = value[0] as Record<string, unknown>;
        
        // 根据字段名和对象结构选择渲染方式
        return this.renderObjectArray(value as Record<string, unknown>[], fieldName);
      }
      
      // 普通数组，每项一行
      return value.map(v => `- ${String(v)}`).join("\n");
    }
    
    if (typeof value === "object" && value !== null) {
      return this.renderObject(value as Record<string, unknown>, fieldName);
    }
    
    return String(value);
  }

  /**
   * 渲染对象数组
   * 
   * 使用 fieldName 参数精确区分不同字段类型，避免仅依赖对象结构导致的误判。
   * 字段名唯一性约束：每种字段类型有独立的渲染逻辑。
   */
  private renderObjectArray(items: Record<string, unknown>[], fieldName?: string): string {
    if (items.length === 0) return "";

    // 优先使用 fieldName 精确匹配，避免结构相似导致的误判
    switch (fieldName) {
      // ========== Domain 类型字段 ==========
      case "sub_domains":
        return this.renderNameDescriptionArray(items, true);
      case "issues":
        // Domain 中的 issues 字段（name + description）
        return this.renderNameDescriptionArray(items, true);

      // ========== Issue 类型字段 ==========
      case "sub_issues":
        return this.renderNameDescriptionArray(items, true);
      case "stakeholder_perspectives":
        return this.renderStakeholderPerspectives(items);
      case "theories":
        return this.renderTheories(items);

      // ========== Theory 类型字段 ==========
      case "axioms":
        return this.renderAxioms(items);
      case "sub_theories":
        return this.renderNameDescriptionArray(items, true);
      case "entities":
        // Theory 中的 entities（name + role + attributes）
        return this.renderTheoryEntities(items);
      case "mechanisms":
        // Theory 中的 mechanisms（name + process + function）
        return this.renderTheoryMechanisms(items);

      // ========== Entity 类型字段 ==========
      case "properties":
        // Entity 中的 properties（name + type + description）
        return this.renderEntityProperties(items);
      case "states":
        // Entity 中的 states（name + description，无链接）
        return this.renderNameDescriptionArray(items, false);

      // ========== Mechanism 类型字段 ==========
      case "operates_on":
        return this.renderOperatesOn(items);
      case "causal_chain":
        return this.renderCausalChain(items);
      case "modulation":
        return this.renderModulation(items);
    }

    // 回退：基于对象结构推断（兼容旧逻辑）
    return this.renderObjectArrayByStructure(items);
  }

  /** 渲染 name + description 数组，withLink 控制是否添加 [[]] 链接 */
  private renderNameDescriptionArray(items: Record<string, unknown>[], withLink: boolean): string {
    return items.map(item => {
      const name = String(item.name || "");
      const description = String(item.description || "");
      return withLink
        ? `- [[${name}]]：${description}`
        : `- **${name}**：${description}`;
    }).join("\n");
  }

  /** 渲染 stakeholder_perspectives（stakeholder + perspective） */
  private renderStakeholderPerspectives(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const stakeholder = String(item.stakeholder || "");
      const perspective = String(item.perspective || "");
      return `- **${stakeholder}**：${perspective}`;
    }).join("\n");
  }

  /** 渲染 theories（name + status + brief） */
  private renderTheories(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const name = String(item.name || "");
      const status = String(item.status || "");
      const brief = String(item.brief || "");
      const statusLabel = this.getTheoryStatusLabel(status);
      return `- [[${name}]] (${statusLabel})：${brief}`;
    }).join("\n");
  }

  /** 渲染 axioms（statement + justification） */
  private renderAxioms(items: Record<string, unknown>[]): string {
    return items.map((item, index) => {
      const statement = String(item.statement || "");
      const justification = String(item.justification || "");
      return `### 公理 ${index + 1}：${statement}\n- **理由**：${justification}`;
    }).join("\n\n");
  }

  /** 渲染 Theory 中的 entities（name + role + attributes） */
  private renderTheoryEntities(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const name = String(item.name || "");
      const role = String(item.role || "");
      const attributes = String(item.attributes || "");
      return `- [[${name}]]\n  - **角色**：${role}\n  - **属性**：${attributes}`;
    }).join("\n");
  }

  /** 渲染 Theory 中的 mechanisms（name + process + function） */
  private renderTheoryMechanisms(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const name = String(item.name || "");
      const process = String(item.process || "");
      const func = String(item.function || "");
      return `- [[${name}]]\n  - **过程**：${process}\n  - **功能**：${func}`;
    }).join("\n");
  }

  /** 渲染 Entity 中的 properties（name + type + description） */
  private renderEntityProperties(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const name = String(item.name || "");
      const type = String(item.type || "");
      const description = String(item.description || "");
      return `- **${name}** (${type})：${description}`;
    }).join("\n");
  }

  /** 渲染 operates_on（entity + role） */
  private renderOperatesOn(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const entity = String(item.entity || "");
      const role = String(item.role || "");
      return `- ${role}：${entity}`;
    }).join("\n");
  }

  /** 渲染 causal_chain（step + description + interaction） */
  private renderCausalChain(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const step = item.step;
      const description = String(item.description || "");
      const interaction = String(item.interaction || "");
      return `### 步骤 ${step}：${interaction}\n- ${description}`;
    }).join("\n\n");
  }

  /** 渲染 modulation（factor + effect + mechanism） */
  private renderModulation(items: Record<string, unknown>[]): string {
    return items.map(item => {
      const factor = String(item.factor || "");
      const effect = String(item.effect || "");
      const mechanism = String(item.mechanism || "");
      const effectLabel = this.getModulationEffectLabel(effect);
      return `- **${factor}** (${effectLabel})：${mechanism}`;
    }).join("\n");
  }

  /** 基于对象结构推断渲染方式（回退逻辑） */
  private renderObjectArrayByStructure(items: Record<string, unknown>[]): string {
    const firstItem = items[0];

    // properties: name + type + description
    if ("name" in firstItem && "type" in firstItem && "description" in firstItem) {
      return this.renderEntityProperties(items);
    }

    // axioms: statement + justification
    if ("statement" in firstItem && "justification" in firstItem) {
      return this.renderAxioms(items);
    }

    // entities (Theory): name + role + attributes
    if ("name" in firstItem && "role" in firstItem && "attributes" in firstItem) {
      return this.renderTheoryEntities(items);
    }

    // mechanisms (Theory): name + process + function
    if ("name" in firstItem && "process" in firstItem && "function" in firstItem) {
      return this.renderTheoryMechanisms(items);
    }

    // theories: name + status + brief
    if ("name" in firstItem && "status" in firstItem && "brief" in firstItem) {
      return this.renderTheories(items);
    }

    // stakeholder_perspectives: stakeholder + perspective
    if ("stakeholder" in firstItem && "perspective" in firstItem) {
      return this.renderStakeholderPerspectives(items);
    }

    // operates_on: entity + role
    if ("entity" in firstItem && "role" in firstItem) {
      return this.renderOperatesOn(items);
    }

    // causal_chain: step + description + interaction
    if ("step" in firstItem && "description" in firstItem && "interaction" in firstItem) {
      return this.renderCausalChain(items);
    }

    // modulation: factor + effect + mechanism
    if ("factor" in firstItem && "effect" in firstItem && "mechanism" in firstItem) {
      return this.renderModulation(items);
    }

    // name + description（通用，带链接）
    if ("name" in firstItem && "description" in firstItem) {
      return this.renderNameDescriptionArray(items, true);
    }

    // 默认：渲染为键值对列表
    return items.map((item, index) => {
      const entries = Object.entries(item)
        .map(([k, v]) => `  - **${k}**：${String(v)}`)
        .join("\n");
      return `- 项目 ${index + 1}\n${entries}`;
    }).join("\n");
  }

  /**
   * 渲染单个对象
   */
  private renderObject(obj: Record<string, unknown>, fieldName?: string): string {
    // composition (in Entity): has_parts + part_of
    // 注意：组成结构字段不添加 [[]] 链接，因为这些是描述性内容而非引用
    if ("has_parts" in obj && "part_of" in obj) {
      const hasParts = obj.has_parts as string[];
      const partOf = String(obj.part_of || "");
      const partsStr = Array.isArray(hasParts) && hasParts.length > 0
        ? hasParts.join("、")
        : "无";
      return `- **组成部分**：${partsStr}\n- **所属系统**：${partOf || "无"}`;
    }

    // classification (in Entity): genus + differentia
    if ("genus" in obj && "differentia" in obj) {
      const genus = String(obj.genus || "");
      const differentia = String(obj.differentia || "");
      return `- **属**：${genus}\n- **种差**：${differentia}`;
    }

    // 默认：渲染为键值对
    return Object.entries(obj)
      .map(([k, v]) => `- **${k}**：${String(v)}`)
      .join("\n");
  }

  /**
   * 获取理论状态的中文标签
   */
  private getTheoryStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      "mainstream": "主流",
      "marginal": "边缘",
      "falsified": "已证伪"
    };
    return labels[status] || status;
  }

  /**
   * 获取调节效果的中文标签
   */
  private getModulationEffectLabel(effect: string): string {
    const labels: Record<string, string> = {
      "promotes": "促进",
      "inhibits": "抑制",
      "regulates": "调节"
    };
    return labels[effect] || effect;
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string): CRFrontmatter | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;

    try {
      const doc = YAML.parse(match[1]) as Record<string, unknown> | null;
      if (!doc || typeof doc !== "object") return null;

      const cruid = typeof doc.cruid === "string"
        ? doc.cruid
        : typeof doc.crUid === "string"
          ? doc.crUid
          : undefined;
      const type = typeof doc.type === "string" ? (doc.type as CRType) : undefined;
      const status = typeof doc.status === "string" ? (doc.status as NoteState) : undefined;
      const created = typeof doc.created === "string" ? doc.created : undefined;
      const updated = typeof doc.updated === "string" ? doc.updated : undefined;
      const name = typeof doc.name === "string" ? doc.name : "";

      if (!cruid || !type || !status || !created || !updated) {
        return null;
      }

      const normalizeArray = (value: unknown): string[] | undefined => {
        if (!Array.isArray(value)) return undefined;
        const arr = value.map((v) => String(v)).filter((s) => s.trim().length > 0);
        return arr.length > 0 ? arr : undefined;
      };

      const parents = normalizeArray(doc.parents) || [];

      return {
        cruid,
        type,
        name,
        status,
        created,
        updated,
        aliases: normalizeArray(doc.aliases),
        tags: normalizeArray(doc.tags),
        parents,
        parentUid: typeof doc.parentUid === "string" ? doc.parentUid : undefined,
        parentType: typeof doc.parentType === "string" ? (doc.parentType as CRType) : undefined,
        sourceUids: normalizeArray(doc.sourceUids),
        version: typeof doc.version === "string" ? doc.version : undefined
      };
    } catch {
      return null;
    }
  }

  private buildFrontmatterString(frontmatter: CRFrontmatter): string {
    const lines = [
      "---",
      `cruid: ${frontmatter.cruid}`,
      `type: ${frontmatter.type}`,
      `name: ${frontmatter.name}`,
      `status: ${frontmatter.status}`,
      `created: ${frontmatter.created}`,
      `updated: ${frontmatter.updated}`,
    ];

    if (frontmatter.aliases && frontmatter.aliases.length > 0) {
      lines.push("aliases:");
      frontmatter.aliases.forEach(alias => lines.push(`  - ${alias}`));
    }

    const parents = Array.isArray(frontmatter.parents) ? frontmatter.parents : [];
    if (parents.length > 0) {
      lines.push("parents:");
      parents.forEach(parent => lines.push(`  - ${parent}`));
    } else {
      lines.push("parents: []");
    }

    if (frontmatter.tags && frontmatter.tags.length > 0) {
      lines.push("tags:");
      frontmatter.tags.forEach(tag => lines.push(`  - ${tag}`));
    }

    if (frontmatter.parentUid) {
      lines.push(`parentUid: ${frontmatter.parentUid}`);
    }

    if (frontmatter.parentType) {
      lines.push(`parentType: ${frontmatter.parentType}`);
    }

    if (frontmatter.sourceUids && frontmatter.sourceUids.length > 0) {
      lines.push("sourceUids:");
      frontmatter.sourceUids.forEach(uid => lines.push(`  - ${uid}`));
    }

    if (frontmatter.version) {
      lines.push(`version: ${frontmatter.version}`);
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
    type: CRType,
    deleteNoteName: string
  ): Result<string> {
    const frontmatter = this.parseFrontmatter(previousContent);
    if (!frontmatter) {
      return err("E306", "无法解析原始笔记的 frontmatter");
    }

    const mergedName = (mergeResult.merged_name as { chinese?: string; english?: string }) || {};
    const content = mergeResult.content as Record<string, unknown> | undefined;
    if (!content) {
      return err("E306", "合并结果缺少内容信息");
    }

    const updatedFrontmatter: CRFrontmatter = {
      ...frontmatter,
      updated: formatCRTimestamp()
    };

    // 合并后：将被合并笔记标题加入 aliases，便于链接重定向
    if (deleteNoteName && deleteNoteName.trim()) {
      const nextAliases = new Set<string>(updatedFrontmatter.aliases ?? []);
      nextAliases.add(deleteNoteName.trim());
      updatedFrontmatter.aliases = Array.from(nextAliases);
    }

    const body = this.buildMergeBody(mergedName, content, type, mergeResult);

    return ok(generateMarkdownContent(updatedFrontmatter, body));
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
        return err("E306", "缺少生成内容或标准化数据");
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

      const { targetPath, targetName } = this.resolveCreateTarget(context, signature.standardName);
      context.filePath = targetPath;

      await this.ensureVaultDir(targetPath);

      const adapter = this.app.vault.adapter;
      const previousContent = (await adapter.exists(targetPath))
        ? await adapter.read(targetPath)
        : "";

      const markdownBody = this.renderContentToMarkdown(
        context,
        targetName
      );

      const frontmatter = generateFrontmatter({
        cruid: context.nodeId,
        type: context.type,
        name: targetName,
        parents: context.parents ?? [],
        status: "Draft",
        aliases: context.enrichedData?.aliases,
        tags: context.enrichedData?.tags,
        parentUid: context.parentUid,
        parentType: context.parentType
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
        return err("E306", "缺少文件路径");
      }
      if (context.previousContent === undefined || context.newContent === undefined) {
        return err("E306", "缺少预览内容");
      }

      await this.ensureVaultDir(context.filePath);

      const normalized = extractFrontmatter(context.newContent);
      if (!normalized) {
        return err("E306", "无法解析生成的 frontmatter");
      }

      const normalizedFrontmatter: CRFrontmatter = {
        ...normalized.frontmatter,
        parents: normalized.frontmatter.parents ?? [],
        updated: formatCRTimestamp()
      };

      const normalizedContent = generateMarkdownContent(normalizedFrontmatter, normalized.body);

      return ok({
        targetPath: context.filePath,
        previousContent: context.previousContent,
        newContent: normalizedContent
      });
    }

    return err("E306", "未知的管线类型");
  }

  /**
   * 获取任务的 Provider ID
   * 
   * 遵循设计文档 A-FUNC-03：任务执行前必须找到匹配的 Provider
   * 
   * 优先级：
   * 1. 任务特定的 providerId（非空字符串）
   * 2. 默认 Provider（非空字符串）
   * 3. 第一个启用的 Provider
   * 
   * @param taskType 任务类型
   * @returns Provider ID
   */
  private getProviderIdForTask(taskType: TaskType): string {
    const settings = this.getSettings();
    
    // 优先使用任务特定的 providerId
    const taskModel = settings.taskModels[taskType];
    if (taskModel?.providerId && taskModel.providerId.trim() !== "") {
      return taskModel.providerId;
    }
    
    // 回退到默认 Provider
    if (settings.defaultProviderId && settings.defaultProviderId.trim() !== "") {
      return settings.defaultProviderId;
    }
    
    // 如果都没有，返回第一个启用的 Provider
    const firstProvider = Object.keys(settings.providers).find(
      id => settings.providers[id].enabled
    );
    
    if (firstProvider) {
      this.logger.warn("PipelineOrchestrator", `任务 ${taskType} 未配置 Provider，使用第一个可用 Provider: ${firstProvider}`);
      return firstProvider;
    }
    
    // 如果没有任何可用 Provider，返回空字符串（会在前置校验中报错）
    this.logger.error("PipelineOrchestrator", `任务 ${taskType} 未配置 Provider，且没有可用的 Provider`);
    return "";
  }

  /**
   * 直接执行 embedding（不进入队列）
   * 
   * 在 write 完成后执行，用于生成向量嵌入
   */
  private async executeEmbeddingDirect(context: PipelineContext): Promise<void> {
    try {
      if (!this.providerManager) {
        throw new Error("ProviderManager 未初始化");
      }

      this.logger.info("PipelineOrchestrator", `直接执行 index: ${context.pipelineId}`);

      // 构建嵌入文本
      const embeddingText = this.buildEmbeddingText(context);

      // 获取 Provider 配置和任务模型配置
      const settings = this.getSettings();
      const taskConfig = settings.taskModels["index"];
      const providerId = taskConfig?.providerId || this.getProviderIdForTask("index");
      const embeddingModel = taskConfig?.model || "text-embedding-3-small";
      const embeddingDimension = settings.embeddingDimension || 1536;

      // 直接调用 embedding API（使用用户配置的模型）
      const embedResult = await this.providerManager.embed({
        providerId,
        model: embeddingModel,
        input: embeddingText,
        dimensions: embeddingDimension
      });

      if (!embedResult.ok) {
        throw new Error(`Embedding 失败: ${embedResult.error.message}`);
      }

      // 保存 embedding 结果
      context.embedding = embedResult.value.embedding;
      context.updatedAt = formatCRTimestamp();

      this.logger.info("PipelineOrchestrator", `Embedding 完成: ${context.pipelineId}`, {
        tokensUsed: embedResult.value.tokensUsed
      });

      // embedding 完成后，检查是否启用 Ground 阶段
      const settings2 = this.getSettings();
      if (settings2.enableGrounding) {
        // 启用 Verify：创建 verify 任务（完成后需要用户确认）
        await this.startVerifyTask(context);
      } else {
        // 未启用 Ground：直接写入，无需用户确认
        await this.autoConfirmWrite(context);
      }
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "直接执行 embedding 失败", error as Error);
      context.stage = "failed";
      context.error = { 
        code: "E305", 
        message: error instanceof Error ? error.message : String(error) 
      };
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: formatCRTimestamp()
      });
    }
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
    return generateUUID();
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
