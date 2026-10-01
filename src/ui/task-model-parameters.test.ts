import { describe, expect, it } from "vitest";
import {
  resolveParameterValue,
  resolveParameterWrite,
  storedParameterMode,
  type TaskParameterInputs,
} from "./task-model-parameters";

const noValue: TaskParameterInputs = { hasOverride: false };

describe("task parameter overrides", () => {
  it("never fabricates a value when 指定值 has nothing to inherit", () => {
    // 旧实现把 maxTokens/embeddingDimension 的占位值写成 1：维度 1 会立刻重置
    // 向量索引，maxTokens=1 会让下一次任务被截断。
    expect(resolveParameterWrite("set", noValue)).toEqual({ action: "pending" });
    expect(resolveParameterWrite("set", { hasOverride: false, legacy: undefined, provider: undefined }))
      .toEqual({ action: "pending" });
  });

  it("seeds 指定值 from a real value instead of a placeholder", () => {
    expect(resolveParameterWrite("set", { hasOverride: false, provider: 1536 }))
      .toEqual({ action: "set", value: 1536 });
    expect(resolveParameterWrite("set", { hasOverride: false, legacy: 0.5, provider: 0.7 }))
      .toEqual({ action: "set", value: 0.5 });
    expect(resolveParameterWrite("set", { hasOverride: true, override: null, provider: 0.7 }))
      .toEqual({ action: "set", value: 0.7 });
  });

  it("keeps the three stored modes distinct", () => {
    expect(storedParameterMode({ hasOverride: true, override: null })).toBe("omit");
    expect(storedParameterMode({ hasOverride: true, override: 0 })).toBe("set");
    expect(storedParameterMode({ hasOverride: false, legacy: 1 })).toBe("set");
    expect(storedParameterMode(noValue)).toBe("inherit");
  });

  it("maps inherit and omit to explicit writes", () => {
    expect(resolveParameterWrite("inherit", { hasOverride: true, override: 5 })).toEqual({ action: "delete" });
    expect(resolveParameterWrite("omit", { hasOverride: true, override: 5 })).toEqual({ action: "omit" });
  });

  it("treats an explicit null override as no value for display purposes", () => {
    expect(resolveParameterValue({ hasOverride: true, override: null })).toBeUndefined();
    expect(resolveParameterValue({ hasOverride: true, override: null, legacy: 3 })).toBe(3);
  });
});
