/**
 * 错误码辅助函数测试
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    ERROR_CODE_INFO,
    getErrorCodeInfo,
    getErrorCategory,
    isRetryableErrorCode,
} from "./error-codes";

describe("错误码辅助函数", () => {
    it("ERROR_CODE_INFO 包含所有预定义错误码", () => {
        const allCodes = Object.keys(ERROR_CODE_INFO);
        expect(allCodes.length).toBeGreaterThan(0);
        for (const code of allCodes) {
            const info = ERROR_CODE_INFO[code as keyof typeof ERROR_CODE_INFO];
            expect(info.code).toBe(code);
            expect(info.category).toBeDefined();
        }
    });

    it("getErrorCodeInfo 返回正确信息", () => {
        const info = getErrorCodeInfo("E201_PROVIDER_TIMEOUT");
        expect(info).toBeDefined();
        expect(info?.retryable).toBe(false);
        expect(info?.category).toBe("PROVIDER_AI");
    });

    it("getErrorCodeInfo 未知错误码返回 undefined", () => {
        expect(getErrorCodeInfo("UNKNOWN")).toBeUndefined();
    });

    it("getErrorCategory 返回正确分类", () => {
        expect(getErrorCategory("E301_FILE_NOT_FOUND")).toBe("SYSTEM_IO");
        expect(getErrorCategory("UNKNOWN_CODE")).toBe("UNKNOWN");
    });

    it("isRetryableErrorCode 正确判断", () => {
        expect(isRetryableErrorCode("E201_PROVIDER_TIMEOUT")).toBe(false);
        expect(isRetryableErrorCode("E101_INVALID_INPUT")).toBe(false);
        expect(isRetryableErrorCode("E205_PROVIDER_REQUEST_INVALID")).toBe(false);
        expect(isRetryableErrorCode("E206_PROVIDER_REQUEST_UNCERTAIN")).toBe(false);
        expect(isRetryableErrorCode("E207_PROVIDER_RESPONSE_UNSUPPORTED")).toBe(false);
        expect(isRetryableErrorCode("E208_PROVIDER_STREAM_FAILED")).toBe(false);
        expect(isRetryableErrorCode("UNKNOWN")).toBe(false);
    });

    it("生产源码中使用的错误码均存在于 ERROR_CODE_INFO", () => {
        const root = path.resolve(__dirname, "..");
        const files: string[] = [];

        function collect(dir: string): void {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    collect(fullPath);
                    continue;
                }
                if (!/\.(ts|svelte)$/.test(entry.name) || /\.test\.ts$/.test(entry.name)) {
                    continue;
                }
                files.push(fullPath);
            }
        }

        collect(root);
        const usedCodes = new Set<string>();
        const pattern = /\bE\d{3}_[A-Z0-9_]+\b/g;
        for (const file of files) {
            const content = fs.readFileSync(file, "utf8");
            for (const match of content.matchAll(pattern)) {
                usedCodes.add(match[0]);
            }
        }

        const missing = [...usedCodes].filter((code) => !(code in ERROR_CODE_INFO)).sort();
        expect(missing).toEqual([]);
    });
});
