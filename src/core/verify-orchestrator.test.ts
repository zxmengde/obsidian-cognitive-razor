import { describe, expect, it, vi } from "vitest";
import { VerifyOrchestrator } from "./verify-orchestrator";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import { ok } from "../types";
import type { ILogger, PluginSettings } from "../types";

type VerifyDeps = ConstructorParameters<typeof VerifyOrchestrator>[0];

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
      verify: { ...DEFAULT_SETTINGS.taskModels.verify, providerId: "provider-1", model: "chat-model" },
    },
  };
}

function deps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
  const base: VerifyDeps = {
    settingsStore: { getSettings: settings } as VerifyDeps["settingsStore"],
    logger: logger(),
    promptManager: {
      resolveTemplateId: () => "base/operations/verify",
      hasTemplate: () => true,
    } as unknown as VerifyDeps["promptManager"],
    workflowCoordinator: {
      startVerify: vi.fn(async () => ok("workflow-verify")),
    } as unknown as VerifyDeps["workflowCoordinator"],
  };
  return { ...base, ...overrides };
}

describe("VerifyOrchestrator", () => {
  it("delegates Verify after prerequisite validation", async () => {
    const workflowCoordinator = { startVerify: vi.fn(async () => ok("workflow-verify")) };
    const orchestrator = new VerifyOrchestrator(deps({ workflowCoordinator: workflowCoordinator as unknown as VerifyDeps["workflowCoordinator"] }));

    expect(await orchestrator.startVerifyPipeline("note.md")).toEqual(ok("workflow-verify"));
    expect(workflowCoordinator.startVerify).toHaveBeenCalledWith("note.md");
    await orchestrator.dispose();
  });

  it("returns a lifecycle error after disposal", async () => {
    const orchestrator = new VerifyOrchestrator(deps());
    await orchestrator.dispose();

    const result = await orchestrator.startVerifyPipeline("note.md");
    expect(result).toMatchObject({ ok: false, error: { code: "E310_INVALID_STATE" } });
  });
});
