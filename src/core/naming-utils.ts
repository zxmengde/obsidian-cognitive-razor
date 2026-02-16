/** 命名工具：概念命名模板渲染、签名生成、文件路径生成 */

import { normalizePath } from "obsidian";
import { CRType, type ILogger } from "../types";

/** Obsidian 非法文件名字符 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** 已知占位符列表 */
const KNOWN_PLACEHOLDERS = ["chinese", "english", "type", "type_cn", "uid", "alias"];

/** 概念签名接口 */
interface ConceptSignature {
  /** 标准名（经命名模板渲染） */
  standardName: string;
  /** 别名列表 */
  aliases: string[];
  /** 核心定义摘要 */
  coreDefinition: string;
  /** 知识类型 */
  type: CRType;
}

/** 命名模板上下文 */
interface NamingTemplateContext {
  /** 中文名 */
  chinese: string;
  /** 英文名 */
  english: string;
  /** 类型 */
  type?: CRType;
  /** 类型中文名 */
  type_cn?: string;
  /** UID */
  uid?: string;
  /** 别名（第一个） */
  alias?: string;
}

/**
 * 渲染命名模板，支持 {{chinese}}, {{english}}, {{type}}, {{type_cn}}, {{uid}}, {{alias}}
 * - 已知占位符替换为上下文值（未提供时替换为空字符串）
 * - 未知占位符替换为空字符串并记录警告（需求 30.3）
 * - 输出不含 Obsidian 非法文件名字符（需求 30.2）
 */
export function renderNamingTemplate(
  template: string,
  context: NamingTemplateContext,
  logger?: ILogger
): string {
  let result = template;

  // 替换已知占位符
  result = result.replace(/\{\{chinese\}\}/g, context.chinese || "");
  result = result.replace(/\{\{english\}\}/g, context.english || "");
  result = result.replace(/\{\{type\}\}/g, context.type || "");
  result = result.replace(/\{\{type_cn\}\}/g, context.type_cn || "");
  result = result.replace(/\{\{uid\}\}/g, context.uid || "");
  result = result.replace(/\{\{alias\}\}/g, context.alias || "");

  // 处理未知占位符：替换为空字符串并记录警告（需求 30.3）
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (logger) {
      logger.warn("NamingUtils", `未定义的命名模板占位符: {{${name}}}，已替换为空字符串`, {
        placeholder: name,
        template
      });
    }
    return "";
  });

  // 清理多余的空格和括号
  result = result.replace(/\(\s*\)/g, ""); // 移除空括号
  result = result.replace(/\s+/g, " "); // 合并多个空格
  result = result.trim();

  // 移除 Obsidian 非法文件名字符（需求 30.2）
  result = result.replace(ILLEGAL_FILENAME_CHARS, "");

  // 再次清理可能因移除字符产生的多余空格
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

/** 生成概念签名文本（用于向量嵌入） */
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

/** 从标准化数据创建概念签名 */
export function createConceptSignature(
  standardizedData: {
    standardName: { chinese: string; english: string };
    aliases: string[];
    coreDefinition?: string;
  },
  type: CRType,
  namingTemplate: string = "{{chinese}} ({{english}})",
  uid?: string,
  logger?: ILogger
): ConceptSignature {
  // 渲染标准名
  const standardName = renderNamingTemplate(namingTemplate, {
    chinese: standardizedData.standardName.chinese,
    english: standardizedData.standardName.english,
    type,
    type_cn: getTypeChinese(type),
    uid,
    alias: standardizedData.aliases[0]
  }, logger);

  return {
    standardName,
    aliases: standardizedData.aliases,
    coreDefinition: standardizedData.coreDefinition || "",
    type
  };
}

/** 获取类型的中文名称 */
function getTypeChinese(type: CRType): string {
  const typeMap: Record<CRType, string> = {
    Domain: "领域",
    Issue: "议题",
    Theory: "理论",
    Entity: "实体",
    Mechanism: "机制",
  };
  return typeMap[type];
}

/** 验证命名模板 */
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
  const validPlaceholders = KNOWN_PLACEHOLDERS.map(p => `{{${p}}}`);
  const hasValidPlaceholder = validPlaceholders.some(p => template.includes(p));
  
  if (!hasValidPlaceholder) {
    errors.push("命名模板必须包含至少一个有效占位符: {{chinese}}, {{english}}, {{type}}, {{type_cn}}, {{uid}}, {{alias}}");
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
    if (!KNOWN_PLACEHOLDERS.includes(placeholder)) {
      errors.push(`无效的占位符: {{${placeholder}}}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/** 清理文件名（移除非法字符） */
export function sanitizeFileName(name: string): string {
  // 移除 Obsidian 非法文件名字符
  return name
    .replace(ILLEGAL_FILENAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 获取类型对应的目录路径 */
function getDirectoryForType(
  type: CRType,
  scheme: Record<CRType, string>
): string {
  return scheme[type] || "";
}

/** 生成文件路径，对结果调用 normalizePath() 确保路径规范化（需求 30.4） */
export function generateFilePath(
  standardName: string,
  directoryScheme: Record<CRType, string>,
  type: CRType
): string {
  const directory = getDirectoryForType(type, directoryScheme);
  const fileName = sanitizeFileName(standardName);
  
  let path: string;
  if (directory) {
    path = `${directory}/${fileName}.md`;
  } else {
    path = `${fileName}.md`;
  }

  return normalizePath(path);
}
