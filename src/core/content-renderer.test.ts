import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../data/settings-store";
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
    expect(markdown).not.toContain("### 前提");
    expect(markdown).toContain("## 属性");
  });
});


describe("ContentRenderer typed forward links", () => {
  const directoryScheme = { domain: "01 Domains", issue: "02 Issues", theory: "03 Theories", entity: "04 Entities", mechanism: "05 Mechanisms" };
  it.each([
    ["domain", "sub_domains", "domain"], ["domain", "issues", "issue"],
    ["issue", "sub_issues", "issue"], ["issue", "theories", "theory"],
    ["theory", "sub_theories", "theory"], ["theory", "entities", "entity"], ["theory", "mechanisms", "mechanism"],
  ] as const)("qualifies %s.%s links with the %s directory", (type, field, target) => {
    const markdown = new ContentRenderer().renderNoteMarkdown({
      type, title: "Parent", language: "zh", directoryScheme,
      content: { [field]: [{ name: "Same Name", description: "description", brief: "brief" }] },
    });
    expect(markdown).toContain(`[[${directoryScheme[target]}/Same Name|Same Name]]`);
    expect(markdown).not.toContain("[[Same Name]]");
  });

  it("keeps same-name entity and mechanism targets distinct and applies file-name sanitization", () => {
    const markdown = new ContentRenderer().renderNoteMarkdown({
      type: "theory", title: "Parent", language: "zh", directoryScheme,
      content: { entities: [{ name: "A:B" }], mechanisms: [{ name: "A:B" }] },
    });
    expect(markdown).toContain("[[04 Entities/AB|A:B]]");
    expect(markdown).toContain("[[05 Mechanisms/AB|A:B]]");
  });

  it("retains bare-link rendering when an old artifact has no directory snapshot", () => {
    const renderer = new ContentRenderer();
    const options = { type: "domain" as const, title: "Parent", language: "zh", content: { issues: [{ name: "Legacy", description: "old" }] } };
    expect(renderer.renderNoteMarkdown(options)).toContain("[[Legacy]]：old");
    expect(renderer.renderNoteMarkdown({ ...options, directoryScheme: DEFAULT_SETTINGS.directoryScheme })).not.toContain("[[Legacy]]");
  });
});

describe("ContentRenderer premise and missing composition wording", () => {
  const renderer = new ContentRenderer();

  it("renders theory axioms as premises without changing the schema field", () => {
    const content = { axioms: [{ statement: "适用假设", justification: "说明" }] };
    const markdown = renderer.renderStructuredContentMarkdown({ type: "theory", language: "zh", content });
    expect(markdown).toContain("## 前提\n### 前提 1：适用假设\n- **理由**：说明");
    expect(markdown).not.toContain("公理");
    expect(renderer.renderStructuredContentMarkdown({ type: "theory", language: "en", content })).toContain("## axioms");
  });

  it.each([
    { has_parts: [], part_of: "" },
    { has_parts: ["", " ", "\t"], part_of: " \n" },
    {},
  ])("distinguishes unspecified composition from an explicit absence: %j", (composition) => {
    const markdown = renderer.renderStructuredContentMarkdown({ type: "entity", language: "zh", content: { composition } });
    expect(markdown).toContain("- **组成部分**：未提供\n- **所属系统**：未提供");
  });

  it.each(["无", "不适用"])("retains explicitly supplied composition %s", (value) => {
    const markdown = renderer.renderStructuredContentMarkdown({ type: "entity", language: "zh", content: { composition: { has_parts: [value], part_of: value } } });
    expect(markdown).toContain(`- **组成部分**：${value}\n- **所属系统**：${value}`);
  });
});
