/**
 * 提示词管理器
 * 负责加载、验证和构建提示词模板
 * 
 * 遵循设计文档 A-PDD-01 至 A-PDD-11 公理
 */

import {
  IPromptManager,
  IFileStorage,
  ILogger,
  TaskType,
  Result,
  ok,
  err
} from "../types";

/**
 * 提示词模板结构
 */
interface PromptTemplate {
  id: string;
  content: string;
  requiredSlots: string[];
  optionalSlots: string[];
}

/**
 * 必需的提示词区块（A-PDD-01 区块序公理）
 * 模板必须包含这些核心区块
 * 
 * 注意：新的模板结构使用以下区块：
 * - <system_instructions>: 系统指令和角色定义
 * - <context_slots>: 上下文槽位（变量占位符）
 * - <task_instruction> 或 <task>: 任务说明
 * - <output_schema>: 输出格式定义
 * 
 * 可选区块：
 * - <writing_style>: 写作风格指南（reason 类任务）
 * - <naming_morphology>: 命名规范（某些任务）
 * - <philosophical_core>: 哲学核心（reason 类任务）
 */
const REQUIRED_BLOCKS = [
  "<system_instructions>",
  "<context_slots>",
  "<output_schema>"
] as const;

/**
 * 任务指令区块（至少需要其中之一）
 */
const TASK_BLOCKS = [
  "<task_instruction>",
  "<task>"
] as const;

/**
 * 任务-槽位映射表（设计文档 6.2 节）
 * 定义每种任务类型允许使用的槽位
 */
const TASK_SLOT_MAPPING: Record<TaskType, { required: string[]; optional: string[] }> = {
  "embedding": {
    required: ["CTX_INPUT"],
    optional: ["CTX_LANGUAGE"]
  },
  "standardizeClassify": {
    required: ["CTX_INPUT"],
    optional: ["CTX_LANGUAGE"]
  },
  "enrich": {
    required: ["CTX_META"],
    optional: ["CTX_LANGUAGE"]
  },
  "reason:new": {
    required: ["CTX_META"],
    optional: ["CTX_SOURCES", "CTX_LANGUAGE"]
  },
  "ground": {
    required: ["CTX_META", "CTX_CURRENT"],
    optional: ["CTX_SOURCES", "CTX_LANGUAGE"]
  }
};




/**
 * 验证模板区块结构
 * 遵循 A-PDD-01：模板必须包含必需的区块
 * 
 * 新的模板结构（2025-12-09更新）：
 * - 必需区块：<system_instructions>, <context_slots>, <output_schema>
 * - 任务区块：<task_instruction> 或 <task>（至少一个）
 * - 可选区块：<writing_style>, <naming_morphology>, <philosophical_core> 等
 * 
 * @param content 模板内容
 * @returns 验证结果，包含是否有效和错误信息
 */
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

/**
 * 检测未替换的变量
 * 遵循 A-PDD-02：构建阶段所有 {{ }} 变量必须被完全替换
 * 
 * @param content 模板内容
 * @returns 未替换的变量列表
 */
function findUnreplacedVariables(content: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const unreplaced: string[] = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    unreplaced.push(match[0]);
  }

  return unreplaced;
}

/**
 * 验证槽位是否符合任务-槽位映射表
 * 遵循 A-PDD-04：每个任务只能使用映射表规定的上下文槽位组合
 * 
 * @param taskType 任务类型
 * @param providedSlots 提供的槽位
 * @returns 验证结果
 */
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

/**
 * 替换模板中的变量
 * 使用简单的字符串替换，避免正则表达式的特殊字符问题
 * 
 * @param template 模板内容
 * @param varName 变量名
 * @param value 替换值
 * @returns 替换后的内容
 */
function replaceVariable(template: string, varName: string, value: string): string {
  const placeholder = "{{" + varName + "}}";
  // 使用 split + join 替代正则表达式，避免特殊字符问题
  return template.split(placeholder).join(value);
}


