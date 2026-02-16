/**
 * P3: 日志脱敏完整性（属性测试）
 *
 * 验证目标：sanitizeContext() 输出不含原始敏感值
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { sanitizeContext } from "./logger";

/** 敏感字段键名（与 logger.ts 中的 SENSITIVE_KEYS 对齐） */
const SENSITIVE_KEYS = ["apikey", "token", "secret", "authorization", "password", "api_key"];

describe("sanitizeContext", () => {
    describe("基础功能", () => {
        it("非敏感字段保持不变", () => {
            const input = { name: "test", count: 42, flag: true };
            const result = sanitizeContext(input);
            expect(result).toEqual(input);
        });

        it("敏感字段被替换为 [REDACTED]", () => {
            const input = { apiKey: "sk-12345", token: "bearer-abc", name: "safe" };
            const result = sanitizeContext(input);
            expect(result.apiKey).toBe("[REDACTED]");
            expect(result.token).toBe("[REDACTED]");
            expect(result.name).toBe("safe");
        });

        it("嵌套对象中的敏感字段被递归脱敏", () => {
            const input = {
                config: {
                    apiKey: "secret-key",
                    model: "gpt-4",
                },
            };
            const result = sanitizeContext(input);
            const config = result.config as Record<string, unknown>;
            expect(config.apiKey).toBe("[REDACTED]");
            expect(config.model).toBe("gpt-4");
        });

        it("数组中的对象元素被递归脱敏", () => {
            const input = {
                providers: [
                    { name: "openai", apiKey: "sk-123" },
                    { name: "anthropic", token: "ant-456" },
                ],
            };
            const result = sanitizeContext(input);
            const providers = result.providers as Array<Record<string, unknown>>;
            expect(providers[0].apiKey).toBe("[REDACTED]");
            expect(providers[0].name).toBe("openai");
            expect(providers[1].token).toBe("[REDACTED]");
        });

        it("不修改原始对象", () => {
            const input = { apiKey: "original-key" };
            sanitizeContext(input);
            expect(input.apiKey).toBe("original-key");
        });

        it("空对象返回空对象", () => {
            expect(sanitizeContext({})).toEqual({});
        });

        it("大小写不敏感匹配敏感键", () => {
            const input = { APIKEY: "key1", Token: "tok1", SECRET: "sec1" };
            const result = sanitizeContext(input);
            expect(result.APIKEY).toBe("[REDACTED]");
            expect(result.Token).toBe("[REDACTED]");
            expect(result.SECRET).toBe("[REDACTED]");
        });

        it("包含敏感键名子串的键也被脱敏", () => {
            const input = { myApiKey: "key1", authorizationHeader: "bearer xyz" };
            const result = sanitizeContext(input);
            expect(result.myApiKey).toBe("[REDACTED]");
            expect(result.authorizationHeader).toBe("[REDACTED]");
        });
    });

    describe("P3: 脱敏完整性（PBT）", () => {
        // 生成包含敏感键的上下文对象
        const sensitiveKeyArb = fc.constantFrom(...SENSITIVE_KEYS).chain((sk) =>
            fc.tuple(
                // 键名可能包含前缀/后缀
                fc.constantFrom("", "my", "x_", "provider").map((prefix) => `${prefix}${sk}`),
                // 敏感值：非空字符串
                fc.string({ minLength: 1, maxLength: 50 })
            )
        );

        it("任意敏感字段值在输出中不出现原始值", () => {
            fc.assert(
                fc.property(
                    fc.array(sensitiveKeyArb, { minLength: 1, maxLength: 5 }),
                    // 额外的非敏感字段
                    fc.dictionary(
                        fc.stringMatching(/^[a-z]{1,8}$/),
                        fc.string({ minLength: 0, maxLength: 20 })
                    ),
                    (sensitiveEntries, safeEntries) => {
                        const input: Record<string, unknown> = { ...safeEntries };

                        for (const [key, value] of sensitiveEntries) {
                            input[key] = value;
                        }

                        const result = sanitizeContext(input);

                        // 核心断言：所有敏感键的值必须被替换为 [REDACTED]
                        for (const [key] of sensitiveEntries) {
                            expect(result[key]).toBe("[REDACTED]");
                        }
                    }
                ),
                { numRuns: 200 }
            );
        });

        it("嵌套对象中的敏感字段也被完全脱敏", () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...SENSITIVE_KEYS),
                    fc.string({ minLength: 1, maxLength: 30 }),
                    (sensitiveKey, sensitiveValue) => {
                        const input = {
                            level1: {
                                [sensitiveKey]: sensitiveValue,
                                safe: "visible",
                            },
                        };
                        const result = sanitizeContext(input);
                        const level1 = result.level1 as Record<string, unknown>;
                        expect(level1[sensitiveKey]).toBe("[REDACTED]");
                        expect(level1.safe).toBe("visible");
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
