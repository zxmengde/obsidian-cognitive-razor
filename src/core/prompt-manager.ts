/** 提示词管理器：加载、验证和构建提示词模板 */

import {
  ILogger,
  TaskType,
  Result,
  ok,
  err,
  CognitiveRazorError
} from "../types";
import type { FileStorage } from "../data/file-storage";

/** 提示词模板结构 */
interface PromptTemplate {
  id: string;
  content: string;
  requiredSlots: string[];
  optionalSlots: string[];
}

/** 必需的提示词区块 */
const REQUIRED_BLOCKS = [
  "<system_instructions>",
  "<context_slots>",
  "<output_schema>"
] as const;

/** 任务指令区块（至少需要其中之一） */
const TASK_BLOCKS = [
  "<task_instruction>",
  "<task>"
] as const;

/** 任务-槽位映射表：定义每种任务类型允许使用的槽位
 * 
 * 遵循设计文档 7.4 槽位契约：
 * - 通用槽位：CTX_LANGUAGE（可选；默认 Chinese）
 * - 操作模块槽位：用于 create/merge/amend
 * - 任务型模板槽位：用于现有 TaskType
 */
const TASK_SLOT_MAPPING: Record<TaskType, { required: string[]; optional: string[] }> = {
  "index": {
    required: ["CTX_INPUT"],
    optional: ["CTX_LANGUAGE"]
  },
  "define": {
    required: ["CTX_INPUT"],
    optional: ["CTX_LANGUAGE"]
  },
  "tag": {
    required: ["CTX_META"],
    optional: ["CTX_LANGUAGE"]
  },
  "write": {
    required: ["CTX_META"],
    optional: ["CTX_SOURCES", "CTX_LANGUAGE"]
  },
  "amend": {
    required: ["CTX_CURRENT", "USER_INSTRUCTION"],
    optional: ["CTX_LANGUAGE", "CONCEPT_TYPE"]
  },
  "merge": {
    required: ["SOURCE_A_NAME", "CTX_SOURCE_A", "SOURCE_B_NAME", "CTX_SOURCE_B"],
    optional: ["USER_INSTRUCTION", "CTX_LANGUAGE", "CONCEPT_TYPE"]
  },
  "verify": {
    required: ["CTX_META", "CTX_CURRENT"],
    optional: ["CTX_SOURCES", "CTX_LANGUAGE"]
  },
  "image-generate": {
    required: ["USER_PROMPT", "CONTEXT_BEFORE", "CONTEXT_AFTER"],
    optional: ["CONCEPT_TYPE", "CONCEPT_NAME", "CTX_LANGUAGE"]
  }
};

/**
 * 操作模块槽位映射（用于 Merge/Amend 等操作）
 * 
 * 遵循设计文档 7.4：
 * - Merge：必需 SOURCE_A_NAME, CTX_SOURCE_A, SOURCE_B_NAME, CTX_SOURCE_B
 * - Amend：必需 CTX_CURRENT, USER_INSTRUCTION
 */
export const OPERATION_SLOT_MAPPING: Record<string, { required: string[]; optional: string[] }> = {
  "merge": {
    required: ["SOURCE_A_NAME", "CTX_SOURCE_A", "SOURCE_B_NAME", "CTX_SOURCE_B"],
    optional: ["USER_INSTRUCTION", "CTX_LANGUAGE", "CONCEPT_TYPE"]
  },
  "amend": {
    required: ["CTX_CURRENT", "USER_INSTRUCTION"],
    optional: ["CTX_LANGUAGE", "CONCEPT_TYPE"]
  },
};




