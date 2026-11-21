import { describe, expect, it } from "vitest";
import {
  repairLatexInJsonValue,
  repairLatexText,
  unwrapMarkdownCodeFence,
} from "./latex-repair";

describe("latex-repair", () => {
  it("repairs JSON control-character LaTeX escapes (\\f, \\b, \\t, \\r, inline \\n)", () => {
    const corrupted = "公式 $\\alpha + \frac{1}{2} + \beta + \theta \\cdot \times \tau + \rho \right) + \nabla x \neq 0$。";
    const result = repairLatexText(corrupted);
    expect(result.repaired).toBe(true);
    expect(result.text).toBe(
      "公式 $\\alpha + \\frac{1}{2} + \\beta + \\theta \\cdot \\times \\tau + \\rho \\right) + \\nabla x \\neq 0$。",
    );
  });

  it("converts non-Obsidian \\(...\\) and \\[...\\] math delimiters to $ and $$", () => {
    const input = "由 \\( E = mc^2 \\) 可得：\n\\[ S_{21}(f) = \\frac{V_2^-}{V_1^+} \\]\n说明结束。";
    const result = repairLatexText(input);
    expect(result.repaired).toBe(true);
    expect(result.text).toBe(
      "由 $E = mc^2$ 可得：\n$$\nS_{21}(f) = \\frac{V_2^-}{V_1^+}\n$$\n说明结束。",
    );
  });

  it("preserves inline code, fenced code blocks, and Markdown escaped brackets in links", () => {
    const input = [
      "禁止使用 `\\(`、`\\)`、`\\[`、`\\]` 定界符。",
      "参考 [期望值 E\\[X\\]](notes/Canonical.md) 与说明。",
      "```latex",
      "\\[ \\frac{a}{b} \\]",
      "```",
      "正文含 $\\text{ok}$。",
    ].join("\n");
    const result = repairLatexText(input);
    expect(result.repaired).toBe(false);
    expect(result.text).toBe(input);
  });

  it("does not alter tabs or newlines outside math blocks", () => {
    const input = "普通文本\ttext 保留制表符\nnabla 也在正文行首保持不变。";
    const result = repairLatexText(input);
    expect(result.repaired).toBe(false);
    expect(result.text).toBe(input);
  });

  it("recursively repairs JSON string fields while preserving structure and skipped keys", () => {
    const input = {
      stage: "core",
      url: "https://example.test/a",
      definition: "满足 \\( a + b = c \\) 且 $\frac{1}{2}$",
      items: [{ name: "公式", description: "含 \beta 与 $\theta$" }],
      count: 3,
    };
    const result = repairLatexInJsonValue(input);
    expect(result.repairedCount).toBe(2);
    expect(result.value).toEqual({
      stage: "core",
      url: "https://example.test/a",
      definition: "满足 $a + b = c$ 且 $\\frac{1}{2}$",
      items: [{ name: "公式", description: "含 \\beta 与 $\\theta$" }],
      count: 3,
    });
  });

  it("silently unwraps a single outer Markdown code fence without hiding invalid fences", () => {
    expect(unwrapMarkdownCodeFence("```markdown\n## 问题\n答案\n```")).toEqual({
      markdown: "## 问题\n答案",
      unwrapped: true,
    });
    expect(unwrapMarkdownCodeFence("```md\n## 问题\n\n```ts\nconst x = 1;\n```\n```")).toEqual({
      markdown: "## 问题\n\n```ts\nconst x = 1;\n```",
      unwrapped: true,
    });
    expect(unwrapMarkdownCodeFence("```json\n{\"cards\":[]}\n```")).toEqual({
      markdown: "```json\n{\"cards\":[]}\n```",
      unwrapped: false,
    });
    expect(unwrapMarkdownCodeFence("```markdown\n## 未闭合")).toEqual({
      markdown: "```markdown\n## 未闭合",
      unwrapped: false,
    });
    expect(unwrapMarkdownCodeFence("```\n块1\n```\n\n## 块外正文\n```\n块2\n```")).toEqual({
      markdown: "```\n块1\n```\n\n## 块外正文\n```\n块2\n```",
      unwrapped: false,
    });
  });
});
