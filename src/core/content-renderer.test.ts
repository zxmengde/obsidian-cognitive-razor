import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { ContentRenderer } from "./content-renderer";
import { Validator } from "../data/validator";
import { buildPhaseJsonSchema, schemaRegistry } from "./schema-registry";
import { formatStandardName } from "./naming-utils";

describe("ContentRenderer field-directed rendering", () => {
  const renderer = new ContentRenderer();

  it("supports multiple entity classification criteria while retaining the original genus/differentia format", async () => {
    const classification = [
      { classification_basis: "按结构", genus: "结构上位类", differentia: "结构特征" },
      { classification_basis: "按功能", genus: "功能上位类", differentia: "功能特征" },
    ];
    const schema = buildPhaseJsonSchema(schemaRegistry.getSchema("entity"), ["classification"]);
    const validator = new Validator();
    expect((await validator.validate(JSON.stringify({ classification }), schema)).valid).toBe(true);
    expect((await validator.validate(JSON.stringify({ classification: { genus: "原有属", differentia: "原有种差" } }), schema)).valid).toBe(true);
    const markdown = renderer.renderStructuredContentMarkdown({ type: "entity", language: "zh", content: { classification } });
    expect(markdown).toContain("### 按结构\n\n- **属**：结构上位类\n- **种差**：结构特征");
    expect(markdown).toContain("### 按功能\n\n- **属**：功能上位类\n- **种差**：功能特征");
  });

  it.each([["domain", "sub_domains"], ["issue", "sub_issues"], ["theory", "sub_theories"]] as const)("preserves custom %s classifications and validates grouped variants", async (type, field) => {
    const schema = buildPhaseJsonSchema(schemaRegistry.getSchema(type), [field]);
    const custom = { [field]: [{ name: "原有子项", description: "原有说明" }] };
    const grouped = { [field]: [{ name: "新子项", description: "分组说明", classification_basis: "按适用范围" }] };
    const validator = new Validator();
    expect((await validator.validate(JSON.stringify(custom), schema)).valid).toBe(true);
    expect((await validator.validate(JSON.stringify(grouped), schema)).valid).toBe(true);
    expect((await validator.validate(JSON.stringify({ [field]: [{ ...grouped[field][0], classification_basis: 42 }] }), schema)).valid).toBe(false);
    expect(renderer.renderStructuredContentMarkdown({ type, language: "zh", content: custom })).not.toContain("###");
    expect(renderer.renderStructuredContentMarkdown({ type, language: "zh", content: grouped })).toContain("### 按适用范围\n\n- [[新子项]]：分组说明");
  });

  it("removes tracking from generated inline citations while preserving useful query parameters, code and images", () => {
    const url = "https://example.test/source?page=7&utm_source=openai#section";
    const definition = `主张 [来源](${url})。\n\n\`[代码](${url})\`\n\n![图片](${url})`;
    const markdown = renderer.renderStructuredContentMarkdown({ type: "domain", language: "zh", content: { definition } });
    expect(markdown).toContain("主张 [来源](https://example.test/source?page=7#section)。");
    expect(markdown).toContain(`\`[代码](${url})\``);
    expect(markdown).toContain(`![图片](${url})`);
  });

  it("renders valid classification schemes as separate headings without losing cross-group links", async () => {
    const content = { sub_domains: [
      { name: "自然科学", description: "自然对象", classification_basis: "按研究对象" },
      { name: "应用科学", description: "面向实践目的", classification_basis: "按研究目的" },
      { name: "形式科学", description: "抽象结构", classification_basis: "按研究对象" },
      { name: "自然科学", description: "对象分支同样包含应用研究", classification_basis: "按研究目的" },
    ], issues: [] };
    const schema = buildPhaseJsonSchema(schemaRegistry.getSchema("domain"), ["sub_domains", "issues"]);
    expect((await new Validator().validate(JSON.stringify(content), schema)).valid).toBe(true);
    const markdown = renderer.renderStructuredContentMarkdown({ type: "domain", language: "zh", content, directoryScheme: DEFAULT_SETTINGS.directoryScheme });
    expect(markdown).toContain("### 按研究对象\n\n- [[C-知识库/1-领域/自然科学|自然科学]]：自然对象\n- [[C-知识库/1-领域/形式科学|形式科学]]：抽象结构");
    expect(markdown).toContain("### 按研究目的\n\n- [[C-知识库/1-领域/应用科学|应用科学]]：面向实践目的\n- [[C-知识库/1-领域/自然科学|自然科学]]：对象分支同样包含应用研究");
    expect(markdown.match(/^### 按研究对象$/gm)).toHaveLength(1);
    expect(markdown.match(/自然科学\]\]/g)).toHaveLength(2);
  });

  it("merges classification headings that differ only by affixes, never distinct criteria", () => {
    const content = { sub_domains: [
      { name: "甲", description: "a", classification_basis: "按研究对象" },
      { name: "乙", description: "b", classification_basis: "研究对象划分" },
      { name: "丙", description: "c", classification_basis: "按研究目的" },
      { name: "丁", description: "d", classification_basis: "按研究对象与研究目的" },
    ], issues: [] };
    const markdown = renderer.renderStructuredContentMarkdown({ type: "domain", language: "zh", content, directoryScheme: DEFAULT_SETTINGS.directoryScheme });
    expect(markdown.match(/^### /gm)).toHaveLength(3);
    expect(markdown.match(/^### 按研究对象$/gm)).toHaveLength(1);
    expect(markdown).not.toContain("### 研究对象划分");
    expect(markdown).toContain("### 按研究对象与研究目的");
  });

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
    const name = "社会科学 (Social Sciences)";
    expect(formatStandardName({ chinese: "社会科学", english: "Social Sciences" })).toBe(name);
    const markdown = new ContentRenderer().renderNoteMarkdown({
      type, title: "Parent", language: "zh", directoryScheme,
      content: { [field]: [{ name, description: "description", brief: "brief" }] },
    });
    expect(markdown).toContain(`[[${directoryScheme[target]}/${name}|${name}]]`);
    expect(markdown).not.toContain("[[社会科学]]");
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
    const options = { type: "domain" as const, title: "Parent", language: "zh", content: { issues: [{ name: "Custom", description: "old" }] } };
    expect(renderer.renderNoteMarkdown(options)).toContain("[[Custom]]：old");
    expect(renderer.renderNoteMarkdown({ ...options, directoryScheme: DEFAULT_SETTINGS.directoryScheme })).not.toContain("[[Custom]]");
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
