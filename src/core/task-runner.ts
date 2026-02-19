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
  TaskType,
  CRType,
  StandardizedConcept,
  NoteState,
  Result,
  ChatRequest,
  AnyTaskPayload,
  TypedTaskRecord
} from "../types";
import { schemaRegistry, SchemaRegistry, WRITE_PHASES } from "./schema-registry";
import { createConceptSignature, generateSignatureText } from "./naming-utils";
import { mapStandardizeOutput } from "./standardize-mapper";
import type { ProviderManager } from "./provider-manager";
import type { PromptManager } from "./prompt-manager";
import type { VectorIndex } from "./vector-index";
import type { SettingsStore } from "../data/settings-store";
import { DEFAULT_TASK_MODEL_CONFIGS } from "../data/settings-store";
import type { Validator } from "../data/validator";
import { extractJsonFromResponse } from "../data/validator";
import { App, TFile } from "obsidian";
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


/** 输入清洗：去除控制字符、合并空白 */
function sanitizeInput(input: string): string {
  if (typeof input !== "string") {
    throw new CognitiveRazorError("E101_INVALID_INPUT", "输入必须是字符串");
  }
  return input.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();
}


/** TaskRunner 依赖接口 */
interface TaskRunnerDependencies {
  providerManager: ProviderManager;
  promptManager: PromptManager;
  validator: Validator;
  logger: ILogger;
  vectorIndex?: VectorIndex;
  schemaRegistry?: SchemaRegistry;
  settingsStore?: SettingsStore;
  noteRepository?: NoteRepository;
  app: App;
}

/** 写入操作上下文 */

export class TaskRunner {
  private providerManager: ProviderManager;
  private promptManager: PromptManager;
  private validator: Validator;
  private logger: ILogger;
  private vectorIndex?: VectorIndex;
  private schemaRegistry: SchemaRegistry;
  private settingsStore?: SettingsStore;
  private abortControllers: Map<string, AbortController>;
  private app: App;
  private noteRepository: NoteRepository;
  private taskHandlers: Map<TaskType, (task: TaskRecord, signal: AbortSignal) => Promise<Result<TaskResult>>>;

  constructor(deps: TaskRunnerDependencies) {
    this.providerManager = deps.providerManager;
    this.promptManager = deps.promptManager;
    this.validator = deps.validator;
    this.logger = deps.logger;
    this.vectorIndex = deps.vectorIndex;
    // 使用注入的 SchemaRegistry 或默认单例
    this.schemaRegistry = deps.schemaRegistry || schemaRegistry;
    this.settingsStore = deps.settingsStore;
    this.app = deps.app;
    this.noteRepository = deps.noteRepository ?? new NoteRepository(deps.app, deps.logger);
    this.abortControllers = new Map();
    this.taskHandlers = new Map([
      ["define", (task, signal) => this.executeDefine(task, signal)],
      ["tag", (task, signal) => this.executeTag(task, signal)],
      ["index", (task, signal) => this.executeIndex(task, signal)],
      ["write", (task, signal) => this.executeWrite(task, signal)],
      ["verify", (task, signal) => this.executeVerify(task, signal)],
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
        ? await handler(task, abortController.signal)
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







  /** 更新笔记状态 — 使用 Obsidian 官方原子 API */
  async updateNoteStatus(filePath: string, newStatus: NoteState): Promise<Result<void>> {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        return err("E301_FILE_NOT_FOUND", `目标文件不存在: ${filePath}`, { filePath });
      }

      const now = formatCRTimestamp();
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.status = newStatus;
        fm.updated = now;
      });

      this.logger.info("TaskRunner", `笔记状态已更新为 ${newStatus}`, { filePath });
      return ok(undefined);
    } catch (error) {
      this.logger.error("TaskRunner", "更新笔记状态失败", error as Error, { filePath });
      return err("E302_PERMISSION_DENIED", "更新笔记状态失败", error);
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
      const typed = task as TypedTaskRecord;
      if (typed.taskType !== "define") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 define" });
      }
      const payload = typed.payload;
      const sanitizedInput = sanitizeInput(payload.userInput);

      // 构建 prompt（CTX_INPUT）
      const slots = {
        CTX_INPUT: sanitizedInput,
        CTX_LANGUAGE: this.getLanguage()
      };

      const prompt = this.promptManager.build(task.taskType, slots);

      // 调用 LLM（使用用户配置的模型）
      const chatRequest = this.buildChatRequest("define", prompt, task.providerRef);
      
