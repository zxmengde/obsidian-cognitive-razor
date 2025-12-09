import { CRType, StandardizedConcept } from "../types";

const TYPES: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];

/**
 * 将 standardizeClassify 的原始输出映射为内部使用的 StandardizedConcept 结构
 * 兼容旧版（standard_names + type_confidences）与新版（顶层五类对象）格式。
 */
export function mapStandardizeOutput(raw: Record<string, any>): StandardizedConcept {
  const standardNames: StandardizedConcept["standardNames"] = {
    Domain: { chinese: "", english: "" },
    Issue: { chinese: "", english: "" },
    Theory: { chinese: "", english: "" },
    Entity: { chinese: "", english: "" },
    Mechanism: { chinese: "", english: "" },
  };

  const typeConfidences: Record<CRType, number> = {
    Domain: 0,
    Issue: 0,
    Theory: 0,
    Entity: 0,
    Mechanism: 0,
  };

  // 兼容旧版字段（standard_names + type_confidences）
  if (raw.standard_names || raw.standardNames) {
    const names = raw.standard_names || raw.standardNames;
    TYPES.forEach((type) => {
      const entry = names?.[type] || {};
      standardNames[type] = {
        chinese: entry.chinese || "",
        english: entry.english || "",
      };
    });

    const confidences = raw.type_confidences || raw.typeConfidences || {};
    TYPES.forEach((type) => {
      const value = confidences[type];
      typeConfidences[type] = typeof value === "number" ? value : 0;
    });

    const primaryType =
      raw.primary_type ||
      raw.primaryType ||
      getPrimaryType(typeConfidences);

    return {
      standardNames,
      typeConfidences,
      primaryType,
      coreDefinition: raw.core_definition || raw.coreDefinition || "",
    };
  }

  // 新版结构：五个类型作为顶层键
  TYPES.forEach((type) => {
    const entry = raw[type] || {};
    standardNames[type] = {
      chinese: entry.chinese || "",
      english: entry.english || "",
    };
    typeConfidences[type] =
      typeof entry.confidences === "number" ? entry.confidences : 0;
  });

  return {
    standardNames,
    typeConfidences,
    primaryType: getPrimaryType(typeConfidences),
    coreDefinition: raw.core_definition || raw.coreDefinition || "",
  };
}

function getPrimaryType(typeConfidences: Record<CRType, number>): CRType {
  return TYPES.reduce((best, current) =>
    typeConfidences[current] > typeConfidences[best] ? current : best
  , "Domain" as CRType);
}
