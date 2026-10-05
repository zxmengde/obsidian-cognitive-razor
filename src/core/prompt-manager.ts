/** 提示词管理器：加载、验证和构建提示词模板 */

import {
  ok,
  err,
  CognitiveRazorError
} from "../types";
import type {
  ILogger,
  TaskType,
  Result,
  CRType,
} from "../types";
import type { FileStorage } from "../data/file-storage";
import { getOperationPromptTemplateKey, getOperationPromptTemplateKeys, getWritePromptTemplateKey } from "./prompt-catalog";
import { getWriteStageDefinition } from "./stage-catalog";
import { BASE_COMPONENT_MAP, injectPromptBaseComponents, renderPromptTemplate } from "./prompt-template";
export { splitPromptIntoMessages } from "./prompt-message-builder";

/** 提示词模板结构 */
interface PromptTemplate {
  content: string;
}

/** 必需的提示词区块 */
const REQUIRED_BLOCKS = [
  "<system_instructions>",
  "<context_slots>",
  "<output_schema>"
] as const;

const TASK_BLOCK_TAG = "task_instruction";

/** 将模板中的系统指令与用户输入拆成统一的聊天消息。 */
/**
 * 将运行时上下文插入最终任务之前，使长上下文之后仍有明确的任务锚点。
 */
export function insertContextBeforeTask(prompt: string, context: string): string {
  const normalizedContext = context.trim();
  if (!normalizedContext) return prompt;

  const taskPosition = prompt.indexOf(`<${TASK_BLOCK_TAG}>`);
  if (taskPosition < 0) {
    throw new CognitiveRazorError(
      "E101_INVALID_INPUT",
      "提示词缺少 <task_instruction> 区块",
    );
  }
  return `${prompt.slice(0, taskPosition).trimEnd()}\n\n${normalizedContext}\n\n${prompt.slice(taskPosition).trimStart()}`;
}

/** 操作模板的槽位契约；Write 使用下方独立的阶段契约。 */
const TASK_REQUIRED_SLOTS: Record<TaskType, string[]> = {
  index: [],
  define: ["CTX_INPUT"],
  tag: ["CTX_META"],
  write: ["CTX_META"],
  verify: ["CTX_META", "CTX_CURRENT"],
  merge: ["CTX_CURRENT"],
  cards: ["CTX_CURRENT"],
};

const PHASE_REQUIRED_SLOTS = ["CTX_META", "CONCEPT_TYPE"];
const PHASE_OPTIONAL_SLOTS = ["CTX_PREVIOUS"];

function hasRequiredBlock(content: string, block: typeof REQUIRED_BLOCKS[number]): boolean {
  return block === "<output_schema>"
    ? content.includes("<output_schema>") || content.includes("<output_format>")
    : content.includes(block);
}

function getBlockPositions(content: string): {
  system: number;
  context: number;
  task: number;
} | null {
  const system = content.indexOf("<system_instructions>");
  const systemEnd = content.indexOf("</system_instructions>", system);
  const context = content.indexOf("<context_slots>", systemEnd);
  const task = content.indexOf(`<${TASK_BLOCK_TAG}>`, context);
  const output = Math.max(content.indexOf("<output_schema>"), content.indexOf("<output_format>"));
  return [system, systemEnd, context, task, output].some((position) => position < 0)
    ? null
    : { system, context, task };
}

/** 验证模板区块结构 */
function validateBlockOrder(content: string): { valid: boolean; error?: string; missingBlocks?: string[] } {
  const missingBlocks = REQUIRED_BLOCKS.filter((block) => !hasRequiredBlock(content, block));

  if (missingBlocks.length > 0) {
    return {
      valid: false,
      error: `模板缺少必需区块: ${missingBlocks.join(", ")}`,
      missingBlocks
    };
  }

  if (!content.includes(`<${TASK_BLOCK_TAG}>`)) {
    return {
      valid: false,
      error: "模板缺少 <task_instruction> 区块",
      missingBlocks: ["<task_instruction>"]
    };
  }

  const positions = getBlockPositions(content);
  if (!positions) {
    return {
      valid: false,
      error: "无法找到必需区块的位置"
    };
  }

  // system_instructions 应该在 context_slots 之前
  if (positions.system > positions.context) {
    return {
      valid: false,
      error: "<system_instructions> 应该在 <context_slots> 之前"
    };
  }

  if (positions.context > positions.task) {
    return {
      valid: false,
      error: "<context_slots> 应该在最终任务区块之前"
    };
  }

  const taskEndTag = `</${TASK_BLOCK_TAG}>`;
  const taskEnd = content.indexOf(taskEndTag, positions.task);
  if (taskEnd === -1 || content.slice(taskEnd + taskEndTag.length).trim().length > 0) {
    return {
      valid: false,
      error: "任务区块必须完整且是模板最后一个顶层区块"
    };
  }

  return { valid: true };
}


