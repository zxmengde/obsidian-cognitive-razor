
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
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";
import { ContentRenderer } from "./content-renderer";
import { NoteRepository } from "./note-repository";
import { createConceptSignature, generateFilePath, sanitizeFileName } from "./naming-utils";
import { mapStandardizeOutput } from "./standardize-mapper";
import { TaskFactory } from "./task-factory";
import { generateUUID } from "../data/validators";
import { formatCRTimestamp } from "../utils/date-utils";
import type { CruidCache } from "./cruid-cache";
import type { TaskQueue } from "./task-queue";
import type { TaskRunner } from "./task-runner";
import type { DuplicateManager } from "./duplicate-manager";
import type { FileStorage } from "../data/file-storage";
import type { Validator } from "../data/validator";
import type { VectorIndex } from "./vector-index";
import type { UndoManager } from "./undo-manager";
import type { PromptManager } from "./prompt-manager";
import type { ProviderManager } from "./provider-manager";
import type { PipelineStateStore } from "./pipeline-state-store";

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
  validator: Validator;
  vectorIndex: VectorIndex;
  undoManager: UndoManager;
  noteRepository?: NoteRepository;
  contentRenderer?: ContentRenderer;
  promptManager?: PromptManager;
  providerManager?: ProviderManager;
  cruidCache?: CruidCache;
  pipelineStateStore?: PipelineStateStore;
  getSettings: () => PluginSettings;
}

/** 创建管线预设选项（用于 Expand） */
interface CreatePresetOptions {
  parents?: string[];
  targetPathOverride?: string;
  sources?: string;
}

export class PipelineOrchestrator {
  private app: App;
  private noteRepository: NoteRepository;
  private taskQueue: TaskQueue;
  private taskRunner: TaskRunner;
  private duplicateManager: DuplicateManager;
  private logger: ILogger;
  private fileStorage: FileStorage;
  private validator: Validator;
  private vectorIndex: VectorIndex;
  private undoManager: UndoManager;
  private contentRenderer: ContentRenderer;
  private promptManager?: PromptManager;
  private providerManager?: ProviderManager;
  private cruidCache?: CruidCache;
  private pipelineStateStore?: PipelineStateStore;
  private getSettings: () => PluginSettings;
  
  private pipelines: Map<string, PipelineContext>;
  private listeners: PipelineEventListener[];
  private taskToPipeline: Map<string, string>; // taskId -> pipelineId
  private unsubscribeQueue?: () => void;

  constructor(deps: PipelineOrchestratorDependencies) {
    this.app = deps.app;
    this.noteRepository = deps.noteRepository ?? new NoteRepository(deps.app, deps.logger);
    this.taskQueue = deps.taskQueue;
    this.taskRunner = deps.taskRunner;
    this.duplicateManager = deps.duplicateManager;
    this.logger = deps.logger;
    this.fileStorage = deps.fileStorage;
    this.validator = deps.validator;
    this.vectorIndex = deps.vectorIndex;
    this.undoManager = deps.undoManager;
    this.contentRenderer = deps.contentRenderer ?? new ContentRenderer();
    this.promptManager = deps.promptManager;
    this.providerManager = deps.providerManager;
    this.cruidCache = deps.cruidCache;
    this.pipelineStateStore = deps.pipelineStateStore;
    this.getSettings = deps.getSettings;
    
    this.pipelines = new Map();
    this.listeners = [];
    this.taskToPipeline = new Map();

    // 订阅任务队列事件
    this.subscribeToTaskQueue();

    this.logger.debug("PipelineOrchestrator", "管线编排器初始化完成");
  }

  async initialize(): Promise<void> {
    if (!this.pipelineStateStore) {
      return;
    }

    const loadResult = await this.pipelineStateStore.load();
    if (!loadResult.ok) {
      this.logger.warn("PipelineOrchestrator", "加载持久化管线状态失败，跳过恢复", {
        error: loadResult.error,
      });
      return;
    }

    const state = loadResult.value;
    if (!state) {
      return;
    }

    let restoredPipelines = 0;
    for (const ctx of Object.values(state.pipelines)) {
      if (!ctx || typeof ctx !== "object") continue;
      if (!ctx.pipelineId || typeof ctx.pipelineId !== "string") continue;
      if (ctx.stage === "completed" || ctx.stage === "failed") continue;
      this.pipelines.set(ctx.pipelineId, ctx);
      restoredPipelines++;
    }

    let restoredMappings = 0;
    for (const [taskId, pipelineId] of Object.entries(state.taskToPipeline)) {
      if (typeof taskId !== "string" || typeof pipelineId !== "string") continue;
      if (!this.pipelines.has(pipelineId)) continue;
      this.taskToPipeline.set(taskId, pipelineId);
      restoredMappings++;
    }

    if (restoredPipelines > 0 || restoredMappings > 0) {
      this.logger.info("PipelineOrchestrator", "管线状态已从磁盘恢复", {
        pipelines: restoredPipelines,
        mappings: restoredMappings,
      });
      this.schedulePersist();
    }
  }

  private schedulePersist(): void {
    void this.persistActiveState();
  }

