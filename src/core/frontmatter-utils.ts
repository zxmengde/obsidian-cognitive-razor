/**
 * Frontmatter 工具模块
 * 
 * 遵循设计文档 5.3.1 Frontmatter 模型：
 * - 必填字段：uid, type, status, created, updated
 * - 可选字段：aliases, tags, parentUid, parentType, sourceUids, version
 */

import { CRFrontmatter, CRType, NoteState } from "../types";

/**
 * 生成 frontmatter
 * 
 * @param options Frontmatter 选项
 * @returns CRFrontmatter 对象
 */
export function generateFrontmatter(options: {
  uid: string;
  type: CRType;
  status?: NoteState;
  aliases?: string[];
  tags?: string[];
  parentUid?: string;
  parentType?: CRType;
  sourceUids?: string[];
}): CRFrontmatter {
  const now = new Date().toISOString();

  return {
    uid: options.uid,
    type: options.type,
    status: options.status || "Stub",
    created: now,
    updated: now,
    aliases: options.aliases,
    tags: options.tags,
    parentUid: options.parentUid,
    parentType: options.parentType,
    sourceUids: options.sourceUids,
    version: "0.9.3"
  };
}

/**
 * 将 frontmatter 对象转换为 YAML 字符串
 * 
 * @param frontmatter Frontmatter 对象
 * @returns YAML 字符串（包含 --- 分隔符）
 */
export function frontmatterToYaml(frontmatter: CRFrontmatter): string {
  const lines: string[] = ["---"];

  // 必填字段
  lines.push(`uid: ${frontmatter.uid}`);
  lines.push(`type: ${frontmatter.type}`);
  lines.push(`status: ${frontmatter.status}`);
  lines.push(`created: ${frontmatter.created}`);
  lines.push(`updated: ${frontmatter.updated}`);

  // 可选字段
  if (frontmatter.aliases && frontmatter.aliases.length > 0) {
    lines.push("aliases:");
    for (const alias of frontmatter.aliases) {
      lines.push(`  - ${escapeYamlString(alias)}`);
    }
  }

  if (frontmatter.tags && frontmatter.tags.length > 0) {
    lines.push("tags:");
    for (const tag of frontmatter.tags) {
      lines.push(`  - ${escapeYamlString(tag)}`);
    }
  }

  if (frontmatter.parentUid) {
    lines.push(`parentUid: ${frontmatter.parentUid}`);
  }

  if (frontmatter.parentType) {
    lines.push(`parentType: ${frontmatter.parentType}`);
  }

  if (frontmatter.sourceUids && frontmatter.sourceUids.length > 0) {
    lines.push("sourceUids:");
    for (const uid of frontmatter.sourceUids) {
      lines.push(`  - ${uid}`);
    }
  }

  if (frontmatter.version) {
    lines.push(`version: ${frontmatter.version}`);
  }

  lines.push("---");
  lines.push(""); // 空行分隔 frontmatter 和内容

  return lines.join("\n");
}

/**
 * 转义 YAML 字符串
 * 
 * @param str 原始字符串
 * @returns 转义后的字符串
 */
function escapeYamlString(str: string): string {
  // 如果包含特殊字符，使用引号包裹
  if (/[:#\[\]{}|>*&!%@`]/.test(str) || str.includes('"') || str.includes("'")) {
    // 使用双引号并转义内部的双引号
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

/**
 * 从 YAML 字符串解析 frontmatter
 * 
 * 注意：这是一个简单的解析器，仅用于基本场景
 * 对于复杂的 YAML，建议使用专门的 YAML 解析库
 * 
 * @param yaml YAML 字符串
 * @returns CRFrontmatter 对象或 null
 */
export function parseFrontmatter(yaml: string): CRFrontmatter | null {
  try {
    // 移除 --- 分隔符
    const content = yaml.replace(/^---\n/, "").replace(/\n---$/, "");
    const lines = content.split("\n");

    const frontmatter: Partial<CRFrontmatter> = {};
    let currentArray: string[] | null = null;
    let currentArrayKey: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // 跳过空行和注释
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // 数组项
      if (trimmed.startsWith("- ")) {
        if (currentArray && currentArrayKey) {
          const value = trimmed.substring(2).trim();
          // 移除引号
          const unquoted = value.replace(/^["']|["']$/g, "");
          currentArray.push(unquoted);
        }
        continue;
      }

      // 键值对
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();

        // 检查是否是数组字段
        if (["aliases", "tags", "sourceUids"].includes(key)) {
          if (!value) {
            // 数组开始
            currentArrayKey = key;
            currentArray = [];
            (frontmatter as any)[key] = currentArray;
          } else {
            // 单行数组（不常见）
            currentArrayKey = null;
            currentArray = null;
          }
        } else {
          // 普通字段
          currentArrayKey = null;
          currentArray = null;
          
          if (value) {
            // 移除引号
            const unquoted = value.replace(/^["']|["']$/g, "");
            (frontmatter as any)[key] = unquoted;
          }
        }
      }
    }

    // 验证必填字段
    if (!frontmatter.uid || !frontmatter.type || !frontmatter.status || 
        !frontmatter.created || !frontmatter.updated) {
      return null;
    }

    return frontmatter as CRFrontmatter;
  } catch (error) {
    return null;
  }
}

/**
 * 从 Markdown 内容中提取 frontmatter
 * 
 * @param content Markdown 内容
 * @returns { frontmatter, body } 或 null
 */
export function extractFrontmatter(content: string): {
  frontmatter: CRFrontmatter;
  body: string;
} | null {
  // 检查是否以 --- 开头
  if (!content.startsWith("---\n")) {
    return null;
  }

  // 查找第二个 ---
  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return null;
  }

  const yamlContent = content.substring(0, endIndex + 5); // 包含 \n---\n
  const body = content.substring(endIndex + 5);

  const frontmatter = parseFrontmatter(yamlContent);
  if (!frontmatter) {
    return null;
  }

  return { frontmatter, body };
}

/**
 * 更新 Markdown 内容中的 frontmatter
 * 
 * @param content 原始 Markdown 内容
 * @param updates Frontmatter 更新
 * @returns 更新后的 Markdown 内容
 */
export function updateFrontmatter(
  content: string,
  updates: Partial<CRFrontmatter>
): string {
  const extracted = extractFrontmatter(content);
  
  if (!extracted) {
    // 没有 frontmatter，添加一个
    const newFrontmatter = generateFrontmatter({
      uid: updates.uid || "",
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
    updated: new Date().toISOString() // 总是更新时间戳
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

