/**
 * 读取笔记中插件写入的核查报告，把问题列表投影为可逐条处理的条目。
 *
 * 报告由模型按 Markdown 自由成文，这里只识别报告块内的顶层列表项：
 * 无法拆分的格式不猜测，交给界面提示用户直接查看报告。
 * 定位与勾选都以当前文件文本为准，写回前重新解析并核对原行，
 * 文本已变化时放弃写入，绝不覆盖用户的新编辑。
 */

import { VERIFY_END, VERIFY_START } from "./verification-report";
const ITEM = /^((?:\d+[.)]|[-*+])[ \t]+)(?:\[([ xX])\][ \t]+)?(.*)$/;
const CLEAN_MARK = "本轮未发现需要修改的问题";

export interface VerificationIssue {
  /** 条目标记所在的文件行（0 起，与编辑器行号一致）。 */
  line: number;
  /** 条目首行文本，用于展示与写回前核对。 */
  title: string;
  /** 条目全部文本（含续行），用于提取定位线索。 */
  text: string;
  resolved: boolean;
}

export interface VerificationReportView {
  /** 报告块起止标记所在行。 */
  startLine: number;
  endLine: number;
  verifiedAt?: string;
  issues: VerificationIssue[];
  /** 模型明确写出“本轮未发现需要修改的问题”。 */
  clean: boolean;
}

export interface IssueLocation {
  line: number;
  kind: "quote" | "heading";
}

function splitLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/);
}

function findMarkers(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.trim() === VERIFY_START);
  if (start < 0) return null;
  for (let index = start + 1; index < lines.length; index++) {
    if (lines[index].trim() === VERIFY_END) return { start, end: index };
  }
  return null;
}

/** 折叠式报告的每行带引用前缀；返回去前缀后的文本及前缀长度。 */
function unquote(line: string, callout: boolean): { text: string; prefix: number } {
  if (!callout) return { text: line, prefix: 0 };
  const match = /^>[ \t]?/.exec(line);
  return match ? { text: line.slice(match[0].length), prefix: match[0].length } : { text: line, prefix: 0 };
}

export function readVerificationReport(content: string): VerificationReportView | null {
  const lines = splitLines(content);
  const markers = findMarkers(lines);
  if (!markers) return null;
  const callout = /^>[ \t]?\[!/.test(lines[markers.start + 1] ?? "");
  const issues: VerificationIssue[] = [];
  let current: VerificationIssue | undefined;
  let fence: string | undefined;
  let verifiedAt: string | undefined;
  let clean = false;
  for (let index = markers.start + 1; index < markers.end; index++) {
    const { text } = unquote(lines[index], callout);
    const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(text);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
      if (current) current.text += `\n${text}`;
      continue;
    }
    if (fenceMatch) { fence = fenceMatch[1]; if (current) current.text += `\n${text}`; continue; }
    const time = /^>?[ \t]*核查时间[：:][ \t]*(.+)$/.exec(text);
    if (time) { verifiedAt = time[1].trim(); current = undefined; continue; }
    if (text.includes(CLEAN_MARK)) clean = true;
    if (/^#{1,6}[ \t]/.test(text) || /^\[!/.test(text)) { current = undefined; continue; }
    const item = ITEM.exec(text);
    if (item) {
      current = { line: index, title: plainTitle(item[3]), text: item[3], resolved: item[2] === "x" || item[2] === "X" };
      issues.push(current);
      continue;
    }
    // 缩进或紧随的续行属于上一条目；空行后未缩进的段落不再归属。
    if (current && text.trim()) current.text += `\n${text.trim()}`;
    else if (current && !text.trim()) {
      const next = unquote(lines[index + 1] ?? "", callout).text;
      if (!/^[ \t]+\S/.test(next)) current = undefined;
    }
  }
  return { startLine: markers.start, endLine: markers.end, verifiedAt, issues, clean: clean && issues.length === 0 };
}

function plainTitle(text: string): string {
  return text.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
}

/** 条目中以引号、书名号或反引号标出的原文片段，按长度降序。 */
export function extractQuotes(text: string): string[] {
  const quotes = new Set<string>();
  for (const pattern of [/“([^”\n]{2,200})”/g, /「([^」\n]{2,200})」/g, /『([^』\n]{2,200})』/g, /"([^"\n]{2,200})"/g, /`([^`\n]{2,200})`/g]) {
    for (const match of text.matchAll(pattern)) quotes.add(match[1].trim());
  }
  return [...quotes].filter((quote) => quote.length >= 2).sort((left, right) => right.length - left.length);
}

/**
 * 在报告之外的正文里找条目指向的位置：先找引用原文，再找被提及的小节标题。
 * 都找不到时返回 null，由界面如实提示“未能定位”。
 */
export function locateIssue(content: string, report: VerificationReportView, issue: VerificationIssue): IssueLocation | null {
  const lines = splitLines(content);
  const outside = (index: number) => index < report.startLine || index > report.endLine;
  const frontmatterEnd = lines[0] === "---" ? lines.findIndex((line, index) => index > 0 && line.trim() === "---") : -1;
  const bodyLine = (index: number) => outside(index) && index > frontmatterEnd;
  for (const quote of extractQuotes(issue.text)) {
    const index = lines.findIndex((line, lineIndex) => bodyLine(lineIndex) && line.includes(quote));
    if (index >= 0) return { line: index, kind: "quote" };
  }
  let best: { line: number; length: number } | undefined;
  lines.forEach((line, index) => {
    if (!bodyLine(index)) return;
    const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(line)?.[1]?.trim();
    if (!heading || heading.length < 2 || !issue.text.includes(heading)) return;
    if (!best || heading.length > best.length) best = { line: index, length: heading.length };
  });
  return best ? { line: best.line, kind: "heading" } : null;
}

/**
 * 勾选或取消勾选一条问题。原行与条目不一致（报告已被改动）时返回 null，
 * 调用方必须放弃写入并重新读取。
 */
export function setIssueResolved(content: string, issue: Pick<VerificationIssue, "line" | "title">, resolved: boolean): string | null {
  const report = readVerificationReport(content);
  const target = report?.issues.find((item) => item.line === issue.line);
  if (!report || !target || target.title !== issue.title) return null;
  const lines = content.split(/(\r\n|\n|\r)/);
  // split 保留换行符，偶数位是行文本。
  const lineIndex = issue.line * 2;
  const original = lines[lineIndex];
  const callout = /^>[ \t]?\[!/.test(splitLines(content)[report.startLine + 1] ?? "");
  const { text, prefix } = unquote(original, callout);
  const item = ITEM.exec(text);
  if (!item) return null;
  lines[lineIndex] = `${original.slice(0, prefix)}${item[1]}[${resolved ? "x" : " "}] ${item[3]}`;
  return lines.join("");
}
