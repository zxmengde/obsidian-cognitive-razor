/**
 * 领域模型类型定义
 *
 * 知识类型、笔记状态、Frontmatter 元数据、标准化概念
 */

// ============================================================================
// 知识类型和状态
// ============================================================================

/** 知识类型：五种核心概念类型 */
export type CRType = "Domain" | "Issue" | "Theory" | "Entity" | "Mechanism";

/** 笔记状态：从 Stub 到 Evergreen 的演进 */
export type NoteState = "Stub" | "Draft" | "Evergreen";

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
    /** 概念核心定义（用于快速索引与预览） */
    definition?: string;
    /** 笔记状态 */
    status: NoteState;
    /** 创建时间 (yyyy-MM-DD HH:mm:ss) */
    created: string;
    /** 更新时间 (yyyy-MM-DD HH:mm:ss) */
    updated: string;
    /** 别名列表 */
    aliases?: string[];
    /** 标签列表 */
    tags?: string[];
    /** 父概念链接列表（规范形态：[[Title]]） */
    parents: string[];
    /** 来源概念 UIDs */
    sourceUids?: string[];
    /** 版本号 */
    version?: string;
    /** 未知字段保留（需求 29.4：解析时不丢弃未知字段） */
    [key: string]: unknown;
}

// ============================================================================
// 标准化概念
// ============================================================================

/** 标准化概念结果 */
export interface StandardizedConcept {
    /** 所有类型的标准名称 */
    standardNames: {
        Domain: { chinese: string; english: string };
        Issue: { chinese: string; english: string };
        Theory: { chinese: string; english: string };
        Entity: { chinese: string; english: string };
        Mechanism: { chinese: string; english: string };
    };
    /** 类型置信度 */
    typeConfidences: Record<CRType, number>;
    /** 主要类型 */
    primaryType?: CRType;
    /** 核心定义 */
    coreDefinition?: string;
}
