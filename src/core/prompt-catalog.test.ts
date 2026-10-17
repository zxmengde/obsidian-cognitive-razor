import { describe, expect, it } from "vitest";
import {
  getOperationPromptTemplateKey,
  getOperationPromptTemplateKeys,
  getWritePromptTemplateKey,
} from "./prompt-catalog";

describe("PromptCatalog", () => {
  it("resolves operation templates without treating Write as a generic operation", () => {
    expect(getOperationPromptTemplateKey("define")).toBe("base/operations/define");
    expect(getOperationPromptTemplateKey("tag")).toBe("base/operations/tag");
    expect(getOperationPromptTemplateKey("verify")).toBe("base/operations/verify");
    expect(getOperationPromptTemplateKey("write")).toBeUndefined();
    expect(getOperationPromptTemplateKeys()).toEqual([
      "base/operations/cards",
      "base/operations/define",
      "base/operations/merge",
      "base/operations/tag",
      "base/operations/verify",
    ]);
  });

  it("resolves phase templates only through the StageCatalog", () => {
    expect(getWritePromptTemplateKey("entity", "core")).toBe("phases/entity/core");
    expect(getWritePromptTemplateKey("entity", "synthesis")).toBe("phases/entity/synthesis");
    expect(getWritePromptTemplateKey("entity", "not-a-phase")).toBeUndefined();
  });
});
