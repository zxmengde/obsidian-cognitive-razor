import { describe, expect, it } from "vitest";
import { makeVerificationReportBlock } from "./verification-report";
import { locateIssue, readVerificationReport, setIssueResolved } from "./verification-issues";

const START = "<!-- cognitive-razor:verify-report -->";
const END = "<!-- /cognitive-razor:verify-report -->";
const REPORT = [
  "### 需要修改或核实的问题",
  "",
  "1. **表述过强**：“所有金属都导电”过于绝对。",
  "   - 原文位置：定义段",
  "   - 最小修正：改为“多数金属导电”。",
  "2. 「特性」一节的数值缺少来源。",
  "",
  "核查范围：未联网。",
].join("\n");

function note(presentation: "expanded" | "collapsed", body = "## 定义\n\n所有金属都导电，且电阻随温度升高。\n\n## 特性\n\n电导率为 5.9e7 S/m。"): string {
  return `---\ncruid: a\n---\n\n${body}\n\n${START}\n${makeVerificationReportBlock(REPORT, Date.UTC(2026, 10, 10), presentation)}\n${END}\n`;
}

describe("verification issues", () => {
  it.each(["expanded", "collapsed"] as const)("splits a %s report into top-level issues with continuation lines", (presentation) => {
    const report = readVerificationReport(note(presentation))!;
    expect(report.issues.map((issue) => issue.title)).toEqual(["表述过强：“所有金属都导电”过于绝对。", "「特性」一节的数值缺少来源。"]);
    expect(report.issues[0].text).toContain("原文位置：定义段");
    expect(report.issues[1].text).not.toContain("核查范围");
    expect(report.verifiedAt).toBeTruthy();
    expect(report.clean).toBe(false);
  });

  it("locates quoted text first, then a mentioned heading, outside the report", () => {
    const content = note("expanded");
    const report = readVerificationReport(content)!;
    const lines = content.split("\n");
    const first = locateIssue(content, report, report.issues[0])!;
    expect(first.kind).toBe("quote");
    expect(lines[first.line]).toContain("所有金属都导电，且");
    const second = locateIssue(content, report, report.issues[1])!;
    expect(lines[second.line]).toBe("## 特性");
    expect(locateIssue("x", report, { ...report.issues[0], text: "无线索" })).toBeNull();
  });

  it.each(["expanded", "collapsed"] as const)("toggles an issue checkbox in a %s report and refuses a changed line", (presentation) => {
    const content = note(presentation);
    const issue = readVerificationReport(content)!.issues[1];
    const done = setIssueResolved(content, issue, true)!;
    expect(readVerificationReport(done)!.issues[1].resolved).toBe(true);
    expect(done.replace("[x] ", "")).toBe(content);
    expect(readVerificationReport(setIssueResolved(done, issue, false)!)!.issues[1].resolved).toBe(false);
    expect(setIssueResolved(content.replace("一节的数值", "一节数值"), issue, true)).toBeNull();
  });

  it("recognizes a clean report and ignores notes without a report", () => {
    const clean = `${START}\n${makeVerificationReportBlock("本轮未发现需要修改的问题。")}\n${END}`;
    expect(readVerificationReport(clean)).toMatchObject({ clean: true, issues: [] });
    expect(readVerificationReport("plain note")).toBeNull();
  });
});
