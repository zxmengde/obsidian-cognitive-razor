/**
 * P6: 命名模板输出合法性（属性测试）
 *
 * 验证目标：renderNamingTemplate 输出不含 Obsidian 非法文件名字符
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
    renderNamingTemplate,
    sanitizeFileName,
    validateNamingTemplate,
    generateSignatureText,
    createConceptSignature,
    generateFilePath,
} from "./naming-utils";
import type { CRType } from "../types";

/** Obsidian 非法文件名字符 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/;

const crTypeArb = fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");

describe("naming-utils", () => {
    describe("renderNamingTemplate 基础功能", () => {
        it("替换所有已知占位符", () => {
            const result = renderNamingTemplate(
                "{{chinese}} ({{english}}) [{{type}}]",
                { chinese: "测试", english: "Test", type: "Entity" }
            );
            expect(result).toBe("测试 (Test) [Entity]");
        });

        it("未提供的已知占位符替换为空字符串", () => {
            const result = renderNamingTemplate(
                "{{chinese}} ({{english}})",
                { chinese: "测试", english: "" }
            );
            expect(result).toBe("测试");
        });

        it("未知占位符替换为空字符串", () => {
            const result = renderNamingTemplate(
                "{{chinese}} {{unknown}}",
                { chinese: "测试", english: "Test" }
            );
            expect(result).toBe("测试");
        });

        it("空括号被移除", () => {
            const result = renderNamingTemplate(
                "{{chinese}} ({{english}})",
                { chinese: "测试", english: "" }
            );
            expect(result).not.toContain("()");
        });

        it("非法文件名字符被移除", () => {
            const result = renderNamingTemplate(
                "{{chinese}}",
                { chinese: 'test:file*name?"yes"', english: "" }
            );
            expect(result).not.toMatch(ILLEGAL_FILENAME_CHARS);
        });
    });

    describe("sanitizeFileName", () => {
        it("移除非法字符", () => {
            expect(sanitizeFileName('hello:world*test?"yes"')).toBe("helloworldtestyes");
        });

        it("合并多余空格", () => {
            expect(sanitizeFileName("hello   world")).toBe("hello world");
        });

        it("trim 前后空格", () => {
            expect(sanitizeFileName("  hello  ")).toBe("hello");
        });
    });

    describe("validateNamingTemplate", () => {
        it("有效模板通过验证", () => {
            const result = validateNamingTemplate("{{chinese}} ({{english}})");
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("空模板不通过", () => {
            const result = validateNamingTemplate("");
            expect(result.valid).toBe(false);
        });

        it("无有效占位符不通过", () => {
            const result = validateNamingTemplate("static text only");
            expect(result.valid).toBe(false);
        });

        it("无效占位符报错", () => {
            const result = validateNamingTemplate("{{chinese}} {{invalid_placeholder}}");
            expect(result.errors.some((e) => e.includes("invalid_placeholder"))).toBe(true);
        });
    });

    describe("generateSignatureText", () => {
        it("生成包含名称、别名和定义的签名", () => {
            const text = generateSignatureText({
                standardName: "测试 (Test)",
                aliases: ["别名A"],
                coreDefinition: "核心定义",
                type: "Entity",
            });
            expect(text).toContain("测试 (Test)");
            expect(text).toContain("别名A");
            expect(text).toContain("核心定义");
        });
    });

    describe("createConceptSignature", () => {
        it("使用命名模板渲染标准名", () => {
            const sig = createConceptSignature(
                {
                    standardName: { chinese: "量子力学", english: "Quantum Mechanics" },
                    aliases: ["QM"],
                    coreDefinition: "物理学分支",
                },
                "Theory",
                "{{chinese}} ({{english}})"
            );
            expect(sig.standardName).toBe("量子力学 (Quantum Mechanics)");
            expect(sig.type).toBe("Theory");
        });
    });

    describe("generateFilePath", () => {
        it("生成正确的文件路径", () => {
            const path = generateFilePath(
                "测试概念 (Test)",
                {
                    Domain: "1-领域",
                    Issue: "2-议题",
                    Theory: "3-理论",
                    Entity: "4-实体",
                    Mechanism: "5-机制",
                },
                "Entity"
            );
            expect(path).toBe("4-实体/测试概念 (Test).md");
        });
    });

    describe("P6: 命名模板输出合法性（PBT）", () => {
        // 常见命名模板
        const templateArb = fc.constantFrom(
            "{{chinese}} ({{english}})",
            "{{chinese}}（{{english}}）",
            "{{type}}-{{chinese}}",
            "{{chinese}} [{{type_cn}}]",
            "{{chinese}} ({{english}}) {{uid}}",
            "{{alias}} - {{chinese}}",
        );

        it("任意模板 + 任意上下文：输出不含非法文件名字符", () => {
            fc.assert(
                fc.property(
                    templateArb,
                    fc.string({ minLength: 0, maxLength: 30 }),
                    fc.string({ minLength: 0, maxLength: 30 }),
                    crTypeArb,
                    (template, chinese, english, type) => {
                        const result = renderNamingTemplate(template, {
                            chinese,
                            english,
                            type,
                            type_cn: "实体",
                        });
                        expect(result).not.toMatch(ILLEGAL_FILENAME_CHARS);
                    }
                ),
                { numRuns: 500 }
            );
        });

        it("包含非法字符的输入：输出仍然合法", () => {
            fc.assert(
                fc.property(
                    // 故意生成包含非法字符的字符串
                    fc.string({ minLength: 1, maxLength: 20 }).map(
                        (s) => s + '\\/:*?"<>|'
                    ),
                    fc.string({ minLength: 1, maxLength: 20 }),
                    (chinese, english) => {
                        const result = renderNamingTemplate(
                            "{{chinese}} ({{english}})",
                            { chinese, english }
                        );
                        expect(result).not.toMatch(ILLEGAL_FILENAME_CHARS);
                    }
                ),
                { numRuns: 200 }
            );
        });

        it("sanitizeFileName 对任意输入输出不含非法字符", () => {
            fc.assert(
                fc.property(fc.string({ minLength: 0, maxLength: 100 }), (input) => {
                    const result = sanitizeFileName(input);
                    expect(result).not.toMatch(ILLEGAL_FILENAME_CHARS);
                }),
                { numRuns: 500 }
            );
        });

        it("输出不含前后空格", () => {
            fc.assert(
                fc.property(
                    templateArb,
                    fc.string({ minLength: 0, maxLength: 20 }),
                    fc.string({ minLength: 0, maxLength: 20 }),
                    (template, chinese, english) => {
                        const result = renderNamingTemplate(template, { chinese, english });
                        if (result.length > 0) {
                            expect(result).toBe(result.trim());
                        }
                    }
                ),
                { numRuns: 200 }
            );
        });

        it("输出不含连续空格", () => {
            fc.assert(
                fc.property(
                    templateArb,
                    fc.string({ minLength: 0, maxLength: 20 }),
                    fc.string({ minLength: 0, maxLength: 20 }),
                    (template, chinese, english) => {
                        const result = renderNamingTemplate(template, { chinese, english });
                        expect(result).not.toMatch(/  /);
                    }
                ),
                { numRuns: 200 }
            );
        });
    });
});
