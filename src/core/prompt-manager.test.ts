import { describe, expect, it } from "vitest";
import { ok } from "../types";
import type { ILogger } from "../types";
import type { FileStorage } from "../data/file-storage";
import { insertContextBeforeTask, PromptManager, splitPromptIntoMessages } from "./prompt-manager";
import { addPromptSchemaConstraint } from "./prompt-message-builder";

function createLogger(): ILogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createManager(contentByPath: Record<string, string>): PromptManager {
  const fileStorage = {
    read: async (path: string) => ok(contentByPath[path] ?? ""),
  } as unknown as FileStorage;
  return new PromptManager(fileStorage, createLogger());
}

const VALID_PHASE_TEMPLATE = `<system_instructions>
系统规则中可以把 \`<context_slots>\` 当作文字引用，但它不是实际数据区块。
<output_schema>API Schema 是结构权威。</output_schema>
</system_instructions>

<context_slots>
<concept_info>{{CTX_META}}</concept_info>
</context_slots>

<task_instruction>
完成任务。
</task_instruction>`;

describe("PromptManager prompt structure", () => {
  it("shares strict message splitting and prompt-schema constraints with request construction", () => {
    const messages = splitPromptIntoMessages(VALID_PHASE_TEMPLATE);
    expect(messages).toEqual([
      expect.objectContaining({ role: "system" }),
      expect.objectContaining({ role: "user" }),
    ]);
    const constrained = addPromptSchemaConstraint(messages, { type: "object" }, "prompt");
    expect(constrained).toHaveLength(2);
    expect(constrained[0]).toEqual(messages[0]);
    expect(constrained[1]).toMatchObject({ role: "user", content: expect.stringContaining("JSON Schema") });
  });

  it("inserts dynamic context before the final task and preserves system separation", () => {
    const withEvidence = insertContextBeforeTask(
      VALID_PHASE_TEMPLATE,
      "<untrusted_context>context</untrusted_context>",
    );

    expect(withEvidence.indexOf("<untrusted_context>"))
      .toBeGreaterThan(withEvidence.indexOf("</context_slots>"));
    expect(withEvidence.indexOf("<untrusted_context>"))
      .toBeLessThan(withEvidence.indexOf("<task_instruction>"));
    expect(withEvidence.trimEnd().endsWith("</task_instruction>")).toBe(true);

    const messages = splitPromptIntoMessages(withEvidence);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0].content).not.toContain("untrusted_context");
    expect(messages[1]).toMatchObject({ role: "user" });
    expect(messages[1].content.indexOf("<untrusted_context>"))
      .toBeLessThan(messages[1].content.indexOf("<task_instruction>"));
  });

  it("accepts a phase template when the real context follows the system block", async () => {
    const manager = createManager({
      "prompts/phases/entity/core.md": VALID_PHASE_TEMPLATE,
    });

    const result = await manager.loadPhaseTemplate("entity", "core");

    expect(result.ok).toBe(true);
  });

  it("rejects a phase template whose task appears before its real context", async () => {
    const manager = createManager({
      "prompts/phases/entity/core.md": `<system_instructions>
<output_schema>schema</output_schema>
</system_instructions>
<task_instruction>task</task_instruction>
<context_slots>context</context_slots>`,
    });

    const result = await manager.loadPhaseTemplate("entity", "core");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("E405_TEMPLATE_INVALID");
    }
  });

  it("rejects any non-whitespace content after the final task block", async () => {
    const manager = createManager({
      "prompts/phases/entity/core.md": `${VALID_PHASE_TEMPLATE}\n<extra>late instruction</extra>`,
    });

    const result = await manager.loadPhaseTemplate("entity", "core");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("任务区块必须完整且是模板最后一个顶层区块");
    }
  });
});
