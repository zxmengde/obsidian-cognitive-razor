import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { FileStorage } from "../data/file-storage";
import { ok, DEFAULT_MODEL_CAPABILITIES, type ILogger, type ConversationContinuation } from "../types";
import { PromptManager } from "./prompt-manager";
import { getWriteStageDefinitions } from "./stage-catalog";
import { buildTaskChatRequest, PROMPT_VERSION } from "./task-execution-support";
import { schemaRegistry, buildPhaseJsonSchema, buildStrictJsonSchema } from "./schema-registry";

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const model = { providerId: "synthetic", model: "gpt-6-astra", capabilities: { ...DEFAULT_MODEL_CAPABILITIES, promptCaching: true, responseContinuation: true } };

describe("default Write prompt separates shared policy, task and field semantics", () => {
  it("sends one shared system for all 14 stages and never replays the full policy as phase instructions", async () => {
    const manager = new PromptManager({ read: async path => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    const systems = new Set<string>(); const structureTasks = new Set<string>();
    for (const type of ["domain", "issue", "theory", "entity", "mechanism"] as const) {
      let prior: ConversationContinuation | undefined;
      for (const phase of getWriteStageDefinitions(type)) {
        const template = await manager.loadPhaseTemplate(type, phase.id);
        expect(template.ok).toBe(true); if (!template.ok) continue;
        const prompt = manager.buildPhasedWrite({ CTX_META: JSON.stringify({ type, core_definition: "合成定义", parents: ["合成父节点"] }), CTX_PREVIOUS: "合成未覆盖草稿" }, template.value);
        const schema = buildPhaseJsonSchema(schemaRegistry.getSchema(type), phase.fields);
        const request = buildTaskChatRequest("write", prompt, model, schema, phase.id, "initial", prior);
        const system = request.messages[0].content; systems.add(system);
        if (phase.fields.includes("historical_genesis")) {
          expect(schema.properties?.historical_genesis?.description).toBe("历史形成与关键转折。自拟三级标题遵循公共标题规则，有依据的时期写在括号里。");
        }
        if (phase.fields.includes("holistic_understanding")) {
          const latest = request.messages.at(-1)?.content ?? "";
          expect(latest).toContain("`### 本体论`、`### 认识论`、`### 目的与功能`、`### 实践和价值`");
          expect(latest).toContain("不加冒号副标题");
          expect(latest).toContain("字段末尾按专业主题用三级标题展开额外补充");
          expect(system).not.toContain("### 本体论");
        }
        expect(system.match(/<knowledge_policy>/g)).toHaveLength(1);
        expect(system).not.toContain("<hierarchy_rules>");
        expect(system.match(/<writing_rules>/g)).toHaveLength(1);
        expect(system).toContain("专业指南条目");
        expect(system).toContain("长短服从解释需要");
        expect(system).toContain("禁用陪衬性的否定对照");
        expect(system).toContain("核心术语首次出现处加粗");
        expect(system).toContain("为什么成立、具体如何运作及条件如何影响结果");
        expect(system).not.toContain("科学总类");
        expect(system).toContain("各节承担不同问题");
        expect(system.length).toBeLessThan(1500);
        expect(system).not.toMatch(/学科名|量子|统计热力学|费米|宁可保留|几何学与|应用、设计和实践导向的分支/);
        expect(request.messages.map(message => message.content).join("\n")).not.toMatch(/例如|示例：|反例：/);
        expect(request.messages.map(message => message.content).join("\n")).not.toContain("<phase_instructions>");
        expect(request.messages.at(-1)?.content).toContain("合成定义");
        expect(request.messages.at(-1)?.content).toContain("合成未覆盖草稿");
        if (phase.id === "structure") {
          const hierarchy = request.messages.at(-1)?.content ?? "";
          expect(hierarchy.match(/<hierarchy_rules>/g) ?? []).toHaveLength(1);
          for (const rule of ["每套分类以子项范围的并集等于父项范围", "保持输入的父项范围", "只列直属下一层", "禁止为覆盖编造项目", "同组使用同一分类依据、直接关系和相当粒度", "不混合不同体系或分类维度", "各组仍须满足该字段的关系", "不得自造合并项或兜底项", "classification_basis"]) {
            expect(hierarchy).toContain(rule);
          }
          const task = /<task_instruction>([\s\S]*?)<\/task_instruction>/.exec(prompt)![1].trim();
          structureTasks.add(task);
          expect(prompt).toContain("task_instruction 指定的业务字段");
          expect(prompt).toContain("只输出符合本次 API Schema 的 JSON 对象");
          expect(task).not.toContain("只返回本阶段 Schema 要求的字段");
        } else {
          expect(request.messages.at(-1)?.content).not.toContain("<hierarchy_rules>");
        }
        prior = { systemPrompt: system, history: [...prior?.history ?? [], { role: "user", content: request.messages.at(-1)!.content }, { role: "assistant", content: "{}" }], promptVersion: PROMPT_VERSION };
      }
    }
    // 阶段任务按类型区分（domain/issue/theory 各一份），共用 system 仍只有一份。
    expect(systems.size).toBe(1); expect(structureTasks.size).toBe(3);
  });
  // 层级规则和固定标题属于相应阶段任务，共享 system 保持稳定。
  it("keeps historical headings and prescribed holistic titles on the stage task", async () => {
    const manager = new PromptManager({ read: async path => ok(await readFile(path, "utf8")) } as FileStorage, logger);
    for (const type of ["domain", "issue", "theory", "entity", "mechanism"] as const) {
      for (const phase of getWriteStageDefinitions(type)) {
        const template = await manager.loadPhaseTemplate(type, phase.id);
        expect(template.ok).toBe(true); if (!template.ok) continue;
        const prompt = manager.buildPhasedWrite({ CTX_META: "{}", CTX_PREVIOUS: "" }, template.value);
        const schema = buildPhaseJsonSchema(schemaRegistry.getSchema(type), phase.fields);
        const request = buildTaskChatRequest("write", prompt, model, schema, phase.id, "initial");
        const system = request.messages[0].content;
        if (phase.fields.includes("historical_genesis")) {
          expect(schema.properties?.historical_genesis?.description).toBe("历史形成与关键转折。自拟三级标题遵循公共标题规则，有依据的时期写在括号里。");
        }
        if (phase.fields.includes("holistic_understanding")) {
          expect(request.messages.at(-1)?.content).toContain("`### 本体论`、`### 认识论`、`### 目的与功能`、`### 实践和价值`");
          expect(system).not.toContain("### 本体论");
        }
      }
    }
  });
  it("requires complete classified items while allowing ungrouped lists", () => {
    const current = Object.fromEntries(["domain", "issue", "theory", "entity", "mechanism"].map(type => [type, schemaRegistry.getSchema(type as "domain" | "issue" | "theory" | "entity" | "mechanism")]));
    current.define = schemaRegistry.getDefineSchema(); current.tag = schemaRegistry.getTagSchema();
    for (const [type, field] of [["domain", "sub_domains"], ["issue", "sub_issues"], ["theory", "sub_theories"]] as const) {
      const property = (current[type] as ReturnType<typeof schemaRegistry.getSchema>).properties![field];
      const branches = property.items!.anyOf!;
      expect(branches).toHaveLength(2);
      expect(branches[1].properties!.classification_basis.description).toBe("简短分类维度名或正式分类体系名。");
      expect([...branches[1].required!].sort()).toEqual(Object.keys(branches[1].properties!).sort());
      expect(branches[0].required).toEqual(["name", "description"]);
      expect(branches[1].required).toEqual(["classification_basis", "name", "description"]);
    }
    const classification = (current.entity as ReturnType<typeof schemaRegistry.getSchema>).properties!.classification;
    expect(classification.anyOf).toHaveLength(2);
    expect(classification.anyOf![1].items!.properties!.classification_basis.description).toBe("简短分类维度名或正式分类体系名。");
    expect(classification.anyOf![1].items!.required).toEqual(["classification_basis", "genus", "differentia"]);
    for (const schema of Object.values(current)) expect(buildStrictJsonSchema(schema).additionalProperties).toBe(false);
    expect(JSON.stringify(current)).not.toMatch(/为什么 X 不是 Y|百科全书式|每条必须|并集等于|不预设固定/);
  });
});