/** 验证槽位是否符合任务-槽位映射表 */
function validateSlots(
  requiredSlots: string[],
  optionalSlots: string[],
  providedSlots: string[]
): { valid: boolean; missingRequired?: string[]; extraSlots?: string[] } {
  const allowedSlots = new Set([...requiredSlots, ...optionalSlots]);
  const missingRequired: string[] = [];
  const extraSlots: string[] = [];

  // 检查必需槽位
  for (const required of requiredSlots) {
    if (!providedSlots.includes(required)) {
      missingRequired.push(required);
    }
  }

  // 检查额外槽位
  for (const slot of providedSlots) {
    if (!allowedSlots.has(slot)) {
      extraSlots.push(slot);
    }
  }

  const valid = missingRequired.length === 0 && extraSlots.length === 0;
  return {
    valid,
    missingRequired: missingRequired.length > 0 ? missingRequired : undefined,
    extraSlots: extraSlots.length > 0 ? extraSlots : undefined
  };
}

export class PromptManager {
  private fileStorage: FileStorage;
  private logger: ILogger;
  private promptsDir: string;
  private templateCache: Map<string, PromptTemplate>;
  private phaseTemplateCache: Map<string, string>;
  private phaseTemplateLoads: Map<string, Promise<Result<string>>>;
  private baseComponentsCache: Map<string, string>;

  constructor(
    fileStorage: FileStorage,
    logger: ILogger,
    promptsDir: string = "prompts"
  ) {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.promptsDir = promptsDir;
    this.templateCache = new Map();
    this.phaseTemplateCache = new Map();
    this.phaseTemplateLoads = new Map();
    this.baseComponentsCache = new Map();

    this.logger.debug("PromptManager", "PromptManager 初始化完成", {
      promptsDir
    });
  }

  /** 构建 prompt */
  build(taskType: TaskType, slots: Record<string, string>): string {
    try {
      // 获取任务模板 ID；Write 阶段由 buildPhasedWrite 单独加载阶段模板。
      const templateId = this.resolveTemplateId(taskType);

      // 加载模板
      const template = this.loadTemplate(templateId);

      // 验证槽位是否符合当前操作模板契约。
      const providedSlotKeys = Object.keys(slots);
      const slotValidation = validateSlots(TASK_REQUIRED_SLOTS[taskType], [], providedSlotKeys);

      if (!slotValidation.valid) {
        if (slotValidation.missingRequired && slotValidation.missingRequired.length > 0) {
          this.logger.error("PromptManager", "缺少必需槽位", undefined, {
            taskType,
            missingRequired: slotValidation.missingRequired
          });
          throw new CognitiveRazorError("E102_MISSING_FIELD", `缺少必需槽位: ${slotValidation.missingRequired.join(", ")}`, {
            taskType,
            missingRequired: slotValidation.missingRequired
          });
        }
        if (slotValidation.extraSlots && slotValidation.extraSlots.length > 0) {
          this.logger.error("PromptManager", "存在不允许的槽位", undefined, {
            taskType,
            extraSlots: slotValidation.extraSlots
          });
          throw new CognitiveRazorError("E101_INVALID_INPUT", `任务 ${taskType} 不允许使用槽位: ${slotValidation.extraSlots.join(", ")}`, {
            taskType,
            extraSlots: slotValidation.extraSlots
          });
        }
      }

          const prompt = this.renderTemplate(template.content, slots, [], `build:${taskType}`);

      this.logger.debug("PromptManager", "Prompt 构建成功", {
        taskType,
        templateId,
        promptLength: prompt.length
      });

      return prompt;
    } catch (error) {
      if (error instanceof CognitiveRazorError) {
        throw error;
      }
      this.logger.error("PromptManager", "构建 prompt 失败", error as Error, { taskType });
      throw new CognitiveRazorError("E500_INTERNAL_ERROR", "构建 prompt 失败", error);
    }
  }

