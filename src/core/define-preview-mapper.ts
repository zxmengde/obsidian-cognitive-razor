import { CR_TYPES } from "../types";
import type { CRType, DefinePreview } from "../types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

/** Map validated Define output into the transient preview shown by the UI. */
export function mapDefineOutput(raw: Record<string, unknown>): DefinePreview {
  const candidates = {} as DefinePreview["candidates"];
  const classificationResult = asRecord(raw.classification_result || raw);

  CR_TYPES.forEach((type: CRType) => {
    const entry = asRecord(classificationResult[type]);
    const confidence = entry.confidence_score ?? entry.confidences ?? 0;
    candidates[type] = {
      name: {
        chinese: readString(entry, "standard_name_cn") || readString(entry, "chinese") || "",
        english: readString(entry, "standard_name_en") || readString(entry, "english") || "",
      },
      confidence: typeof confidence === "number" ? confidence : 0,
    };
  });

  return {
    candidates,
    coreDefinition: readString(raw, "core_definition") || readString(raw, "coreDefinition") || "",
  };
}
