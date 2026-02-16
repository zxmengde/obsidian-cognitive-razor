/**
 * P5: Frontmatter 往返一致性（属性测试）
 *
 * 验证目标：generateMarkdownContent → extractFrontmatter 往返后字段等价
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
    generateFrontmatter,
    extractFrontmatter,
    generateMarkdownContent,
} from "./frontmatter-utils";
import type { CRType, NoteState } from "../types";

// 生成器
const crTypeArb = fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");
const noteStateArb = fc.constantFrom<NoteState>("Stub", "Draft", "Evergreen");

// 安全字符串（避免 YAML 特殊字符导致解析歧义，且不能全为空白）
const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff ]{0,29}$/);

// UUID v4 格式
const uuidArb = fc.uuid().map((u) => u.replace(/-/g, "").slice(0, 32)).map((hex) =>
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
);

// 别名/标签生成器（不含 YAML 特殊字符，且不能是纯 YAML 特殊值如 "-", "~", "null", "true", "false"）
const tagArb = fc.stringMatching(/^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]{0,19}$/);
const aliasArb = safeStringArb;

describe("frontmatter-utils", () => {
    describe("基础功能", () => {
        it("generateFrontmatter 生成正确的必填字段", () => {
            const fm = generateFrontmatter({
                cruid: "test-uid-001",
                type: "Entity",
                name: "测试概念",
            });
            expect(fm.cruid).toBe("test-uid-001");
            expect(fm.type).toBe("Entity");
            expect(fm.name).toBe("测试概念");
            expect(fm.status).toBe("Stub");
            expect(fm.parents).toEqual([]);
            expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });

        it("generateMarkdownContent + extractFrontmatter 基础往返", () => {
            const fm = generateFrontmatter({
                cruid: "uid-roundtrip",
                type: "Domain",
                name: "往返测试",
                definition: "这是一个测试定义",
                aliases: ["别名A", "别名B"],
                tags: ["tag1", "tag2"],
                parents: ["[[父概念]]"],
            });
            const body = "\n# 正文内容\n\n这是正文。\n";
            const markdown = generateMarkdownContent(fm, body);

            const extracted = extractFrontmatter(markdown);
            expect(extracted).not.toBeNull();
            expect(extracted!.frontmatter.cruid).toBe("uid-roundtrip");
            expect(extracted!.frontmatter.type).toBe("Domain");
            expect(extracted!.frontmatter.name).toBe("往返测试");
            expect(extracted!.frontmatter.definition).toBe("这是一个测试定义");
            expect(extracted!.frontmatter.aliases).toEqual(["别名A", "别名B"]);
            expect(extracted!.frontmatter.tags).toEqual(["tag1", "tag2"]);
            expect(extracted!.frontmatter.parents).toEqual(["[[父概念]]"]);
            // frontmatterToYaml 在末尾添加 \n\n，所以 body 前会多一个空行
            expect(extracted!.body.trim()).toBe(body.trim());
        });

        it("extractFrontmatter 对无 frontmatter 内容返回 null", () => {
            expect(extractFrontmatter("# 没有 frontmatter")).toBeNull();
        });

        it("extractFrontmatter 对不完整 frontmatter 返回 null", () => {
            expect(extractFrontmatter("---\ncruid: test\n")).toBeNull();
        });

        it("parents 字段规范化：去重、去空、包裹 [[]]", () => {
            const fm = generateFrontmatter({
                cruid: "uid-parents",
                type: "Theory",
                name: "父链接测试",
                parents: ["概念A", "[[概念B]]", "概念A", "", "  "],
            });
            expect(fm.parents).toEqual(["[[概念A]]", "[[概念B]]"]);
        });
    });

    describe("P5: Frontmatter 往返一致性（PBT）", () => {
        it("任意有效 frontmatter 经 generate → extract 后核心字段等价", () => {
            fc.assert(
                fc.property(
                    uuidArb,
                    crTypeArb,
                    safeStringArb,
                    noteStateArb,
                    fc.option(safeStringArb, { nil: undefined }),
                    fc.array(aliasArb, { minLength: 0, maxLength: 3 }),
                    fc.array(tagArb, { minLength: 0, maxLength: 3 }),
                    fc.array(safeStringArb.map((s) => `[[${s}]]`), { minLength: 0, maxLength: 3 }),
                    (cruid, type, name, status, definition, aliases, tags, parents) => {
                        const fm = generateFrontmatter({
                            cruid,
                            type,
                            name,
                            status,
                            definition,
                            aliases: aliases.length > 0 ? aliases : undefined,
                            tags: tags.length > 0 ? tags : undefined,
                            parents,
                        });

                        const body = "\n# Test body\n";
                        const markdown = generateMarkdownContent(fm, body);
                        const extracted = extractFrontmatter(markdown);

                        // 必须能成功解析
                        expect(extracted).not.toBeNull();
                        if (!extracted) return;

                        // 核心字段等价
                        expect(extracted.frontmatter.cruid).toBe(cruid);
                        expect(extracted.frontmatter.type).toBe(type);
                        expect(extracted.frontmatter.name).toBe(name);
                        expect(extracted.frontmatter.status).toBe(status);

                        // definition 等价
                        if (definition) {
                            expect(extracted.frontmatter.definition).toBe(definition);
                        }

                        // 数组字段等价（aliases/tags 可能为 undefined 当为空时）
                        if (aliases.length > 0) {
                            expect(extracted.frontmatter.aliases).toEqual(aliases);
                        }
                        if (tags.length > 0) {
                            expect(extracted.frontmatter.tags).toEqual(tags);
                        }

                        // parents 等价（已规范化）
                        expect(extracted.frontmatter.parents).toEqual(fm.parents);

                        // body 保持不变（trim 比较，因为 frontmatterToYaml 末尾有额外换行）
                        expect(extracted.body.trim()).toBe(body.trim());
                    }
                ),
                { numRuns: 200 }
            );
        });

        it("空可选字段的往返一致性", () => {
            fc.assert(
                fc.property(
                    uuidArb,
                    crTypeArb,
                    safeStringArb,
                    (cruid, type, name) => {
                        const fm = generateFrontmatter({ cruid, type, name });
                        const markdown = generateMarkdownContent(fm, "");
                        const extracted = extractFrontmatter(markdown);

                        expect(extracted).not.toBeNull();
                        if (!extracted) return;

                        expect(extracted.frontmatter.cruid).toBe(cruid);
                        expect(extracted.frontmatter.type).toBe(type);
                        // name 经 YAML 序列化/反序列化后应等价（trim 后比较）
                        expect(extracted.frontmatter.name).toBe(name);
                        expect(extracted.frontmatter.parents).toEqual([]);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