/** 验证模板区块结构 */
function validateBlockOrder(content: string): { valid: boolean; error?: string; missingBlocks?: string[] } {
  // 检查所有必需区块是否存在
  const missingBlocks: string[] = [];
  for (const block of REQUIRED_BLOCKS) {
    if (!content.includes(block)) {
      missingBlocks.push(block);
    }
  }

  if (missingBlocks.length > 0) {
    return {
      valid: false,
      error: `模板缺少必需区块: ${missingBlocks.join(", ")}`,
      missingBlocks
    };
  }

  // 检查任务区块（至少需要一个）
  const hasTaskBlock = TASK_BLOCKS.some(block => content.includes(block));
  if (!hasTaskBlock) {
    return {
      valid: false,
      error: `模板缺少任务区块，需要 ${TASK_BLOCKS.join(" 或 ")} 中的至少一个`,
      missingBlocks: [...TASK_BLOCKS]
    };
  }

  // 验证基本顺序：system_instructions 应该在最前面
  const systemPos = content.indexOf("<system_instructions>");
  const contextPos = content.indexOf("<context_slots>");
  const schemaPos = content.indexOf("<output_schema>");

  if (systemPos === -1 || contextPos === -1 || schemaPos === -1) {
    return {
      valid: false,
      error: "无法找到必需区块的位置"
    };
  }

  // system_instructions 应该在 context_slots 之前
  if (systemPos > contextPos) {
    return {
      valid: false,
      error: "<system_instructions> 应该在 <context_slots> 之前"
    };
  }

  return { valid: true };
}

/** 检测未替换的变量 */
function findUnreplacedVariables(content: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const unreplaced: string[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    unreplaced.push(match[0]);
  }

  return unreplaced;
}

/** 提取模板中引用的槽位名（去重） */
function extractPlaceholderNames(content: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const slots = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1].trim();
    if (!name) continue;
    slots.add(name);
  }

  return Array.from(slots);
}