export class PromptManager implements IPromptManager {
  private fileStorage: IFileStorage;
  private logger: ILogger;
  private promptsDir: string;
  private templateCache: Map<string, PromptTemplate>;

  constructor(
    fileStorage: IFileStorage,
    logger: ILogger,
    promptsDir: string = "prompts"
  ) {
    this.fileStorage = fileStorage;
    this.logger = logger;
    this.promptsDir = promptsDir;
    this.templateCache = new Map();

    this.logger.debug("PromptManager", "PromptManager 初始化完成", {
      promptsDir
    });
  }

  /**
   * 构建 prompt
   * 遵循 A-PDD-01 至 A-PDD-04 公理
   * 
   * @param taskType 任务类型
   * @param slots 上下文槽位
   * @param conceptType 知识类型（可选，用于 reason:new 任务选择正确的模板）
   * @returns 完整的 prompt
   */
  build(taskType: TaskType, slots: Record<string, string>, conceptType?: string): Result<string> {
    try {
      // 获取模板 ID（对于 reason:new 任务，根据知识类型选择模板）
      const templateId = this.resolveTemplateId(taskType, conceptType);

      // 加载模板
      const templateResult = this.loadTemplate(templateId);
      if (!templateResult.ok) {
        return templateResult as Result<string>;
      }

      const template = templateResult.value;

      // A-PDD-04: 验证槽位是否符合任务-槽位映射表
      const providedSlotKeys = Object.keys(slots);
      const slotValidation = validateSlots(taskType, providedSlotKeys);
      
      if (!slotValidation.valid) {
        if (slotValidation.missingRequired && slotValidation.missingRequired.length > 0) {
          this.logger.error("PromptManager", "缺少必需槽位", undefined, {
            taskType,
            missingRequired: slotValidation.missingRequired
          });
          return err("E002", `缺少必需槽位: ${slotValidation.missingRequired.join(", ")}`);
        }
        if (slotValidation.extraSlots && slotValidation.extraSlots.length > 0) {
          this.logger.error("PromptManager", "存在不允许的槽位", undefined, {
            taskType,
            extraSlots: slotValidation.extraSlots
          });
          return err("E002", `任务 ${taskType} 不允许使用槽位: ${slotValidation.extraSlots.join(", ")}`);
        }
      }

      // 替换变量
      let prompt = template.content;

      // 替换所有槽位
      for (const [key, value] of Object.entries(slots)) {
        prompt = replaceVariable(prompt, key, value);
      }

      // A-PDD-02: 验证是否还有未替换的变量
      const unreplacedVars = findUnreplacedVariables(prompt);
      if (unreplacedVars.length > 0) {
        this.logger.error("PromptManager", "存在未替换的变量", undefined, {
          taskType,
          unreplacedVars
        });
        return err("E002", `存在未替换的变量: ${unreplacedVars.join(", ")}`);
      }

      this.logger.debug("PromptManager", "Prompt 构建成功", {
        taskType,
        templateId,
        promptLength: prompt.length
      });

      return ok(prompt);
    } catch (error) {
      this.logger.error("PromptManager", "构建 prompt 失败", error as Error, {
        taskType
      });
      return err("E002", "构建 prompt 失败", error);
    }
  }

  /**
   * 验证模板
   * 遵循 A-PDD-01: 验证区块顺序
   * 
   * @param templateId 模板 ID
   * @returns 是否有效
   */
  validateTemplate(templateId: string): Result<boolean> {
    try {
      const templateResult = this.loadTemplate(templateId);
      if (!templateResult.ok) {
        return templateResult as Result<boolean>;
      }

      const template = templateResult.value;

      // A-PDD-01: 验证区块顺序
      const blockValidation = validateBlockOrder(template.content);
      if (!blockValidation.valid) {
        this.logger.error("PromptManager", "模板区块验证失败", undefined, {
          templateId,
          error: blockValidation.error,
          missingBlocks: blockValidation.missingBlocks
        });
        return err("E002", blockValidation.error || "模板区块验证失败");
      }

      this.logger.debug("PromptManager", "模板验证通过", {
        templateId
      });

      return ok(true);
    } catch (error) {
      this.logger.error("PromptManager", "验证模板失败", error as Error, {
        templateId
      });
      return err("E002", "验证模板失败", error);
    }
  }

