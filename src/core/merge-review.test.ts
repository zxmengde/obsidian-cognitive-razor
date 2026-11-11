import { describe, expect, it } from "vitest";
import { mergeSourceBody, reviewMergeSource } from "./merge-review";

describe("merge review", () => {
  it("drops frontmatter and the plugin verification block from the compared body", () => {
    const content = "---\ncruid: a\n---\n\n正文一行。\n\n<!-- cognitive-razor:verify-report -->\n报告\n<!-- /cognitive-razor:verify-report -->\n";
    expect(mergeSourceBody(content)).toBe("正文一行。");
  });

  it("keeps reworded lines and flags content the draft dropped", () => {
    const source = "## 定义\n\n铜是一种导电性很好的金属。\n- 熔点为 1085 °C\n- 常用于电缆与印制电路板\n\n其电阻率约为 $\\rho = 1.68\\times10^{-8}$，见 [[电阻率|电阻率]] 与 https://example.org/cu。";
    const draft = "## 定义\n\n铜是导电性很好的一种金属，熔点为 1085 °C。\n\n电阻率 $\\rho = 1.68 \\times 10^{-8}$，参见 [[电阻率]]。";
    const review = reviewMergeSource(source, draft);
    const status = Object.fromEntries(review.lines.map(line => [line.text, line.status]));
    expect(status["## 定义"]).toBe("plain");
    expect(status["铜是一种导电性很好的金属。"]).toBe("kept");
    expect(status["- 熔点为 1085 °C"]).toBe("kept");
    expect(status["- 常用于电缆与印制电路板"]).toBe("missing");
    expect(review.missingLines).toBe(2);
    expect(review.missingFacts).toEqual(["https://example.org/cu"]);
  });

  it("reports numbers that disappeared even when the sentence survived", () => {
    const review = reviewMergeSource("熔点为 1085 °C，沸点为 2562 °C。", "熔点为 1085 °C，沸点很高。");
    expect(review.missingFacts).toEqual(["2562"]);
  });
});
