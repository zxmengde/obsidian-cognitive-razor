/**
 * 错误码辅助函数测试
 */
import { describe, expect, it } from "vitest";
import {
    ERROR_CODE_INFO,
    isValidErrorCode,
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

    it("getErrorCodeInfo 未知错误码返回 undefined", () => {
        expect(getErrorCodeInfo("UNKNOWN")).toBeUndefined();
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
});