/** 验证槽位是否符合任务-槽位映射表 */
function validateSlots(
  taskType: TaskType,
  providedSlots: string[]
): { valid: boolean; missingRequired?: string[]; extraSlots?: string[] } {
  const mapping = TASK_SLOT_MAPPING[taskType];
  if (!mapping) {
    return { valid: false, extraSlots: providedSlots };
  }

  // 允许的槽位包括：必需槽位 + 可选槽位
  const allowedSlots = new Set([...mapping.required, ...mapping.optional]);
  const missingRequired: string[] = [];
  const extraSlots: string[] = [];

  // 检查必需槽位
  for (const required of mapping.required) {
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

/** 替换模板中的变量 */
function replaceVariable(template: string, varName: string, value: string): string {
  const placeholder = "{{" + varName + "}}";
  // 使用 split + join 替代正则表达式，避免特殊字符问题
  return template.split(placeholder).join(value);
}


export class PromptManager {
  private fileStorage: FileStorage;
  private logger: ILogger;
  private promptsDir: string;
  private templateCache: Map<string, PromptTemplate>;
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
    this.baseComponentsCache = new Map();

    this.logger.debug("PromptManager", "PromptManager 初始化完成", {
      promptsDir
    });
  }

  /** 构建 prompt */
  build(taskType: TaskType, slots: Record<string, string>, conceptType?: string): string {
    try {
      // 获取模板 ID（对于 write 任务，根据知识类型选择模板）
      const templateId = this.resolveTemplateId(taskType, conceptType);

      // 加载模板
      const template = this.loadTemplate(templateId);

      // A-PDD-04: 验证槽位是否符合任务-槽位映射表
      const providedSlotKeys = Object.keys(slots);
      const slotValidation = validateSlots(taskType, providedSlotKeys);
      
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

      // 替换变量
      let prompt = template.content;

      // 替换所有槽位
      for (const [key, value] of Object.entries(slots)) {
        prompt = replaceVariable(prompt, key, value);
      }

      // 可选槽位未提供时按空字符串处理（避免模板中出现可选占位符导致构建失败）
      const slotMapping = TASK_SLOT_MAPPING[taskType];
      if (slotMapping) {
        for (const optionalKey of slotMapping.optional) {
          if (!(optionalKey in slots)) {
            prompt = replaceVariable(prompt, optionalKey, "");
          }
        }
      }

      // A-PDD-02: 验证是否还有未替换的变量
      const unreplacedVars = findUnreplacedVariables(prompt);
      if (unreplacedVars.length > 0) {
        this.logger.error("PromptManager", "存在未替换的变量", undefined, {
          taskType,
          unreplacedVars
        });
        throw new CognitiveRazorError("E405_TEMPLATE_INVALID", `存在未替换的变量: ${unreplacedVars.join(", ")}`, {
          taskType,
          unreplacedVars
        });
      }

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

  /** 验证模板 */
  validateTemplate(templateId: string): boolean {
    try {
      const template = this.loadTemplate(templateId);

      // A-PDD-01: 验证区块顺序
      const blockValidation = validateBlockOrder(template.content);
      if (!blockValidation.valid) {
        this.logger.error("PromptManager", "模板区块验证失败", undefined, {
          templateId,
          error: blockValidation.error,
          missingBlocks: blockValidation.missingBlocks
        });
        throw new CognitiveRazorError("E405_TEMPLATE_INVALID", blockValidation.error || "模板区块验证失败", {
          templateId,
          missingBlocks: blockValidation.missingBlocks
        });
      }

      this.logger.debug("PromptManager", "模板验证通过", {
        templateId
      });

      return true;
    } catch (error) {
      if (error instanceof CognitiveRazorError) {
        throw error;
      }
      this.logger.error("PromptManager", "验证模板失败", error as Error, { templateId });
      throw new CognitiveRazorError("E500_INTERNAL_ERROR", "验证模板失败", error);
    }
  }

  /** 获取必需槽位 */
  getRequiredSlots(taskType: TaskType): string[] {
    const mapping = TASK_SLOT_MAPPING[taskType];
    return mapping ? mapping.required : [];
  }

  /** 获取可选槽位 */
  getOptionalSlots(taskType: TaskType): string[] {
    const mapping = TASK_SLOT_MAPPING[taskType];
    return mapping ? mapping.optional : [];
  }

  /** 获取模板 ID（对于 write 任务，根据知识类型选择模板） */
  resolveTemplateId(taskType: TaskType, conceptType?: string): string {
    // 将任务类型映射到模板文件名
    const mapping: Record<TaskType, string> = {
      "define": "_base/operations/define",
      "tag": "_base/operations/tag",
      "index": "index",
      "write": "_type/entity-core", // 默认值，会被 conceptType 覆盖
      "amend": "_base/operations/amend",
      "merge": "_base/operations/merge",
      "verify": "_base/operations/verify",
      "image-generate": "visualize"
    };

    // 对于 write 任务，根据知识类型选择模板
    if (taskType === "write" && conceptType) {
      const typeMapping: Record<string, string> = {
        "Domain": "_type/domain-core",
        "Issue": "_type/issue-core",
        "Theory": "_type/theory-core",
        "Entity": "_type/entity-core",
        "Mechanism": "_type/mechanism-core"
      };
      return typeMapping[conceptType] || mapping[taskType];
    }

    return mapping[taskType] || taskType;
  }

  /** 判断模板是否已缓存（用于入队前硬校验） */
  hasTemplate(templateId: string): boolean {
    return this.templateCache.has(templateId);
  }

  /**
   * 构建操作 prompt（用于 Merge/Amend 等操作）
   * 
   * 遵循设计文档 7.4：使用操作模块槽位映射
   * 
   * @param operation 操作类型：merge | amend
   * @param slots 槽位值
   * @returns 构建的 prompt
   */
  buildOperation(operation: string, slots: Record<string, string>): string {
    try {
      const slotMapping = OPERATION_SLOT_MAPPING[operation];
      if (!slotMapping) {
        throw new CognitiveRazorError("E101_INVALID_INPUT", `不支持的操作类型: ${operation}`);
      }

      // 加载操作模板（遵循路线图：prompts/_base/operations/<operation>.md）
      const templateId = `_base/operations/${operation}`;
      const template = this.loadTemplate(templateId);

      // 1) 先按契约校验传入槽位是否合法（缺少必需/包含额外）
      const allowedSlots = new Set([...slotMapping.required, ...slotMapping.optional]);
      const missingRequired = slotMapping.required.filter((slot) => !(slot in slots));
      if (missingRequired.length > 0) {
        throw new CognitiveRazorError("E102_MISSING_FIELD", `缺少必需槽位: ${missingRequired.join(", ")}`);
      }

      const extraProvided = Object.keys(slots).filter((slot) => !allowedSlots.has(slot));
      if (extraProvided.length > 0) {
        throw new CognitiveRazorError("E101_INVALID_INPUT", `操作 ${operation} 不支持槽位: ${extraProvided.join(", ")}`);
      }

      // 2) 模板自身的占位符也必须全部被填充，且不允许未知占位符
      const templateSlots = extractPlaceholderNames(template.content);
      const unknownTemplateSlots = templateSlots.filter((slot) => !allowedSlots.has(slot));
      if (unknownTemplateSlots.length > 0) {
        throw new CognitiveRazorError("E405_TEMPLATE_INVALID", `模板存在未声明的槽位: ${unknownTemplateSlots.join(", ")}`);
      }

      // 替换变量
      let prompt = template.content;
      for (const [key, value] of Object.entries(slots)) {
        prompt = replaceVariable(prompt, key, value);
      }

      // 可选槽位未提供时按空字符串处理
      for (const optionalKey of slotMapping.optional) {
        if (!(optionalKey in slots)) {
          prompt = replaceVariable(prompt, optionalKey, "");
        }
      }

      // 验证是否还有未替换的变量
      const unreplacedVars = findUnreplacedVariables(prompt);
      if (unreplacedVars.length > 0) {
        this.logger.error("PromptManager", "操作存在未替换的变量", undefined, {
          operation,
          unreplacedVars
        });
        throw new CognitiveRazorError("E405_TEMPLATE_INVALID", `存在未替换的占位符: ${unreplacedVars[0]}`, {
          operation,
          unreplacedVars
        });
      }

      this.logger.debug("PromptManager", "操作 Prompt 构建成功", {
        operation,
        promptLength: prompt.length
      });

      return prompt;
    } catch (error) {
      if (error instanceof CognitiveRazorError) {
        throw error;
      }
      this.logger.error("PromptManager", "构建操作 prompt 失败", error as Error, { operation });
      throw new CognitiveRazorError("E500_INTERNAL_ERROR", "构建操作 prompt 失败", error);
    }
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
      const componentPath = `${this.promptsDir}/_base/${componentName}.md`;
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
    let processedContent = content;
    const componentMapping: Record<string, string> = {
      "{{BASE_WRITING_STYLE}}": "writing-style",
      "{{BASE_ANTI_PATTERNS}}": "anti-patterns",
      "{{BASE_TERMINOLOGY}}": "terminology",
      "{{BASE_OUTPUT_FORMAT}}": "output-format"
    };

    for (const [placeholder, componentName] of Object.entries(componentMapping)) {
      if (processedContent.includes(placeholder)) {
        const componentResult = await this.preloadBaseComponent(componentName);
        
        if (componentResult.ok) {
          processedContent = processedContent.split(placeholder).join(componentResult.value);
          this.logger.debug("PromptManager", `已注入基础组件: ${componentName}`);
        } else {
          // 基础组件加载失败时返回错误，不保留未解析占位符（需求 32.4）
          this.logger.error("PromptManager", `基础组件缺失: ${componentName}`, undefined, {
            placeholder,
            error: componentResult.error
          });
          return err("E404_TEMPLATE_NOT_FOUND", `基础组件文件缺失: ${componentName}，模板无法完整构建`);
        }
      }
    }

    return ok(processedContent);
  }

  /** 注入操作区块（用于 _type/*-core.md 的 {{OPERATION_BLOCK}}） */
  private async injectOperationBlockIfPresent(templateId: string, content: string): Promise<Result<string>> {
    if (!content.includes("{{OPERATION_BLOCK}}")) {
      return ok(content);
    }

    // 当前约定：_type/*-core 仅用于 write 任务，统一注入 write 操作区块
    if (!templateId.startsWith("_type/")) {
      return err("E405_TEMPLATE_INVALID", `模板 ${templateId} 包含 OPERATION_BLOCK，但未定义注入规则`);
    }

    const operationBlockId = "_base/operations/write";
    const operationBlockPath = `${this.promptsDir}/${operationBlockId}.md`;
    const readResult = await this.fileStorage.read(operationBlockPath);
    if (!readResult.ok) {
      return readResult;
    }

    const injected = await this.injectBaseComponents(readResult.value);
    if (!injected.ok) {
      return injected;
    }

    const next = content.split("{{OPERATION_BLOCK}}").join(injected.value);
    return ok(next);
  }

  /** 预加载模板（应在初始化时调用） */
  async preloadTemplate(templateId: string): Promise<Result<void>> {
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

      // 注入操作区块（如 _type/*-core.md 的 {{OPERATION_BLOCK}}）
      const operationInjection = await this.injectOperationBlockIfPresent(templateId, content);
      if (!operationInjection.ok) {
        return operationInjection as Result<void>;
      }
      content = operationInjection.value;

      // A-PDD-01: 验证模板结构
      const blockValidation = validateBlockOrder(content);
      if (!blockValidation.valid) {
        this.logger.error("PromptManager", "模板结构验证失败", undefined, {
          templateId,
          error: blockValidation.error
        });
        return err("E405_TEMPLATE_INVALID", blockValidation.error || "模板结构验证失败");
      }

      // 提取槽位
      const slots = this.extractSlots(content);

      // 创建模板对象
      const template: PromptTemplate = {
        id: templateId,
        content,
        requiredSlots: slots.required,
        optionalSlots: slots.optional
      };

      // 缓存模板
      this.templateCache.set(templateId, template);

      this.logger.info("PromptManager", `模板已加载: ${templateId}`, {
        requiredSlots: slots.required.length,
        optionalSlots: slots.optional.length
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
    const templateIds = [
      "_base/operations/define",
      "_base/operations/tag",
      "_base/operations/verify",
      "_type/domain-core",
      "_type/issue-core",
      "_type/theory-core",
      "_type/entity-core",
      "_type/mechanism-core",
      "_base/operations/merge",
      "_base/operations/amend",
      "visualize"
    ];

    const errors: string[] = [];

    for (const templateId of templateIds) {
      const result = await this.preloadTemplate(templateId);
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

  /** 提取槽位 */
  private extractSlots(content: string): { required: string[]; optional: string[] } {
    const allSlots = new Set<string>();
    const regex = /\{\{([^}]+)\}\}/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const slotName = match[1].trim();
      // 排除特殊变量（如 previous_errors, raw_user_input 等模板内部变量）
      if (slotName.startsWith("CTX_") || slotName === "SHARED_CONSTRAINTS") {
        allSlots.add(slotName);
      }
    }

    // 简化实现：所有 CTX_ 开头的槽位都视为必需
    return {
      required: Array.from(allSlots).filter(s => s.startsWith("CTX_")),
      optional: []
    };
  }



  /** 预加载所有基础组件 */
  async preloadAllBaseComponents(): Promise<Result<void>> {
    const componentNames = ["writing-style", "anti-patterns", "terminology", "output-format"];
    const errors: string[] = [];

    for (const componentName of componentNames) {
      const result = await this.preloadBaseComponent(componentName);
      if (!result.ok) {
        errors.push(`${componentName}: ${result.error.message}`);
      }
    }

    if (errors.length > 0) {
      this.logger.warn("PromptManager", "部分基础组件加载失败", {
        failedCount: errors.length,
        errors
      });
      // 不返回错误，因为基础组件是可选的
    }

    this.logger.info("PromptManager", "基础组件预加载完成", {
      loadedCount: this.baseComponentsCache.size,
      totalCount: componentNames.length
    });

    return ok(undefined);
  }

  /** 清除模板缓存（用于测试） */
  clearCache(): void {
    this.templateCache.clear();
    this.baseComponentsCache.clear();
  }

  /** 直接设置模板（用于测试） */
  setTemplate(templateId: string, template: PromptTemplate): void {
    this.templateCache.set(templateId, template);
  }
}
