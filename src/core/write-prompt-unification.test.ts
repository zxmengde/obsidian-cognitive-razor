import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { FileStorage } from "../data/file-storage";
import { ok, DEFAULT_MODEL_CAPABILITIES, type ILogger, type ConversationContinuation } from "../types";
import { PromptManager } from "./prompt-manager";
import { getWriteStageDefinitions } from "./stage-catalog";
import { buildTaskChatRequest, PROMPT_VERSION } from "./task-execution-support";
import { schemaRegistry, buildPhaseJsonSchema } from "./schema-registry";

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const model = { providerId: "synthetic", model: "synthetic", capabilities: { ...DEFAULT_MODEL_CAPABILITIES, promptCaching: true, responseContinuation: true } };

describe("default Write prompt separates shared policy, task and field semantics", () => {
  it("sends one shared system for all 14 stages and never replays the full policy as phase instructions", async () => {
    const manager = new PromptManager({ read: async path => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    const systems = new Set<string>(); const structureTasks = new Set<string>();
    for (const type of ["domain", "issue", "theory", "entity", "mechanism"] as const) {
      let prior: ConversationContinuation | undefined;
      for (const phase of getWriteStageDefinitions(type)) {
        const template = await manager.loadPhaseTemplate(type, phase.id);
        expect(template.ok).toBe(true); if (!template.ok) continue;
        const prompt = manager.buildPhasedWrite({ CTX_META: JSON.stringify({ type, core_definition: "合成定义", parents: ["合成父节点"] }), CTX_PREVIOUS: "合成未覆盖草稿", CONCEPT_TYPE: type }, template.value);
        const schema = buildPhaseJsonSchema(schemaRegistry.getSchema(type), phase.fields);
        const request = buildTaskChatRequest("write", prompt, model, schema, phase.id, "initial", prior);
        const system = request.messages[0].content; systems.add(system);
        expect(system.match(/<knowledge_policy>/g)).toHaveLength(1);
        expect(system.length).toBeLessThan(800);
        expect(system).not.toMatch(/学科名|量子|统计热力学|费米|宁可保留|几何学与/);
        expect(request.messages.map(message => message.content).join("\n")).not.toContain("<phase_instructions>");
        expect(request.messages.at(-1)?.content).toContain("合成定义");
        expect(request.messages.at(-1)?.content).toContain("合成未覆盖草稿");
        if (phase.id === "structure") {
          const task = /<task_instruction>([\s\S]*?)<\/task_instruction>/.exec(prompt)![1].trim();
          structureTasks.add(task);
          expect(task).toContain("直接下一层"); expect(task).toContain("同义项合并");
          expect(task).toContain("不设数量目标"); expect(task).toContain("不按知名度筛选");
          expect(task).not.toMatch(/\bsub_|\bentities\b|\bmechanisms\b|stakeholder/);
        }
        prior = { systemPrompt: system, history: [...prior?.history ?? [], { role: "user", content: request.messages.at(-1)!.content }, { role: "assistant", content: "{}" }], promptVersion: PROMPT_VERSION };
      }
    }
    expect(systems.size).toBe(1); expect(structureTasks.size).toBe(1);
  });
});
