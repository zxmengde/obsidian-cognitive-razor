import { describe, expect, it } from "vitest";
import { toHostErrorFeedback, toSafeErrorFeedback } from "./error-feedback";

describe("UI error feedback", () => {
  it("projects a known error code to safe user language", () => {
    const feedback = toSafeErrorFeedback(
      { code: "E206_PROVIDER_REQUEST_UNCERTAIN", message: "raw upstream body" },
      "fallback",
    );

    expect(feedback.level).toBe("error");
    expect(feedback.message).toContain("无法确认");
    expect(feedback.message).not.toContain("raw upstream body");
    expect(feedback.details).toContain("账单");
  });

  it("handles Result-shaped errors without exposing the nested message", () => {
    const feedback = toSafeErrorFeedback(
      { ok: false, error: { code: "E401_PROVIDER_NOT_CONFIGURED", message: "secret" } },
      "fallback",
    );

    expect(feedback.message).toContain("未配置");
    expect(feedback.message).not.toContain("secret");
  });

  it("uses the caller fallback for unknown errors", () => {
    expect(toSafeErrorFeedback({ code: "E999_UNKNOWN", message: "raw" }, "操作失败")).toEqual({
      level: "error",
      message: "操作失败",
      details: undefined,
    });
  });
});

describe("host error feedback", () => {
  it("surfaces the host message for runtime startup failures", () => {
    const feedback = toHostErrorFeedback(
      new Error("加载任务队列失败: 队列文件损坏，已停止恢复。请备份并检查 data/queue-state-v5.json 后重载插件。"),
      "未知错误",
    );

    expect(feedback.level).toBe("error");
    expect(feedback.message).toContain("queue-state-v5.json");
  });

  it("keeps the coded projection for application errors", () => {
    const feedback = toHostErrorFeedback({ code: "E310_INVALID_STATE", message: "raw upstream body" }, "未知错误");

    expect(feedback.message).not.toContain("raw upstream body");
    expect(feedback.message).toContain("状态不正确");
  });

  it("falls back when a host failure carries no usable message", () => {
    expect(toHostErrorFeedback("boom", "未知错误").message).toBe("未知错误");
    expect(toHostErrorFeedback(new Error("   "), "未知错误").message).toBe("未知错误");
  });
});