  /** 获取模板 ID */
  resolveTemplateId(taskType: TaskType): string {
    return getOperationPromptTemplateKey(taskType) ?? taskType;
  }

  /** 判断模板是否已缓存（用于入队前硬校验） */
  hasTemplate(templateId: string): boolean {
    return this.templateCache.has(templateId);
  }

  /** 加载模板 */
  private loadTemplate(templateId: string): PromptTemplate {
    // 检查缓存
    if (this.templateCache.has(templateId)) {
      return this.templateCache.get(templateId)!;
    }

    this.logger.error("PromptManager", "模板未加载，请先调用 preloadTemplate", undefined, {
      templateId
    });

    throw new CognitiveRazorError(
      "E404_TEMPLATE_NOT_FOUND",
      `模板未加载: ${templateId}，请先调用 preloadTemplate 或 preloadAllTemplates`,
      { templateId }
    );
  }

  /** 预加载基础组件 */
  private async preloadBaseComponent(componentName: string): Promise<Result<string>> {
    // 检查缓存
    if (this.baseComponentsCache.has(componentName)) {
      return ok(this.baseComponentsCache.get(componentName)!);
    }

    try {
      const componentPath = `${this.promptsDir}/base/${componentName}.md`;
      const readResult = await this.fileStorage.read(componentPath);

      if (!readResult.ok) {
        this.logger.warn("PromptManager", `基础组件不存在: ${componentName}`, {
          componentPath
        });
        return readResult;
      }

      const content = readResult.value;
      this.baseComponentsCache.set(componentName, content);

      this.logger.debug("PromptManager", `基础组件已加载: ${componentName}`);
      return ok(content);
    } catch (error) {
      this.logger.error("PromptManager", "加载基础组件失败", error as Error, {
        componentName
      });
      return err("E500_INTERNAL_ERROR", "加载基础组件失败", error);
    }
  }

  /** 替换模板中的基础组件引用 */
  private async injectBaseComponents(content: string): Promise<Result<string>> {
    const components: Record<string, string> = {};
    for (const [placeholder, componentName] of Object.entries(BASE_COMPONENT_MAP)) {
      if (content.includes(placeholder)) {
        const componentResult = await this.preloadBaseComponent(componentName);
        if (componentResult.ok) {
          components[componentName] = componentResult.value;
          this.logger.debug("PromptManager", `已注入基础组件: ${componentName}`);
        } else {
          // 基础组件加载失败时返回错误，不保留未解析占位符。
          this.logger.error("PromptManager", `基础组件缺失: ${componentName}`, undefined, {
            placeholder,
            error: componentResult.error
          });
          return err("E404_TEMPLATE_NOT_FOUND", `基础组件文件缺失: ${componentName}，模板无法完整构建`);
        }
      }
    }
    const injected = injectPromptBaseComponents(content, components);
    if (injected.missingComponents.length > 0) {
      return err("E404_TEMPLATE_NOT_FOUND", `基础组件文件缺失: ${injected.missingComponents.join(", ")}，模板无法完整构建`);
    }
    return ok(injected.content);
  }

