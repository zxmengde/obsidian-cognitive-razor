import { describe, expect, it } from "vitest";
import { I18n } from "../../core/i18n";
import type { ProviderConfig } from "../../types";
import {
  buildServiceConfig,
  chatModelPlaceholder,
  endpointPlaceholder,
  initialServiceForm,
  serviceFormSignature,
  validateServiceForm,
  type ServiceForm,
} from "./service-form";

const i18n = new I18n();
const t = (key: string) => i18n.t(key);

function form(patch: Partial<ServiceForm> = {}): ServiceForm {
  return { ...initialServiceForm("svc"), apiKey: "key", chatModel: "chat", embedModel: "embed", ...patch };
}

describe("service form", () => {
  it("starts a new service on chat completions with embeddings and enabled", () => {
    const initial = initialServiceForm("");
    expect(initial).toMatchObject({ apiFormat: "openai-chat-completions", embeddingApiFormat: "openai-embeddings", enabled: true, apiKey: "" });
  });

  it("defaults embeddings off for protocols without an embeddings endpoint", () => {
    for (const apiFormat of ["gemini-generative-language", "anthropic-messages"] as const) {
      expect(initialServiceForm("x", { apiFormat } as ProviderConfig).embeddingApiFormat).toBe("disabled");
    }
  });

  it("round-trips an existing configuration through the form unchanged", () => {
    const config: ProviderConfig = {
      apiKey: "k", baseUrl: "https://example.test/v1", apiFormat: "openai-responses", embeddingApiFormat: "openai-embeddings",
      defaultChatModel: "chat", defaultEmbedModel: "embed", enabled: false,
      capabilities: { nativeWebSearch: true, temperature: true, topP: false, reasoning: true, promptCaching: true, promptCacheMode: "explicit", promptCacheTtl: "30m", responseContinuation: true },
      parameters: { temperature: 0.4, reasoning_effort: "high", maxTokens: 4096, embeddingDimension: 512 },
    };
    expect(buildServiceConfig(initialServiceForm("x", config), config)).toEqual(config);
  });

  it("requires a valid id only when saving", () => {
    expect(validateServiceForm(form({ id: "" }), t).id).toBe(t("modals.providerConfig.errors.providerIdRequired"));
    expect(validateServiceForm(form({ id: "__proto__" }), t).id).toBe(t("modals.providerConfig.errors.providerIdInvalid"));
    expect(validateServiceForm(form({ id: "" }), t, false).id).toBeUndefined();
  });

  it("needs a key or an endpoint, the visible models, and positive integers", () => {
    const errors = validateServiceForm(form({ apiKey: "", baseUrl: "", chatModel: "", embedModel: "", maxTokens: "0", embeddingDimension: "1.5" }), t);
    expect(errors).toMatchObject({
      apiKey: t("modals.providerConfig.errors.apiKeyRequired"),
      chatModel: t("modals.providerConfig.errors.chatModelRequired"),
      embedModel: t("modals.providerConfig.errors.embedModelRequired"),
      maxTokens: t("taskModels.fields.positiveIntegerError"),
      embeddingDimension: t("taskModels.fields.positiveIntegerError"),
    });
    expect(validateServiceForm(form({ apiKey: "", baseUrl: "http://127.0.0.1:1234/v1" }), t)).toEqual({});
  });

  it("rejects a service with neither chat nor embeddings and non-HTTP endpoints", () => {
    expect(validateServiceForm(form({ apiFormat: "disabled", embeddingApiFormat: "disabled" }), t).apiFormat).toBe(t("modals.providerConfig.errors.capabilityRequired"));
    expect(validateServiceForm(form({ baseUrl: "ftp://example.test" }), t).baseUrl).toBe(t("modals.providerConfig.errors.invalidUrlProtocol"));
    expect(validateServiceForm(form({ baseUrl: "not a url" }), t).baseUrl).toBe(t("modals.providerConfig.errors.invalidUrl"));
  });

  it("applies the Anthropic budget, output and sampling rules", () => {
    const anthropic = (patch: Partial<ServiceForm>) => validateServiceForm(form({ apiFormat: "anthropic-messages", embeddingApiFormat: "disabled", ...patch }), t);
    expect(anthropic({ reasoningSupported: true, thinkingBudget: "512" }).reasoning).toBe(t("modals.providerConfig.errors.anthropicBudgetMin"));
    expect(anthropic({ reasoningSupported: true, thinkingBudget: "2048", maxTokens: "2048" }).maxTokens).toBe(t("modals.providerConfig.errors.anthropicMaxTokensTooSmall"));
    expect(anthropic({ temperatureSupported: true, temperature: 1.5 }).temperature).toBe(t("modals.providerConfig.errors.anthropicTemperatureRange"));
    expect(anthropic({ temperatureSupported: true, topPSupported: true }).sampling).toBe(t("modals.providerConfig.errors.anthropicSamplingConflict"));
    // 推理开启时允许同时声明两个采样参数（发送时由请求构建器处理）。
    expect(anthropic({ temperatureSupported: true, topPSupported: true, reasoningSupported: true, reasoningEffort: "high" }).sampling).toBeUndefined();
  });

  it("writes only the capabilities and parameters the protocol supports", () => {
    const chat = buildServiceConfig(form({ enableWebSearch: true, promptCaching: true, responseContinuation: true, thinkingLevel: "HIGH" }), undefined);
    expect(chat.capabilities).toMatchObject({ nativeWebSearch: false, promptCaching: false, responseContinuation: false });
    expect(chat.parameters).not.toHaveProperty("thinkingLevel");
    const gemini = buildServiceConfig(form({ apiFormat: "gemini-generative-language", reasoningSupported: true, reasoningEffort: "high", thinkingLevel: "HIGH" }),
      { parameters: { thinkingBudget: 2000 } } as ProviderConfig);
    expect(gemini.parameters).toEqual({ thinkingLevel: "HIGH", thinkingBudget: 2000 });
    const responses = buildServiceConfig(form({ apiFormat: "openai-responses", promptCaching: true, promptCacheMode: "explicit" }), undefined);
    expect(responses.capabilities).toMatchObject({ promptCaching: true, promptCacheMode: "explicit", promptCacheTtl: "30m" });
    expect(buildServiceConfig(form({ apiFormat: "disabled", chatModel: "kept" }), undefined).defaultChatModel).toBe("");
  });

  it("changes the test signature with any configuration change but not with the enabled switch", () => {
    const base = form();
    expect(serviceFormSignature({ ...base, enabled: false }, undefined)).toBe(serviceFormSignature(base, undefined));
    expect(serviceFormSignature({ ...base, chatModel: "other" }, undefined)).not.toBe(serviceFormSignature(base, undefined));
  });

  it("suggests the endpoint and chat model for the chosen protocol", () => {
    expect(endpointPlaceholder(form({ apiFormat: "anthropic-messages" }))).toBe("https://api.anthropic.com/v1");
    expect(chatModelPlaceholder(form({ apiFormat: "anthropic-messages" }))).toBe("claude-sonnet-4-5");
    expect(chatModelPlaceholder(form({ apiFormat: "gemini-generative-language" }))).toBe("gemini-2.5-flash");
  });
});