  private async persistActiveState(): Promise<void> {
    if (!this.pipelineStateStore) {
      return;
    }

    const activePipelines = Array.from(this.pipelines.values()).filter(
      (ctx) => ctx.stage !== "completed" && ctx.stage !== "failed"
    );

    const pipelines = Object.fromEntries(activePipelines.map((ctx) => [ctx.pipelineId, ctx]));
    const taskToPipeline = Object.fromEntries(
      Array.from(this.taskToPipeline.entries()).filter(([, pipelineId]) =>
        Object.prototype.hasOwnProperty.call(pipelines, pipelineId)
      )
    );

    await this.pipelineStateStore.save({
      version: "1.0.0",
      pipelines,
      taskToPipeline,
    });
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

    // 生成目标文件路径（Expand 允许传入预设路径，以保证与父笔记链接一致）
    const targetPath = normalizedOverride
      ? normalizedOverride
      : generateFilePath(
        signature.standardName,
        settings.directoryScheme,
        type
    );

    // 检查文件是否已存在
    const file = this.noteRepository.getFileByPath(targetPath);
    if (file) {
      this.logger.warn("PipelineOrchestrator", "检测到同类型同名笔记", {
        type,
        name: signature.standardName,
        path: targetPath,
        event: "DUPLICATE_NAME_DETECTED"
      });

      return err(
        "E320_TASK_CONFLICT",
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
      return err("E401_PROVIDER_NOT_CONFIGURED", `任务 ${taskType} 未配置 Provider，请在设置中配置 Provider`);
    }

    // 检查 Provider 是否存在且启用
    const providerConfig = settings.providers[providerId];
    if (!providerConfig) {
      this.logger.error("PipelineOrchestrator", "Provider 不存在", undefined, {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 不存在，请在设置中重新配置`);
    }

    if (!providerConfig.enabled) {
      this.logger.error("PipelineOrchestrator", "Provider 已禁用", undefined, {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 已禁用，请在设置中启用`);
    }

    if (!providerConfig.apiKey) {
      this.logger.error("PipelineOrchestrator", "Provider API Key 未配置", undefined, {
        taskType,
        providerId,
        event: "PREREQUISITE_CHECK_FAILED"
      });
      return err("E401_PROVIDER_NOT_CONFIGURED", `Provider "${providerId}" 的 API Key 未配置`);
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
        return err("E404_TEMPLATE_NOT_FOUND", `模板 "${templateId}" 未加载，请检查 prompts 目录`);
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
   * 直接 Define（不入队）
   * 
   * 遵循 Requirements 4.1, 4.2：
   * - 直接调用 ProviderManager.chat，不进入任务队列
   * - 立即返回结果给 UI 用于用户确认
   * 
   * @param userInput 用户输入的概念
   * @returns Define 结果（包含类型置信度与标准命名）
   */
  async defineDirect(userInput: string): Promise<Result<StandardizedConcept>> {
    try {
      // 前置校验
      const prerequisiteCheck = this.validatePrerequisites("define");
      if (!prerequisiteCheck.ok) {
        return prerequisiteCheck as Result<StandardizedConcept>;
      }

      // 基础输入校验与清理，防止超长或恶意指令
      const suspicious = [/ignore\s+previous\s+instructions/i, /system\s*:/i, /\[INST\]/i, /<\|im_start\|>/i];
      if (typeof userInput !== "string" || userInput.trim().length === 0) {
        return err("E101_INVALID_INPUT", "输入不能为空");
      }
      if (userInput.length > 10000) {
        return err("E101_INVALID_INPUT", "输入过长，请缩短后重试（最大 10000 字符）");
      }
      for (const pattern of suspicious) {
        if (pattern.test(userInput)) {
          return err("E101_INVALID_INPUT", "输入包含可疑指令，请检查后重试");
        }
      }
      const sanitizedInput = userInput.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();

      if (!this.providerManager) {
        return err("E310_INVALID_STATE", "ProviderManager 未初始化");
      }

      if (!this.promptManager) {
        return err("E310_INVALID_STATE", "PromptManager 未初始化");
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
        return toErr(error, "E500_INTERNAL_ERROR", "构建标准化提示词失败");
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
        return err("E210_MODEL_OUTPUT_PARSE_FAILED", "解析标准化结果失败", parseError);
      }
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "直接标准化失败", error as Error);
      return err("E500_INTERNAL_ERROR", "直接标准化失败", error);
    }
  }

  /**
   * 直接标准化（历史兼容：等同于 defineDirect）
   *
   * @deprecated 请改用 defineDirect（与 SSOT 的 Define 语义对齐）
   */
  async standardizeDirect(userInput: string): Promise<Result<StandardizedConcept>> {
    return this.defineDirect(userInput);
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
   * 使用预设名称/路径/父级信息启动创建管线（Expand）
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
        taskId = this.taskQueue.enqueue(TaskFactory.create({
          nodeId,
          taskType: "tag",
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("tag"),
          payload: {
            pipelineId,
            standardizedData: context.standardizedData,
            conceptType: selectedType,
            userInput: context.userInput
          }
        }));
      } catch (error) {
        this.pipelines.delete(pipelineId);
        return toErr(error, "E500_INTERNAL_ERROR", "创建任务失败") as Result<string>;
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
      return err("E500_INTERNAL_ERROR", "启动管线失败", error);
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

    // 创建流程不保存快照（仅修订和合并时保存）

    await this.noteRepository.writeAtomic(targetPath, newContent);

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

    await this.maybeStartAutoVerifyOrComplete(context);
    return ok(undefined);
  }

  private async confirmAmendWrite(context: PipelineContext): Promise<Result<void>> {
    const composed = await this.composeWriteContent(context);
    if (!composed.ok) {
      context.stage = "failed";
      context.error = { code: composed.error.code, message: composed.error.message };
      return composed as Result<void>;
    }

    const { targetPath, previousContent, newContent } = composed.value;
    context.filePath = targetPath;

    // 冲突检测：若 Diff 预览后文件被外部修改，避免覆盖用户改动
    const currentContent = await this.noteRepository.readByPathIfExists(targetPath);
    if (currentContent !== null && currentContent !== previousContent) {
      const message = `检测到文件在确认写入前已被修改：${targetPath}\n请重新生成预览（Diff）后再确认写入，以避免覆盖改动。`;
      context.stage = "failed";
      context.error = { code: "E320_TASK_CONFLICT", message };
      return err(
        "E320_TASK_CONFLICT",
        message,
        { targetPath }
      );
    }

    // 快照应在 Diff 展示前创建；若缺失则补齐（兼容旧流程）
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
    }

    await this.noteRepository.writeAtomic(targetPath, newContent);

    // 语义变更后必须重算 embedding 并触发去重（避免陈旧向量）
    context.stage = "indexing";
    context.updatedAt = formatCRTimestamp();
    await this.refreshEmbeddingAndDuplicates(context, newContent);

    await this.maybeStartAutoVerifyOrComplete(context);
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

    // 冲突检测：若 Diff 预览后主笔记被外部修改，避免覆盖用户改动
    const currentKeep = await this.noteRepository.readByPathIfExists(targetPath);
    if (currentKeep !== null && currentKeep !== previousContent) {
      const message = `检测到主笔记在确认写入前已被修改：${targetPath}\n请重新生成预览（Diff）后再确认写入，以避免覆盖改动。`;
      context.stage = "failed";
      context.error = { code: "E320_TASK_CONFLICT", message };
      return err(
        "E320_TASK_CONFLICT",
        message,
        { targetPath }
      );
    }

    // 冲突检测：若被删笔记在确认写入前被外部修改，避免误删用户改动
    if (context.deleteFilePath && context.deleteContent) {
      const currentDelete = await this.noteRepository.readByPathIfExists(context.deleteFilePath);
      if (currentDelete !== null && currentDelete !== context.deleteContent) {
        const message = `检测到被合并笔记在确认写入前已被修改：${context.deleteFilePath}\n请重新生成预览（Diff）后再确认写入，以避免误删改动。`;
        context.stage = "failed";
        context.error = { code: "E320_TASK_CONFLICT", message };
        return err(
          "E320_TASK_CONFLICT",
          message,
          { deleteFilePath: context.deleteFilePath }
        );
      }
    }

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

    await this.noteRepository.writeAtomic(targetPath, newContent);

    // Merge 会删除被合并笔记：在删除前先将其他笔记的 parents 引用从 B 重写到 A
    const keepTitle = this.getNoteTitleFromPath(targetPath);
    const deleteTitle = context.deleteFilePath
      ? this.getNoteTitleFromPath(context.deleteFilePath)
      : (context.deleteNoteName?.trim() || "");

    if (deleteTitle && keepTitle && deleteTitle !== keepTitle) {
      const updateParentsResult = await this.rewriteParentsAcrossVault({
        pipelineId: context.pipelineId,
        fromTitle: deleteTitle,
        toTitle: keepTitle,
        skipPaths: [targetPath, context.deleteFilePath]
      });
      if (!updateParentsResult.ok) {
        // 回退 duplicate pair 的 merging 状态，避免卡死
        if (context.mergePairId) {
          await this.duplicateManager.abortMerge(context.mergePairId);
        }
        context.stage = "failed";
        context.error = { code: updateParentsResult.error.code, message: updateParentsResult.error.message };
        return updateParentsResult as Result<void>;
      }
    }

    // 删除被合并的笔记
    if (context.deleteFilePath) {
      await this.noteRepository.deleteByPathIfExists(context.deleteFilePath);
    }

    // 向量索引同步
    if (context.deleteNodeId) {
      await this.vectorIndex.delete(context.deleteNodeId);
    }

    // 语义变更后必须重算 embedding 并触发去重（避免陈旧向量）
    context.stage = "indexing";
    context.updatedAt = formatCRTimestamp();
    await this.refreshEmbeddingAndDuplicates(context, newContent);

    // 去重记录清理
    if (context.mergePairId) {
      await this.duplicateManager.completeMerge(context.mergePairId, context.nodeId);
    }

    await this.maybeStartAutoVerifyOrComplete(context);
    return ok(undefined);
  }

  private getNoteTitleFromPath(path: string): string {
    const fileName = path.split("/").pop() || path;
    return fileName.endsWith(".md") ? fileName.slice(0, -".md".length) : fileName;
  }

  private async rewriteParentsAcrossVault(params: {
    pipelineId: string;
    fromTitle: string;
    toTitle: string;
    skipPaths: Array<string | undefined>;
  }): Promise<Result<{ updatedCount: number }>> {
    const fromLink = `[[${params.fromTitle}]]`;
    const toLink = `[[${params.toTitle}]]`;
    const skip = new Set(params.skipPaths.filter((p): p is string => typeof p === "string" && p.length > 0));

    const candidates: Array<{
      file: TFile;
      nodeId: string;
      previousContent: string;
      nextContent: string;
    }> = [];

    const files = this.noteRepository.listMarkdownFiles();
    for (const file of files) {
      if (skip.has(file.path)) {
        continue;
      }

      let content: string;
      try {
        // eslint-disable-next-line no-await-in-loop
        content = await this.noteRepository.read(file);
      } catch (error) {
        this.logger.warn("PipelineOrchestrator", "扫描 parents 引用时读取文件失败", {
          path: file.path,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      const extracted = extractFrontmatter(content);
      if (!extracted) {
        continue;
      }

      const parents = extracted.frontmatter.parents ?? [];
      if (!parents.includes(fromLink)) {
        continue;
      }

      const nextParents: string[] = [];
      const seen = new Set<string>();
      for (const p of parents) {
        const next = p === fromLink ? toLink : p;
        if (!next) {
          continue;
        }
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        nextParents.push(next);
      }

      const unchanged =
        nextParents.length === parents.length &&
        nextParents.every((value, index) => value === parents[index]);
      if (unchanged) {
        continue;
      }

      const nextFrontmatter: CRFrontmatter = {
        ...extracted.frontmatter,
        parents: nextParents,
        updated: formatCRTimestamp()
      };
      const nextContent = generateMarkdownContent(nextFrontmatter, extracted.body);

      candidates.push({
        file,
        nodeId: extracted.frontmatter.cruid,
        previousContent: content,
        nextContent
      });
    }

    if (candidates.length === 0) {
      return ok({ updatedCount: 0 });
    }

    // 先为所有受影响的笔记创建快照，再执行批量写入（尽量降低“无快照变更”的风险）
    for (const item of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const snapshotResult = await this.undoManager.createSnapshot(
        item.file.path,
        item.previousContent,
        `merge-parents-${params.pipelineId}`,
        item.nodeId
      );
      if (!snapshotResult.ok) {
        return err(
          snapshotResult.error.code,
          `更新 parents 引用前创建快照失败: ${item.file.path}`,
          snapshotResult.error
        );
      }
    }

    let updatedCount = 0;
    for (const item of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.noteRepository.writeAtomic(item.file.path, item.nextContent);
        updatedCount += 1;
      } catch (error) {
        this.logger.error("PipelineOrchestrator", "更新 parents 引用失败", error as Error, {
          path: item.file.path,
          pipelineId: params.pipelineId
        });
        return err("E302_PERMISSION_DENIED", `更新 parents 引用失败: ${item.file.path}`, error);
      }
    }

    this.logger.info("PipelineOrchestrator", "已完成 Merge 的 parents 引用重写", {
      pipelineId: params.pipelineId,
      from: fromLink,
      to: toLink,
      updatedCount
    });

    return ok({ updatedCount });
  }

  /**
   * 启动合并管线
   * 
   * 遵循设计文档 6.6：Merge 流程
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
      return err("E301_FILE_NOT_FOUND", "无法定位合并笔记文件（可能已被移动或删除）", {
        keepNodeId: keepId,
        deleteNodeId: deleteId,
        keepPath: keepPath || null,
        deletePath: deletePath || null
      });
    }

    const keepNote = { nodeId: keepId, name: this.cruidCache?.getName(keepId) || keepId, path: keepPath };
    const deleteNote = { nodeId: deleteId, name: this.cruidCache?.getName(deleteId) || deleteId, path: deletePath };

    // 前置校验
    const prereqResult = this.validatePrerequisites("merge", pair.type);
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
    this.schedulePersist();

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
      const keepFile = this.noteRepository.getFileByPath(keepNote.path);
      const deleteFile = this.noteRepository.getFileByPath(deleteNote.path);

      if (!keepFile) {
        context.stage = "failed";
        context.error = { code: "E301_FILE_NOT_FOUND", message: `主笔记不存在: ${keepNote.path}` };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      if (!deleteFile) {
        context.stage = "failed";
        context.error = { code: "E301_FILE_NOT_FOUND", message: `被合并笔记不存在: ${deleteNote.path}` };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      const keepContent = await this.noteRepository.readByPath(keepNote.path);
      const deleteContent = await this.noteRepository.readByPath(deleteNote.path);

      context.previousContent = keepContent;
      context.deleteContent = deleteContent;
      context.filePath = keepNote.path;

      // 2. 创建双快照（设计文档要求）
      context.stage = "saving";
      context.updatedAt = formatCRTimestamp();

      const keepSnapshotResult = await this.undoManager.createSnapshot(
        keepNote.path,
        keepContent,
        context.pipelineId,
        keepNote.nodeId
      );
      if (!keepSnapshotResult.ok) {
        context.stage = "failed";
        context.error = { code: keepSnapshotResult.error.code, message: keepSnapshotResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }
      context.snapshotId = keepSnapshotResult.value;

      const deleteSnapshotResult = await this.undoManager.createSnapshot(
        deleteNote.path,
        deleteContent,
        `merge-delete-${context.pipelineId}`,
        deleteNote.nodeId
      );
      if (!deleteSnapshotResult.ok) {
        context.stage = "failed";
        context.error = { code: deleteSnapshotResult.error.code, message: deleteSnapshotResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      this.logger.info("PipelineOrchestrator", "合并快照已创建", {
        pipelineId: context.pipelineId,
        keepSnapshotId: context.snapshotId
      });

      // 3. 入队 merge 任务
      context.stage = "writing";
      context.updatedAt = formatCRTimestamp();

      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "writing",
        context,
        timestamp: context.updatedAt
      });

      const settings = this.getSettings();
      let taskId: string;
      try {
        taskId = this.taskQueue.enqueue(TaskFactory.create({
          nodeId: context.nodeId,
          taskType: "merge",
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("merge"),
          payload: {
            pipelineId: context.pipelineId,
            keepName: keepNote.name,
            deleteName: deleteNote.name,
            keepContent,
            deleteContent,
            conceptType: pair.type,
            finalFileName
          }
        }));
      } catch (error) {
        context.stage = "failed";
        context.error = { code: "E500_INTERNAL_ERROR", message: "创建合并任务失败" };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      this.taskToPipeline.set(taskId, context.pipelineId);

    } catch (error) {
      this.logger.error("PipelineOrchestrator", "合并管线执行失败", error as Error, {
        pipelineId: context.pipelineId
      });
      context.stage = "failed";
      context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
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
   * 启动修订（Amend）管线
   *
   * - 用户从 Workbench 选择目标笔记与修订指令
   * - 创建快照（目标笔记）
   * - 生成候选修订（正文 + frontmatter）
   * - 进入确认阶段：DiffView 确认后落盘
   *
   * @param filePath 目标笔记路径
   * @param instruction 修订指令
   * @returns 管线 ID
   */
  startAmendPipeline(
    filePath: string,
    instruction: string
  ): Result<string> {
    // 前置校验
    const prereqResult = this.validatePrerequisites("amend");
    if (!prereqResult.ok) {
      return prereqResult as Result<string>;
    }

    // 获取文件
    const file = this.noteRepository.getFileByPath(filePath);
    if (!file) {
      return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`);
    }

    const pipelineId = generateUUID();
    const now = formatCRTimestamp();

    // 从文件路径提取 nodeId（如果有 frontmatter 中的 cruid）
    const nodeId = generateUUID(); // 临时 ID，后续从 frontmatter 读取

    const context: PipelineContext = {
      kind: "amend",
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
    this.schedulePersist();

    this.logger.info("PipelineOrchestrator", `启动修订管线: ${pipelineId}`, {
      filePath,
      instruction: instruction.substring(0, 100)
    });

    // 异步执行修订流程
    void this.executeAmendPipeline(context, file, instruction);

    return ok(pipelineId);
  }

  /**
   * 启动 Verify 管线（手动触发）
   *
   * 遵循设计文档 6.10：
   * - 读取当前笔记（frontmatter + 正文）
   * - 执行 Verify（入队）
   * - 将报告追加到笔记末尾（仅追加，不修改原文）
   */
  startVerifyPipeline(filePath: string): Result<string> {
    // 预校验模板与 Provider（类型在读取 frontmatter 后补全）
    const prereqResult = this.validatePrerequisites("verify");
    if (!prereqResult.ok) {
      return prereqResult as Result<string>;
    }

    const file = this.noteRepository.getFileByPath(filePath);
    if (!file) {
      return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`);
    }

    const pipelineId = generateUUID();
    const now = formatCRTimestamp();

    const context: PipelineContext = {
      kind: "verify",
      pipelineId,
      nodeId: generateUUID(), // 临时 ID，后续从 frontmatter 读取
      type: "Entity", // 临时类型，后续从 frontmatter 读取
      stage: "idle",
      userInput: file.basename,
      filePath,
      createdAt: now,
      updatedAt: now
    };

    this.pipelines.set(pipelineId, context);
    this.schedulePersist();

    this.logger.info("PipelineOrchestrator", `启动 Verify 管线: ${pipelineId}`, { filePath });

    void this.executeVerifyPipeline(context, file);

    return ok(pipelineId);
  }

  private async executeVerifyPipeline(context: PipelineContext, file: TFile): Promise<void> {
    try {
      const content = await this.noteRepository.readByPath(file.path);

      const extracted = extractFrontmatter(content);
      if (!extracted) {
        context.stage = "failed";
        context.error = { code: "E500_INTERNAL_ERROR", message: "无法解析目标笔记的 frontmatter" };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      context.nodeId = extracted.frontmatter.cruid;
      context.type = extracted.frontmatter.type;

      // Verify 会追加报告到笔记末尾：先创建快照，保证可撤销
      const snapshotResult = await this.undoManager.createSnapshot(
        context.filePath!,
        content,
        context.pipelineId,
        context.nodeId
      );
      if (snapshotResult.ok) {
        context.snapshotId = snapshotResult.value;
      }

      const prereqResult = this.validatePrerequisites("verify", context.type);
      if (!prereqResult.ok) {
        context.stage = "failed";
        context.error = { code: prereqResult.error.code, message: prereqResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      const startResult = await this.startVerifyTask(context);
      if (!startResult.ok) {
        context.stage = "failed";
        context.error = { code: startResult.error.code, message: startResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      this.schedulePersist();
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "Verify 管线执行失败", error as Error, {
        pipelineId: context.pipelineId
      });
      context.stage = "failed";
      context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
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
   * 执行修订（Amend）管线
   */
  private async executeAmendPipeline(
    context: PipelineContext,
    file: TFile,
    instruction: string
  ): Promise<void> {
    try {
      // 1. 读取笔记内容
      const content = await this.noteRepository.readByPath(file.path);
      context.previousContent = content;

      // 2. 解析 frontmatter 获取 nodeId 和 type
      const extracted = extractFrontmatter(content);
      if (!extracted) {
        context.stage = "failed";
        context.error = { code: "E500_INTERNAL_ERROR", message: "无法解析目标笔记的 frontmatter" };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      context.nodeId = extracted.frontmatter.cruid;
      context.type = extracted.frontmatter.type;

      // 3. 创建快照（设计文档要求）
      const snapshotResult = await this.undoManager.createSnapshot(
        context.filePath!,
        content,
        context.pipelineId,
        context.nodeId
      );
      if (!snapshotResult.ok) {
        context.stage = "failed";
        context.error = { code: snapshotResult.error.code, message: snapshotResult.error.message };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }
      context.snapshotId = snapshotResult.value;

      this.logger.info("PipelineOrchestrator", "修订快照已创建", {
        pipelineId: context.pipelineId,
        snapshotId: context.snapshotId
      });

      // 4. 入队 amend 任务
      context.stage = "writing";
      context.updatedAt = formatCRTimestamp();

      this.publishEvent({
        type: "stage_changed",
        pipelineId: context.pipelineId,
        stage: "writing",
        context,
        timestamp: context.updatedAt
      });

      const settings = this.getSettings();
      let taskId: string;
      try {
        taskId = this.taskQueue.enqueue(TaskFactory.create({
          nodeId: context.nodeId,
          taskType: "amend",
          maxAttempts: settings.maxRetryAttempts,
          providerRef: this.getProviderIdForTask("amend"),
          payload: {
            pipelineId: context.pipelineId,
            currentContent: content,
            instruction,
            conceptType: context.type
          }
        }));
      } catch (error) {
        context.stage = "failed";
        context.error = { code: "E500_INTERNAL_ERROR", message: "创建修订任务失败" };
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: formatCRTimestamp()
        });
        return;
      }

      this.taskToPipeline.set(taskId, context.pipelineId);

    } catch (error) {
      this.logger.error("PipelineOrchestrator", "修订管线执行失败", error as Error, {
        pipelineId: context.pipelineId
      });
      context.stage = "failed";
      context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
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
   * 确认创建（在 embedding 之后）
   * 
   * 遵循 A-FUNC-05：确认创建后先生成 Stub，再执行 write
   * 遵循 A-UCD-03：写入需显式确认
   * 遵循设计文档：Stub 状态仅含 frontmatter，后续 write 完成后转为 Draft
   */
  async confirmCreate(pipelineId: string): Promise<Result<void>> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
    }

    if (context.stage !== "review_draft") {
      return err("E310_INVALID_STATE", `管线状态不正确: ${context.stage}，期望: review_draft`);
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
        taskId = this.taskQueue.enqueue(TaskFactory.create({
          nodeId: context.nodeId,
          taskType: "write",
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
        }));
      } catch (error) {
        context.stage = "failed";
        const converted = toErr(error, "E500_INTERNAL_ERROR", "创建任务失败");
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
      return err("E500_INTERNAL_ERROR", "确认创建失败", error);
    }
  }

  /**
   * 解析创建目标路径与名称（支持 Expand 预设路径）
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
        return err("E310_INVALID_STATE", "缺少标准化数据，无法创建 Stub");
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

      // 生成目标路径（Expand 支持传入覆盖路径）
      const { targetPath, targetName } = this.resolveCreateTarget(context, signature.standardName);
      context.filePath = targetPath;

      // 确保目录存在
      await this.noteRepository.ensureDirForPath(targetPath);

      // 创建流程不保存快照（仅修订和合并时保存）

      // 生成仅含 frontmatter 的 Stub 内容
      const frontmatter = generateFrontmatter({
        cruid: context.nodeId,
        type: context.type,
        name: targetName,
        parents: context.parents ?? [],
        status: "Stub", // Stub 状态
        aliases: context.enrichedData?.aliases,
        tags: context.enrichedData?.tags,
      });
      const stubContent = generateMarkdownContent(frontmatter, ""); // 无正文

      // 原子写入 Stub 文件
      await this.noteRepository.writeAtomic(targetPath, stubContent);

      this.logger.info("PipelineOrchestrator", `Stub 文件已创建: ${targetPath}`, {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId,
        status: "Stub"
      });

      return ok(targetPath);
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "创建 Stub 文件失败", error as Error);
      return err("E302_PERMISSION_DENIED", "创建 Stub 文件失败", error);
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
      return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
    }

    if (!context.standardizedData) {
      return err("E310_INVALID_STATE", "标准化结果尚未生成，无法更新");
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
      return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
    }

    if (context.stage !== "review_changes") {
      return err("E310_INVALID_STATE", `管线状态不正确: ${context.stage}，期望: review_changes`);
    }

    try {
      context.stage = "writing";
      context.updatedAt = formatCRTimestamp();

      this.logger.info("PipelineOrchestrator", `用户确认写入: ${pipelineId}`);

      if (context.kind === "create") {
        return await this.confirmCreateWrite(context);
      }
      if (context.kind === "amend") {
        return await this.confirmAmendWrite(context);
      }
      if (context.kind === "merge") {
        return await this.confirmMergeWrite(context);
      }

      return err("E310_INVALID_STATE", "未知的管线类型");
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "确认写入失败", error as Error);
      context.stage = "failed";
      context.error = { code: "E500_INTERNAL_ERROR", message: String(error) };
      return err("E500_INTERNAL_ERROR", "确认写入失败", error);
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
      return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
    }

    if (!["review_changes", "saving", "checking_duplicates"].includes(context.stage)) {
      return err("E310_INVALID_STATE", `当前阶段不支持预览: ${context.stage}`);
    }

    return this.composeWriteContent(context);
  }

  /**
   * 取消管线
   */
  cancelPipeline(pipelineId: string): Result<void> {
    const context = this.pipelines.get(pipelineId);
    if (!context) {
      return err("E311_NOT_FOUND", `管线不存在: ${pipelineId}`);
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
    context.error = { code: "E310_INVALID_STATE", message: "用户取消" };
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
      case "amend":
        await this.handleAmendCompleted(context, task);
        break;
      case "merge":
        await this.handleMergeCompleted(context, task);
        break;
      case "verify":
        await this.handleVerifyCompleted(context, task);
        break;
    }
  }

  /**
   * 处理 Verify 任务完成
   * 
   * 遵循设计文档 6.10：
   * - 将 Verify 结果写入 context.verificationResult 供 UI 展示
   * - 将报告追加到笔记末尾（仅追加，不修改原文）
   * - 追加成功后结束管线
   */
  private async handleVerifyCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;

    if (!result) {
      context.stage = "failed";
      context.error = { code: "E310_INVALID_STATE", message: "Verify 结果缺失" };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    context.verificationResult = result;

    this.logger.info("PipelineOrchestrator", `Verify 完成: ${context.pipelineId}`, {
      overall_assessment: result.overall_assessment,
      issueCount: Array.isArray(result.issues) ? result.issues.length : 0
    });

    const filePath = context.filePath;
    if (filePath) {
      const appendResult = await this.appendVerificationReportToNote(filePath, result, task.id, context.nodeId);
      if (!appendResult.ok) {
        context.stage = "failed";
        context.error = { code: appendResult.error.code, message: appendResult.error.message };
        context.updatedAt = formatCRTimestamp();
        this.publishEvent({
          type: "pipeline_failed",
          pipelineId: context.pipelineId,
          stage: "failed",
          context,
          timestamp: context.updatedAt
        });
        return;
      }
    }

    this.completePipeline(context);
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
      context.error = { code: "E310_INVALID_STATE", message: "标准化结果缺失" };
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
      tagTaskId = this.taskQueue.enqueue(TaskFactory.create({
        nodeId: context.nodeId,
        taskType: "tag",
        maxAttempts: settings.maxRetryAttempts,
        providerRef: this.getProviderIdForTask("tag"),
        payload: {
          pipelineId: context.pipelineId,
          standardizedData: context.standardizedData,
          conceptType: context.type,
          userInput: context.userInput
        }
      }));
    } catch (error) {
      const converted = toErr(error, "E500_INTERNAL_ERROR", "创建 tag 任务失败");
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
      context.error = { code: "E310_INVALID_STATE", message: "丰富结果缺失" };
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
      context.error = { code: "E310_INVALID_STATE", message: "嵌入结果缺失" };
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
      const fileName = sanitizeFileName(context.standardizedData.standardNames[context.type].chinese);
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

  private async handleAmendCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    if (!result) {
      context.stage = "failed";
      context.error = { code: "E310_INVALID_STATE", message: "Amend 结果缺失" };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    if (!context.previousContent || !context.filePath) {
      context.stage = "failed";
      context.error = { code: "E310_INVALID_STATE", message: "缺少修订前内容或文件路径" };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    const extracted = extractFrontmatter(context.previousContent);
    if (!extracted) {
      context.stage = "failed";
      context.error = { code: "E500_INTERNAL_ERROR", message: "无法解析目标笔记的 frontmatter" };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    context.generatedContent = result;

    const file = this.noteRepository.getFileByPath(context.filePath);
    const fallbackName = extracted.frontmatter.name?.trim()
      || file?.basename
      || "Unnamed Concept";

    const updatedFrontmatter: CRFrontmatter = {
      ...extracted.frontmatter,
      name: fallbackName,
      parents: extracted.frontmatter.parents ?? [],
      updated: formatCRTimestamp()
    };

    const nextDefinition = typeof result.definition === "string"
      ? result.definition.trim()
      : undefined;
    if (nextDefinition) {
      updatedFrontmatter.definition = nextDefinition;
    }

    context.newContent = generateMarkdownContent(
      updatedFrontmatter,
      this.renderContentToMarkdown(context, updatedFrontmatter.name)
    );

    context.stage = "review_changes";
    context.updatedAt = formatCRTimestamp();
    this.publishEvent({
      type: "confirmation_required",
      pipelineId: context.pipelineId,
      stage: "review_changes",
      context,
      timestamp: context.updatedAt
    });
  }

  private async handleMergeCompleted(
    context: PipelineContext,
    task: TaskRecord
  ): Promise<void> {
    const result = (task.result || task.payload?.result) as Record<string, unknown> | undefined;
    if (!result) {
      context.stage = "failed";
      context.error = { code: "E310_INVALID_STATE", message: "Merge 结果缺失" };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    if (!context.previousContent) {
      context.stage = "failed";
      context.error = { code: "E310_INVALID_STATE", message: "缺少合并前内容" };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    context.generatedContent = (result.content as Record<string, unknown>) || result;

    const buildResult = this.buildMergedContent(
      result,
      context.previousContent,
      context.type,
      context.deleteNoteName || ""
    );

    if (!buildResult.ok) {
      context.stage = "failed";
      context.error = { code: buildResult.error.code, message: buildResult.error.message };
      context.updatedAt = formatCRTimestamp();
      this.publishEvent({
        type: "pipeline_failed",
        pipelineId: context.pipelineId,
        stage: "failed",
        context,
        timestamp: context.updatedAt
      });
      return;
    }

    context.newContent = buildResult.value;
    context.stage = "review_changes";
    context.updatedAt = formatCRTimestamp();
    this.publishEvent({
      type: "confirmation_required",
      pipelineId: context.pipelineId,
      stage: "review_changes",
      context,
      timestamp: context.updatedAt
    });
  }

  /**
   * 启动 Verify 任务
   * 
   * 遵循设计文档 6.10：写入落盘后执行 Verify，并将报告追加到笔记末尾
   */
  private async startVerifyTask(context: PipelineContext): Promise<Result<void>> {
    const filePath = context.filePath;
    if (!filePath) {
      return err("E310_INVALID_STATE", "缺少文件路径，无法执行 Verify");
    }

    const currentContent = await this.noteRepository.readByPathIfExists(filePath);
    if (currentContent === null) {
      return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`, { filePath });
    }

    context.stage = "verifying";
    context.updatedAt = formatCRTimestamp();

    this.publishEvent({
      type: "stage_changed",
      pipelineId: context.pipelineId,
      stage: "verifying",
      context,
      timestamp: context.updatedAt
    });

    this.logger.info("PipelineOrchestrator", `启动 Verify 任务: ${context.pipelineId}`, {
      filePath
    });

    const settings = this.getSettings();
    try {
      const taskId = this.taskQueue.enqueue(TaskFactory.create({
        nodeId: context.nodeId,
        taskType: "verify",
        maxAttempts: settings.maxRetryAttempts,
        providerRef: this.getProviderIdForTask("verify"),
        payload: {
          pipelineId: context.pipelineId,
          filePath,
          currentContent,
          conceptType: context.type,
          standardizedData: context.standardizedData
        }
      }));
      this.taskToPipeline.set(taskId, context.pipelineId);
      return ok(undefined);
    } catch (error) {
      return toErr(error, "E500_INTERNAL_ERROR", "Verify 任务创建失败");
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

  private completePipeline(context: PipelineContext): void {
    context.stage = "completed";
    context.updatedAt = formatCRTimestamp();
    this.publishEvent({
      type: "pipeline_completed",
      pipelineId: context.pipelineId,
      stage: "completed",
      context,
      timestamp: context.updatedAt
    });
  }

  private async maybeStartAutoVerifyOrComplete(context: PipelineContext): Promise<void> {
    const settings = this.getSettings();
    if (!settings.enableAutoVerify) {
      this.completePipeline(context);
      return;
    }

    const prereqResult = this.validatePrerequisites("verify", context.type);
    if (!prereqResult.ok) {
      this.logger.warn("PipelineOrchestrator", "Verify 前置校验失败，跳过自动校验并结束管线", {
        pipelineId: context.pipelineId,
        error: prereqResult.error,
      });
      this.completePipeline(context);
      return;
    }

    const startResult = await this.startVerifyTask(context);
    if (!startResult.ok) {
      this.logger.warn("PipelineOrchestrator", "启动 Verify 失败，跳过自动校验并结束管线", {
        pipelineId: context.pipelineId,
        error: startResult.error,
      });
      this.completePipeline(context);
    }
  }

  private buildVerificationReportMarkdown(result: Record<string, unknown>): string {
    const now = formatCRTimestamp();
    const overallAssessment = typeof result.overall_assessment === "string" ? result.overall_assessment : "";
    const confidenceScore = typeof result.confidence_score === "number" ? result.confidence_score : undefined;
    const requiresHumanReview = typeof result.requires_human_review === "boolean" ? result.requires_human_review : undefined;

    const lines: string[] = [];
    lines.push("## Verification Report");
    lines.push("");
    lines.push(`- Generated at: ${now}`);
    if (overallAssessment) {
      lines.push(`- Overall assessment: ${overallAssessment}`);
    }
    if (confidenceScore !== undefined) {
      lines.push(`- Confidence: ${confidenceScore}`);
    }
    if (requiresHumanReview !== undefined) {
      lines.push(`- Requires human review: ${requiresHumanReview}`);
    }
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(result, null, 2));
    lines.push("```");

    return lines.join("\n");
  }

  private async appendVerificationReportToNote(
    filePath: string,
    result: Record<string, unknown>,
    snapshotTaskId: string,
    nodeId?: string
  ): Promise<Result<void>> {
    try {
      const existing = await this.noteRepository.readByPathIfExists(filePath);
      if (existing === null) {
        return err("E301_FILE_NOT_FOUND", `文件不存在: ${filePath}`, { filePath });
      }

      const snapshotResult = await this.undoManager.createSnapshot(
        filePath,
        existing,
        snapshotTaskId,
        nodeId
      );
      if (!snapshotResult.ok) {
        return err(snapshotResult.error.code, snapshotResult.error.message, snapshotResult.error.details);
      }

      const report = this.buildVerificationReportMarkdown(result);
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      const next = `${existing}${separator}${report}\n`;

      await this.noteRepository.writeAtomic(filePath, next);
      return ok(undefined);
    } catch (error) {
      return toErr(error, "E302_PERMISSION_DENIED", "追加 Verify 报告失败");
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
      code: task?.errors?.[0]?.code || "E500_INTERNAL_ERROR",
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

  private buildEmbeddingTextFromFrontmatter(frontmatter: CRFrontmatter): string {
    const parts: string[] = [];

    if (frontmatter.name) {
      parts.push(frontmatter.name);
    }

    if (frontmatter.aliases && frontmatter.aliases.length > 0) {
      parts.push(...frontmatter.aliases);
    }

    if (frontmatter.definition) {
      parts.push(frontmatter.definition);
    }

    parts.push(`类型: ${frontmatter.type}`);

    if (frontmatter.tags && frontmatter.tags.length > 0) {
      parts.push(`标签: ${frontmatter.tags.join(", ")}`);
    }

    return parts.join("\n");
  }

  /**
   * 将生成的结构化内容渲染为 Markdown
   * 根据用户语言设置使用中文或英文标题
   * 注意：文件名已包含中英文，无需在内容中重复
   */
  private renderContentToMarkdown(context: PipelineContext, standardName: string): string {
    const settings = this.getSettings();
    const language = settings.language || "zh";

    const title = language === "en"
      ? (context.standardizedData?.standardNames[context.type].english || standardName)
      : standardName;

    return this.contentRenderer.renderNoteMarkdown({
      title,
      type: context.type,
      content: context.generatedContent,
      language
    });
  }

  private renderStructuredContentToMarkdown(type: CRType, content: unknown, language: string): string {
    return this.contentRenderer.renderStructuredContentMarkdown({ type, content, language });
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

    const structured = this.renderStructuredContentToMarkdown(type, content, language);
    if (structured) {
      sections.push(structured);
      sections.push("");
    }

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

  private buildMergedContent(
    mergeResult: Record<string, unknown>,
    previousContent: string,
    type: CRType,
    deleteNoteName: string
  ): Result<string> {
    const extracted = extractFrontmatter(previousContent);
    if (!extracted) {
      return err("E500_INTERNAL_ERROR", "无法解析原始笔记的 frontmatter");
    }

    const frontmatter = extracted.frontmatter;

    const mergedName = (mergeResult.merged_name as { chinese?: string; english?: string }) || {};
    const content = mergeResult.content as Record<string, unknown> | undefined;
    if (!content) {
      return err("E211_MODEL_SCHEMA_VIOLATION", "合并结果缺少内容信息");
    }

    const updatedFrontmatter: CRFrontmatter = {
      ...frontmatter,
      updated: formatCRTimestamp()
    };

    const nextDefinition = typeof content.definition === "string" ? content.definition.trim() : undefined;
    if (nextDefinition) {
      updatedFrontmatter.definition = nextDefinition;
    }

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
        return err("E310_INVALID_STATE", "缺少生成内容或标准化数据");
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

      await this.noteRepository.ensureDirForPath(targetPath);

      const previousContent = (await this.noteRepository.readByPathIfExists(targetPath)) ?? "";

      const markdownBody = this.renderContentToMarkdown(
        context,
        targetName
      );

      const definition = context.generatedContent && typeof context.generatedContent === "object"
        ? (typeof (context.generatedContent as Record<string, unknown>).definition === "string"
          ? ((context.generatedContent as Record<string, unknown>).definition as string)
          : undefined)
        : undefined;
      const frontmatter = generateFrontmatter({
        cruid: context.nodeId,
        type: context.type,
        name: targetName,
        definition,
        parents: context.parents ?? [],
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

    if (context.kind === "amend" || context.kind === "merge") {
      if (!context.filePath) {
        return err("E310_INVALID_STATE", "缺少文件路径");
      }
      if (context.previousContent === undefined || context.newContent === undefined) {
        return err("E310_INVALID_STATE", "缺少预览内容");
      }

      await this.noteRepository.ensureDirForPath(context.filePath);

      const normalized = extractFrontmatter(context.newContent);
      if (!normalized) {
        return err("E500_INTERNAL_ERROR", "无法解析生成的 frontmatter");
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

    return err("E310_INVALID_STATE", "未知的管线类型");
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

  private async refreshEmbeddingAndDuplicates(context: PipelineContext, newContent: string): Promise<void> {
    if (!this.providerManager) {
      this.logger.warn("PipelineOrchestrator", "ProviderManager 未初始化，跳过 embedding/去重更新", {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId
      });
      return;
    }

    const extracted = extractFrontmatter(newContent);
    const embeddingText = extracted
      ? this.buildEmbeddingTextFromFrontmatter(extracted.frontmatter)
      : newContent;

    const settings = this.getSettings();
    const taskConfig = settings.taskModels["index"];
    const providerId = taskConfig?.providerId || this.getProviderIdForTask("index");
    const embeddingModel = this.vectorIndex.getEmbeddingModel();
    const embeddingDimension = this.vectorIndex.getEmbeddingDimension();

    const embedResult = await this.providerManager.embed({
      providerId,
      model: embeddingModel,
      input: embeddingText,
      dimensions: embeddingDimension
    });

    if (!embedResult.ok) {
      this.logger.warn("PipelineOrchestrator", "Embedding 重算失败，已移除旧向量避免陈旧结果", {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId,
        error: embedResult.error
      });

      const deleteResult = await this.vectorIndex.delete(context.nodeId);
      if (!deleteResult.ok && deleteResult.error.code !== "E311_NOT_FOUND") {
        this.logger.warn("PipelineOrchestrator", "移除旧向量失败", {
          pipelineId: context.pipelineId,
          nodeId: context.nodeId,
          error: deleteResult.error
        });
      }

      const clearResult = await this.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
      if (!clearResult.ok) {
        this.logger.warn("PipelineOrchestrator", "清理旧重复对失败", {
          pipelineId: context.pipelineId,
          nodeId: context.nodeId,
          error: clearResult.error
        });
      }

      context.embedding = undefined;
      return;
    }

    context.embedding = embedResult.value.embedding;
    context.updatedAt = formatCRTimestamp();

    const clearResult = await this.duplicateManager.clearPendingPairsByNodeId(context.nodeId);
    if (!clearResult.ok) {
      this.logger.warn("PipelineOrchestrator", "清理旧重复对失败", {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId,
        error: clearResult.error
      });
    }

    const upsertResult = await this.vectorIndex.upsert({
      uid: context.nodeId,
      type: context.type,
      embedding: context.embedding,
      updated: context.updatedAt
    });
    if (!upsertResult.ok) {
      this.logger.warn("PipelineOrchestrator", "更新向量索引失败", {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId,
        error: upsertResult.error
      });
    }

    const detectResult = await this.duplicateManager.detect(context.nodeId, context.type, context.embedding);
    if (!detectResult.ok) {
      this.logger.warn("PipelineOrchestrator", "去重检测失败", {
        pipelineId: context.pipelineId,
        nodeId: context.nodeId,
        error: detectResult.error
      });
    }
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
      const embeddingModel = this.vectorIndex.getEmbeddingModel();
      const embeddingDimension = this.vectorIndex.getEmbeddingDimension();

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

      // embedding 完成后，Create 自动写入；Amend/Merge 进入确认阶段
      if (context.kind === "create") {
        await this.autoConfirmWrite(context);
      } else {
        this.transitionToAwaitingWriteConfirm(context);
      }
    } catch (error) {
      this.logger.error("PipelineOrchestrator", "直接执行 embedding 失败", error as Error);
      context.stage = "failed";
      context.error = { 
        code: "E500_INTERNAL_ERROR", 
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
    this.schedulePersist();
  }
}
