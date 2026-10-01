import { describe, expect, it, vi } from "vitest";
import { CreateOrchestrator } from "./create-orchestrator";
import { Validator } from "../data/validator";
import { SchemaRegistry } from "./schema-registry";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { ok } from "../types";
import type { ConfirmedConcept, ILogger, PluginSettings } from "../types";

type CreateDeps = ConstructorParameters<typeof CreateOrchestrator>[0];

function logger(): ILogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function settings(): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    defaultProviderId: "provider-1",
    providers: {
      "provider-1": {
        apiKey: "test-key",
        apiFormat: "openai-chat-completions",
        enableWebSearch: false,
        embeddingApiFormat: "disabled",
        defaultChatModel: "chat-model",
        defaultEmbedModel: "",
        enabled: true,
      },
    },
    taskModels: {
      ...DEFAULT_SETTINGS.taskModels,
      define: { ...DEFAULT_SETTINGS.taskModels.define, providerId: "provider-1", model: "chat-model" },
      tag: { ...DEFAULT_SETTINGS.taskModels.tag, providerId: "provider-1", model: "chat-model" },
      verify: { ...DEFAULT_SETTINGS.taskModels.verify, providerId: "provider-1", model: "chat-model" },
    },
  };
}

function concept(): ConfirmedConcept {
  return {
    type: "entity",
    name: { chinese: "实体", english: "" },
    coreDefinition: "定义",
    source: "define",
    parents: [],
  };
}

function defineOutput(): Record<string, unknown> {
  return {
    classification_result: {
      domain: { standard_name_cn: "领域", standard_name_en: "", confidence_score: 0 },
      issue: { standard_name_cn: "议题", standard_name_en: "", confidence_score: 0 },
      theory: { standard_name_cn: "理论", standard_name_en: "", confidence_score: 0 },
      entity: { standard_name_cn: "实体", standard_name_en: "", confidence_score: 1 },
      mechanism: { standard_name_cn: "机制", standard_name_en: "", confidence_score: 0 },
    },
    core_definition: "定义",
  };
}

function deps(overrides: Partial<CreateDeps> = {}): CreateDeps {
  const base: CreateDeps = {
    settingsStore: { getSettings: settings } as CreateDeps["settingsStore"],
    logger: logger(),
    promptManager: {
      build: () => "<system_instructions>system</system_instructions>\n<context_slots>context</context_slots>\n<task_instruction>task</task_instruction>\n<output_schema>{}</output_schema>",
      resolveTemplateId: (taskType: string) => `base/operations/${taskType}`,
      hasTemplate: () => true,
    } as unknown as CreateDeps["promptManager"],
    providerManager: {
      chat: vi.fn(async () => ok({
        content: JSON.stringify(concept()),
        finishReason: "stop",
      })),
    } as unknown as CreateDeps["providerManager"],
    schemaRegistry: { getDefineSchema: () => ({ type: "object" }) } as CreateDeps["schemaRegistry"],
    validator: { validate: vi.fn(async () => ({ valid: true, data: defineOutput(), errors: [] })) } as unknown as CreateDeps["validator"],
    workflowCoordinator: {
      startCreate: vi.fn(async () => ok("workflow-1")),
      isPathActive: vi.fn(() => false),
    } as unknown as CreateDeps["workflowCoordinator"],
  };
  return { ...base, ...overrides };
}

describe("CreateOrchestrator", () => {
  it("accepts unnamed alternatives through the real Define schema and validator", async () => {
    const classification_result = {
      domain: { standard_name_cn: "自然科学", standard_name_en: "Natural science", confidence_score: 1 },
      ...Object.fromEntries(["issue", "theory", "entity", "mechanism"].map(type => [type, {
        standard_name_cn: "", standard_name_en: "", confidence_score: 0,
      }])),
    };
    const orchestrator = new CreateOrchestrator(deps({
      validator: new Validator(),
      schemaRegistry: new SchemaRegistry(),
      providerManager: { chat: vi.fn(async () => ok({ content: JSON.stringify({ classification_result }), finishReason: "stop" })) } as unknown as CreateDeps["providerManager"],
    }));
    expect(await orchestrator.defineDirect("自然科学")).toMatchObject({ ok: true, value: {
      candidates: { domain: { name: { chinese: "自然科学" }, confidence: 1 }, issue: { name: { chinese: "", english: "" } } },
    } });
    await orchestrator.dispose();
  });

  it("keeps Define immediate and does not create a queue workflow", async () => {
    const orchestrator = new CreateOrchestrator(deps());
    const result = await orchestrator.defineDirect("  一个\n概念  ");

    expect(result).toMatchObject({ ok: true, value: {
      coreDefinition: "定义",
      candidates: { entity: { name: { chinese: "实体" }, confidence: 1 } },
    } });
    expect((orchestrator as unknown as { deps: CreateDeps }).deps.workflowCoordinator.startCreate).not.toHaveBeenCalled();
    await orchestrator.dispose();
  });

  it("delegates confirmed Create to the durable coordinator", async () => {
    const workflowCoordinator = {
      startCreate: vi.fn(async () => ok("workflow-1")),
      isPathActive: vi.fn((path: string) => path === "queued.md"),
    };
    const orchestrator = new CreateOrchestrator(deps({ workflowCoordinator: workflowCoordinator as unknown as CreateDeps["workflowCoordinator"] }));
    const confirmed = { ...concept(), parents: ["[[父概念]]"] };
    const result = await orchestrator.confirmCreate(confirmed, {
      targetPathOverride: "entity.md",
    });

    expect(result).toEqual(ok("workflow-1"));
    expect(workflowCoordinator.startCreate).toHaveBeenCalledWith(confirmed, {
      targetPathOverride: "entity.md",
    });
    expect(orchestrator.isPathActive("queued.md")).toBe(true);
    await orchestrator.dispose();
  });

  it("waits for an in-flight durable start before disposing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const workflowCoordinator = {
      startCreate: vi.fn(async () => { await gate; return ok("workflow-1"); }),
      isPathActive: () => false,
    };
    const orchestrator = new CreateOrchestrator(deps({ workflowCoordinator: workflowCoordinator as unknown as CreateDeps["workflowCoordinator"] }));
    const starting = orchestrator.confirmCreate(concept());
    const disposing = orchestrator.dispose();
    let disposed = false;
    void disposing.then(() => { disposed = true; });
    await Promise.resolve();
    expect(disposed).toBe(false);
    release();
    expect(await starting).toEqual(ok("workflow-1"));
    await disposing;
    expect(disposed).toBe(true);
  });
});
