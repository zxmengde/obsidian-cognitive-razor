import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CR_TYPES, type DefinePreview } from "../types/domain";
import { confirmConcept, confirmDefinePreview, isConfirmedConcept } from "./concept";

function preview(): DefinePreview {
  return {
    candidates: {
      domain: { name: { chinese: "领域", english: "domain" }, confidence: 0.9 },
      issue: { name: { chinese: "问题", english: "issue" }, confidence: 0.4 },
      theory: { name: { chinese: "理论", english: "theory" }, confidence: 0.3 },
      entity: { name: { chinese: "实体", english: "entity" }, confidence: 0.2 },
      mechanism: { name: { chinese: "机制", english: "mechanism" }, confidence: 0.1 },
    },
    coreDefinition: "  核心定义  ",
  };
}

describe("concept domain kernel", () => {
  it("turns only the selected Define candidate into a confirmed fact", () => {
    const result = confirmDefinePreview(preview(), "entity");

    expect(result).toEqual({
      ok: true,
      value: {
        type: "entity",
        name: { chinese: "实体", english: "entity" },
        coreDefinition: "核心定义",
        source: "define",
        parents: [],
      },
    });
  });

  it("normalizes duplicate parent links and preserves the explicit source", () => {
    const result = confirmConcept({
      type: "issue",
      name: { chinese: "问题", english: "" },
      coreDefinition: "说明",
      source: "hierarchical-expand",
      parents: [" [[父概念]] ", "[[父概念]]"],
    });

    expect(result).toMatchObject({
      ok: true,
      value: { source: "hierarchical-expand", parents: ["[[父概念]]"] },
    });
  });

  it("rejects an unconfirmed or malformed concept", () => {
    expect(confirmDefinePreview(preview(), "mechanism", { parents: ["父概念"] })).toMatchObject({
      ok: false,
      error: { code: "E101_INVALID_INPUT" },
    });
    expect(confirmConcept({
      type: "domain",
      name: { chinese: "", english: "" },
      source: "define",
    })).toMatchObject({ ok: false, error: { code: "E101_INVALID_INPUT" } });
    expect(isConfirmedConcept({ ...preview(), type: "domain" })).toBe(false);
  });

  it("keeps the confirmation function total for every supported type", () => {
    fc.assert(fc.property(fc.constantFrom(...CR_TYPES), (type) => {
      const result = confirmDefinePreview(preview(), type);
      return result.ok && result.value.type === type;
    }));
  });
});
