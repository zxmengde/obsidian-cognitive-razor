import { createHash } from "crypto";
import type { CRType } from "../types";
import { stripVerifyReport } from "./verification-report";
export { stripVerifyReport };

const MAX_SEMANTIC_INDEX_TEXT_CHARS = 12_000;

export interface SemanticIndexTextInput {
  name: string;
  type: CRType;
  aliases?: string[];
  tags?: string[];
  body?: string;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function buildSemanticIndexText(input: SemanticIndexTextInput): string {
  const name = input.name.trim();
  const aliases = uniqueNonEmpty(input.aliases ?? []).filter((alias) => alias !== name);
  const tags = uniqueNonEmpty(input.tags ?? []);
  const parts = [name];
  if (aliases.length > 0) parts.push(aliases.join("\n"));

  const suffix = [
    `类型: ${input.type}`,
    ...(tags.length > 0 ? [`标签: ${tags.join(", ")}`] : []),
  ];
  const fixedLength = [...parts, ...suffix].join("\n").length;
  const bodyBudget = Math.max(0, MAX_SEMANTIC_INDEX_TEXT_CHARS - fixedLength - 1);
  const body = stripVerifyReport(input.body ?? "").trim().slice(0, bodyBudget);
  if (body) parts.push(body);
  parts.push(...suffix);
  return parts.join("\n").slice(0, MAX_SEMANTIC_INDEX_TEXT_CHARS);
}

/** Freshness tracks only text actually sent for embedding, not report/timestamp noise. */
export function semanticIndexTextHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
