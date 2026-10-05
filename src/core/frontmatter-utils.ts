/**
 * Frontmatter 工具模块
 * 
 * Frontmatter 字段约束：
 * - 必填字段：cruid, type, name, status, created, updated, aliases, tags, parents
 * - 可选字段：sourceUids
 */

import { CR_TYPES } from "../types";
import type { CRFrontmatter, CRType, NoteState } from "../types";
import YAML from "yaml";
import { formatCRTimestamp } from "../utils/date-utils";
import { parseInternalNoteLink, renderParentNoteLink } from "../utils/note-links";

const FRONTMATTER_DELIMITER = "---";
const CR_TYPE_SET: ReadonlySet<string> = new Set(CR_TYPES);
const NOTE_STATES: ReadonlySet<string> = new Set(["seed", "draft", "evergreen"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function readCrType(value: string): CRType | null {
  return CR_TYPE_SET.has(value) ? value as CRType : null;
}

function readNoteState(value: string): NoteState | null {
  return NOTE_STATES.has(value) ? value as NoteState : null;
}

function formatYamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function normalizeParentLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const link = parseInternalNoteLink(trimmed);
  const inner = (link && !link.rest.trim() ? link.target : trimmed).trim();
  if (!inner) {
    return null;
  }

  // Keep one canonical internal link. Parsed Markdown paths have already
  // removed headings before decoding, so a literal encoded # stays a filename.
  const target = link ? inner : inner.split("|", 1)[0].split("#", 1)[0];
  const withoutExt = target.replace(/\.md$/i, "");

  const title = withoutExt.trim();
  if (!title) {
    return null;
  }

  return renderParentNoteLink(title);
}

export function normalizeParents(parents: string[]): string[] {
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
  status?: NoteState;
  parents?: string[];
  aliases?: string[];
  tags?: string[];
  sourceUids?: string[];
}): CRFrontmatter {
  const now = formatCRTimestamp();

  return {
    cruid: options.cruid,
    type: options.type,
    name: options.name,
    status: options.status || "draft",
    created: now,
    updated: now,
    parents: normalizeParents(options.parents || []),
    aliases: options.aliases || [],
    tags: options.tags || [],
    sourceUids: options.sourceUids,
  };
}

/**
 * 将数组格式化为单行 YAML 数组字符串
 */
function formatArrayInline(arr: string[]): string {
  if (arr.length === 0) return '[]';
  // 始终加引号，避免 YAML 把 "00"、"true" 或 "null" 解析成其他类型。
  const formatted = arr.map((item) => formatYamlString(item));
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
  lines.push(`status: ${frontmatter.status}`);
  lines.push(`created: ${frontmatter.created}`);
  lines.push(`updated: ${frontmatter.updated}`);
  
  // 必填数组字段 - 始终输出（即使为空）
  const aliasesValue = Array.isArray(frontmatter.aliases) && frontmatter.aliases.length > 0
    ? formatArrayInline(frontmatter.aliases)
    : "[]";
  lines.push(`aliases: ${aliasesValue}`);

  const tagsValue = Array.isArray(frontmatter.tags) && frontmatter.tags.length > 0
    ? formatArrayInline(frontmatter.tags)
    : "[]";
  lines.push(`tags: ${tagsValue}`);

  const parentsValue = Array.isArray(frontmatter.parents) && frontmatter.parents.length > 0
    ? formatArrayInline(frontmatter.parents)
    : "[]";
  lines.push(`parents: ${parentsValue}`);
  
  // 可选字段
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

    return parseFrontmatterDocument(YAML.parse(cleanYaml, { uniqueKeys: true }));
  } catch {
    return null;
  }
}

function parseFrontmatterDocument(value: unknown): CRFrontmatter | null {
  if (!isRecord(value)) return null;

  const cruid = readRequiredString(value, "cruid");
  const rawType = readRequiredString(value, "type");
  const name = readRequiredString(value, "name");
  const rawStatus = readRequiredString(value, "status");
  const created = readRequiredString(value, "created");
  const updated = readRequiredString(value, "updated");
  if (!cruid || !rawType || !name || !rawStatus || !created || !updated) return null;

  const type = readCrType(rawType);
  const status = readNoteState(rawStatus);
  if (!type || !status) return null;

  const aliases = readStringArray(value.aliases);
  const tags = readStringArray(value.tags);
  const rawParents = readStringArray(value.parents);
  if (!aliases || !tags || !rawParents) return null;

  const sourceUids = value.sourceUids === undefined
    ? undefined
    : readStringArray(value.sourceUids);
  if (sourceUids === null) return null;

  return {
    cruid,
    type,
    name,
    status,
    created,
    updated,
    aliases,
    tags,
    parents: normalizeParents(rawParents),
    sourceUids,
  };
}

/**
 * 从 Markdown 内容中提取 frontmatter（内部使用）
 */
export function extractFrontmatter(content: string): {
  frontmatter: CRFrontmatter;
  body: string;
} | null {
  // 兼容 CRLF：统一转换为 LF 后再处理
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 检查是否以 --- 开头
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return null;
  }

  const lines = normalized.split("\n");
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
 * Detect the one legacy form we can explain safely without accepting it.
 * Parsing remains strict: callers must never use this to normalize or rewrite
 * an existing note.
 */
export function hasUppercaseCognitiveRazorFields(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return false;
  const end = normalized.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length + 1);
  if (end < 0) return false;
  try {
    const value = YAML.parse(normalized.slice(FRONTMATTER_DELIMITER.length + 1, end), { uniqueKeys: true });
    if (!isRecord(value)) return false;
    const rawType = value.type;
    const rawStatus = value.status;
    return (typeof rawType === "string" && CR_TYPE_SET.has(rawType.toLowerCase()) && rawType !== rawType.toLowerCase())
      || (typeof rawStatus === "string" && NOTE_STATES.has(rawStatus.toLowerCase()) && rawStatus !== rawStatus.toLowerCase());
  } catch {
    return false;
  }
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
  body: string,
  originalContent?: string,
): string {
  let header = frontmatterToYaml(frontmatter);
  // CR parsing intentionally exposes only owned fields. When rewriting an
  // existing note, retain other plugins' and the user's YAML properties.
  if (originalContent) {
    const normalized = originalContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const match = /^---\n([\s\S]*?)\n[ \t]*---[ \t]*(?:\n|$)/.exec(normalized);
    if (match) {
      const original: unknown = YAML.parse(match[1], { uniqueKeys: true });
      if (isRecord(original)) {
        const owned = new Set(["cruid", "type", "name", "status", "created", "updated", "aliases", "tags", "parents", "sourceUids"]);
        const extra = Object.fromEntries(Object.entries(original).filter(([key]) => !owned.has(key)));
        if (Object.keys(extra).length > 0) {
          header = header.slice(0, -5) + YAML.stringify(extra) + "---\n\n";
        }
      }
    }
  }
  return header + body;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return [...value];
}
