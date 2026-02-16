/**
 * P1: ErrorRegistry 消息模板插值一致性（属性测试）
 *
 * 验证目标：formatMessage() 输出不含未解析占位符 {param}
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
    ErrorRegistry,
    ERROR_CODE_INFO,
    createDefaultErrorRegistry,
    isValidErrorCode,
    getErrorCodeInfo,
    getErrorCategory,
    isRetryableErrorCode,
    getFixSuggestion,
    defaultErrorRegistry,
} from "./error-codes";

// 未解析占位符的正则
const UNRESOLVED_PLACEHOLDER = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

describe("ErrorRegistry", () => {
    describe("基础功能", () => {
        it("createDefaultErrorRegistry 注册所有预定义错误码", () => {
            const registry = createDefaultErrorRegistry();
            const allCodes = Object.keys(ERROR_CODE_INFO);
            expect(registry.size).toBe(allCodes.length);
            for (const code of allCodes) {
                expect(registry.get(code)).toBeDefined();
            }
        });

        it("defaultErrorRegistry 是有效实例", () => {
            expect(defaultErrorRegistry.size).toBeGreaterThan(0);
        });

        it("register 覆盖已有定义", () => {
            const registry = new ErrorRegistry();
            registry.register({
                code: "TEST_001",
                name: "TEST",
                description: "原始描述",
                category: "INTERNAL",
                retryable: false,
            });
            registry.register({
                code: "TEST_001",
                name: "TEST",
                description: "新描述",
                category: "INTERNAL",
                retryable: true,
            });
            expect(registry.get("TEST_001")?.description).toBe("新描述");
            expect(registry.get("TEST_001")?.retryable).toBe(true);
        });

        it("registerAll 批量注册", () => {
            const registry = new ErrorRegistry();
            registry.registerAll([
                { code: "A", name: "A", description: "a", category: "INTERNAL", retryable: false },
                { code: "B", name: "B", description: "b", category: "CONFIG", retryable: true },
            ]);
            expect(registry.size).toBe(2);
            expect(registry.getAllCodes()).toContain("A");
            expect(registry.getAllCodes()).toContain("B");
        });

        it("get 未注册错误码返回 undefined", () => {
            const registry = new ErrorRegistry();
            expect(registry.get("NONEXISTENT")).toBeUndefined();
        });

        it("isRetryable 未注册错误码返回 false", () => {
            const registry = new ErrorRegistry();
            expect(registry.isRetryable("NONEXISTENT")).toBe(false);
        });

        it("formatMessage 未注册错误码返回 Unknown error", () => {
            const registry = new ErrorRegistry();
            expect(registry.formatMessage("NONEXISTENT")).toBe("Unknown error: NONEXISTENT");
        });
    });

    describe("辅助函数", () => {
        it("isValidErrorCode 正确识别有效/无效错误码", () => {
            expect(isValidErrorCode("E101_INVALID_INPUT")).toBe(true);
            expect(isValidErrorCode("E999_FAKE")).toBe(false);
        });

        it("getErrorCodeInfo 返回正确信息", () => {
            const info = getErrorCodeInfo("E201_PROVIDER_TIMEOUT");
            expect(info).toBeDefined();
            expect(info?.retryable).toBe(true);
            expect(info?.category).toBe("PROVIDER_AI");
        });

        it("getErrorCategory 返回正确分类", () => {
            expect(getErrorCategory("E301_FILE_NOT_FOUND")).toBe("SYSTEM_IO");
            expect(getErrorCategory("UNKNOWN_CODE")).toBe("UNKNOWN");
        });

        it("isRetryableErrorCode 正确判断", () => {
            expect(isRetryableErrorCode("E201_PROVIDER_TIMEOUT")).toBe(true);
            expect(isRetryableErrorCode("E101_INVALID_INPUT")).toBe(false);
            expect(isRetryableErrorCode("UNKNOWN")).toBe(false);
        });

        it("getFixSuggestion 返回修复建议", () => {
            expect(getFixSuggestion("E203_INVALID_API_KEY")).toContain("API Key");
            expect(getFixSuggestion("UNKNOWN")).toBeUndefined();
        });
    });

    describe("P1: formatMessage 占位符插值一致性（PBT）", () => {
        const registry = createDefaultErrorRegistry();

        it("所有预定义错误码的 formatMessage 输出不含未解析占位符", () => {
            const allCodes = registry.getAllCodes();
            for (const code of allCodes) {
                const message = registry.formatMessage(code);
                expect(message).not.toMatch(UNRESOLVED_PLACEHOLDER);
            }
        });

        it("带任意 params 的 formatMessage 输出不含未解析占位符", () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...registry.getAllCodes()),
                    fc.dictionary(
                        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,10}$/),
                        fc.string({ minLength: 0, maxLength: 50 })
                    ),
                    (code, params) => {
                        const message = registry.formatMessage(code, params);
                        expect(message).not.toMatch(UNRESOLVED_PLACEHOLDER);
                    }
                ),
                { numRuns: 200 }
            );
        });

        it("自定义带占位符的模板：插值后不含未解析占位符", () => {
            fc.assert(
                fc.property(
                    // 生成包含 0~5 个占位符的描述模板
                    fc.array(
                        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,8}$/),
                        { minLength: 0, maxLength: 5 }
                    ),
                    fc.string({ minLength: 1, maxLength: 20 }),
                    fc.dictionary(
                        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,8}$/),
                        fc.string({ minLength: 0, maxLength: 30 })
                    ),
                    (placeholderNames, baseText, params) => {
                        // 构建带占位符的描述
                        const description = placeholderNames.reduce(
                            (acc, name) => `${acc} {${name}}`,
                            baseText
                        );

                        const reg = new ErrorRegistry();
                        reg.register({
                            code: "TEST_PBT",
                            name: "TEST",
                            description,
                            category: "INTERNAL",
                            retryable: false,
                        });

                        const message = reg.formatMessage("TEST_PBT", params);
                        expect(message).not.toMatch(UNRESOLVED_PLACEHOLDER);
                    }
                ),
                { numRuns: 300 }
            );
        });
    });
});
