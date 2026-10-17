import { describe, expect, it } from "vitest";
import zh from "../locales/zh.json";
import { TASK_STAGE_IDS } from "../types";
import { stageLabel } from "./stage-labels";

describe("stageLabel", () => {
  it("names the tag and verify stages", () => {
    expect(stageLabel("tag", zh)).toBe("提取标签");
    expect(stageLabel("verify", zh)).toBe("事实核查");
  });

  it("names every write stage with its full label", () => {
    expect(stageLabel("core", zh)).toBe("写作 · 核心内容");
    expect(stageLabel("narrative", zh)).toBe("写作 · 叙事与理解");
    expect(stageLabel("structure", zh)).toBe("写作 · 结构与关联");
    expect(stageLabel("process", zh)).toBe("写作 · 过程与调节");
    expect(stageLabel("synthesis", zh)).toBe("写作 · 综合理解");
  });

  it("falls back to the unknown label when a stage has no copy", () => {
    const sparse = { workbench: { stages: { tag: "T", verify: "V", unknown: "?", write: {} } } };
    expect(stageLabel("core", sparse)).toBe("?");
  });

  it("provides a real label for every stage the queue can display", () => {
    for (const stageId of TASK_STAGE_IDS) {
      expect(stageLabel(stageId, zh)).not.toBe(zh.workbench.stages.unknown);
    }
  });
});
