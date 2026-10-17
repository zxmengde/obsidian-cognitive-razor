import { CR_TYPES } from "../types";
import type { ConceptVector, CRType, VectorIndexMeta } from "../types";

const CR_TYPE_SET: ReadonlySet<string> = new Set(CR_TYPES);

/** 向量格式转换不依赖磁盘，使读写沿用相同的数据契约。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isSafeConceptId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !value.includes("/") && !value.includes("\\") && !value.includes("\0") &&
    value !== "." && value !== ".." && value !== "__proto__" &&
    value !== "prototype" && value !== "constructor";
}

export function isSafeCrType(value: unknown): value is CRType {
  return typeof value === "string" && CR_TYPE_SET.has(value);
}

export function parseVectorIndexMeta(raw: unknown): VectorIndexMeta | null {
  if (!isRecord(raw) || raw.version !== "1.0.0" ||
    typeof raw.embeddingProfile !== "string" || !raw.embeddingProfile.trim() ||
    typeof raw.embeddingModel !== "string" || !raw.embeddingModel.trim() ||
    !Number.isInteger(raw.dimensions) || (raw.dimensions as number) < 0 ||
    !isRecord(raw.concepts)) {
    return null;
  }

  const concepts = Object.create(null) as VectorIndexMeta["concepts"];
  for (const [id, candidate] of Object.entries(raw.concepts)) {
    if (!isSafeConceptId(id) || !isRecord(candidate) || !CR_TYPE_SET.has(String(candidate.type))) {
      return null;
    }
    if (candidate.sourceHash !== undefined && (typeof candidate.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(candidate.sourceHash))) return null;
    concepts[id] = { type: candidate.type as CRType, ...(candidate.sourceHash ? { sourceHash: candidate.sourceHash } : {}) };
  }
  if ((raw.dimensions as number) === 0 && Object.keys(concepts).length > 0) return null;
  return {
    version: "1.0.0",
    embeddingProfile: raw.embeddingProfile.trim(),
    embeddingModel: raw.embeddingModel.trim(),
    dimensions: raw.dimensions as number,
    concepts,
  };
}

function parseVectorMetadata(raw: unknown, embeddingLength: number): ConceptVector["metadata"] | null {
  if (!isRecord(raw) ||
    typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt) ||
    typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt) ||
    typeof raw.embeddingModel !== "string" || !raw.embeddingModel.trim() ||
    !Number.isInteger(raw.dimensions) || raw.dimensions !== embeddingLength) {
    return null;
  }
  if (raw.sourceHash !== undefined && (typeof raw.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(raw.sourceHash))) return null;
  return {
    ...(raw.sourceHash ? { sourceHash: raw.sourceHash } : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    embeddingModel: raw.embeddingModel.trim(),
    dimensions: raw.dimensions as number,
  };
}

export function parseConceptVector(raw: unknown, expectedType: CRType, expectedId: string): ConceptVector | null {
  if (!isRecord(raw) || raw.id !== expectedId || raw.type !== expectedType ||
    !Array.isArray(raw.embedding) || raw.embedding.length === 0 ||
    !raw.embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  const metadata = parseVectorMetadata(raw.metadata, raw.embedding.length);
  if (!metadata) return null;
  return {
    id: expectedId,
    type: expectedType,
    embedding: [...raw.embedding] as number[],
    metadata,
  };
}
