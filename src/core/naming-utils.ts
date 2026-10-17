/** 命名工具：标准名称、签名文本和文件路径生成 */

import { normalizePath } from "obsidian";
import type { CRType } from "../types";

/** Obsidian 非法文件名字符 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const ILLEGAL_FILENAME_CHAR = /[\\/:*?"<>|]/;

/** 使用插件唯一的标准名称格式，空语言不会留下多余括号。 */
export function formatStandardName(name: { chinese: string; english: string }): string {
  const chinese = name.chinese.trim();
  const english = name.english.trim();
  if (chinese && english && chinese !== english) {
    return `${chinese} (${english})`;
  }
  return chinese || english;
}

/** True when a note title cannot be used as an Obsidian file name as-is. */
export function hasIllegalFileNameChars(name: string): boolean {
  return ILLEGAL_FILENAME_CHAR.test(name);
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

/** 生成文件路径，并通过 Obsidian 的 normalizePath() 统一路径格式。 */
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
