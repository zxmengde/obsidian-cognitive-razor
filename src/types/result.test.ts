import { describe, expect, it } from "vitest";
import { CognitiveRazorError, safeErrorMessage, toErr } from "./result";

describe("result error boundaries", () => {
  it("keeps unknown Error messages out of user-visible results", () => {
    const result = toErr(
      new Error("Authorization: Bearer fake-secret-token-value"),
      "E500_INTERNAL_ERROR",
      "操作失败",
    );

    expect(result.error.message).toBe("操作失败");
    expect(safeErrorMessage(result)).toBe("[E500_INTERNAL_ERROR] 操作失败");
    expect(result.error.message).not.toContain("fake-secret-token-value");
  });

  it("preserves explicitly authored domain errors", () => {
    const result = toErr(new CognitiveRazorError("E101_INVALID_INPUT", "输入无效"));

    expect(result.error).toMatchObject({
      code: "E101_INVALID_INPUT",
      message: "输入无效",
    });
  });
});
