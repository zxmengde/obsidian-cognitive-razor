/**
 * P3: 日志脱敏完整性（属性测试）
 *
 * 验证目标：sanitizeContext() 输出不含原始敏感值
 */
import { describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";
import { Logger, reportHostDiagnostic, sanitizeContext } from "./logger";

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
                    { name: "legacy-provider", token: "ant-456" },
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

        it("保留 token 用量指标而不把复数统计误判为密钥", () => {
            const result = sanitizeContext({
                tokensUsed: 42,
                inputTokens: 30,
                outputTokens: 12,
                accessToken: "secret-value",
            });

            expect(result).toEqual({
                tokensUsed: 42,
                inputTokens: 30,
                outputTokens: 12,
                accessToken: "[REDACTED]",
            });
        });

        it("将循环引用和不可 JSON 序列化值转换为安全占位符", () => {
            const input: Record<string, unknown> = { callback: () => undefined };
            input.self = input;

            expect(sanitizeContext(input)).toEqual({
                callback: expect.any(String),
                self: "[CIRCULAR]",
            });
        });

        it("redacts credentials embedded in ordinary strings and Error values", () => {
            const fakeKey = "sk-abcdefghijklmnopqrstuvwxyz123456";
            const result = sanitizeContext({
                rawResponse: `Authorization: Bearer ${fakeKey}`,
                endpoint: `https://alice:password@example.test/v1?api_key=${fakeKey}#private`,
                failure: new Error(`token=${fakeKey}`),
            });
            const serialized = JSON.stringify(result);

            expect(serialized).not.toContain(fakeKey);
            expect(serialized).not.toContain("alice:password");
            expect(serialized).not.toContain("#private");
            expect(serialized).toContain("https://example.test/v1");
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

describe("reportHostDiagnostic", () => {
    it("sanitizes fallback diagnostics before writing to the host console", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        reportHostDiagnostic("Runtime", "cleanup failed", new Error("token=secret-value"));

        expect(consoleError).toHaveBeenCalledWith(
            "[CR][HOST][Runtime] cleanup failed Error: token=[REDACTED]",
        );
        consoleError.mockRestore();
    });
});

describe("Logger persistence", () => {
    it("sanitizes log messages, Error details, stacks, and context before persistence", async () => {
        const fakeKey = "tvly-dev-abcdefghijklmnopqrstuvwxyz";
        const writes: string[] = [];
        const logger = new Logger("data/app.log", {
            write: async (_path, content) => { writes.push(content); },
            read: async () => "",
            exists: async () => false,
        });
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await logger.initialize();
        logger.error(
            "test",
            `request failed api_key=${fakeKey}`,
            new Error(`Authorization: Bearer ${fakeKey}`),
            { rawError: `https://user:pass@example.test/v1?token=${fakeKey}#secret` },
        );
        await logger.flush();

        const persisted = writes.at(-1) ?? "";
        expect(persisted).not.toContain(fakeKey);
        expect(persisted).not.toContain("user:pass");
        expect(persisted).not.toContain("#secret");
        expect(persisted).toContain("[REDACTED]");
        consoleInfo.mockRestore();
        consoleError.mockRestore();
    });

    it("applies the selected level to session logs and runtime changes", async () => {
        const writes: string[] = [];
        const logger = new Logger("data/app.log", {
            write: async (_path, content) => { writes.push(content); },
            read: async () => "",
            exists: async () => false,
        }, "error");
        const consoleDebug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

        await logger.initialize();
        logger.info("test", "hidden info");
        logger.setLevel("debug");
        logger.debug("test", "visible debug");
        await logger.flush();

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain("visible debug");
        expect(writes[0]).not.toContain("SESSION_START");
        expect(writes[0]).not.toContain("hidden info");
        consoleDebug.mockRestore();
        consoleInfo.mockRestore();
    });

    it("does not read, buffer, write, or emit logs while silent", async () => {
        const write = vi.fn(async (_path: string, _content: string) => undefined);
        const read = vi.fn(async (_path: string) => "existing log");
        const exists = vi.fn(async (_path: string) => true);
        const logger = new Logger("data/app.log", { write, read, exists }, "silent");
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await logger.initialize();
        logger.info("test", "must stay silent");
        logger.error("test", "must stay silent", new Error("must stay silent"));
        await logger.flush();

        expect(exists).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(consoleInfo).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        consoleInfo.mockRestore();
        consoleError.mockRestore();
    });

    it("preserves the existing log when leaving silent before its first write", async () => {
        let persisted = '{"event":"before-silent"}';
        const write = vi.fn(async (_path: string, content: string) => {
            persisted = content;
        });
        const read = vi.fn(async () => persisted);
        const exists = vi.fn(async () => true);
        const logger = new Logger("data/app.log", { write, read, exists }, "silent");
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

        await logger.initialize();
        logger.info("test", "hidden while silent");
        expect(exists).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();

        logger.setLevel("info");
        logger.info("test", "visible after silent");
        await logger.flush();

        expect(read).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
        expect(persisted).toContain("before-silent");
        expect(persisted).toContain("visible after silent");
        expect(persisted).not.toContain("hidden while silent");
        expect(persisted).not.toContain("SESSION_START");
        consoleInfo.mockRestore();
    });

    it("drops pending output when switched to silent and resumes for new entries", async () => {
        const writes: string[] = [];
        const logger = new Logger("data/app.log", {
            write: async (_path, content) => { writes.push(content); },
            read: async () => "",
            exists: async () => false,
        });
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

        await logger.initialize();
        logger.info("test", "discard before silent");
        logger.setLevel("silent");
        logger.info("test", "hidden while silent");
        await logger.flush();

        expect(writes).toEqual([]);

        logger.setLevel("info");
        logger.info("test", "visible after silent");
        await logger.flush();

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain("visible after silent");
        expect(writes[0]).not.toContain("discard before silent");
        expect(writes[0]).not.toContain("SESSION_START");
        consoleInfo.mockRestore();
    });

    it("serializes overlapping writes so a newer snapshot remains last", async () => {
        let releaseFirst!: () => void;
        let firstStarted!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
        const firstWriteRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const writes: string[] = [];
        const write = vi.fn(async (_path: string, content: string) => {
            writes.push(content);
            if (writes.length === 1) {
                firstStarted();
                await firstWriteRelease;
            }
        });
        const logger = new Logger("data/app.log", {
            write,
            read: async () => "",
            exists: async () => false,
        });
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

        await logger.initialize();
        const firstFlush = logger.flush();
        await firstWriteStarted;
        logger.info("test", "new entry");
        const secondFlush = logger.flush();
        releaseFirst();
        await Promise.all([firstFlush, secondFlush]);

        expect(writes).toHaveLength(2);
        expect(writes[0]).not.toContain("new entry");
        expect(writes[1]).toContain("new entry");
        consoleInfo.mockRestore();
    });

    it("does not overwrite an unreadable existing log later in the session", async () => {
        const write = vi.fn(async () => undefined);
        const logger = new Logger("data/app.log", {
            write,
            read: async () => { throw new Error("temporarily unreadable"); },
            exists: async () => true,
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

        await logger.initialize();
        logger.info("test", "still available in console");
        await logger.flush();

        expect(write).not.toHaveBeenCalled();
        consoleError.mockRestore();
        consoleInfo.mockRestore();
    });
});
