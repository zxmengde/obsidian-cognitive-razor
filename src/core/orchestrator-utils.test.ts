import { describe, expect, it } from "vitest";
import { validatePrerequisites } from "./orchestrator-utils";
import { DEFAULT_SETTINGS } from "../data/settings-store";
import type { ILogger, PluginSettings } from "../types";
import type { PromptManager } from "./prompt-manager";

function logger(): ILogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function settings(): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    defaultProviderId: "local",
    providers: {
      local: {
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiFormat: "openai-chat-completions",
        enableWebSearch: false,
        embeddingApiFormat: "disabled",
        defaultChatModel: "local-model",
        defaultEmbedModel: "",
        enabled: true,
      },
    },
    taskModels: {
      ...DEFAULT_SETTINGS.taskModels,
      define: { ...DEFAULT_SETTINGS.taskModels.define, providerId: "local", model: "local-model" },
    },
  };
}

describe("validatePrerequisites", () => {
  it("accepts an unauthenticated custom endpoint", () => {
    const promptManager = {
      resolveTemplateId: () => "base/operations/define",
      hasTemplate: () => true,
    } as unknown as PromptManager;
    expect(validatePrerequisites(settings(), "define", promptManager, logger(), "Test").ok).toBe(true);
  });

  it("rejects an unloaded operation template", () => {
    const promptManager = {
      resolveTemplateId: () => "base/operations/define",
      hasTemplate: () => false,
    } as unknown as PromptManager;
    const result = validatePrerequisites(settings(), "define", promptManager, logger(), "Test");
    expect(result).toMatchObject({ ok: false, error: { code: "E404_TEMPLATE_NOT_FOUND" } });
  });
});
