/**
 * 领域模型类型定义
 *
 * 知识类型、笔记状态、Frontmatter 元数据和概念输入
 */

// ============================================================================
// 知识类型和状态
// ============================================================================

/** 知识类型：五种核心概念类型 */
export const CR_TYPES = ["domain", "issue", "theory", "entity", "mechanism"] as const;
export type CRType = typeof CR_TYPES[number];

/** 笔记状态：新内容从 draft 开始，可由用户提升为 evergreen。 */
export type NoteState = "seed" | "draft" | "evergreen";

// ============================================================================
// Frontmatter 数据模型
// ============================================================================

/** Cognitive Razor 笔记的 Frontmatter 元数据 */
export interface CRFrontmatter {
    /** UUID v4 唯一标识符 */
    cruid: string;
    /** 知识类型 */
    type: CRType;
    /** 笔记名称 */
    name: string;
    /** 笔记状态 */
    status: NoteState;
    /** 创建时间 (yyyy-MM-DD HH:mm:ss) */
    created: string;
    /** 更新时间 (yyyy-MM-DD HH:mm:ss) */
    updated: string;
    /** 别名列表 */
    aliases: string[];
    /** 标签列表 */
    tags: string[];
    /** 父概念链接列表（规范形态：[[Title]]） */
    parents: string[];
    /** 来源概念 UIDs */
    sourceUids?: string[];
}


// ============================================================================
// Define 预览与已确认概念
// ============================================================================

/** A name proposed by Define or confirmed for a note. */
export interface ConceptName {
    chinese: string;
    english: string;
}

/** One type candidate in a transient Define preview. */
export interface DefineCandidate {
    name: ConceptName;
    confidence: number;
}

/** Define output shown to the user before any durable side effect. */
export interface DefinePreview {
    candidates: Record<CRType, DefineCandidate>;
    coreDefinition: string;
}

/** The origin of a concept that has passed an explicit confirmation gate. */
export type ConfirmedConceptSource = "define" | "hierarchical-expand" | "abstract-expand";

/** The only concept input accepted by a durable Create workflow. */
export interface ConfirmedConcept {
    type: CRType;
    name: ConceptName;
    coreDefinition: string;
    source: ConfirmedConceptSource;
    parents: string[];
}
