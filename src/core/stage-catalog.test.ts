import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import zhLocale from "../locales/zh.json";
import { CR_TYPES, TASK_STAGE_IDS } from "../types";
import {
  STAGE_CATALOG,
  getStageDefinition,
  getStageIdsForType,
  getStageRole,
  getWriteStageDefinitions,
} from "./stage-catalog";
import { PROJECTION_CATALOG } from "./projection-catalog";
import { schemaRegistry } from "./schema-registry";

function readLocaleKey(key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[part];
  }, zhLocale);
}

describe("StageCatalog contract", () => {
  it("declares a complete stage contract for every supported type", () => {
    const seen = new Set<string>();

    for (const stage of STAGE_CATALOG) {
      for (const type of stage.conceptTypes) {
        const key = `${type}:${stage.id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(getStageDefinition(type, stage.id)).toBeDefined();
      }

      expect(stage.labelKey).toMatch(/^workbench\.stages\./);
      expect(stage.shortLabelKey).toMatch(/^workbench\.stages\./);
      expect(readLocaleKey(stage.labelKey)).toEqual(expect.any(String));
      expect(readLocaleKey(stage.shortLabelKey)).toEqual(expect.any(String));
      expect(stage.promptTemplateKey).toMatch(/^[^/]+\/[^/]+/);
      expect(existsSync(resolve(process.cwd(), "prompts", `${stage.promptTemplateKey}.md`))).toBe(true);
      expect(stage.outputSchemaKey).toBeTruthy();
      expect(["frontmatter", "content", "report"]).toContain(stage.commitPolicy);

      for (const type of stage.conceptTypes) {
        const schema = schemaRegistry.getSchema(type);
        for (const field of stage.fields) {
          expect(schema.properties?.[field]).toBeDefined();
        }
      }
    }

    expect(seen.size).toBeGreaterThan(0);
  });

  it("derives every stage role from the catalog", () => {
    expect(getStageRole("cards")).toBe("cards");
    expect(getStageRole("merge")).toBe("merge");
    for (const stageId of TASK_STAGE_IDS.filter((id) => id !== "cards" && id !== "merge")) {
      const roles = [...new Set(STAGE_CATALOG
        .filter((stage) => stage.id === stageId)
        .map((stage) => stage.role))];

      expect(roles).toHaveLength(1);
      expect(getStageRole(stageId)).toBe(roles[0]);
    }
  });

  it("keeps write stages ordered and complete without a second phase table", () => {
    for (const type of CR_TYPES) {
      const stages = getWriteStageDefinitions(type);
      expect(stages.length).toBeGreaterThan(0);
      expect(stages.map((stage) => stage.id)).toEqual(getStageIdsForType(type).filter((id) => !["tag", "verify"].includes(id)));
      expect(stages.map((stage) => stage.order)).toEqual([...stages].sort((left, right) => left.order - right.order).map((stage) => stage.order));
      expect(getStageIdsForType(type)[0]).toBe("tag");
      expect(getStageIdsForType(type).at(-1)).toBe("verify");
    }
  });

  it("tells the entity schema to separate inapplicable composition from missing evidence", () => {
    const composition = schemaRegistry.getSchema("entity").properties?.composition;
    const partOf = composition && typeof composition === "object" && "properties" in composition
      ? (composition.properties as Record<string, { description?: string }>).part_of?.description
      : undefined;
    expect(partOf).toContain("按知识类型确实不适用时写“不适用”");
    expect(partOf).toContain("材料不足时写“目前依据不足”或“待核实”");
    expect(partOf).not.toContain("不适用或未知");
  });

  it("keeps derived projections outside the workflow stage identity", () => {
    expect(PROJECTION_CATALOG.map((projection) => projection.id)).toEqual(["index", "duplicates"]);
    expect(PROJECTION_CATALOG.every((projection) => projection.inputFacts.length > 0)).toBe(true);
    expect(PROJECTION_CATALOG.every((projection) => projection.outputStore.length > 0)).toBe(true);
    expect(PROJECTION_CATALOG.find((projection) => projection.id === "index")?.dependsOn).toEqual([]);
    expect(PROJECTION_CATALOG.find((projection) => projection.id === "duplicates")?.dependsOn).toEqual(["index"]);
  });
});
