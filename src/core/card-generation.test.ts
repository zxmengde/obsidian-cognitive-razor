import { describe, expect, it } from "vitest";
import { captureCardInput } from "./card-generation";
import { generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";

describe("card input", () => {
  it("captures full body without YAML or managed reports and mirrors the source path", () => {
    const body = "## 事实核查报告\n用户正文\n" + "知识".repeat(7000);
    const source = generateMarkdownContent(generateFrontmatter({ cruid: "id", type: "entity", name: "测试" }), body)
      + "\n<!-- cognitive-razor:verify-report -->隐藏报告<!-- /cognitive-razor:verify-report -->";
    const result = captureCardInput("C-知识库/数学/测试.md", source, "C-知识库", "D-习题库");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.body).toBe(body);
    expect(result.value.targetPath).toBe("D-习题库/数学/测试-decks.md");
  });
});
