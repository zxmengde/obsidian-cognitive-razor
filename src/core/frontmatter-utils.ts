/**
 * Frontmatter 工具模块
 * 
 * 遵循设计文档 5.3.1 Frontmatter 模型：
 * - 必填字段：uid, type, status, created, updated
 * - 可选字段：aliases, tags, parentUid, parentType, sourceUids
 */

import { CRFrontmatter, CRType, NoteState } from "../types";
import YAML from "yaml";

const FRONTMATTER_DELIMITER = "---";
const REQUIRED_FIELDS: Array<keyof CRFrontmatter> = [
  "crUid",
  "type",
  "status",
  "created",
  "updated"
];
const ARRAY_FIELDS: Array<keyof CRFrontmatter> = ["aliases", "tags", "sourceUids"];

/**
 * 格式化日期为 yyyy-MM-DD HH:mm:ss
 */
function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 生成 frontmatter
 * 
 * @param options Frontmatter 选项
 * @returns CRFrontmatter 对象
 */
export function generateFrontmatter(options: {
  crUid: string;
  type: CRType;
  status?: NoteState;
  aliases?: string[];
  tags?: string[];
  parentUid?: string;
  parentType?: CRType;
  sourceUids?: string[];
}): CRFrontmatter {
  const now = formatDateTime(new Date());

  return {
    crUid: options.crUid,
    type: options.type,
    status: options.status || "Stub",
    created: now,
    updated: now,
    aliases: options.aliases,
    tags: options.tags,
    parentUid: options.parentUid,
    parentType: options.parentType,
    sourceUids: options.sourceUids
  };
}

/**
 * 将数组格式化为单行 YAML 数组字符串
 */
function formatArrayInline(arr: string[]): string {
  if (arr.length === 0) return '[]';
  const formatted = arr.map(item => {
    // 如果包含特殊字符，需要加引号
    if (item.includes(' ') || item.includes(',') || item.includes(':') || item.includes('#')) {
      return `"${item.replace(/"/g, '\\"')}"`;
    }
    return item;
  });
  return `[${formatted.join(', ')}]`;
}

/**
 * 将 frontmatter 对象转换为 YAML 字符串（内部使用）
 * aliases 和 tags 使用单行数组格式
 */
function frontmatterToYaml(frontmatter: CRFrontmatter): string {
  // 手动构建 YAML 字符串以确保格式正确
  const lines: string[] = [];
  
  // 必填字段按固定顺序
  lines.push(`crUid: ${frontmatter.crUid}`);
  lines.push(`type: ${frontmatter.type}`);
  lines.push(`status: ${frontmatter.status}`);
  lines.push(`created: ${frontmatter.created}`);
  lines.push(`updated: ${frontmatter.updated}`);
  
  // 可选数组字段 - 单行格式
  if (frontmatter.aliases && frontmatter.aliases.length > 0) {
    lines.push(`aliases: ${formatArrayInline(frontmatter.aliases)}`);
  }
  
  if (frontmatter.tags && frontmatter.tags.length > 0) {
    lines.push(`tags: ${formatArrayInline(frontmatter.tags)}`);
  }
  
  // 其他可选字段
  if (frontmatter.parentUid) {
    lines.push(`parentUid: ${frontmatter.parentUid}`);
  }
  
  if (frontmatter.parentType) {
    lines.push(`parentType: ${frontmatter.parentType}`);
  }
  
  if (frontmatter.sourceUids && frontmatter.sourceUids.length > 0) {
    lines.push(`sourceUids: ${formatArrayInline(frontmatter.sourceUids)}`);
  }

  return `${FRONTMATTER_DELIMITER}\n${lines.join('\n')}\n${FRONTMATTER_DELIMITER}\n\n`;
}

/**
 * 从 YAML 字符串解析 frontmatter（内部使用）
 */
function parseFrontmatter(yaml: string): CRFrontmatter | null {
  try {
    const trimmed = yaml.trim();
    const cleanYaml = trimmed.startsWith(FRONTMATTER_DELIMITER)
      ? trimmed.replace(/^---\s*/, "").replace(/\s*---$/, "")
      : trimmed;

    const document = YAML.parse(cleanYaml, { uniqueKeys: true }) as Record<string, unknown> | null;
    if (!document || typeof document !== "object") {
      return null;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(document)) {
      if (ARRAY_FIELDS.includes(key as keyof CRFrontmatter) && Array.isArray(value)) {
        normalized[key] = value.map((v) => String(v));
        continue;
      }
      normalized[key] = value;
    }

    // 验证必填字段
    for (const field of REQUIRED_FIELDS) {
      if (!normalized[field] || typeof normalized[field] !== "string") {
        return null;
      }
    }

    const aliases = normalizeStringArray(normalized.aliases);
    const tags = normalizeStringArray(normalized.tags);
    const sourceUids = normalizeStringArray(normalized.sourceUids);

    return {
      crUid: normalized.crUid as string,
      type: normalized.type as CRType,
      status: normalized.status as NoteState,
      created: normalized.created as string,
      updated: normalized.updated as string,
      aliases,
      tags,
      parentUid: normalizeOptionalString(normalized.parentUid),
      parentType: normalizeOptionalString(normalized.parentType) as CRType | undefined,
      sourceUids
    };
  } catch (error) {
    return null;
  }
}

/**
 * 从 Markdown 内容中提取 frontmatter（内部使用）
 */
function extractFrontmatter(content: string): {
  frontmatter: CRFrontmatter;
  body: string;
} | null {
  // 检查是否以 --- 开头
  if (!content.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return null;
  }

  const lines = content.split("\n");
  let endIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return null;
  }

  const yamlContent = lines.slice(0, endIndex + 1).join("\n");
  const body = lines.slice(endIndex + 1).join("\n");

  const frontmatter = parseFrontmatter(yamlContent);
  if (!frontmatter) {
    return null;
  }

  return { frontmatter, body };
}

/**
 * 更新 Markdown 内容中的 frontmatter（内部使用）
 */
function updateFrontmatter(
  content: string,
  updates: Partial<CRFrontmatter>
): string {
  const now = formatDateTime(new Date());
  const extracted = extractFrontmatter(content);
  
  if (!extracted) {
    // 没有 frontmatter，添加一个
    const newFrontmatter = generateFrontmatter({
      crUid: updates.crUid || "",
      type: updates.type || "Entity",
      status: updates.status,
      aliases: updates.aliases,
      tags: updates.tags
    });
    
    return frontmatterToYaml(newFrontmatter) + content;
  }

  // 合并更新
  const merged: CRFrontmatter = {
    ...extracted.frontmatter,
    ...updates,
    updated: now // 总是更新时间戳
  };

  return frontmatterToYaml(merged) + extracted.body;
}

/**
 * 生成完整的 Markdown 内容（frontmatter + body）
 * 
 * @param frontmatter Frontmatter 对象
 * @param body 正文内容
 * @returns 完整的 Markdown 内容
 */
export function generateMarkdownContent(
  frontmatter: CRFrontmatter,
  body: string
): string {
  return frontmatterToYaml(frontmatter) + body;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

