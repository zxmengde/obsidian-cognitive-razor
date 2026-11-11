/**
 * 合并稿对照：找出源笔记中在合并稿里可能丢失的内容。
 *
 * 模型会改写句子，逐行 diff 几乎每行都不同，没有参考价值。
 * 这里改为问"这一行的内容还在不在"：按字符二元组覆盖率判断段落，
 * 数值、公式、链接和网址必须原样出现。结果只用于提示人工复核，不阻止合并。
 */
import { stripVerifyReport } from "./verification-report";

export type MergeLineStatus = "kept" | "missing" | "plain";

export interface MergeReviewLine {
  text: string;
  status: MergeLineStatus;
}

export interface MergeSourceReview {
  lines: MergeReviewLine[];
  missingLines: number;
  /** 源笔记中出现、合并稿中找不到的数值、公式、链接与网址。 */
  missingFacts: string[];
}

/** 低于这一覆盖率的段落标为可能丢失。 */
const COVERAGE_THRESHOLD = 0.6;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const STRUCTURE_ONLY = /^(?:#{1,6}\s|```|~~~|\$\$\s*$|[-*_]{3,}\s*$|\|?[\s:|-]+\|[\s:|-]*$)/;
// 网址止于空白、括号或全角标点；结尾的半角标点属于句子。
const URL_PATTERN = /https?:\/\/[^\s)>\]\u3000-\u303f\uff00-\uffef]+/g;
const LIST_MARKER = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** 合并时实际参与对照的正文：去掉 frontmatter 与插件核查报告。 */
export function mergeSourceBody(content: string): string {
  return stripVerifyReport(content.replace(FRONTMATTER, "")).trim();
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s*_`#>|[\]()~=\-—–,，.。:：;；!！?？、"'“”‘’「」『』《》（）]/g, "");
}

function bigrams(text: string): string[] {
  if (text.length < 2) return text ? [text] : [];
  const result: string[] = [];
  for (let i = 0; i < text.length - 1; i++) result.push(text.slice(i, i + 2));
  return result;
}

function facts(text: string): Array<{ label: string; key: string }> {
  const found: Array<{ label: string; key: string }> = [];
  const formulas = text.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g) ?? [];
  for (const formula of formulas) found.push({ label: formula, key: formula.replace(/\s+/g, "") });
  const withoutFormulas = formulas.reduce((rest, formula) => rest.replace(formula, " "), text);
  for (const match of withoutFormulas.match(URL_PATTERN) ?? []) {
    const url = match.replace(/[.,;:!?]+$/, "");
    found.push({ label: url, key: url });
  }
  for (const link of withoutFormulas.match(/\[\[[^\]\n]+\]\]/g) ?? []) {
    const target = link.slice(2, -2).split(/[|#]/)[0].trim();
    if (target) found.push({ label: link, key: `[[${target.toLowerCase()}` });
  }
  const prose = withoutFormulas.replace(/https?:\/\/[^\s)>\]]+|\[\[[^\]\n]+\]\]/g, " ").replace(/^\s*\d+[.)]\s/gm, " ");
  for (const number of prose.match(/\d+(?:[.,]\d+)*(?:[eE][-+]?\d+)?%?/g) ?? []) {
    // 单个数字多为序号或计数词，噪声大于价值。
    if (number.replace(/\D/g, "").length >= 2) found.push({ label: number, key: number });
  }
  return found;
}

function draftHasFact(draft: { compact: string; lower: string }, key: string): boolean {
  if (key.startsWith("[[")) return draft.lower.includes(key);
  return draft.compact.includes(key);
}

export function reviewMergeSource(sourceBody: string, draftBody: string): MergeSourceReview {
  const normalizedDraft = normalize(draftBody);
  const draftPairs = new Set(bigrams(normalizedDraft));
  const draftLower = draftBody.toLowerCase().replace(/\[\[\s+/g, "[[");
  const draft = { compact: draftBody.replace(/\s+/g, ""), lower: draftLower };
  let inFence = false;
  let missingLines = 0;
  const lines = sourceBody.split(/\r?\n/).map((text): MergeReviewLine => {
    const trimmed = text.trim();
    if (/^(?:```|~~~)/.test(trimmed)) inFence = !inFence;
    if (!trimmed || STRUCTURE_ONLY.test(trimmed)) return { text, status: "plain" };
    const content = normalize(inFence ? trimmed : trimmed.replace(LIST_MARKER, ""));
    if (content.length < 2) return { text, status: "plain" };
    const pairs = bigrams(content);
    const hits = pairs.filter(pair => draftPairs.has(pair)).length;
    const kept = normalizedDraft.includes(content) || hits / pairs.length >= COVERAGE_THRESHOLD;
    if (!kept) missingLines++;
    return { text, status: kept ? "kept" : "missing" };
  });
  const missingFacts = [...new Map(facts(sourceBody)
    .filter(fact => !draftHasFact(draft, fact.key))
    .map(fact => [fact.key, fact.label])).values()];
  return { lines, missingLines, missingFacts };
}
