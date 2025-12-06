/**
 * PromptManager - 提示词模板管理器
 * 
 * 功能：
 * 1. 加载和解析提示词模板
 * 2. 槽位插值（替换模板中的占位符）
 * 3. 共享约束注入
 */

import { Result, ok, err } from "../types";

/**
 * 提示词模板
 */
export interface PromptTemplate {
  /** 模板 ID */
  id: string;
  /** 模板内容 */
  content: string;
  /** 必需的槽位 */
  requiredSlots: string[];
  /** 可选的槽位 */
  optionalSlots?: string[];
}

/**
 * 槽位值映射
 */
export type SlotValues = Record<string, string>;

/**
 * 共享约束
 */
export interface SharedConstraints {
  /** 输出格式约束 */
  outputFormat: string;
  /** 安全约束 */
  safety: string;
  /** 通用规则 */
  generalRules: string;
}

/**
 * PromptManager 配置
 */
export interface PromptManagerConfig {
  /** 模板存储路径 */
  templatePath: string;
  /** 共享约束 */
  sharedConstraints: SharedConstraints;
}

/**
 * PromptManager 类
 */
export class PromptManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private config: PromptManagerConfig;

  constructor(config: PromptManagerConfig) {
    this.config = config;
  }

  /**
   * 加载模板
   */
  loadTemplate(id: string, content: string): Result<void> {
    try {
      // 解析模板，提取槽位
      const slots = this.extractSlots(content);
      
      const template: PromptTemplate = {
        id,
        content,
        requiredSlots: slots.required,
        optionalSlots: slots.optional,
      };

      this.templates.set(id, template);
      return ok(undefined);
    } catch (error) {
      return err("TEMPLATE_LOAD_ERROR", `Failed to load template ${id}: ${error}`);
    }
  }

  /**
   * 获取模板
   */
  getTemplate(id: string): Result<PromptTemplate> {
    const template = this.templates.get(id);
    if (!template) {
      return err("TEMPLATE_NOT_FOUND", `Template ${id} not found`);
    }
    return ok(template);
  }

  /**
   * 渲染模板（插值 + 约束注入）
   */
  render(templateId: string, slots: SlotValues): Result<string> {
    const templateResult = this.getTemplate(templateId);
    if (!templateResult.ok) {
      return templateResult;
    }

    const template = templateResult.value;

    // 验证必需槽位
    const missingSlots = template.requiredSlots.filter(
      (slot) => !(slot in slots)
    );
    if (missingSlots.length > 0) {
      return err(
        "MISSING_SLOTS",
        `Missing required slots: ${missingSlots.join(", ")}`
      );
    }

    // 执行槽位插值
    let rendered = template.content;
    for (const [key, value] of Object.entries(slots)) {
      const placeholder = `{{${key}}}`;
      rendered = rendered.replace(new RegExp(placeholder, "g"), value);
    }

    // 注入共享约束
    rendered = this.injectConstraints(rendered);

    return ok(rendered);
  }

  /**
   * 提取模板中的槽位
   */
  private extractSlots(content: string): {
    required: string[];
    optional: string[];
  } {
    const slotPattern = /\{\{([^}]+)\}\}/g;
    const slots = new Set<string>();
    let match;

    while ((match = slotPattern.exec(content)) !== null) {
      const slotName = match[1].trim();
      // 移除可选标记 '?'
      const cleanName = slotName.replace(/\?$/, "");
      slots.add(cleanName);
    }

    // 区分必需和可选槽位
    const required: string[] = [];
    const optional: string[] = [];

    for (const slot of slots) {
      // 检查原始内容中是否有 '?' 标记
      if (content.includes(`{{${slot}?}}`)) {
        optional.push(slot);
      } else {
        required.push(slot);
      }
    }

    return { required, optional };
  }

  /**
   * 注入共享约束
   */
  private injectConstraints(content: string): string {
    const { outputFormat, safety, generalRules } = this.config.sharedConstraints;

    // 在内容末尾添加共享约束
    const constraints = `

## 共享约束

### 输出格式
${outputFormat}

### 安全约束
${safety}

### 通用规则
${generalRules}
`;

    return content + constraints;
  }

  /**
   * 列出所有已加载的模板
   */
  listTemplates(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * 清空所有模板
   */
  clear(): void {
    this.templates.clear();
  }
}