  /** 预加载模板（应在初始化时调用） */
  private async preloadTemplate(templateId: string): Promise<Result<void>> {
    try {
      const templatePath = `${this.promptsDir}/${templateId}.md`;
      const readResult = await this.fileStorage.read(templatePath);

      if (!readResult.ok) {
        this.logger.error("PromptManager", "读取模板文件失败", undefined, {
          templateId,
          templatePath,
          error: readResult.error
        });
        return readResult;
      }

      let content = readResult.value;

      // 注入基础组件
      const injectionResult = await this.injectBaseComponents(content);
      if (!injectionResult.ok) {
        return injectionResult as Result<void>;
      }
      content = injectionResult.value;

      // A-PDD-01: 验证模板结构
      const blockValidation = validateBlockOrder(content);
      if (!blockValidation.valid) {
        this.logger.error("PromptManager", "模板结构验证失败", undefined, {
          templateId,
          error: blockValidation.error
        });
        return err("E405_TEMPLATE_INVALID", blockValidation.error || "模板结构验证失败");
      }

      const template: PromptTemplate = { content };

      // 缓存模板
      this.templateCache.set(templateId, template);

      this.logger.info("PromptManager", `模板已加载: ${templateId}`, {
        templateLength: content.length,
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error("PromptManager", "预加载模板失败", error as Error, {
        templateId
      });
      return err("E500_INTERNAL_ERROR", "预加载模板失败", error);
    }
  }

  /** 预加载所有模板 */
  async preloadAllTemplates(): Promise<Result<void>> {
    const templateIds = getOperationPromptTemplateKeys();

    const errors: string[] = [];

    const results = await Promise.all(templateIds.map((templateId) => this.preloadTemplate(templateId)));
    for (let index = 0; index < templateIds.length; index++) {
      const templateId = templateIds[index];
      const result = results[index];
      if (!result.ok) {
        this.logger.error("PromptManager", `加载模板失败: ${templateId}`, undefined, {
          error: result.error,
          promptsDir: this.promptsDir
        });
        errors.push(`${templateId}: ${result.error.message}`);
        // 继续加载其他模板
      }
    }

    this.logger.info("PromptManager", "模板预加载完成", {
      loadedCount: this.templateCache.size,
      totalCount: templateIds.length,
      failedCount: errors.length
    });

    // 如果有任何模板加载失败，返回错误
    if (errors.length > 0) {
      return err("E405_TEMPLATE_INVALID", `${errors.length} 个模板加载失败: ${errors.join("; ")}`);
    }

    return ok(undefined);
  }

  /** 预加载所有基础组件 */
  async preloadAllBaseComponents(): Promise<Result<void>> {
    const componentNames = Object.values(BASE_COMPONENT_MAP);
    const errors: string[] = [];

    const results = await Promise.all(componentNames.map((componentName) => this.preloadBaseComponent(componentName)));
    for (let index = 0; index < componentNames.length; index++) {
      const componentName = componentNames[index];
      const result = results[index];
      if (!result.ok) {
        errors.push(`${componentName}: ${result.error.message}`);
      }
    }

    if (errors.length > 0) {
      this.logger.warn("PromptManager", "部分基础组件加载失败", {
        failedCount: errors.length,
        errors
      });
      // 基础组件由已加载模板直接依赖，缺失时让运行时在初始化阶段明确失败。
      return err("E405_TEMPLATE_INVALID", `${errors.length} 个基础组件加载失败: ${errors.join("; ")}`);
    }

    this.logger.info("PromptManager", "基础组件预加载完成", {
      loadedCount: this.baseComponentsCache.size,
      totalCount: componentNames.length
    });

    return ok(undefined);
  }

  /**
   * 构建分阶段 Write prompt
   * 
   * 使用 StageCatalog 声明的阶段 prompt 模板。
   * 
    * @param slots 槽位值（CTX_META, CTX_PREVIOUS, CONCEPT_TYPE）
   * @param templateContent 阶段专属模板内容
   * @returns 构建的 prompt
   */
  buildPhasedWrite(slots: Record<string, string>, templateContent: string): string {
    try {
      const slotValidation = validateSlots(PHASE_REQUIRED_SLOTS, PHASE_OPTIONAL_SLOTS, Object.keys(slots));
      if (!slotValidation.valid) {
        const missing = slotValidation.missingRequired ?? [];
        const extra = slotValidation.extraSlots ?? [];
        const detail = missing.length > 0
          ? `缺少必需槽位: ${missing.join(", ")}`
          : `存在不允许的槽位: ${extra.join(", ")}`;
        throw new CognitiveRazorError("E102_MISSING_FIELD", detail, {
          context: "buildPhasedWrite",
          missingRequired: missing,
          extraSlots: extra,
        });
      }

      const prompt = this.renderTemplate(
        templateContent,
        slots,
        PHASE_OPTIONAL_SLOTS,
        "buildPhasedWrite",
      );

      this.logger.debug("PromptManager", "分阶段 Write Prompt 构建成功", {
        promptLength: prompt.length,
      });

      return prompt;
    } catch (error) {
      if (error instanceof CognitiveRazorError) {
        throw error;
      }
      this.logger.error("PromptManager", "构建分阶段 prompt 失败", error as Error);
      throw new CognitiveRazorError("E500_INTERNAL_ERROR", "构建分阶段 prompt 失败", error);
    }
  }

  /**
   * 共享模板渲染管线：变量替换 → 可选槽位清理 → 未替换变量校验
   *
   * 统一渲染已解析模板并校验必需槽位。
   */
  private renderTemplate(
    templateContent: string,
    slots: Record<string, string>,
    optionalSlots: string[],
    context: string
  ): string {
    const rendered = renderPromptTemplate(templateContent, slots, optionalSlots);
    const unreplacedVars = rendered.unreplacedVariables;
    if (unreplacedVars.length > 0) {
      this.logger.error("PromptManager", "存在未替换的变量", undefined, {
        context,
        unreplacedVars
      });
      throw new CognitiveRazorError("E405_TEMPLATE_INVALID", `存在未替换的变量: ${unreplacedVars.join(", ")}`, {
        context,
        unreplacedVars
      });
    }

    return rendered.prompt;
  }
  /** 加载 StageCatalog 声明的分阶段 Write prompt 模板。 */
  async loadPhaseTemplate(conceptType: CRType, stageId: string): Promise<Result<string>> {
    const stage = getWriteStageDefinition(conceptType, stageId);
    if (!stage) {
      return err("E405_TEMPLATE_INVALID", `未找到 ${conceptType} 的写作阶段: ${stageId}`);
    }
    const cacheKey = `${conceptType}/${stage.id}`;
    const cached = this.phaseTemplateCache.get(cacheKey);
    if (cached !== undefined) {
      return ok(cached);
    }

    const inFlight = this.phaseTemplateLoads.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const load = this.loadPhaseTemplateFromDisk(conceptType, stage.id);
    this.phaseTemplateLoads.set(cacheKey, load);
    try {
      return await load;
    } finally {
      if (this.phaseTemplateLoads.get(cacheKey) === load) {
        this.phaseTemplateLoads.delete(cacheKey);
      }
    }
  }

  private async loadPhaseTemplateFromDisk(conceptType: CRType, stageId: string): Promise<Result<string>> {
    const templateKey = getWritePromptTemplateKey(conceptType, stageId);
    if (!templateKey) {
      return err("E405_TEMPLATE_INVALID", `未找到 ${conceptType} 的写作阶段: ${stageId}`);
    }
    const filePath = `${this.promptsDir}/${templateKey}.md`;
    const readResult = await this.fileStorage.read(filePath);
    if (!readResult.ok) {
      this.logger.error("PromptManager", `阶段 prompt 文件不存在: ${filePath}`);
      return err("E405_TEMPLATE_INVALID", `阶段 prompt 文件不存在: ${filePath}`);
    }
    const content = readResult.value;
    if (!content.trim()) {
      return err("E405_TEMPLATE_INVALID", `阶段 prompt 文件为空: ${filePath}`);
    }
    // 注入基础组件（替换 {{BASE_*}} 占位符）
    const injected = await this.injectBaseComponents(content);
    if (!injected.ok) {
      return injected as Result<string>;
    }
    const blockValidation = validateBlockOrder(injected.value);
    if (!blockValidation.valid) {
      return err("E405_TEMPLATE_INVALID", `${filePath}: ${blockValidation.error || "模板结构无效"}`);
    }
    this.phaseTemplateCache.set(`${conceptType}/${stageId}`, injected.value);
    this.logger.debug("PromptManager", `已加载阶段 prompt: ${filePath}`);
    return ok(injected.value);
  }
}
