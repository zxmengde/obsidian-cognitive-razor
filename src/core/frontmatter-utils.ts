/**
 * Frontmatter 工具模块
 * 
 * 遵循设计文档 5.1 Frontmatter 约束：
 * - 必填字段：cruid, type, name, status, parents, created, updated
 * - 可选字段：definition, aliases, tags, sourceUids, version
 */

import { CRFrontmatter, CRType, NoteState } from "../types";
import YAML from "yaml";
import { formatCRTimestamp } from "../utils/date-utils";

const FRONTMATTER_DELIMITER = "---";
const REQUIRED_FIELDS: Array<keyof CRFrontmatter> = [
  "cruid",
  "type",
  "status",
  "created",
  "updated"
];
const ARRAY_FIELDS: Array<keyof CRFrontmatter> = ["aliases", "tags", "sourceUids", "parents"];

function formatYamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

const WIKILINK_REGEX = /^\[\[(.*?)\]\]$/;

function normalizeParentLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(WIKILINK_REGEX);
  const inner = (match ? match[1] : trimmed).trim();
  if (!inner) {
    return null;
  }

  // parents 字段只存储 [[Title]]：去掉 alias（|...）与 heading（#...）
  const withoutAlias = inner.split("|", 1)[0] ?? inner;
  const withoutHeading = withoutAlias.split("#", 1)[0] ?? withoutAlias;
  const withoutExt = withoutHeading.endsWith(".md")
    ? withoutHeading.slice(0, -".md".length)
    : withoutHeading;

  const title = withoutExt.trim();
  if (!title) {
    return null;
  }

  return `[[${title}]]`;
}

function normalizeParents(parents: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of parents) {
    const link = normalizeParentLink(String(item));
    if (!link) {
      continue;
    }
    if (seen.has(link)) {
      continue;
    }
    seen.add(link);
    normalized.push(link);
  }
  return normalized;
}

/**
 * 生成 frontmatter
 * 
 * @param options Frontmatter 选项
 * @returns CRFrontmatter 对象
 */
export function generateFrontmatter(options: {
  cruid: string;
  type: CRType;
  name: string;
  definition?: string;
  status?: NoteState;
  parents?: string[];
  aliases?: string[];
  tags?: string[];
  sourceUids?: string[];
  version?: string;
}): CRFrontmatter {
  const now = formatCRTimestamp();

  return {
    cruid: options.cruid,
    type: options.type,
    name: options.name,
    definition: options.definition,
    status: options.status || "Stub",
    created: now,
    updated: now,
    parents: normalizeParents(options.parents || []),
    aliases: options.aliases,
    tags: options.tags,
    sourceUids: options.sourceUids,
    version: options.version
  };
}

/**
 * 将数组格式化为单行 YAML 数组字符串
 */
function formatArrayInline(arr: string[]): string {
  if (arr.length === 0) return '[]';
  const formatted = arr.map(item => {
    // 如果包含特殊字符，需要加引号
    if (
      item.includes(" ") ||
      item.includes(",") ||
      item.includes(":") ||
      item.includes("#") ||
      item.includes("[") ||
      item.includes("]") ||
      item.includes("|")
    ) {
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
  lines.push(`cruid: ${frontmatter.cruid}`);
  lines.push(`type: ${frontmatter.type}`);
  lines.push(`name: ${formatYamlString(frontmatter.name)}`);
  if (frontmatter.definition) {
    lines.push(`definition: ${formatYamlString(frontmatter.definition)}`);
  }
  lines.push(`status: ${frontmatter.status}`);
  lines.push(`created: ${frontmatter.created}`);
  lines.push(`updated: ${frontmatter.updated}`);
  
  // 可选数组字段 - 单行格式
  if (frontmatter.aliases && frontmatter.aliases.length > 0) {
    lines.push(`aliases: ${formatArrayInline(frontmatter.aliases)}`);
  }

  const parentsValue = Array.isArray(frontmatter.parents) && frontmatter.parents.length > 0
    ? formatArrayInline(frontmatter.parents)
    : "[]";
  lines.push(`parents: ${parentsValue}`);

  if (frontmatter.tags && frontmatter.tags.length > 0) {
    lines.push(`tags: ${formatArrayInline(frontmatter.tags)}`);
  }
  
  // 其他可选字段
  if (frontmatter.sourceUids && frontmatter.sourceUids.length > 0) {
    lines.push(`sourceUids: ${formatArrayInline(frontmatter.sourceUids)}`);
  }

  if (frontmatter.version) {
    lines.push(`version: ${frontmatter.version}`);
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
    const parents = normalizeParents(normalizeStringArray(normalized.parents) || []);
    const version = normalizeOptionalString(normalized.version);
    const name = typeof normalized.name === "string" ? normalized.name : "";
    const definition = normalizeOptionalString(normalized.definition);

    const rawCruid = typeof normalized.cruid === "string"
      ? normalized.cruid
      : typeof normalized.crUid === "string"
        ? normalized.crUid
        : undefined;

    if (!rawCruid) {
      return null;
    }

    return {
      cruid: rawCruid,
      type: normalized.type as CRType,
      name,
      definition,
      status: normalized.status as NoteState,
      created: normalized.created as string,
      updated: normalized.updated as string,
      aliases,
      tags,
      parents,
      sourceUids,
      version
    };
  } catch (error) {
    return null;
  }
}

/**
 * 从 Markdown 内容中提取 frontmatter（内部使用）
 */
export function extractFrontmatter(content: string): {
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
  const now = formatCRTimestamp();
  const extracted = extractFrontmatter(content);
  
  if (!extracted) {
    // 没有 frontmatter，添加一个
    const newFrontmatter = generateFrontmatter({
      cruid: updates.cruid || "",
      type: updates.type || "Entity",
      name: updates.name || "Unnamed Concept",
      definition: updates.definition,
      parents: updates.parents || [],
      status: updates.status,
      aliases: updates.aliases,
      tags: updates.tags,
      sourceUids: updates.sourceUids,
      version: updates.version
    });
    
    return frontmatterToYaml(newFrontmatter) + content;
  }

  // 合并更新
  const merged: CRFrontmatter = {
    ...extracted.frontmatter,
    ...updates,
    parents: normalizeParents(updates.parents ?? extracted.frontmatter.parents ?? []),
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
