import { describe, expect, it } from "vitest";
import { ContentRenderer } from "./content-renderer";

describe("ContentRenderer field-directed rendering", () => {
  const renderer = new ContentRenderer();

  it("renders object fields from their schema field name", () => {
    const markdown = renderer.renderStructuredContentMarkdown({
      type: "entity",
      language: "zh",
      content: {
        classification: { genus: "数学对象", differentia: "描述状态" },
        composition: { has_parts: ["振幅", "相位"], part_of: "量子态" },
      },
    });

    expect(markdown).toContain("- **属**：数学对象");
    expect(markdown).toContain("- **种差**：描述状态");
    expect(markdown).toContain("- **组成部分**：振幅、相位");
    expect(markdown).toContain("- **所属系统**：量子态");
  });

  it("does not guess another renderer from an item's keys", () => {
    const markdown = renderer.renderStructuredContentMarkdown({
      type: "entity",
      language: "zh",
      content: {
        properties: [{ statement: "不应当作公理", justification: "错误形状" }],
      },
    });

    expect(markdown).not.toContain("### 公理");
    expect(markdown).toContain("## 属性");
  });
});
