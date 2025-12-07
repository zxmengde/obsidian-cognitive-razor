/**
 * 命名工具模块
 * 
 * 遵循设计文档 G-10 命名规范性公理：
 * 概念命名遵循可配置模板，默认格式为 `{{chinese}} ({{english}})`
 * 
 * 遵循设计文档 A-FUNC-04 语义去重检测：
 * 概念签名 = 标准名（经命名模板渲染）+ 别名列表 + 核心定义
 */

import { CRType } from "../types";

/**
 * 概念签名接口
 * 
 * 遵循设计文档 5.3.2 概念签名模型
 */
export interface ConceptSignature {
  /** 标准名（经命名模板渲染） */
  standardName: string;
  /** 别名列表 */
  aliases: string[];
  /** 核心定义摘要 */
  coreDefinition: string;
  /** 知识类型 */
  type: CRType;
}

/**
 * 命名模板上下文
 */
export interface NamingTemplateContext {
  /** 中文名 */
  chinese: string;
  /** 英文名 */
  english: string;
  /** 类型 */
  type?: CRType;
  /** 别名（第一个） */
  alias?: string;
}

/**
 * 渲染命名模板
 * 
 * 遵循设计文档 G-10：
 * 支持的占位符：
 * - {{chinese}}: 中文名
 * - {{english}}: 英文名
 * - {{type}}: 知识类型
 * - {{alias}}: 第一个别名
 * 
 * @param template 命名模板，如 "{{chinese}} ({{english}})"
 * @param context 模板上下文
 * @returns 渲染后的名称
 */
export function renderNamingTemplate(
  template: string,
  context: NamingTemplateContext
): string {
  let result = template;

  // 替换占位符
  result = result.replace(/\{\{chinese\}\}/g, context.chinese || "");
  result = result.replace(/\{\{english\}\}/g, context.english || "");
  result = result.replace(/\{\{type\}\}/g, context.type || "");
  result = result.replace(/\{\{alias\}\}/g, context.alias || "");

  // 清理多余的空格和括号
  result = result.replace(/\(\s*\)/g, ""); // 移除空括号
  result = result.replace(/\s+/g, " "); // 合并多个空格
  result = result.trim();

  return result;
}

/**
 * 生成概念签名文本
 * 
 * 遵循设计文档 5.3.2：
 * 签名文本 = 标准名 | 别名1 | 别名2 | ... | 核心定义
 * 
 * @param signature 概念签名
 * @returns 签名文本（用于向量嵌入）
 */
export function generateSignatureText(signature: ConceptSignature): string {
  const parts: string[] = [signature.standardName];

  // 添加别名
  if (signature.aliases && signature.aliases.length > 0) {
    parts.push(...signature.aliases);
  }

  // 添加核心定义
  if (signature.coreDefinition) {
    parts.push(signature.coreDefinition);
  }

  return parts.join(" | ");
}

/**
 * 从标准化数据创建概念签名
 * 
 * @param standardizedData 标准化数据
 * @param namingTemplate 命名模板
 * @returns 概念签名
 */
export function createConceptSignature(
  standardizedData: {
    standardName: { chinese: string; english: string };
    aliases: string[];
    coreDefinition?: string;
  },
  type: CRType,
  namingTemplate: string = "{{chinese}} ({{english}})"
): ConceptSignature {
  // 渲染标准名
  const standardName = renderNamingTemplate(namingTemplate, {
    chinese: standardizedData.standardName.chinese,
    english: standardizedData.standardName.english,
    type,
    alias: standardizedData.aliases[0]
  });

  return {
    standardName,
    aliases: standardizedData.aliases,
    coreDefinition: standardizedData.coreDefinition || "",
    type
  };
}

/**
 * 验证命名模板
 * 
 * @param template 命名模板
 * @returns 验证结果
 */
export function validateNamingTemplate(template: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 检查是否为空
  if (!template || template.trim() === "") {
    errors.push("命名模板不能为空");
    return { valid: false, errors };
  }

  // 检查是否包含至少一个有效占位符
  const validPlaceholders = ["{{chinese}}", "{{english}}", "{{type}}", "{{alias}}"];
  const hasValidPlaceholder = validPlaceholders.some(p => template.includes(p));
  
  if (!hasValidPlaceholder) {
    errors.push("命名模板必须包含至少一个有效占位符: {{chinese}}, {{english}}, {{type}}, {{alias}}");
  }

  // 检查是否有未闭合的占位符
  const openBraces = (template.match(/\{\{/g) || []).length;
  const closeBraces = (template.match(/\}\}/g) || []).length;
  
  if (openBraces !== closeBraces) {
    errors.push("命名模板中存在未闭合的占位符");
  }

  // 检查是否有无效的占位符
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  let match;
  while ((match = placeholderRegex.exec(template)) !== null) {
    const placeholder = match[1];
    if (!["chinese", "english", "type", "alias"].includes(placeholder)) {
      errors.push(`无效的占位符: {{${placeholder}}}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 获取默认命名模板
 * 
 * 遵循设计文档 G-10：默认格式为 `{{chinese}} ({{english}})`
 */
export function getDefaultNamingTemplate(): string {
  return "{{chinese}} ({{english}})";
}

/**
 * 清理文件名（移除非法字符）
 * 
 * @param name 原始名称
 * @returns 清理后的文件名
 */
export function sanitizeFileName(name: string): string {
  // 移除 Windows 和 Unix 文件系统中的非法字符
  return name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 生成文件路径
 * 
 * @param standardName 标准名
 * @param directoryScheme 目录方案
 * @param type 知识类型
 * @returns 文件路径
 */
export function generateFilePath(
  standardName: string,
  directoryScheme: Record<CRType, string>,
  type: CRType
): string {
  const directory = directoryScheme[type] || "";
  const fileName = sanitizeFileName(standardName);
  
  if (directory) {
    return `${directory}/${fileName}.md`;
  }
  
  return `${fileName}.md`;
}
