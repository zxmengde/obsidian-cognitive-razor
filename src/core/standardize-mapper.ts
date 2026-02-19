import type { CRType, StandardizedConcept } from "../types";

const TYPES: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];

/** 映射 define 任务输出为 StandardizedConcept */
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

  // 处理 classification_result 包装格式
  const classificationResult = raw.classification_result || raw;

  TYPES.forEach((type) => {
    const entry = classificationResult[type] || {};
    standardNames[type] = {
      chinese: entry.standard_name_cn || entry.chinese || "",
      english: entry.standard_name_en || entry.english || "",
    };
    const confidence = entry.confidence_score ?? entry.confidences ?? 0;
    typeConfidences[type] = typeof confidence === "number" ? confidence : 0;
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
