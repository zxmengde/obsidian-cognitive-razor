import { describe, expect, it } from "vitest";
import { buildSemanticIndexText, stripVerifyReport } from "./semantic-index-text";

describe("semantic index text", () => {
  it("removes a complete Verify report", () => {
    const body = "正文\n\n<!-- cognitive-razor:verify-report -->\n报告\n<!-- /cognitive-razor:verify-report -->\n\n结尾";
    expect(stripVerifyReport(body)).toBe("正文\n\n结尾");
  });

  it("removes an unterminated Verify report through the end", () => {
    expect(stripVerifyReport("正文\n<!-- cognitive-razor:verify-report -->\n报告")).toBe("正文\n");
  });

  it("does not include report changes in embedding input", () => {
    const base = { name: "概念", type: "domain" as const, body: "正文\n\n结尾" };
    const withReport = { ...base, body: "正文\n\n<!-- cognitive-razor:verify-report -->\nA\n<!-- /cognitive-razor:verify-report -->\n\n结尾" };
    expect(buildSemanticIndexText(base)).toBe(buildSemanticIndexText(withReport));
  });
});
