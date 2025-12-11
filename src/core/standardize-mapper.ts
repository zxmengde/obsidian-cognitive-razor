import { CRType, StandardizedConcept } from "../types";

const TYPES: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];

/** 验证并归一化 confidence scores */
function normalizeConfidences(confidences: Record<CRType, number>): Record<CRType, number> {
  const sum = TYPES.reduce((acc, type) => acc + confidences[type], 0);
  
  // 如果总和已经是 1.0（允许浮点误差），直接返回
  if (Math.abs(sum - 1.0) < 0.0001) {
    return confidences;
  }
  
  // 如果总和为 0，平均分配
  if (sum === 0) {
    const normalized: Record<CRType, number> = {} as Record<CRType, number>;
    TYPES.forEach(type => {
      normalized[type] = 0.2; // 1.0 / 5
    });
    return normalized;
  }
  
  // 归一化：每个值除以总和
  const normalized: Record<CRType, number> = {} as Record<CRType, number>;
  TYPES.forEach(type => {
    normalized[type] = confidences[type] / sum;
  });
  
  return normalized;
}

/** 映射 standardizeClassify 输出为 StandardizedConcept */
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

  // 归一化 confidence scores，确保总和为 1.0
  const normalizedConfidences = normalizeConfidences(typeConfidences);

  return {
    standardNames,
    typeConfidences: normalizedConfidences,
    primaryType: getPrimaryType(normalizedConfidences),
    coreDefinition: raw.core_definition || raw.coreDefinition || "",
  };
}

function getPrimaryType(typeConfidences: Record<CRType, number>): CRType {
  return TYPES.reduce((best, current) =>
    typeConfidences[current] > typeConfidences[best] ? current : best
  , "Domain" as CRType);
}
