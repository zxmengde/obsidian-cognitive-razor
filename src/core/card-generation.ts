import { err, ok, type Result } from "../types";
import type { CardPayload } from "../types/task";
import { extractFrontmatter } from "./frontmatter-utils";
import { stripVerifyReport } from "./semantic-index-text";

export const CARDS_PROMPT_VERSION = "cards-v1";

export function isSafeCardPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim()
    && !/[\\:]/.test(value) && !Array.from(value).some((char) => char.charCodeAt(0) <= 31)
    && value.split("/").every((part) => !!part && part !== "." && part !== "..");
}

export function captureCardInput(path: string, content: string, source: string, target: string): Result<CardPayload & { nodeId: string; noteTitle: string }> {
  if (![path, source, target].every(isSafeCardPath) || !path.startsWith(`${source}/`) || !path.endsWith(".md")) return err("E101_INVALID_INPUT", "源笔记必须位于配置的知识库目录内");
  const extracted = extractFrontmatter(content);
  if (!extracted) return err("E101_INVALID_INPUT", "只能为 Cognitive Razor 节点生成记忆卡片");
  const body = stripVerifyReport(extracted.body).trim();
  if (!body) return err("E101_INVALID_INPUT", "当前笔记没有可生成卡片的正文");
  const targetPath = `${target}/${path.slice(source.length + 1, -3)}-decks.md`;
  if (targetPath.toLocaleLowerCase() === path.toLocaleLowerCase()) return err("E101_INVALID_INPUT", "卡片目标不能是源笔记");
  return ok({ filePath: path, targetPath, body, noteType: extracted.frontmatter.type,
    nodeId: extracted.frontmatter.cruid, noteTitle: extracted.frontmatter.name, promptVersion: CARDS_PROMPT_VERSION });
}
