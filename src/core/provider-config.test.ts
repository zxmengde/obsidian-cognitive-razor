import { describe, expect, it } from "vitest";
import { buildProviderApiUrl } from "./provider-config";

describe("buildProviderApiUrl", () => {
  it.each([
    ["openai-chat-completions", "chat/completions", "/v1/chat/completions"],
    ["openai-responses", "responses", "/v1/responses"],
    [
      "gemini-generative-language",
      "models/gemini-3.1-pro:generateContent",
      "/v1beta/models/gemini-3.1-pro:generateContent",
    ],
    ["openai-embeddings", "embeddings", "/v1/embeddings"],
  ] as const)("adds the standard version path for a bare %s origin", (format, resource, expectedPath) => {
    const url = new URL(buildProviderApiUrl("https://gateway.test/", format, resource));
    expect(url.pathname).toBe(expectedPath);
  });

  it.each([
    ["openai-chat-completions", "https://gateway.test/v1", "chat/completions", "/v1/chat/completions"],
    ["gemini-generative-language", "https://gateway.test/v1beta/", "models/model:generateContent", "/v1beta/models/model:generateContent"],
    ["openai-embeddings", "https://gateway.test/custom/api/", "embeddings", "/custom/api/embeddings"],
  ] as const)("preserves the explicit base path for %s", (format, baseUrl, resource, expectedPath) => {
    const url = new URL(buildProviderApiUrl(baseUrl, format, resource));
    expect(url.pathname).toBe(expectedPath);
  });

  it("preserves explicit query parameters on a gateway base URL", () => {
    const url = new URL(buildProviderApiUrl(
      "https://gateway.test/proxy?tenant=personal",
      "openai-responses",
      "responses",
    ));
    expect(url.pathname).toBe("/proxy/responses");
    expect(url.searchParams.get("tenant")).toBe("personal");
  });
});
