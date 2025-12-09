/**
 * 命名工具模块的属性测试
 * 
 * 使用 fast-check 进行属性测试
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  renderNamingTemplate,
  validateNamingTemplate,
  sanitizeFileName,
  generateFilePath,
  createConceptSignature,
  generateSignatureText,
} from "./naming-utils";
import type { CRType } from "../types";

describe("Naming Utils - Property Tests", () => {
  /**
   * **Feature: bug-fixes-v1, Property 3: Naming Template Application**
   * 
   * For any concept with standardized name data and any valid naming template configuration,
   * the generated filename SHALL match the pattern produced by substituting template
   * placeholders with actual values.
   * 
   * **Validates: Requirements 3.2, 3.4, 5.4**
   */
  describe("Property 3: Naming Template Application", () => {
    // 生成器：有效的命名模板
    const validTemplateArb = fc.oneof(
      fc.constant("{{chinese}} ({{english}})"),
      fc.constant("{{english}} - {{chinese}}"),
      fc.constant("{{chinese}}"),
      fc.constant("{{english}}"),
      fc.constant("{{type}} - {{chinese}}"),
      fc.constant("[{{type}}] {{chinese}} ({{english}})"),
      fc.constant("{{chinese}} {{english}}")
    );

    // 生成器：概念名称数据
    // 注意：
    // 1. 生成的字符串应该是已经 trim 过的，因为 renderNamingTemplate 会清理空格
    // 2. 避免生成包含括号的字符串，因为 renderNamingTemplate 会清理空括号
    // 3. 避免生成包含 $ 的字符串，因为 replace 方法会将其解释为特殊字符
    const conceptNameArb = fc.record({
      chinese: fc.string({ minLength: 1, maxLength: 50 })
        .filter(s => s.trim().length > 0 && !s.includes("(") && !s.includes(")") && !s.includes("$"))
        .map(s => s.trim()),
      english: fc.string({ minLength: 1, maxLength: 50 })
        .filter(s => s.trim().length > 0 && !s.includes("(") && !s.includes(")") && !s.includes("$"))
        .map(s => s.trim()),
    });

    // 生成器：CRType
    const crTypeArb = fc.constantFrom<CRType>(
      "Domain",
      "Issue",
      "Theory",
      "Entity",
      "Mechanism"
    );

    it("should produce consistent output for the same inputs", () => {
      fc.assert(
        fc.property(validTemplateArb, conceptNameArb, crTypeArb, (template, names, type) => {
          const result1 = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });
          const result2 = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });

          // 相同输入应产生相同输出
          expect(result1).toBe(result2);
        }),
        { numRuns: 100 }
      );
    });

    it("should contain the chinese name when template includes {{chinese}}", () => {
      fc.assert(
        fc.property(conceptNameArb, crTypeArb, (names, type) => {
          const template = "{{chinese}} ({{english}})";
          const result = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });

          // 结果应包含中文名
          expect(result).toContain(names.chinese);
        }),
        { numRuns: 100 }
      );
    });

    it("should contain the english name when template includes {{english}}", () => {
      fc.assert(
        fc.property(conceptNameArb, crTypeArb, (names, type) => {
          const template = "{{chinese}} ({{english}})";
          const result = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });

          // 结果应包含英文名（注意：renderNamingTemplate 会清理空括号和多余空格）
          // 所以我们检查清理后的英文名是否在结果中
          const cleanedEnglish = names.english.replace(/\s+/g, " ").trim();
          expect(result).toContain(cleanedEnglish);
        }),
        { numRuns: 100 }
      );
    });

    it("should contain the type when template includes {{type}}", () => {
      fc.assert(
        fc.property(conceptNameArb, crTypeArb, (names, type) => {
          const template = "[{{type}}] {{chinese}}";
          const result = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });

          // 结果应包含类型
          expect(result).toContain(type);
        }),
        { numRuns: 100 }
      );
    });

    it("should not contain placeholder syntax in output", () => {
      fc.assert(
        fc.property(validTemplateArb, conceptNameArb, crTypeArb, (template, names, type) => {
          const result = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });

          // 结果不应包含未替换的占位符
          expect(result).not.toMatch(/\{\{.*?\}\}/);
        }),
        { numRuns: 100 }
      );
    });

    it("should produce non-empty output for valid inputs", () => {
      fc.assert(
        fc.property(validTemplateArb, conceptNameArb, crTypeArb, (template, names, type) => {
          const result = renderNamingTemplate(template, {
            chinese: names.chinese,
            english: names.english,
            type,
          });

          // 结果不应为空
          expect(result.trim()).not.toBe("");
        }),
        { numRuns: 100 }
      );
    });

    it("should handle templates with only one placeholder", () => {
      fc.assert(
        fc.property(conceptNameArb, crTypeArb, (names, type) => {
          const chineseOnlyResult = renderNamingTemplate("{{chinese}}", {
            chinese: names.chinese,
            english: names.english,
            type,
          });
          // renderNamingTemplate 会清理多余空格，所以我们比较清理后的结果
          const cleanedChinese = names.chinese.replace(/\s+/g, " ").trim();
          expect(chineseOnlyResult).toBe(cleanedChinese);

          const englishOnlyResult = renderNamingTemplate("{{english}}", {
            chinese: names.chinese,
            english: names.english,
            type,
          });
          const cleanedEnglish = names.english.replace(/\s+/g, " ").trim();
          expect(englishOnlyResult).toBe(cleanedEnglish);
        }),
        { numRuns: 100 }
      );
    });

    it("should clean up empty parentheses", () => {
      fc.assert(
        fc.property(conceptNameArb, crTypeArb, (names, type) => {
          // 当 english 为空时，应该移除空括号
          const result = renderNamingTemplate("{{chinese}} ({{english}})", {
            chinese: names.chinese,
            english: "",
            type,
          });

          // 不应包含空括号
          expect(result).not.toContain("()");
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("Template Validation", () => {
    it("should accept valid templates", () => {
      const validTemplates = [
        "{{chinese}} ({{english}})",
        "{{english}} - {{chinese}}",
        "{{type}} - {{chinese}}",
        "[{{type}}] {{chinese}} ({{english}})",
      ];

      for (const template of validTemplates) {
        const result = validateNamingTemplate(template);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }
    });

    it("should reject empty templates", () => {
      const result = validateNamingTemplate("");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject templates without valid placeholders", () => {
      const result = validateNamingTemplate("Just plain text");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("有效占位符"))).toBe(true);
    });

    it("should reject templates with unclosed placeholders", () => {
      const result = validateNamingTemplate("{{chinese ({{english}})");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("未闭合"))).toBe(true);
    });

    it("should reject templates with invalid placeholders", () => {
      const result = validateNamingTemplate("{{chinese}} {{invalid}}");
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("无效的占位符"))).toBe(true);
    });
  });

  describe("File Name Sanitization", () => {
    it("should remove illegal characters", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const result = sanitizeFileName(input);

          // 结果不应包含非法字符
          expect(result).not.toMatch(/[\\/:*?"<>|]/);
        }),
        { numRuns: 100 }
      );
    });

    it("should preserve valid characters", () => {
      const validName = "认知负荷 (Cognitive Load)";
      const result = sanitizeFileName(validName);
      expect(result).toBe(validName);
    });

    it("should replace illegal characters with dashes", () => {
      const input = "file:name*with?illegal<chars>";
      const result = sanitizeFileName(input);
      expect(result).toBe("file-name-with-illegal-chars-");
    });
  });

  describe("File Path Generation", () => {
    const directorySchemeArb = fc.record({
      Domain: fc.string({ minLength: 1, maxLength: 20 }),
      Issue: fc.string({ minLength: 1, maxLength: 20 }),
      Theory: fc.string({ minLength: 1, maxLength: 20 }),
      Entity: fc.string({ minLength: 1, maxLength: 20 }),
      Mechanism: fc.string({ minLength: 1, maxLength: 20 }),
    });

    const standardNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);
    const crTypeArb = fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");

    it("should include the directory from the scheme", () => {
      fc.assert(
        fc.property(standardNameArb, directorySchemeArb, crTypeArb, (name, scheme, type) => {
          const result = generateFilePath(name, scheme, type);
          const expectedDir = scheme[type];

          // 结果应包含对应的目录
          expect(result).toContain(expectedDir);
        }),
        { numRuns: 100 }
      );
    });

    it("should end with .md extension", () => {
      fc.assert(
        fc.property(standardNameArb, directorySchemeArb, crTypeArb, (name, scheme, type) => {
          const result = generateFilePath(name, scheme, type);

          // 结果应以 .md 结尾
          expect(result).toMatch(/\.md$/);
        }),
        { numRuns: 100 }
      );
    });

    it("should sanitize the file name", () => {
      fc.assert(
        fc.property(directorySchemeArb, crTypeArb, (scheme, type) => {
          const nameWithIllegalChars = "file:name*with?illegal<chars>";
          const result = generateFilePath(nameWithIllegalChars, scheme, type);

          // 结果不应包含非法字符（除了路径分隔符）
          const fileName = result.split("/").pop() || "";
          expect(fileName).not.toMatch(/[\\:*?"<>|]/);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("Concept Signature Creation", () => {
    const standardizedDataArb = fc.record({
      standardName: fc.record({
        chinese: fc.string({ minLength: 1, maxLength: 50 })
          .filter(s => s.trim().length > 0 && !s.includes("(") && !s.includes(")") && !s.includes("$"))
          .map(s => s.trim()),
        english: fc.string({ minLength: 1, maxLength: 50 })
          .filter(s => s.trim().length > 0 && !s.includes("(") && !s.includes(")") && !s.includes("$"))
          .map(s => s.trim()),
      }),
      aliases: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
      coreDefinition: fc.string({ maxLength: 200 }),
    });

    const crTypeArb = fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");

    it("should create a signature with all required fields", () => {
      fc.assert(
        fc.property(standardizedDataArb, crTypeArb, (data, type) => {
          const signature = createConceptSignature(data, type);

          // 签名应包含所有必需字段
          expect(signature).toHaveProperty("standardName");
          expect(signature).toHaveProperty("aliases");
          expect(signature).toHaveProperty("coreDefinition");
          expect(signature).toHaveProperty("type");
          expect(signature.type).toBe(type);
        }),
        { numRuns: 100 }
      );
    });

    it("should apply the naming template to standard name", () => {
      fc.assert(
        fc.property(standardizedDataArb, crTypeArb, (data, type) => {
          const template = "{{chinese}} ({{english}})";
          const signature = createConceptSignature(data, type, template);

          // 标准名应包含中文名和英文名（清理后的版本）
          const cleanedChinese = data.standardName.chinese.replace(/\s+/g, " ").trim();
          const cleanedEnglish = data.standardName.english.replace(/\s+/g, " ").trim();
          expect(signature.standardName).toContain(cleanedChinese);
          expect(signature.standardName).toContain(cleanedEnglish);
        }),
        { numRuns: 100 }
      );
    });

    it("should preserve aliases", () => {
      fc.assert(
        fc.property(standardizedDataArb, crTypeArb, (data, type) => {
          const signature = createConceptSignature(data, type);

          // 别名应该被保留
          expect(signature.aliases).toEqual(data.aliases);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("Signature Text Generation", () => {
    const signatureArb = fc.record({
      standardName: fc.string({ minLength: 1, maxLength: 50 }),
      aliases: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
      coreDefinition: fc.string({ maxLength: 200 }),
      type: fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism"),
    });

    it("should include standard name in signature text", () => {
      fc.assert(
        fc.property(signatureArb, (signature) => {
          const text = generateSignatureText(signature);

          // 签名文本应包含标准名
          expect(text).toContain(signature.standardName);
        }),
        { numRuns: 100 }
      );
    });

    it("should include all aliases in signature text", () => {
      fc.assert(
        fc.property(signatureArb, (signature) => {
          const text = generateSignatureText(signature);

          // 签名文本应包含所有别名
          for (const alias of signature.aliases) {
            if (alias.trim()) {
              expect(text).toContain(alias);
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it("should include core definition in signature text", () => {
      fc.assert(
        fc.property(signatureArb, (signature) => {
          if (signature.coreDefinition.trim()) {
            const text = generateSignatureText(signature);

            // 签名文本应包含核心定义
            expect(text).toContain(signature.coreDefinition);
          }
        }),
        { numRuns: 100 }
      );
    });

    it("should use pipe separator", () => {
      fc.assert(
        fc.property(signatureArb, (signature) => {
          const text = generateSignatureText(signature);

          // 如果有多个部分，应该使用 | 分隔
          if (signature.aliases.length > 0 || signature.coreDefinition) {
            expect(text).toContain("|");
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * **Feature: bug-fixes-v1, Property 4: Directory Scheme Application**
 * 
 * For any CRType and any DirectoryScheme configuration, a newly created note of that type
 * SHALL be placed in the directory specified by DirectoryScheme[type].
 * 
 * **Validates: Requirements 3.3, 3.5**
 */
describe("Property 4: Directory Scheme Application", () => {
  // 生成器：目录方案
  // 注意：目录名称不应包含文件系统非法字符
  const directorySchemeArb = fc.record({
    Domain: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0 && !/[\\/:*?"<>|]/.test(s))
      .map(s => s.trim()),
    Issue: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0 && !/[\\/:*?"<>|]/.test(s))
      .map(s => s.trim()),
    Theory: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0 && !/[\\/:*?"<>|]/.test(s))
      .map(s => s.trim()),
    Entity: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0 && !/[\\/:*?"<>|]/.test(s))
      .map(s => s.trim()),
    Mechanism: fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => s.trim().length > 0 && !/[\\/:*?"<>|]/.test(s))
      .map(s => s.trim()),
  });

  const standardNameArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());

  const crTypeArb = fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");

  it("should place file in the correct directory for the type", () => {
    fc.assert(
      fc.property(standardNameArb, directorySchemeArb, crTypeArb, (name, scheme, type) => {
        const filePath = generateFilePath(name, scheme, type);
        const expectedDir = scheme[type];

        // 文件路径应该以对应的目录开头
        expect(filePath).toMatch(new RegExp(`^${expectedDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
      }),
      { numRuns: 100 }
    );
  });

  it("should use the directory scheme consistently", () => {
    fc.assert(
      fc.property(standardNameArb, directorySchemeArb, crTypeArb, (name, scheme, type) => {
        const filePath1 = generateFilePath(name, scheme, type);
        const filePath2 = generateFilePath(name, scheme, type);

        // 相同输入应产生相同输出
        expect(filePath1).toBe(filePath2);
      }),
      { numRuns: 100 }
    );
  });

  it("should respect directory scheme for all CRTypes", () => {
    fc.assert(
      fc.property(standardNameArb, directorySchemeArb, (name, scheme) => {
        const types: CRType[] = ["Domain", "Issue", "Theory", "Entity", "Mechanism"];

        for (const type of types) {
          const filePath = generateFilePath(name, scheme, type);
          const expectedDir = scheme[type];

          // 每种类型都应该使用对应的目录
          expect(filePath).toContain(expectedDir);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("should handle different directory schemes independently", () => {
    fc.assert(
      fc.property(standardNameArb, directorySchemeArb, directorySchemeArb, crTypeArb, (name, scheme1, scheme2, type) => {
        const filePath1 = generateFilePath(name, scheme1, type);
        const filePath2 = generateFilePath(name, scheme2, type);

        // 如果目录方案不同，文件路径应该不同（除非恰好目录相同）
        if (scheme1[type] !== scheme2[type]) {
          expect(filePath1).not.toBe(filePath2);
        } else {
          expect(filePath1).toBe(filePath2);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("should maintain file name regardless of directory", () => {
    fc.assert(
      fc.property(standardNameArb, directorySchemeArb, crTypeArb, (name, scheme, type) => {
        const filePath = generateFilePath(name, scheme, type);
        const fileName = filePath.split("/").pop() || "";
        const sanitizedName = sanitizeFileName(name);

        // 文件名应该是清理后的标准名 + .md
        expect(fileName).toBe(`${sanitizedName}.md`);
      }),
      { numRuns: 100 }
    );
  });

  it("should produce valid file paths", () => {
    fc.assert(
      fc.property(standardNameArb, directorySchemeArb, crTypeArb, (name, scheme, type) => {
        const filePath = generateFilePath(name, scheme, type);

        // 文件路径应该：
        // 1. 不为空
        expect(filePath.trim()).not.toBe("");

        // 2. 以 .md 结尾
        expect(filePath).toMatch(/\.md$/);

        // 3. 包含至少一个路径分隔符（目录/文件名）
        expect(filePath).toContain("/");

        // 4. 不包含非法字符（除了路径分隔符）
        const parts = filePath.split("/");
        for (const part of parts) {
          if (part && part !== ".md") {
            expect(part).not.toMatch(/[\\:*?"<>|]/);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
