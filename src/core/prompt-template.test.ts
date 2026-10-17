import { describe, expect, it } from "vitest";
import { renderPromptTemplate } from "./prompt-template";

describe("renderPromptTemplate", () => {
  it("treats placeholder text in note content as data even when it names a real slot", () => {
    const rendered = renderPromptTemplate("<meta>{{CTX_META}}</meta><note>{{CTX_CURRENT}}</note>", {
      CTX_META: "A note about {{CTX_CURRENT}}",
      CTX_CURRENT: "The literal {{CTX_CURRENT}} is a template placeholder.",
    });
    expect(rendered.prompt).toBe("<meta>A note about {{CTX_CURRENT}}</meta><note>The literal {{CTX_CURRENT}} is a template placeholder.</note>");
    expect(rendered.unreplacedVariables).toEqual([]);
  });

  it("preserves mustache-like text inside substituted slot values", () => {
    const rendered = renderPromptTemplate(
      "<context>{{CTX_INPUT}}</context>",
      { CTX_INPUT: "Mustache 模板中的 {{name}} 变量插值" },
    );
    expect(rendered.unreplacedVariables).toEqual([]);
    expect(rendered.prompt).toContain("{{name}}");
  });

  it("still reports missing template placeholders", () => {
    const rendered = renderPromptTemplate(
      "<context>{{CTX_INPUT}}</context><meta>{{CTX_META}}</meta>",
      { CTX_INPUT: "ok" },
    );
    expect(rendered.unreplacedVariables).toEqual(["{{CTX_META}}"]);
  });
});