      const chatResult = await this.providerManager.chat(chatRequest, signal);

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // 使用 SchemaRegistry 的定义 Schema 校验
      const schema = this.schemaRegistry.getDefineSchema();
      const validationResult = await this.validator.validate(
        chatResult.value.content,
        schema,
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
      const typed = task as TypedTaskRecord;
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

      // 调用 LLM（使用用户配置的模型）
      const chatResult = await this.providerManager.chat(
        this.buildChatRequest("tag", prompt, task.providerRef), signal
      );

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
      const typed = task as TypedTaskRecord;
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
          primaryType
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
      const typed = task as TypedTaskRecord;
      if (typed.taskType !== "write") {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: "任务类型不匹配: 期望 write" });
      }
      const payload = typed.payload;
      const conceptType = (payload.conceptType || "Entity") as CRType;
      const fullSchema = this.getSchema(conceptType);
      const sources = typeof payload.sources === "string" ? payload.sources : "";
      const metaContext = this.buildMetaContext(payload);
      const language = this.getLanguage();

      // 获取分阶段配置（从代码常量读取）
      const phases = WRITE_PHASES[conceptType];
      if (!phases || phases.length === 0) {
        return this.createTaskError(task, { code: "E310_INVALID_STATE", message: `未找到 ${conceptType} 的分阶段配置` });
      }

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

        // 加载阶段专属 prompt 模板（优先从文件，fallback 到默认模板）
        const phaseTemplate = await this.loadPhasePromptTemplate(conceptType, phase.id);

        // 构建分阶段 prompt
        const prompt = this.promptManager.buildPhasedWrite({
          CTX_META: metaContext,
          CTX_PREVIOUS: previousContext,
          CTX_SOURCES: sources,
          CTX_LANGUAGE: language,
          CONCEPT_TYPE: conceptType,
          PHASE_SCHEMA: phaseSchema,
        }, phaseTemplate ?? undefined);

        // 调用 LLM
        const chatResult = await this.providerManager.chat(
          this.buildChatRequest("write", prompt, task.providerRef), signal
        );

        if (!chatResult.ok) {
          return this.createTaskError(task, chatResult.error!);
        }

        // 验证本阶段输出（仅验证本阶段的字段）
        const phaseValidationSchema = this.buildPhaseValidationSchema(fullSchema, phase.fields);
        const validationResult = await this.validator.validate(
          chatResult.value.content,
          phaseValidationSchema,
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
            const parsed = extractJsonFromResponse(content);
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

  /**
   * 加载阶段专属 prompt 模板
   * 
   * 优先从 prompts/_phases/{Type}/{phaseId}.md 读取，
   * 读取失败时返回 null（由调用方 fallback 到默认模板）。
   */
  private async loadPhasePromptTemplate(conceptType: CRType, phaseId: string): Promise<string | null> {
    try {
      const filePath = `prompts/_phases/${conceptType}/${phaseId}.md`;
      const file = this.app.vault.getFileByPath(filePath);
      if (!file) {
        this.logger.debug("TaskRunner", `阶段 prompt 文件不存在，使用默认模板: ${filePath}`);
        return null;
      }
      const content = await this.app.vault.read(file);
      if (!content.trim()) {
        this.logger.warn("TaskRunner", `阶段 prompt 文件为空，使用默认模板: ${filePath}`);
        return null;
      }
      this.logger.debug("TaskRunner", `已加载阶段 prompt: ${filePath}`);
      return content;
    } catch (e) {
      this.logger.warn("TaskRunner", `加载阶段 prompt 失败，使用默认模板: ${conceptType}/${phaseId}`, { error: e });
      return null;
    }
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


  /** 执行 verify 任务（校验） */
  private async executeVerify(
    task: TaskRecord,
    signal: AbortSignal
  ): Promise<Result<TaskResult>> {
    try {
      // 通过 taskType 判别式窄化，安全访问 VerifyPayload 字段
      const typed = task as TypedTaskRecord;
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

      // 调用 LLM（使用用户配置的模型）
      const chatResult = await this.providerManager.chat(
        this.buildChatRequest("verify", prompt, task.providerRef), signal
      );

      if (!chatResult.ok) {
        return this.createTaskError(task, chatResult.error!);
      }

      // Verify 输出为纯文本 Markdown 报告，无需 JSON 解析
      const reportText = (chatResult.value.content || "").trim();
      if (!reportText) {
        return this.createTaskError(task, { code: "E102_MISSING_FIELD", message: "Verify 报告内容为空" });
      }

      this.logger.info("TaskRunner", `Verify 任务完成: ${task.id}`, {
        reportLength: reportText.length,
      });

      return ok({
        taskId: task.id,
        state: "Completed",
        data: { reportText },
      });
    } catch (error) {
      this.logger.error("TaskRunner", "执行 verify 失败", error as Error, {
        taskId: task.id
      });
      return toErr(error, "E500_INTERNAL_ERROR", "执行 verify 失败");
    }
  }

  // 辅助方法

  /** 构建 ChatRequest（DRY：消除 7 处重复的请求构建）
   * 按 <system_instructions>...</system_instructions> 标签分割 system/user 消息：
   * - 标签内内容 → system 消息
   * - 其余内容 → user 消息
   * - 无标签时整体放 user 消息（向后兼容）
   */
  private buildChatRequest(
    taskType: TaskType,
    prompt: string,
    providerRef?: string,
  ): ChatRequest {
    const modelConfig = this.getTaskModelConfig(taskType, providerRef);

    // 提取 system_instructions 标签内容
    const sysMatch = prompt.match(/<system_instructions>([\s\S]*?)<\/system_instructions>/);
    let messages: ChatRequest["messages"];
    if (sysMatch) {
      const systemContent = sysMatch[1].trim();
      // 移除 system_instructions 块后剩余内容作为 user 消息
      const userContent = prompt.replace(/<system_instructions>[\s\S]*?<\/system_instructions>/, "").trim();
      messages = [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ];
    } else {
      messages = [{ role: "user", content: prompt }];
    }

    return {
      providerId: providerRef || modelConfig.providerId,
      model: modelConfig.model,
      messages,
      temperature: modelConfig.temperature,
      topP: modelConfig.topP,
      maxTokens: modelConfig.maxTokens,
      reasoning_effort: modelConfig.reasoning_effort,
    };
  }

  /** 获取任务模型配置（内部） */
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
   * 获取 CTX_LANGUAGE 值（始终返回中文）
   */
  private getLanguage(): string {
    return "Chinese";
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
      case "index":
        return "embedding";
      case "define":
      case "tag":
      case "write":
      case "verify":
      default:
        return "chat";
    }
  }
}