  /**
   * 获取必需槽位
   * @param taskType 任务类型
   * @returns 必需槽位列表
   */
  getRequiredSlots(taskType: TaskType): string[] {
    const mapping = TASK_SLOT_MAPPING[taskType];
    return mapping ? mapping.required : [];
  }

  /**
   * 获取可选槽位
   * @param taskType 任务类型
   * @returns 可选槽位列表
   */
  getOptionalSlots(taskType: TaskType): string[] {
    const mapping = TASK_SLOT_MAPPING[taskType];
    return mapping ? mapping.optional : [];
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 获取模板 ID
   * 
   * 对于 reason:new 任务，需要根据知识类型选择对应的模板
   * 
   * @param taskType 任务类型
   * @param conceptType 知识类型（可选，用于 reason:new 任务）
   * @returns 模板 ID
   */
  resolveTemplateId(taskType: TaskType, conceptType?: string): string {
    // 将任务类型映射到模板文件名
    const mapping: Record<TaskType, string> = {
      "standardizeClassify": "standardizeClassify",
      "enrich": "enrich",
      "embedding": "embedding",
      "reason:new": "reason-domain", // 默认值，会被 conceptType 覆盖
      "ground": "ground"
    };

    // 对于 reason:new 任务，根据知识类型选择模板
    if (taskType === "reason:new" && conceptType) {
      const typeMapping: Record<string, string> = {
        "Domain": "reason-domain",
        "Issue": "reason-issue",
        "Theory": "reason-theory",
        "Entity": "reason-entity",
        "Mechanism": "reason-mechanism"
      };
      return typeMapping[conceptType] || mapping[taskType];
    }

    return mapping[taskType] || taskType;
  }

  /**
   * 判断模板是否已缓存（用于入队前硬校验）
   */
  hasTemplate(templateId: string): boolean {
    return this.templateCache.has(templateId);
  }

  /**
   * 加载模板
   */
  private loadTemplate(templateId: string): Result<PromptTemplate> {
    // 检查缓存
    if (this.templateCache.has(templateId)) {
      return ok(this.templateCache.get(templateId)!);
    }

    this.logger.error("PromptManager", "模板未加载，请先调用 preloadTemplate", undefined, {
      templateId
    });
    
    return err("E002", `模板未加载: ${templateId}，请先调用 preloadTemplate 或 preloadAllTemplates`);
  }

  /**
   * 预加载模板（应在初始化时调用）
   */
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

      const content = readResult.value;

      // A-PDD-01: 验证模板结构
      const blockValidation = validateBlockOrder(content);
      if (!blockValidation.valid) {
        this.logger.error("PromptManager", "模板结构验证失败", undefined, {
          templateId,
          error: blockValidation.error
        });
        return err("E002", blockValidation.error || "模板结构验证失败");
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
      return err("E002", "预加载模板失败", error);
    }
  }

  /**
   * 预加载所有模板
   */
  async preloadAllTemplates(): Promise<Result<void>> {
    const templateIds = [
      "standardizeClassify",
      "enrich",
      "reason-domain",
      "reason-issue",
      "reason-theory",
      "reason-entity",
      "reason-mechanism",
      "ground"
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
      return err("E002", `${errors.length} 个模板加载失败: ${errors.join("; ")}`);
    }

    return ok(undefined);
  }

  /**
   * 提取槽位
   */
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



  /**
   * 清除模板缓存（用于测试）
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * 直接设置模板（用于测试）
   */
  setTemplate(templateId: string, template: PromptTemplate): void {
    this.templateCache.set(templateId, template);
  }
}
