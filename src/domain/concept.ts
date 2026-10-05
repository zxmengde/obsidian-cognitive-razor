import { err, ok, type Result } from "../types";
import { CR_TYPES, type ConfirmedConcept, type ConfirmedConceptSource, type ConceptName, type CRType, type DefinePreview } from "../types/domain";
import { parseInternalNoteLink } from "../utils/note-links";

export interface ConfirmConceptInput {
  type: CRType;
  name: ConceptName;
  coreDefinition?: string;
  source: ConfirmedConceptSource;
  parents?: readonly string[];
}

const SOURCE_VALUES: readonly ConfirmedConceptSource[] = [
  "define",
  "hierarchical-expand",
  "abstract-expand",
];

function isCrType(value: unknown): value is CRType {
  return typeof value === "string" && (CR_TYPES as readonly string[]).includes(value);
}

function isSource(value: unknown): value is ConfirmedConceptSource {
  return typeof value === "string" && SOURCE_VALUES.includes(value as ConfirmedConceptSource);
}

function normalizeName(name: unknown): Result<ConceptName> {
  if (!name || typeof name !== "object" || Array.isArray(name)) {
    return err("E101_INVALID_INPUT", "概念名称无效");
  }
  const value = name as Record<string, unknown>;
  const chinese = typeof value.chinese === "string" ? value.chinese.trim() : "";
  const english = typeof value.english === "string" ? value.english.trim() : "";
  if (!chinese && !english) return err("E101_INVALID_INPUT", "概念名称不能为空");
  if ([chinese, english].some((part) => Array.from(part).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  }))) {
    return err("E101_INVALID_INPUT", "概念名称不能包含控制字符");
  }
  if ([chinese, english].some((part) => /[\\/:*?"<>|]/u.test(part))) {
    return err("E101_INVALID_INPUT", "概念名称不能包含文件名非法字符");
  }
  return ok({ chinese, english });
}

function normalizeParents(parents: unknown): Result<string[]> {
  if (parents === undefined) return ok([]);
  if (!Array.isArray(parents)) return err("E101_INVALID_INPUT", "父概念链接无效");

  const normalized: string[] = [];
  for (const parent of parents) {
    if (typeof parent !== "string") return err("E101_INVALID_INPUT", "父概念链接无效");
    const value = parent.trim();
    if (!value) continue;
    const link = parseInternalNoteLink(value);
    if (!link?.target || link.rest.trim() || Array.from(link.target).some(character => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
      || link.target.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(link.target) || /^[a-z][a-z\d+.-]*:/i.test(link.target)) {
      return err("E101_INVALID_INPUT", "父概念必须是有效的内部笔记链接");
    }
    if (!normalized.includes(value)) normalized.push(value);
  }
  return ok(normalized);
}

/**
 * Build the only concept shape that may cross into a durable Create workflow.
 * This function is deliberately independent of Obsidian and model services.
 */
export function confirmConcept(input: ConfirmConceptInput): Result<ConfirmedConcept> {
  if (!isCrType(input?.type)) return err("E101_INVALID_INPUT", "概念类型无效");
  if (!isSource(input?.source)) return err("E101_INVALID_INPUT", "概念来源无效");
  const name = normalizeName(input?.name);
  if (!name.ok) return name;
  const parents = normalizeParents(input?.parents);
  if (!parents.ok) return parents;
  if (input?.coreDefinition !== undefined && typeof input.coreDefinition !== "string") {
    return err("E101_INVALID_INPUT", "核心定义无效");
  }

  return ok({
    type: input.type,
    name: name.value,
    coreDefinition: input.coreDefinition?.trim() ?? "",
    source: input.source,
    parents: parents.value,
  });
}

/** Convert one user-selected Define candidate into a durable concept fact. */
export function confirmDefinePreview(
  preview: DefinePreview,
  type: CRType,
  options: { parents?: readonly string[]; source?: ConfirmedConceptSource } = {},
): Result<ConfirmedConcept> {
  if (!preview || typeof preview !== "object" || !isCrType(type)) {
    return err("E101_INVALID_INPUT", "Define 预览无效");
  }
  const candidate = preview.candidates?.[type];
  if (!candidate) return err("E101_INVALID_INPUT", `Define 预览缺少 ${type} 候选`);
  return confirmConcept({
    type,
    name: candidate.name,
    coreDefinition: preview.coreDefinition,
    source: options.source ?? "define",
    parents: options.parents,
  });
}

/** Runtime boundary check for data read from a workflow artifact. */
export function isConfirmedConcept(value: unknown): value is ConfirmedConcept {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isCrType(candidate.type) || !isSource(candidate.source) || typeof candidate.coreDefinition !== "string") {
    return false;
  }
  const name = normalizeName(candidate.name);
  if (!name.ok) return false;
  const parents = normalizeParents(candidate.parents);
  if (!parents.ok || !candidate.name || typeof candidate.name !== "object") return false;
  const rawName = candidate.name as Record<string, unknown>;
  if (name.value.chinese !== rawName.chinese || name.value.english !== rawName.english) return false;
  const rawParents = candidate.parents as unknown[];
  return parents.value.length === rawParents.length && parents.value.every((parent, index) => parent === rawParents[index]);
}
